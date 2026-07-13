// DOM.RIA / DIM.RIA — офіційний REST API (developers.ria.com).
// Ключ безкоштовно на https://developers.ria.com/. Передається як ?api_key=.
// Базові ендпоінти (див. https://github.com/ria-com/auto-ria-rest-api DOM_RIA_API):
//   GET /dom/search?category=&operation_type=1&state_id=&city_id[]=&page=  -> { items:[ids], count }
//   GET /dom/info/{id}                                                     -> деталі + фото
// ВАЖЛИВО: структура info може трохи різнитись за версією API — парсимо захищено.
import { politeFetch } from '../util/http.js';
import { parseNumber } from '../util/normalize.js';
import { propertyTypeToDomriaCategory } from './base.js';

const BASE = 'https://developers.ria.com';
const CDN = 'https://cdn.riastatic.com/photos/';

function photoUrl(p) {
  if (!p) return null;
  const s = typeof p === 'string' ? p : (p.file || p.f || p.url || p.src || '');
  if (!s) return null;
  if (s.startsWith('http')) return s;
  return CDN + s.replace(/^\/+/, '');
}

async function searchIds(cfg, city, category, page) {
  const key = cfg.secrets.domriaKey;
  const q = new URLSearchParams();
  q.set('category', String(category));
  q.set('operation_type', String(cfg.sources.domria.operationType ?? 1)); // 1 = продаж
  if (city.domria?.state_id != null) q.set('state_id', String(city.domria.state_id));
  q.set('page', String(page));
  q.set('api_key', key);
  let url = `${BASE}/dom/search?${q.toString()}`;
  if (city.domria?.city_id != null) url += `&city_id[]=${city.domria.city_id}`;
  const data = await politeFetch(url, { expect: 'json', referer: 'https://dom.ria.com/' });
  // можливі форми відповіді: {items:[...], count} або {result:{search_result:{items:[...]}}}
  const items = data.items || data?.result?.search_result?.items || data?.search_result?.items || [];
  const count = data.count ?? data?.result?.search_result?.count ?? items.length;
  return { items, count };
}

async function fetchInfo(cfg, id) {
  const url = `${BASE}/dom/info/${id}?api_key=${cfg.secrets.domriaKey}&lang_id=4`;
  return politeFetch(url, { expect: 'json', referer: 'https://dom.ria.com/' });
}

function normalizeInfo(d, city) {
  if (!d || typeof d !== 'object') return null;
  const price = parseNumber(d.price ?? d.priceUAH ?? d.price_total);
  // currency: DOM.RIA часто дає price у USD в полі price + currency_type
  const currency = (d.currency_type || d.currency || (d.priceArr && Object.keys(d.priceArr)[0]) || 'USD');
  const photosSrc = d.photos || d.photo || d.mainphoto || [];
  let photos = [];
  if (Array.isArray(photosSrc)) photos = photosSrc.map(photoUrl).filter(Boolean);
  else if (photosSrc && typeof photosSrc === 'object') photos = Object.values(photosSrc).map(photoUrl).filter(Boolean);
  if (d.main_photo) photos.unshift(photoUrl(d.main_photo));

  const slug = d.beautiful_url || d.seo_url;
  const url = slug ? `https://dom.ria.com/uk/${String(slug).replace(/^\/+/, '')}` : `https://dom.ria.com/uk/realty-${d.realty_id || d.id}.html`;

  return {
    source: 'domria',
    sourceId: String(d.realty_id || d.id),
    url,
    title: d.description ? String(d.description).split('\n')[0].slice(0, 120) : (d.realty_type_name || 'DOM.RIA'),
    description: d.description || '',
    priceOrig: price,
    currencyOrig: currency,
    areaSqm: parseNumber(d.total_square_meters),
    landSotka: parseNumber(d.ground_area ?? d.plot_area),
    rooms: parseNumber(d.rooms_count),
    floor: parseNumber(d.floor),
    floors: parseNumber(d.floors_count),
    yearBuilt: parseNumber(d.build_year ?? d.year),
    wallType: d.wall_type || d.wall_type_name || null,
    city: d.city_name || city.name,
    district: d.district_name || null,
    street: d.street_name || null,
    lat: parseNumber(d.latitude),
    lng: parseNumber(d.longitude),
    photos: [...new Set(photos)],
    publishedAt: d.publishing_date || d.created_at || null,
    rawCategory: d.realty_type_name || d.category_name || '',
    isAuction: false,
    raw: { id: d.realty_id || d.id },
  };
}

export const name = 'domria';
export function enabled(cfg) { return cfg.sources?.domria?.enabled && !!cfg.secrets.domriaKey; }

export async function* collect(cfg, ctx) {
  const { city, log } = ctx;
  const types = cfg.filters.propertyTypes.map(propertyTypeToDomriaCategory).filter(Boolean);
  const categories = [...new Set(types)];
  const maxPages = cfg.sources.domria.maxPagesPerQuery ?? 3;

  for (const category of categories) {
    for (let page = 0; page < maxPages; page++) {
      let res;
      try { res = await searchIds(cfg, city, category, page); }
      catch (e) { log.warn(`domria search cat=${category} p=${page}: ${e.message}`); break; }
      if (!res.items?.length) break;
      log.debug(`domria ${city.name} cat=${category} p=${page}: ${res.items.length} id`);
      for (const id of res.items) {
        try {
          const info = await fetchInfo(cfg, id);
          const l = normalizeInfo(info, city);
          if (l) yield l;
        } catch (e) { log.debug(`domria info ${id}: ${e.message}`); }
      }
      if (res.items.length < 10) break; // остання сторінка
    }
  }
}
