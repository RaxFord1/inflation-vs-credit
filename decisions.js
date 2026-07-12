/*
 * Composable financial primitives and the life-decision catalog.
 *
 * A decision is a list of blocks; compileBlocks() turns them into the
 * { outlay0, step(m), net(m) } strategy interface the engine runs. Block kinds:
 *
 *   { kind:'upfront', uah, month? }          one-time cost (month 0 = outlay0;
 *                                            month>0 = obligation that month)
 *   { kind:'stream',  uah(m), from?, to? }   monthly obligation; negative = income
 *   { kind:'asset',   valueUAH(m), from? }   owned thing counted in net worth
 *   { kind:'loan',    principal, ratePct, months, start?, feeUAH?,
 *                     extra?(m, debt) }      annuity loan; debt subtracts from
 *                                            net worth once start is reached
 *
 * Income changes (new job, education bump, business) are expressed as streams
 * relative to the baseline salary: obligation = old income − new income, so a
 * raise is a negative stream and every path still shares runBudget's income().
 */

function compileBlocks(blocks) {
  const ups = [], streams = [], assets = [], loans = [];
  for (const b of blocks) {
    if (b.kind === 'upfront') ups.push(b);
    else if (b.kind === 'stream') streams.push(b);
    else if (b.kind === 'asset') assets.push(b);
    else if (b.kind === 'loan') {
      const im = b.ratePct / 100 / 12;
      const annuity = b.principal <= 0 ? 0
        : im === 0 ? b.principal / b.months
        : (b.principal * im) / (1 - Math.pow(1 + im, -b.months));
      loans.push({ ...b, im, annuity, debt: b.principal, start: b.start || 0 });
    }
  }
  return {
    outlay0: ups.filter((u) => !(u.month > 0)).reduce((s, u) => s + u.uah, 0),
    // delayed one-time outlays (e.g. a future down payment) — the burden chart
    // excludes these from "required monthly payments"
    oneOffs: ups.filter((u) => u.month > 0).map((u) => ({ month: u.month, uah: u.uah })),
    step(m) {
      let obl = 0;
      for (const u of ups) if (u.month === m) obl += u.uah;
      for (const s of streams) {
        if (m >= (s.from ?? 1) && m <= (s.to ?? Infinity)) obl += s.uah(m);
      }
      for (const L of loans) {
        const k = m - L.start;
        if (k >= 1 && k <= L.months && L.debt > 0.005) {
          if (L.extra) obl += L.extra(m, L.debt);
          const interest = L.debt * L.im;
          const pay = Math.min(L.annuity, L.debt + interest);
          L.debt += interest - pay;
          obl += pay + (L.feeUAH || 0);
        }
      }
      return obl;
    },
    net(m) {
      let v = 0;
      for (const a of assets) if (m >= (a.from || 0)) v += a.valueUAH(m);
      for (const L of loans) if (m >= L.start) v -= L.debt;
      return v;
    },
  };
}

/* ---------- block builders reused across decisions ---------- */

// keep paying for the current home (until `to`, if given)
function curRentBlock(ctx, to) {
  return { kind: 'stream', to, uah: ctx.curRentUAH };
}

// a car bought at month 0, for cash or on credit — same math as car.js
function carBlocks(p, ctx, credit) {
  const priceUAH0 = p.priceCurrency === 'USD' ? p.price * p.fx0 : p.price;
  const priceUSD0 = priceUAH0 / p.fx0;
  const valueUAH = (m) =>
    priceUSD0 * Math.pow(1 - p.carDepPct / 100, m * MONTH) * ctx.fx(m);
  const fees = priceUAH0 * (p.pensionPct / 100) + p.regFeeUAH;
  const kasko = (m) => (p.kaskoPct / 100) * valueUAH(m) / 12;
  const blocks = [{ kind: 'asset', valueUAH }];
  if (!credit) {
    blocks.push({ kind: 'upfront', uah: priceUAH0 * (1 - p.cashDiscountPct / 100) + fees });
    if (p.kaskoCash) blocks.push({ kind: 'stream', uah: kasko });
  } else {
    const months = Math.max(1, Math.round(p.loanYears * 12));
    const dp = priceUAH0 * (p.dpPct / 100);
    const principal = priceUAH0 - dp;
    blocks.push({ kind: 'upfront', uah: dp + principal * (p.commissionPct / 100) + fees });
    blocks.push({
      kind: 'loan', principal, ratePct: p.loanRatePct, months,
      feeUAH: p.monthlyFeeUAH,
      extra: (m, debt) => debt * (p.lifeInsPct / 100) / 12,
    });
    blocks.push({ kind: 'stream', to: months, uah: kasko });
  }
  return blocks;
}

