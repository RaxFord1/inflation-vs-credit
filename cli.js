#!/usr/bin/env node
/*
 * Headless runner for LLMs and scripts — no browser, no build, no deps.
 *
 * Usage (three equivalent input forms):
 *   node cli.js <mode> [key=value ...] [--series]
 *   node cli.js '<json>'                     (see JSON shape below)
 *   echo '<json>' | node cli.js
 *
 * Modes: dep | car | home | mort | life | biz | solar
 *
 * JSON input shape:
 *   { "mode": "life",
 *     "overrides": { "savings": 20000, "horizonYears": 10 },   // optional
 *     "sweep": { "id": "savings", "values": [0, 10000, 40000] }, // optional
 *     "series": false }                                          // optional
 *
 * Output: a single JSON object on stdout — see summarizeResult in defaults.js
 * and LLM_API.md. With "sweep", output.sweep holds one summary per value.
 * Any parameter not overridden uses PARAM_DEFAULTS (also echoed back under
 * .assumptions). Exit code 1 with {"error": ...} on bad input.
 */

'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// load the browser scripts into one shared context, like <script> tags do
const ctx = vm.createContext({ console });
for (const f of ['engine.js', 'decisions.js', 'defaults.js', 'dep.js',
  'car.js', 'home.js', 'mort.js', 'life.js', 'business.js', 'solar.js', 'carfinder.js']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, f), 'utf8'), ctx, { filename: f });
}
// top-level const/function bindings live in the context's lexical scope,
// so pull the handles out with an in-context expression
const { PARAM_DEFAULTS, summarizeResult, depSim, carSim, homeSim, mortSim, lifeSim, bizSim,
  solarSim, findCars, findCarsLive, cfSummarize, CF_SAMPLE_LISTINGS } =
  vm.runInContext('({ PARAM_DEFAULTS, summarizeResult, depSim, carSim, homeSim, mortSim, lifeSim, bizSim,' +
    ' solarSim, findCars, findCarsLive, cfSummarize, CF_SAMPLE_LISTINGS })', ctx);
const SIMS = { dep: depSim, car: carSim, home: homeSim, mort: mortSim, life: lifeSim, biz: bizSim, solar: solarSim };

function parseInput(argv) {
  const args = argv.slice(2);
  if (args.length === 0) { // JSON on stdin
    const text = fs.readFileSync(0, 'utf8').trim();
    return JSON.parse(text || '{}');
  }
  if (args[0].trim().startsWith('{')) return JSON.parse(args[0]);
  // key=value form
  const req = { mode: args[0], overrides: {}, series: false };
  for (const a of args.slice(1)) {
    if (a === '--series') { req.series = true; continue; }
    if (a === '--live') { req.live = true; continue; }
    if (a.startsWith('--listings=')) { req.listingsFile = a.slice('--listings='.length); continue; }
    const eq = a.indexOf('=');
    if (eq < 0) throw new Error(`expected key=value, got "${a}"`);
    const k = a.slice(0, eq);
    const v = a.slice(eq + 1);
    req.overrides[k] =
      k === 'lifeActive' ? v.split(',').filter(Boolean)
      : v === 'true' ? true : v === 'false' ? false
      : v !== '' && !isNaN(+v) ? +v : v;
  }
  return req;
}

function runOnce(mode, p, withSeries) {
  const res = SIMS[mode](p);
  const out = summarizeResult(mode, res, p);
  if (withSeries) {
    out.series = res.series.map((s) => ({
      month: s.m,
      fx: +s.fx.toFixed(3),
      netWorthUAH: s.v.map(Math.round),
    }));
  }
  return out;
}

async function main() {
  const req = parseInput(process.argv);
  if (req.mode !== 'find' && !SIMS[req.mode]) {
    throw new Error(`mode must be one of ${Object.keys(SIMS).join(', ')}, find`);
  }
  // find mode accepts short aliases (make=, priceMaxUSD=…) mapped to cf_*
  if (req.mode === 'find') {
    const A = { make: 'cf_make', model: 'cf_model', yearMin: 'cf_yearMin', yearMax: 'cf_yearMax',
      priceMinUSD: 'cf_priceMinUSD', priceMaxUSD: 'cf_priceMaxUSD', mileageMaxKm: 'cf_mileageMaxKm',
      region: 'cf_region', fuel: 'cf_fuel', gearbox: 'cf_gearbox', bodyType: 'cf_bodyType',
      source: 'cf_source', apiKey: 'cf_apiKey', topN: 'cf_topN', rules: 'cf_rulesText',
      allowDamaged: 'cf_allowDamaged', allowDamageTypes: 'cf_allowDamageTypes' };
    for (const k in { ...req.overrides }) if (A[k]) { req.overrides[A[k]] = req.overrides[k]; delete req.overrides[k]; }
  }
  for (const k in req.overrides || {}) {
    if (!(k in PARAM_DEFAULTS)) throw new Error(`unknown parameter "${k}" — see LLM_API.md`);
  }
  const p = { ...PARAM_DEFAULTS, ...(req.overrides || {}) };

  // Car finder is a different kind of result (a ranked short-list, not a
  // two-strategy wealth curve), so it has its own runner and summarizer.
  if (req.mode === 'find') {
    let res;
    if (req.live || p.cf_source === 'autoria' || p.cf_source === 'mobilede') {
      if (p.cf_source === 'sample') p.cf_source = 'autoria';
      res = await findCarsLive(p);
    } else {
      let listings = CF_SAMPLE_LISTINGS;
      if (req.listingsFile) listings = JSON.parse(fs.readFileSync(req.listingsFile, 'utf8'));
      else if (Array.isArray(req.listings)) listings = req.listings;
      res = findCars(p, listings);
    }
    process.stdout.write(JSON.stringify(cfSummarize(res), null, 2) + '\n');
    return;
  }

  let out;
  if (req.sweep) {
    const { id, values } = req.sweep;
    if (!(id in PARAM_DEFAULTS)) throw new Error(`unknown sweep parameter "${id}"`);
    if (!Array.isArray(values) || !values.length) throw new Error('sweep.values must be a non-empty array');
    out = {
      mode: req.mode,
      sweep: values.map((v) => {
        const r = runOnce(req.mode, { ...p, [id]: v }, false);
        delete r.assumptions; // avoid repeating ~150 keys per point
        delete r.details;
        return { [id]: v, ...r };
      }),
      assumptions: p,
    };
  } else {
    out = runOnce(req.mode, p, req.series);
  }
  process.stdout.write(JSON.stringify(out, null, 2) + '\n');
}

main().catch((e) => {
  process.stdout.write(JSON.stringify({ error: e.message }) + '\n');
  process.exit(1);
});
