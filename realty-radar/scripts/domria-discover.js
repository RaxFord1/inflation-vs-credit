// Допомога у налаштуванні: друкує state_id/city_id для DOM.RIA.
// Використання:
//   node scripts/domria-discover.js            -> список областей (state_id)
//   node scripts/domria-discover.js <stateId>  -> міста цієї області (city_id)
import { loadConfig } from '../src/config.js';
import { politeFetch, initHttp } from '../src/util/http.js';

const cfg = loadConfig();
initHttp(cfg.politeness);
const key = cfg.secrets.domriaKey;
if (!key) { console.error('Нема DOMRIA_API_KEY у .env'); process.exit(1); }

const stateId = process.argv[2];
const base = 'https://developers.ria.com';

const url = stateId
  ? `${base}/dom/cities/${stateId}?lang_id=4&api_key=${key}`
  : `${base}/dom/states?lang_id=4&api_key=${key}`;

const data = await politeFetch(url, { expect: 'json', referer: 'https://dom.ria.com/' });
const rows = Array.isArray(data) ? data : (data.items || Object.values(data));
for (const r of rows) {
  if (stateId) console.log(`city_id=${r.cityID ?? r.value ?? r.id}\t${r.name ?? r.eng}`);
  else console.log(`state_id=${r.stateID ?? r.value ?? r.id}\t${r.name ?? r.eng_name}`);
}
console.log(stateId ? '\nДодай city_id у config.json -> cities[].domria.city_id' : '\nДалі: node scripts/domria-discover.js <state_id>');
