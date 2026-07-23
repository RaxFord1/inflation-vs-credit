/* UI wiring and hand-rolled SVG charts. Rendering is generic — each module
 * (car.js, home.js) returns a standardized result object.
 * Low-level helpers ($, el, niceTicks, etc.) live in chart.js. */

const MODULES = {
  car: { run: carSim },
  home: { run: homeSim },
  mort: { run: mortSim },
  life: { run: lifeSim },
  biz: { run: bizSim },
  ev: { run: evSim },
  solar: { run: solarSim },
};
let mode = 'car';

const INTROS = {
  car: 'Which way of paying leaves you richer? Tweak the numbers on the left — results update instantly. ' +
    'To keep the comparison fair, every path spends the same amount of money each month: whoever is required to ' +
    'pay less than the others invests the difference. So the gap between the lines is the true cost (or benefit) of each choice.',
  home: 'Which way of paying leaves you richer? Tweak the numbers on the left — results update instantly. ' +
    'To keep the comparison fair, every path spends the same amount of money each month: whoever is required to ' +
    'pay less than the others invests the difference. So the gap between the lines is the true cost (or benefit) of each choice.',
  mort: 'Same apartment, same rate — up to ten down-payment + term combinations raced side by side ' +
    'against renting + investing. Every path spends the same amount each month (whoever must pay less ' +
    'invests the difference), so the gaps between the lines are the true cost of each loan structure. ' +
    'Tick the variants on the left; a 100% down payment means buying outright with no loan.',
  life: 'Start from what you actually have — savings, salary, current housing — and weigh your possible next moves: ' +
    'buying a car or a flat, studying, changing jobs, moving abroad, starting a business, or combining moves over time. ' +
    'Each decision is simulated month by month and scored on five criteria — wealth, crisis resilience, payment stress, ' +
    'liquidity and lifestyle — weighted by what matters to you. Plans that don’t fit your budget are flagged.',
  biz: 'Pit up to four business ideas against the safest alternative — keeping your job and investing your savings. ' +
    'Each idea pays its startup investment upfront, earns nothing during the ramp-up, then nets revenue minus tax ' +
    'and operating bills (electricity, rent, staff). Choose who runs each idea: quit and run it yourself (the ' +
    'comparison charges the salary you give up), or hire staff to replace you and collect salary and profit together. ' +
    'Use the “Reality check” inputs — and sweep them in “What if…” — to see which idea survives revenue coming in below plan.',
  ev: 'Is it worth switching from your gas/diesel car to an EV or plug-in hybrid? ' +
    "Enter your current car's fuel consumption and monthly mileage, pick two new cars to compare (e.g. Tesla Model 3 vs RAV4 PHEV), " +
    'and see how quickly fuel savings pay off the purchase — factoring in depreciation, loan costs, maintenance, and investment returns.',
  solar: 'You already resell electricity to consumers at a markup. Should you add solar panels to cut your grid costs ' +
    'and boost margins — or just invest the money? Enter your consumer demand, grid price, markup, and solar sell price; ' +
    'the model runs month by month with seasonal generation, battery buffering, feed-in for excess, and optional self-use. ' +
    'Results include payback period, margin uplift, net worth comparison, and sensitivity to grid price growth.',
  find: 'Підбір авто в Україні та Європі за співвідношенням ціна/якість. Задайте фільтри зліва, ' +
    'опишіть свою логіку правилами текстом (напр. «Tesla — тільки європейка»), і кожне оголошення пройде ' +
    'фільтри → правила → перевірки (VIN/реєстр, історія ДТП і пробігу, тип пошкоджень, AI-аналіз відповідності) → ' +
    'оцінку 0–100. Демо-набір працює офлайн; для живого пошуку оберіть джерело та вкажіть ключ.',
};

const NUM_IDS = [
  // car
  'price', 'carDepPct', 'pensionPct', 'regFeeUAH', 'cashDiscountPct',
  'dpPct', 'loanYears', 'loanRatePct', 'commissionPct', 'monthlyFeeUAH',
  'kaskoPct', 'lifeInsPct',
  // home
  'h_price', 'h_apprPct', 'h_feesPct', 'h_maintPct',
  'h_dpPct', 'h_loanYears', 'h_ratePct', 'h_commPct', 'h_insPct',
  'h_rentUSD', 'h_rentGrowthPct', 'h_ownRentUSD', 'h_vacancyPct', 'h_rentTaxPct',
  // mort (variant slots + two-scenario charts)
  ...Array.from({ length: 10 }, (_, k) => [`mv${k + 1}_dpPct`, `mv${k + 1}_years`]).flat(),
  'sc1_dpPct', 'sc1_years', 'sc1_horizonYr', 'sc2_dpPct', 'sc2_years', 'sc2_horizonYr',
  // life
  'savings', 'l_curRentUSD', 'l_livExpUSD',
  'edu_costUSD', 'edu_months', 'edu_dropPct', 'edu_bumpPct',
  'job_changePct', 'job_newGrowthPct',
  'mig_costUSD', 'mig_salaryUSD', 'mig_rentUSD', 'mig_livUSD',
  'biz_investUSD', 'biz_rampMonths', 'biz_revenueUSD', 'biz_costsUSD', 'biz_taxPct', 'biz_growthPct', 'biz_residualPct',
  'combo_flatDelayYr',
  // biz tab
  'bz_revFactorPct', 'bz_costFactorPct',
  'bz_reinvestPct', 'bz_unitCostPct', 'bz_maxUnits',
  'bz1_investUSD', 'bz1_rampMonths', 'bz1_revenueUSD', 'bz1_costsUSD', 'bz1_taxPct', 'bz1_growthPct', 'bz1_residualPct', 'bz1_staffUSD', 'bz1_hoursWk',
  'bz2_investUSD', 'bz2_rampMonths', 'bz2_revenueUSD', 'bz2_costsUSD', 'bz2_taxPct', 'bz2_growthPct', 'bz2_residualPct', 'bz2_staffUSD', 'bz2_hoursWk',
  'bz3_investUSD', 'bz3_rampMonths', 'bz3_revenueUSD', 'bz3_costsUSD', 'bz3_taxPct', 'bz3_growthPct', 'bz3_residualPct', 'bz3_staffUSD', 'bz3_hoursWk',
  'bz4_investUSD', 'bz4_rampMonths', 'bz4_revenueUSD', 'bz4_costsUSD', 'bz4_taxPct', 'bz4_growthPct', 'bz4_residualPct', 'bz4_staffUSD', 'bz4_hoursWk',
  'w_wealth', 'w_robust', 'w_stress', 'w_liq', 'w_qol',
  'qol_nothing', 'qol_carCash', 'qol_carCredit', 'qol_flatLive', 'qol_flatBtl',
  'qol_edu', 'qol_job', 'qol_migrate', 'qol_biz', 'qol_combo',
  // ev switch
  'eo_valueUSD', 'eo_depPct', 'eo_consumption', 'eo_maintUSD',
  'ea_priceUSD', 'ea_depPct', 'ea_kwh', 'ea_phevGas', 'ea_phevElecPct', 'ea_publicPct', 'ea_maintUSD',
  'eb_priceUSD', 'eb_depPct', 'eb_kwh', 'eb_phevGas', 'eb_phevElecPct', 'eb_publicPct', 'eb_maintUSD',
  'ec_priceUSD', 'ec_depPct', 'ec_kwh', 'ec_phevGas', 'ec_phevElecPct', 'ec_publicPct', 'ec_maintUSD',
  'ed_priceUSD', 'ed_depPct', 'ed_kwh', 'ed_phevGas', 'ed_phevElecPct', 'ed_publicPct', 'ed_maintUSD',
  'ee_priceUSD', 'ee_depPct', 'ee_kwh', 'ee_phevGas', 'ee_phevElecPct', 'ee_publicPct', 'ee_maintUSD',
  'ev_monthlyKm', 'ev_fuelUAH', 'ev_dieselUAH', 'ev_lpgUAH', 'ev_fuelGrowPct',
  'ev_elecUAH', 'ev_publicUAH', 'ev_elecGrowPct',
  'ev_transportUSD',
  'ev_dpPct', 'ev_loanYears', 'ev_loanRatePct', 'ev_commissionPct', 'ev_kaskoPct',
  'ev_pensionPct', 'ev_regFeeUAH',
  // solar
  'sol_capacityKW', 'sol_panelCostPerKW', 'sol_batteryKWh', 'sol_batteryCostPerKWh',
  'sol_installUSD', 'sol_demandKWh', 'sol_gridBuyUAH', 'sol_gridBuyGrowPct',
  'sol_markupPct', 'sol_solarSellUAH', 'sol_solarSellGrowPct',
  'sol_feedInUAH', 'sol_feedInGrowPct', 'sol_selfUseKWh', 'sol_overlapPct',
  'sol_degradePct', 'sol_battDegradePct',
  'sol_maintPct', 'sol_equipDepPct', 'sol_inverterReplaceYr', 'sol_inverterCostPct',
  // shared
  'salaryAmt', 'salaryGrowthPct',
  'invYieldPct', 'invTaxPct', 'yieldDriftPp',
  'horizonYears', 'fx0', 'devalPct', 'inflPct', 'usdInflPct',
];

const INV_PRESETS = {
  'uah-dep': { invCurrency: 'UAH', invYieldPct: 13.5, invTaxPct: 23 },
  'ovdp':    { invCurrency: 'UAH', invYieldPct: 16.5, invTaxPct: 0 },
  'usd-dep': { invCurrency: 'USD', invYieldPct: 2.5,  invTaxPct: 23 },
};

/* Typical-scenario presets (mid-2026 Ukrainian market). Picking one fills the
 * fields it covers; editing any covered field flips the select back to
 * "custom". Values are field-id → value. */
const SCENARIO_PRESETS = {
  carPreset: {
    used:    { price: 6000,  priceCurrency: 'USD', carDepPct: 8 },
    new:     { price: 27000, priceCurrency: 'USD', carDepPct: 13 },
    premium: { price: 45000, priceCurrency: 'USD', carDepPct: 15 },
  },
  loanPreset: {
    standard: { dpPct: 20, loanYears: 5, loanRatePct: 16,   commissionPct: 1.5 },
    promo:    { dpPct: 60, loanYears: 2, loanRatePct: 0.01, commissionPct: 2.5 },
    usedloan: { dpPct: 30, loanYears: 5, loanRatePct: 20,   commissionPct: 2 },
    nodown:   { dpPct: 0,  loanYears: 7, loanRatePct: 22,   commissionPct: 2.5 },
  },
  homePreset: {
    kyiv1:   { h_price: 70000,  h_rentUSD: 430, h_ownRentUSD: 430 },
    kyiv2:   { h_price: 110000, h_rentUSD: 670, h_ownRentUSD: 670 },
    region1: { h_price: 40000,  h_rentUSD: 250, h_ownRentUSD: 250 },
  },
  mortPreset: {
    eoselia3: { h_dpPct: 20, h_loanYears: 20, h_ratePct: 3,  h_commPct: 1 },
    eoselia7: { h_dpPct: 20, h_loanYears: 20, h_ratePct: 7,  h_commPct: 1 },
    market:   { h_dpPct: 30, h_loanYears: 20, h_ratePct: 20, h_commPct: 1.5 },
  },
  savePreset: {
    zero: { savings: 0,     savingsCurrency: 'USD' },
    s10k: { savings: 10000, savingsCurrency: 'USD' },
    s80k: { savings: 80000, savingsCurrency: 'USD' },
  },
};

/* Typical small businesses, mid-2026 Ukraine. Bills = electricity, water,
 * rent, staff, supplies; tax = FOP group 3 (5% single tax + 1% levy).
 * The same figures feed the life tab's single business (biz_*) and the four
 * idea slots on the business tab (bz1_… bz4_). */
const BIZ_PRESET_VALUES = {
  carwash: { investUSD: 70000, rampMonths: 9, revenueUSD: 4500, costsUSD: 1800, taxPct: 6, growthPct: 5,  residualPct: 50, staffUSD: 300, hoursWk: 15 },
  coffee:  { investUSD: 10000, rampMonths: 3, revenueUSD: 3200, costsUSD: 2300, taxPct: 6, growthPct: 8,  residualPct: 40, staffUSD: 800, hoursWk: 60 },
  barber:  { investUSD: 25000, rampMonths: 4, revenueUSD: 5500, costsUSD: 4100, taxPct: 6, growthPct: 6,  residualPct: 30, staffUSD: 500, hoursWk: 45 },
  shop:    { investUSD: 6000,  rampMonths: 6, revenueUSD: 4000, costsUSD: 3300, taxPct: 6, growthPct: 15, residualPct: 10, staffUSD: 700, hoursWk: 45 },
  vending: { investUSD: 12000, rampMonths: 3, revenueUSD: 2200, costsUSD: 1100, taxPct: 6, growthPct: 8,  residualPct: 45, staffUSD: 400, hoursWk: 10 },
};
for (const sel of ['bizPreset', 'bz1Preset', 'bz2Preset', 'bz3Preset', 'bz4Preset']) {
  const life = sel === 'bizPreset'; // the life tab's business always assumes you quit
  const prefix = life ? 'biz_' : sel.slice(0, 3) + '_';
  SCENARIO_PRESETS[sel] = {};
  for (const kind in BIZ_PRESET_VALUES) {
    SCENARIO_PRESETS[sel][kind] = {};
    for (const f in BIZ_PRESET_VALUES[kind]) {
      if (life && (f === 'staffUSD' || f === 'hoursWk')) continue; // no staff/time inputs on the life tab
      SCENARIO_PRESETS[sel][kind][prefix + f] = BIZ_PRESET_VALUES[kind][f];
    }
  }
}

