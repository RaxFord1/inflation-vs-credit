/*
 * Module: mortgage variants — up to ten down-payment + term combinations for
 * the same apartment and rate, raced side by side against renting + investing.
 *
 * All variants live in one engine run, so every path faces the same monthly
 * cash-flow ceiling (engine convention) and the gaps between lines are caused
 * only by the loan structure itself. A 100% down payment has no loan left and
 * behaves exactly like buying with cash.
 */

function mortVariants(p) {
  const list = [];
  for (let i = 1; i <= 10; i++) {
    if (!p[`mv${i}_on`]) continue;
    const dp = Math.min(100, Math.max(0, p[`mv${i}_dpPct`]));
    const yrs = Math.min(30, Math.max(1, p[`mv${i}_years`]));
    if (list.some((v) => v.dp === dp && v.yrs === yrs)) continue; // duplicate
    list.push({ dp, yrs });
  }
  // nothing ticked: fall back to the mortgage section's own settings
  if (!list.length) list.push({ dp: p.h_dpPct, yrs: p.h_loanYears });
  return list;
}

function mortRun(p) {
  const months = Math.max(1, Math.round(p.horizonYears * 12));
  const MONTH = 1 / 12;
  const fx = (m) => p.fx0 * Math.pow(1 + p.devalPct / 100, m * MONTH);
  const priceUAH0 = p.h_price * p.fx0;
  const homeUAH = (m) =>
    p.h_price * Math.pow(1 + p.h_apprPct / 100, m * MONTH) * fx(m);
  const rentUAH = (m) =>
    p.h_rentUSD * Math.pow(1 + p.h_rentGrowthPct / 100, m * MONTH) * fx(m);
  const fees = priceUAH0 * (p.h_feesPct / 100);
  const maintMonthly = (m) => (p.h_maintPct / 100) * homeUAH(m) / 12;
  const im = p.h_ratePct / 100 / 12;

  const tRent = { rent: 0 };
  const rent = {
    outlay0: 0,
    step(m) { const r0 = rentUAH(m); tRent.rent += r0; return r0; },
    net() { return 0; },
  };

  const variants = mortVariants(p).map((v) => {
    const loanMonths = Math.max(1, Math.round(v.yrs * 12));
    const dpAmount = priceUAH0 * (v.dp / 100);
    const principal = priceUAH0 - dpAmount;
    const commission = principal * (p.h_commPct / 100);
    const annuity =
      principal <= 0 ? 0
        : im === 0 ? principal / loanMonths
        : (principal * im) / (1 - Math.pow(1 + im, -loanMonths));
    const t = { interest: 0, insurance: 0 };
    let debt = principal;
    const debtHist = [principal]; // remaining debt after each month's payment
    return {
      ...v, loanMonths, dpAmount, principal, commission, annuity, t, debtHist,
      ins1: principal > 0 ? (p.h_insPct / 100) * homeUAH(1) / 12 : 0,
      maint1: (p.h_maintPct / 100) * homeUAH(1) / 12,
      short: `${v.dp}%/${v.yrs}y`,
      legend: v.dp >= 100 ? 'Cash buy (100% down)' : `${v.dp}% down, ${v.yrs} yrs`,
      strat: {
        outlay0: dpAmount + commission + fees,
        step(m) {
          let obl = maintMonthly(m);
          if (m <= loanMonths && debt > 0.005) {
            const ins = (p.h_insPct / 100) * homeUAH(m) / 12; // bank-required
            t.insurance += ins;
            const interest = debt * im;
            const pay = Math.min(annuity, debt + interest);
            t.interest += interest;
            debt = debt + interest - pay;
            obl += pay + ins;
          }
          debtHist[m] = Math.max(0, debt);
          return obl;
        },
        net(m) { return homeUAH(m) - debt; },
      },
      debtEnd: () => debt,
    };
  });

  const r = runComparison({
    months, fx,
    instrument: instrumentOf(p),
    strategies: [rent, ...variants.map((v) => v.strat)],
  });

  return {
    r, variants, months, priceUAH0, fees, tRent,
    homeEndUAH: homeUAH(months), rentNowUAH: rentUAH(1),
  };
}

