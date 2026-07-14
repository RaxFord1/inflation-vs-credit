'use strict';
const cf = require('./carfinder.js');
let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; } else { fail++; console.log('  FAIL:', msg); } };

// ---- DSL sanity ----
const ev = (expr, ctx) => cf.cfEval(cf.cfParse(cf.cfTokenize(expr)), ctx);
ok(ev('make = Tesla', { make: 'Tesla' }) === true, 'eq bare string');
ok(ev('make = Tesla', { make: 'BMW' }) === false, 'eq bare string false');
ok(ev('region != EU', { region: 'US' }) === true, 'neq');
ok(ev('make = Tesla and region != EU', { make: 'Tesla', region: 'US' }) === true, 'and');
ok(ev('make = Tesla and region != EU', { make: 'Tesla', region: 'EU' }) === false, 'and euro exempt');
ok(ev('priceUSD < market * 0.6', { priceUSD: 5000, market: 10000 }) === true, 'arith lt');
ok(ev('priceUSD < market * 0.6', { priceUSD: 7000, market: 10000 }) === false, 'arith lt false');
ok(ev('damaged and damageType not in [front, rear]', { damaged: true, damageType: 'side' }) === true, 'not in true');
ok(ev('damaged and damageType not in [front, rear]', { damaged: true, damageType: 'front' }) === false, 'not in false');
ok(ev('damageType in [front, rear]', { damageType: 'rear' }) === true, 'in true');
ok(ev('not (fuel = EV)', { fuel: 'diesel' }) === true, 'not paren');
ok(ev('kmPerYear > 30000', { kmPerYear: 40000 }) === true, 'gt');

// ---- parse errors surface, not throw ----
const rr = cf.cfParseRules('reject make = Tesla\nboom: 1 +');
ok(rr.filter((r) => r.error).length === 2, 'two rule errors captured');

// ---- full pipeline on the sample ----
const P = {
  cf_make: 'Tesla', cf_priceMaxUSD: 30000, cf_yearMin: 2018, cf_mileageMaxKm: 150000,
  cf_region: 'any', cf_allowDamaged: true, cf_allowDamageTypes: 'front,rear',
  cf_topN: 10, cf_thisYear: 2026, fx0: 41.7,
};
const res = cf.findCars(P, cf.CF_SAMPLE_LISTINGS);
const teslas = res.evaluated.map((e) => e.listing.title);
ok(res.scanned === cf.CF_SAMPLE_LISTINGS.length, 'scanned all');
// only Tesla should pass the make filter
ok(res.evaluated.every((e) => e.listing.make === 'Tesla'), 'make filter kept only Tesla');
// the US 2020 & 2019 Teslas are rejected by the builtin Tesla→EU rule
const rejReasons = res.rejected.filter((r) => r.stage === 'rule').flatMap((r) => r.reasons).join(' ');
ok(res.rejected.some((r) => r.stage === 'rule' && /европейку/i.test(r.reasons.join(''))), 'Tesla US rejected by rule');
// EU Tesla (2021 DE) should survive and rank
const euTesla = res.evaluated.find((e) => e.listing.country === 'DE');
ok(euTesla && euTesla.verdict !== 'rejected', 'EU Tesla survives');
ok(res.results.length >= 1 && res.results[0].score >= 0, 'has ranked results');
ok(res.results.every((e) => e.checks.vin && e.checks.history && e.checks.damage && e.checks.ai), 'all checks ran');

// ---- odometer rollback flagged as fail in history check ----
const P2 = { cf_make: 'Volkswagen', cf_priceMaxUSD: 30000, cf_region: 'any', cf_allowDamaged: false, cf_topN: 10, cf_thisYear: 2026 };
const res2 = cf.findCars(P2, cf.CF_SAMPLE_LISTINGS);
const rollback = res2.evaluated.find((e) => e.listing.history && e.listing.history.odometerRollback);
ok(rollback && rollback.checks.history.status === 'fail', 'odometer rollback → history FAIL');

