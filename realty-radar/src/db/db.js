// Сховище на вбудованому node:sqlite (без нативних збірок). Див. db/sqlite.js.
import { openDatabase } from './sqlite.js';
import path from 'node:path';
import fs from 'node:fs';
import { ROOT } from '../config.js';
import log from '../logger.js';

let db = null;

export function getDb() {
  if (db) return db;
  const dir = path.join(ROOT, 'data');
  fs.mkdirSync(dir, { recursive: true });
  db = openDatabase(path.join(dir, 'realty.db'));
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');
  migrate(db);
  return db;
}

function migrate(d) {
  d.exec(`
  CREATE TABLE IF NOT EXISTS listings (
    uid            TEXT PRIMARY KEY,
    source         TEXT NOT NULL,
    source_id      TEXT NOT NULL,
    url            TEXT,
    title          TEXT,
    description    TEXT,
    property_type  TEXT,
    purpose        TEXT,
    land_use       TEXT,
    price_orig     REAL,
    currency_orig  TEXT,
    price_usd      REAL,
    price_uah      REAL,
    price_per_sqm  REAL,
    area_sqm       REAL,
    land_sotka     REAL,
    rooms          INTEGER,
    floor          INTEGER,
    floors         INTEGER,
    year_built     INTEGER,
    wall_type      TEXT,
    city           TEXT,
    district       TEXT,
    street         TEXT,
    lat            REAL,
    lng            REAL,
    photos_json    TEXT,
    is_auction     INTEGER DEFAULT 0,
    auction_ends   TEXT,
    published_at   TEXT,
    fingerprint    TEXT,
    group_id       TEXT,
    pre_score      INTEGER,
    ai_score       INTEGER,
    ai_verdict     TEXT,
    ai_flags_json  TEXT,
    ai_done        INTEGER DEFAULT 0,
    notified       INTEGER DEFAULT 0,
    status         TEXT DEFAULT 'active',
    first_seen     TEXT DEFAULT (datetime('now')),
    last_seen      TEXT DEFAULT (datetime('now')),
    raw_json       TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_listings_fp ON listings(fingerprint);
  CREATE INDEX IF NOT EXISTS idx_listings_group ON listings(group_id);
  CREATE INDEX IF NOT EXISTS idx_listings_city ON listings(city);
  CREATE INDEX IF NOT EXISTS idx_listings_type ON listings(property_type);
  CREATE INDEX IF NOT EXISTS idx_listings_ai ON listings(ai_done, pre_score);

  CREATE TABLE IF NOT EXISTS price_history (
    uid        TEXT,
    price_usd  REAL,
    seen_at    TEXT DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_ph_uid ON price_history(uid);

  CREATE TABLE IF NOT EXISTS runs (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    started_at TEXT DEFAULT (datetime('now')),
    source     TEXT,
    found      INTEGER,
    new        INTEGER,
    errors     TEXT
  );
  `);
  log.debug('db: міграції застосовано');
}

const COLS = [
  'uid', 'source', 'source_id', 'url', 'title', 'description', 'property_type', 'purpose', 'land_use',
  'price_orig', 'currency_orig', 'price_usd', 'price_uah', 'price_per_sqm', 'area_sqm', 'land_sotka',
  'rooms', 'floor', 'floors', 'year_built', 'wall_type', 'city', 'district', 'street', 'lat', 'lng',
  'photos_json', 'is_auction', 'auction_ends', 'published_at', 'fingerprint', 'pre_score', 'raw_json',
];

function toRow(l) {
  return {
    uid: l.uid, source: l.source, source_id: String(l.sourceId), url: l.url || null,
    title: l.title || null, description: l.description || null, property_type: l.propertyType || null,
    purpose: l.purpose || null, land_use: l.landUse || null,
    price_orig: l.priceOrig ?? null, currency_orig: l.currencyOrig || null,
    price_usd: l.priceUSD ?? null, price_uah: l.priceUAH ?? null, price_per_sqm: l.pricePerSqmUSD ?? null,
    area_sqm: l.areaSqm ?? null, land_sotka: l.landSotka ?? null, rooms: l.rooms ?? null,
    floor: l.floor ?? null, floors: l.floors ?? null, year_built: l.yearBuilt ?? null, wall_type: l.wallType || null,
    city: l.city || null, district: l.district || null, street: l.street || null, lat: l.lat ?? null, lng: l.lng ?? null,
    photos_json: JSON.stringify(l.photos || []), is_auction: l.isAuction ? 1 : 0, auction_ends: l.auctionEndsAt || null,
    published_at: l.publishedAt || null, fingerprint: l.fingerprint || null, pre_score: l.preScore ?? null,
    raw_json: l.raw ? JSON.stringify(l.raw).slice(0, 60000) : null,
  };
}

