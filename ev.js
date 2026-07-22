/*
 * Module: EV switch — keep old gas/diesel car (A) vs buy Car A on credit (B)
 * vs buy Car B on credit (C). Fuel savings, maintenance, depreciation,
 * and loan costs all roll into the standard comparison engine.
 */

function evFuelMonthly(p, type, kwh, phevGas, phevElecPct, m) {
  const fg = Math.pow(1 + p.ev_fuelGrowPct / 100, m * MONTH);
  const eg = Math.pow(1 + p.ev_elecGrowPct / 100, m * MONTH);
  if (type === 'ev') {
    return (p.ev_monthlyKm / 100) * kwh * p.ev_elecUAH * eg;
  }
  const ep = phevElecPct / 100;
  return ep * (p.ev_monthlyKm / 100) * kwh * p.ev_elecUAH * eg
    + (1 - ep) * (p.ev_monthlyKm / 100) * phevGas * p.ev_fuelUAH * fg;
}

function evRun(p) {
  const months = Math.max(1, Math.round(p.horizonYears * 12));
  const loanMonths = Math.max(1, Math.round(p.loanYears * 12));
  const fx = makeFx(p);
  const im = p.loanRatePct / 100 / 12;

  const fg = (m) => Math.pow(1 + p.ev_fuelGrowPct / 100, m * MONTH);
  const ug = (m) => Math.pow(1 + p.usdInflPct / 100, m * MONTH);

  const oldFuel = (m) => (p.ev_monthlyKm / 100) * p.eo_consumption * p.ev_fuelUAH * fg(m);
  const maintUAH = (usd, m) => usd * ug(m) * fx(m);

  const oldCarUAH = (m) => p.eo_valueUSD * Math.pow(1 - p.eo_depPct / 100, m * MONTH) * fx(m);
  const newCarA = (m) => p.ea_priceUSD * Math.pow(1 - p.ea_depPct / 100, m * MONTH) * fx(m);
  const newCarB = (m) => p.eb_priceUSD * Math.pow(1 - p.eb_depPct / 100, m * MONTH) * fx(m);

  const oldValueUAH0 = p.eo_valueUSD * p.fx0;
  const priceA0 = p.ea_priceUSD * p.fx0;
  const priceB0 = p.eb_priceUSD * p.fx0;
  const feesA = priceA0 * (p.pensionPct / 100) + p.regFeeUAH;
  const feesB = priceB0 * (p.pensionPct / 100) + p.regFeeUAH;

  const dpA = priceA0 * (p.dpPct / 100);
  const prinA = priceA0 - dpA;
  const commA = prinA * (p.commissionPct / 100);
  const annA = calcAnnuity(prinA, p.loanRatePct, loanMonths);
  const kaskoA = (m) => (p.kaskoPct / 100) * newCarA(m) / 12;

  const dpB = priceB0 * (p.dpPct / 100);
  const prinB = priceB0 - dpB;
  const commB = prinB * (p.commissionPct / 100);
  const annB = calcAnnuity(prinB, p.loanRatePct, loanMonths);
  const kaskoB = (m) => (p.kaskoPct / 100) * newCarB(m) / 12;

  const t = {
    oldFuel: 0, oldMaint: 0, transport: 0,
    fuelA: 0, maintA: 0, intA: 0, kaskoA: 0, feeA: 0, lifeInsA: 0,
    fuelB: 0, maintB: 0, intB: 0, kaskoB: 0, feeB: 0, lifeInsB: 0,
  };
  let debtA = prinA, debtB = prinB;

  const sellOld = p.ev_sellOld ? oldValueUAH0 : 0;

  const S0 = {
    outlay0: 0,
    step(m) {
      const f = oldFuel(m);
      const mt = maintUAH(p.eo_maintUSD, m);
      t.oldFuel += f;
      t.oldMaint += mt;
      return f + mt;
    },
    net(m) { return oldCarUAH(m); },
  };

  const S1 = {
    outlay0: dpA + commA + feesA - sellOld,
    step(m) {
      let obl = 0;
      const f = evFuelMonthly(p, p.ea_type, p.ea_kwh, p.ea_phevGas, p.ea_phevElecPct, m);
      const mt = maintUAH(p.ea_maintUSD, m);
      t.fuelA += f; t.maintA += mt;
      obl += f + mt;
      if (m <= loanMonths) { t.kaskoA += kaskoA(m); obl += kaskoA(m); }
      if (m <= loanMonths && debtA > 0.005) {
        const li = debtA * (p.lifeInsPct / 100) / 12;
        t.lifeInsA += li;
        const interest = debtA * im;
        const pay = Math.min(annA, debtA + interest);
        t.intA += interest;
        debtA = debtA + interest - pay;
        obl += pay + p.monthlyFeeUAH + li;
        t.feeA += p.monthlyFeeUAH;
      }
      return obl;
    },
    net(m) { return newCarA(m) - debtA; },
  };

  const S2 = {
    outlay0: dpB + commB + feesB - sellOld,
    step(m) {
      let obl = 0;
      const f = evFuelMonthly(p, p.eb_type, p.eb_kwh, p.eb_phevGas, p.eb_phevElecPct, m);
      const mt = maintUAH(p.eb_maintUSD, m);
      t.fuelB += f; t.maintB += mt;
      obl += f + mt;
      if (m <= loanMonths) { t.kaskoB += kaskoB(m); obl += kaskoB(m); }
      if (m <= loanMonths && debtB > 0.005) {
        const li = debtB * (p.lifeInsPct / 100) / 12;
        t.lifeInsB += li;
        const interest = debtB * im;
        const pay = Math.min(annB, debtB + interest);
        t.intB += interest;
        debtB = debtB + interest - pay;
        obl += pay + p.monthlyFeeUAH + li;
        t.feeB += p.monthlyFeeUAH;
      }
      return obl;
    },
    net(m) { return newCarB(m) - debtB; },
  };

  const S3 = {
    outlay0: -oldValueUAH0,
    step(m) {
      const tr = maintUAH(p.ev_transportUSD, m);
      t.transport += tr;
      return tr;
    },
    net(m) { return 0; },
  };

  const r = runComparison({
    months, fx,
    instrument: instrumentOf(p),
    strategies: [S0, S1, S2, S3],
  });

  let paybackA = null, paybackB = null;
  for (let m = 1; m <= months; m++) {
    if (paybackA === null && r.series[m].v[1] >= r.series[m].v[0]) paybackA = m;
    if (paybackB === null && r.series[m].v[2] >= r.series[m].v[0]) paybackB = m;
  }

  return {
    r, t, months,
    advA: r.finals[1] - r.finals[0],
    advB: r.finals[2] - r.finals[0],
    advSell: r.finals[3] - r.finals[0],
    paybackA, paybackB,
    oldValueUAH0, priceA0, priceB0, feesA, feesB, sellOld,
    dpA, prinA, commA, annA,
    dpB, prinB, commB, annB,
    debtAend: Math.max(0, debtA),
    debtBend: Math.max(0, debtB),
    oldCarEnd: oldCarUAH(months),
    newCarAend: newCarA(months),
    newCarBend: newCarB(months),
  };
}

