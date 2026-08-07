/*
 * Module: OVDP (Ukrainian government bonds) scenario calculator.
 * Models actual coupon payment schedules with real dates, calculates
 * accrued interest (НКД), total return, effective yield, and break-even.
 * Supports discount bonds (no coupons) and coupon bonds (semi-annual,
 * quarterly, annual). Up to 4 bond scenarios compared side by side.
 */

const OVDP_SLOTS = [1, 2, 3, 4];

function ovdpParseDate(s) {
  if (!s) return null;
  const d = new Date(s + 'T00:00:00');
  return isNaN(d.getTime()) ? null : d;
}

function ovdpDaysBetween(a, b) {
  return Math.round((b - a) / 86400000);
}

function ovdpAddDays(d, n) {
  return new Date(d.getTime() + n * 86400000);
}

function ovdpFmtDate(d) {
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}.${mm}.${d.getFullYear()}`;
}

function ovdpReadBond(p, i) {
  return {
    slot: i,
    name: p[`ovdp${i}_name`] || `Bond ${i}`,
    nominal: p[`ovdp${i}_nominal`] || 1000,
    qty: Math.max(1, Math.round(p[`ovdp${i}_qty`] || 1)),
    priceUAH: p[`ovdp${i}_priceUAH`] || 1000,
    ratePct: p[`ovdp${i}_ratePct`] || 15,
    freq: p[`ovdp${i}_freq`] || 'semi',
    buyDate: ovdpParseDate(p[`ovdp${i}_buyDate`]),
    matDate: ovdpParseDate(p[`ovdp${i}_matDate`]),
    commPct: p[`ovdp${i}_commPct`] || 0,
  };
}

function ovdpActiveBonds(p) {
  return OVDP_SLOTS.filter((i) => p[`ovdp${i}_on`]).map((i) => ovdpReadBond(p, i));
}

function ovdpCouponPeriodDays(freq) {
  if (freq === 'quarterly') return 91;
  if (freq === 'annual') return 365;
  return 182; // semi-annual default
}

function ovdpCouponsPerYear(freq) {
  if (freq === 'quarterly') return 4;
  if (freq === 'annual') return 1;
  return 2;
}

/** Generate coupon payment dates working backwards from maturity. */
function ovdpCouponDates(matDate, buyDate, freq) {
  if (freq === 'maturity') return [matDate];
  const periodDays = ovdpCouponPeriodDays(freq);
  const dates = [];
  let d = new Date(matDate);
  while (d >= buyDate) {
    dates.unshift(new Date(d));
    d = ovdpAddDays(d, -periodDays);
  }
  return dates;
}

/** Calculate accrued interest (НКД) at purchase date. */
function ovdpCalcNKD(bond) {
  if (bond.freq === 'maturity') return 0;
  const periodDays = ovdpCouponPeriodDays(bond.freq);
  const couponAmt = bond.nominal * (bond.ratePct / 100) / ovdpCouponsPerYear(bond.freq);
  const allDates = ovdpCouponDates(bond.matDate, ovdpAddDays(bond.buyDate, -periodDays * 2), bond.freq);
  let lastCouponBefore = ovdpAddDays(bond.matDate, -periodDays * 100);
  for (const d of allDates) {
    if (d <= bond.buyDate) lastCouponBefore = d;
    else break;
  }
  const daysSinceLast = ovdpDaysBetween(lastCouponBefore, bond.buyDate);
  return couponAmt * (daysSinceLast / periodDays);
}

/** Full OVDP scenario simulation for one bond. */
function ovdpRunBond(bond) {
  if (!bond.buyDate || !bond.matDate || bond.matDate <= bond.buyDate) {
    return null;
  }

  const totalDays = ovdpDaysBetween(bond.buyDate, bond.matDate);
  const couponPerPeriod = bond.freq === 'maturity'
    ? bond.nominal * (bond.ratePct / 100) * (totalDays / 365)
    : bond.nominal * (bond.ratePct / 100) / ovdpCouponsPerYear(bond.freq);

  const nkd = ovdpCalcNKD(bond);
  const commission = bond.priceUAH * bond.qty * bond.commPct / 100;
  const totalInvested = bond.priceUAH * bond.qty + nkd * bond.qty + commission;

  const couponDates = ovdpCouponDates(bond.matDate, bond.buyDate, bond.freq);
  const futureCoupons = couponDates.filter((d) => d > bond.buyDate);

  const payments = [];
  let cumulative = -totalInvested;

  futureCoupons.forEach((d) => {
    const isMaturity = ovdpDaysBetween(d, bond.matDate) < 2;
    const coupon = couponPerPeriod * bond.qty;
    const principal = isMaturity ? bond.nominal * bond.qty : 0;
    const total = coupon + principal;
    cumulative += total;
    payments.push({
      date: d,
      dayFromBuy: ovdpDaysBetween(bond.buyDate, d),
      coupon,
      principal,
      total,
      cumulative,
      isMaturity,
    });
  });

  const totalCoupons = futureCoupons.length * couponPerPeriod * bond.qty;
  const totalReceived = totalCoupons + bond.nominal * bond.qty;
  const netProfit = totalReceived - totalInvested;

  // XIRR: find annual rate r such that NPV of all cash flows = 0
  const yearsToMat = totalDays / 365;
  const cfDates = [0]; // day 0 = purchase (negative cash flow)
  const cfAmts = [-totalInvested];
  payments.forEach((pay) => {
    cfDates.push(pay.dayFromBuy);
    cfAmts.push(pay.total);
  });
  let r = 0.10;
  for (let iter = 0; iter < 100; iter++) {
    let npv = 0, dnpv = 0;
    for (let k = 0; k < cfAmts.length; k++) {
      const t = cfDates[k] / 365;
      const disc = Math.pow(1 + r, t);
      npv += cfAmts[k] / disc;
      dnpv -= cfAmts[k] * t / (disc * (1 + r));
    }
    if (Math.abs(npv) < 0.01) break;
    if (Math.abs(dnpv) < 1e-12) break;
    r -= npv / dnpv;
    if (r < -0.5) r = -0.5;
    if (r > 10) r = 10;
  }
  const effectiveYield = r * 100;

  // equivalent deposit rate (what deposit rate gives same after-tax return)
  const eqDepositRate = effectiveYield / (1 - 0.23);

  // break-even: first payment where cumulative >= 0
  let breakEvenDate = null;
  let breakEvenDay = null;
  for (const pay of payments) {
    if (pay.cumulative >= 0) {
      breakEvenDate = pay.date;
      breakEvenDay = pay.dayFromBuy;
      break;
    }
  }

  return {
    bond,
    nkd,
    nkdTotal: nkd * bond.qty,
    commission,
    totalInvested,
    totalCoupons,
    totalReceived,
    netProfit,
    effectiveYield,
    eqDepositRate,
    breakEvenDate,
    breakEvenDay,
    payments,
    totalDays,
    yearsToMat,
    couponPerPeriod,
  };
}

/** Build chart-compatible time series from payment schedules. */
function ovdpBuildSeries(results) {
  const allDates = new Set();
  results.forEach((r) => {
    if (!r) return;
    allDates.add(r.bond.buyDate.getTime());
    r.payments.forEach((pay) => allDates.add(pay.date.getTime()));
  });
  const sorted = [...allDates].sort((a, b) => a - b);
  if (!sorted.length) return [];

  const minDate = sorted[0];
  const cumAt = results.map((r) => {
    if (!r) return () => 0;
    const map = new Map();
    map.set(r.bond.buyDate.getTime(), -r.totalInvested);
    r.payments.forEach((pay) => map.set(pay.date.getTime(), pay.cumulative));
    return (t) => {
      let last = -r.totalInvested;
      for (const [k, v] of map) {
        if (k <= t) last = v;
      }
      return last;
    };
  });

  return sorted.map((t) => ({
    date: new Date(t),
    day: Math.round((t - minDate) / 86400000),
    v: results.map((r, i) => r ? cumAt[i](t) : 0),
  }));
}

function ovdpSim(p) {
  const bonds = ovdpActiveBonds(p);
  if (!bonds.length) bonds.push(ovdpReadBond(p, 1));

  const results = bonds.map((b) => ovdpRunBond(b));
  const series = ovdpBuildSeries(results);

  const seriesDefs = bonds.map((b) => ({
    short: b.name.length > 18 ? b.name.slice(0, 17) + '…' : b.name,
    legend: `${b.name} — ${b.ratePct}%/${b.freq === 'semi' ? 'півріччя' : b.freq === 'quarterly' ? 'квартал' : b.freq === 'annual' ? 'рік' : 'погашення'}`,
  }));

  // find best by net profit
  let best = 0;
  results.forEach((r, i) => {
    if (r && results[best] && r.netProfit > results[best].netProfit) best = i;
  });

  const kpis = [];
  if (results.length === 1 && results[0]) {
    const r = results[0];
    kpis.push(
      { label: 'Total invested', value: uah(r.totalInvested),
        delta: `${r.bond.qty} bonds × ${uah(r.bond.priceUAH)} + НКД ${uah(r.nkdTotal)}` },
      { label: 'Net profit', value: uah(r.netProfit),
        delta: `${r.payments.length} coupon payments over ${(r.yearsToMat).toFixed(1)} years` },
      { label: 'Effective yield', value: r.effectiveYield.toFixed(2) + '%/yr',
        delta: `equivalent to ${r.eqDepositRate.toFixed(1)}% deposit (before 23% tax)` },
      { label: 'Break-even', value: r.breakEvenDate ? ovdpFmtDate(r.breakEvenDate) : 'at maturity',
        delta: r.breakEvenDay ? `day ${r.breakEvenDay} (${(r.breakEvenDay / 30).toFixed(1)} months)` : '' },
    );
  } else {
    const bestR = results[best];
    kpis.push(
      { label: 'Best scenario', value: bestR ? bonds[best].name : '—',
        delta: bestR ? `${uah(bestR.netProfit)} net profit, ${bestR.effectiveYield.toFixed(2)}%/yr` : '' },
    );
    results.forEach((r, i) => {
      if (!r) return;
      kpis.push({
        label: bonds[i].name,
        value: uah(r.netProfit),
        delta: `${r.effectiveYield.toFixed(2)}%/yr effective, eq. deposit ${r.eqDepositRate.toFixed(1)}%`,
      });
    });
  }

  // payment schedule table
  const tableRows = [];
  results.forEach((r, i) => {
    if (!r) return;
    const b = r.bond;
    tableRows.push(
      ['section', `${b.name} — ${b.ratePct}% ${b.freq === 'semi' ? 'semi-annual' : b.freq}`],
      ['Nominal × quantity', `${uah(b.nominal)} × ${b.qty} = ${uah(b.nominal * b.qty)}`],
      ['Clean price per bond', uah(b.priceUAH)],
      ['Accrued interest (НКД) at purchase', uah(r.nkdTotal)],
      ['Broker commission', r.commission > 0 ? uah(r.commission) : '—'],
      ['Total invested', uah(r.totalInvested)],
      ['Coupon per period (per bond)', uah(r.couponPerPeriod)],
      ['Coupons received (total)', `${uah(r.totalCoupons)} (${r.payments.length} payments)`],
      ['Nominal returned at maturity', uah(b.nominal * b.qty)],
      ['Total received', uah(r.totalReceived)],
      ['Net profit', uah(r.netProfit)],
      ['Effective annual yield', r.effectiveYield.toFixed(2) + '%'],
      ['Equivalent deposit rate (pre-tax)', r.eqDepositRate.toFixed(1) + '%'],
      ['Break-even date', r.breakEvenDate ? `${ovdpFmtDate(r.breakEvenDate)} (day ${r.breakEvenDay})` : 'at maturity'],
    );
    tableRows.push(['section', `Payment schedule — ${b.name}`]);
    r.payments.forEach((pay, j) => {
      const label = pay.isMaturity
        ? `${ovdpFmtDate(pay.date)} — maturity`
        : `${ovdpFmtDate(pay.date)} — coupon #${j + 1}`;
      const parts = [];
      if (pay.coupon > 0) parts.push(`coupon ${uah(pay.coupon)}`);
      if (pay.principal > 0) parts.push(`principal ${uah(pay.principal)}`);
      tableRows.push([label, `${parts.join(' + ')} = ${uah(pay.total)} (cumul: ${uah(pay.cumulative)})`]);
    });
  });

  // build month-indexed series for the generic chart renderer
  const maxDay = series.length ? series[series.length - 1].day : 0;
  const months = Math.ceil(maxDay / 30) || 1;
  const monthSeries = [];
  for (let m = 0; m <= months; m++) {
    const targetDay = m * 30;
    let closest = series[0];
    for (const pt of series) {
      if (Math.abs(pt.day - targetDay) < Math.abs(closest.day - targetDay)) closest = pt;
    }
    monthSeries.push({ m, fx: p.fx0 || 45, v: closest ? closest.v : results.map(() => 0) });
  }

  const verdict = results.length === 1 && results[0]
    ? `<strong>${bonds[0].name}: net profit ${uah(results[0].netProfit)} (${results[0].effectiveYield.toFixed(2)}%/yr effective yield) over ${results[0].yearsToMat.toFixed(1)} years.</strong>` +
      `<div class="why">Equivalent to a ${results[0].eqDepositRate.toFixed(1)}%/yr taxable deposit. ` +
      `${results[0].breakEvenDate ? 'Breaks even on ' + ovdpFmtDate(results[0].breakEvenDate) + '.' : 'Breaks even at maturity.'}</div>`
    : `<strong>Best: ${bonds[best].name} with ${uah(results[best] ? results[best].netProfit : 0)} net profit.</strong>` +
      `<div class="why">${bonds.map((b, i) => {
        const r = results[i];
        return r ? `${b.name}: ${r.effectiveYield.toFixed(2)}%/yr, profit ${uah(r.netProfit)}` : `${b.name}: invalid dates`;
      }).join(' · ')}</div>`;

  const paid = results.map((r) => r ? r.totalInvested : 0);
  const paidUSD = paid.map((v) => v / (p.fx0 || 45));
  const finals = monthSeries.length ? monthSeries[monthSeries.length - 1].v : results.map(() => 0);
  const fxEnd = p.fx0 || 45;

  return {
    series: monthSeries,
    months,
    seriesDefs,
    events: [],
    adv: 0,
    paid,
    paidUSD,
    baselineIndex: 0,
    verdict,
    kpis,
    whyTitle: '',
    whyRows: [],
    tableRows,
    ctx: { inflPct: p.inflPct || 11, usdInflPct: p.usdInflPct || 3, horizonYears: months / 12, fxEnd },
    // OVDP-specific data for the custom chart renderer
    ovdpResults: results,
    ovdpSeries: series,
    ovdpBonds: bonds,
  };
}
