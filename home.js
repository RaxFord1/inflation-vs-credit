/*
 * Module: apartment — mortgage (0), cash (1), rent (2),
 * mortgage-to-let renting/own (3,4), cash-to-let renting/own (5,6).
 *
 * All seven need housing. Each period everyone parts with the maximum
 * obligation across strategies and invests their own gap below it (engine
 * convention), so the wealth gaps come only from the strategies themselves.
 * Early on the mortgage costs more than rent and the renter invests the gap;
 * once grown rent overtakes the fixed annuity the flow reverses.
 *
 * Kyiv housing is USD-denominated: price and rent are entered in USD, drift
 * at their own USD-terms growth rates, and float to UAH with the FX rate.
 */

function homeRun(p) {
  const months = Math.max(1, Math.round(p.horizonYears * 12));
  const loanMonths = Math.max(1, Math.round(p.h_loanYears * 12));
  const MONTH = 1 / 12;

  const fx = (m) => p.fx0 * Math.pow(1 + p.devalPct / 100, m * MONTH);
  const priceUAH0 = p.h_price * p.fx0;
  const homeUAH = (m) =>
    p.h_price * Math.pow(1 + p.h_apprPct / 100, m * MONTH) * fx(m);
  const rentUAH = (m) =>
    p.h_rentUSD * Math.pow(1 + p.h_rentGrowthPct / 100, m * MONTH) * fx(m);

  const fees = priceUAH0 * (p.h_feesPct / 100); // duty, pension fund, notary…
  const dpAmount = priceUAH0 * (p.h_dpPct / 100);
  const principal = priceUAH0 - dpAmount;
  const commission = principal * (p.h_commPct / 100);
  const im = p.h_ratePct / 100 / 12;
  const annuity =
    principal <= 0 ? 0
      : im === 0 ? principal / loanMonths
      : (principal * im) / (1 - Math.pow(1 + im, -loanMonths));

  const maintMonthly = (m) => (p.h_maintPct / 100) * homeUAH(m) / 12;
  const ownRentUAH = (m) =>
    p.h_ownRentUSD * Math.pow(1 + p.h_rentGrowthPct / 100, m * MONTH) * fx(m);

  const t = { interest: 0, insurance: 0, maintenance: 0, rent: 0 };
  const t2 = { interest: 0, netRent: 0, ownRent: 0 }; // mortgage-to-let (renting)
  const t3 = { interest: 0, netRent: 0 };              // mortgage-to-let (own home)
  const t4 = { netRent: 0, ownRent: 0 };               // cash-to-let (renting)
  const t5 = { netRent: 0 };                            // cash-to-let (own home)
  let debt = principal;
  let debt2 = principal;
  let debt3 = principal;

  const mortgage = {
    outlay0: dpAmount + commission + fees,
    step(m) {
      let obl = maintMonthly(m);
      t.maintenance += obl;
      if (m <= loanMonths && debt > 0.005) {
        const ins = (p.h_insPct / 100) * homeUAH(m) / 12; // bank-required
        t.insurance += ins;
        const interest = debt * im;
        const pay = Math.min(annuity, debt + interest);
        t.interest += interest;
        debt = debt + interest - pay;
        obl += pay + ins;
      }
      return obl;
    },
    net(m) { return homeUAH(m) - debt; },
  };

  const cash = {
    outlay0: priceUAH0 + fees,
    step(m) { return maintMonthly(m); }, // no bank, no forced insurance
    net(m) { return homeUAH(m); },
  };

  const rent = {
    outlay0: 0,
    step(m) {
      const r = rentUAH(m);
      t.rent += r;
      return r;
    },
    net() { return 0; },
  };

  // Mortgage-to-let (renting): buy with mortgage, rent it out, rent own home
  const mtlRent = {
    outlay0: dpAmount + commission + fees,
    step(m) {
      const rentIn = rentUAH(m) * (1 - p.h_vacancyPct / 100) * (1 - p.h_rentTaxPct / 100);
      t2.netRent += rentIn;
      const own = ownRentUAH(m);
      t2.ownRent += own;
      let obl = own + maintMonthly(m) - rentIn;
      if (m <= loanMonths && debt2 > 0.005) {
        const ins = (p.h_insPct / 100) * homeUAH(m) / 12;
        const interest = debt2 * im;
        const pay = Math.min(annuity, debt2 + interest);
        t2.interest += interest;
        debt2 = debt2 + interest - pay;
        obl += pay + ins;
      }
      return obl;
    },
    net(m) { return homeUAH(m) - debt2; },
  };

  // Mortgage-to-let (own home): buy with mortgage, rent it out, live in own home for free
  const mtlOwn = {
    outlay0: dpAmount + commission + fees,
    step(m) {
      const rentIn = rentUAH(m) * (1 - p.h_vacancyPct / 100) * (1 - p.h_rentTaxPct / 100);
      t3.netRent += rentIn;
      let obl = maintMonthly(m) - rentIn;
      if (m <= loanMonths && debt3 > 0.005) {
        const ins = (p.h_insPct / 100) * homeUAH(m) / 12;
        const interest = debt3 * im;
        const pay = Math.min(annuity, debt3 + interest);
        t3.interest += interest;
        debt3 = debt3 + interest - pay;
        obl += pay + ins;
      }
      return obl;
    },
    net(m) { return homeUAH(m) - debt3; },
  };

  // Cash-to-let (renting): buy with cash, rent it out, rent own home
  const ctlRent = {
    outlay0: priceUAH0 + fees,
    step(m) {
      const rentIn = rentUAH(m) * (1 - p.h_vacancyPct / 100) * (1 - p.h_rentTaxPct / 100);
      t4.netRent += rentIn;
      const own = ownRentUAH(m);
      t4.ownRent += own;
      return own + maintMonthly(m) - rentIn;
    },
    net(m) { return homeUAH(m); },
  };

  // Cash-to-let (own home): buy with cash, rent it out, live in own home for free
  const ctlOwn = {
    outlay0: priceUAH0 + fees,
    step(m) {
      const rentIn = rentUAH(m) * (1 - p.h_vacancyPct / 100) * (1 - p.h_rentTaxPct / 100);
      t5.netRent += rentIn;
      return maintMonthly(m) - rentIn;
    },
    net(m) { return homeUAH(m); },
  };

  const r = runComparison({
    months, fx,
    instrument: instrumentOf(p),
    strategies: [mortgage, cash, rent, mtlRent, mtlOwn, ctlRent, ctlOwn],
  });

  // buy-to-let monthly cash flow: net rent minus annuity+insurance (while the
  // loan runs) and maintenance — what the flat "pays you" per month
  const insM = (m) => (p.h_insPct / 100) * homeUAH(m) / 12;
  const netRentM = (m) =>
    rentUAH(m) * (1 - p.h_vacancyPct / 100) * (1 - p.h_rentTaxPct / 100);
  const mtlFlowM = (m) => netRentM(m) - maintMonthly(m) -
    (m <= loanMonths ? annuity + insM(m) : 0);
  const ctlFlowM = (m) => netRentM(m) - maintMonthly(m);

  return {
    r, t, t2, t3, t4, t5, months,
    advMC: r.finals[0] - r.finals[1],
    priceUAH0, fees, dpAmount, principal, commission, annuity,
    homeEndUAH: homeUAH(months), rentNowUAH: rentUAH(1),
    debtEnd: debt,
    mtlRentM1: netRentM(1), mtlFlowM1: mtlFlowM(1),
    mtlRentEnd: netRentM(months), mtlFlowEnd: mtlFlowM(months),
    ctlFlowM1: ctlFlowM(1), ctlFlowEnd: ctlFlowM(months),
    loanDoneAtEnd: months > loanMonths,
  };
}

