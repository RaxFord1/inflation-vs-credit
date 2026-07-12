/*
 * Module: life decision maker — one person, real savings and salary, a
 * user-selected set of decisions from the catalog in decisions.js. Uses the
 * budget engine: every path earns the same salary, pays the same living
 * expenses, and invests whatever is left after its own obligations.
 *
 * On top of the money simulation sits an evaluation layer: each decision is
 * scored 0–100 on five criteria and ranked by the user's weights —
 *   wealth      net worth at the horizon, today's $ (min–max across paths)
 *   robustness  same wealth re-run under a crisis macro; broke in crisis = 0
 *   stress      100 − peak required-payments share of salary
 *   liquidity   share of final wealth you could actually access (account vs
 *               flat/car/debt)
 *   lifestyle   the user's own 0–10 score per decision
 */

// crisis scenario for the robustness score: sharper devaluation and inflation,
// lower yields and asset growth, risky income (business) takes a haircut
function lifeCrisisParams(p) {
  return {
    ...p,
    devalPct: p.devalPct + 12,
    inflPct: p.inflPct + 8,
    usdInflPct: p.usdInflPct + 1,
    invYieldPct: Math.max(0, p.invYieldPct - 4),
    h_apprPct: p.h_apprPct - 3,
    h_rentGrowthPct: p.h_rentGrowthPct - 2,
    salaryGrowthPct: Math.max(0, p.salaryGrowthPct - 3),
    biz_revenueUSD: p.biz_revenueUSD * 0.7,
  };
}

// "change nothing" is always in; the rest follow the user's checkboxes,
// capped so the chart never needs more than 7 categorical colors
function lifeActiveCatalog(p) {
  const active = (p.lifeActive || []);
  return [LIFE_DECISIONS[0]]
    .concat(LIFE_DECISIONS.slice(1).filter((d) => active.includes(d.id)))
    .slice(0, 7);
}

function lifeRun(p) {
  const months = Math.max(1, Math.round(p.horizonYears * 12));
  const fx = (m) => p.fx0 * Math.pow(1 + p.devalPct / 100, m * MONTH);

  const ctx = {
    fx,
    salaryUAH: (m) =>
      p.salaryAmt * Math.pow(1 + p.salaryGrowthPct / 100, m * MONTH) *
      (p.salaryCurrency === 'USD' ? fx(m) : 1),
    // living expenses are entered in USD and held constant in real-USD terms
    livExpUAH: (m) =>
      p.l_livExpUSD * Math.pow(1 + p.usdInflPct / 100, m * MONTH) * fx(m),
    curRentUAH: (m) =>
      p.l_curRentUSD * Math.pow(1 + p.h_rentGrowthPct / 100, m * MONTH) * fx(m),
  };

  const catalog = lifeActiveCatalog(p);
  const strategies = catalog.map((d) => compileBlocks(d.build(p, ctx)));
  const savings0 = p.savings * (p.savingsCurrency === 'USD' ? p.fx0 : 1);

  const r = runBudget({
    months, fx,
    instrument: instrumentOf(p),
    savings0,
    income: (m) => ctx.salaryUAH(m) - ctx.livExpUAH(m),
    strategies,
  });

  return {
    r, months, savings0, catalog, ctx,
    outlays: strategies.map((s) => s.outlay0),
    oneOffs: strategies.map((s) => s.oneOffs),
    netEnd: strategies.map((s) => s.net(months)), // illiquid part of final wealth
  };
}

