// Prozorro.Sale — відкрите API аукціонів (без ключа).
// Стрічка змінених процедур: GET {BASE}/api/search/byDateModified/{ISODATE}?limit=100
// Деталі процедури:          GET {BASE}/api/procedures/{id}
// Публічна сторінка:         https://prozorro.sale/auction/{id}
// Документація: https://confluence-sale.prozorro.org (Відкриті дані Prozorro.Sale).
// Ендпоінти можна перевизначити у config.sources.prozorro.baseUrl якщо зміняться.
import { politeFetch } from '../util/http.js';
import { parseNumber, inferPropertyType, inferLandUse } from '../util/normalize.js';

const DEFAULT_BASE = 'https://procedure.prozorro.sale';

// Чи схоже на нерухомість, яка нас цікавить (не с/г земля, не авто/техніка/ОВДП тощо)
function relevantItem(text) {
  const t = text.toLowerCase();
  const realty = /нерухом|будівл|будинок|квартир|приміщенн|офіс|споруд|земельн|ділянк|котедж|таунхаус|магазин|склад/.test(t);
  return realty;
}

function daysAgoISO(days) {
  const d = new Date(Date.now() - days * 86400000);
  return d.toISOString();
}

function normalize(proc, cfg) {
  const data = proc?.data || proc;
  if (!data) return null;
  const items = data.items || [];
  const itemsText = items.map((i) => `${i.description || ''} ${i.classification?.description || ''}`).join(' | ');
  const title = data.title || items[0]?.description || 'Аукціон Prozorro';
  const fullText = `${title} ${data.description || ''} ${itemsText}`;
  if (!relevantItem(fullText)) return null;

  const propertyType = inferPropertyType(fullText);
  // відсіюємо с/г землю ще на рівні джерела
  if (propertyType === 'land' && inferLandUse(fullText) === 'agricultural') return null;

  const val = data.value || data.currentTenderAmount || data.startingPrice || {};
  const price = parseNumber(val.amount ?? val.value);
  const currency = val.currency || 'UAH';

  const addr = items[0]?.address || data.procuringEntity?.address || {};
  const region = addr.region || addr.locality || '';
  // фільтр по регіону (якщо задано у місті)
  const wantRegion = cfg._currentCity?.prozorroRegion;
  if (wantRegion && region && !region.toLowerCase().includes(String(wantRegion).toLowerCase().replace(' область', ''))) {
    // не той регіон — пропускаємо
    return null;
  }

  const auctionId = data.auctionId || data.id || proc.id;
  const period = data.auctionPeriod || data.enquiryPeriod || {};

  return {
    source: 'prozorro',
    sourceId: String(auctionId),
    url: `https://prozorro.sale/auction/${auctionId}`,
    title: String(title).slice(0, 140),
    description: `${data.description || ''}\n${itemsText}`.trim(),
    priceOrig: price,
    currencyOrig: currency,
    areaSqm: parseNumber(items.find((i) => /кв.?м|м2|квадрат/i.test(i.unit?.name || ''))?.quantity),
    rooms: null,
    city: addr.locality || region || wantRegion || null,
    district: addr.streetAddress || null,
    street: addr.streetAddress || null,
    propertyType,
    purpose: /офіс|магазин|склад|комерц|приміщенн/.test(fullText.toLowerCase()) ? 'commercial' : 'residential',
    photos: [], // Prozorro зазвичай має документи, не фото
    publishedAt: data.datePublished || data.date || null,
    isAuction: true,
    auctionEndsAt: period.endDate || period.startDate || null,
    rawCategory: items[0]?.classification?.description || '',
    raw: { auctionId, status: data.status },
  };
}

export const name = 'prozorro';
export function enabled(cfg) { return !!cfg.sources?.prozorro?.enabled; }

// Prozorro не ділиться по містах у стрічці — тягнемо один раз за прогін, фільтруємо по регіонах усіх міст.
let ranThisCycle = false;
export function resetCycle() { ranThisCycle = false; }

export async function* collect(cfg, ctx) {
  const { log, city } = ctx;
  // збираємо лише один раз за цикл (на першому місті), далі фільтруємо локально нижче по конфігу
  if (ranThisCycle) return;
  ranThisCycle = true;

  const base = cfg.sources.prozorro.baseUrl || DEFAULT_BASE;
  const lookback = cfg.sources.prozorro.lookbackDays ?? 3;
  const maxPages = cfg.sources.prozorro.maxPagesPerRun ?? 5;
  const regions = cfg.cities.map((c) => c.prozorroRegion).filter(Boolean);

  let cursor = daysAgoISO(lookback);
  for (let page = 0; page < maxPages; page++) {
    let feed;
    try {
      const url = `${base}/api/search/byDateModified/${encodeURIComponent(cursor)}?limit=100`;
      feed = await politeFetch(url, { expect: 'json', referer: 'https://prozorro.sale/' });
    } catch (e) { log.warn(`prozorro feed p=${page}: ${e.message}`); break; }

    const items = feed.items || feed.data || [];
    if (!items.length) break;

    for (const it of items) {
      const id = it.id || it.auctionId;
      if (!id) continue;
      try {
        const proc = await politeFetch(`${base}/api/procedures/${id}`, { expect: 'json', referer: 'https://prozorro.sale/' });
        // прокидуємо контекст регіонів для фільтра
        const wantAny = regions.length ? { prozorroRegion: null } : null;
        cfg._currentCity = wantAny; // null-region -> без гео-фільтру всередині, робимо нижче
        const l = normalize(proc, cfg);
        if (!l) continue;
        // якщо задані регіони — лишаємо тільки ті, що потрапляють у міста
        if (regions.length) {
          const inRegion = regions.some((r) => (l.city || '').toLowerCase().includes(String(r).toLowerCase().replace(' область', '')) )
            || cfg.cities.some((c) => (l.city || '').toLowerCase().includes(c.name.toLowerCase()));
          if (!inRegion) continue;
        }
        yield l;
      } catch (e) { log.debug(`prozorro proc ${id}: ${e.message}`); }
    }
    const last = items[items.length - 1];
    const lastDate = last.dateModified || last.date;
    if (!lastDate) break;
    cursor = new Date(new Date(lastDate).getTime() + 1).toISOString();
  }
}