function evSim(p) {
  const s = evRun(p);
  const { r, t } = s;
  const fx = makeFx(p);
  const fxEnd = r.fxEnd;

  const oldFuel1 = (p.ev_monthlyKm / 100) * p.eo_consumption * p.ev_fuelUAH;
  const fuelA1 = evFuelMonthly(p, p.ea_type, p.ea_kwh, p.ea_phevGas, p.ea_phevElecPct, 1);
  const fuelB1 = evFuelMonthly(p, p.eb_type, p.eb_kwh, p.eb_phevGas, p.eb_phevElecPct, 1);
  const savingA1 = oldFuel1 - fuelA1;
  const savingB1 = oldFuel1 - fuelB1;

  const nameA = p.ea_label || 'Car A';
  const nameB = p.eb_label || 'Car B';

  const transport1 = p.ev_transportUSD * p.fx0;

  const fmtPB = (m) => m === null ? 'not within ' + p.horizonYears + 'y'
    : m === 0 ? 'from day 1'
    : 'year ' + (m / 12).toFixed(1) + ' (month ' + m + ')';

  const allAdvs = [s.advA, s.advB, s.advSell];
  const allNames = [nameA, nameB, 'Sell + no car'];
  const bestIdx = allAdvs.indexOf(Math.max(...allAdvs));
  const bestAdv = allAdvs[bestIdx];
  const winner = bestAdv >= 0 ? allNames[bestIdx] : null;

  const whyRowsA = [
    { label: 'Fuel savings (' + nameA + ' vs old)', v: t.oldFuel - t.fuelA },
    { label: 'Maintenance savings', v: t.oldMaint - t.maintA },
    { label: 'Car depreciation difference', v: -(s.priceA0 - s.oldValueUAH0) + (s.newCarAend - s.oldCarEnd) },
    { label: 'Investment income difference', v: r.incomes[1] - r.incomes[0] },
    { label: 'Loan interest', v: -t.intA },
    { label: 'Bank commission', v: -s.commA },
    { label: 'KASKO insurance', v: -t.kaskoA },
    { label: 'Monthly fees + life insurance', v: -(t.feeA + t.lifeInsA) },
  ].filter((row, i) => i < 3 || Math.abs(row.v) > 0.5);
  const residualA = s.advA - whyRowsA.reduce((a, row) => a + row.v, 0);
  if (Math.abs(residualA) > Math.max(1, Math.abs(s.advA)) * 0.005) {
    whyRowsA.push({ label: 'FX and rounding', v: residualA });
  }
  whyRowsA.push({ label: 'Net result (' + nameA + ' vs keeping old)', v: s.advA, total: true });

  const yieldEnd = p.investOff ? 0
    : Math.max(0, p.invYieldPct + p.yieldDriftPp * p.horizonYears);

  return {
    series: r.series, months: s.months,
    seriesDefs: [
      { short: 'Keep old', legend: 'Keep current car' },
      { short: nameA, legend: nameA + ' (credit)' },
      { short: nameB, legend: nameB + ' (credit)' },
      { short: 'Sell', legend: 'Sell old + taxi/transit' },
    ],
    diffLabel: null,
    adv: bestAdv,
    paid: r.paid, paidUSD: r.paidUSD,
    baselineIndex: 0,
    posName: winner || 'Keep old', negName: 'Keeping old car',
    whyPos: (winner || 'Keep old') + ' beats keeping your old car over ' + p.horizonYears + ' years: fuel and maintenance savings outweigh purchase costs.',
    whyNeg: 'Keeping your old car is cheaper over ' + p.horizonYears + ' years — the purchase costs, depreciation and loan interest outweigh fuel savings.',
    kpis: [
      { label: 'Monthly fuel — old car', value: uah(oldFuel1), delta: p.eo_consumption + ' L/100km × ' + p.ev_monthlyKm + ' km' },
      { label: 'Monthly fuel — ' + nameA, value: uah(fuelA1), delta: savingA1 > 0 ? 'saves ' + uah(savingA1) + '/mo' : 'costs ' + uah(-savingA1) + '/mo more' },
      { label: 'Monthly fuel — ' + nameB, value: uah(fuelB1), delta: savingB1 > 0 ? 'saves ' + uah(savingB1) + '/mo' : 'costs ' + uah(-savingB1) + '/mo more' },
      { label: 'Monthly transport (no car)', value: uah(transport1), delta: usd(p.ev_transportUSD) + '/mo taxi+transit' },
      { label: nameA + ' payback', value: fmtPB(s.paybackA), cls: s.paybackA !== null ? 'good' : 'bad' },
      { label: nameB + ' payback', value: fmtPB(s.paybackB), cls: s.paybackB !== null ? 'good' : 'bad' },
      { label: 'Best option at ' + p.horizonYears + 'y', value: winner || 'Keep old', cls: bestAdv >= 0 ? 'good' : 'bad',
        delta: signed(bestAdv / fxEnd / Math.pow(1 + p.usdInflPct / 100, p.horizonYears), usd) + " in today's $" },
    ],
    whyTitle: 'Why: cost breakdown of ' + nameA + ' vs keeping old car',
    whyRows: whyRowsA,
    tableRows: [
      ['section', 'Current car'],
      ['Current car value', usd(p.eo_valueUSD)],
      ['Fuel consumption', p.eo_consumption + ' L/100km'],
      ['Fuel price (today)', uah(p.ev_fuelUAH) + '/L'],
      ['Monthly fuel cost (month 1)', uah(oldFuel1)],
      ['Monthly maintenance', usd(p.eo_maintUSD)],
      ['Car value at horizon', usd(s.oldCarEnd / fxEnd)],
      ['Total fuel over ' + p.horizonYears + 'y', uah(t.oldFuel)],

      ['section', nameA],
      ['Purchase price', usd(p.ea_priceUSD)],
      ['Type', p.ea_type === 'ev' ? 'Electric (EV)' : 'Plug-in Hybrid (PHEV)'],
      ['Consumption', p.ea_type === 'ev' ? p.ea_kwh + ' kWh/100km' : p.ea_kwh + ' kWh/100km electric + ' + p.ea_phevGas + ' L/100km gas (' + p.ea_phevElecPct + '% electric)'],
      ['Monthly fuel cost (month 1)', uah(fuelA1)],
      ['Monthly maintenance', usd(p.ea_maintUSD)],
      ['Down payment', uah(s.dpA) + ' (' + usd(s.dpA / p.fx0) + ')'],
      ['Loan principal', uah(s.prinA) + ' (' + usd(s.prinA / p.fx0) + ')'],
      ['Annuity payment / month', uah(s.annA)],
      ['Total interest', uah(t.intA)],
      ['Total KASKO', uah(t.kaskoA)],
      ['Car value at horizon', usd(s.newCarAend / fxEnd)],
      ['Total fuel over ' + p.horizonYears + 'y', uah(t.fuelA)],
      ['Payback vs keeping old', fmtPB(s.paybackA)],

      ['section', nameB],
      ['Purchase price', usd(p.eb_priceUSD)],
      ['Type', p.eb_type === 'ev' ? 'Electric (EV)' : 'Plug-in Hybrid (PHEV)'],
      ['Consumption', p.eb_type === 'ev' ? p.eb_kwh + ' kWh/100km' : p.eb_kwh + ' kWh/100km electric + ' + p.eb_phevGas + ' L/100km gas (' + p.eb_phevElecPct + '% electric)'],
      ['Monthly fuel cost (month 1)', uah(fuelB1)],
      ['Monthly maintenance', usd(p.eb_maintUSD)],
      ['Down payment', uah(s.dpB) + ' (' + usd(s.dpB / p.fx0) + ')'],
      ['Loan principal', uah(s.prinB) + ' (' + usd(s.prinB / p.fx0) + ')'],
      ['Annuity payment / month', uah(s.annB)],
      ['Total interest', uah(t.intB)],
      ['Total KASKO', uah(t.kaskoB)],
      ['Car value at horizon', usd(s.newCarBend / fxEnd)],
      ['Total fuel over ' + p.horizonYears + 'y', uah(t.fuelB)],
      ['Payback vs keeping old', fmtPB(s.paybackB)],

      ['section', 'Sell old + taxi/transit'],
      ['Old car sale proceeds', usd(p.eo_valueUSD)],
      ['Monthly transport cost', uah(transport1) + ' (' + usd(p.ev_transportUSD) + ')'],
      ['Total transport over ' + p.horizonYears + 'y', uah(t.transport)],
      ['Advantage vs keeping old', uahSigned(s.advSell)],

      ['section', 'Savings comparison'],
      ['Old car sold for', p.ev_sellOld ? usd(p.eo_valueUSD) : 'not sold'],
      ['Fuel saved — ' + nameA, uah(t.oldFuel - t.fuelA) + ' (' + usd((t.oldFuel - t.fuelA) / fxEnd) + ')'],
      ['Fuel saved — ' + nameB, uah(t.oldFuel - t.fuelB) + ' (' + usd((t.oldFuel - t.fuelB) / fxEnd) + ')'],
      ['Maintenance saved — ' + nameA, uah(t.oldMaint - t.maintA)],
      ['Maintenance saved — ' + nameB, uah(t.oldMaint - t.maintB)],

      ['section', 'Outcome after ' + p.horizonYears + ' years'],
      ['Exchange rate at horizon', fxEnd.toFixed(1) + ' UAH/USD'],
      ['Yield at horizon (after drift)', pct(yieldEnd)],
      ['Net worth — keep old car', uah(r.finals[0])],
      ['Net worth — ' + nameA, uah(r.finals[1])],
      ['Net worth — ' + nameB, uah(r.finals[2])],
      ['Net worth — sell + no car', uah(r.finals[3])],
    ],
    ctx: { inflPct: p.inflPct, usdInflPct: p.usdInflPct, horizonYears: p.horizonYears, fxEnd },
  };
}