function mortSim(p) {
  const s = mortRun(p);
  const { r, variants } = s;
  const todayUSD = (v) =>
    v / r.fxEnd / Math.pow(1 + p.usdInflPct / 100, p.horizonYears);

  // per-variant lead over renting: deepest dip and break-even month (the
  // first month after which the variant never falls behind renting again)
  variants.forEach((v, k) => {
    let lastNeg = -1, minV = Infinity, minM = 0;
    r.series.forEach((pt, m) => {
      const d = pt.v[k + 1] - pt.v[0];
      if (d < 0) lastNeg = m;
      const dUSD = d / pt.fx / Math.pow(1 + p.usdInflPct / 100, m / 12);
      if (dUSD < minV) { minV = dUSD; minM = m; }
    });
    v.be = lastNeg === -1 ? 0 : lastNeg >= s.months ? null : lastNeg + 1;
    v.minTodayUSD = minV;
    v.minMonth = minM;
    v.debtLeft = v.debtEnd();
  });

  let best = 0;
  variants.forEach((v, k) => { if (r.finals[k + 1] > r.finals[best + 1]) best = k; });
  const bv = variants[best];
  const adv = r.finals[best + 1] - r.finals[0];

  const payers = variants.filter((v) => v.annuity > 0);
  const cheapest = payers.length
    ? payers.reduce((a, v) => (v.annuity < a.annuity ? v : a)) : null;
  const withBE = variants.filter((v) => v.be !== null);
  const earliest = withBE.length
    ? withBE.reduce((a, v) => (v.be < a.be ? v : a)) : null;
  const fmtBE = (be) =>
    be === null ? `not within ${p.horizonYears}y`
      : be === 0 ? 'from day 1'
      : 'year ' + (be / 12).toFixed(1);

  return {
    series: r.series, months: s.months,
    seriesDefs: [{ short: 'Rent', legend: 'Rent + invest' }]
      .concat(variants.map((v) => ({ short: v.short, legend: v.legend }))),
    adv,
    paid: r.paid, paidUSD: r.paidUSD,
    baselineIndex: 0, // everything is measured against renting
    variants,
    posName: `Variant ${bv.short}`, negName: 'Renting',
    whyPos: `Best of ${variants.length} mortgage variant${variants.length > 1 ? 's' : ''} ` +
      `for the same apartment at ${pct(p.h_ratePct)} — in the plus vs renting ${fmtBE(bv.be)}.`,
    whyNeg: `Every variant ends below renting + investing over ${p.horizonYears} years; ` +
      `the closest is ${bv.short}.`,
    kpis: [
      { label: 'Best variant', value: bv.short, cls: 'good',
        delta: `${signed(todayUSD(adv), usd)} vs renting, today’s $` },
      { label: 'Lightest monthly payment', value: cheapest ? uah(cheapest.annuity) : '—',
        delta: cheapest ? `${cheapest.short} · rent now ${uah(s.rentNowUAH)}/mo` : 'all variants are cash buys' },
      { label: 'Earliest in the plus vs renting',
        value: earliest ? fmtBE(earliest.be) : '—',
        delta: earliest ? earliest.short : `no variant overtakes renting within ${p.horizonYears}y` },
      { label: 'Variants compared', value: String(variants.length),
        delta: `same flat ${usd(p.h_price)}, rate ${pct(p.h_ratePct)}` },
    ],
    whyTitle: 'Why: each variant’s final lead over renting + investing',
    whyRows: variants.map((v, k) => ({ label: v.legend, v: r.finals[k + 1] - r.finals[0] })),
    tableRows: [
      ['section', 'Purchase'],
      ['Apartment price', `${uah(s.priceUAH0)} (${usd(p.h_price)})`],
      ['Purchase fees (duty, pension fund, notary)', uah(s.fees)],
      ['Rent, first month', uah(s.rentNowUAH)],
      ['Rent paid over horizon (renter)', uah(s.tRent.rent)],
      ['section', 'Variants — what the loan costs'],
      ...variants.map((v) => [v.legend,
        `down ${uah(v.dpAmount)} · ${uah(v.annuity)}/mo · interest ${uah(v.t.interest)} · debt left ${uah(v.debtLeft)}`]),
      ['section', `Outcome after ${p.horizonYears} years`],
      ['Exchange rate at horizon', r.fxEnd.toFixed(1) + ' UAH/USD'],
      ['Apartment value at horizon', `${uah(s.homeEndUAH)} (${usd(s.homeEndUAH / r.fxEnd)})`],
      ['Net worth — rent + invest', uah(r.finals[0])],
      ...variants.map((v, k) => [`Net worth — ${v.short}`,
        `${uah(r.finals[k + 1])} (in the plus vs renting: ${fmtBE(v.be)})`]),
    ],
    ctx: { inflPct: p.inflPct, usdInflPct: p.usdInflPct, horizonYears: p.horizonYears, fxEnd: r.fxEnd },
  };
}
