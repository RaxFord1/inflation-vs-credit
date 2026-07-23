/*
 * Module: solar station — electricity resale business with solar generation.
 *
 * Business model: you buy electricity from the grid and resell to consumers
 * (tenants / neighbours) at a markup. Adding solar panels + battery storage
 * lets you replace some of that grid purchase with free solar power. You sell
 * solar kWh at a lower price than grid (consumers benefit), but since your
 * COGS on solar is zero the margin is much higher than the grid markup.
 *
 * Energy priority:
 *  1. Self-use (own consumption, default 0)
 *  2. Sell to consumers (capped by their demand)
 *  3. Store in battery for later consumer demand
 *  4. Sell excess to grid at feed-in tariff
 *
 * When solar + battery < consumer demand, shortfall comes from the grid at
 * full price and is resold at the grid markup — exactly what you do today.
 * Monthly cash flow never goes negative (except the initial investment).
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
  const demand = p.sol_demandKWh;
  const selfUse = Math.min(p.sol_selfUseKWh || 0, gen);
  const afterSelf = gen - selfUse;

  const directOverlap = afterSelf * (p.sol_overlapPct / 100);
  const excess = afterSelf - directOverlap;
  const battCapMonth = p.sol_batteryKWh * battDeg * 0.8 * 30;
  const fromBattery = Math.min(battCapMonth, excess, Math.max(0, demand - directOverlap));

  const solarToConsumers = Math.min(directOverlap + fromBattery, demand);
  const gridForConsumers = demand - solarToConsumers;
  const excessToGrid = gen - selfUse - solarToConsumers;

  return { gen, selfUse, solarToConsumers, gridForConsumers, excessToGrid, monthIdx };
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
  const markupFrac = p.sol_markupPct / 100;

  let yr1SolarRev = 0, yr1GridProfit = 0, yr1FeedIn = 0, yr1SelfSave = 0, yr1Maint = 0;
  let totSolarRev = 0, totGridProfit = 0, totFeedIn = 0, totSelfSave = 0, totMaint = 0;
  let totInvRepl = 0;
  let cumExtraProfitUSD = 0, breakEvenMonth = null;

  /* Strategy 0: no solar — buy ALL from grid, sell to consumers at markup.
   * Strategy 1: solar — sell solar kWh at solar price (COGS = 0),
   *             buy shortfall from grid at grid price, sell at markup.
   *
   * Both strategies share the same base income (salary minus living exp).
   * The obligation captures the NET cost of each path:
   *   S0 obligation = 0 (grid resale profit is modelled as negative obligation,
   *        i.e. the income function already includes it)
   *   S1 obligation = maintenance + inverter - extra profit from solar
   *
   * Actually, for clarity: both earn the baseline grid-resale profit as part
   * of income. S1's obligation is negative when solar adds extra profit. */

  const gridBuyGrow = (m) =>
    p.sol_gridBuyUAH * Math.pow(1 + p.sol_gridBuyGrowPct / 100, m * MONTH);
  const solarSellGrow = (m) =>
    p.sol_solarSellUAH * Math.pow(1 + p.sol_solarSellGrowPct / 100, m * MONTH);
  const feedInGrow = (m) =>
    p.sol_feedInUAH * Math.pow(1 + p.sol_feedInGrowPct / 100, m * MONTH);

  const baseGridProfit = (m) => {
    const gridBuy = gridBuyGrow(m);
    return p.sol_demandKWh * gridBuy * markupFrac;
  };

  const strategies = [
    compileBlocks([
      curRentBlock(ctx),
      { kind: 'stream', uah: (m) => -baseGridProfit(m) },
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
          const gridBuy   = gridBuyGrow(m);
          const solarSell = solarSellGrow(m);
          const feedIn    = feedInGrow(m);

          const solarRevenue = bal.solarToConsumers * solarSell;
          const gridProfit   = bal.gridForConsumers * gridBuy * markupFrac;
          const feedInRev    = bal.excessToGrid * feedIn;
          const selfSaveRev  = bal.selfUse * gridBuy;
          const totalRevenue = solarRevenue + gridProfit + feedInRev + selfSaveRev;

          const maintUAH  = totalCostUSD * (p.sol_maintPct / 100) / 12 * fx(m);
          const invRepl   = (m === inverterMonth && m <= months)
            ? totalCostUSD * (p.sol_inverterCostPct / 100) * fx(m) : 0;

          if (m <= 12) {
            yr1SolarRev += solarRevenue; yr1GridProfit += gridProfit;
            yr1FeedIn += feedInRev; yr1SelfSave += selfSaveRev;
            yr1Maint += maintUAH;
          }
          totSolarRev += solarRevenue; totGridProfit += gridProfit;
          totFeedIn += feedInRev; totSelfSave += selfSaveRev;
          totMaint += maintUAH; totInvRepl += invRepl;

          const baseProfit = baseGridProfit(m);
          const extraProfit = totalRevenue - baseProfit - maintUAH - invRepl;
          cumExtraProfitUSD += extraProfit / fx(m);
          if (breakEvenMonth === null && cumExtraProfitUSD >= totalCostUSD)
            breakEvenMonth = m;

          return -(totalRevenue) + maintUAH + invRepl;
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

  const flags = r.broke.map((b, i) => {
    if (i === 1 && strategies[1].outlay0 > savings0)
      return `needs ${uah(strategies[1].outlay0 - savings0)} more upfront than you have`;
    return b === null ? '' : `runs out of cash in year ${(b / 12).toFixed(1)}`;
  });

  const yr1TotalRev  = yr1SolarRev + yr1GridProfit + yr1FeedIn + yr1SelfSave;
  const yr1Net       = yr1TotalRev - yr1Maint;
  const yr1BaseProfit = (() => {
    let s = 0;
    for (let m = 1; m <= Math.min(12, months); m++) s += baseGridProfit(m);
    return s;
  })();
  const yr1ExtraProfit = yr1Net - yr1BaseProfit;

  const simplePaybackMo = yr1ExtraProfit > 0
    ? Math.ceil(totalCostUAH / (yr1ExtraProfit / 12)) : null;

  const beText = breakEvenMonth === null
    ? `does not pay back within ${yrs} years`
    : `pays back in month ${breakEvenMonth} (year ${(breakEvenMonth / 12).toFixed(1)})`;
  const simpleBeText = simplePaybackMo === null
    ? 'never (year-1 extra profit is negative)'
    : `~${(simplePaybackMo / 12).toFixed(1)} years (${simplePaybackMo} months)`;

  const residualUSD = totalCostUSD * Math.pow(1 - p.sol_equipDepPct / 100, yrs);

  const avgGenMo   = p.sol_capacityKW * annualYield / 12;
  const avgSelfMo  = Math.min(p.sol_selfUseKWh || 0, avgGenMo);
  const afterSelfAvg = avgGenMo - avgSelfMo;
  const directAvg = afterSelfAvg * (p.sol_overlapPct / 100);
  const excessAvg = afterSelfAvg - directAvg;
  const battAvg   = Math.min(p.sol_batteryKWh * 0.8 * 30, excessAvg,
    Math.max(0, p.sol_demandKWh - directAvg));
  const solarToConsAvg = Math.min(directAvg + battAvg, p.sol_demandKWh);
  const gridShortfallAvg = p.sol_demandKWh - solarToConsAvg;
  const excessToGridAvg = avgGenMo - avgSelfMo - solarToConsAvg;

  const verdict = wins
    ? `<strong>Solar wins: adds ${signed(todayUSD(adv), usd)} vs grid-only resale, in today's dollars</strong>` +
      `<div class="why">The ${p.sol_capacityKW} kW system ${beText}. ` +
      `Year-1 extra profit (above grid markup): ${uah(yr1ExtraProfit)}/yr. ` +
      `Solar replaces ${Math.round(solarToConsAvg)} of ${p.sol_demandKWh} kWh/mo from the grid ` +
      `— you sell those kWh at ${p.sol_solarSellUAH} UAH instead of earning just the ${p.sol_markupPct}% markup.</div>`
    : `<strong>Grid-only resale wins by ${signed(-todayUSD(adv), usd)} in today's dollars</strong>` +
      `<div class="why">The ${p.sol_capacityKW} kW system ${beText}. ` +
      `At ${p.invYieldPct}% yield on ${p.invCurrency}, investing the ${usd(totalCostUSD)} beats the solar margin uplift. ` +
      `Try longer horizon, higher tariff growth, or cheaper panels.</div>`;

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
      label: 'Year-1 extra monthly profit',
      value: uah(Math.round(yr1ExtraProfit / 12)) + '/mo',
      cls: yr1ExtraProfit >= 0 ? 'good' : 'bad',
      delta: `solar revenue ${uah(Math.round((yr1SolarRev + yr1FeedIn + yr1SelfSave) / 12))} ` +
        `− lost grid margin ${uah(Math.round((yr1BaseProfit - yr1GridProfit) / 12))} ` +
        `− maint ${uah(Math.round(yr1Maint / 12))}`,
    },
    {
      label: `Net worth at ${yrs}y`,
      value: usd(todayUSD(r.finals[1])),
      cls: wins ? 'good' : '',
      delta: `vs no solar ${usd(todayUSD(r.finals[0]))} — difference ${signed(todayUSD(adv), usd)}, today's $`,
    },
  ];

  const totBaseProfit = (() => {
    let s = 0;
    for (let m = 1; m <= months; m++) s += baseGridProfit(m);
    return s;
  })();
  const totExtraSolarRev = totSolarRev + totFeedIn + totSelfSave;
  const totLostMargin = totBaseProfit - totGridProfit;

  const whyRows = [
    { label: 'Solar revenue (sold to consumers)', v: totSolarRev },
    { label: 'Feed-in revenue (excess → grid)', v: totFeedIn },
    { label: 'Self-use savings', v: totSelfSave },
    { label: 'Lost grid markup (replaced by solar)', v: -totLostMargin },
    { label: 'Maintenance', v: -totMaint },
    { label: 'Inverter replacement', v: -totInvRepl },
    { label: 'Equipment residual value', v: residualUSD * fxEnd },
    { label: 'Investment income difference', v: r.incomes[1] - r.incomes[0] },
  ].filter((row) => Math.abs(row.v) > 0.5);
  const residual = adv - whyRows.reduce((s, row) => s + row.v, 0);
  if (Math.abs(residual) > Math.max(1, Math.abs(adv)) * 0.005)
    whyRows.push({ label: 'FX & compounding effect', v: residual });
  whyRows.push({ label: 'Net result (solar vs grid-only)', v: adv, total: true });

  const tableRows = [
    ['section', 'System'],
    ['Solar capacity', `${p.sol_capacityKW} kW`],
    ['Battery capacity', `${p.sol_batteryKWh} kWh`],
    ['Region / annual yield', `${SOLAR_PROFILE_LABELS[p.sol_region] || p.sol_region} — ${annualYield} kWh per kW`],
    ['Total investment', `${usd(totalCostUSD)} (${uah(totalCostUAH)})`],

    ['section', 'Your resale business — current (no solar)'],
    ['Consumer demand', `${p.sol_demandKWh} kWh/month`],
    ['Grid buy price', `${p.sol_gridBuyUAH} UAH/kWh, growing ${p.sol_gridBuyGrowPct}%/yr`],
    ['Resale markup', `${p.sol_markupPct}%`],
    ['Grid resale price', `${(p.sol_gridBuyUAH * (1 + markupFrac)).toFixed(2)} UAH/kWh`],
    ['Year-1 grid resale profit', `${uah(yr1BaseProfit)}/yr (${uah(Math.round(yr1BaseProfit / 12))}/mo)`],

    ['section', 'With solar — monthly energy balance (year 1 avg)'],
    ['Generation (avg)',         `${Math.round(avgGenMo)} kWh/month`],
    ['Self-use',                 `${Math.round(avgSelfMo)} kWh/month`],
    ['Solar → consumers',        `${Math.round(solarToConsAvg)} kWh/month (replaces grid)`],
    ['Grid → consumers',         `${Math.round(gridShortfallAvg)} kWh/month (shortfall)`],
    ['Excess → grid (feed-in)',  `${Math.round(Math.max(0, excessToGridAvg))} kWh/month`],

    ['section', 'Seasonal generation (kWh/month, year 1)'],
    ...SOLAR_MONTH_SHORT.map((name, i) => {
      const gen = p.sol_capacityKW * profile[i];
      const su = Math.min(p.sol_selfUseKWh || 0, gen);
      const after = gen - su;
      const dir = after * (p.sol_overlapPct / 100);
      const ex = after - dir;
      const batt = Math.min(p.sol_batteryKWh * 0.8 * 30, ex, Math.max(0, p.sol_demandKWh - dir));
      const toCons = Math.min(dir + batt, p.sol_demandKWh);
      const fromGrid = p.sol_demandKWh - toCons;
      const toGrid = gen - su - toCons;
      return [name, `${Math.round(gen)} kWh — solar→cons ${Math.round(toCons)}, grid→cons ${Math.round(fromGrid)}, excess→grid ${Math.round(Math.max(0, toGrid))}`];
    }),

    ['section', 'Pricing'],
    ['Grid buy price', `${p.sol_gridBuyUAH} UAH/kWh, growing ${p.sol_gridBuyGrowPct}%/yr`],
    ['Resale markup', `${p.sol_markupPct}% → sell at ${(p.sol_gridBuyUAH * (1 + markupFrac)).toFixed(2)} UAH/kWh`],
    ['Solar sell price', `${p.sol_solarSellUAH} UAH/kWh, growing ${p.sol_solarSellGrowPct}%/yr`],
    ['Feed-in tariff', `${p.sol_feedInUAH} UAH/kWh, growing ${p.sol_feedInGrowPct}%/yr`],
    ['Margin: grid kWh', `${(p.sol_gridBuyUAH * markupFrac).toFixed(2)} UAH/kWh (markup only)`],
    ['Margin: solar kWh', `${p.sol_solarSellUAH.toFixed(2)} UAH/kWh (COGS = 0)`],

    ['section', 'Year 1 financials'],
    ['Solar revenue (→consumers)', uah(yr1SolarRev)],
    ['Grid resale profit', uah(yr1GridProfit)],
    ['Feed-in revenue', uah(yr1FeedIn)],
    ['Self-use savings', yr1SelfSave > 0 ? uah(yr1SelfSave) : 'n/a (self-use off)'],
    ['Maintenance', uah(yr1Maint)],
    ['Total year-1 revenue', uah(yr1TotalRev)],
    ['vs grid-only profit', `${uah(yr1BaseProfit)} → extra ${uahSigned(yr1ExtraProfit)}/yr`],

    ['section', `Totals over ${yrs} years`],
    ['Total solar revenue', uah(totSolarRev)],
    ['Total feed-in revenue', uah(totFeedIn)],
    ['Total self-use savings', totSelfSave > 0 ? uah(totSelfSave) : 'n/a'],
    ['Total grid resale profit', uah(totGridProfit)],
    ['Total maintenance', uah(totMaint)],
    ['Inverter replacement', totInvRepl > 0 ? `${uah(totInvRepl)} at year ${p.sol_inverterReplaceYr}` : 'not within horizon'],
    ['Equipment residual value', `${usd(residualUSD)} (${uah(residualUSD * fxEnd)})`],
    ['Simple payback', simpleBeText],
    ['Discounted payback', beText],
  ];

  return {
    series: r.series, months,
    seriesDefs: [
      { short: 'No solar', legend: 'Grid-only resale (invest savings)' },
      { short: 'Solar', legend: `Solar ${p.sol_capacityKW} kW + ${p.sol_batteryKWh} kWh battery` },
    ],
    diffLabel: 'Solar advantage',
    adv,
    paid: r.paid, paidUSD: r.paidUSD,
    baselineIndex: 0,
    flags,
    verdict,
    posName: 'Solar', negName: 'Grid-only',
    whyPos: `Solar revenue and saved grid costs exceed the lost investment returns — solar adds ${signed(todayUSD(adv), usd)} in today's dollars.`,
    whyNeg: `Investment returns outpace the extra solar profit — grid-only resale wins by ${signed(-todayUSD(adv), usd)} in today's dollars.`,
    kpis,
    whyTitle: 'Why: what drives the solar advantage (nominal ₴ over the horizon)',
    whyRows,
    tableRows,
    ctx: { inflPct: p.inflPct, usdInflPct: p.usdInflPct, horizonYears: yrs, fxEnd },
  };
}
