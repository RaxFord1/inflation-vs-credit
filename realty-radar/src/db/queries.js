// Запити для веб-UI: фільтрація + групування дублів.
import { getDb, fromRow } from './db.js';

export function queryListings(params = {}) {
  const {
    propertyType, purpose, city, source, priceMin, priceMax, minAiScore,
    onlyDeals, groupDuplicates = true, sort = 'ai_score', limit = 200, offset = 0,
  } = params;

  const where = [`status='active'`];
  const args = [];
  if (propertyType && propertyType !== 'all') { where.push('property_type = ?'); args.push(propertyType); }
  if (purpose && purpose !== 'all') { where.push('purpose = ?'); args.push(purpose); }
  if (city && city !== 'all') { where.push('city = ?'); args.push(city); }
  if (source && source !== 'all') { where.push('source = ?'); args.push(source); }
  if (priceMin != null) { where.push('price_usd >= ?'); args.push(priceMin); }
  if (priceMax != null) { where.push('price_usd <= ?'); args.push(priceMax); }
  if (minAiScore != null) { where.push('ai_score >= ?'); args.push(minAiScore); }
  if (onlyDeals) { where.push('ai_score >= 65'); }

  const sortCol = { ai_score: 'ai_score DESC', price: 'price_usd ASC', price_sqm: 'price_per_sqm ASC', newest: 'first_seen DESC' }[sort] || 'ai_score DESC';

  const rows = getDb().prepare(
    `SELECT * FROM listings WHERE ${where.join(' AND ')} ORDER BY ${sortCol} NULLS LAST LIMIT ? OFFSET ?`
  ).all(...args, limit, offset).map(fromRow);

  if (!groupDuplicates) return rows.map((r) => ({ ...r, alternatives: [] }));

  // групуємо: показуємо найдешевше з групи, решту як alternatives
  const byGroup = new Map();
  for (const r of rows) {
    const g = r.groupId || r.uid;
    if (!byGroup.has(g)) byGroup.set(g, []);
    byGroup.get(g).push(r);
  }
  const out = [];
  for (const [, arr] of byGroup) {
    arr.sort((a, b) => (a.priceUSD ?? 1e12) - (b.priceUSD ?? 1e12));
    const head = arr[0];
    head.alternatives = arr.slice(1).map((a) => ({
      source: a.source, url: a.url, priceUSD: a.priceUSD, uid: a.uid,
    }));
    head.cheaperElsewhere = arr.length > 1;
    out.push(head);
  }
  // повторне сортування за обраним критерієм
  out.sort((a, b) => {
    if (sort === 'price') return (a.priceUSD ?? 1e12) - (b.priceUSD ?? 1e12);
    if (sort === 'price_sqm') return (a.pricePerSqmUSD ?? 1e12) - (b.pricePerSqmUSD ?? 1e12);
    if (sort === 'newest') return new Date(b.firstSeen) - new Date(a.firstSeen);
    return (b.aiScore ?? -1) - (a.aiScore ?? -1);
  });
  return out;
}

export function stats() {
  const db = getDb();
  const total = db.prepare(`SELECT COUNT(*) n FROM listings WHERE status='active'`).get().n;
  const byType = db.prepare(`SELECT property_type t, COUNT(*) n FROM listings WHERE status='active' GROUP BY property_type`).all();
  const bySource = db.prepare(`SELECT source s, COUNT(*) n FROM listings WHERE status='active' GROUP BY source`).all();
  const byCity = db.prepare(`SELECT city c, COUNT(*) n FROM listings WHERE status='active' AND city IS NOT NULL GROUP BY city ORDER BY n DESC`).all();
  const deals = db.prepare(`SELECT COUNT(*) n FROM listings WHERE status='active' AND ai_score >= 65`).get().n;
  const dupGroups = db.prepare(`SELECT COUNT(*) n FROM (SELECT group_id FROM listings WHERE status='active' AND group_id IS NOT NULL GROUP BY group_id HAVING COUNT(*)>1)`).get().n;
  const lastRun = db.prepare(`SELECT started_at, source, found, new FROM runs ORDER BY id DESC LIMIT 8`).all();
  return { total, deals, dupGroups, byType, bySource, byCity, lastRun };
}

export function getListing(uid) {
  const r = getDb().prepare(`SELECT * FROM listings WHERE uid=?`).get(uid);
  if (!r) return null;
  const l = fromRow(r);
  if (l.groupId) {
    l.alternatives = getDb().prepare(`SELECT source, url, price_usd priceUSD, uid FROM listings WHERE group_id=? AND uid!=? AND status='active'`).all(l.groupId, uid);
  }
  l.priceHistory = getDb().prepare(`SELECT price_usd, seen_at FROM price_history WHERE uid=? ORDER BY seen_at`).all(uid);
  return l;
}
