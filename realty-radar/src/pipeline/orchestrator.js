// Головний конвеєр: збір -> нормалізація -> фільтри -> pre-score -> збереження
//                    -> дедуплікація -> оцінка ШІ -> сповіщення.
import { enabledSources, prozorro } from '../sources/index.js';
import { enrich } from '../util/normalize.js';
import { passesFilters, preScore } from '../util/filters.js';
import { upsertListing, medianPricePerSqm, recordRun } from '../db/db.js';
import { regroupAll } from '../util/dedup.js';
import { runEvaluation } from '../ai/evaluate.js';
import { notifyPending, sendText } from '../notify/telegram.js';
import { fetchNbuRate } from '../util/rate.js';
import log from '../logger.js';

async function collectSourceForCity(source, cfg, city) {
  const ctx = { log: log.child(`${source.name}:${city.name}`), city };
  let found = 0, saved = 0, dropped = 0;
  let iterator;
  try { iterator = source.collect(cfg, ctx); }
  catch (e) { log.warn(`${source.name}/${city.name} collect: ${e.message}`); return { found, saved }; }

  for await (const rawItem of iterator) {
    found++;
    const l = enrich(rawItem, cfg.currency.usdToUah);
    const { pass, reasons } = passesFilters(l, cfg, city);
    if (!pass) { dropped++; log.debug(`skip ${l.source}/${l.sourceId}: ${reasons.join(', ')}`); continue; }
    l.preScore = preScore(l, cfg, medianPricePerSqm(l.city, l.propertyType));
    const { isNew, priceDropped, oldPrice } = upsertListing(l);
    saved++;
    if (isNew) log.info(`+ ${l.source} ${l.city} ${l.propertyType} $${l.priceUSD} (pre ${l.preScore}) — ${(l.title || '').slice(0, 50)}`);
    if (priceDropped) {
      const dropPct = ((oldPrice - l.priceUSD) / oldPrice) * 100;
      if (dropPct >= (cfg.notify?.alsoNotifyPriceDropPct ?? 5)) {
        log.info(`↓ ціна впала на ${dropPct.toFixed(1)}%: ${l.url}`);
      }
    }
  }
  log.debug(`${source.name}/${city.name}: знайдено ${found}, збережено ${saved}, відсіяно ${dropped}`);
  return { found, saved };
}

/** Один повний прогін збору по всіх джерелах і містах. */
export async function collectAll(cfg) {
  const sources = enabledSources(cfg);
  log.info(`Збір: джерела [${sources.map((s) => s.name).join(', ')}], міст ${cfg.cities.length}`);
  if (typeof prozorro.resetCycle === 'function') prozorro.resetCycle();

  // онови курс USD/UAH з НБУ (за бажанням)
  if (cfg.currency?.autoRateFromNBU) {
    const r = await fetchNbuRate().catch(() => null);
    if (r) { cfg.currency.usdToUah = r; log.info(`Курс НБУ USD/UAH = ${r}`); }
  }

  const totals = {};
  for (const source of sources) {
    let found = 0, saved = 0;
    for (const city of cfg.cities) {
      const r = await collectSourceForCity(source, cfg, city);
      found += r.found; saved += r.saved;
    }
    totals[source.name] = { found, saved };
    recordRun(source.name, found, saved, null);
  }

  // дедуплікація між джерелами
  regroupAll(cfg);

  log.info('Збір завершено: ' + Object.entries(totals).map(([k, v]) => `${k}=${v.saved}/${v.found}`).join(' '));
  return totals;
}

/** Повний цикл: збір -> оцінка ШІ -> сповіщення. */
export async function runCycle(cfg, { notify = true } = {}) {
  const t0 = Date.now();
  try {
    await collectAll(cfg);
    await runEvaluation(cfg);
    if (notify) {
      const res = await notifyPending(cfg);
      if (res.sent) log.info(`Надіслано ${res.sent} сповіщень`);
    }
  } catch (e) {
    log.error(`Цикл впав: ${e.stack || e.message}`);
    try { if (cfg.notify?.telegram?.enabled) await sendText(cfg, `⚠️ Помилка циклу: ${e.message}`); } catch { /* ignore */ }
  }
  log.info(`Цикл завершено за ${((Date.now() - t0) / 1000).toFixed(0)}s`);
}
