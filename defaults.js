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
  bz_scaleOn: false,
  bz_reinvestPct: 50,    // profit retained while expanding, %
  bz_unitCostPct: 80,    // next unit's cost, % of the original investment
  bz_maxUnits: 3,

  /* --- biz tab: idea slots (who: 'quit' | 'staff') --- */
  bz1_on: true,  bz1Preset: 'carwash', bz1_who: 'staff',
  bz1_investUSD: 70000, bz1_rampMonths: 9, bz1_revenueUSD: 4500,
  bz1_costsUSD: 1800, bz1_taxPct: 6, bz1_growthPct: 5,
  bz1_residualPct: 50, bz1_staffUSD: 300,

  bz2_on: true,  bz2Preset: 'coffee', bz2_who: 'quit',
  bz2_investUSD: 10000, bz2_rampMonths: 3, bz2_revenueUSD: 3200,
  bz2_costsUSD: 2300, bz2_taxPct: 6, bz2_growthPct: 8,
  bz2_residualPct: 40, bz2_staffUSD: 800,

  bz3_on: true,  bz3Preset: 'barber', bz3_who: 'quit',
  bz3_investUSD: 25000, bz3_rampMonths: 4, bz3_revenueUSD: 5500,
  bz3_costsUSD: 4100, bz3_taxPct: 6, bz3_growthPct: 6,
  bz3_residualPct: 30, bz3_staffUSD: 500,

  bz4_on: false, bz4Preset: 'shop', bz4_who: 'quit',
  bz4_investUSD: 6000, bz4_rampMonths: 6, bz4_revenueUSD: 4000,
  bz4_costsUSD: 3300, bz4_taxPct: 6, bz4_growthPct: 15,
  bz4_residualPct: 10, bz4_staffUSD: 700,
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