const HOME_NAMES = [
  'Buying with a mortgage', 'Buying with cash', 'Renting',
  'Mortgage-to-let (renting)', 'Mortgage-to-let (own home)',
  'Cash-to-let (renting)', 'Cash-to-let (own home)',
];

function homeSim(p) {
  const s = homeRun(p);
  const { r, t } = s;
  const be = bisect((y) => homeRun({ ...p, invYieldPct: y }).advMC);

  // verdict: winner vs runner-up among all five
  const order = [0, 1, 2, 3, 4, 5, 6].sort((i, j) => r.finals[j] - r.finals[i]);
  const winner = order[0], second = order[1];
  const adv = r.finals[winner] - r.finals[second];

  // why chart: mortgage vs cash purchase — what the loan costs and earns
  const whyRows = [
    { label: 'Investment income (mortgage − cash)', v: r.incomes[0] - r.incomes[1] },
    { label: 'Mortgage interest paid', v: -t.interest },
    { label: 'Bank commission', v: -s.commission },
    { label: 'Property insurance (bank-required)', v: -t.insurance },
  ];
  const residual = s.advMC - whyRows.reduce((a2, row) => a2 + row.v, 0);
  if (Math.abs(residual) > Math.max(1, Math.abs(s.advMC)) * 0.005) {
    whyRows.push({ label: 'FX effect on invested balance', v: residual });
  }
  whyRows.push({ label: 'Net result (mortgage vs cash buy)', v: s.advMC, total: true });

  const yieldEnd = p.investOff ? 0
    : Math.max(0, p.invYieldPct + p.yieldDriftPp * p.horizonYears);

  return {
    series: r.series, months: s.months,
    seriesDefs: [
      { short: 'Mortgage', legend: 'Buy with mortgage' },
      { short: 'Cash', legend: 'Buy with cash' },
      { short: 'Rent', legend: 'Rent + invest' },
      { short: 'MTL+rent', legend: 'Mortgage-to-let (renting)' },
      { short: 'MTL+own', legend: 'Mortgage-to-let (own home)' },
      { short: 'CTL+rent', legend: 'Cash-to-let (renting)' },
      { short: 'CTL+own', legend: 'Cash-to-let (own home)' },
    ],
    adv,
    paid: r.paid, paidUSD: r.paidUSD,
    baselineIndex: 1, // savings shown vs the cash purchase
    posName: HOME_NAMES[winner], negName: HOME_NAMES[winner],
    whyPos: `Beats ${HOME_NAMES[second].toLowerCase()} over ${p.horizonYears} years` +
      (winner !== 2 ? `; renting trails by ${uah(r.finals[winner] - r.finals[2])}.` : '.'),
    whyNeg: '',
    kpis: [
      { label: 'Mortgage payment vs rent (month 1)', value: uah(s.annuity), delta: `rent now ${uah(s.rentNowUAH)}/mo` },
      { label: `Advantage of ${HOME_NAMES[winner].toLowerCase()}`, value: uahSigned(adv), cls: 'good', delta: `vs ${HOME_NAMES[second].toLowerCase()}, ` + signed(adv / r.fxEnd / Math.pow(1 + p.usdInflPct / 100, p.horizonYears), usd) + ' today’s $' },
      { label: 'Mortgage-vs-cash break-even yield', value: be === null ? '—' : pct(be), delta: be === null ? 'no crossing in 0–100%' : 'mortgage beats cash buy above this rate' },
      { label: 'Total rent over horizon', value: uah(t.rent), delta: 'what a buyer avoids paying' },
    ],
    whyTitle: 'Why: mortgage vs cash purchase — what the loan costs and earns',
    whyRows,
    tableRows: [
      ['section', 'Purchase'],
      ['Apartment price', `${uah(s.priceUAH0)} (${usd(p.h_price)})`],
      ['Purchase fees (duty, pension fund, notary)', uah(s.fees)],
      ['Owner’s maintenance, total (both buyers)', uah(t.maintenance)],
      ['section', 'Mortgage'],
      ['Down payment', uah(s.dpAmount)],
      ['Loan principal', uah(s.principal)],
      ['Annuity payment / month', uah(s.annuity)],
      ['Total interest over the term', uah(t.interest)],
      ['One-time commission', uah(s.commission)],
      ['Property insurance, total', uah(t.insurance)],
      ['Remaining debt at horizon', uah(s.debtEnd)],
      ['section', 'Renting'],
      ['Rent, first month', uah(s.rentNowUAH)],
      ['Rent paid over horizon, total', uah(t.rent)],
      ['section', 'Mortgage-to-let'],
      ['Net rent the flat brings in, month 1', `${uah(s.mtlRentM1)}/mo (${usd(s.mtlRentM1 / p.fx0)}) after ${p.h_vacancyPct}% vacancy and ${p.h_rentTaxPct}% tax`],
      ['Cash flow after mortgage, ins & maint, month 1', `${uahSigned(s.mtlFlowM1)}/mo (${signed(s.mtlFlowM1 / p.fx0, usd)})`],
      ['Cash flow at the horizon', `${uahSigned(s.mtlFlowEnd)}/mo (${signed(s.mtlFlowEnd / r.fxEnd, usd)})` +
        (s.loanDoneAtEnd ? ' — mortgage paid off, net rent is ' + uah(s.mtlRentEnd) + '/mo' : ' — mortgage still running')],
      ['Rental income (renting variant), net', uah(s.t2.netRent)],
      ['Own rent paid (renting variant)', uah(s.t2.ownRent)],
      ['Mortgage interest (renting variant)', uah(s.t2.interest)],
      ['Rental income (own home variant), net', uah(s.t3.netRent)],
      ['Mortgage interest (own home variant)', uah(s.t3.interest)],
      ['section', 'Cash-to-let'],
      ['Cash flow (net rent − maintenance), month 1', `${uahSigned(s.ctlFlowM1)}/mo (${signed(s.ctlFlowM1 / p.fx0, usd)})`],
      ['Cash flow at the horizon', `${uahSigned(s.ctlFlowEnd)}/mo (${signed(s.ctlFlowEnd / r.fxEnd, usd)})`],
      ['Rental income (renting variant), net', uah(s.t4.netRent)],
      ['Own rent paid (renting variant)', uah(s.t4.ownRent)],
      ['Rental income (own home variant), net', uah(s.t5.netRent)],
      ['section', 'Investments'],
      ['Kept invested by the mortgage buyer at day 0 (vs cash buy)', uah(cashVsMortgageLump(s))],
      ['Investment income — mortgage buyer', uah(r.incomes[0])],
      ['Investment income — cash buyer', uah(r.incomes[1])],
      ['Investment income — renter', uah(r.incomes[2])],
      ['Investment income — mortgage-to-let (renting)', uah(r.incomes[3])],
      ['Investment income — mortgage-to-let (own home)', uah(r.incomes[4])],
      ['Investment income — cash-to-let (renting)', uah(r.incomes[5])],
      ['Investment income — cash-to-let (own home)', uah(r.incomes[6])],
      ['Yield at horizon (after drift)', pct(yieldEnd)],
      ['section', `Outcome after ${p.horizonYears} years`],
      ['Exchange rate at horizon', r.fxEnd.toFixed(1) + ' UAH/USD'],
      ['Apartment value at horizon', `${uah(s.homeEndUAH)} (${usd(s.homeEndUAH / r.fxEnd)})`],
      ['Net worth — buy with mortgage', uah(r.finals[0])],
      ['Net worth — buy with cash', uah(r.finals[1])],
      ['Net worth — rent + invest', uah(r.finals[2])],
      ['Net worth — mortgage-to-let (renting)', uah(r.finals[3])],
      ['Net worth — mortgage-to-let (own home)', uah(r.finals[4])],
      ['Net worth — cash-to-let (renting)', uah(r.finals[5])],
      ['Net worth — cash-to-let (own home)', uah(r.finals[6])],
    ],
    ctx: { inflPct: p.inflPct, usdInflPct: p.usdInflPct, horizonYears: p.horizonYears, fxEnd: r.fxEnd },
  };
}

function cashVsMortgageLump(s) {
  return (s.priceUAH0 + s.fees) - (s.dpAmount + s.commission + s.fees);
}
