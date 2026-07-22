/*
 * Module: EV switch — keep old car vs buy N alternative cars on credit
 * vs sell old and use taxi/transit. Strategies are built dynamically from
 * enabled car slots (a–e); fuel cost depends on powertrain type.
 */

const EV_SLOTS = ['a', 'b', 'c', 'd', 'e'];

function evFuelPrice(p, fuelType) {
  if (fuelType === 'diesel') return p.ev_dieselUAH;
  if (fuelType === 'lpg') return p.ev_lpgUAH;
  return p.ev_fuelUAH;
}

function evElecPrice(p, publicPct) {
  const pp = (publicPct || 0) / 100;
  return p.ev_elecUAH * (1 - pp) + p.ev_publicUAH * pp;
}

function evFuelMonthly(p, type, kwh, fuelL, elecPct, publicPct, m) {
  const fg = Math.pow(1 + p.ev_fuelGrowPct / 100, m * MONTH);
  const eg = Math.pow(1 + p.ev_elecGrowPct / 100, m * MONTH);
  const km = p.ev_monthlyKm / 100;
  if (type === 'ev') {
    return km * kwh * evElecPrice(p, publicPct) * eg;
  }
  if (type === 'phev') {
    const ep = (elecPct || 0) / 100;
    return ep * km * kwh * evElecPrice(p, publicPct) * eg
      + (1 - ep) * km * fuelL * p.ev_fuelUAH * fg;
  }
  if (type === 'diesel') {
    return km * fuelL * p.ev_dieselUAH * fg;
  }
  // hev, petrol — both use petrol price, hev just has lower consumption
  return km * fuelL * p.ev_fuelUAH * fg;
}

function evOldFuelMonthly(p, m) {
  const fg = Math.pow(1 + p.ev_fuelGrowPct / 100, m * MONTH);
  return (p.ev_monthlyKm / 100) * p.eo_consumption * evFuelPrice(p, p.eo_fuelType) * fg;
}