/* Solar system presets. */
SCENARIO_PRESETS.solarPreset = {
  small:  { sol_capacityKW: 10, sol_batteryKWh: 0,  sol_installUSD: 1500, sol_demandKWh: 2000 },
  medium: { sol_capacityKW: 30, sol_batteryKWh: 20, sol_installUSD: 3000, sol_demandKWh: 5000 },
  large:  { sol_capacityKW: 100, sol_batteryKWh: 50, sol_installUSD: 5000, sol_demandKWh: 15000 },
};
SCENARIO_PRESETS.solarUsePreset = {
  reseller:   { sol_selfUseKWh: 0 },
  selfuse500: { sol_selfUseKWh: 500 },
  selfuse2k:  { sol_selfUseKWh: 2000 },
};

/* EV presets: old car types and new EV/PHEV models, mid-2026 estimates. */
const EV_OLD_PRESETS = {
  sedan:     { eo_valueUSD: 4000,  eo_depPct: 6, eo_consumption: 8,  eo_maintUSD: 80,  eo_fuelType: 'petrol', ev_fuelUAH: 57 },
  crossover: { eo_valueUSD: 12000, eo_depPct: 8, eo_consumption: 10, eo_maintUSD: 100, eo_fuelType: 'petrol', ev_fuelUAH: 57 },
  diesel:    { eo_valueUSD: 15000, eo_depPct: 8, eo_consumption: 7,  eo_maintUSD: 110, eo_fuelType: 'diesel', ev_fuelUAH: 55 },
  old_suv:   { eo_valueUSD: 8000,  eo_depPct: 7, eo_consumption: 12, eo_maintUSD: 120, eo_fuelType: 'petrol', ev_fuelUAH: 57 },
};
const EV_NEW_PRESETS = {
  model3:        { _priceUSD: 40000, _depPct: 12, _type: 'ev',      _kwh: 15, _phevGas: 5.5, _phevElecPct: 65, _publicPct: 20, _maintUSD: 35, _label: 'Tesla Model 3' },
  modely:        { _priceUSD: 48000, _depPct: 12, _type: 'ev',      _kwh: 17, _phevGas: 5.5, _phevElecPct: 65, _publicPct: 20, _maintUSD: 35, _label: 'Tesla Model Y' },
  rav4phev:      { _priceUSD: 52000, _depPct: 11, _type: 'phev',    _kwh: 18, _phevGas: 5.5, _phevElecPct: 65, _publicPct: 15, _maintUSD: 55, _label: 'RAV4 PHEV' },
  seal:          { _priceUSD: 34000, _depPct: 15, _type: 'ev',      _kwh: 14, _phevGas: 5.5, _phevElecPct: 65, _publicPct: 20, _maintUSD: 40, _label: 'BYD Seal' },
  ioniq5:        { _priceUSD: 44000, _depPct: 13, _type: 'ev',      _kwh: 17, _phevGas: 5.5, _phevElecPct: 65, _publicPct: 20, _maintUSD: 40, _label: 'Ioniq 5' },
  camryhev:      { _priceUSD: 28000, _depPct: 10, _type: 'hev',     _kwh: 0,  _phevGas: 5,   _phevElecPct: 0,  _publicPct: 0,  _maintUSD: 45, _label: 'Camry Hybrid' },
  tiguandiesel:  { _priceUSD: 22000, _depPct: 9,  _type: 'diesel',  _kwh: 0,  _phevGas: 6,   _phevElecPct: 0,  _publicPct: 0,  _maintUSD: 60, _label: 'Tiguan Diesel' },
  corollapetrol: { _priceUSD: 25000, _depPct: 8,  _type: 'petrol',  _kwh: 0,  _phevGas: 7,   _phevElecPct: 0,  _publicPct: 0,  _maintUSD: 50, _label: 'Corolla Petrol' },
};
SCENARIO_PRESETS.oldCarPreset = {};
for (const k in EV_OLD_PRESETS) SCENARIO_PRESETS.oldCarPreset[k] = EV_OLD_PRESETS[k];
for (const sel of ['eaPreset', 'ebPreset', 'ecPreset', 'edPreset', 'eePreset']) {
  const prefix = sel.replace('Preset', '');
  SCENARIO_PRESETS[sel] = {};
  for (const k in EV_NEW_PRESETS) {
    const p = EV_NEW_PRESETS[k];
    SCENARIO_PRESETS[sel][k] = {};
    for (const f in p) SCENARIO_PRESETS[sel][k][prefix + f] = p[f];
  }
}

/* "What if…" sensitivity sweeps: which inputs can be swept per tab, and over
 * which values. Each point re-runs the full simulation with only that input
 * changed; results are compared in today's dollars. `dyn` builds a range from
 * the current params (used for absolute amounts like savings); `apply` maps a
 * swept value to a full param override (used when one input must drag another
 * along to stay meaningful). */

/* Inflation alone only re-labels "today's ₴" — outcomes move through the
 * exchange rate. So the inflation sweep keeps devaluation PPP-consistent:
 * every point re-derives devalPct from the swept UAH CPI vs USD CPI. */
const INFL_SWEEP = {
  id: 'inflPct', label: 'UAH inflation, %/yr (deval follows PPP)', unit: '%',
  values: [0, 5, 8, 11, 15, 20, 25, 30],
  apply: (p, v) => ({ ...p, inflPct: v, devalPct: pppDevaluation(v, p.usdInflPct) }),
};

const SWEEPS = {
  car: [
    { id: 'dpPct', label: 'Down payment, %', unit: '%', values: [0, 10, 20, 30, 40, 50, 60, 70, 80, 90] },
    { id: 'loanRatePct', label: 'Loan rate, %/yr', unit: '%', values: [0, 4, 8, 12, 16, 20, 24, 28] },
    { id: 'loanYears', label: 'Loan term, years', unit: 'y', values: [1, 2, 3, 4, 5, 6, 7, 8] },
    { id: 'cashDiscountPct', label: 'Cash price difference, %', unit: '%', values: [-10, -7.5, -5, -2.5, 0, 2.5, 5, 7.5, 10] },
    { id: 'invYieldPct', label: 'Investment yield, %/yr', unit: '%', values: [0, 4, 8, 12, 16, 20, 24, 28] },
    { id: 'devalPct', label: 'UAH devaluation, %/yr', unit: '%', values: [0, 4, 8, 12, 16, 20, 25] },
    INFL_SWEEP,
    { id: 'horizonYears', label: 'Horizon, years', unit: 'y', values: [1, 2, 3, 4, 5, 6, 7, 8, 10] },
  ],
  home: [
    { id: 'h_dpPct', label: 'Down payment, %', unit: '%', values: [0, 10, 20, 30, 40, 50, 60, 70, 80, 90] },
    { id: 'h_ratePct', label: 'Mortgage rate, %/yr', unit: '%', values: [0, 3, 7, 10, 14, 18, 22] },
    { id: 'h_loanYears', label: 'Mortgage term, years', unit: 'y', values: [5, 10, 15, 20, 25, 30] },
    { id: 'h_apprPct', label: 'Apartment appreciation, %/yr', unit: '%', values: [-4, -2, 0, 2, 4, 6, 8] },
    { id: 'invYieldPct', label: 'Investment yield, %/yr', unit: '%', values: [0, 4, 8, 12, 16, 20, 24, 28] },
    { id: 'devalPct', label: 'UAH devaluation, %/yr', unit: '%', values: [0, 4, 8, 12, 16, 20, 25] },
    INFL_SWEEP,
    { id: 'horizonYears', label: 'Horizon, years', unit: 'y', values: [5, 10, 15, 20, 25, 30] },
  ],
  mort: [
    { id: 'h_ratePct', label: 'Mortgage rate, %/yr', unit: '%', values: [0, 3, 7, 10, 14, 18, 22] },
    { id: 'h_apprPct', label: 'Apartment appreciation, %/yr', unit: '%', values: [-4, -2, 0, 2, 4, 6, 8] },
    { id: 'h_rentGrowthPct', label: 'Rent growth, %/yr', unit: '%', values: [-2, 0, 2, 4, 6, 8] },
    { id: 'horizonYears', label: 'Horizon, years', unit: 'y', values: [5, 10, 15, 20, 25, 30] },
    { id: 'invYieldPct', label: 'Investment yield, %/yr', unit: '%', values: [0, 4, 8, 12, 16, 20, 24, 28] },
    { id: 'devalPct', label: 'UAH devaluation, %/yr', unit: '%', values: [0, 4, 8, 12, 16, 20, 25] },
    INFL_SWEEP,
  ],
  life: [
    { id: 'savings', label: 'Savings you have now', unit: 'money',
      dyn: (p) => { const hi = Math.max(p.savings * 2, 20000); return [0, 1, 2, 3, 4, 5, 6, 7, 8].map((k) => Math.round(hi * k / 8)); } },
    { id: 'dpPct', label: 'Car down payment, %', unit: '%', values: [0, 10, 20, 30, 40, 50, 60, 70, 80, 90] },
    { id: 'h_dpPct', label: 'Flat down payment, %', unit: '%', values: [0, 10, 20, 30, 40, 50, 60, 70, 80, 90] },
    { id: 'invYieldPct', label: 'Investment yield, %/yr', unit: '%', values: [0, 4, 8, 12, 16, 20, 24, 28] },
    { id: 'devalPct', label: 'UAH devaluation, %/yr', unit: '%', values: [0, 4, 8, 12, 16, 20, 25] },
    INFL_SWEEP,
    { id: 'horizonYears', label: 'Horizon, years', unit: 'y', values: [2, 3, 5, 7, 10, 15, 20] },
    { id: 'combo_flatDelayYr', label: 'Combo: flat purchase delay, years', unit: 'y', values: [0, 1, 2, 3, 4, 5, 6, 8] },
    { id: 'edu_bumpPct', label: 'Education: salary raise, %', unit: '%', values: [0, 10, 20, 30, 40, 60, 80] },
    { id: 'biz_revenueUSD', label: 'Business revenue after ramp, $/mo', unit: 'money',
      dyn: (p) => [0, 1, 2, 3, 4, 5, 6].map((k) => Math.round(Math.max(p.biz_revenueUSD * 2, 3000) * k / 6)) },
  ],
  biz: [
    { id: 'bz_revFactorPct', label: 'Revenue vs plan, %', unit: '%', values: [50, 60, 70, 80, 90, 100, 110, 120] },
    { id: 'bz_costFactorPct', label: 'Bills vs plan, %', unit: '%', values: [70, 85, 100, 115, 130, 150] },
    { id: 'bz_reinvestPct', label: 'Scaling: profit reinvested, %', unit: '%', values: [0, 20, 40, 60, 80, 100] },
    { id: 'bz_maxUnits', label: 'Scaling: maximum units', unit: 'n', values: [1, 2, 3, 4, 5, 6] },
    { id: 'savings', label: 'Savings you have now', unit: 'money',
      dyn: (p) => { const hi = Math.max(p.savings * 2, 20000); return [0, 1, 2, 3, 4, 5, 6, 7, 8].map((k) => Math.round(hi * k / 8)); } },
    { id: 'horizonYears', label: 'Horizon, years', unit: 'y', values: [2, 3, 5, 7, 10, 15] },
    { id: 'invYieldPct', label: 'Investment yield, %/yr', unit: '%', values: [0, 4, 8, 12, 16, 20, 24, 28] },
    { id: 'devalPct', label: 'UAH devaluation, %/yr', unit: '%', values: [0, 4, 8, 12, 16, 20, 25] },
    INFL_SWEEP,
  ],
  solar: [
    { id: 'sol_gridBuyUAH', label: 'Grid buy price, UAH/kWh', unit: '₴', values: [2, 3, 4, 4.32, 5, 6, 8, 10] },
    { id: 'sol_gridBuyGrowPct', label: 'Grid price growth, %/yr', unit: '%', values: [0, 5, 8, 10, 15, 20, 25] },
    { id: 'sol_markupPct', label: 'Resale markup, %', unit: '%', values: [5, 10, 15, 20, 25, 30, 40, 50] },
    { id: 'sol_solarSellUAH', label: 'Solar sell price, UAH/kWh', unit: '₴', values: [2, 3, 3.5, 4, 4.5, 5, 6, 8] },
    { id: 'sol_capacityKW', label: 'Solar capacity, kW', unit: 'kW', values: [5, 10, 20, 30, 50, 75, 100] },
    { id: 'sol_batteryKWh', label: 'Battery capacity, kWh', unit: 'kWh', values: [0, 5, 10, 20, 30, 50, 80] },
    { id: 'sol_demandKWh', label: 'Consumer demand, kWh/mo', unit: 'kWh', values: [1000, 2000, 3000, 5000, 8000, 15000] },
    { id: 'sol_panelCostPerKW', label: 'Panel cost, $/kW', unit: '$', values: [400, 500, 600, 650, 750, 850, 1000] },
    { id: 'horizonYears', label: 'Horizon, years', unit: 'y', values: [5, 7, 10, 15, 20, 25] },
    { id: 'invYieldPct', label: 'Investment yield, %/yr', unit: '%', values: [0, 4, 8, 12, 16, 20, 24, 28] },
    { id: 'devalPct', label: 'UAH devaluation, %/yr', unit: '%', values: [0, 4, 8, 12, 16, 20, 25] },
    INFL_SWEEP,
  ],
  ev: [
    { id: 'ev_monthlyKm', label: 'Monthly mileage, km', unit: 'km', values: [500, 1000, 1500, 2000, 3000, 4000, 5000] },
    { id: 'ev_fuelUAH', label: 'Fuel price, UAH/L', unit: '₴', values: [40, 45, 50, 55, 57, 60, 65, 70] },
    { id: 'ev_elecUAH', label: 'Electricity price, UAH/kWh', unit: '₴', values: [2, 3, 4, 4.32, 5, 6, 8] },
    { id: 'ea_priceUSD', label: 'Car A price, $', unit: 'money', values: [15000, 20000, 25000, 30000, 35000, 40000, 50000, 60000] },
    { id: 'eb_priceUSD', label: 'Car B price, $', unit: 'money', values: [15000, 25000, 35000, 45000, 52000, 60000, 70000] },
    { id: 'ev_dpPct', label: 'Down payment, %', unit: '%', values: [0, 10, 20, 30, 40, 50, 70, 100] },
    { id: 'ev_loanRatePct', label: 'Loan rate, %/yr', unit: '%', values: [0, 4, 8, 12, 16, 20, 24] },
    { id: 'horizonYears', label: 'Horizon, years', unit: 'y', values: [3, 5, 7, 10, 12, 15] },
    { id: 'devalPct', label: 'UAH devaluation, %/yr', unit: '%', values: [0, 4, 8, 12, 16, 20, 25] },
    INFL_SWEEP,
  ],
};
const sweepChoice = {}; // per mode, which input is being swept