// a flat bought with a mortgage at month `start` (0 = now) — same math as
// home.js; a delayed purchase is priced at that month's USD value and FX
function flatBlocks(p, ctx, { rentOut = false, start = 0 } = {}) {
  const valueUAH = (m) =>
    p.h_price * Math.pow(1 + p.h_apprPct / 100, m * MONTH) * ctx.fx(m);
  const priceUAH = valueUAH(start);
  const months = Math.max(1, Math.round(p.h_loanYears * 12));
  const dp = priceUAH * (p.h_dpPct / 100);
  const principal = priceUAH - dp;
  const upfront = dp + principal * (p.h_commPct / 100) + priceUAH * (p.h_feesPct / 100);
  const blocks = [
    { kind: 'upfront', uah: upfront, month: start > 0 ? start : 0 },
    { kind: 'asset', valueUAH, from: start },
    {
      kind: 'loan', principal, ratePct: p.h_ratePct, months, start,
      extra: (m) => (p.h_insPct / 100) * valueUAH(m) / 12,
    },
    { kind: 'stream', from: start + 1, uah: (m) => (p.h_maintPct / 100) * valueUAH(m) / 12 },
  ];
  if (rentOut) {
    blocks.push({
      kind: 'stream', from: start + 1,
      uah: (m) =>
        -(p.h_rentUSD * Math.pow(1 + p.h_rentGrowthPct / 100, m * MONTH) * ctx.fx(m)) *
        (1 - p.h_vacancyPct / 100) * (1 - p.h_rentTaxPct / 100),
    });
  }
  return blocks;
}

/* Month when a business's cumulative net profit (revenue less tax and bills,
 * real-USD terms, ignoring any salary given up) repays the startup investment;
 * null if it never does within the horizon. */
function bizBreakEvenMonth(cfg, months) {
  const ramp = Math.round(cfg.rampMonths);
  let cum = 0;
  for (let m = 1; m <= months; m++) {
    if (m > ramp) {
      cum += cfg.revenueUSD *
          Math.pow(1 + cfg.growthPct / 100, (m - ramp) * MONTH) *
          (1 - cfg.taxPct / 100) -
        cfg.costsUSD * Math.pow(1 + cfg.usdInflPct / 100, m * MONTH);
    }
    if (cum >= cfg.investUSD) return m;
  }
  return null;
}

/* ---------- the decision catalog ----------
 * qol = default lifestyle score (0–10) the user can override in the sidebar. */
