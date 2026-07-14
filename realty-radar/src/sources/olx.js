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
    const out = normalizeParams(p);
    if ([...out.keys()].length) return out;
  } catch (e) {
    log.warn(`olx friendly-links: ${e.message} — пробую видобути параметри зі сторінки`);
  }
  return resolveParamsFromHtml(url, log);
}

// Фолбек: friendly-links OLX прибрав (404) — тягнемо саму сторінку пошуку й
// видобуваємо category_id + region/city з пре-рендер стану. Якщо слаг міста
// неоднозначний (напр. "nikolaev" — це Миколаїв Львівської обл.), краще задати
// ідентифікатори явно у config: cities[].olx = [{category_id, region_id, city_id}].
async function resolveParamsFromHtml(url, log) {
  let html;
  try {
    html = await politeFetch(url, { expect: 'text', referer: HOST });
  } catch (e) {
    log.warn(`olx page ${url}: ${e.message}`);
    return null;
  }
  const cat = html.match(/category_id=(\d+)/);
  const city = html.match(/\\"city\\":\{\\"id\\":(\d+),\\"name\\":\\"([^"\\]+)/);
  const region = html.match(/\\"region\\":\{\\"id\\":(\d+),\\"name\\":\\"([^"\\]+)/);
  if (!cat) return null;
  const out = new URLSearchParams();
  out.set('category_id', cat[1]);
  if (region) out.set('region_id', region[1]);
  if (city) out.set('city_id', city[1]);
  log.info(`olx: ${url} -> category_id=${cat[1]}` +
    (region ? `, ${region[2]} (region_id=${region[1]})` : '') +
    (city ? `, ${city[2]} (city_id=${city[1]})` : ''));
  return out;
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
  const maxPages = cfg.sources.olx.maxPagesPerUrl ?? 3;
  const maxPhotos = cfg.ai?.maxPhotosPerListing ?? 4;
  const limit = 40;

  // Запити: явні ідентифікатори з config (cities[].olx) — надійно, або
  // legacy-URL пошуку (cities[].olxSearchUrls) — резолвимо через API/HTML.
  const queries = [];
  for (const q of city.olx || []) {
    if (!q.category_id) { log.warn('olx: запис у cities[].olx без category_id — пропускаю'); continue; }
    const params = new URLSearchParams();
    params.set('category_id', String(q.category_id));
    if (q.region_id != null) params.set('region_id', String(q.region_id));
    if (q.city_id != null) params.set('city_id', String(q.city_id));
    queries.push({ params, referer: HOST, label: q.label || `category ${q.category_id}` });
  }
  for (const url of city.olxSearchUrls || []) {
    const params = await resolveParams(url, log);
    // Без параметрів НЕ запитуємо: голий /offers/ повертає загальнонаціональну
    // стрічку всіх категорій (меблі, вакансії…) — саме звідси брався мотлох.
    if (!params) { log.warn(`olx: не зміг розпізнати параметри пошуку для ${url} — пропускаю (задай cities[].olx явно)`); continue; }
    queries.push({ params, referer: url, label: url });
  }

  // Ціновий фільтр на боці OLX (менше сторінок — менше запитів)
  const priceMax = city.priceUSD?.max ?? cfg.filters?.priceUSD?.max;
  const priceMin = city.priceUSD?.min ?? cfg.filters?.priceUSD?.min;

  for (const { params, referer, label } of queries) {
    for (let page = 0; page < maxPages; page++) {
      const q = new URLSearchParams(params.toString());
      if (priceMax != null) { q.set('currency', 'USD'); q.set('filter_float_price:to', String(priceMax)); }
      if (priceMin != null) { q.set('currency', 'USD'); q.set('filter_float_price:from', String(priceMin)); }
      q.set('sort_by', 'created_at:desc');
      q.set('offset', String(page * limit));
      q.set('limit', String(limit));
      let data;
      try {
        data = await politeFetch(`${HOST}/api/v1/offers/?${q.toString()}`, { expect: 'json', referer });
      } catch (e) { log.warn(`olx offers ${city.name} (${label}) p=${page}: ${e.message}`); break; }
      const offers = data?.data || [];
      if (!offers.length) break;
      log.debug(`olx ${city.name} (${label}) p=${page}: ${offers.length} оголошень`);
      for (const offer of offers) {
        try { yield normalizeOffer(offer, city, maxPhotos); }
        catch (e) { log.debug(`olx normalize: ${e.message}`); }
      }
      if (offers.length < limit) break;
    }
  }
}
