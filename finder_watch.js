#!/usr/bin/env node
/*
 * Config-driven car-finder runner for the recurring job.
 *
 *   node finder_watch.js <listings.json> [--search=<name|index>] [--config=finder_config.json]
 *
 * Reads finder_config.json, maps the chosen search onto cf_* params, runs the
 * pure findCars() engine over the supplied listings, prints a short human digest
 * (what to notify) followed by the machine JSON summary. No network here — the
 * scheduled agent fetches listings (AUTO.RIA) and writes them to <listings.json>
 * first; this file is the deterministic scoring/vetting step.
 *
 * Exit code 0 always (so the scheduler sees a clean run); errors print JSON.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const cf = require(path.join(__dirname, 'carfinder.js'));

function arg(name, def) {
  const hit = process.argv.slice(2).find((a) => a.startsWith('--' + name + '='));
  return hit ? hit.slice(name.length + 3) : def;
}

try {
  const listFile = process.argv.slice(2).find((a) => !a.startsWith('--'));
  if (!listFile) throw new Error('usage: node finder_watch.js <listings.json> [--search=<name|index>] [--config=path]');
  const cfgPath = arg('config', path.join(__dirname, 'finder_config.json'));
  const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  const listings = JSON.parse(fs.readFileSync(listFile, 'utf8'));
  if (!Array.isArray(listings)) throw new Error(listFile + ' must be a JSON array of listings');

  const sel = arg('search', '0');
  const searches = cfg.searches || [];
  const s = /^\d+$/.test(sel) ? searches[+sel] : searches.find((x) => x.name === sel);
  if (!s) throw new Error(`search "${sel}" not found in ${path.basename(cfgPath)}`);

  // map a search config onto cf_* params
  const w = s.weights || {};
  const p = {
    cf_make: s.make || '', cf_model: s.model || '',
    cf_yearMin: s.yearMin || 0, cf_yearMax: s.yearMax || 0,
    cf_priceMinUSD: s.priceMinUSD || 0, cf_priceMaxUSD: s.priceMaxUSD || 0,
    cf_mileageMaxKm: s.mileageMaxKm || 0,
    cf_region: s.region || 'any', cf_fuel: s.fuel || 'any', cf_gearbox: s.gearbox || 'any',
    cf_bodyType: s.bodyType || '',
    cf_allowDamaged: s.allowDamaged !== false,
    cf_allowDamageTypes: s.allowDamageTypes || 'front,rear',
    cf_useBuiltinRules: s.useBuiltinRules !== false,
    cf_rulesText: s.rulesText || '',
    cf_w_price: w.price != null ? w.price : 30, cf_w_mileage: w.mileage != null ? w.mileage : 20,
    cf_w_age: w.age != null ? w.age : 15, cf_w_condition: w.condition != null ? w.condition : 20,
    cf_w_history: w.history != null ? w.history : 15,
    cf_topN: (cfg.notify && cfg.notify.topN) || 5,
    cf_thisYear: new Date().getFullYear(), fx0: 45,
  };

  // strict pass = exactly the user's rules (built-ins on); relaxed pass = drop the
  // region gate so we can still rank the market when nothing passes strict.
  const strict = cf.findCars(p, listings);
  const relaxed = cf.findCars({ ...p, cf_region: 'any', cf_useBuiltinRules: false,
    cf_rulesText: (s.rulesText || '') + '\nreject: damageType in [flood, fire, structural, airbag]' }, listings);

  const n = cfg.notify || {};
  const digest = strict.results.length ? strict.results : relaxed.results.filter((e) => e.score >= (n.minScore || 60));
  const usd = (v) => '$' + new Intl.NumberFormat('en-US').format(Math.round(v));

  console.log(`# ${s.name}`);
  console.log(`сканировано ${strict.scanned}, прошло строгие правила ${strict.passed}, медиана ${usd(strict.marketStats.overall)}`);
  if (!strict.passed) console.log('чистых вариантов под строгие правила нет — ниже рейтинг рынка (флаги учтены):');
  (digest.length ? digest : relaxed.results.slice(0, n.topN || 5)).forEach((e, i) => {
    const c = e.checks;
    console.log(`${i + 1}. балл ${e.score} · ${e.listing.year} · ${usd(e.listing.priceUSD)} · ${new Intl.NumberFormat('uk-UA').format(e.listing.mileageKm)} км · ${e.listing.region}` +
      ` · vin:${c.vin.status} hist:${c.history.status} dmg:${c.damage.status}` +
      (e.flags.length ? ` · ⚠ ${e.flags.join('; ')}` : '') + (e.listing.url ? `\n   ${e.listing.url}` : ''));
  });
  if (strict.ruleErrors.length) console.log('ошибки в правилах:', strict.ruleErrors.join(' · '));

  console.log('\n---JSON---');
  console.log(JSON.stringify({ search: s.name, strict: cf.cfSummarize(strict), relaxedTop: relaxed.results.slice(0, n.topN || 5).map((e) => ({ title: e.listing.title, score: e.score, region: e.listing.region, priceUSD: e.listing.priceUSD, flags: e.flags, url: e.listing.url })) }, null, 2));
} catch (e) {
  console.log(JSON.stringify({ error: e.message }));
}
