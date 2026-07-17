/*
 * Module: buying a car — cash (A) vs credit + invest the rest (B).
 * Builds the two strategies, runs the engine, and returns a standardized
 * result object the app renders generically.
 */

/** One full engine run; returns raw results + derived quantities + totals. */
function carRun(p) {
  const months = Math.max(1, Math.round(p.horizonYears * 12));
  const loanMonths = Math.max(1, Math.round(p.loanYears * 12));

  const fx = makeFx(p);
  const priceUAH0 = p.priceCurrency === 'USD' ? p.price * p.fx0 : p.price;
  const priceUSD0 = priceUAH0 / p.fx0;

  const carUAH = (m) =>
    priceUSD0 * Math.pow(1 - p.carDepPct / 100, m * MONTH) * fx(m);

  const stateFees = priceUAH0 * (p.pensionPct / 100) + p.regFeeUAH;
  const cashDiscount = priceUAH0 * (p.cashDiscountPct / 100);

  const dpAmount = priceUAH0 * (p.dpPct / 100);
  const principal = priceUAH0 - dpAmount;
  const commission = principal * (p.commissionPct / 100);
  const im = p.loanRatePct / 100 / 12;
  const annuity = calcAnnuity(principal, p.loanRatePct, loanMonths);

  const kaskoMonthly = (m) => (p.kaskoPct / 100) * carUAH(m) / 12;

  const t = { interest: 0, kaskoCredit: 0, kaskoCash: 0, monthlyFees: 0, lifeIns: 0 };
  let debt = principal;

  const A = { // cash buyer
    outlay0: priceUAH0 - cashDiscount + stateFees,
    step(m) {
      const k = p.kaskoCash ? kaskoMonthly(m) : 0; // optional, whole horizon
      t.kaskoCash += k;
      return k;
    },
    net(m) { return carUAH(m); },
  };

  const B = { // credit buyer
    outlay0: dpAmount + commission + stateFees,
    step(m) {
      let obl = 0;
      if (m <= loanMonths) { // KASKO mandatory while the loan lives
        obl += kaskoMonthly(m);
        t.kaskoCredit += kaskoMonthly(m);
      }
      if (m <= loanMonths && debt > 0.005) {
        const lifeIns = debt * (p.lifeInsPct / 100) / 12;
        t.lifeIns += lifeIns;
        const interest = debt * im;
        const pay = Math.min(annuity, debt + interest);
        t.interest += interest;
        debt = debt + interest - pay;
        obl += pay + p.monthlyFeeUAH + lifeIns;
        t.monthlyFees += p.monthlyFeeUAH;
      }
      return obl;
    },
    net(m) { return carUAH(m) - debt; },
  };

  const r = runComparison({
    months, fx,
    instrument: instrumentOf(p),
    strategies: [A, B],
  });

  return {
    r, t, months,
    adv: r.finals[1] - r.finals[0], // >0 → credit wins
    priceUAH0, priceUSD0, stateFees, cashDiscount, dpAmount, principal,
    commission, annuity, lump0: A.outlay0 - B.outlay0,
    firstMonthPayment:
      annuity + p.monthlyFeeUAH + kaskoMonthly(1) + principal * (p.lifeInsPct / 100) / 12,
    carEndUAH: carUAH(months),
    debtEnd: Math.max(0, debt),
  };
}

