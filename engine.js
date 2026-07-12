/*
 * Generic two-strategy comparison engine.
 *
 * Fairness convention — both strategies face identical external cash flows:
 *   t0: both persons part with max(outlay A, outlay B); the one who spends
 *       less invests the difference immediately.
 *   monthly: both part with max(obligation A, obligation B); the one who owes
 *       less invests the gap.
 * So the wealth difference at the horizon is caused only by the costs and
 * returns inside the strategies — never by one person "having more money".
 *
 * A strategy is { outlay0, step(m) -> obligation UAH, net(m) -> assets−debt }.
 * step() may mutate internal state (amortization); net() is read after step().
 *
 * Currency model: three price levels drift independently but are linked —
 * UAH CPI deflates to "today's ₴", USD CPI to "today's $", nominal FX
 * converts between them. Under PPP, deval ≈ (1+πUAH)/(1+πUSD) − 1.
 */

const MONTH = 1 / 12;

/** Effective monthly rate from an annual effective rate (%). */
function monthlyRate(annualPct) {
  return Math.pow(1 + annualPct / 100, MONTH) - 1;
}

/**
 * Investment account. instr: {currency:'UAH'|'USD', yieldPct, taxPct, driftPp}.
 * USD accounts hold USD units and are marked to UAH at the drifting FX.
 * Yield drifts by driftPp percentage points per year, floored at 0; interest
 * is taxed as it accrues.
 */
function makeAccount(instr, fx) {
  const isUSD = instr.currency === 'USD';
  let bal = 0; // in instrument currency
  let income = 0; // UAH, at accrual-month FX
  const netRate = (m) =>
    monthlyRate(Math.max(0, instr.yieldPct + (instr.driftPp || 0) * m * MONTH)) *
    (1 - instr.taxPct / 100);
  return {
    deposit(uahAmt, m) { bal += isUSD ? uahAmt / fx(m) : uahAmt; },
    grow(m) {
      const g = bal * netRate(m);
      bal += g;
      income += isUSD ? g * fx(m) : g;
    },
    valueUAH(m) { return isUSD ? bal * fx(m) : bal; },
    get incomeUAH() { return income; },
  };
}

/**
 * Investment instrument from params. With p.investOff the freed-up money
 * still accumulates (and still sits in the chosen currency, so UAH cash
 * devalues against the dollar) but earns nothing — a "clean prices"
 * comparison where only the costs of each path differ.
 */
function instrumentOf(p) {
  return p.investOff
    ? { currency: p.invCurrency, yieldPct: 0, taxPct: 0, driftPp: 0 }
    : { currency: p.invCurrency, yieldPct: p.invYieldPct,
        taxPct: p.invTaxPct, driftPp: p.yieldDriftPp };
}

/**
 * Runs N strategies against each other. Each period everyone parts with the
 * maximum obligation across strategies; each strategy invests its own gap
 * below that maximum. Accounts are linear in contributions, so pairwise
 * differences are independent of which strategy sets the maximum.
 * Returns per-month net worths (series[i].v aligned with strategies order).
 */
function runComparison({ months, fx, instrument, strategies }) {
  const accs = strategies.map(() => makeAccount(instrument, fx));

  const out0 = strategies.map((s) => s.outlay0);
  const max0 = Math.max(...out0);
  strategies.forEach((s, i) => accs[i].deposit(max0 - out0[i], 0));

  const paid = out0.slice(); // cumulative out-of-pocket, UAH
  const paidUSD = out0.map((v) => v / fx(0)); // …in USD at payment-time FX

  const series = [{
    m: 0,
    fx: fx(0),
    v: strategies.map((s, i) => accs[i].valueUAH(0) + s.net(0)),
  }];

  for (let m = 1; m <= months; m++) {
    accs.forEach((a) => a.grow(m));
    const obl = strategies.map((s) => s.step(m));
    const mx = Math.max(...obl);
    strategies.forEach((s, i) => {
      accs[i].deposit(mx - obl[i], m);
      paid[i] += obl[i];
      paidUSD[i] += obl[i] / fx(m);
    });
    series.push({
      m,
      fx: fx(m),
      v: strategies.map((s, i) => accs[i].valueUAH(m) + s.net(m)),
      obl,
    });
  }

  const last = series[series.length - 1];
  return {
    series,
    months,
    finals: last.v,
    fxEnd: last.fx,
    incomes: accs.map((a) => a.incomeUAH),
    paid,
    paidUSD,
  };
}

