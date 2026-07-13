// LUN.ua / Rieltor.ua та інші агрегатори — офіційного API нема, тож акуратний скрапінг HTML.
// Стратегія (найстійкіша до змін верстки): спершу шукаємо структуровані дані
//   1) __NEXT_DATA__ (Next.js) або window.__DATA__
//   2) JSON-LD (<script type="application/ld+json"> з @type Product/Offer/RealEstateListing)
//   3) як запасний варіант — картки через cheerio-евристику
// Вимкнено за замовчуванням (sources.lun.enabled=false), бо навантаження/ризик вищі.
import * as cheerio from 'cheerio';
import { politeFetch } from '../util/http.js';
import { parseNumber, inferPropertyType } from '../util/normalize.js';

function extractJsonLd($) {
  const out = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const json = JSON.parse($(el).contents().text());
      const arr = Array.isArray(json) ? json : (json['@graph'] || [json]);
      for (const node of arr) {
        const type = String(node['@type'] || '').toLowerCase();
        if (/product|offer|apartment|house|realestate|residence|place/.test(type)) out.push(node);
      }
    } catch { /* ignore */ }
  });
  return out;
}

function fromJsonLd(node, url, city) {
  const offer = node.offers || node;
  const price = parseNumber(offer.price ?? offer.lowPrice);
  const currency = offer.priceCurrency || 'USD';
  const name = node.name || node.title || '';
  const images = [].concat(node.image || []).map((im) => (typeof im === 'string' ? im : im.url)).filter(Boolean);
  const link = node.url || offer.url || url;
  const id = link.replace(/\/+$/, '').split('/').pop();
  return {
    source: 'lun',
    sourceId: String(id || name).slice(0, 40),
    url: link,
    title: name.slice(0, 140),
    description: node.description || '',
    priceOrig: price,
    currencyOrig: currency,
    areaSqm: parseNumber(node.floorSize?.value ?? node.floorSize),
    rooms: parseNumber(node.numberOfRooms),
    city: node.address?.addressLocality || city.name,
    district: node.address?.addressRegion || null,
    street: node.address?.streetAddress || null,
    lat: parseNumber(node.geo?.latitude),
    lng: parseNumber(node.geo?.longitude),
    photos: images.slice(0, 4),
    publishedAt: node.datePosted || null,
    rawCategory: node['@type'] || '',
    propertyType: inferPropertyType(`${name} ${node['@type'] || ''}`),
    isAuction: false,
    raw: {},
  };
}

function extractNextData($) {
  const el = $('#__NEXT_DATA__');
  if (!el.length) return null;
  try { return JSON.parse(el.contents().text()); } catch { return null; }
}

// Глибокий пошук масивів об'єктів, схожих на оголошення, у довільному JSON
function harvestListings(obj, acc = [], depth = 0) {
  if (!obj || depth > 8) return acc;
  if (Array.isArray(obj)) {
    for (const x of obj) harvestListings(x, acc, depth + 1);
  } else if (typeof obj === 'object') {
    const keys = Object.keys(obj);
    const looksLikeListing = keys.some((k) => /price/i.test(k)) && keys.some((k) => /(id|url|slug)/i.test(k));
    if (looksLikeListing) acc.push(obj);
    for (const k of keys) harvestListings(obj[k], acc, depth + 1);
  }
  return acc;
}

export const name = 'lun';
export function enabled(cfg) { return !!cfg.sources?.lun?.enabled; }

export async function* collect(cfg, ctx) {
  const { city, log } = ctx;
  const urls = city.lunUrls || [];
  const maxPages = cfg.sources.lun.maxPagesPerUrl ?? 2;

  for (const baseUrl of urls) {
    for (let page = 1; page <= maxPages; page++) {
      const url = page === 1 ? baseUrl : `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}page=${page}`;
      let html;
      try { html = await politeFetch(url, { expect: 'text', referer: 'https://lun.ua/' }); }
      catch (e) { log.warn(`lun ${city.name} p=${page}: ${e.message}`); break; }
      const $ = cheerio.load(html);

      // 1) JSON-LD
      const ld = extractJsonLd($);
      let count = 0;
      for (const node of ld) {
        const l = fromJsonLd(node, url, city);
        if (l.priceOrig) { yield l; count++; }
      }

      // 2) __NEXT_DATA__ — глибокий збір
      if (count === 0) {
        const nd = extractNextData($);
        if (nd) {
          const cands = harvestListings(nd).slice(0, 60);
          for (const c of cands) {
            const price = parseNumber(c.price ?? c.priceUsd ?? c.price_usd);
            if (!price) continue;
            const id = c.id || c.slug || c.url;
            if (!id) continue;
            yield {
              source: 'lun', sourceId: String(id), url: c.url ? (c.url.startsWith('http') ? c.url : `https://lun.ua${c.url}`) : url,
              title: (c.title || c.name || '').slice(0, 140), description: c.description || '',
              priceOrig: price, currencyOrig: c.currency || (c.priceUsd ? 'USD' : 'UAH'),
              areaSqm: parseNumber(c.area ?? c.totalArea), rooms: parseNumber(c.rooms ?? c.roomCount),
              city: c.city || city.name, district: c.district || null, street: c.address || null,
              lat: parseNumber(c.lat), lng: parseNumber(c.lng),
              photos: [].concat(c.images || c.photos || []).map((x) => (typeof x === 'string' ? x : x.url)).filter(Boolean).slice(0, 4),
              publishedAt: c.createdAt || c.date || null, rawCategory: '', isAuction: false, raw: {},
            };
            count++;
          }
        }
      }
      log.debug(`lun ${city.name} p=${page}: ${count} оголошень`);
      if (count === 0) break;
    }
  }
}