/* Quick-scenario chips under the tabs — one-click versions of the sidebar
 * preset selects. Chip state mirrors the selects; editing a covered field
 * flips the select to "custom" and the chip un-highlights on re-render. */
const QUICKBAR = {
  car: [
    { sel: 'carPreset', title: 'Car', labels: { used: 'Used ~$6k', new: 'New crossover ~$27k', premium: 'Premium SUV ~$45k' } },
    { sel: 'loanPreset', title: 'Loan', labels: { standard: 'Bank 16%', promo: 'Promo 0.01%', usedloan: 'Used-car 20%', nodown: 'No down payment 22%' } },
  ],
  home: [
    { sel: 'homePreset', title: 'Apartment', labels: { kyiv1: 'Kyiv 1-room $70k', kyiv2: 'Kyiv 2-room $110k', region1: 'Regional city $40k' } },
    { sel: 'mortPreset', title: 'Mortgage', labels: { eoselia3: 'єОселя 3%', eoselia7: 'єОселя 7%', market: 'Market ~20%' } },
  ],
  mort: [
    { sel: 'homePreset', title: 'Apartment', labels: { kyiv1: 'Kyiv 1-room $70k', kyiv2: 'Kyiv 2-room $110k', region1: 'Regional city $40k' } },
    { sel: 'mortPreset', title: 'Rate', labels: { eoselia3: 'єОселя 3%', eoselia7: 'єОселя 7%', market: 'Market ~20%' } },
  ],
  life: [
    { sel: 'savePreset', title: 'Savings', labels: { zero: '$0', s10k: '$10k', s80k: '$80k' } },
    { sel: 'bizPreset', title: 'Business', labels: { carwash: 'Car wash $70k', coffee: 'Coffee $10k', barber: 'Barbershop $25k', shop: 'Online store $6k', vending: 'Vending $12k' } },
    { sel: 'carPreset', title: 'Car', labels: { used: 'Used ~$6k', new: 'New ~$27k' } },
    { sel: 'loanPreset', title: 'Car loan', labels: { standard: 'Bank 16%', promo: 'Promo 0.01%' } },
    { sel: 'homePreset', title: 'Flat', labels: { kyiv1: 'Kyiv 1-rm $70k', region1: 'Regional $40k' } },
    { sel: 'mortPreset', title: 'Mortgage', labels: { eoselia3: 'єОселя 3%', eoselia7: 'єОселя 7%', market: 'Market ~20%' } },
  ],
  biz: [
    { sel: 'savePreset', title: 'Savings', labels: { zero: '$0', s10k: '$10k', s80k: '$80k' } },
    { sel: 'bz1Preset', title: 'Idea 1', labels: { carwash: 'Car wash', coffee: 'Coffee', barber: 'Barbershop', shop: 'Online store', vending: 'Vending' } },
    { sel: 'bz2Preset', title: 'Idea 2', labels: { carwash: 'Car wash', coffee: 'Coffee', barber: 'Barbershop', shop: 'Online store', vending: 'Vending' } },
  ],
  solar: [
    { sel: 'solarPreset', title: 'System', labels: { small: 'Small 10kW', medium: 'Medium 30kW', large: 'Large 100kW' } },
    { sel: 'solarUsePreset', title: 'Self-use', labels: { reseller: 'Reseller only', selfuse500: '+500 kWh', selfuse2k: '+2000 kWh' } },
    { sel: 'savePreset', title: 'Savings', labels: { zero: '$0', s10k: '$10k', s80k: '$80k' } },
  ],
  ev: [
    { sel: 'oldCarPreset', title: 'Your car', labels: { sedan: 'Sedan 9L', crossover: 'Crossover 11L', diesel: 'Diesel 7L', old_suv: 'Old SUV 14L' } },
    { sel: 'eaPreset', title: 'Car A', labels: { model3: 'Tesla 3', modely: 'Tesla Y', ioniq5: 'Ioniq 5', camryhev: 'Camry HEV' } },
    { sel: 'ebPreset', title: 'Car B', labels: { rav4phev: 'RAV4 PHEV', seal: 'BYD Seal', tiguandiesel: 'Tiguan D' } },
  ],
};

function applyScenarioPreset(selId, val) {
  const pre = SCENARIO_PRESETS[selId][val];
  if (!pre) return;
  $(selId).value = val;
  for (const fieldId in pre) $(fieldId).value = pre[fieldId];
  if (/^e[a-e]Preset$/.test(selId)) syncCarFields();
}

function renderQuickbar() {
  $('quickbar').innerHTML = QUICKBAR[mode].map(({ sel, title, labels }) =>
    `<span class="q-title">${title}:</span>` +
    Object.keys(labels).map((v) =>
      `<button class="chip${$(sel).value === v ? ' active' : ''}" data-sel="${sel}" data-val="${v}">${labels[v]}</button>`
    ).join('')
  ).join('<span class="q-sep"></span>');
}

// catalog order = fixed color order; "change nothing" is implicit and always on
const LIFE_DEC_IDS = ['carCash', 'carCredit', 'flatLive', 'flatBtl',
  'edu', 'job', 'migrate', 'biz', 'combo'];
const LIFE_MAX_ACTIVE = 6; // + "change nothing" = 7 series colors

function readParams() {
  const p = {};
  for (const id of NUM_IDS) p[id] = parseFloat($(id).value) || 0;
  p.priceCurrency = $('priceCurrency').value;
  p.invCurrency = $('invCurrency').value;
  p.salaryCurrency = $('salaryCurrency').value;
  p.savingsCurrency = $('savingsCurrency').value;
  p.kaskoCash = $('kaskoCash').checked;
  p.investOff = $('investOff').checked;
  p.bz_scaleOn = $('bz_scaleOn').checked;
  p.ev_sellOld = $('ev_sellOld').checked;
  p.sol_region = $('sol_region').value;
  p.sol_demandPattern = $('sol_demandPattern').value;
  p.eo_fuelType = $('eo_fuelType').value;
  for (const s of EV_SLOTS) {
    p['e' + s + '_on'] = $('e' + s + '_on').checked;
    p['e' + s + '_type'] = $('e' + s + '_type').value;
    p['e' + s + '_label'] = $('e' + s + '_label').value || ('Car ' + s.toUpperCase());
  }
  if (mode === 'ev') {
    p.dpPct = p.ev_dpPct;
    p.loanYears = p.ev_loanYears;
    p.loanRatePct = p.ev_loanRatePct;
    p.commissionPct = p.ev_commissionPct;
    p.kaskoPct = p.ev_kaskoPct;
    p.pensionPct = p.ev_pensionPct;
    p.regFeeUAH = p.ev_regFeeUAH;
  }
  p.lifeActive = LIFE_DEC_IDS.filter((id) => $('d_' + id).checked);
  for (let i = 1; i <= 10; i++) p[`mv${i}_on`] = $(`mv${i}_on`).checked;
  for (let i = 1; i <= 4; i++) {
    p[`bz${i}_on`] = $(`bz${i}_on`).checked;
    p[`bz${i}Preset`] = $(`bz${i}Preset`).value;
    p[`bz${i}_who`] = $(`bz${i}_who`).value;
  }
  return p;
}

/* Display units for the wealth chart. conv() maps a nominal-UAH value at
 * month m (with FX rate fx) into the chosen unit. */
function unitDef(unit, ctx) {
  const dUAH = (m) => Math.pow(1 + ctx.inflPct / 100, m / 12);
  const dUSD = (m) => Math.pow(1 + ctx.usdInflPct / 100, m / 12);
  switch (unit) {
    case 'uah-real':
      return { conv: (v, m) => v / dUAH(m), fmt: uah, short: (v) => moneyShort(v, '₴'), tag: 'today’s ₴' };
    case 'usd':
      return { conv: (v, m, fx) => v / fx, fmt: usd, short: (v) => moneyShort(v, '$'), tag: 'nominal $' };
    case 'usd-real':
      return { conv: (v, m, fx) => v / fx / dUSD(m), fmt: usd, short: (v) => moneyShort(v, '$'), tag: 'today’s $' };
    default:
      return { conv: (v) => v, fmt: uah, short: (v) => moneyShort(v, '₴'), tag: 'nominal ₴' };
  }
}

/* ---------- wealth line chart (N series + crosshair tooltip) ---------- */
function renderWealthChart(res, unit) {
  const host = $('chartWealth');
  host.innerHTML = '';
  const U = unitDef(unit, res.ctx);
  const W = 720, H = 300, m = { t: 12, r: 60, b: 28, l: 56 };
  const iw = W - m.l - m.r, ih = H - m.t - m.b;

  const defs = res.seriesDefs;
  const N = defs.length;
  const pts = res.series.map((s) => ({
    m: s.m,
    v: s.v.map((val) => U.conv(val, s.m, s.fx)),
  }));
  const vals = pts.flatMap((s) => s.v);
  const { lo, hi, ticks } = niceTicks(Math.min(...vals), Math.max(...vals));
  const x = (mm) => m.l + (mm / res.months) * iw;
  const y = (v) => m.t + ih - ((v - lo) / (hi - lo)) * ih;

  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Net worth over time: ' + defs.map((d) => d.legend).join(' vs ') }, host);
  drawGrid(svg, ticks, m, iw, y, U.short);
  el('line', { class: 'axisline', x1: m.l, x2: m.l + iw, y1: m.t + ih, y2: m.t + ih }, svg);
  drawYearLabels(svg, res.months, x, H);

  const css = getComputedStyle(document.body);
  const colors = defs.map((d, i) => css.getPropertyValue(`--series-${i + 1}`).trim());
  defs.forEach((d, i) => {
    const path = pts.map((s, k) => (k ? 'L' : 'M') + x(s.m).toFixed(1) + ' ' + y(s.v[i]).toFixed(1)).join('');
    el('path', { class: 'series', d: path, stroke: colors[i] }, svg);
  });

  const lastPt = pts[pts.length - 1];
  drawEndLabels(svg, defs.map((d, i) => ({ i, y: y(lastPt.v[i]), text: d.short })), colors, m, iw);

  addChartHover({ svg, W, m, iw, ih, nDots: N, colors, onMove: (px) => {
    const mm = Math.max(0, Math.min(res.months, Math.round(((px - m.l) / iw) * res.months)));
    const s = pts[mm];
    const cx = x(mm);
    let rows = defs.map((d, i) =>
      `<div class="t-row"><span><span class="swatch" style="background:${colors[i]}"></span> ${d.short}</span><span class="v">${U.fmt(s.v[i])}</span></div>`
    ).join('');
    if (N === 2 && res.diffLabel) {
      rows += `<div class="t-row"><span>${res.diffLabel}</span><span class="v">${signed(s.v[1] - s.v[0], U.fmt)}</span></div>`;
    }
    return { cx, dots: defs.map((d, i) => ({ cx, cy: y(s.v[i]) })),
      html: `<div class="t-head">Year ${(mm / 12).toFixed(1)} · ${U.tag}</div>` + rows };
  }});

  $('legendWealth').innerHTML = defs.map((d, i) =>
    `<span class="key"><span class="swatch" style="background:${colors[i]}"></span>${d.legend}</span>`
  ).join('');
}

