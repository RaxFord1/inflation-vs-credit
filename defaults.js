/*
 * Canonical parameter defaults and the machine-readable result summary.
 * Single source of truth for every simulation input: the browser UI applies
 * these to the sidebar at boot, and cli.js merges overrides onto them for
 * headless runs. Loaded both as a plain <script> and inside cli.js's vm.
 *
 * All *USD amounts are dollars, *UAH amounts are hryvnia, *Pct are percent
 * per year unless the name says otherwise. See LLM_API.md for the full
 * reference.
 */

const PARAM_DEFAULTS = {
  /* --- macro & horizon --- */
  horizonYears: 5,
  fx0: 41.7,           // UAH per USD today
  inflPct: 11,         // UAH CPI, %/yr
  usdInflPct: 3,       // US CPI, %/yr
  devalPct: 8,         // UAH devaluation vs USD, %/yr

  /* --- deposits tab: where to keep money (route = destination × way in) ---
   * Fees are % of the moved amount + a fixed USD charge per transfer; entry
   * fees hit the initial amount and every monthly top-up, the exit fee is
   * subtracted from every chart point (take-home value). */
  dep_amountUSD: 10000,   // lump sum to place
  dep_topUpUSD: 200,      // added monthly through the same route
  dep_portfolio: false,   // portfolio mode: split money by share instead of full-sum comparison

  dep1_on: true, dep1_name: 'UA bank — USD deposit', dep1_cur: 'USD',
  dep1_comp: 'compound', dep1_ratePct: 2, dep1_taxPct: 23,
  dep1_feeInPct: 0, dep1_feeInFixUSD: 0, dep1_feeOutPct: 0, dep1_feeOutFixUSD: 0,
  dep1_monthlyFeeUSD: 0, dep1_sharePct: 40,

  dep2_on: true, dep2_name: 'US bank — HYSA', dep2_cur: 'USD',
  dep2_comp: 'compound', dep2_ratePct: 5, dep2_taxPct: 23,
  dep2_feeInPct: 0.5, dep2_feeInFixUSD: 30, dep2_feeOutPct: 0.5, dep2_feeOutFixUSD: 30,
  dep2_monthlyFeeUSD: 0, dep2_sharePct: 30,

  dep3_on: true, dep3_name: 'UA bank — UAH deposit', dep3_cur: 'UAH',
  dep3_comp: 'compound', dep3_ratePct: 13.5, dep3_taxPct: 23,
  dep3_feeInPct: 0, dep3_feeInFixUSD: 0, dep3_feeOutPct: 0, dep3_feeOutFixUSD: 0,
  dep3_monthlyFeeUSD: 0, dep3_sharePct: 30,

  dep4_on: false, dep4_name: 'OVDP bonds (UAH)', dep4_cur: 'UAH',
  dep4_comp: 'payout', dep4_ratePct: 16.5, dep4_taxPct: 0,
  dep4_feeInPct: 0, dep4_feeInFixUSD: 0, dep4_feeOutPct: 0, dep4_feeOutFixUSD: 0,
  dep4_monthlyFeeUSD: 0, dep4_sharePct: 0,

  dep5_on: false, dep5_name: 'Cash at home', dep5_cur: 'USD',
  dep5_comp: 'compound', dep5_ratePct: 0, dep5_taxPct: 0,
  dep5_feeInPct: 0, dep5_feeInFixUSD: 0, dep5_feeOutPct: 0, dep5_feeOutFixUSD: 0,
  dep5_monthlyFeeUSD: 0, dep5_sharePct: 0,

  dep6_on: false, dep6_name: 'EU bank via Wise', dep6_cur: 'USD',
  dep6_comp: 'compound', dep6_ratePct: 3, dep6_taxPct: 23,
  dep6_feeInPct: 0.7, dep6_feeInFixUSD: 3, dep6_feeOutPct: 0.7, dep6_feeOutFixUSD: 3,
  dep6_monthlyFeeUSD: 0, dep6_sharePct: 0,

  dep7_on: false, dep7_name: 'Route 7', dep7_cur: 'USD',
  dep7_comp: 'compound', dep7_ratePct: 4, dep7_taxPct: 23,
  dep7_feeInPct: 0, dep7_feeInFixUSD: 0, dep7_feeOutPct: 0, dep7_feeOutFixUSD: 0,
  dep7_monthlyFeeUSD: 0, dep7_sharePct: 0,

  dep8_on: false, dep8_name: 'Route 8', dep8_cur: 'UAH',
  dep8_comp: 'compound', dep8_ratePct: 10, dep8_taxPct: 23,
  dep8_feeInPct: 0, dep8_feeInFixUSD: 0, dep8_feeOutPct: 0, dep8_feeOutFixUSD: 0,
  dep8_monthlyFeeUSD: 0, dep8_sharePct: 0,

  /* --- your money (life & biz tabs) --- */
  savings: 10000,
  savingsCurrency: 'USD',
  salaryAmt: 1500,
  salaryCurrency: 'USD',
  salaryGrowthPct: 3,
  l_curRentUSD: 0,     // current housing cost, USD/month
  l_livExpUSD: 700,    // other living expenses, USD/month

  /* --- investment of free money --- */
  investOff: false,    // true → freed-up money sits as cash at 0% (clean price comparison)
  invCurrency: 'UAH',
  invYieldPct: 16.5,   // OVDP-like
  invTaxPct: 0,
  yieldDriftPp: 0,     // percentage points per year the yield drifts

  /* --- car purchase (car & life tabs) --- */
  price: 25000,
  priceCurrency: 'USD',
  carDepPct: 12,       // USD-terms depreciation, %/yr
  pensionPct: 3,       // pension fund fee, % of price
  regFeeUAH: 1500,
  cashDiscountPct: 0,  // positive = discount for cash
  dpPct: 30,           // down payment, %
  loanYears: 5,
  loanRatePct: 16,
  commissionPct: 1.5,  // one-time, % of loan
  monthlyFeeUAH: 0,
  kaskoPct: 5.5,       // % of car value per year, mandatory on credit
  kaskoCash: false,    // cash buyer also carries KASKO
  lifeInsPct: 0,       // %/yr of outstanding debt

  /* --- apartment purchase (home & life tabs) --- */
  h_price: 75000,      // USD
  h_apprPct: 2,        // USD-terms appreciation, %/yr
  h_feesPct: 2.5,      // purchase fees, % of price
  h_maintPct: 0.8,     // owner's maintenance, %/yr of value
  h_dpPct: 20,
  h_loanYears: 20,
  h_ratePct: 7,        // єОселя-like
  h_commPct: 1,
  h_insPct: 0.4,       // property insurance while mortgaged, %/yr of value
  h_rentUSD: 500,      // market rent for such a flat, USD/month
  h_rentGrowthPct: 2,  // USD terms
  h_ownRentUSD: 500,   // home tab buy-to-let: rent you pay yourself
  h_vacancyPct: 8,
  h_rentTaxPct: 23,

  /* --- mort tab: up to ten down-payment + term variants (100% dp = cash buy) --- */
  mv1_on: true,   mv1_dpPct: 10,  mv1_years: 20,
  mv2_on: true,   mv2_dpPct: 20,  mv2_years: 20,
  mv3_on: true,   mv3_dpPct: 30,  mv3_years: 20,
  mv4_on: true,   mv4_dpPct: 20,  mv4_years: 10,
  mv5_on: true,   mv5_dpPct: 30,  mv5_years: 15,
  mv6_on: true,   mv6_dpPct: 50,  mv6_years: 10,
  mv7_on: false,  mv7_dpPct: 50,  mv7_years: 20,
  mv8_on: false,  mv8_dpPct: 70,  mv8_years: 10,
  mv9_on: false,  mv9_dpPct: 40,  mv9_years: 7,
  mv10_on: false, mv10_dpPct: 100, mv10_years: 1,

  /* --- mort tab: two-scenario side-by-side charts (own dp/term/horizon each) --- */
  sc1_dpPct: 20, sc1_years: 20, sc1_horizonYr: 20,
  sc2_dpPct: 50, sc2_years: 10, sc2_horizonYr: 10,

  /* --- life tab: decisions to compare (besides "change nothing") --- */
  lifeActive: ['carCredit', 'flatLive', 'edu', 'biz', 'combo'],
  // available: carCash, carCredit, flatLive, flatBtl, edu, job, migrate, biz, combo (max 6)

  /* --- life tab: education --- */
  edu_costUSD: 3000,
  edu_months: 12,
  edu_dropPct: 0,      // income lost while studying, % of salary
  edu_bumpPct: 25,     // permanent raise afterwards, %

  /* --- life tab: job change --- */
  job_changePct: 15,   // pay change on switching, %
  job_newGrowthPct: 8, // salary growth at the new job, %/yr

  /* --- life tab: moving abroad --- */
  mig_costUSD: 3000,
  mig_salaryUSD: 3000,
  mig_rentUSD: 900,
  mig_livUSD: 1200,

  /* --- life tab: own business (always quit-and-run) --- */
  biz_investUSD: 15000,
  biz_rampMonths: 6,
  biz_revenueUSD: 4000,
  biz_costsUSD: 2000,  // operating bills, USD/month
  biz_taxPct: 6,       // % of revenue (FOP group 3 + levy)
  biz_growthPct: 10,   // revenue growth, %/yr
  biz_residualPct: 40, // resale value, % of investment

  /* --- life tab: combo (car now + flat later) --- */
  combo_flatDelayYr: 3,

  /* --- life tab: evaluation weights (0–10) and lifestyle scores (0–10) --- */
  w_wealth: 5, w_robust: 3, w_stress: 2, w_liq: 1, w_qol: 3,
  qol_nothing: 5, qol_carCash: 7, qol_carCredit: 6, qol_flatLive: 9,
  qol_flatBtl: 6, qol_edu: 7, qol_job: 6, qol_migrate: 5, qol_biz: 6,
  qol_combo: 8,

  /* --- biz tab: reality check & scaling (apply to every idea) --- */
  bz_revFactorPct: 100,  // every idea's revenue, % of its plan
  bz_costFactorPct: 100, // every idea's bills & staff, % of plan
  bz_scaleOn: true,
  bz_reinvestPct: 50,    // profit retained while expanding, %
  bz_unitCostPct: 80,    // next unit's cost, % of the original investment
  bz_maxUnits: 3,

  /* --- biz tab: idea slots (who: 'quit' | 'staff'; hoursWk is informational —
   * your hands-on hours per week if you run the unit yourself) --- */
  bz1_on: true,  bz1Preset: 'carwash', bz1_who: 'staff',
  bz1_investUSD: 70000, bz1_rampMonths: 9, bz1_revenueUSD: 4500,
  bz1_costsUSD: 1800, bz1_taxPct: 6, bz1_growthPct: 5,
  bz1_residualPct: 50, bz1_staffUSD: 300, bz1_hoursWk: 15,

  bz2_on: true,  bz2Preset: 'coffee', bz2_who: 'quit',
  bz2_investUSD: 10000, bz2_rampMonths: 3, bz2_revenueUSD: 3200,
  bz2_costsUSD: 2300, bz2_taxPct: 6, bz2_growthPct: 8,
  bz2_residualPct: 40, bz2_staffUSD: 800, bz2_hoursWk: 60,

  bz3_on: true,  bz3Preset: 'barber', bz3_who: 'quit',
  bz3_investUSD: 25000, bz3_rampMonths: 4, bz3_revenueUSD: 5500,
  bz3_costsUSD: 4100, bz3_taxPct: 6, bz3_growthPct: 6,
  bz3_residualPct: 30, bz3_staffUSD: 500, bz3_hoursWk: 45,

  bz4_on: false, bz4Preset: 'shop', bz4_who: 'quit',
  bz4_investUSD: 6000, bz4_rampMonths: 6, bz4_revenueUSD: 4000,
  bz4_costsUSD: 3300, bz4_taxPct: 6, bz4_growthPct: 15,
  bz4_residualPct: 10, bz4_staffUSD: 700, bz4_hoursWk: 45,

  /* --- EV switch tab: old gas car vs EV/PHEV --- */
  eo_valueUSD: 6000,       // current car market value
  eo_depPct: 8,            // current car depreciation, %/yr
  eo_consumption: 9,       // current car fuel consumption, L/100km
  eo_maintUSD: 90,         // current car maintenance, $/month
  eo_fuelType: 'petrol',   // 'petrol' | 'diesel' | 'lpg'

  ea_on: true,
  ea_priceUSD: 40000,      // car A purchase price
  ea_depPct: 12,           // car A depreciation, %/yr
  ea_type: 'ev',           // 'ev' | 'phev' | 'hev' | 'petrol' | 'diesel'
  ea_kwh: 15,              // car A electric consumption, kWh/100km
  ea_phevGas: 5.5,         // car A PHEV gas consumption, L/100km
  ea_phevElecPct: 65,      // car A PHEV share of electric driving, %
  ea_publicPct: 20,        // car A % of charging at public stations
  ea_maintUSD: 35,         // car A maintenance, $/month
  ea_label: 'Tesla Model 3',

  eb_on: true,
  eb_priceUSD: 52000,      // car B purchase price
  eb_depPct: 11,           // car B depreciation, %/yr
  eb_type: 'phev',         // 'ev' | 'phev' | 'hev' | 'petrol' | 'diesel'
  eb_kwh: 18,              // car B electric consumption, kWh/100km
  eb_phevGas: 5.5,         // car B PHEV gas consumption, L/100km
  eb_phevElecPct: 65,      // car B PHEV share of electric driving, %
  eb_publicPct: 20,        // car B % of charging at public stations
  eb_maintUSD: 55,         // car B maintenance, $/month
  eb_label: 'RAV4 PHEV',

  ec_on: false, ec_priceUSD: 28000, ec_depPct: 10, ec_type: 'hev',
  ec_kwh: 0, ec_phevGas: 5, ec_phevElecPct: 0, ec_publicPct: 0,
  ec_maintUSD: 45, ec_label: 'Camry Hybrid',

  ed_on: false, ed_priceUSD: 22000, ed_depPct: 9, ed_type: 'diesel',
  ed_kwh: 0, ed_phevGas: 6, ed_phevElecPct: 0, ed_publicPct: 0,
  ed_maintUSD: 60, ed_label: 'Tiguan Diesel',

  ee_on: false, ee_priceUSD: 15000, ee_depPct: 14, ee_type: 'petrol',
  ee_kwh: 0, ee_phevGas: 8, ee_phevElecPct: 0, ee_publicPct: 0,
  ee_maintUSD: 50, ee_label: 'Budget Petrol',

  ev_monthlyKm: 2000,      // monthly mileage, km
  ev_fuelUAH: 57,          // fuel price per liter, UAH (A-95)
  ev_dieselUAH: 55,        // diesel fuel price per liter, UAH
  ev_lpgUAH: 25,           // LPG price per liter, UAH
  ev_fuelGrowPct: 8,       // fuel price growth, %/yr
  ev_elecUAH: 4.32,        // electricity price per kWh, UAH
  ev_publicUAH: 12,        // public charger price per kWh, UAH
  ev_elecGrowPct: 5,       // electricity price growth, %/yr
  ev_sellOld: true,         // sell old car when buying new
  ev_transportUSD: 200,     // monthly taxi/transit cost if no car, USD
  ev_dpPct: 30,             // EV down payment, %
  ev_loanYears: 5,          // EV loan term
  ev_loanRatePct: 16,       // EV loan rate, %/yr
  ev_commissionPct: 1.5,    // EV loan one-time commission, %
  ev_kaskoPct: 5.5,         // EV KASKO, %/yr of car value
  ev_pensionPct: 3,         // EV pension fund fee, % of price
  ev_regFeeUAH: 1500,       // EV registration fee, UAH

  /* --- find tab: car finder & vetting (Ukraine / Europe) ---
   * Filters are hard cut-offs; '', 0 or 'any' means "don't filter on this".
   * cf_rulesText holds user rules in the text DSL (see carfinder.js); the
   * built-in rules run too unless cf_useBuiltinRules is false. Weights are the
   * relative importance of each scoring dimension (auto-normalized). */
  cf_source: 'sample',        // 'sample' | 'autoria' | 'mobilede' (live needs a key/provider)
  cf_apiKey: '',              // AUTO.RIA developer key (developer.ria.com), used by live search
  cf_make: 'Tesla',
  cf_model: '',
  cf_yearMin: 2018,
  cf_yearMax: 0,              // 0 = no upper bound
  cf_priceMinUSD: 0,
  cf_priceMaxUSD: 30000,
  cf_mileageMaxKm: 150000,
  cf_region: 'any',           // 'any' | 'UA' | 'EU' | 'US' | 'OTHER'
  cf_fuel: 'any',             // 'any' | petrol | diesel | EV | hybrid | gas
  cf_gearbox: 'any',          // 'any' | auto | manual
  cf_bodyType: 'any',
  cf_allowDamaged: true,      // let damaged cars through the filter (rules/checks still judge them)
  cf_allowDamageTypes: 'front,rear', // damage types you'd still consider (comma/space list)
  cf_topN: 10,
  cf_thisYear: 2026,
  cf_useBuiltinRules: true,
  cf_rulesText: '',           // extra rules, one per line: "reject: <cond>  # reason"
  // scoring weights (relative)
  cf_w_price: 30,
  cf_w_mileage: 20,
  cf_w_age: 15,
  cf_w_condition: 20,
  cf_w_history: 15,

  /* --- solar station tab (electricity resale + solar) --- */
  sol_capacityKW: 30,          // solar panel capacity, kW
  sol_panelCostPerKW: 650,     // panel + mounting, $/kW installed
  sol_batteryKWh: 20,          // battery storage capacity, kWh
  sol_batteryCostPerKWh: 400,  // battery cost, $/kWh
  sol_installUSD: 3000,        // inverter + wiring + permits, $
  sol_dpPct: 100,              // down payment, % (100 = cash, <100 = loan)
  sol_loanYears: 5,            // loan term, years
  sol_loanRatePct: 16,         // loan annual interest rate, %
  sol_taxPct: 5,               // tax on solar income (ФОП group 3 = 5% of revenue)
  sol_demandKWh: 5000,         // consumer demand, kWh/month
  sol_gridBuyUAH: 4.32,        // grid purchase price, UAH/kWh
  sol_gridBuyGrowPct: 10,      // grid price growth, %/yr
  sol_markupPct: 20,           // resale markup on grid electricity, %
  sol_solarSellUAH: 4.0,       // solar kWh sale price to consumers, UAH/kWh
  sol_solarSellGrowPct: 8,     // solar sell price growth, %/yr
  sol_feedInUAH: 2.5,          // feed-in tariff (excess → grid), UAH/kWh
  sol_feedInGrowPct: 5,        // feed-in tariff growth, %/yr
  sol_selfUseKWh: 0,           // own consumption from solar, kWh/month
  sol_overlapPct: 50,          // direct daytime overlap with consumer demand, %
  sol_demandPattern: 'flat',   // 'flat' | 'seasonal' (monthly demand profile)
  sol_region: 'central',       // 'central' | 'south' | 'west'
  sol_degradePct: 0.5,         // panel degradation, %/yr
  sol_battDegradePct: 2,       // battery capacity loss, %/yr
  sol_maintPct: 1.5,           // maintenance, % of system cost/yr
  sol_equipDepPct: 7,          // equipment depreciation (residual), %/yr
  sol_inverterReplaceYr: 12,   // inverter replacement, year
  sol_inverterCostPct: 15,     // inverter cost, % of total system
};

