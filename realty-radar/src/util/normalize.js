// Нормалізація оголошень до єдиної схеми + утиліти для дедуплікації/фільтрів.
import crypto from 'node:crypto';

/**
 * Єдина схема Listing (те, що зберігаємо в БД):
 * {
 *   uid, source, sourceId, url, title, description,
 *   propertyType, purpose, landUse,
 *   priceOrig, currencyOrig, priceUSD, priceUAH, pricePerSqmUSD,
 *   areaSqm, landSotka, rooms, floor, floors, yearBuilt, wallType,
 *   city, district, street, lat, lng,
 *   photos: [url], publishedAt, isAuction, auctionEndsAt,
 *   raw: {...}  // сире джерело
 * }
 */

export function toUSD(price, currency, usdToUah) {
  if (price == null) return null;
  const c = String(currency || '').toUpperCase();
  if (c === 'USD' || c === '$' || c === 'ДОЛ' || c === 'ДОЛАР') return round(price);
  if (c === 'EUR' || c === '€') return round(price * 1.08);
  if (c === 'UAH' || c === 'ГРН' || c === '₴') return round(price / usdToUah);
  // невідома валюта — припускаємо, що велике число = грн
  if (price > 3000 && usdToUah) return round(price / usdToUah);
  return round(price);
}

export function toUAH(price, currency, usdToUah) {
  const usd = toUSD(price, currency, usdToUah);
  return usd == null ? null : round(usd * usdToUah);
}

function round(n) { return n == null ? null : Math.round(n); }

// Визначення типу нерухомості з довільного тексту/категорії
export function inferPropertyType(text = '') {
  const t = String(text).toLowerCase();
  if (/земель|ділянк|участок|сотк|\bземл/.test(t)) return 'land';
  if (/офіс|магазин|склад|комерц|приміщенн|фасад|виробнич|готель|ресторан|кафе/.test(t)) return 'commercial';
  if (/будин|дом\b|котедж|таунхаус|дача|півбудин|part of house|особняк/.test(t)) return 'house';
  if (/кімнат|комнат\b/.test(t)) return 'room';
  if (/гараж|паркомісц|машиномісц/.test(t)) return 'garage';
  if (/квартир|kvartir|апартамент|студі/.test(t)) return 'apartment';
  return 'unknown';
}

// Призначення: житлове / комерційне
export function inferPurpose(propertyType, text = '') {
  if (propertyType === 'commercial' || propertyType === 'garage') return 'commercial';
  const t = String(text).toLowerCase();
  if (/комерц|під бізнес|офіс|магазин/.test(t)) return 'commercial';
  return 'residential';
}

// Призначення землі (щоб відсіяти с/г). Повертає 'agricultural' | 'residential' | 'commercial' | 'unknown'
export function inferLandUse(text = '') {
  const t = String(text).toLowerCase();
  if (/сільськогосп|с\/г|для ведення особистого селянського|осг\b|товарного сільськ|рілл|пай\b|город|садівництв|фермер|аграр|вирощуванн|пасовищ|сіножат/.test(t)) return 'agricultural';
  if (/під забудову|для будівництва.*житлов|індивідуального житлового|огородництв.*житл|присадибн/.test(t)) return 'residential';
  if (/комерц|під бізнес|для будівництва.*комерц/.test(t)) return 'commercial';
  return 'unknown';
}

const STOP = new Set(['вул', 'вулиця', 'ул', 'улица', 'пров', 'провулок', 'просп', 'проспект', 'м', 'місто', 'обл', 'область', 'р-н', 'район', 'street', 'st']);

// Токенізація адреси для порівняння
export function addressTokens(...parts) {
  const s = parts.filter(Boolean).join(' ').toLowerCase();
  return s
    .replace(/[.,№#]/g, ' ')
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w && w.length > 1 && !STOP.has(w));
}

// Сходство Жаккара по токенах адреси (0..1)
export function tokenSimilarity(aTokens, bTokens) {
  if (!aTokens.length || !bTokens.length) return 0;
  const a = new Set(aTokens), b = new Set(bTokens);
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

// Стабільний uid для оголошення (щоб не дублювати те саме з одного джерела)
export function makeUid(source, sourceId) {
  return crypto.createHash('sha1').update(`${source}:${sourceId}`).digest('hex').slice(0, 16);
}

// "Відбиток" об'єкта для швидкого групування ймовірних дублів між джерелами
export function fingerprint(listing) {
  const area = listing.areaSqm ? Math.round(listing.areaSqm) : (listing.landSotka ? `L${Math.round(listing.landSotka)}` : 'x');
  const rooms = listing.rooms ?? 'x';
  const city = (listing.city || '').toLowerCase().slice(0, 12);
  const priceBucket = listing.priceUSD ? Math.round(listing.priceUSD / 1000) : 'x';
  return `${city}|${listing.propertyType}|${rooms}|${area}|~${priceBucket}k`;
}

// Приведення сирого числа ціни (може містити пробіли/символи)
export function parseNumber(v) {
  if (v == null) return null;
  if (typeof v === 'number') return v;
  const n = String(v).replace(/[^\d.,]/g, '').replace(/\s/g, '').replace(',', '.');
  const f = parseFloat(n);
  return Number.isFinite(f) ? f : null;
}

// Фінальне збагачення: рахуємо похідні поля
export function enrich(listing, usdToUah) {
  listing.priceUSD = listing.priceUSD ?? toUSD(listing.priceOrig, listing.currencyOrig, usdToUah);
  listing.priceUAH = listing.priceUAH ?? toUAH(listing.priceOrig, listing.currencyOrig, usdToUah);
  if (listing.priceUSD && listing.areaSqm) listing.pricePerSqmUSD = round(listing.priceUSD / listing.areaSqm);
  if (!listing.propertyType || listing.propertyType === 'unknown') {
    listing.propertyType = inferPropertyType(`${listing.title} ${listing.description} ${listing.rawCategory || ''}`);
  }
  if (!listing.purpose) listing.purpose = inferPurpose(listing.propertyType, `${listing.title} ${listing.description}`);
  if (listing.propertyType === 'land' && !listing.landUse) {
    listing.landUse = inferLandUse(`${listing.title} ${listing.description}`);
  }
  listing.uid = listing.uid || makeUid(listing.source, listing.sourceId);
  listing.fingerprint = fingerprint(listing);
  return listing;
}
