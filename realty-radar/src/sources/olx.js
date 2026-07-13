// OLX.ua — офіційного read-API для чужих оголошень немає (нерухомість обмежена),
// тож використовуємо той самий JSON, що вантажить фронтенд OLX, з ввічливими заголовками.
//   1) SEO-URL -> параметри пошуку:  GET /api/v1/friendly-links/query-params/{path}
//   2) Список:                       GET /api/v1/offers/?<params>&offset=&limit=40
// Користувач задає звичайні URL пошуку OLX (з уже вибраними містом/фільтрами) у config.cities[].olxSearchUrls.
// Обережно: таймаути/ротація UA у util/http.js. За бажання — useBrowserFallback (playwright).
import { politeFetch } from '../util/http.js';
import { parseNumber } from '../util/normalize.js';

const HOST = 'https://www.olx.ua';

function pathFromUrl(u) {
  try { return new URL(u).pathname.replace(/^\/+/, ''); } catch { return null; }
}

async function resolveParams(url, log) {
  const path = pathFromUrl(url);
  if (!path) return null;
  try {
    const data = await politeFetch(`${HOST}/api/v1/friendly-links/query-params/${path}`, {
      expect: 'json', referer: url, headers: { 'x-device': 'desktop' },
    });
    // очікуємо { data: { params: {..} } } або { params: [...] }
    const p = data?.data?.params || data?.params || data?.data || {};
    return normalizeParams(p);
  } catch (e) {
    log.warn(`olx friendly-links: ${e.message} — пробую з голого URL`);
    return null;
  }
}

function normalizeParams(p) {
  const out = new URLSearchParams();
  if (Array.isArray(p)) {
    for (const kv of p) if (kv?.key != null) out.append(kv.key, kv.value);
  } else if (p && typeof p === 'object') {
    for (const [k, v] of Object.entries(p)) {
      if (v == null) continue;
      if (Array.isArray(v)) v.forEach((x) => out.append(k, x));
      else out.append(k, typeof v === 'object' ? (v.value ?? JSON.stringify(v)) : v);
    }
  }
  return out;
}

function paramVal(offer, keys) {
  const params = offer.params || [];
  for (const p of params) if (keys.includes(p.key)) return p;
  return null;
}

function buildPhotos(offer, max) {
  const photos = offer.photos || [];
  return photos.slice(0, max).map((ph) => {
    const link = ph.link || ph.url || '';
    return link.replace('{width}', '1000').replace('{height}', '750');
  }).filter(Boolean);
}

function normalizeOffer(offer, city, maxPhotos) {
  const priceP = paramVal(offer, ['price']);
  let priceOrig = null, currency = 'UAH';
  if (priceP?.value) {
    priceOrig = parseNumber(priceP.value.value ?? priceP.value.label);
    currency = priceP.value.currency || currency;
  }
  const areaP = paramVal(offer, ['total_area', 'area', 'm', 'plot_area']);
  const roomsP = paramVal(offer, ['number_of_rooms', 'rooms']);
  const floorP = paramVal(offer, ['floor']);
  const loc = offer.location || {};

  const title = `${offer.title || ''}`.toLowerCase();
  return {
    source: 'olx',
    sourceId: String(offer.id),
    url: offer.url,
    title: offer.title || 'OLX',
    description: offer.description || '',
    priceOrig,
    currencyOrig: currency,
    areaSqm: areaP ? parseNumber(areaP.value?.key ?? areaP.value?.label) : null,
    landSotka: /сотк|соток|ділянк/.test(title) ? parseNumber(paramVal(offer, ['plot_area'])?.value?.key) : null,
    rooms: roomsP ? parseNumber(roomsP.value?.label ?? roomsP.value?.key) : null,
    floor: floorP ? parseNumber(floorP.value?.key ?? floorP.value?.label) : null,
    city: loc.city?.name || city.name,
    district: loc.district?.name || null,
    street: null,
    lat: offer.map?.lat ?? null,
    lng: offer.map?.lon ?? null,
    photos: buildPhotos(offer, maxPhotos),
    publishedAt: offer.created_time || offer.last_refresh_time || null,
    rawCategory: offer.category?.type || '',
    isAuction: false,
    raw: { id: offer.id },
  };
}

export const name = 'olx';
export function enabled(cfg) { return !!cfg.sources?.olx?.enabled; }

export async function* collect(cfg, ctx) {
  const { city, log } = ctx;
  const urls = city.olxSearchUrls || [];
  const maxPages = cfg.sources.olx.maxPagesPerUrl ?? 3;
  const maxPhotos = cfg.ai?.maxPhotosPerListing ?? 4;
  const limit = 40;

  for (const url of urls) {
    const params = await resolveParams(url, log);
    for (let page = 0; page < maxPages; page++) {
      const q = new URLSearchParams(params ? params.toString() : '');
      q.set('offset', String(page * limit));
      q.set('limit', String(limit));
      let data;
      try {
        data = await politeFetch(`${HOST}/api/v1/offers/?${q.toString()}`, { expect: 'json', referer: url });
      } catch (e) { log.warn(`olx offers ${city.name} p=${page}: ${e.message}`); break; }
      const offers = data?.data || [];
      if (!offers.length) break;
      log.debug(`olx ${city.name} p=${page}: ${offers.length} оголошень`);
      for (const offer of offers) {
        try { yield normalizeOffer(offer, city, maxPhotos); }
        catch (e) { log.debug(`olx normalize: ${e.message}`); }
      }
      if (offers.length < limit) break;
    }
  }
}