// ---- custom text rule: prefer EU, penalize dealer-without-vin ----
const P3 = Object.assign({}, P, { cf_rulesText: 'boost 15: region = EU\nreject: fuel = diesel' });
const res3 = cf.findCars(P3, cf.CF_SAMPLE_LISTINGS);
ok(res3.evaluated.every((e) => e.listing.fuel !== 'diesel'), 'custom reject diesel');

// ---- damage policy: hard rejects + before-repair-photos requirement ----
const dmg = [
  { make: 'Tesla', model: 'Model 3', year: 2021, price: 18000, currency: 'USD', mileage: 60000, region: 'EU', country: 'DE', vin: 'LRW3E7EK1MC111111', damaged: true, damageType: 'front', beforeRepairPhotos: 'yes' },   // pass
  { make: 'Tesla', model: 'Model 3', year: 2021, price: 15000, currency: 'USD', mileage: 60000, region: 'EU', country: 'DE', vin: 'LRW3E7EK1MC222222', damaged: true, damageType: 'front', beforeRepairPhotos: 'unknown' }, // reject: no before-photos
  { make: 'Tesla', model: 'Model 3', year: 2020, price: 14000, currency: 'USD', mileage: 90000, region: 'EU', country: 'DE', vin: 'LRW3E7EK1LC333333', damaged: true, damageType: 'flood', beforeRepairPhotos: 'yes' },     // reject: flood
  { make: 'Tesla', model: 'Model 3', year: 2020, price: 14500, currency: 'USD', mileage: 90000, region: 'EU', country: 'DE', vin: 'LRW3E7EK1LC444444', damaged: true, damageType: 'battery', beforeRepairPhotos: 'yes' },   // reject: battery
  { make: 'Tesla', model: 'Model 3', year: 2020, price: 15500, currency: 'USD', mileage: 90000, region: 'EU', country: 'DE', vin: 'LRW3E7EK1LC555555', damaged: true, damageType: 'порог', beforeRepairPhotos: 'yes' },     // reject: пороги→structural
  { make: 'Tesla', model: 'Model 3', year: 2022, price: 26000, currency: 'USD', mileage: 40000, region: 'EU', country: 'DE', vin: 'LRW3E7EK1NC666666', damaged: false },                                                    // pass: clean
];
const pol = 'reject: damaged and damageType not in [none, front, rear]';
const dres = cf.findCars({ cf_make: 'Tesla', cf_region: 'EU', cf_priceMaxUSD: 30000, cf_allowDamaged: true, cf_allowDamageTypes: 'front,rear', cf_rulesText: pol, cf_thisYear: 2026 }, dmg);
const passed = dres.evaluated.map((e) => e.listing.vin);
ok(passed.includes('LRW3E7EK1MC111111'), 'minor front + before-photos passes');
ok(passed.includes('LRW3E7EK1NC666666'), 'clean car passes');
ok(passed.includes('LRW3E7EK1MC222222'), 'front without before-photos NOW passes as candidate (escalate to VIN lookup, not reject)');
const noBeforeCar = dres.evaluated.find((e) => e.listing.vin === 'LRW3E7EK1MC222222');
ok(noBeforeCar && noBeforeCar.checks.damage.needsVin === true, 'front without before-photos flagged needsVin');
ok(!passed.includes('LRW3E7EK1LC333333'), 'flood rejected');
ok(!passed.includes('LRW3E7EK1LC444444'), 'battery-hit rejected');
ok(!passed.includes('LRW3E7EK1LC555555'), 'порог→structural rejected');
ok(cf.cfNormalize({ damageType: 'стойки', damaged: true }).damageType === 'structural', 'стойки canonicalizes to structural');
ok(cf.cfNormalize({ damageType: 'утоплен', damaged: true }).damageType === 'flood', 'утоплен canonicalizes to flood');

// ---- summarize shape ----
const sum = cf.cfSummarize(res);
ok(sum.mode === 'find' && Array.isArray(sum.results), 'summary shape');
ok(typeof sum.marketMedianUSD === 'number', 'summary median');

console.log(`\ncarfinder: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