/**
 * Budget mode: one person with real savings and a real salary, N possible
 * decisions. Each strategy starts from savings0 minus its own upfront outlay;
 * every month the account grows, income(m) arrives, the strategy's obligation
 * is paid, and the remainder is invested (a negative remainder is withdrawn).
 * A balance below zero means the plan doesn't fit the budget — the first such
 * month is reported in broke[i] (past it the numbers assume borrowing at the
 * investment rate, which flatters the plan).
 */
function runBudget({ months, fx, instrument, savings0, income, strategies }) {
  const accs = strategies.map(() => makeAccount(instrument, fx));
  const broke = strategies.map(() => null);
  strategies.forEach((s, i) => {
    accs[i].deposit(savings0 - s.outlay0, 0);
    if (accs[i].valueUAH(0) < 0) broke[i] = 0;
  });

  const paid = strategies.map((s) => s.outlay0);
  const paidUSD = strategies.map((s) => s.outlay0 / fx(0));

  const series = [{
    m: 0,
    fx: fx(0),
    v: strategies.map((s, i) => accs[i].valueUAH(0) + s.net(0)),
  }];

  for (let m = 1; m <= months; m++) {
    accs.forEach((a) => a.grow(m));
    const inc = income(m);
    const obl = strategies.map((s) => s.step(m));
    strategies.forEach((s, i) => {
      accs[i].deposit(inc - obl[i], m);
      paid[i] += obl[i];
      paidUSD[i] += obl[i] / fx(m);
      if (broke[i] === null && accs[i].valueUAH(m) < 0) broke[i] = m;
    });
    series.push({
      m,
      fx: fx(m),
      v: strategies.map((s, i) => accs[i].valueUAH(m) + s.net(m)),
      obl,
    });
  }

  const last = series[series.length - 1];
  return {
    series,
    months,
    finals: last.v,
    fxEnd: last.fx,
    incomes: accs.map((a) => a.incomeUAH),
    paid,
    paidUSD,
    broke,
  };
}

/** Root of f on [lo, hi] by bisection; null when there is no sign change. */
function bisect(f, lo = 0, hi = 100) {
  let flo = f(lo);
  const fhi = f(hi);
  if (flo * fhi > 0) return null;
  for (let k = 0; k < 60; k++) {
    const mid = (lo + hi) / 2;
    const fm = f(mid);
    if (flo * fm <= 0) hi = mid;
    else { lo = mid; flo = fm; }
  }
  return (lo + hi) / 2;
}

/** PPP-implied nominal devaluation (%/yr) from the two inflation rates. */
function pppDevaluation(inflPct, usdInflPct, realDriftPct = 0) {
  return (
    ((1 + inflPct / 100) / (1 + usdInflPct / 100)) * (1 + realDriftPct / 100) * 100 -
    100
  );
}

/* ---------- shared formatting (UI helpers used by modules and app) ---------- */
const fmtUAH0 = new Intl.NumberFormat('uk-UA', { maximumFractionDigits: 0 });
const fmtUSD0 = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const uah = (v) => '₴' + fmtUAH0.format(Math.round(v));
const usd = (v) => '$' + fmtUSD0.format(Math.round(v));
const signed = (v, f) => (v >= 0 ? '+' : '−') + f(Math.abs(v));
const uahSigned = (v) => signed(v, uah);
const pct = (v, d = 1) => v.toFixed(d) + '%';

function moneyShort(v, symbol) {
  const a = Math.abs(v);
  const sign = v < 0 ? '−' : '';
  if (a >= 1e6) return sign + symbol + (a / 1e6).toFixed(a >= 1e7 ? 0 : 1) + 'M';
  if (a >= 1e3) return sign + symbol + Math.round(a / 1e3) + 'k';
  return sign + symbol + Math.round(a);
}
const uahShort = (v) => moneyShort(v, '₴');

if (typeof module !== 'undefined') {
  module.exports = { monthlyRate, makeAccount, runComparison, bisect, pppDevaluation };
}