const LIFE_DECISIONS = [
  {
    id: 'nothing', name: 'Change nothing', short: 'Nothing', qol: 5,
    build: (p, ctx) => [curRentBlock(ctx)],
  },
  {
    id: 'carCash', name: 'Buy a car — cash', short: 'Car cash', qol: 7,
    build: (p, ctx) => [curRentBlock(ctx), ...carBlocks(p, ctx, false)],
  },
  {
    id: 'carCredit', name: 'Buy a car — credit', short: 'Car credit', qol: 6,
    build: (p, ctx) => [curRentBlock(ctx), ...carBlocks(p, ctx, true)],
  },
  {
    id: 'flatLive', name: 'Buy a flat — mortgage, live in it', short: 'Own flat', qol: 9,
    build: (p, ctx) => flatBlocks(p, ctx),
  },
  {
    id: 'flatBtl', name: 'Buy a flat — mortgage, rent it out', short: 'Buy-to-let', qol: 6,
    build: (p, ctx) => [curRentBlock(ctx), ...flatBlocks(p, ctx, { rentOut: true })],
  },
  {
    id: 'edu', name: 'Education — pay now, earn more later', short: 'Education', qol: 7,
    build: (p, ctx) => [
      curRentBlock(ctx),
      { kind: 'upfront', uah: p.edu_costUSD * p.fx0 },
      { // income lost while studying
        kind: 'stream', to: Math.round(p.edu_months),
        uah: (m) => ctx.salaryUAH(m) * (p.edu_dropPct / 100),
      },
      { // the raise afterwards, as a negative obligation
        kind: 'stream', from: Math.round(p.edu_months) + 1,
        uah: (m) => -ctx.salaryUAH(m) * (p.edu_bumpPct / 100),
      },
    ],
  },
  {
    id: 'job', name: 'Change job — different pay and growth', short: 'New job', qol: 6,
    build: (p, ctx) => {
      const newSalaryUAH = (m) =>
        p.salaryAmt * (1 + p.job_changePct / 100) *
        Math.pow(1 + p.job_newGrowthPct / 100, m * MONTH) *
        (p.salaryCurrency === 'USD' ? ctx.fx(m) : 1);
      return [
        curRentBlock(ctx),
        { kind: 'stream', uah: (m) => ctx.salaryUAH(m) - newSalaryUAH(m) },
      ];
    },
  },
  {
    id: 'migrate', name: 'Move abroad — new salary, new costs', short: 'Abroad', qol: 5,
    build: (p, ctx) => [
      { kind: 'upfront', uah: p.mig_costUSD * p.fx0 },
      { // swap the whole budget: new rent+living replace old, new salary replaces old
        kind: 'stream',
        uah: (m) => {
          const usdLevel = Math.pow(1 + p.usdInflPct / 100, m * MONTH) * ctx.fx(m);
          const newCosts = (p.mig_rentUSD + p.mig_livUSD) * usdLevel;
          const newSalary = p.mig_salaryUSD *
            Math.pow(1 + p.salaryGrowthPct / 100, m * MONTH) * ctx.fx(m);
          return newCosts - ctx.livExpUAH(m) - (newSalary - ctx.salaryUAH(m));
        },
      },
    ],
  },
  {
    id: 'biz', name: 'Start a business — quit and build', short: 'Business', qol: 6,
    build: (p, ctx) => [
      curRentBlock(ctx),
      { kind: 'upfront', uah: p.biz_investUSD * p.fx0 },
      { // what the business could be sold for — equipment, fit-out, client base
        kind: 'asset',
        valueUAH: (m) => p.biz_investUSD * (p.biz_residualPct / 100) *
          Math.pow(1 + p.usdInflPct / 100, m * MONTH) * ctx.fx(m),
      },
      { // salary stops on day one; after the ramp the business nets
        // revenue − tax on revenue − operating bills (bills track USD inflation)
        kind: 'stream',
        uah: (m) => {
          const ramp = Math.round(p.biz_rampMonths);
          const net = m <= ramp ? 0
            : (p.biz_revenueUSD *
                 Math.pow(1 + p.biz_growthPct / 100, (m - ramp) * MONTH) *
                 (1 - p.biz_taxPct / 100) -
               p.biz_costsUSD * Math.pow(1 + p.usdInflPct / 100, m * MONTH)) *
              ctx.fx(m);
          return ctx.salaryUAH(m) - net;
        },
      },
    ],
  },
  {
    id: 'combo', name: 'Car on credit now + flat later', short: 'Car+flat', qol: 8,
    build: (p, ctx) => {
      const start = Math.max(0, Math.round(p.combo_flatDelayYr * 12));
      return [
        curRentBlock(ctx, start), // rent stops when you move into your flat
        ...carBlocks(p, ctx, true),
        ...flatBlocks(p, ctx, { start }),
      ];
    },
  },
];