/* Machine-readable summary of a module result — everything an LLM needs
 * without parsing HTML or the month-by-month series. */
function summarizeResult(mode, res, p) {
  const yrs = res.ctx.horizonYears;
  const todayUSD = (v) =>
    v / res.ctx.fxEnd / Math.pow(1 + res.ctx.usdInflPct / 100, yrs);
  const finals = res.series[res.series.length - 1].v;
  const base = res.baselineIndex || 0;
  const strip = (h) =>
    (h || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

  return {
    mode,
    horizonYears: yrs,
    fxAtHorizon: +res.ctx.fxEnd.toFixed(2),
    verdict: res.verdict
      ? strip(res.verdict)
      : `${res.adv >= 0 ? res.posName : res.negName} wins by ` +
        `$${Math.abs(Math.round(todayUSD(res.adv)))} in today's dollars. ` +
        strip(res.adv >= 0 ? res.whyPos : res.whyNeg),
    baseline: res.seriesDefs[base].legend,
    paths: res.seriesDefs.map((d, i) => ({
      name: d.legend,
      finalNetWorthTodayUSD: Math.round(todayUSD(finals[i])),
      finalNetWorthUAH: Math.round(finals[i]),
      vsBaselineTodayUSD: Math.round(todayUSD(finals[i] - finals[base])),
      totalPaidOutUAH: Math.round(res.paid[i]),
      warning: (res.flags && res.flags[i]) || null,
    })),
    scoreboard: res.scoreboard
      ? res.scoreboard.rows.map((r, rank) => ({
          rank: rank + 1,
          name: r.name,
          score: Math.round(r.score),
          criteria: Object.fromEntries(
            Object.entries(r.parts).map(([k, v]) => [k, Math.round(v)])),
          warnings: [r.flag, r.crisisFlag].filter(Boolean),
        }))
      : null,
    bizBreakEvenMonth: res.bizBreakEven !== undefined ? res.bizBreakEven : null,
    kpis: res.kpis.map((k) => ({ label: k.label, value: k.value, note: k.delta || null })),
    details: res.tableRows.map((r) =>
      r[0] === 'section' ? `## ${r[1]}` : `${r[0]}: ${r[1]}`),
    assumptions: p,
  };
}

if (typeof module !== 'undefined') {
  module.exports = { PARAM_DEFAULTS, summarizeResult };
}