/* ---------- diverging bars: components of the final advantage ---------- */
function renderWhyChart(res) {
  const host = $('chartWhy');
  host.innerHTML = '';
  $('whyTitle').textContent = res.whyTitle;
  const rows = res.whyRows;

  const W = 720, rowH = 32, m = { l: 250, r: 90, t: 6, b: 6 };
  const H = rows.length * rowH + m.t + m.b;
  const maxAbs = Math.max(...rows.map((r) => Math.abs(r.v)), 1);
  const half = (W - m.l - m.r) / 2;
  const x0 = m.l + half;
  const scale = (v) => (v / maxAbs) * (half - 64); // reserve room for value labels

  const css = getComputedStyle(document.body);
  const cPos = css.getPropertyValue('--div-pos').trim();
  const cNeg = css.getPropertyValue('--div-neg').trim();

  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': res.whyTitle }, host);
  el('line', { class: 'axisline', x1: x0, x2: x0, y1: m.t, y2: H - m.b }, svg);

  rows.forEach((r, i) => {
    const yC = m.t + i * rowH + rowH / 2;
    const w = Math.abs(scale(r.v));
    const bx = r.v >= 0 ? x0 : x0 - w;
    el('rect', {
      x: bx, y: yC - 8, width: Math.max(w, 0.5), height: 16, rx: 4,
      fill: r.v >= 0 ? cPos : cNeg, opacity: r.total ? 1 : 0.85,
    }, svg);
    const lab = el('text', { class: r.total ? 'barvalue' : 'barlabel', x: m.l - 8, y: yC + 4, 'text-anchor': 'end' }, svg);
    lab.textContent = r.label;
    const vx = r.v >= 0 ? x0 + w + 6 : x0 - w - 6;
    el('text', {
      class: 'barvalue', x: vx, y: yC + 4,
      'text-anchor': r.v >= 0 ? 'start' : 'end',
    }, svg).textContent = uahShort(r.v);
  });
}

/* ---------- macro chart: FX and price levels, indexed to today = 1× ---------- */
function renderMacroChart(p, months) {
  const host = $('chartMacro');
  host.innerHTML = '';
  const W = 720, H = 260, m = { t: 12, r: 88, b: 28, l: 46 };
  const iw = W - m.l - m.r, ih = H - m.t - m.b;

  const defs = [
    { short: 'UAH/USD rate', slot: 5, f: (mm) => Math.pow(1 + p.devalPct / 100, mm / 12) },
    { short: 'UAH prices', slot: 6, f: (mm) => Math.pow(1 + p.inflPct / 100, mm / 12) },
    { short: 'USD prices', slot: 7, f: (mm) => Math.pow(1 + p.usdInflPct / 100, mm / 12) },
  ];
  const pts = [];
  for (let mm = 0; mm <= months; mm++) pts.push({ m: mm, v: defs.map((d) => d.f(mm)) });

  const vals = pts.flatMap((s) => s.v);
  const mult = (v) => v.toFixed(v < 3 ? 1 : 0) + '×';
  const { lo, hi, ticks } = niceTicks(Math.min(...vals, 1), Math.max(...vals));
  const x = (mm) => m.l + (mm / months) * iw;
  const y = (v) => m.t + ih - ((v - lo) / (hi - lo)) * ih;

  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Assumed growth of the exchange rate and price levels, indexed to today' }, host);
  drawGrid(svg, ticks, m, iw, y, mult);
  el('line', { class: 'axisline', x1: m.l, x2: m.l + iw, y1: m.t + ih, y2: m.t + ih }, svg);
  drawYearLabels(svg, months, x, H);

  const css = getComputedStyle(document.body);
  const colors = defs.map((d) => css.getPropertyValue(`--series-${d.slot}`).trim());
  defs.forEach((d, i) => {
    const path = pts.map((s, k) => (k ? 'L' : 'M') + x(s.m).toFixed(1) + ' ' + y(s.v[i]).toFixed(1)).join('');
    el('path', { class: 'series', d: path, stroke: colors[i] }, svg);
  });

  const lastPt = pts[pts.length - 1];
  drawEndLabels(svg, defs.map((d, i) => ({ i, y: y(lastPt.v[i]), text: d.short })), colors, m, iw);

  addChartHover({ svg, W, m, iw, ih, nDots: 3, colors, onMove: (px) => {
    const mm = Math.max(0, Math.min(months, Math.round(((px - m.l) / iw) * months)));
    const s = pts[mm];
    const cx = x(mm);
    const fxNow = p.fx0 * s.v[0];
    const detail = [
      `${fxNow.toFixed(1)} ₴/$ (${mult(s.v[0])})`,
      `₴100 today costs ${uah(100 * s.v[1])}`,
      `$100 today costs ${usd(100 * s.v[2])}`,
    ];
    return { cx, dots: defs.map((d, i) => ({ cx, cy: y(s.v[i]) })),
      html: `<div class="t-head">Year ${(mm / 12).toFixed(1)}</div>` +
        defs.map((d, i) =>
          `<div class="t-row"><span><span class="swatch" style="background:${colors[i]}"></span> ${d.short}</span><span class="v">${detail[i]}</span></div>`
        ).join('') };
  }});

  $('legendMacro').innerHTML = defs.map((d, i) =>
    `<span class="key"><span class="swatch" style="background:${colors[i]}"></span>${d.short}</span>`
  ).join('');
}

/* ---------- sensitivity chart: sweep one input, compare outcomes ---------- */
function renderSweepChart(res, p) {
  const host = $('chartSweep');
  host.innerHTML = '';
  const defsList = SWEEPS[mode];
  let selId = sweepChoice[mode];
  if (!defsList.some((d) => d.id === selId)) selId = defsList[0].id;
  sweepChoice[mode] = selId;

  const selEl = $('sweepParam');
  selEl.innerHTML = defsList.map((d) =>
    `<option value="${d.id}" ${d.id === selId ? 'selected' : ''}>${d.label}</option>`).join('');

  const cfg = defsList.find((d) => d.id === selId);
  const cur = p[cfg.id];
  const values = (cfg.dyn ? cfg.dyn(p) : cfg.values).slice();
  if (!values.includes(cur)) values.push(cur);
  values.sort((a, b) => a - b);

  const xfmt = cfg.unit === '%' ? (v) => v + '%'
    : cfg.unit === 'y' ? (v) => v + 'y'
    : cfg.unit === 'n' ? (v) => String(v)
    : (v) => moneyShort(v, p.savingsCurrency === 'USD' ? '$' : '₴');

  // one full simulation per swept value (current value reuses this render's
  // run — except for `apply` sweeps, which re-derive linked params even at
  // the current value so the whole line follows one consistent rule)
  const todayUSD = (v, r) =>
    v / r.ctx.fxEnd / Math.pow(1 + r.ctx.usdInflPct / 100, r.ctx.horizonYears);
  const runs = values.map((v) => {
    const r = !cfg.apply && v === cur ? res
      : MODULES[mode].run(cfg.apply ? cfg.apply(p, v) : { ...p, [cfg.id]: v });
    const finals = r.series[r.series.length - 1].v.map((f) => todayUSD(f, r));
    return { v, finals, flags: r.flags };
  });
  const curRun = runs.find((r) => r.v === cur);

  /* In the car/home tabs the engine equalizes cash flows across paths, so
   * absolute levels shift with the swept input for every path at once — only
   * gaps between paths are meaningful. Plot each path's advantage over the
   * baseline there; the life tab's budget engine produces real absolute
   * wealth, so plot it directly. */
  const defs = res.seriesDefs;
  const base = mode === 'life' ? null : (res.baselineIndex || 0);
  const lines = defs.map((d, i) => i).filter((i) => i !== base);
  const val = (r, i) => (base === null ? r.finals[i] : r.finals[i] - r.finals[base]);

  const W = 720, H = 260, m = { t: 12, r: 88, b: 28, l: 56 };
  const iw = W - m.l - m.r, ih = H - m.t - m.b;
  const vmin = values[0], vmax = values[values.length - 1];
  const allY = runs.flatMap((r) => lines.map((i) => val(r, i)));
  const { lo, hi, ticks } = niceTicks(Math.min(...allY, 0), Math.max(...allY, 0));
  const x = (v) => m.l + ((v - vmin) / Math.max(1e-9, vmax - vmin)) * iw;
  const y = (v) => m.t + ih - ((v - lo) / (hi - lo)) * ih;

  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': base === null
    ? `Final net worth in today's dollars for each path as ${cfg.label} varies`
    : `Advantage over ${defs[base].legend} in today's dollars as ${cfg.label} varies` }, host);
  drawGrid(svg, ticks, m, iw, y, (v) => moneyShort(v, '$'));
  el('line', { class: 'axisline', x1: m.l, x2: m.l + iw, y1: m.t + ih, y2: m.t + ih }, svg);
  if (base !== null && lo < 0 && hi > 0) {
    el('line', { class: 'axisline', x1: m.l, x2: m.l + iw, y1: y(0), y2: y(0) }, svg);
  }
  for (const v of values) {
    el('text', { x: x(v), y: H - 8, 'text-anchor': 'middle' }, svg).textContent = xfmt(v);
  }

  // dashed marker at the current setting
  el('line', { class: 'nowline', x1: x(cur), x2: x(cur), y1: m.t, y2: m.t + ih }, svg);
  el('text', { x: x(cur) + 4, y: m.t + 10 }, svg).textContent = 'now';

  const css = getComputedStyle(document.body);
  const colors = defs.map((d, i) => css.getPropertyValue(`--series-${i + 1}`).trim());
  lines.forEach((i) => {
    const path = runs.map((r, k) => (k ? 'L' : 'M') + x(r.v).toFixed(1) + ' ' + y(val(r, i)).toFixed(1)).join('');
    el('path', { class: 'series', d: path, stroke: colors[i] }, svg);
  });

  const lastRun = runs[runs.length - 1];
  drawEndLabels(svg, lines.map((i) => ({ i, y: y(val(lastRun, i)), text: defs[i].short })), colors, m, iw);

  addChartHover({ svg, W, m, iw, ih, nDots: lines.length, colors: lines.map((i) => colors[i]), onMove: (px) => {
    let k = 0;
    for (let j = 1; j < runs.length; j++) {
      if (Math.abs(x(runs[j].v) - px) < Math.abs(x(runs[k].v) - px)) k = j;
    }
    const r = runs[k];
    const cx = x(r.v);
    return { cx, dots: lines.map((i) => ({ cx, cy: y(val(r, i)) })),
      html: `<div class="t-head">${cfg.label.split(',')[0]} ${xfmt(r.v)} · ` +
        `${base === null ? "today’s $" : 'vs ' + defs[base].short.toLowerCase() + ", today’s $"} (Δ vs now)</div>` +
        lines.map((i) => {
          const delta = val(r, i) - val(curRun, i);
          const flag = r.flags && r.flags[i] ? ' ⚠' : '';
          const shown = base === null ? usd(val(r, i)) : signed(val(r, i), usd);
          return `<div class="t-row"><span><span class="swatch" style="background:${colors[i]}"></span> ${defs[i].short}${flag}</span>` +
            `<span class="v">${shown} (${r.v === cur ? 'now' : signed(delta, usd)})</span></div>`;
        }).join('') };
  }});

  $('legendSweep').innerHTML =
    lines.map((i) =>
      `<span class="key"><span class="swatch" style="background:${colors[i]}"></span>${defs[i].legend}${base !== null ? ' − ' + defs[base].short.toLowerCase() : ''}</span>`
    ).join('') +
    (base !== null ? `<span class="key">(each line = advantage over ${defs[base].legend.toLowerCase()})</span>` : '');

  // takeaway: does the winning path change along the sweep, and which path
  // does this input move the most?
  const winnerAt = (r) => {
    if (base === null) { // budget engine: feasible paths first, then wealth
      let w = 0;
      defs.forEach((d, i) => {
        const feas = !(r.flags && r.flags[i]), wFeas = !(r.flags && r.flags[w]);
        if ((feas && !wFeas) || (feas === wFeas && r.finals[i] > r.finals[w])) w = i;
      });
      return w;
    }
    let w = base; // baseline "wins" while every advantage line is below zero
    for (const i of lines) if (val(r, i) > (w === base ? 0 : val(r, w))) w = i;
    return w;
  };
  const segments = [];
  for (const r of runs) {
    const w = winnerAt(r);
    if (segments.length && segments[segments.length - 1].w === w) segments[segments.length - 1].to = r.v;
    else segments.push({ w, from: r.v, to: r.v });
  }
  const winnerText = segments.length === 1
    ? `Best path across this whole range: ${defs[segments[0].w].legend.toLowerCase()}. `
    : `Best path changes along the range: ` +
      segments.map((s) => `${defs[s.w].legend.toLowerCase()} (${s.from === s.to ? 'only at ' + xfmt(s.from) : xfmt(s.from) + '–' + xfmt(s.to)})`).join(', ') + '. ';

  const spread = lines.map((i) => {
    const ys = runs.map((r) => val(r, i));
    return Math.max(...ys) - Math.min(...ys);
  });
  const iMax = lines[spread.indexOf(Math.max(...spread))];
  if (Math.max(...spread) < 100) {
    $('sweepNote').textContent = winnerText + 'This input barely moves any of the outcomes with the current settings.';
  } else {
    const best = runs.reduce((a, r) => (val(r, iMax) > val(a, iMax) ? r : a));
    const gain = val(best, iMax) - val(curRun, iMax);
    $('sweepNote').textContent = winnerText +
      `Most affected: ${defs[iMax].legend.toLowerCase()}${base !== null ? ' (vs ' + defs[base].legend.toLowerCase() + ')' : ''} — ` +
      (Math.abs(gain) < 1
        ? `your current ${xfmt(cur)} is already its best value in this range.`
        : `its best value here is ${xfmt(best.v)}, worth ${signed(gain, usd)} in today’s dollars ` +
          `vs your current ${xfmt(cur)}.`);
  }
}

