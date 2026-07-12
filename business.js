/*
 * Module: business ideas — compare up to four business plans against keeping
 * your job. Budget engine: every path earns/keeps the same living costs; the
 * baseline keeps the salary, each idea gives it up on day one, pays the
 * startup investment upfront and, after a ramp-up, nets
 * revenue − tax on revenue − operating bills (bills track USD inflation).
 *
 * The "Reality check" factors scale every idea's revenue and bills relative
 * to plan — sweep them to see how much optimism each idea can absorb.
 */

const BIZ_SLOT_LABELS = {
  carwash: 'Car wash', coffee: 'Coffee point', barber: 'Barbershop',
  shop: 'Online store', custom: '',
};

function bizIdeaCfg(p, i) {
  const keepJob = p[`bz${i}_who`] === 'staff';
  return {
    investUSD: p[`bz${i}_investUSD`],
    rampMonths: p[`bz${i}_rampMonths`],
    revenueUSD: p[`bz${i}_revenueUSD`] * (p.bz_revFactorPct / 100),
    costsUSD: p[`bz${i}_costsUSD`] * (p.bz_costFactorPct / 100),
    taxPct: p[`bz${i}_taxPct`],
    growthPct: p[`bz${i}_growthPct`],
    residualPct: p[`bz${i}_residualPct`],
    usdInflPct: p.usdInflPct,
    keepJob,
    // extra wages so the business runs without you; only when you keep the job
    staffUSD: keepJob ? p[`bz${i}_staffUSD`] * (p.bz_costFactorPct / 100) : 0,
    // additional units always need staff, whoever runs the first one
    staffRawUSD: p[`bz${i}_staffUSD`] * (p.bz_costFactorPct / 100),
  };
}

// net profit in USD at month m (0 during the ramp)
function bizNetUSD(cfg, m) {
  const ramp = Math.round(cfg.rampMonths);
  if (m <= ramp) return 0;
  return cfg.revenueUSD *
      Math.pow(1 + cfg.growthPct / 100, (m - ramp) * MONTH) *
      (1 - cfg.taxPct / 100) -
    (cfg.costsUSD + cfg.staffUSD) *
      Math.pow(1 + cfg.usdInflPct / 100, m * MONTH);
}