function evRun(p) {
  const months = Math.max(1, Math.round(p.horizonYears * 12));
  const loanMonths = Math.max(1, Math.round(p.loanYears * 12));
  const fx = makeFx(p);
  const ctx = makeCtx(p, fx);
  const im = p.loanRatePct / 100 / 12;
  const ug = (m) => Math.pow(1 + p.usdInflPct / 100, m * MONTH);
  const maintUAH = (usd, m) => usd * ug(m) * fx(m);
  const savings0 = p.savings * (p.savingsCurrency === 'USD' ? p.fx0 : 1);

  const oldValueUAH0 = p.eo_valueUSD * p.fx0;
  const oldCarUAH = (m) => p.eo_valueUSD * Math.pow(1 - p.eo_depPct / 100, m * MONTH) * fx(m);

  // Gather active car slots
  const active = EV_SLOTS.filter(s => p['e' + s + '_on']);

  // Per-slot data
  const cars = active.map(s => {
    const pre = 'e' + s + '_';
    const priceUSD = p[pre + 'priceUSD'];
    const depPct = p[pre + 'depPct'];
    const type = p[pre + 'type'];
    const kwh = p[pre + 'kwh'];
    const fuelL = p[pre + 'phevGas'];
    const elecPct = p[pre + 'phevElecPct'];
    const publicPct = p[pre + 'publicPct'];
    const maintUSDval = p[pre + 'maintUSD'];
    const label = p[pre + 'label'] || ('Car ' + s.toUpperCase());

    const priceUAH0 = priceUSD * p.fx0;
    const fees = priceUAH0 * (p.pensionPct / 100) + p.regFeeUAH;
    const dp = priceUAH0 * (p.dpPct / 100);
    const prin = priceUAH0 - dp;
    const comm = prin * (p.commissionPct / 100);
    const ann = calcAnnuity(prin, p.loanRatePct, loanMonths);
    const carUAH = (m) => priceUSD * Math.pow(1 - depPct / 100, m * MONTH) * fx(m);
    const kasko = (m) => (p.kaskoPct / 100) * carUAH(m) / 12;

    return { s, label, type, kwh, fuelL, elecPct, publicPct, maintUSDval,
             priceUSD, priceUAH0, fees, dp, prin, comm, ann, carUAH, kasko };
  });

  // Totals tracker
  const t = { oldFuel: 0, oldMaint: 0, transport: 0 };
  for (const c of cars) {
    t['fuel_' + c.s] = 0;
    t['maint_' + c.s] = 0;
    t['int_' + c.s] = 0;
    t['kasko_' + c.s] = 0;
    t['fee_' + c.s] = 0;
    t['lifeIns_' + c.s] = 0;
  }

  const sellOld = p.ev_sellOld ? oldValueUAH0 : 0;
  const debts = {};
  for (const c of cars) debts[c.s] = c.prin;

  // S0: keep old car
  const S0 = {
    outlay0: 0,
    step(m) {
      const f = evOldFuelMonthly(p, m);
      const mt = maintUAH(p.eo_maintUSD, m);
      t.oldFuel += f;
      t.oldMaint += mt;
      return f + mt;
    },
    net(m) { return oldCarUAH(m); },
  };

  // Car strategies
  const carStrategies = cars.map(c => ({
    outlay0: c.dp + c.comm + c.fees - sellOld,
    step(m) {
      let obl = 0;
      const f = evFuelMonthly(p, c.type, c.kwh, c.fuelL, c.elecPct, c.publicPct, m);
      const mt = maintUAH(c.maintUSDval, m);
      t['fuel_' + c.s] += f;
      t['maint_' + c.s] += mt;
      obl += f + mt;
      if (m <= loanMonths) {
        t['kasko_' + c.s] += c.kasko(m);
        obl += c.kasko(m);
      }
      if (m <= loanMonths && debts[c.s] > 0.005) {
        const li = debts[c.s] * (p.lifeInsPct / 100) / 12;
        t['lifeIns_' + c.s] += li;
        const interest = debts[c.s] * im;
        const pay = Math.min(c.ann, debts[c.s] + interest);
        t['int_' + c.s] += interest;
        debts[c.s] = debts[c.s] + interest - pay;
        obl += pay + p.monthlyFeeUAH + li;
        t['fee_' + c.s] += p.monthlyFeeUAH;
      }
      return obl;
    },
    net(m) { return c.carUAH(m) - debts[c.s]; },
  }));

  // S_sell: sell old, use taxi/transit
  const Ssell = {
    outlay0: -oldValueUAH0,
    step(m) {
      const tr = maintUAH(p.ev_transportUSD, m);
      t.transport += tr;
      return tr;
    },
    net(m) { return 0; },
  };

  const strategies = [S0, ...carStrategies, Ssell];

  const r = runBudget({
    months, fx,
    instrument: instrumentOf(p),
    savings0,
    income: (m) => ctx.salaryUAH(m) - ctx.livExpUAH(m) - ctx.curRentUAH(m),
    strategies,
  });

  // Payback: when does each new car's net worth >= keep old's
  const paybacks = {};
  for (let ci = 0; ci < cars.length; ci++) {
    paybacks[cars[ci].s] = null;
    for (let m = 1; m <= months; m++) {
      if (r.series[m].v[ci + 1] >= r.series[m].v[0]) {
        paybacks[cars[ci].s] = m;
        break;
      }
    }
  }

  const sellIdx = strategies.length - 1;

  return {
    r, t, months, active, cars, debts, paybacks, sellIdx,
    oldValueUAH0, sellOld,
    oldCarEnd: oldCarUAH(months),
    advSell: r.finals[sellIdx] - r.finals[0],
  };
}