/* ---------- mortgage variants: lead over renting per variant ----------
 * Mort tab only. Uses the run already computed by mortSim: each line is one
 * variant's lead over the renting path in today's dollars, so zero-crossings
 * mark the month a variant starts paying off. */
function renderMortCompare(res, p) {
  const card = $('mortCard');
  card.hidden = mode !== 'mort';
  $('payCard').hidden = card.hidden;
  $('debtCard').hidden = card.hidden;
  if (card.hidden) return;
  const host = $('chartMort');
  host.innerHTML = '';
  const baseName = 'renting';

  const dUSD = (mm) => Math.pow(1 + p.usdInflPct / 100, mm / 12);
  const runs = res.variants.map((v, k) => ({
    ...v,
    diff: res.series.map((pt) => (pt.v[k + 1] - pt.v[0]) / pt.fx / dUSD(pt.m)),
    be: v.be, minV: v.minTodayUSD, minM: v.minMonth,
    label: `${k + 1}. ${v.legend}`,
    slot: k + 2, // color slot matches the wealth chart (rent is slot 1)
  }));
  const months = res.months;

  const W = 720, H = 260, m = { t: 12, r: 96, b: 28, l: 56 };
  const iw = W - m.l - m.r, ih = H - m.t - m.b;
  const vals = runs.flatMap((r) => r.diff);
  const { lo, hi, ticks } = niceTicks(Math.min(...vals, 0), Math.max(...vals, 0));
  const x = (mm) => m.l + (mm / months) * iw;
  const y = (v) => m.t + ih - ((v - lo) / (hi - lo)) * ih;

  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label':
    `Mortgage variants' lead over ${baseName} in today's dollars over time` }, host);
  drawGrid(svg, ticks, m, iw, y, (v) => moneyShort(v, '$'));
  el('line', { class: 'axisline', x1: m.l, x2: m.l + iw, y1: m.t + ih, y2: m.t + ih }, svg);
  if (lo < 0 && hi > 0) {
    el('line', { class: 'axisline', x1: m.l, x2: m.l + iw, y1: y(0), y2: y(0) }, svg);
  }
  drawYearLabels(svg, months, x, H);

  const css = getComputedStyle(document.body);
  const colors = runs.map((r) => css.getPropertyValue(`--series-${r.slot}`).trim());
  runs.forEach((r, i) => {
    const path = r.diff.map((v, mm) => (mm ? 'L' : 'M') + x(mm).toFixed(1) + ' ' + y(v).toFixed(1)).join('');
    el('path', { class: 'series', d: path, stroke: colors[i] }, svg);
  });

  drawEndLabels(svg, runs.map((r, i) => ({ i, y: y(r.diff[months]), text: `${r.dp}%/${r.yrs}y` })), colors, m, iw);

  addChartHover({ svg, W, m, iw, ih, nDots: runs.length, colors, onMove: (px) => {
    const mm = Math.max(0, Math.min(months, Math.round(((px - m.l) / iw) * months)));
    const cx = x(mm);
    return { cx, dots: runs.map((r, i) => ({ cx, cy: y(r.diff[mm]) })),
      html: `<div class="t-head">Year ${(mm / 12).toFixed(1)} · lead over ${baseName}, today's $</div>` +
        runs.map((r, i) =>
          `<div class="t-row"><span><span class="swatch" style="background:${colors[i]}"></span> ${r.label}</span>` +
          `<span class="v">${signed(r.diff[mm], usd)}</span></div>`
        ).join('') };
  }});

  $('legendMort').innerHTML = runs.map((r, i) =>
    `<span class="key"><span class="swatch" style="background:${colors[i]}"></span>${r.label}</span>`
  ).join('') + `<span class="key">(each line = mortgage minus ${baseName})</span>`;

  const fmtBE = (r) =>
    r.be === null ? `not within ${p.horizonYears}y`
      : r.be === 0 ? 'from day 1'
      : `year ${(r.be / 12).toFixed(1)}`;
  const fxEnd = res.ctx.fxEnd;
  $('mortTable').innerHTML =
    `<table class="mort-table"><thead><tr>` +
    `<th class="l">Variant</th><th>Down payment</th><th>Loan payment/mo</th>` +
    `<th>Deepest minus</th><th>In the plus from</th><th>Debt at ${p.horizonYears}y</th>` +
    `<th>At ${p.horizonYears}y</th>` +
    `</tr></thead><tbody>` +
    runs.map((r, i) => {
      const fin = r.diff[months];
      return `<tr>
        <td class="l"><span class="swatch" style="background:${colors[i]}"></span> ${r.label}</td>
        <td>${usd(r.dpAmount / p.fx0)}</td>
        <td>${r.annuity > 0 ? uah(r.annuity) : '—'}</td>
        <td class="${r.minV < 0 ? 'bad' : 'good'}">${signed(r.minV, usd)}${r.minV < 0 ? ` (yr ${(r.minM / 12).toFixed(1)})` : ''}</td>
        <td>${fmtBE(r)}</td>
        <td>${r.debtLeft > 0.5 ? `${usd(r.debtLeft / fxEnd)} (${uah(r.debtLeft)})` : 'paid off'}</td>
        <td class="${fin >= 0 ? 'good' : 'bad'}">${signed(fin, usd)}</td>
      </tr>`;
    }).join('') + '</tbody></table>';

  // debt chart: what you still owe the bank, per variant
  const debtHost = $('chartDebt');
  debtHost.innerHTML = '';
  const debtUSD = $('debtUnit').value !== 'uah';
  const debtVal = (r, mm) => debtUSD ? r.debtHist[mm] / res.series[mm].fx : r.debtHist[mm];
  {
    const W = 720, H = 260, m2 = { t: 12, r: 96, b: 28, l: 60 };
    const iw = W - m2.l - m2.r, ih = H - m2.t - m2.b;
    const maxDebt = Math.max(...runs.map((r) => debtVal(r, 0)), 1);
    const { lo, hi, ticks } = niceTicks(0, maxDebt);
    const x = (mm) => m2.l + (mm / months) * iw;
    const y = (v) => m2.t + ih - ((v - lo) / (hi - lo)) * ih;
    const sym = debtUSD ? '$' : '₴';
    const fmt = debtUSD ? usd : uah;

    const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img',
      'aria-label': 'Remaining loan debt over time per variant' }, debtHost);
    drawGrid(svg, ticks, m2, iw, y, (v) => moneyShort(v, sym));
    el('line', { class: 'axisline', x1: m2.l, x2: m2.l + iw, y1: m2.t + ih, y2: m2.t + ih }, svg);
    drawYearLabels(svg, months, x, H);
    runs.forEach((r, i) => {
      const path = r.debtHist.map((v, mm) =>
        (mm ? 'L' : 'M') + x(mm).toFixed(1) + ' ' + y(debtVal(r, mm)).toFixed(1)).join('');
      el('path', { class: 'series', d: path, stroke: colors[i] }, svg);
    });

    drawEndLabels(svg,
      runs.map((r, i) => ({ i, y: y(debtVal(r, months)), text: `${r.dp}%/${r.yrs}y` }))
        .filter((_, i) => runs[i].debtHist[months] >= 0.5),
      colors, m2, iw);

    addChartHover({ svg, W, m: m2, iw, ih, nDots: runs.length, colors, onMove: (px) => {
      const mm = Math.max(0, Math.min(months, Math.round(((px - m2.l) / iw) * months)));
      const cx = x(mm);
      return { cx, dots: runs.map((r) => ({ cx, cy: y(debtVal(r, mm)) })),
        html: `<div class="t-head">Year ${(mm / 12).toFixed(1)} · debt left · rate ${res.series[mm].fx.toFixed(1)} ₴/$</div>` +
          runs.map((r, i) =>
            `<div class="t-row"><span><span class="swatch" style="background:${colors[i]}"></span> ${r.label}</span>` +
            `<span class="v">${r.debtHist[mm] < 0.5 ? 'paid off' : fmt(debtVal(r, mm))}</span></div>`
          ).join('') };
    }});

    $('legendDebt').innerHTML = runs.map((r, i) =>
      `<span class="key"><span class="swatch" style="background:${colors[i]}"></span>${r.label}</span>`
    ).join('');
  }

  // payments card: what each variant costs per month/year at the start
  const salaryUAH0 = p.salaryAmt * (p.salaryCurrency === 'USD' ? p.fx0 : 1);
  $('payTable').innerHTML =
    `<table class="mort-table"><thead><tr>` +
    `<th class="l">Variant</th><th>Down payment</th><th>Loan (you owe)</th><th>Annuity ₴/mo</th>` +
    `<th>+ insurance</th><th>+ maintenance</th><th>Total / month</th>` +
    `<th>Total / year</th><th>% of salary</th>` +
    `</tr></thead><tbody>` +
    runs.map((r, i) => {
      const tot = r.annuity + r.ins1 + r.maint1;
      const share = salaryUAH0 > 0 ? tot / salaryUAH0 * 100 : 0;
      return `<tr>
        <td class="l"><span class="swatch" style="background:${colors[i]}"></span> ${r.label}</td>
        <td>${usd(r.dpAmount / p.fx0)} (${uah(r.dpAmount)})</td>
        <td>${r.principal > 0.5 ? `${usd(r.principal / p.fx0)} (${uah(r.principal)})` : '—'}</td>
        <td>${r.annuity > 0 ? `${uah(r.annuity)} (${usd(r.annuity / p.fx0)})` : '—'}</td>
        <td>${r.ins1 > 0 ? uah(r.ins1) : '—'}</td>
        <td>${uah(r.maint1)}</td>
        <td><strong>${uah(tot)}</strong> (${usd(tot / p.fx0)})</td>
        <td>${uah(tot * 12)} (${usd(tot * 12 / p.fx0)})</td>
        <td class="${share > 50 ? 'bad' : share > 40 ? '' : 'good'}">${share.toFixed(0)}%</td>
      </tr>`;
    }).join('') + '</tbody></table>' +
    (salaryUAH0 > 0
      ? `<p class="chart-sub">Salary today: ${uah(salaryUAH0)}/mo${p.salaryCurrency === 'USD' ? ` ($${p.salaryAmt})` : ''} — banks usually cap the payment at ~40–50% of income.</p>`
      : '');
}

/* ---------- two scenarios side by side: with and without inflation ----------
 * Mort tab only. Each scenario is one dp% + term + horizon combination, run
 * through the full simulation on its own. The chart plots the scenario's lead
 * over renting twice: in nominal dollars (inflation baked in) and in today's
 * dollars (US CPI removed). Both charts share one y-scale for comparability. */