function lifeSim(p) {
  const s = lifeRun(p);
  const { r, catalog } = s;
  const n = catalog.length;
  const yrs = p.horizonYears;
  const todayUSD = (v) => v / r.fxEnd / Math.pow(1 + p.usdInflPct / 100, yrs);

  /* ----- crisis re-run (robustness) ----- */
  const cp = lifeCrisisParams(p);
  const c = lifeRun(cp);
  const crisisUSD = c.r.finals.map(
    (v) => v / c.r.fxEnd / Math.pow(1 + cp.usdInflPct / 100, yrs));

  /* ----- per-decision raw criteria ----- */
  const finalsUSD = r.finals.map(todayUSD);
  const feasible = r.broke.map((b) => b === null);
  const crisisOK = c.r.broke.map((b) => b === null);

  // peak required payments as a share of salary (income streams don't offset)
  const peakBurden = catalog.map((d, i) => {
    let peak = 0;
    for (let m = 1; m <= s.months; m++) {
      peak = Math.max(peak, r.series[m].obl[i] / s.ctx.salaryUAH(m));
    }
    return peak;
  });

  const clamp01 = (v) => Math.max(0, Math.min(1, v));
  const minmax = (vals) => {
    const lo = Math.min(...vals), hi = Math.max(...vals);
    return hi - lo < 1e-9 ? vals.map(() => 50)
      : vals.map((v) => ((v - lo) / (hi - lo)) * 100);
  };

  const scoreWealth = minmax(finalsUSD);
  const scoreRobust = minmax(crisisUSD).map((v, i) => (crisisOK[i] ? v : 0));
  const scoreStress = peakBurden.map((b) => 100 * (1 - clamp01(b)));
  const scoreLiq = catalog.map((d, i) =>
    r.finals[i] <= 0 ? 0 : 100 * clamp01((r.finals[i] - s.netEnd[i]) / r.finals[i]));
  const scoreQol = catalog.map((d) => clamp01((p['qol_' + d.id] ?? d.qol) / 10) * 100);

  const w = {
    wealth: p.w_wealth, robust: p.w_robust, stress: p.w_stress,
    liq: p.w_liq, qol: p.w_qol,
  };
  let wSum = w.wealth + w.robust + w.stress + w.liq + w.qol;
  if (wSum <= 0) { w.wealth = w.robust = w.stress = w.liq = w.qol = 1; wSum = 5; }
  const scores = catalog.map((d, i) =>
    (w.wealth * scoreWealth[i] + w.robust * scoreRobust[i] +
     w.stress * scoreStress[i] + w.liq * scoreLiq[i] + w.qol * scoreQol[i]) / wSum);

  /* ----- ranking: plans that fit the budget first, then by score ----- */
  const order = catalog.map((d, i) => i)
    .sort((i, j) => (feasible[j] - feasible[i]) || (scores[j] - scores[i]));
  const winner = order[0];
  const advVsStay = r.finals[winner] - r.finals[0];

  const flags = r.broke.map((b, i) => {
    if (s.outlays[i] > s.savings0) {
      return `needs ${uah(s.outlays[i] - s.savings0)} more upfront than you have`;
    }
    return b === null ? '' : `runs out of cash in year ${(b / 12).toFixed(1)}`;
  });

  /* ----- scoreboard for the UI ----- */
  const scoreboard = {
    weights: w,
    rows: order.map((i) => ({
      i,
      name: catalog[i].name,
      score: scores[i],
      flag: flags[i],
      crisisFlag: crisisOK[i] ? '' : 'does not survive the crisis scenario',
      parts: {
        Wealth: scoreWealth[i], Crisis: scoreRobust[i], Stress: scoreStress[i],
        Liquidity: scoreLiq[i], Lifestyle: scoreQol[i],
      },
    })),
  };

  const crisisSurvivors = crisisOK.filter(Boolean).length;

  const bizBreakEven = bizBreakEvenMonth({
    investUSD: p.biz_investUSD, rampMonths: p.biz_rampMonths,
    revenueUSD: p.biz_revenueUSD, costsUSD: p.biz_costsUSD,
    taxPct: p.biz_taxPct, growthPct: p.biz_growthPct, usdInflPct: p.usdInflPct,
  }, s.months);

  const verdict =
    `<strong>Best move for you: ${catalog[winner].name} — score ${scores[winner].toFixed(0)}/100</strong>` +
    `<div class="why">${
      winner === 0
        ? 'Given your savings, offers and priorities, no move beats simply investing what you have.'
        : `Ranked with your weights (wealth ${w.wealth} · crisis ${w.robust} · stress ${w.stress} · ` +
          `liquidity ${w.liq} · lifestyle ${w.qol}). In pure money terms it leaves you ` +
          `${signed(todayUSD(advVsStay), usd)} today's $ vs changing nothing` +
          (crisisOK[winner] ? ', and it survives the crisis scenario.' : ' — but it fails in the crisis scenario.')
    }</div>` +
    `<div class="units">Crisis scenario: devaluation +12 pp, UAH inflation +8 pp, yields −4 pp, ` +
    `property growth −3 pp, business income −30%. ${crisisSurvivors} of ${n} paths survive it.</div>`;

  const whyRows = catalog.slice(1).map((d, k) => ({
    label: d.name, v: r.finals[k + 1] - r.finals[0],
  }));

  const month1 = r.series[1].obl;
  const tableRows = [];
  catalog.forEach((d, i) => {
    tableRows.push(['section', d.name]);
    tableRows.push(['Cash needed upfront', uah(s.outlays[i])]);
    tableRows.push(['Payments, first month', uah(month1[i])]);
    tableRows.push(['Paid out over the horizon, total', uah(r.paid[i])]);
    tableRows.push(['Score (your weights)', `${scores[i].toFixed(0)}/100 — wealth ${scoreWealth[i].toFixed(0)}, crisis ${scoreRobust[i].toFixed(0)}, stress ${scoreStress[i].toFixed(0)}, liquidity ${scoreLiq[i].toFixed(0)}, lifestyle ${scoreQol[i].toFixed(0)}`]);
    if (d.id === 'biz') {
      tableRows.push(['Business breaks even', bizBreakEven === null
        ? 'not within the horizon'
        : `month ${bizBreakEven} (year ${(bizBreakEven / 12).toFixed(1)}) — from its own profit, not counting the salary given up`]);
    }
    if (flags[i]) tableRows.push(['⚠ Feasibility', flags[i]]);
    if (!crisisOK[i]) tableRows.push(['⚠ Crisis scenario', 'runs out of cash under crisis assumptions']);
    tableRows.push([`Net worth after ${yrs} years`, `${uah(r.finals[i])} (${usd(todayUSD(r.finals[i]))} today's $ · crisis: ${usd(crisisUSD[i])})`]);
  });

  return {
    series: r.series, months: s.months,
    seriesDefs: catalog.map((d) => ({ short: d.short, legend: d.name })),
    adv: advVsStay,
    bizBreakEven,
    oneOffs: s.oneOffs,
    paid: r.paid, paidUSD: r.paidUSD,
    baselineIndex: 0, // deltas shown vs changing nothing
    flags,
    verdict,
    scoreboard,
    posName: catalog[winner].name, negName: catalog[winner].name,
    whyPos: '', whyNeg: '',
    kpis: [
      {
        label: 'Best move', value: catalog[winner].name,
        cls: 'good',
        delta: `score ${scores[winner].toFixed(0)}/100 · ` +
          (winner === 0 ? 'keep investing your savings'
            : signed(todayUSD(advVsStay), usd) + ' vs changing nothing, today’s $'),
      },
      {
        label: 'Survive the crisis scenario', value: `${crisisSurvivors} of ${n} paths`,
        cls: crisisSurvivors === n ? 'good' : '',
        delta: 'deval +12 pp, inflation +8 pp, yields −4 pp',
      },
      {
        label: 'Upfront cash — best move', value: uah(s.outlays[winner]),
        delta: `you have ${uah(s.savings0)}`,
      },
      {
        label: 'If you change nothing', value: usd(todayUSD(r.finals[0])),
        delta: `savings after ${yrs} years, in today’s $`,
      },
    ],
    whyTitle: 'Impact of each decision vs changing nothing (net worth at horizon)',
    whyRows,
    tableRows,
    ctx: { inflPct: p.inflPct, usdInflPct: p.usdInflPct, horizonYears: yrs, fxEnd: r.fxEnd },
  };
}