function evSim(p) {
  const s = evRun(p);
  const { r, t, cars, active } = s;
  const fxEnd = r.fxEnd;

  const oldFuel1 = evOldFuelMonthly(p, 1);
  const transport1 = p.ev_transportUSD * p.fx0;

  const fmtPB = (m) => m === null ? 'not within ' + p.horizonYears + 'y'
    : m === 0 ? 'from day 1'
    : 'year ' + (m / 12).toFixed(1) + ' (month ' + m + ')';

  // Find best option
  const advs = cars.map((c, i) => r.finals[i + 1] - r.finals[0]);
  advs.push(s.advSell);
  const names = cars.map(c => c.label);
  names.push('Sell + no car');
  const bestIdx = advs.indexOf(Math.max(...advs));
  const bestAdv = advs[bestIdx];
  const winner = bestAdv >= 0 ? names[bestIdx] : null;

  // Series definitions
  const seriesDefs = [
    { short: 'Keep old', legend: 'Keep current car' },
  ];
  for (const c of cars) {
    const typeTag = c.type === 'ev' ? 'EV' : c.type === 'phev' ? 'PHEV'
      : c.type === 'hev' ? 'HEV' : c.type === 'diesel' ? 'diesel' : 'petrol';
    seriesDefs.push({ short: c.label, legend: c.label + ' (' + typeTag + ', credit)' });
  }
  seriesDefs.push({ short: 'Sell', legend: 'Sell old + taxi/transit' });

  // KPIs
  const kpis = [
    { label: 'Monthly fuel — old car', value: uah(oldFuel1),
      delta: p.eo_consumption + ' L/100km × ' + p.ev_monthlyKm + ' km' },
  ];
  for (const c of cars) {
    const f1 = evFuelMonthly(p, c.type, c.kwh, c.fuelL, c.elecPct, c.publicPct, 1);
    const saving = oldFuel1 - f1;
    kpis.push({
      label: 'Monthly fuel — ' + c.label,
      value: uah(f1),
      delta: saving > 0 ? 'saves ' + uah(saving) + '/mo' : 'costs ' + uah(-saving) + '/mo more',
    });
  }
  kpis.push({ label: 'Monthly transport (no car)', value: uah(transport1),
    delta: usd(p.ev_transportUSD) + '/mo taxi+transit' });
  for (const c of cars) {
    kpis.push({
      label: c.label + ' payback',
      value: fmtPB(s.paybacks[c.s]),
      cls: s.paybacks[c.s] !== null ? 'good' : 'bad',
    });
  }
  kpis.push({
    label: 'Best option at ' + p.horizonYears + 'y',
    value: winner || 'Keep old',
    cls: bestAdv >= 0 ? 'good' : 'bad',
    delta: signed(bestAdv / fxEnd / Math.pow(1 + p.usdInflPct / 100, p.horizonYears), usd) + " in today's $",
  });

  // Why chart: breakdown for the first active car vs keeping old
  const c0 = cars[0];
  const whyRows = c0 ? [
    { label: 'Fuel savings (' + c0.label + ' vs old)', v: t.oldFuel - t['fuel_' + c0.s] },
    { label: 'Maintenance savings', v: t.oldMaint - t['maint_' + c0.s] },
    { label: 'Car depreciation difference',
      v: -(c0.priceUAH0 - s.oldValueUAH0) + (c0.carUAH(s.months) - s.oldCarEnd) },
    { label: 'Investment income difference', v: r.incomes[1] - r.incomes[0] },
    { label: 'Loan interest', v: -t['int_' + c0.s] },
    { label: 'Bank commission', v: -c0.comm },
    { label: 'KASKO insurance', v: -t['kasko_' + c0.s] },
    { label: 'Monthly fees + life insurance', v: -(t['fee_' + c0.s] + t['lifeIns_' + c0.s]) },
  ].filter((row, i) => i < 3 || Math.abs(row.v) > 0.5) : [];

  if (c0) {
    const advFirst = r.finals[1] - r.finals[0];
    const residual = advFirst - whyRows.reduce((a, row) => a + row.v, 0);
    if (Math.abs(residual) > Math.max(1, Math.abs(advFirst)) * 0.005) {
      whyRows.push({ label: 'FX and rounding', v: residual });
    }
    whyRows.push({ label: 'Net result (' + c0.label + ' vs keeping old)', v: advFirst, total: true });
  }

  const yieldEnd = p.investOff ? 0
    : Math.max(0, p.invYieldPct + p.yieldDriftPp * p.horizonYears);

  // Table rows
  const tableRows = [
    ['section', 'Current car'],
    ['Current car value', usd(p.eo_valueUSD)],
    ['Fuel type', p.eo_fuelType],
    ['Fuel consumption', p.eo_consumption + ' L/100km'],
    ['Fuel price (today)', uah(evFuelPrice(p, p.eo_fuelType)) + '/L'],
    ['Monthly fuel cost (month 1)', uah(oldFuel1)],
    ['Monthly maintenance', usd(p.eo_maintUSD)],
    ['Car value at horizon', usd(s.oldCarEnd / fxEnd)],
    ['Total fuel over ' + p.horizonYears + 'y', uah(t.oldFuel)],
  ];

  for (const c of cars) {
    const f1 = evFuelMonthly(p, c.type, c.kwh, c.fuelL, c.elecPct, c.publicPct, 1);
    const typeLabel = c.type === 'ev' ? 'Electric (EV)' : c.type === 'phev' ? 'Plug-in Hybrid (PHEV)'
      : c.type === 'hev' ? 'Hybrid (HEV)' : c.type === 'diesel' ? 'Diesel' : 'Petrol';
    let consumptionStr;
    if (c.type === 'ev') {
      consumptionStr = c.kwh + ' kWh/100km';
      if (c.publicPct > 0) consumptionStr += ' (' + c.publicPct + '% public charging)';
    } else if (c.type === 'phev') {
      consumptionStr = c.kwh + ' kWh/100km electric + ' + c.fuelL + ' L/100km gas (' + c.elecPct + '% electric)';
      if (c.publicPct > 0) consumptionStr += ' (' + c.publicPct + '% public charging)';
    } else {
      consumptionStr = c.fuelL + ' L/100km';
    }

    tableRows.push(
      ['section', c.label],
      ['Purchase price', usd(c.priceUSD)],
      ['Type', typeLabel],
      ['Consumption', consumptionStr],
      ['Monthly fuel cost (month 1)', uah(f1)],
      ['Monthly maintenance', usd(c.maintUSDval)],
      ['Down payment', uah(c.dp) + ' (' + usd(c.dp / p.fx0) + ')'],
      ['Loan principal', uah(c.prin) + ' (' + usd(c.prin / p.fx0) + ')'],
      ['Annuity payment / month', uah(c.ann)],
      ['Total interest', uah(t['int_' + c.s])],
      ['Total KASKO', uah(t['kasko_' + c.s])],
      ['Car value at horizon', usd(c.carUAH(s.months) / fxEnd)],
      ['Total fuel over ' + p.horizonYears + 'y', uah(t['fuel_' + c.s])],
      ['Payback vs keeping old', fmtPB(s.paybacks[c.s])],
    );
  }

  tableRows.push(
    ['section', 'Sell old + taxi/transit'],
    ['Old car sale proceeds', usd(p.eo_valueUSD)],
    ['Monthly transport cost', uah(transport1) + ' (' + usd(p.ev_transportUSD) + ')'],
    ['Total transport over ' + p.horizonYears + 'y', uah(t.transport)],
    ['Advantage vs keeping old', uahSigned(s.advSell)],
  );

  tableRows.push(
    ['section', 'Savings comparison'],
    ['Old car sold for', p.ev_sellOld ? usd(p.eo_valueUSD) : 'not sold'],
  );
  for (const c of cars) {
    tableRows.push(
      ['Fuel saved — ' + c.label, uah(t.oldFuel - t['fuel_' + c.s]) + ' (' + usd((t.oldFuel - t['fuel_' + c.s]) / fxEnd) + ')'],
    );
  }
  for (const c of cars) {
    tableRows.push(
      ['Maintenance saved — ' + c.label, uah(t.oldMaint - t['maint_' + c.s])],
    );
  }

  tableRows.push(
    ['section', 'Outcome after ' + p.horizonYears + ' years'],
    ['Exchange rate at horizon', fxEnd.toFixed(1) + ' UAH/USD'],
    ['Yield at horizon (after drift)', pct(yieldEnd)],
    ['Net worth — keep old car', uah(r.finals[0])],
  );
  for (let i = 0; i < cars.length; i++) {
    tableRows.push(['Net worth — ' + cars[i].label, uah(r.finals[i + 1])]);
  }
  tableRows.push(['Net worth — sell + no car', uah(r.finals[s.sellIdx])]);

  return {
    series: r.series, months: s.months,
    seriesDefs,
    diffLabel: null,
    adv: bestAdv,
    paid: r.paid, paidUSD: r.paidUSD,
    baselineIndex: 0,
    posName: winner || 'Keep old', negName: 'Keeping old car',
    whyPos: (winner || 'Keep old') + ' beats keeping your old car over ' + p.horizonYears + ' years: fuel and maintenance savings outweigh purchase costs.',
    whyNeg: 'Keeping your old car is cheaper over ' + p.horizonYears + ' years — the purchase costs, depreciation and loan interest outweigh fuel savings.',
    kpis,
    whyTitle: c0 ? 'Why: cost breakdown of ' + c0.label + ' vs keeping old car' : '',
    whyRows,
    tableRows,
    ctx: { inflPct: p.inflPct, usdInflPct: p.usdInflPct, horizonYears: p.horizonYears, fxEnd },
  };
}
