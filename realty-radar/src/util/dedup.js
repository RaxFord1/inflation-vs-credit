// Групування ймовірних дублів між джерелами.
// Логіка: спершу групуємо по грубому fingerprint (місто|тип|кімнати|площа|ціна-бакет),
// потім усередині перевіряємо тонкі критерії (площа ±, ціна ±%, схожість адреси / геокоордината).
import { getDb, setGroup, fromRow } from '../db/db.js';
import { addressTokens, tokenSimilarity } from './normalize.js';
import crypto from 'node:crypto';
import log from '../logger.js';

function haversine(a, b) {
  if (a.lat == null || a.lng == null || b.lat == null || b.lng == null) return Infinity;
  const R = 6371000, toRad = (x) => (x * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

function sameObject(a, b, cfg) {
  const d = cfg.dedup;
  if (a.propertyType !== b.propertyType) return false;

  // геокоордината в межах 60м — майже напевно той самий об'єкт
  if (haversine(a, b) < 60) return true;

  // площа
  if (a.areaSqm != null && b.areaSqm != null) {
    if (Math.abs(a.areaSqm - b.areaSqm) > (d.areaToleranceSqm ?? 3)) return false;
  }
  // ціна близька
  if (a.priceUSD && b.priceUSD) {
    const diffPct = (Math.abs(a.priceUSD - b.priceUSD) / Math.max(a.priceUSD, b.priceUSD)) * 100;
    if (diffPct > (d.priceTolerancePct ?? 6) * 3) return false; // сильно різна ціна — навряд той самий
  }
  // кімнати
  if (a.rooms != null && b.rooms != null && a.rooms !== b.rooms) return false;

  // схожість адреси
  const sim = tokenSimilarity(
    addressTokens(a.city, a.district, a.street),
    addressTokens(b.city, b.district, b.street)
  );
  if (sim >= (d.addressSimilarity ?? 0.82)) return true;

  // якщо площа+кімнати+ціна близькі і місто збігається — вважаємо дублем навіть без точної адреси
  if (a.city && a.city === b.city && a.areaSqm != null && b.areaSqm != null && a.priceUSD && b.priceUSD) {
    const diffPct = (Math.abs(a.priceUSD - b.priceUSD) / Math.max(a.priceUSD, b.priceUSD)) * 100;
    if (diffPct <= (d.priceTolerancePct ?? 6) && Math.abs(a.areaSqm - b.areaSqm) <= (d.areaToleranceSqm ?? 3)) return true;
  }
  return false;
}

/** Перегруповує активні оголошення. Присвоює group_id. Повертає кількість груп із >1 елементом. */
export function regroupAll(cfg) {
  const db = getDb();
  const rows = db.prepare(`SELECT * FROM listings WHERE status='active'`).all().map(fromRow);
  // індекс по fingerprint
  const buckets = new Map();
  for (const l of rows) {
    const key = l.fingerprint || 'x';
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(l);
  }
  // також з'єднуємо сусідні бакети по ціні (бакет = ~1000$) — щоб ловити дублі на межі
  const groups = []; // масив масивів
  const assigned = new Set();

  const allByFp = [...buckets.values()];
  for (const arr of allByFp) {
    for (const a of arr) {
      if (assigned.has(a.uid)) continue;
      const group = [a];
      assigned.add(a.uid);
      // порівнюємо з рештою у цьому ж бакеті та у сусідніх бакетах того ж міста/типу
      const candidates = rows.filter((b) => !assigned.has(b.uid) && b.city === a.city && b.propertyType === a.propertyType);
      for (const b of candidates) {
        if (group.some((g) => sameObject(g, b, cfg))) { group.push(b); assigned.add(b.uid); }
      }
      groups.push(group);
    }
  }

  let dupGroups = 0;
  const tx = db.transaction(() => {
    for (const group of groups) {
      const gid = crypto.createHash('sha1').update(group.map((x) => x.uid).sort().join('|')).digest('hex').slice(0, 12);
      for (const l of group) setGroup(l.uid, gid);
      if (group.length > 1) dupGroups++;
    }
  });
  tx();
  log.info(`dedup: ${rows.length} активних оголошень -> ${groups.length} груп (${dupGroups} з дублями між джерелами)`);
  return { groups: groups.length, dupGroups };
}

/** Для групи повертає найдешевше активне оголошення */
export function cheapestInGroup(groupId) {
  const rows = getDb().prepare(
    `SELECT * FROM listings WHERE group_id=? AND status='active' AND price_usd IS NOT NULL ORDER BY price_usd ASC`
  ).all(groupId).map(fromRow);
  return rows[0] || null;
}
