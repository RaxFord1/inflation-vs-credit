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

  // площа, ціна, кімнати — жорсткі "відсіювачі" перевіряємо ПЕРШИМИ, до геокоординати.
  // OLX (і інші джерела) часто віддають лише наближену (районну/зонову) точку на мапі —
  // сотні різних об'єктів в одному районі можуть мати ідентичний lat/lng з точністю до
  // тисячних. Якщо довіряти такій "точній" геокоординаті без санітарної перевірки ціни/площі,
  // вона склеює геть різні об'єкти (напр. квартиру за $45k і дачу за $5.5k в одному районі).
  if (a.areaSqm != null && b.areaSqm != null) {
    if (Math.abs(a.areaSqm - b.areaSqm) > (d.areaToleranceSqm ?? 3)) return false;
  }
  if (a.priceUSD && b.priceUSD) {
    const diffPct = (Math.abs(a.priceUSD - b.priceUSD) / Math.max(a.priceUSD, b.priceUSD)) * 100;
    if (diffPct > (d.priceTolerancePct ?? 6) * 3) return false; // сильно різна ціна — навряд той самий
  }
  if (a.rooms != null && b.rooms != null && a.rooms !== b.rooms) return false;

  // геокоордината в межах 60м — сильний сигнал, але лише коли не суперечить площі/ціні/кімнатам вище
  if (haversine(a, b) < 60) return true;

  // схожість адреси (без міста — воно й так однакове через фільтр кандидатів,
  // а з ним пара "той самий район, різна вулиця" видає хибну sim=1.0, коли
  // вулиця не вказана в жодному з двох оголошень)
  const aTok = addressTokens(a.district, a.street);
  const bTok = addressTokens(b.district, b.street);
  const sim = tokenSimilarity(aTok, bTok);
  // вимагаємо принаймні 2 токени з кожного боку — інакше збіг лише по району
  // (1 токен) занадто слабкий доказ, щоб вважати об'єкти тим самим
  if (aTok.length >= 2 && bTok.length >= 2 && sim >= (d.addressSimilarity ?? 0.82)) return true;

  // площа+кімнати+ціна близькі, місто збігається, і є хоч якийсь збіг у адресі (район/вулиця) —
  // без цього площа+ціна самі по собі не доводять, що це той самий об'єкт (у місті можуть бути
  // десятки не пов'язаних квартир схожого метражу й ціни)
  if (sim > 0 && a.city && a.city === b.city && a.areaSqm != null && b.areaSqm != null && a.priceUSD && b.priceUSD) {
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
        // повний зв'язок (complete-linkage): b приєднується лише якщо збігається з
        // УСІМА поточними членами групи, а не лише з одним (single-linkage). Інакше
        // довгий ланцюжок слабко схожих сусідніх пар "склеює" геть різні об'єкти
        // (напр. квартиру за $45k із дачею за $5.5k через кілька проміжних оголошень).
        if (group.every((g) => sameObject(g, b, cfg))) { group.push(b); assigned.add(b.uid); }
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
