#!/usr/bin/env node
/*
 * Headless runner for LLMs and scripts — no browser, no build, no deps.
 *
 * Usage (three equivalent input forms):
 *   node cli.js <mode> [key=value ...] [--series]
 *   node cli.js '<json>'                     (see JSON shape below)
 *   echo '<json>' | node cli.js
 *
 * Modes: car | home | mort | life | biz
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
for (const f of ['engine.js', 'decisions.js', 'defaults.js',
  'car.js', 'home.js', 'mort.js', 'life.js', 'business.js']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, f), 'utf8'), ctx, { filename: f });
}
// top-level const/function bindings live in the context's lexical scope,
// so pull the handles out with an in-context expression
const { PARAM_DEFAULTS, summarizeResult, carSim, homeSim, mortSim, lifeSim, bizSim } =
  vm.runInContext('({ PARAM_DEFAULTS, summarizeResult, carSim, homeSim, mortSim, lifeSim, bizSim })', ctx);
const SIMS = { car: carSim, home: homeSim, mort: mortSim, life: lifeSim, biz: bizSim };

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

try {
  const req = parseInput(process.argv);
  if (!SIMS[req.mode]) {
    throw new Error(`mode must be one of ${Object.keys(SIMS).join(', ')}`);
  }
  for (const k in req.overrides || {}) {
    if (!(k in PARAM_DEFAULTS)) throw new Error(`unknown parameter "${k}" — see LLM_API.md`);
  }
  const p = { ...PARAM_DEFAULTS, ...(req.overrides || {}) };

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
} catch (e) {
  process.stdout.write(JSON.stringify({ error: e.message }) + '\n');
  process.exit(1);
}