function renderScenarioCompare(p) {
  const card = $('scCard');
  card.hidden = mode !== 'mort';
  if (card.hidden) return;

  const scen = [1, 2].map((n) => {
    const dp = Math.min(100, Math.max(0, p[`sc${n}_dpPct`]));
    const yrs = Math.min(30, Math.max(1, p[`sc${n}_years`]));
    const hor = Math.min(30, Math.max(1, p[`sc${n}_horizonYr`]));
    const p2 = { ...p, horizonYears: hor };
    for (let i = 1; i <= 10; i++) p2[`mv${i}_on`] = false;
    p2.mv1_on = true; p2.mv1_dpPct = dp; p2.mv1_years = yrs;
    const s = mortRun(p2);
    const nom = s.r.series.map((pt) => (pt.v[1] - pt.v[0]) / pt.fx);
    const real = nom.map((d, m) => d / Math.pow(1 + p.usdInflPct / 100, m / 12));
    let lastNeg = -1, minReal = Infinity, minM = 0;
    nom.forEach((d, m) => { if (d < 0) lastNeg = m; });
    real.forEach((d, m) => { if (d < minReal) { minReal = d; minM = m; } });
    return {
      tag: 'AB'[n - 1], dp, yrs, hor, months: s.months,
      v: s.variants[0], nom, real, minReal, minM,
      be: lastNeg === -1 ? 0 : lastNeg >= s.months ? null : lastNeg + 1,
    };
  });

  // one shared y-domain so the two charts are directly comparable
  const allVals = scen.flatMap((s) => s.nom.concat(s.real));
  const dom = niceTicks(Math.min(...allVals, 0), Math.max(...allVals, 0));

  const css = getComputedStyle(document.body);
  const cNom = css.getPropertyValue('--series-3').trim();
  const cReal = css.getPropertyValue('--series-1').trim();
  const tip = $('tooltip');

  scen.forEach((s, n) => {
    const host = $(`chartSc${n + 1}`);
    host.innerHTML = '';
    const W = 460, H = 280, m = { t: 14, r: 14, b: 28, l: 56 };
    const iw = W - m.l - m.r, ih = H - m.t - m.b;
    const { lo, hi, ticks } = dom;
    const x = (mm) => m.l + (mm / s.months) * iw;
    const y = (v) => m.t + ih - ((v - lo) / (hi - lo)) * ih;

    const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label':
      `Scenario ${s.tag}: lead over renting, nominal vs today's dollars` }, host);
    drawGrid(svg, ticks, m, iw, y, (v) => moneyShort(v, '$'));
    el('line', { class: 'axisline', x1: m.l, x2: m.l + iw, y1: m.t + ih, y2: m.t + ih }, svg);
    if (lo < 0 && hi > 0) {
      el('line', { class: 'axisline', x1: m.l, x2: m.l + iw, y1: y(0), y2: y(0) }, svg);
    }
    drawYearLabels(svg, s.months, x, H);
    [[s.nom, cNom], [s.real, cReal]].forEach(([data, color]) => {
      const path = data.map((v, mm) => (mm ? 'L' : 'M') + x(mm).toFixed(1) + ' ' + y(v).toFixed(1)).join('');
      el('path', { class: 'series', d: path, stroke: color }, svg);
    });

    addChartHover({ svg, W, m, iw, ih, nDots: 2, colors: [cNom, cReal], onMove: (px) => {
      const mm = Math.max(0, Math.min(s.months, Math.round(((px - m.l) / iw) * s.months)));
      const cx = x(mm);
      return { cx, dots: [{ cx, cy: y(s.nom[mm]) }, { cx, cy: y(s.real[mm]) }],
        html: `<div class="t-head">Scenario ${s.tag} · Year ${(mm / 12).toFixed(1)} · lead over renting</div>` +
          `<div class="t-row"><span><span class="swatch" style="background:${cNom}"></span> Nominal $</span><span class="v">${signed(s.nom[mm], usd)}</span></div>` +
          `<div class="t-row"><span><span class="swatch" style="background:${cReal}"></span> Today's $</span><span class="v">${signed(s.real[mm], usd)}</span></div>` };
    }});

    $(`legendSc${n + 1}`).innerHTML =
      `<span class="key"><strong>${s.tag} — ${s.dp}% down / ${s.yrs}y term / ${s.hor}y horizon</strong></span>` +
      `<span class="key"><span class="swatch" style="background:${cNom}"></span>nominal $ (with inflation)</span>` +
      `<span class="key"><span class="swatch" style="background:${cReal}"></span>today's $ (inflation removed)</span>`;
    const debtLeft = s.v.debtEnd();
    const fin = ` · at ${s.hor}y ${signed(s.nom[s.months], usd)} nominal / ${signed(s.real[s.months], usd)} today’s`;
    $(`noteSc${n + 1}`).textContent =
      `Payment ${s.v.annuity > 0 ? uah(s.v.annuity) + '/mo' : '— (cash buy)'}` +
      ` · deepest minus ${signed(s.minReal, usd)}${s.minReal < 0 ? ` (yr ${(s.minM / 12).toFixed(1)})` : ''}` +
      ` · in the plus ${s.be === null ? 'not within ' + s.hor + 'y' : s.be === 0 ? 'from day 1' : 'from year ' + (s.be / 12).toFixed(1)}` +
      fin +
      ` · debt left ${debtLeft > 0.5 ? uah(debtLeft) : 'none — paid off'}`;
  });
}

/* ---------- outcomes card: what you end up with, in today's dollars ---------- */
const baselineChoice = {}; // per mode, user-selected comparison baseline

function renderOutcomes(res, p) {
  const host = $('outcomes');
  const defs = res.seriesDefs;
  const finals = res.series[res.series.length - 1].v;
  const todayUSD = (v) => v / res.ctx.fxEnd / Math.pow(1 + p.usdInflPct / 100, p.horizonYears);

  let base = baselineChoice[mode];
  if (base === undefined || base >= defs.length) base = res.baselineIndex || 0;

  const css = getComputedStyle(document.body);
  const order = defs.map((d, i) => i).sort((i, j) => finals[j] - finals[i]);

  const sel = `<select id="baselineSel" class="unit-select">` +
    defs.map((d, i) => `<option value="${i}" ${i === base ? 'selected' : ''}>${d.legend}</option>`).join('') +
    `</select>`;
  const rows = order.map((i) => {
    const dUSD = todayUSD(finals[i] - finals[base]);
    const delta = i === base
      ? '<span class="o-delta muted">baseline</span>'
      : `<span class="o-delta ${dUSD >= 0 ? 'good' : 'bad'}">${signed(dUSD, usd)}</span>`;
    const color = css.getPropertyValue(`--series-${i + 1}`).trim();
    const flag = res.flags && res.flags[i]
      ? `<span class="warn o-flag">⚠ ${res.flags[i]}</span>` : '';
    return `<div class="o-row">
      <span class="o-name"><span class="swatch" style="background:${color}"></span>${defs[i].legend}${flag}</span>
      <span class="o-val">${usd(todayUSD(finals[i]))}</span>${delta}</div>`;
  }).join('');
  host.innerHTML =
    `<div class="o-head"><span>What you end up with, in today's dollars</span><span class="o-base">compared with ${sel}</span></div>` +
    `<div class="o-sub">Your net worth after ${p.horizonYears} years on each path — assets minus remaining debt — ` +
    `converted to dollars with today's purchasing power. The right column shows how much more (green) or less (red) ` +
    `each path leaves you than the one picked as the comparison point.</div>` + rows;

  $('baselineSel').addEventListener('change', (e) => {
    baselineChoice[mode] = parseInt(e.target.value, 10);
    render();
  });
}

/* ---------- burden chart: required payments as % of salary ---------- */
function renderBurdenChart(res, p) {
  const host = $('chartBurden');
  host.innerHTML = '';
  const defs = res.seriesDefs;
  const W = 720, H = 240, m = { t: 12, r: 88, b: 28, l: 46 };
  const iw = W - m.l - m.r, ih = H - m.t - m.b;

  const salUSD = p.salaryCurrency === 'USD';
  const salaryUAH = (mm, fx) =>
    p.salaryAmt * Math.pow(1 + p.salaryGrowthPct / 100, mm / 12) * (salUSD ? fx : 1);

  // monthly obligations exist from series[1] on; delayed one-time outlays
  // (a future down payment) are excluded — they aren't a recurring payment
  const oneOff = (i, mm) => res.oneOffs
    ? res.oneOffs[i].reduce((sum, o) => sum + (o.month === mm ? o.uah : 0), 0)
    : 0;
  const pts = res.series.slice(1).map((s) => ({
    m: s.m,
    fx: s.fx,
    v: s.obl.map((o, i) => ((o - oneOff(i, s.m)) / salaryUAH(s.m, s.fx)) * 100),
    obl: s.obl.map((o, i) => o - oneOff(i, s.m)),
  }));
  const vals = pts.flatMap((s) => s.v);
  const { lo, hi, ticks } = niceTicks(Math.min(...vals, 0), Math.max(...vals, 10));
  const x = (mm) => m.l + ((mm - 1) / Math.max(1, res.months - 1)) * iw;
  const y = (v) => m.t + ih - ((v - lo) / (hi - lo)) * ih;

  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Required payments as percent of salary over time' }, host);
  drawGrid(svg, ticks, m, iw, y, (v) => Math.round(v) + '%');
  el('line', { class: 'axisline', x1: m.l, x2: m.l + iw, y1: y(Math.max(lo, 0)), y2: y(Math.max(lo, 0)) }, svg);
  const years = res.months / 12;
  const yearStep = years > 20 ? 5 : years > 10 ? 2 : 1;
  drawYearLabels(svg, res.months, x, H, yearStep);

  const css = getComputedStyle(document.body);
  const colors = defs.map((d, i) => css.getPropertyValue(`--series-${i + 1}`).trim());
  defs.forEach((d, i) => {
    const path = pts.map((s, k) => (k ? 'L' : 'M') + x(s.m).toFixed(1) + ' ' + y(s.v[i]).toFixed(1)).join('');
    el('path', { class: 'series', d: path, stroke: colors[i] }, svg);
  });

  const lastPt = pts[pts.length - 1];
  drawEndLabels(svg, defs.map((d, i) => ({ i, y: y(lastPt.v[i]), text: d.short })), colors, m, iw);

  addChartHover({ svg, W, m, iw, ih, nDots: defs.length, colors, onMove: (px) => {
    const k = Math.max(0, Math.min(pts.length - 1,
      Math.round(((px - m.l) / iw) * (pts.length - 1))));
    const s = pts[k];
    const cx = x(s.m);
    const pay = (o) => salUSD ? usd(o / s.fx) : uah(o);
    return { cx, dots: defs.map((d, i) => ({ cx, cy: y(s.v[i]) })),
      html: `<div class="t-head">Year ${(s.m / 12).toFixed(1)} · salary ${salUSD ? usd(p.salaryAmt * Math.pow(1 + p.salaryGrowthPct / 100, s.m / 12)) : uah(salaryUAH(s.m, s.fx))}/mo</div>` +
        defs.map((d, i) =>
          `<div class="t-row"><span><span class="swatch" style="background:${colors[i]}"></span> ${d.short}</span><span class="v">${s.v[i].toFixed(0)}% · ${pay(s.obl[i])}</span></div>`
        ).join('') };
  }});

  $('legendBurden').innerHTML = defs.map((d, i) =>
    `<span class="key"><span class="swatch" style="background:${colors[i]}"></span>${d.legend}</span>`
  ).join('');

  // affordability note: banks cap debt service around 40–50% of income
  const worst = Math.max(...pts[0].v);
  $('burdenWarn').innerHTML = worst > 50
    ? `<span class="warn">⚠ month-1 payments are ${worst.toFixed(0)}% of salary — banks usually cap at ~40–50%</span>`
    : '';
}

/* ---------- scoreboard: ranked decisions by weighted score ---------- */
function renderScoreboard(res) {
  const host = $('scoreboard');
  if (!res.scoreboard) { host.hidden = true; return; }
  host.hidden = false;
  const css = getComputedStyle(document.body);
  const rows = res.scoreboard.rows.map((row, rank) => {
    const color = css.getPropertyValue(`--series-${row.i + 1}`).trim();
    const parts = Object.entries(row.parts)
      .map(([k, v]) => `${k} ${v.toFixed(0)}`).join(' · ');
    const flags = [row.flag, row.crisisFlag].filter(Boolean)
      .map((f) => `<span class="warn o-flag">⚠ ${f}</span>`).join('');
    return `<div class="s-row">
      <span class="s-rank">${rank + 1}</span>
      <span class="s-name"><span class="swatch" style="background:${color}"></span>${row.name}${flags}</span>
      <span class="s-bar"><span class="s-fill" style="width:${Math.max(2, row.score).toFixed(1)}%;background:${color}"></span></span>
      <span class="s-score">${row.score.toFixed(0)}</span>
      <span class="s-parts">${parts}</span>
    </div>`;
  }).join('');
  host.innerHTML =
    `<div class="o-head"><span>Decision ranking — weighted score out of 100</span></div>` +
    `<div class="o-sub">Each path scored on wealth, crisis resilience, payment stress, liquidity and lifestyle, ` +
    `mixed with your weights from “What matters to you”. Wealth and crisis scores are relative to the other paths on screen. ` +
    `Paths that don’t fit your budget rank last regardless of score.</div>` + rows;
}

/* ---------- verdict, KPIs, table ---------- */
function kpi(k) {
  return `<div class="kpi"><div class="label">${k.label}</div><div class="value ${k.cls || ''}">${k.value}</div>${k.delta ? `<div class="delta">${k.delta}</div>` : ''}</div>`;
}

/* ---------- car finder (find mode) ----------
 * A different kind of result — a ranked, vetted short-list rather than a wealth
 * curve — so it renders into its own card and hides the financial charts. */
let finderData = null;    // listings fetched live or pasted, reused across re-renders
let finderStatus = '';    // one-line status/error shown in the finder toolbar
let finderRes = null;     // last findCars() result, reused by the sortable table
let finderSort = { key: 'score', dir: -1 };  // column sort state
const finderFilters = { q: '', region: 'any', status: 'any', minScore: 0 };
const finderExpanded = new Set(); // listing ids with the score breakdown open
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function readFinderParams() {
  const p = { ...PARAM_DEFAULTS };
  const numIds = ['cf_yearMin', 'cf_yearMax', 'cf_priceMinUSD', 'cf_priceMaxUSD',
    'cf_mileageMaxKm', 'cf_topN', 'cf_w_price', 'cf_w_mileage', 'cf_w_age',
    'cf_w_condition', 'cf_w_history'];
  for (const id of numIds) { const e = $(id); if (e) p[id] = parseFloat(e.value) || 0; }
  const txtIds = ['cf_make', 'cf_model', 'cf_bodyType', 'cf_apiKey', 'cf_allowDamageTypes',
    'cf_rulesText', 'cf_source', 'cf_region', 'cf_fuel', 'cf_gearbox'];
  for (const id of txtIds) { const e = $(id); if (e) p[id] = e.value; }
  p.cf_allowDamaged = $('cf_allowDamaged').checked;
  p.cf_useBuiltinRules = $('cf_useBuiltinRules').checked;
  p.fx0 = parseFloat($('fx0').value) || 41.7;
  return p;
}

function currentFinderListings() {
  const t = $('cf_listingsText').value.trim();
  if (t) {
    try { const a = JSON.parse(t); if (Array.isArray(a) && a.length) return a; }
    catch (e) { finderStatus = 'JSON помилка у вставлених оголошеннях: ' + e.message; }
  }
  if (finderData) return finderData;
  return CF_SAMPLE_LISTINGS;
}