/** Upsert. Повертає { isNew, priceDropped, oldPrice } */
export function upsertListing(l) {
  const d = getDb();
  const row = toRow(l);
  const existing = d.prepare('SELECT uid, price_usd FROM listings WHERE uid = ?').get(row.uid);

  if (!existing) {
    const placeholders = COLS.map((c) => '@' + c).join(', ');
    d.prepare(`INSERT INTO listings (${COLS.join(', ')}) VALUES (${placeholders})`).run(row);
    d.prepare('INSERT INTO price_history (uid, price_usd) VALUES (?, ?)').run(row.uid, row.price_usd);
    return { isNew: true, priceDropped: false, oldPrice: null };
  }

  const oldPrice = existing.price_usd;
  const priceDropped = oldPrice != null && row.price_usd != null && row.price_usd < oldPrice;
  const upd = {
    uid: row.uid, url: row.url, title: row.title, description: row.description,
    property_type: row.property_type, purpose: row.purpose, land_use: row.land_use,
    price_orig: row.price_orig, currency_orig: row.currency_orig, price_usd: row.price_usd,
    price_uah: row.price_uah, price_per_sqm: row.price_per_sqm, photos_json: row.photos_json,
    auction_ends: row.auction_ends, pre_score: row.pre_score,
  };
  d.prepare(`UPDATE listings SET
      url=@url, title=@title, description=@description, property_type=@property_type, purpose=@purpose, land_use=@land_use,
      price_orig=@price_orig, currency_orig=@currency_orig,
      price_usd=@price_usd, price_uah=@price_uah, price_per_sqm=@price_per_sqm, photos_json=@photos_json,
      auction_ends=@auction_ends, pre_score=@pre_score, last_seen=datetime('now'), status='active'
      WHERE uid=@uid`).run(upd);
  if (row.price_usd != null && row.price_usd !== oldPrice) {
    d.prepare('INSERT INTO price_history (uid, price_usd) VALUES (?, ?)').run(row.uid, row.price_usd);
  }
  return { isNew: false, priceDropped, oldPrice };
}

export function setGroup(uid, groupId) {
  getDb().prepare('UPDATE listings SET group_id=? WHERE uid=?').run(groupId, uid);
}

export function setAiResult(uid, { score, verdict, flags }) {
  getDb().prepare('UPDATE listings SET ai_score=?, ai_verdict=?, ai_flags_json=?, ai_done=1 WHERE uid=?')
    .run(score, verdict, JSON.stringify(flags || []), uid);
}

export function markNotified(uid) {
  getDb().prepare('UPDATE listings SET notified=1 WHERE uid=?').run(uid);
}

/** Позначає сповіщеними усіх членів групи (щоб дублі/альтернативи не пішли окремим повідомленням пізніше) */
export function markGroupNotified(groupId) {
  if (!groupId) return;
  getDb().prepare(`UPDATE listings SET notified=1 WHERE group_id=? AND status='active'`).run(groupId);
}

/** Кандидати для оцінки ШІ: не оцінені, pre_score >= поріг */
export function listForAi(minPreScore, limit) {
  return getDb().prepare(
    `SELECT * FROM listings WHERE ai_done=0 AND status='active' AND (pre_score IS NULL OR pre_score >= ?)
     ORDER BY pre_score DESC LIMIT ?`
  ).all(minPreScore, limit).map(fromRow);
}

/** Кандидати на сповіщення: оцінені, не сповіщені, ai_score >= поріг */
export function listForNotify(minAiScore) {
  return getDb().prepare(
    `SELECT * FROM listings WHERE ai_done=1 AND notified=0 AND status='active' AND ai_score >= ?
     ORDER BY ai_score DESC`
  ).all(minAiScore).map(fromRow);
}

/** Медіана ціни за м² по місту+типу (для pre-score) */
export function medianPricePerSqm(city, propertyType) {
  const rows = getDb().prepare(
    `SELECT price_per_sqm FROM listings WHERE city=? AND property_type=? AND price_per_sqm > 0 ORDER BY price_per_sqm`
  ).all(city, propertyType);
  if (!rows.length) return null;
  return rows[Math.floor(rows.length / 2)].price_per_sqm;
}

export function recentUnenriched() {
  return getDb().prepare(`SELECT fingerprint, uid, city, property_type, area_sqm, rooms, price_usd, district, street, lat, lng
                          FROM listings WHERE status='active'`).all();
}

export function fromRow(r) {
  return {
    uid: r.uid, source: r.source, sourceId: r.source_id, url: r.url, title: r.title, description: r.description,
    propertyType: r.property_type, purpose: r.purpose, landUse: r.land_use, priceOrig: r.price_orig,
    currencyOrig: r.currency_orig, priceUSD: r.price_usd, priceUAH: r.price_uah, pricePerSqmUSD: r.price_per_sqm,
    areaSqm: r.area_sqm, landSotka: r.land_sotka, rooms: r.rooms, floor: r.floor, floors: r.floors,
    yearBuilt: r.year_built, wallType: r.wall_type, city: r.city, district: r.district, street: r.street,
    lat: r.lat, lng: r.lng, photos: safeJson(r.photos_json, []), isAuction: !!r.is_auction, auctionEndsAt: r.auction_ends,
    publishedAt: r.published_at, fingerprint: r.fingerprint, groupId: r.group_id, preScore: r.pre_score,
    aiScore: r.ai_score, aiVerdict: r.ai_verdict, aiFlags: safeJson(r.ai_flags_json, []), aiDone: !!r.ai_done,
    notified: !!r.notified, status: r.status, firstSeen: r.first_seen, lastSeen: r.last_seen,
  };
}
function safeJson(s, d) { try { return s ? JSON.parse(s) : d; } catch { return d; } }

export function recordRun(source, found, nw, errors) {
  getDb().prepare('INSERT INTO runs (source, found, new, errors) VALUES (?,?,?,?)')
    .run(source, found, nw, errors ? String(errors).slice(0, 1000) : null);
}
