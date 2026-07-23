/*
 * Module: solar station — electricity resale business with solar generation.
 *
 * Business model: you buy electricity from the grid and resell to consumers
 * at a markup. Your salary / income already includes that resale profit.
 * Adding solar replaces some grid kWh with free solar kWh (COGS = 0),
 * earning a higher margin on those kWh. This module models ONLY the
 * incremental effect of adding solar — not the base business.
 *
 * Strategy 0 (no solar): do nothing — savings compound at the investment yield.
 * Strategy 1 (solar):    pay upfront for equipment; each month earn the extra
 *   solar profit (solar margin − lost grid margin + feed-in + self-use savings)
 *   minus maintenance. Equipment has a depreciating residual value.
 *
 * Demand can be flat or seasonal (monthly coefficients from real data).
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

// Monthly demand coefficients: multiply by sol_demandKWh to get actual demand.
// 'seasonal' derived from real consumption data (2021–2026 average):
//   Jan 3786, Feb 2475, Mar 2339, Apr 2453, May 2307, Jun 2624,
//   Jul 2358, Aug 2383, Sep 2268, Oct 3827, Nov 4354, Dec 2667 kWh
const DEMAND_PATTERNS = {
  flat:     { label: 'Flat (constant year-round)',
              coef: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1] },
  seasonal: { label: 'Seasonal (winter-heavy, real data)',
              coef: [1.34, 0.88, 0.83, 0.87, 0.82, 0.93,
                     0.84, 0.85, 0.80, 1.36, 1.54, 0.94] },
};

const SOLAR_MONTH_SHORT = ['Jan','Feb','Mar','Apr','May','Jun',
                           'Jul','Aug','Sep','Oct','Nov','Dec'];

function solarBalance(p, m) {
  const profile  = SOLAR_PROFILES[p.sol_region] || SOLAR_PROFILES.central;
  const demCoef  = (DEMAND_PATTERNS[p.sol_demandPattern] || DEMAND_PATTERNS.flat).coef;
  const monthIdx = (m - 1) % 12;
  const yearNum  = Math.floor((m - 1) / 12);
  const panelDeg = Math.pow(1 - p.sol_degradePct / 100, yearNum);
  const battDeg  = Math.pow(1 - p.sol_battDegradePct / 100, yearNum);

  const gen    = p.sol_capacityKW * profile[monthIdx] * panelDeg;
  const demand = p.sol_demandKWh * demCoef[monthIdx];
  const selfUse   = Math.min(p.sol_selfUseKWh || 0, gen);
  const afterSelf = gen - selfUse;

  const directOverlap = afterSelf * (p.sol_overlapPct / 100);
  const excess = afterSelf - directOverlap;
  const battCapMonth = p.sol_batteryKWh * battDeg * 0.8 * 30;
  const fromBattery  = Math.min(battCapMonth, excess, Math.max(0, demand - directOverlap));

  const solarToConsumers = Math.min(directOverlap + fromBattery, demand);
  const gridForConsumers = demand - solarToConsumers;
  const excessToGrid     = Math.max(0, gen - selfUse - solarToConsumers);

  return { gen, demand, selfUse, solarToConsumers, gridForConsumers, excessToGrid, monthIdx };
}

function solarSim(p) {
  const months = Math.max(1, Math.round(p.horizonYears * 12));
  const fx  = makeFx(p);
  const ctx = makeCtx(p, fx);

  const profile     = SOLAR_PROFILES[p.sol_region] || SOLAR_PROFILES.central;
  const demCoef     = (DEMAND_PATTERNS[p.sol_demandPattern] || DEMAND_PATTERNS.flat).coef;
  const annualYield = profile.reduce((s, v) => s + v, 0);
  const totalCostUSD = p.sol_capacityKW * p.sol_panelCostPerKW +
    p.sol_batteryKWh * p.sol_batteryCostPerKWh + p.sol_installUSD;
  const totalCostUAH = totalCostUSD * p.fx0;
  const inverterMonth = Math.round(p.sol_inverterReplaceYr * 12);
  const markupFrac = p.sol_markupPct / 100;

  let yr1Extra = 0, yr1SolarRev = 0, yr1LostMargin = 0, yr1FeedIn = 0,
      yr1SelfSave = 0, yr1Maint = 0;
  let totSolarRev = 0, totLostMargin = 0, totFeedIn = 0,
      totSelfSave = 0, totMaint = 0, totInvRepl = 0;
  let cumExtraProfitUSD = 0, breakEvenMonth = null;

  const gridBuyGrow   = (m) =>
    p.sol_gridBuyUAH * Math.pow(1 + p.sol_gridBuyGrowPct / 100, m * MONTH);
  const solarSellGrow = (m) =>
    p.sol_solarSellUAH * Math.pow(1 + p.sol_solarSellGrowPct / 100, m * MONTH);
  const feedInGrow    = (m) =>
    p.sol_feedInUAH * Math.pow(1 + p.sol_feedInGrowPct / 100, m * MONTH);

  /* Strategy 0: do nothing — no extra costs, no extra income.
   * Strategy 1: solar — upfront cost, monthly extra profit, equipment asset. */
  const strategies = [
    compileBlocks([ curRentBlock(ctx) ]),

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
          const bal       = solarBalance(p, m);
          const gridBuy   = gridBuyGrow(m);
          const solarSell = solarSellGrow(m);
          const feedIn    = feedInGrow(m);

          const solarRev   = bal.solarToConsumers * solarSell;
          const lostMargin = bal.solarToConsumers * gridBuy * markupFrac;
          const feedInRev  = bal.excessToGrid * feedIn;
          const selfSave   = bal.selfUse * gridBuy;
          const extraProfit = solarRev - lostMargin + feedInRev + selfSave;

          const maintUAH = totalCostUSD * (p.sol_maintPct / 100) / 12 * fx(m);
          const invRepl  = (m === inverterMonth && m <= months)
            ? totalCostUSD * (p.sol_inverterCostPct / 100) * fx(m) : 0;

          if (m <= 12) {
            yr1SolarRev += solarRev; yr1LostMargin += lostMargin;
            yr1FeedIn += feedInRev; yr1SelfSave += selfSave;
            yr1Maint += maintUAH;
            yr1Extra += extraProfit - maintUAH - invRepl;
          }
          totSolarRev += solarRev; totLostMargin += lostMargin;
          totFeedIn += feedInRev; totSelfSave += selfSave;
          totMaint += maintUAH; totInvRepl += invRepl;

          cumExtraProfitUSD += (extraProfit - maintUAH - invRepl) / fx(m);
          if (breakEvenMonth === null && cumExtraProfitUSD >= totalCostUSD)
            breakEvenMonth = m;

          return -(extraProfit) + maintUAH + invRepl;
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

  const yrs      = p.horizonYears;
  const fxEnd    = r.fxEnd;
  const todayUSD = (v) => v / fxEnd / Math.pow(1 + p.usdInflPct / 100, yrs);
  const adv      = r.finals[1] - r.finals[0];
  const wins     = adv >= 0;

  const flags = r.broke.map((b, i) => {
    if (i === 1 && strategies[1].outlay0 > savings0)
      return `needs ${uah(strategies[1].outlay0 - savings0)} more upfront than you have`;
    return b === null ? '' : `runs out of cash in year ${(b / 12).toFixed(1)}`;
  });

  const simplePaybackMo = yr1Extra > 0
    ? Math.ceil(totalCostUAH / (yr1Extra / 12)) : null;
  const beText = breakEvenMonth === null
    ? `does not pay back within ${yrs} years`
    : `pays back in month ${breakEvenMonth} (year ${(breakEvenMonth / 12).toFixed(1)})`;
  const simpleBeText = simplePaybackMo === null
    ? 'never (year-1 net is negative)'
    : `~${(simplePaybackMo / 12).toFixed(1)} years (${simplePaybackMo} months)`;

  const residualUSD = totalCostUSD * Math.pow(1 - p.sol_equipDepPct / 100, yrs);

  // ---------- per-month demand vs generation overlay (year 1) ----------
  const monthOverlay = SOLAR_MONTH_SHORT.map((name, i) => {
    const gen    = p.sol_capacityKW * profile[i];
    const demand = p.sol_demandKWh * demCoef[i];
    const su     = Math.min(p.sol_selfUseKWh || 0, gen);
    const after  = gen - su;
    const dir    = after * (p.sol_overlapPct / 100);
    const ex     = after - dir;
    const batt   = Math.min(p.sol_batteryKWh * 0.8 * 30, ex,
      Math.max(0, demand - dir));
    const toCons  = Math.min(dir + batt, demand);
    const fromGrid = demand - toCons;
    const toGrid   = Math.max(0, gen - su - toCons);
    const coverPct = demand > 0 ? Math.round(toCons / demand * 100) : 0;
    return { name, gen, demand, toCons, fromGrid, toGrid, coverPct };
  });

  const avgDemand = monthOverlay.reduce((s, o) => s + o.demand, 0) / 12;
  const avgGen    = monthOverlay.reduce((s, o) => s + o.gen, 0) / 12;
  const avgToCons = monthOverlay.reduce((s, o) => s + o.toCons, 0) / 12;
  const avgFromGrid = monthOverlay.reduce((s, o) => s + o.fromGrid, 0) / 12;
  const avgToGrid = monthOverlay.reduce((s, o) => s + o.toGrid, 0) / 12;
  const avgCover  = avgDemand > 0 ? Math.round(avgToCons / avgDemand * 100) : 0;

  const verdict = wins
    ? `<strong>Solar wins: adds ${signed(todayUSD(adv), usd)} vs doing nothing, in today's dollars</strong>` +
      `<div class="why">The ${p.sol_capacityKW} kW system ${beText}. ` +
      `Year-1 net extra profit: ${uah(yr1Extra)}/yr (${uah(Math.round(yr1Extra / 12))}/mo). ` +
      `Solar covers ~${avgCover}% of consumer demand on average.</div>`
    : `<strong>Investing wins by ${signed(-todayUSD(adv), usd)} in today's dollars</strong>` +
      `<div class="why">The ${p.sol_capacityKW} kW system ${beText}. ` +
      `At ${p.invYieldPct}% yield on ${p.invCurrency}, investing the ${usd(totalCostUSD)} beats the solar margin uplift. ` +
      `Try longer horizon, higher grid price growth, or cheaper panels.</div>`;

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
        ? `discounted payback: ${beText}` : beText,
    },
    {
      label: 'Year-1 extra profit',
      value: uah(Math.round(yr1Extra / 12)) + '/mo',
      cls: yr1Extra >= 0 ? 'good' : 'bad',
      delta: `solar rev ${uah(Math.round(yr1SolarRev / 12))} + feed-in ${uah(Math.round(yr1FeedIn / 12))}` +
        (yr1SelfSave > 0 ? ` + self-save ${uah(Math.round(yr1SelfSave / 12))}` : '') +
        ` − lost markup ${uah(Math.round(yr1LostMargin / 12))} − maint ${uah(Math.round(yr1Maint / 12))}`,
    },
    {
      label: `Net worth at ${yrs}y`,
      value: usd(todayUSD(r.finals[1])),
      cls: wins ? 'good' : '',
      delta: `vs invest-only ${usd(todayUSD(r.finals[0]))} — difference ${signed(todayUSD(adv), usd)}, today's $`,
    },
  ];

  const whyRows = [
    { label: 'Solar revenue (consumers)', v: totSolarRev },
    { label: 'Feed-in revenue (grid)', v: totFeedIn },
    { label: 'Self-use savings', v: totSelfSave },
    { label: 'Lost grid markup', v: -totLostMargin },
    { label: 'Maintenance', v: -totMaint },
    { label: 'Inverter replacement', v: -totInvRepl },
    { label: 'Equipment residual value', v: residualUSD * fxEnd },
    { label: 'Investment income difference', v: r.incomes[1] - r.incomes[0] },
  ].filter((row) => Math.abs(row.v) > 0.5);
  const whyResidual = adv - whyRows.reduce((s, row) => s + row.v, 0);
  if (Math.abs(whyResidual) > Math.max(1, Math.abs(adv)) * 0.005)
    whyRows.push({ label: 'FX & compounding effect', v: whyResidual });
  whyRows.push({ label: 'Net result (solar vs invest-only)', v: adv, total: true });

  const tableRows = [
    ['section', 'System'],
    ['Solar capacity', `${p.sol_capacityKW} kW`],
    ['Battery capacity', `${p.sol_batteryKWh} kWh`],
    ['Region / annual yield', `${SOLAR_PROFILE_LABELS[p.sol_region] || p.sol_region} — ${annualYield} kWh per kW`],
    ['Total investment', `${usd(totalCostUSD)} (${uah(totalCostUAH)})`],

    ['section', 'Pricing'],
    ['Grid buy price', `${p.sol_gridBuyUAH} UAH/kWh, growing ${p.sol_gridBuyGrowPct}%/yr`],
    ['Resale markup', `${p.sol_markupPct}% → sell at ${(p.sol_gridBuyUAH * (1 + markupFrac)).toFixed(2)} UAH/kWh`],
    ['Grid margin per kWh', `${(p.sol_gridBuyUAH * markupFrac).toFixed(2)} UAH`],
    ['Solar sell price', `${p.sol_solarSellUAH} UAH/kWh (COGS = 0), growing ${p.sol_solarSellGrowPct}%/yr`],
    ['Solar margin per kWh', `${p.sol_solarSellUAH.toFixed(2)} UAH (vs grid margin ${(p.sol_gridBuyUAH * markupFrac).toFixed(2)})`],
    ['Extra margin per solar kWh', `${(p.sol_solarSellUAH - p.sol_gridBuyUAH * markupFrac).toFixed(2)} UAH`],
    ['Feed-in tariff', `${p.sol_feedInUAH} UAH/kWh, growing ${p.sol_feedInGrowPct}%/yr`],

    ['section', `Demand vs generation — monthly overlay (year 1, ${(DEMAND_PATTERNS[p.sol_demandPattern] || DEMAND_PATTERNS.flat).label})`],
    ...monthOverlay.map((o) =>
      [o.name, `demand ${Math.round(o.demand)} | gen ${Math.round(o.gen)} | ` +
        `solar→cons ${Math.round(o.toCons)} | grid→cons ${Math.round(o.fromGrid)} | ` +
        `excess→grid ${Math.round(o.toGrid)} | cover ${o.coverPct}%`]
    ),
    ['Average', `demand ${Math.round(avgDemand)} | gen ${Math.round(avgGen)} | ` +
      `solar→cons ${Math.round(avgToCons)} | grid→cons ${Math.round(avgFromGrid)} | ` +
      `excess→grid ${Math.round(avgToGrid)} | cover ${avgCover}%`],

    ['section', 'Year 1 financials (incremental vs no solar)'],
    ['Solar revenue', `${uah(yr1SolarRev)}/yr — ${Math.round(avgToCons)} kWh/mo × ${p.sol_solarSellUAH} UAH`],
    ['Lost grid markup', `−${uah(yr1LostMargin)}/yr — those kWh would earn ${(p.sol_gridBuyUAH * markupFrac).toFixed(2)} UAH margin each`],
    ['Feed-in revenue', `${uah(yr1FeedIn)}/yr — ${Math.round(avgToGrid)} kWh/mo excess × ${p.sol_feedInUAH} UAH`],
    ['Self-use savings', yr1SelfSave > 0 ? `${uah(yr1SelfSave)}/yr` : 'off (sol_selfUseKWh = 0)'],
    ['Maintenance', `−${uah(yr1Maint)}/yr`],
    ['Year-1 net extra profit', `${uahSigned(yr1Extra)}/yr (${uahSigned(Math.round(yr1Extra / 12))}/mo)`],

    ['section', `Totals over ${yrs} years`],
    ['Total solar revenue', uah(totSolarRev)],
    ['Total lost grid markup', `−${uah(totLostMargin)}`],
    ['Total feed-in revenue', uah(totFeedIn)],
    ['Total self-use savings', totSelfSave > 0 ? uah(totSelfSave) : 'n/a'],
    ['Total maintenance', `−${uah(totMaint)}`],
    ['Inverter replacement', totInvRepl > 0 ? `−${uah(totInvRepl)} at year ${p.sol_inverterReplaceYr}` : 'not within horizon'],
    ['Equipment residual value', `${usd(residualUSD)} (${uah(residualUSD * fxEnd)})`],
    ['Simple payback', simpleBeText],
    ['Discounted payback', beText],
  ];

  return {
    series: r.series, months,
    seriesDefs: [
      { short: 'No solar', legend: 'Invest savings (no solar)' },
      { short: 'Solar', legend: `Solar ${p.sol_capacityKW} kW + ${p.sol_batteryKWh} kWh battery` },
    ],
    diffLabel: 'Solar advantage',
    adv,
    paid: r.paid, paidUSD: r.paidUSD,
    baselineIndex: 0,
    flags,
    verdict,
    posName: 'Solar', negName: 'Invest-only',
    whyPos: `Solar adds ${signed(todayUSD(adv), usd)} in today's dollars.`,
    whyNeg: `Investing wins by ${signed(-todayUSD(adv), usd)} in today's dollars.`,
    kpis,
    whyTitle: 'Why: what drives the solar advantage (nominal ₴ over the horizon)',
    whyRows,
    tableRows,
    ctx: { inflPct: p.inflPct, usdInflPct: p.usdInflPct, horizonYears: yrs, fxEnd },
  };
}