async function cfLiveSearch() {
  const p = readFinderParams();
  if (p.cf_source === 'sample') { finderStatus = 'Для живого пошуку оберіть джерело (AUTO.RIA / mobile.de).'; renderFinder(); return; }
  finderStatus = 'Завантаження з ' + p.cf_source + '…'; renderFinder();
  try {
    const src = CF_SOURCES[p.cf_source];
    const listings = await src.fetchLive(p);
    finderData = listings;
    finderStatus = `Отримано ${listings.length} оголошень з ${src.label}.`;
  } catch (e) {
    finderStatus = 'Живий пошук не вдався: ' + e.message +
      ' — у браузері це часто CORS; спробуйте `node cli.js find --live` або вставте оголошення вручну.';
  }
  renderFinder();
}

const CF_STAT = { ok: '✓', warn: '⚠', fail: '✕', skip: '?' };

function cfItemHTML(e, rank) {
  const l = e.listing;
  const scls = e.score >= 70 ? 'good' : e.score >= 50 ? 'mid' : 'bad';
  const specs = [
    l.year || '—',
    cfNumUAHless(l.mileageKm) + ' км',
    l.fuel !== 'unknown' ? l.fuel : null,
    l.gearbox !== 'unknown' ? l.gearbox : null,
    l.region + (l.country ? ' · ' + l.country : ''),
    l.seller !== 'unknown' ? l.seller : null,
  ].filter(Boolean).map(esc).join(' · ');
  const vsMkt = Math.round((e.priceRatio - 1) * 100);
  const flags = e.flags.map((f) => `<span class="cf-flag">⚠ ${esc(f)}</span>`).join('');
  const boosts = e.boosts.map((b) =>
    `<span class="cf-boost ${b.pts >= 0 ? 'good' : 'bad'}">${b.pts >= 0 ? '+' : ''}${b.pts} ${esc(b.why)}</span>`).join('');
  const checks = ['vin', 'history', 'damage', 'ai'].map((id) => {
    const c = e.checks[id];
    return `<div class="cf-check ${c.status}"><span class="cf-cstat">${CF_STAT[c.status] || '?'}</span>` +
      `<span class="cf-clabel">${esc(c.label)}</span>` +
      `<span class="cf-cfind">${esc((c.findings || []).join('; '))}</span></div>`;
  }).join('');
  const title = l.url
    ? `<a href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.title)}</a>`
    : esc(l.title);
  return `<div class="cf-item">
    <div class="cf-head">
      <span class="cf-rank">${rank}</span>
      <span class="cf-score ${scls}">${e.score}</span>
      <span class="cf-title">${title}<span class="cf-src">${esc(l.source)}</span></span>
      <span class="cf-price">$${cfNumUAHless(l.priceUSD)}<span class="cf-vsmkt ${vsMkt <= 0 ? 'good' : 'bad'}">${vsMkt >= 0 ? '+' : ''}${vsMkt}% до ринку</span></span>
    </div>
    <div class="cf-specs">${specs}${l.vin ? ' · VIN ' + esc(l.vin) : ' · без VIN'}</div>
    ${flags || boosts ? `<div class="cf-tags">${flags}${boosts}</div>` : ''}
    <div class="cf-checks">${checks}</div>
    <details class="cf-ai"><summary>AI-промпт для перевірки відповідності</summary><pre>${esc(e.aiPrompt)}</pre></details>
  </div>`;
}
// finder uses its own thousands formatter to avoid the ₴ symbol
const cfNumUAHless = (v) => new Intl.NumberFormat('uk-UA', { maximumFractionDigits: 0 }).format(Math.round(v || 0));

function renderFinder() {
  $('results').classList.add('finder-only');
  $('quickbar').innerHTML = ''; // finder has no quick-scenario chips
  const card = $('finderCard');
  card.hidden = false;

  const p = readFinderParams();
  finderStatus = ''; // recomputed below if listings parse fails
  const listings = currentFinderListings();
  let res;
  try { res = findCars(p, listings); }
  catch (e) { card.innerHTML = `<div class="verdict cash-wins"><strong>Помилка підбору:</strong> ${esc(e.message)}</div>`; return; }

  const best = res.results[0];
  const verdict = best
    ? `<strong>Знайдено ${res.passed} з ${res.scanned}. Лідер: ${esc(best.listing.title)} — ${best.score}/100`
      + (best.flags.length ? ', з застереженнями' : '') + `.</strong>`
      + `<div class="why">Відсіяно ${res.rejected.length} (фільтри та правила). Активних правил: ${res.ruleCount}. `
      + `Медіана ринку у вибірці: $${cfNumUAHless(res.marketStats.overall)}.</div>`
    : `<strong>Нічого не підійшло під фільтри.</strong><div class="why">Пом'якшіть фільтри або змініть джерело. Відсіяно ${res.rejected.length}.</div>`;

  const ruleErr = res.ruleErrors.length
    ? `<div class="cf-banner warn">Помилки у правилах: ${res.ruleErrors.map(esc).join(' · ')}</div>` : '';

  const srcSel = p.cf_source;
  const toolbar = `<div class="cf-toolbar">
      <button id="cfLiveBtn" class="chip"${srcSel === 'sample' ? ' disabled title="оберіть джерело для живого пошуку"' : ''}>⟳ Живий пошук (${esc(srcSel)})</button>
      <span class="cf-status">${esc(finderStatus)}</span>
    </div>`;

  // client-side controls over the computed set: search + region/status/min-score
  const regions = ['any', ...Array.from(new Set(res.evaluated.map((e) => e.listing.region)))];
  const controls = `<div class="cf-controls">
      <input type="text" class="cf-q" placeholder="Пошук: марка, модель, місто, VIN…" value="${esc(finderFilters.q)}">
      <select class="cf-fregion">${regions.map((r) => `<option value="${r}"${finderFilters.region === r ? ' selected' : ''}>${r === 'any' ? 'Всі регіони' : r}</option>`).join('')}</select>
      <select class="cf-fstatus">
        <option value="any"${finderFilters.status === 'any' ? ' selected' : ''}>Будь-який статус</option>
        <option value="ok"${finderFilters.status === 'ok' ? ' selected' : ''}>Без застережень</option>
        <option value="flag"${finderFilters.status === 'flag' ? ' selected' : ''}>Із застереженнями</option>
        <option value="clean"${finderFilters.status === 'clean' ? ' selected' : ''}>Без відмітки ДТП</option>
      </select>
      <label class="cf-minlbl">бал ≥ <input type="number" class="cf-fmin" min="0" max="100" step="5" value="${finderFilters.minScore}"></label>
      <span class="cf-count"></span>
    </div>`;

  const rej = res.rejected.length
    ? `<details class="cf-rejected"><summary>Відсіяно: ${res.rejected.length}</summary>` +
      res.rejected.slice(0, 60).map((r) =>
        `<div class="cf-rej"><span class="cf-rstage ${r.stage}">${r.stage === 'rule' ? 'правило' : 'фільтр'}</span> ` +
        `${esc(r.listing.title)} — ${esc(r.reasons.join('; '))}</div>`).join('') +
      '</details>' : '';

  const checksNote = `<div class="cf-note">Клік по заголовку колонки — сортування; ▸ у рядку — розбір балу та перевірки (VIN, історія, пошкодження, AI). ` +
    `Реальні реєстри та ІІ підключаються через <code>cf_providers</code>; у демо-режимі — прозорі евристики.</div>`;

  card.innerHTML =
    `<div class="verdict${best && !best.flags.length ? '' : ' cash-wins'}">${verdict}</div>` +
    ruleErr + toolbar +
    `<div class="kpis">${res.kpis.map(kpi).join('')}</div>` +
    controls +
    `<div class="cf-table-wrap" id="cfTable"></div>` +
    rej + checksNote;

  finderRes = res;
  renderFinderTable();
  const btn = $('cfLiveBtn');
  if (btn) btn.onclick = cfLiveSearch;
}

/* Human-readable breakdown of why a score is high or low. Each scoring
 * dimension (0–100) is turned into a labelled bar + a plus/minus note. */
const CF_PART_LABELS = { price: 'Ціна відносно ринку', mileage: 'Пробіг за вік', age: 'Вік авто', condition: 'Стан / пошкодження', history: 'Історія / чистота' };
function cfScoreExplain(e) {
  const p = e.parts || {};
  const cls = (v) => v >= 67 ? 'good' : v >= 45 ? 'mid' : 'bad';
  const bars = Object.keys(CF_PART_LABELS).map((k) => {
    const v = Math.round(p[k] || 0);
    return `<div class="cf-part"><span class="cf-pl">${CF_PART_LABELS[k]}</span>` +
      `<span class="cf-pbar"><span class="cf-pfill ${cls(v)}" style="width:${v}%"></span></span>` +
      `<span class="cf-pv ${cls(v)}">${v}</span></div>`;
  }).join('');
  // verbal summary: what pulls the score up / down
  const up = [], down = [];
  const vs = Math.round((e.priceRatio - 1) * 100);
  if (vs <= -8) up.push(`дешевше ринку на ${-vs}%`); else if (vs >= 10) down.push(`дорожче ринку на ${vs}%`);
  if ((p.mileage || 0) >= 67) up.push('невеликий пробіг для віку'); else if ((p.mileage || 0) < 45) down.push('великий пробіг для віку');
  if ((p.age || 0) >= 67) up.push('свіжий рік'); else if ((p.age || 0) < 40) down.push('вік');
  if (!e.listing.damaged) up.push('без пошкоджень'); else down.push('ДТП — потрібна перевірка VIN/об’єму');
  if ((e.checks.vin && e.checks.vin.status === 'ok')) up.push('VIN валідний'); else if (e.listing.vin === '') down.push('немає VIN');
  const boosts = (e.boosts || []).map((b) => `${b.pts >= 0 ? '+' : ''}${b.pts} ${esc(b.why.split('#')[0])}`).join(', ');
  return `<div class="cf-explain">
      <div class="cf-parts">${bars}</div>
      <div class="cf-verbal">
        ${up.length ? `<div class="cf-up">▲ Підвищує: ${up.map(esc).join(', ')}.</div>` : ''}
        ${down.length ? `<div class="cf-down">▼ Знижує: ${down.map(esc).join(', ')}.</div>` : ''}
        ${boosts ? `<div class="cf-adj">Правила: ${boosts}.</div>` : ''}
        <div class="cf-formula">Підсумок = зважена сума × ваги (ціна ${finderRes.params.cf_w_price}, пробіг ${finderRes.params.cf_w_mileage}, вік ${finderRes.params.cf_w_age}, стан ${finderRes.params.cf_w_condition}, історія ${finderRes.params.cf_w_history}) + 15% AI ± правила.</div>
      </div>
    </div>`;
}

const CF_SORTVAL = {
  score: (e) => e.score,
  car: (e) => (e.listing.make + ' ' + e.listing.model + ' ' + e.listing.year).toLowerCase(),
  year: (e) => e.listing.year,
  price: (e) => e.listing.priceUSD,
  mileage: (e) => e.listing.mileageKm || 0,
  region: (e) => e.listing.region,
  status: (e) => e.flags.length,
};
const CF_COLS = [
  { key: 'score', label: 'Бал' }, { key: 'car', label: 'Авто' }, { key: 'year', label: 'Рік' },
  { key: 'price', label: 'Ціна' }, { key: 'mileage', label: 'Пробіг' },
  { key: 'region', label: 'Регіон' }, { key: 'status', label: 'Статус' },
];

function renderFinderTable() {
  const host = $('cfTable');
  if (!host || !finderRes) return;
  const q = finderFilters.q.trim().toLowerCase();
  let rows = finderRes.evaluated.filter((e) => {
    const l = e.listing;
    if (q && !((l.title + ' ' + (l._raw.city || '') + ' ' + l.vin).toLowerCase().includes(q))) return false;
    if (finderFilters.region !== 'any' && l.region !== finderFilters.region) return false;
    if (finderFilters.minScore && e.score < finderFilters.minScore) return false;
    if (finderFilters.status === 'ok' && e.flags.length) return false;
    if (finderFilters.status === 'flag' && !e.flags.length) return false;
    if (finderFilters.status === 'clean' && l.damaged) return false;
    return true;
  });
  const { key, dir } = finderSort;
  const val = CF_SORTVAL[key] || CF_SORTVAL.score;
  rows.sort((a, b) => { const x = val(a), y = val(b); return (x < y ? -1 : x > y ? 1 : 0) * dir; });

  const head = `<tr><th class="cf-rk">#</th>` + CF_COLS.map((c) =>
    `<th data-sort="${c.key}" class="cf-sortable${finderSort.key === c.key ? ' active' : ''}">${c.label}` +
    `<span class="cf-arrow">${finderSort.key === c.key ? (dir < 0 ? '▾' : '▴') : ''}</span></th>`).join('') + `</tr>`;

  const body = rows.map((e, i) => {
    const l = e.listing;
    const scls = e.score >= 70 ? 'good' : e.score >= 55 ? 'mid' : 'bad';
    const vs = Math.round((e.priceRatio - 1) * 100);
    const open = finderExpanded.has(l.id);
    const status = l.damaged
      ? `<span class="cf-st vin">⚠ перевірити VIN</span>`
      : `<span class="cf-st ok">без відмітки ДТП</span>`;
    const flags = e.flags.map((f) => `<span class="cf-fl">${esc(f)}</span>`).join('');
    const main = `<tr class="cf-trow${open ? ' open' : ''}" data-id="${esc(l.id)}">
      <td class="cf-rk">${i + 1}</td>
      <td><span class="cf-score ${scls}">${e.score}</span></td>
      <td class="cf-car"><button class="cf-exp" data-id="${esc(l.id)}" aria-label="розгорнути">${open ? '▾' : '▸'}</button>` +
        `<a href="${esc(l.url || '#')}" target="_blank" rel="noopener">${esc(l.make)} ${esc(l.model)}</a>` +
        `<span class="cf-city">${esc(l._raw.city || l.source || '')}</span></td>
      <td class="cf-num">${l.year || '—'}</td>
      <td class="cf-num">$${cfNumUAHless(l.priceUSD)}<span class="cf-vs ${vs <= 0 ? 'g' : 'r'}">${vs >= 0 ? '+' : ''}${vs}%</span></td>
      <td class="cf-num">${l.mileageKm ? cfNumUAHless(l.mileageKm) : '—'}</td>
      <td>${esc(l.region)}</td>
      <td class="cf-stcell">${status}${flags}</td>
    </tr>`;
    const detail = open
      ? `<tr class="cf-drow"><td colspan="8">${cfScoreExplain(e)}${cfChecksHTML(e)}</td></tr>`
      : '';
    return main + detail;
  }).join('');

  host.innerHTML = `<table class="cf-table"><thead>${head}</thead><tbody>${body || '<tr><td colspan="8" class="cf-empty">Нічого не знайдено під фільтри таблиці</td></tr>'}</tbody></table>`;
  const cnt = document.querySelector('.cf-count');
  if (cnt) cnt.textContent = `${rows.length} з ${finderRes.evaluated.length}`;
}