function bizSim(p) {
  const months = Math.max(1, Math.round(p.horizonYears * 12));
  const fx = (m) => p.fx0 * Math.pow(1 + p.devalPct / 100, m * MONTH);
  const ctx = {
    fx,
    salaryUAH: (m) =>
      p.salaryAmt * Math.pow(1 + p.salaryGrowthPct / 100, m * MONTH) *
      (p.salaryCurrency === 'USD' ? fx(m) : 1),
    livExpUAH: (m) =>
      p.l_livExpUSD * Math.pow(1 + p.usdInflPct / 100, m * MONTH) * fx(m),
    curRentUAH: (m) =>
      p.l_curRentUSD * Math.pow(1 + p.h_rentGrowthPct / 100, m * MONTH) * fx(m),
  };

  const slots = [1, 2, 3, 4].filter((i) => p[`bz${i}_on`]);
  const cfgs = slots.map((i) => bizIdeaCfg(p, i));

  // unique display names: preset label, or "Idea N"; "+job" marks ideas run by
  // hired staff while you keep your salary; slot number added on ties
  const labels = slots.map((i, k) =>
    (BIZ_SLOT_LABELS[p[`bz${i}Preset`]] || `Idea ${i}`) +
    (cfgs[k].keepJob ? ' +job' : ''));
  const names = labels.map((l, k) =>
    labels.filter((x) => x === l).length > 1 ? `${l} (idea ${slots[k]})` : l);

  /* Scaling: while expanding, a share of profit is retained in a war chest;
   * when it covers the next unit's cost, a new unit opens and ramps up like
   * the first. Extra units always pay staff. At the unit cap (or if scaling
   * is off) all profit is paid out and the chest is released. */
  const scale = {
    on: p.bz_scaleOn,
    reinvest: p.bz_reinvestPct / 100,
    unitCostPct: p.bz_unitCostPct / 100,
    maxUnits: Math.max(1, Math.round(p.bz_maxUnits)),
  };
  const states = cfgs.map(() => ({ units: [{ start: 0, first: true }], chestUSD: 0 }));

  const strategies = [
    compileBlocks([curRentBlock(ctx)]), // keep your job
    ...cfgs.map((cfg, k) => {
      const state = states[k];
      const ramp = Math.round(cfg.rampMonths);
      const infl = (m) => Math.pow(1 + cfg.usdInflPct / 100, m * MONTH);
      const unitCostUSD = cfg.investUSD * scale.unitCostPct;
      const unitNetUSD = (m, u) => {
        const age = m - u.start;
        if (age <= ramp) return 0;
        return cfg.revenueUSD *
            Math.pow(1 + cfg.growthPct / 100, (age - ramp) * MONTH) *
            (1 - cfg.taxPct / 100) -
          (cfg.costsUSD + (u.first ? cfg.staffUSD : cfg.staffRawUSD)) * infl(m);
      };
      return compileBlocks([
        curRentBlock(ctx),
        { kind: 'upfront', uah: cfg.investUSD * p.fx0 },
        { // resale value of every unit built (real-USD) + the war chest cash
          kind: 'asset',
          valueUAH: (m) => (state.chestUSD +
            state.units.reduce((s, u) =>
              s + (u.first ? cfg.investUSD : unitCostUSD) *
                (cfg.residualPct / 100) * infl(m), 0)) * fx(m),
        },
        { // salary lost only if you quit; staff wages are inside unitNetUSD
          kind: 'stream',
          uah: (m) => {
            let net = 0;
            for (const u of state.units) net += unitNetUSD(m, u);
            let payout = net;
            if (scale.on && state.units.length < scale.maxUnits) {
              const retained = Math.max(0, net) * scale.reinvest;
              state.chestUSD += retained;
              payout = net - retained;
              const cost = unitCostUSD * infl(m); // building later costs more
              if (state.chestUSD >= cost) {
                state.chestUSD -= cost;
                state.units.push({ start: m, first: false });
              }
            } else if (state.chestUSD > 0) {
              payout += state.chestUSD; // expansion over — release the chest
              state.chestUSD = 0;
            }
            return (cfg.keepJob ? 0 : ctx.salaryUAH(m)) - payout * fx(m);
          },
        },
      ]);
    }),
  ];

  const savings0 = p.savings * (p.savingsCurrency === 'USD' ? p.fx0 : 1);
  const r = runBudget({
    months, fx,
    instrument: instrumentOf(p),
    savings0,
    income: (m) => ctx.salaryUAH(m) - ctx.livExpUAH(m),
    strategies,
  });

  const yrs = p.horizonYears;
  const todayUSD = (v) => v / r.fxEnd / Math.pow(1 + p.usdInflPct / 100, yrs);
  const outlays = strategies.map((s) => s.outlay0);
  const feasible = r.broke.map((b) => b === null);
  const flags = r.broke.map((b, i) => {
    if (outlays[i] > savings0) {
      return `needs ${uah(outlays[i] - savings0)} more upfront than you have`;
    }
    return b === null ? '' : `runs out of cash in year ${(b / 12).toFixed(1)}`;
  });

  const breakEven = cfgs.map((cfg) =>
    bizBreakEvenMonth({ ...cfg, costsUSD: cfg.costsUSD + cfg.staffUSD }, months));
  // profit in the first month after the ramp, at planned (factored) figures
  const profit0 = cfgs.map((cfg) => bizNetUSD(cfg, Math.round(cfg.rampMonths) + 1));
  // your total monthly income once the idea is ramped up (salary kept or not)
  const salaryUSDat = (m) => ctx.salaryUAH(m) / fx(m);
  const incomeUSD = cfgs.map((cfg, k) =>
    profit0[k] + (cfg.keepJob ? salaryUSDat(Math.round(cfg.rampMonths) + 1) : 0));

  const order = r.finals.map((v, i) => i)
    .sort((i, j) => (feasible[j] - feasible[i]) || (r.finals[j] - r.finals[i]));
  const winner = order[0];
  const advVsJob = r.finals[winner] - r.finals[0];

  const beText = (be) => be === null
    ? 'never breaks even in this horizon'
    : `breaks even in month ${be} (year ${(be / 12).toFixed(1)})`;

  const verdict = winner === 0
    ? `<strong>Keeping your job wins: no idea beats simply investing your savings</strong>` +
      `<div class="why">At these figures every business either loses to the salary you give up or doesn't fit your budget. ` +
      `Sweep “Revenue vs plan” below to see how much better the ideas would have to perform.</div>`
    : `<strong>Best idea: ${names[winner - 1]} — ${signed(todayUSD(advVsJob), usd)} vs just keeping your job, today's $</strong>` +
      `<div class="why">It ${beText(breakEven[winner - 1])} and nets ~${usd(profit0[winner - 1])}/month after tax and bills once ramped up` +
      (cfgs[winner - 1].keepJob
        ? `, on top of the salary you keep — total income ~${usd(incomeUSD[winner - 1])}/month vs ${usd(salaryUSDat(0))} from the job alone (staff wages already deducted).`
        : `. The comparison already charges it the salary you give up and the investment income your savings would have earned.`) +
      (scale.on && states[winner - 1] && states[winner - 1].units.length > 1
        ? ` Reinvesting profit grows it to ${states[winner - 1].units.length} units by the horizon.`
        : '') +
      `</div>` +
      `<div class="units">Reality check applied: revenue at ${p.bz_revFactorPct}% of plan, bills at ${p.bz_costFactorPct}%.</div>`;

  const kpis = [
    {
      label: 'Best path', value: winner === 0 ? 'Keep your job' : names[winner - 1],
      cls: 'good',
      delta: winner === 0 ? 'invest your savings instead'
        : signed(todayUSD(advVsJob), usd) + ' vs keeping your job, today’s $',
    },
    (() => {
      const k = breakEven.map((be, j) => [be, j]).filter(([be]) => be !== null)
        .sort((a, b) => a[0] - b[0])[0];
      return k
        ? { label: 'Fastest break-even', value: names[k[1]], delta: `month ${k[0]} (year ${(k[0] / 12).toFixed(1)})` }
        : { label: 'Fastest break-even', value: '—', delta: 'no idea repays its investment in this horizon' };
    })(),
    (() => {
      const k = incomeUSD.map((v, j) => [v, j]).sort((a, b) => b[0] - a[0])[0];
      return k
        ? {
            label: 'Highest monthly income', value: names[k[1]],
            delta: `${usd(k[0])}/mo once ramped up (${cfgs[k[1]].keepJob ? 'salary + business' : 'business only'}) — job alone pays ${usd(salaryUSDat(0))}`,
          }
        : { label: 'Highest monthly income', value: '—', delta: 'no ideas selected' };
    })(),
    {
      label: 'If you keep your job', value: usd(todayUSD(r.finals[0])),
      delta: `savings after ${yrs} years, in today’s $`,
    },
  ];

  const tableRows = [];
  tableRows.push(['section', 'Keep your job (baseline)']);
  tableRows.push(['Salary', `${usd(salaryUSDat(0))}/month, growing ${p.salaryGrowthPct}%/yr — set it under “Your job & income” on the left`]);
  tableRows.push(['Where its wealth comes from',
    `${usd(savings0 / p.fx0)} of savings plus whatever the salary leaves after living costs, ` +
    `invested at ${p.invYieldPct}% in ${p.invCurrency}`]);
  names.forEach((n, k) => {
    const i = k + 1;
    tableRows.push(['section', n]);
    tableRows.push(['Who runs it', cfgs[k].keepJob
      ? `hired staff (${usd(cfgs[k].staffUSD)}/mo) — you keep your salary`
      : 'you — the salary is given up']);
    tableRows.push(['Startup investment', `${uah(outlays[i])} (${usd(cfgs[k].investUSD)})`]);
    tableRows.push(['Ramp-up with no income', `${Math.round(cfgs[k].rampMonths)} months`]);
    tableRows.push(['Net profit after ramp-up (revenue − tax − bills' +
      (cfgs[k].keepJob ? ' − staff' : '') + ')', usd(profit0[k]) + '/month']);
    tableRows.push(['Your total monthly income after ramp-up',
      `${usd(incomeUSD[k])} (${cfgs[k].keepJob ? 'salary + business' : 'business only'}) — the job alone pays ${usd(salaryUSDat(0))}`]);
    tableRows.push(['Break-even on the investment', beText(breakEven[k])]);
    tableRows.push(['Resale value counted in net worth',
      `${usd(cfgs[k].investUSD * cfgs[k].residualPct / 100)} (${cfgs[k].residualPct}% of the investment, real-USD)`]);
    if (scale.on) {
      tableRows.push(['Scaling', states[k].units.length === 1
        ? `never saved up the ${usd(cfgs[k].investUSD * scale.unitCostPct)} a second unit costs`
        : `grew to ${states[k].units.length} of max ${scale.maxUnits} units ` +
          `(opened in months ${states[k].units.slice(1).map((u) => u.start).join(', ')}; ` +
          `each ramps up ${Math.round(cfgs[k].rampMonths)} months and pays its own staff)`]);
    }
    if (flags[i]) tableRows.push(['⚠ Feasibility', flags[i]]);
    tableRows.push([`Net worth after ${yrs} years`,
      `${uah(r.finals[i])} (${usd(todayUSD(r.finals[i]))} today’s $) · vs keeping the job: ${signed(todayUSD(r.finals[i] - r.finals[0]), usd)}`]);
  });

  return {
    series: r.series, months,
    seriesDefs: [{ short: 'Keep job', legend: 'Keep your job' }]
      .concat(names.map((n) => ({ short: n, legend: n }))),
    adv: advVsJob,
    paid: r.paid, paidUSD: r.paidUSD,
    baselineIndex: 0,
    flags,
    verdict,
    posName: '', negName: '', whyPos: '', whyNeg: '',
    kpis,
    whyTitle: 'Impact of each idea vs keeping your job (net worth at horizon)',
    whyRows: names.map((n, k) => ({ label: n, v: r.finals[k + 1] - r.finals[0] })),
    tableRows,
    ctx: { inflPct: p.inflPct, usdInflPct: p.usdInflPct, horizonYears: yrs, fxEnd: r.fxEnd },
  };
}
