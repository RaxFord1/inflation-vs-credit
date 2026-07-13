// Перевіряє, що OLX-URL коректно резолвиться у параметри пошуку та повертає оголошення.
// Використання: node scripts/olx-discover.js "https://www.olx.ua/uk/nedvizhimost/kvartiry/prodazha-kvartir/lvov/"
import { loadConfig } from '../src/config.js';
import { politeFetch, initHttp } from '../src/util/http.js';

const cfg = loadConfig();
initHttp(cfg.politeness);
const url = process.argv[2];
if (!url) { console.error('Дай URL пошуку OLX'); process.exit(1); }

const path = new URL(url).pathname.replace(/^\/+/, '');
console.log('friendly-links path:', path);
try {
  const fl = await politeFetch(`https://www.olx.ua/api/v1/friendly-links/query-params/${path}`, { expect: 'json', referer: url });
  console.log('params:', JSON.stringify(fl?.data?.params ?? fl?.params ?? fl, null, 1).slice(0, 800));
} catch (e) { console.log('friendly-links помилка:', e.message); }

try {
  const offers = await politeFetch(`https://www.olx.ua/api/v1/offers/?offset=0&limit=5`, { expect: 'json', referer: url });
  console.log(`\nПерші оголошення (без фільтрів): ${(offers.data || []).length}`);
  for (const o of (offers.data || []).slice(0, 3)) console.log(' •', o.title, '—', o.url);
} catch (e) { console.log('offers помилка:', e.message); }