/* the 4 vetting checks as chips + findings (used inside an expanded row) */
function cfChecksHTML(e) {
  return `<div class="cf-checks">` + ['vin', 'history', 'damage', 'ai'].map((id) => {
    const c = e.checks[id];
    return `<div class="cf-check ${c.status}"><span class="cf-cstat">${CF_STAT[c.status] || '?'}</span>` +
      `<span class="cf-clabel">${esc(c.label)}</span>` +
      `<span class="cf-cfind">${esc((c.findings || []).join('; '))}</span></div>`;
  }).join('') + `</div>` +
    `<details class="cf-ai"><summary>AI-промпт для перевірки відповідності</summary><pre>${esc(e.aiPrompt)}</pre></details>`;
}

function syncURL() {
  const p = readParams();
  const qs = new URLSearchParams();
  qs.set('mode', mode);
  for (const k in PARAM_DEFAULTS) {
    const v = p[k];
    if (v === undefined || v === null) continue;
    if (Array.isArray(v)) qs.set(k, v.join(','));
    else qs.set(k, String(v));
  }
  history.replaceState(null, '', '?' + qs.toString());
}

function render() {
  syncCarFields();
  if (mode === 'find') { renderFinder(); syncURL(); return; }
  $('results').classList.remove('finder-only');
  $('finderCard').hidden = true;
  // PPP link: devaluation follows the inflation differential when checked
  const ppp = $('pppLink').checked;
  $('devalPct').disabled = ppp;
  // "don't invest" greys out the yield inputs; currency stays active — cash
  // still sits in UAH or USD and that choice still matters under devaluation
  const invOff = $('investOff').checked;
  for (const id of ['invPreset', 'invYieldPct', 'invTaxPct', 'yieldDriftPp']) {
    $(id).disabled = invOff;
  }
  if (ppp) {
    const d = pppDevaluation(
      parseFloat($('inflPct').value) || 0,
      parseFloat($('usdInflPct').value) || 0
    );
    $('devalPct').value = d.toFixed(1);
  }

  const p = readParams();
  const res = MODULES[mode].run(p);
  const { adv, ctx } = res;
  const wins = adv >= 0;
  const advRealUAH = adv / Math.pow(1 + ctx.inflPct / 100, ctx.horizonYears);
  const advUSD = adv / ctx.fxEnd;
  const advRealUSD = advUSD / Math.pow(1 + ctx.usdInflPct / 100, ctx.horizonYears);

  const v = $('verdict');
  if (res.verdict) { // module supplies its own verdict (life decision ranking)
    v.className = 'verdict';
    v.innerHTML = res.verdict;
  } else {
    v.className = 'verdict' + (wins ? '' : ' cash-wins');
    v.innerHTML =
      `<strong>${wins ? res.posName : res.negName} wins: you keep ${usd(Math.abs(advRealUSD))} more, in today’s money</strong>` +
      `<div class="why">${wins ? res.whyPos : res.whyNeg}</div>` +
      `<div class="units">Same advantage in other units: ${uah(Math.abs(adv))} nominal ₴ · ` +
      `${uah(Math.abs(advRealUAH))} in today’s ₴ · ${usd(Math.abs(advUSD))} nominal $ at the horizon’s exchange rate.</div>`;
  }

  $('kpis').innerHTML = res.kpis.map(kpi).join('');
  renderScoreboard(res);
  if (res.bizBreakEven !== undefined) {
    $('bizBreakEven').textContent = res.bizBreakEven === null
      ? `Does not repay the ${usd(p.biz_investUSD)} investment within ${p.horizonYears} years — ` +
        `monthly profit after tax and bills is too small.`
      : `Breaks even in month ${res.bizBreakEven} (year ${(res.bizBreakEven / 12).toFixed(1)}): ` +
        `cumulative profit after tax and bills repays the ${usd(p.biz_investUSD)} investment ` +
        `(not counting the salary you give up).`;
  }
  renderOutcomes(res, p);
  renderWealthChart(res, $('chartUnit').value);
  renderMortCompare(res, p);
  renderScenarioCompare(p);
  renderBurdenChart(res, p);
  renderWhyChart(res);
  renderSweepChart(res, p);
  renderMacroChart(p, res.months);
  renderQuickbar();

  const outOfPocket = [['section', 'Total out of pocket over the horizon']]
    .concat(res.seriesDefs.map((d, i) =>
      [d.legend, `${uah(res.paid[i])} (${usd(res.paidUSD[i])} at payment-time rates)`]));

  $('detailTable').innerHTML = res.tableRows
    .concat(outOfPocket)
    .concat([[
      `Advantage — nominal ₴ / today’s ₴ / nominal $ / today’s $`,
      `${uahSigned(adv)} / ${uahSigned(advRealUAH)} / ${signed(advUSD, usd)} / ${signed(advRealUSD, usd)}`,
    ]])
    .map((r) => r[0] === 'section'
      ? `<tr class="section"><td colspan="2">${r[1]}</td></tr>`
      : `<tr><td>${r[0]}</td><td>${r[1]}</td></tr>`)
    .join('');
  syncURL();
}

/* ---------- tabs ---------- */
function setMode(next) {
  mode = next;
  document.querySelectorAll('.tabs .tab').forEach((b) =>
    b.classList.toggle('active', b.dataset.mode === mode));
  document.querySelectorAll('#inputs section[data-mode]').forEach((s) =>
    s.hidden = !s.dataset.mode.split(' ').includes(mode));
  $('introSub').textContent = INTROS[mode];
  render();
}
document.querySelectorAll('.tabs .tab').forEach((b) =>
  b.addEventListener('click', () => setMode(b.dataset.mode)));

/* ---------- events ---------- */
$('invPreset').addEventListener('change', () => {
  const pre = INV_PRESETS[$('invPreset').value];
  if (pre) {
    $('invCurrency').value = pre.invCurrency;
    $('invYieldPct').value = pre.invYieldPct;
    $('invTaxPct').value = pre.invTaxPct;
  }
  render();
});
for (const id of ['invCurrency', 'invYieldPct', 'invTaxPct']) {
  $(id).addEventListener('input', () => { $('invPreset').value = 'custom'; });
}
for (const selId in SCENARIO_PRESETS) {
  const groups = SCENARIO_PRESETS[selId];
  $(selId).addEventListener('change', () => {
    applyScenarioPreset(selId, $(selId).value);
    render();
  });
  // editing any field a preset controls flips the select back to "custom"
  const fields = new Set(Object.values(groups).flatMap((g) => Object.keys(g)));
  for (const fieldId of fields) {
    $(fieldId).addEventListener('input', () => { $(selId).value = 'custom'; });
  }
}
$('quickbar').addEventListener('click', (e) => {
  const chip = e.target.closest('.chip');
  if (!chip) return;
  applyScenarioPreset(chip.dataset.sel, chip.dataset.val);
  render();
});
// cap the number of decisions to compare so every path keeps a distinct color
for (const id of LIFE_DEC_IDS) {
  $('d_' + id).addEventListener('change', (e) => {
    const n = LIFE_DEC_IDS.filter((k) => $('d_' + k).checked).length;
    if (n > LIFE_MAX_ACTIVE) {
      e.target.checked = false;
      render();
    }
  });
}
function syncCarFields() {
  for (const s of EV_SLOTS) {
    const on = $('e' + s + '_on').checked;
    const type = $('e' + s + '_type').value;
    const section = $('e' + s + '_type').closest('section');
    for (const lbl of section.querySelectorAll(':scope > label')) {
      if (lbl.dataset.showFor) {
        lbl.hidden = !on || !lbl.dataset.showFor.split(' ').includes(type);
      } else {
        lbl.hidden = !on;
      }
    }
  }
}
document.getElementById('inputs').addEventListener('input', rafDebounce(render));
document.getElementById('inputs').addEventListener('change', (e) => {
  if (e.target.tagName === 'SELECT' && /_type$/.test(e.target.id)) syncCarFields();
  if (e.target.type === 'checkbox' && /_on$/.test(e.target.id)) syncCarFields();
});
$('scCard').addEventListener('input', rafDebounce(render));

/* finder results: column sort, row expand, and in-table filters — these only
 * re-render the table body, so the filter inputs keep focus while typing. */
$('finderCard').addEventListener('click', (e) => {
  const th = e.target.closest('th[data-sort]');
  if (th) {
    const k = th.dataset.sort;
    if (finderSort.key === k) finderSort.dir *= -1;
    else finderSort = { key: k, dir: (k === 'car' || k === 'region') ? 1 : -1 };
    renderFinderTable();
    return;
  }
  const exp = e.target.closest('.cf-exp');
  if (exp) {
    const id = exp.dataset.id;
    if (finderExpanded.has(id)) finderExpanded.delete(id); else finderExpanded.add(id);
    renderFinderTable();
  }
});
$('finderCard').addEventListener('input', (e) => {
  if (e.target.classList.contains('cf-q')) { finderFilters.q = e.target.value; renderFinderTable(); }
  else if (e.target.classList.contains('cf-fmin')) { finderFilters.minScore = parseFloat(e.target.value) || 0; renderFinderTable(); }
});
$('finderCard').addEventListener('change', (e) => {
  if (e.target.classList.contains('cf-fregion')) { finderFilters.region = e.target.value; renderFinderTable(); }
  else if (e.target.classList.contains('cf-fstatus')) { finderFilters.status = e.target.value; renderFinderTable(); }
});
$('chartUnit').addEventListener('change', render);
$('debtUnit').addEventListener('change', render);
$('sweepParam').addEventListener('change', (e) => {
  sweepChoice[mode] = e.target.value;
  render();
});
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', render);

/* ---------- boot: defaults → URL overrides → render ----------
 * defaults.js is the single source of truth for input values; the URL can
 * override any parameter (?mode=life&savings=20000&lifeActive=edu,biz). */
function applyParamsToDOM(p) {
  for (const k in p) {
    if (k === 'lifeActive') {
      for (const id of LIFE_DEC_IDS) $('d_' + id).checked = p.lifeActive.includes(id);
      continue;
    }
    const el = $(k);
    if (!el) continue;
    if (el.type === 'checkbox') el.checked = !!p[k];
    else el.value = p[k];
  }
}

const urlParams = {};
let urlMode = null;
for (const [k, v] of new URLSearchParams(location.search)) {
  if (k === 'mode') { urlMode = v; continue; }
  if (!(k in PARAM_DEFAULTS)) continue;
  urlParams[k] = k === 'lifeActive' ? v.split(',').filter(Boolean)
    : v === 'true' ? true : v === 'false' ? false
    : v !== '' && !isNaN(+v) ? +v : v;
}
applyParamsToDOM({ ...PARAM_DEFAULTS, ...urlParams });

/* Programmatic API (browser console, Playwright, LLM agents):
 *   LDM.run('life', {savings: 20000})  → JSON summary, no UI involved
 *   LDM.apply('biz', {bz_scaleOn: true}) → set the UI and re-render */
const ALL_MODES = { ...MODULES, find: { finder: true } };
window.LDM = {
  defaults: PARAM_DEFAULTS,
  modes: Object.keys(ALL_MODES),
  run(m, overrides = {}) {
    const p = { ...PARAM_DEFAULTS, ...overrides };
    if (m === 'find') return cfSummarize(findCars(p, overrides.listings || CF_SAMPLE_LISTINGS));
    return summarizeResult(m, MODULES[m].run(p), p);
  },
  apply(m, overrides = {}) {
    applyParamsToDOM({ ...readParams(), ...overrides });
    setMode(ALL_MODES[m] ? m : mode);
  },
};

syncCarFields();
setMode(urlMode && ALL_MODES[urlMode] ? urlMode : 'car');
