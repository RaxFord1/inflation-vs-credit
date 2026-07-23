/*
 * Module: solar station — compare installing solar panels + battery storage
 * on your own property against simply investing the same money. Budget engine:
 * the baseline keeps paying the grid tariff and invests all savings; the solar
 * path spends the investment upfront, pays less for electricity, earns from
 * selling excess to tenants or the grid, and carries the equipment as an asset.
 *
 * Monthly solar yield varies by region (kWh per installed kW). Self-consumption
 * is modelled with a daytime-overlap factor plus battery contribution.
 */

const SOLAR_PROFILES = {
  central: [25, 40, 75, 105, 130, 135, 140, 125, 90, 55, 30, 20],
  south:   [35, 50, 90, 120, 150, 160, 165, 150, 110, 70, 40, 28],
  west:    [20, 35, 65, 95, 120, 125, 130, 115, 80, 50, 25, 18],
};
const SOLAR_PROFILE_LABELS = {
  central: 'Central (Kyiv) ~970 kWh/kW/yr',
  south:   'South (Odesa) ~1170 kWh/kW/yr',
  west:    'West (Lviv) ~880 kWh/kW/yr',
};
const SOLAR_MONTH_SHORT = ['Jan','Feb','Mar','Apr','May','Jun',
                           'Jul','Aug','Sep','Oct','Nov','Dec'];

function solarBalance(p, m) {
  const profile = SOLAR_PROFILES[p.sol_region] || SOLAR_PROFILES.central;
  const monthIdx = (m - 1) % 12;
  const yearNum = Math.floor((m - 1) / 12);
  const panelDeg = Math.pow(1 - p.sol_degradePct / 100, yearNum);
  const battDeg  = Math.pow(1 - p.sol_battDegradePct / 100, yearNum);

  const gen  = p.sol_capacityKW * profile[monthIdx] * panelDeg;
  const load = p.sol_consumptionKWh;

  const directSelf = Math.min(gen, load) * (p.sol_selfConsumePct / 100);
  const excess = Math.max(0, gen - directSelf);
  const remainingLoad = load - directSelf;
  const battCapMonth = p.sol_batteryKWh * battDeg * 0.8 * 30;
  const fromBattery = Math.min(battCapMonth, excess, remainingLoad);

  const selfConsumed = directSelf + fromBattery;
  const sold   = gen - selfConsumed;
  const bought = load - selfConsumed;

  return { gen, load, selfConsumed, sold, bought, monthIdx };
}