function carSim(p) {
  const s = carRun(p);
  const { r, t, adv } = s;
  const be = bisect((y) => carRun({ ...p, invYieldPct: y }).adv);

  const kaskoDelta = t.kaskoCredit - t.kaskoCash;
  const extraCosts = t.interest + s.commission + t.monthlyFees + t.lifeIns + kaskoDelta;

  const whyRows = [
    { label: 'Investment income (credit − cash)', v: r.incomes[1] - r.incomes[0] },
    { label: 'Loan interest paid', v: -t.interest },
    { label: 'Bank commission', v: -s.commission },
    { label: 'Monthly fees', v: -t.monthlyFees },
    { label: 'Extra KASKO insurance', v: -kaskoDelta },
    { label: 'Life insurance', v: -t.lifeIns },
    { label: 'Cash price difference forgone', v: -s.cashDiscount },
  ].filter((row, i) => i < 2 || Math.abs(row.v) > 0.5);
  const residual = adv - whyRows.reduce((a2, row) => a2 + row.v, 0);
  if (Math.abs(residual) > Math.max(1, Math.abs(adv)) * 0.005) {
    whyRows.push({ label: 'FX effect on invested balance', v: residual });
  }
  whyRows.push({ label: 'Net result (credit vs cash)', v: adv, total: true });

  const yieldEnd = p.investOff ? 0
    : Math.max(0, p.invYieldPct + p.yieldDriftPp * p.horizonYears);

  return {
    series: r.series, months: s.months,
    seriesDefs: [
      { short: 'Cash', legend: 'Cash purchase' },
      { short: 'Credit', legend: 'Credit + invest the rest' },
    ],
    diffLabel: 'Credit advantage',
    adv,
    paid: r.paid, paidUSD: r.paidUSD,
    baselineIndex: 0, // savings shown vs the cash purchase
    posName: 'Credit', negName: 'Cash',
    whyPos: 'The invested lump sum out-earns the loan’s interest, fees and mandatory KASKO over ' + p.horizonYears + ' years.',
    whyNeg: 'Interest, fees and mandatory KASKO cost more than the invested money earns over ' + p.horizonYears + ' years.',
    kpis: [
      { label: 'Monthly payment (month 1)', value: uah(s.firstMonthPayment), delta: `annuity ${uah(s.annuity)} + insurance` },
      { label: 'Final advantage of credit', value: uahSigned(adv), cls: adv >= 0 ? 'good' : 'bad', delta: signed(adv / r.fxEnd / Math.pow(1 + p.usdInflPct / 100, p.horizonYears), usd) + ' in today’s dollars' },
      { label: 'Break-even yield', value: be === null ? '—' : pct(be), delta: be === null ? 'no crossing in 0–100%' : 'credit wins above this rate' },
      { label: 'Total cost of credit', value: uah(extraCosts), delta: 'interest + fees + insurance' },
    ],
    whyTitle: 'Why: extra costs of credit vs what the invested money earned',
    whyRows,
    tableRows: [
      ['section', 'Purchase'],
      ['Car price', `${uah(s.priceUAH0)} (${usd(s.priceUSD0)})`],
      ['Cash price difference', uah(s.cashDiscount)],
      ['Pension fund + registration (both scenarios)', uah(s.stateFees)],
      ['section', 'Loan'],
      ['Down payment', uah(s.dpAmount)],
      ['Loan principal', uah(s.principal)],
      ['Annuity payment / month', uah(s.annuity)],
      ['Total interest over the term', uah(t.interest)],
      ['One-time commission', uah(s.commission)],
      ['Remaining debt at horizon', s.debtEnd > 0.5 ? uah(s.debtEnd) : 'paid off'],
      ['Monthly fees, total', uah(t.monthlyFees)],
      ['KASKO, total (credit buyer)', uah(t.kaskoCredit)],
      ['KASKO, total (cash buyer)', uah(t.kaskoCash)],
      ['Life insurance, total', uah(t.lifeIns)],
      ['section', 'Investments'],
      ['Lump sum the credit buyer invests at day 0', uah(s.lump0)],
      ['Investment income — credit scenario', uah(r.incomes[1])],
      ['Investment income — cash scenario (monthly contributions)', uah(r.incomes[0])],
      ['Yield at horizon (after drift)', pct(yieldEnd)],
      ['section', `Outcome after ${p.horizonYears} years`],
      ['Exchange rate at horizon', r.fxEnd.toFixed(1) + ' UAH/USD'],
      ['Car value at horizon', `${uah(s.carEndUAH)} (${usd(s.carEndUAH / r.fxEnd)})`],
      ['Net worth — cash scenario', uah(r.finals[0])],
      ['Net worth — credit scenario', uah(r.finals[1])],
    ],
    ctx: { inflPct: p.inflPct, usdInflPct: p.usdInflPct, horizonYears: p.horizonYears, fxEnd: r.fxEnd },
  };
}