function solarSim(p) {
  const months = Math.max(1, Math.round(p.horizonYears * 12));
  const fx = makeFx(p);
  const ctx = makeCtx(p, fx);

  const profile     = SOLAR_PROFILES[p.sol_region] || SOLAR_PROFILES.central;
  const annualYield = profile.reduce((s, v) => s + v, 0);
  const totalCostUSD = p.sol_capacityKW * p.sol_panelCostPerKW +
    p.sol_batteryKWh * p.sol_batteryCostPerKWh + p.sol_installUSD;
  const totalCostUAH = totalCostUSD * p.fx0;
  const inverterMonth = Math.round(p.sol_inverterReplaceYr * 12);

  let yr1SaveUAH = 0, yr1TenantUAH = 0, yr1GridUAH = 0, yr1MaintUAH = 0;
  let totSaveUAH = 0, totTenantUAH = 0, totGridUAH = 0, totMaintUAH = 0;
  let totInvRepl = 0;
  let cumBenefitUSD = 0, breakEvenMonth = null;

  const strategies = [
    compileBlocks([
      curRentBlock(ctx),
      {
        kind: 'stream',
        uah: (m) =>
          p.sol_consumptionKWh *
          p.sol_tariffUAH * Math.pow(1 + p.sol_tariffGrowPct / 100, m * MONTH),
      },
    ]),

    compileBlocks([
      curRentBlock(ctx),
      { kind: 'upfront', uah: totalCostUAH },
      {
        kind: 'asset',
        valueUAH: (m) =>
          totalCostUSD * Math.pow(1 - p.sol_equipDepPct / 100, m / 12) * fx(m),
      },
      {
        kind: 'stream',
        uah: (m) => {
          const bal = solarBalance(p, m);
          const tariff  = p.sol_tariffUAH * Math.pow(1 + p.sol_tariffGrowPct / 100, m * MONTH);
          const feedIn  = p.sol_feedInUAH  * Math.pow(1 + p.sol_feedInGrowPct / 100, m * MONTH);
          const tenantT = p.sol_tenantUAH  * Math.pow(1 + p.sol_tariffGrowPct / 100, m * MONTH);

          const saveUAH   = bal.selfConsumed * tariff;
          const tenShare  = p.sol_tenantSharePct / 100;
          const tenantUAH = bal.sold * tenShare * tenantT;
          const gridUAH   = bal.sold * (1 - tenShare) * feedIn;
          const gridCost  = bal.bought * tariff;
          const maintUAH  = totalCostUSD * (p.sol_maintPct / 100) / 12 * fx(m);
          const invRepl   = (m === inverterMonth && m <= months)
            ? totalCostUSD * (p.sol_inverterCostPct / 100) * fx(m) : 0;

          if (m <= 12) {
            yr1SaveUAH += saveUAH; yr1TenantUAH += tenantUAH;
            yr1GridUAH += gridUAH; yr1MaintUAH += maintUAH;
          }
          totSaveUAH += saveUAH; totTenantUAH += tenantUAH;
          totGridUAH += gridUAH; totMaintUAH += maintUAH;
          totInvRepl += invRepl;

          cumBenefitUSD += (saveUAH + tenantUAH + gridUAH - maintUAH - invRepl) / fx(m);
          if (breakEvenMonth === null && cumBenefitUSD >= totalCostUSD)
            breakEvenMonth = m;

          return gridCost + maintUAH + invRepl - tenantUAH - gridUAH;
        },
      },
    ]),
  ];

  const savings0 = p.savings * (p.savingsCurrency === 'USD' ? p.fx0 : 1);
  const r = runBudget({
    months, fx,
    instrument: instrumentOf(p),
    savings0,
    income: (m) => ctx.salaryUAH(m) - ctx.livExpUAH(m),
    strategies,
  });

  const yrs     = p.horizonYears;
  const fxEnd   = r.fxEnd;
  const todayUSD = (v) => v / fxEnd / Math.pow(1 + p.usdInflPct / 100, yrs);
  const adv      = r.finals[1] - r.finals[0];
  const wins     = adv >= 0;

  const feasible = r.broke.map((b) => b === null);
  const flags = r.broke.map((b, i) => {
    if (i === 1 && strategies[1].outlay0 > savings0)
      return `needs ${uah(strategies[1].outlay0 - savings0)} more upfront than you have`;
    return b === null ? '' : `runs out of cash in year ${(b / 12).toFixed(1)}`;
  });

  const avgGenMo   = p.sol_capacityKW * annualYield / 12;
  const avgSelfMo  = avgGenMo * Math.min(1,
    p.sol_selfConsumePct / 100 +
    (p.sol_batteryKWh > 0
      ? Math.min(0.45, p.sol_batteryKWh * 0.8 * 30 / Math.max(1, avgGenMo))
      : 0));

  const yr1Net = yr1SaveUAH + yr1TenantUAH + yr1GridUAH - yr1MaintUAH;
  const simplePaybackMo = yr1Net > 0 ? Math.ceil(totalCostUAH / (yr1Net / 12)) : null;
  const totBenefit = totSaveUAH + totTenantUAH + totGridUAH;
  const totCosts   = totMaintUAH + totInvRepl;

  const beText = breakEvenMonth === null
    ? `does not pay back within ${yrs} years`
    : `pays back in month ${breakEvenMonth} (year ${(breakEvenMonth / 12).toFixed(1)})`;
  const simpleBeText = simplePaybackMo === null
    ? 'never (year-1 net is negative)'
    : `~${(simplePaybackMo / 12).toFixed(1)} years (${simplePaybackMo} months) by year-1 cash flow`;

  const residualUSD = totalCostUSD * Math.pow(1 - p.sol_equipDepPct / 100, yrs);

  const verdict = wins
    ? `<strong>Solar wins: ${signed(todayUSD(adv), usd)} more than simply investing, in today's dollars</strong>` +
      `<div class="why">The ${p.sol_capacityKW} kW system ${beText}. ` +
      `Year-1 net benefit is ${uah(yr1Net)}/yr (${usd(yr1Net / p.fx0)}) — electricity savings plus sales minus maintenance. ` +
      `Over ${yrs} years the total benefit is ${uah(totBenefit)} against ${uah(totCosts)} in costs and ${uah(totalCostUAH)} invested.</div>`
    : `<strong>Investing wins: solar falls short by ${signed(-todayUSD(adv), usd)} in today's dollars</strong>` +
      `<div class="why">The ${p.sol_capacityKW} kW system ${beText}. ` +
      `At ${p.invYieldPct}% yield on ${p.invCurrency}, the investment returns beat the electricity savings. ` +
      `Try higher tariff growth, larger capacity, or a lower equipment cost.</div>`;

  const kpis = [
    {
      label: 'Total investment',
      value: usd(totalCostUSD),
      delta: `${uah(totalCostUAH)} — panels ${usd(p.sol_capacityKW * p.sol_panelCostPerKW)}, ` +
        `battery ${usd(p.sol_batteryKWh * p.sol_batteryCostPerKWh)}, install ${usd(p.sol_installUSD)}`,
    },
    {
      label: 'Simple payback',
      value: simpleBeText,
      delta: breakEvenMonth !== null
        ? `discounted payback (accounting for investment yield): ${beText}`
        : beText,
    },
    {
      label: 'Year-1 monthly benefit',
      value: uah(Math.round(yr1Net / 12)) + '/mo',
      cls: yr1Net >= 0 ? 'good' : 'bad',
      delta: `savings ${uah(Math.round(yr1SaveUAH / 12))} + sales ${uah(Math.round((yr1TenantUAH + yr1GridUAH) / 12))} − maint ${uah(Math.round(yr1MaintUAH / 12))}`,
    },
    {
      label: `Net worth at ${yrs}y`,
      value: usd(todayUSD(r.finals[1])),
      cls: wins ? 'good' : '',
      delta: `vs no solar ${usd(todayUSD(r.finals[0]))} — difference ${signed(todayUSD(adv), usd)}, today's $`,
    },
  ];

  const whyRows = [
    { label: 'Electricity savings (self-consumption)', v: totSaveUAH },
    { label: 'Tenant sales', v: totTenantUAH },
    { label: 'Grid feed-in sales', v: totGridUAH },
    { label: 'Maintenance', v: -totMaintUAH },
    { label: 'Inverter replacement', v: -totInvRepl },
    { label: 'Equipment residual value', v: residualUSD * fxEnd },
    { label: 'Investment income difference', v: r.incomes[1] - r.incomes[0] },
  ].filter((row) => Math.abs(row.v) > 0.5);
  const residual = adv - whyRows.reduce((s, row) => s + row.v, 0);
  if (Math.abs(residual) > Math.max(1, Math.abs(adv)) * 0.005)
    whyRows.push({ label: 'FX & compounding effect', v: residual });
  whyRows.push({ label: 'Net result (solar vs no solar)', v: adv, total: true });

  const yr1Bal = solarBalance(p, 6);
  const endBal = solarBalance(p, months);
  const tableRows = [
    ['section', 'System'],
    ['Solar capacity', `${p.sol_capacityKW} kW`],
    ['Battery capacity', `${p.sol_batteryKWh} kWh`],
    ['Region / annual yield', `${SOLAR_PROFILE_LABELS[p.sol_region] || p.sol_region} — ${annualYield} kWh per kW`],
    ['Total investment', `${usd(totalCostUSD)} (${uah(totalCostUAH)})`],

    ['section', 'Monthly energy balance — year 1 average'],
    ['Generation (avg)',    `${Math.round(avgGenMo)} kWh/month`],
    ['Your consumption',   `${p.sol_consumptionKWh} kWh/month`],
    ['Self-consumed',      `${Math.round(avgSelfMo)} kWh/month (${(avgSelfMo / Math.max(1, p.sol_consumptionKWh) * 100).toFixed(0)}% of load)`],
    ['Sold (excess)',       `${Math.round(avgGenMo - avgSelfMo)} kWh/month`],
    ['Bought from grid',    `${Math.round(p.sol_consumptionKWh - avgSelfMo)} kWh/month`],

    ['section', 'Seasonal generation (kWh/month, year 1)'],
    ...SOLAR_MONTH_SHORT.map((name, i) => [
      name,
      `${Math.round(p.sol_capacityKW * profile[i])} kWh — ` +
      (() => {
        const gen = p.sol_capacityKW * profile[i];
        const sc = Math.min(gen, p.sol_consumptionKWh) * p.sol_selfConsumePct / 100;
        const ex = Math.max(0, gen - sc);
        const batt = Math.min(p.sol_batteryKWh * 0.8 * 30, ex, p.sol_consumptionKWh - sc);
        const total = sc + batt;
        return `self ${Math.round(total)} kWh, sold ${Math.round(gen - total)} kWh, buy ${Math.round(p.sol_consumptionKWh - total)} kWh`;
      })(),
    ]),

    ['section', 'Year 1 financials'],
    ['Electricity tariff', `${p.sol_tariffUAH} UAH/kWh, growing ${p.sol_tariffGrowPct}%/yr`],
    ['Feed-in tariff', `${p.sol_feedInUAH} UAH/kWh, growing ${p.sol_feedInGrowPct}%/yr`],
    ['Tenant sale price', `${p.sol_tenantUAH} UAH/kWh (${p.sol_tenantSharePct}% of excess)`],
    ['Electricity savings/yr', `${uah(yr1SaveUAH)} (self-consumed × grid tariff)`],
    ['Tenant sales/yr', uah(yr1TenantUAH)],
    ['Grid feed-in sales/yr', uah(yr1GridUAH)],
    ['Maintenance/yr', uah(yr1MaintUAH)],
    ['Net annual benefit (year 1)', `${uah(yr1Net)} (${usd(yr1Net / p.fx0)})`],

    ['section', `Totals over ${yrs} years`],
    ['Total electricity savings', uah(totSaveUAH)],
    ['Total tenant sales', uah(totTenantUAH)],
    ['Total grid sales', uah(totGridUAH)],
    ['Total maintenance', uah(totMaintUAH)],
    ['Inverter replacement', totInvRepl > 0 ? `${uah(totInvRepl)} at year ${p.sol_inverterReplaceYr}` : 'not within horizon'],
    ['Equipment residual value', `${usd(residualUSD)} (${uah(residualUSD * fxEnd)})`],
    ['Simple payback', simpleBeText],
    ['Discounted payback', beText],
  ];

  return {
    series: r.series, months,
    seriesDefs: [
      { short: 'No solar', legend: 'No solar — invest instead' },
      { short: 'Solar', legend: `Solar ${p.sol_capacityKW} kW + ${p.sol_batteryKWh} kWh battery` },
    ],
    diffLabel: 'Solar advantage',
    adv,
    paid: r.paid, paidUSD: r.paidUSD,
    baselineIndex: 0,
    flags,
    verdict,
    posName: 'Solar', negName: 'No solar',
    whyPos: `Electricity savings and sales income exceed the lost investment returns — solar adds ${signed(todayUSD(adv), usd)} in today's dollars.`,
    whyNeg: `Investment returns outpace electricity savings — solar costs you ${signed(-todayUSD(adv), usd)} in today's dollars vs simply investing.`,
    kpis,
    whyTitle: 'Why: what drives the solar advantage (nominal ₴ over the horizon)',
    whyRows,
    tableRows,
    ctx: { inflPct: p.inflPct, usdInflPct: p.usdInflPct, horizonYears: yrs, fxEnd },
  };
}
