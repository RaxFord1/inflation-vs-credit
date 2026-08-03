/*
 * Module: where to keep money — deposit routes (destination × way in).
 * Each route combines a destination (bank / bonds / cash with its currency,
 * rate and tax on interest) with a way of moving the money there (entry and
 * exit fees, % + fixed). Every route starts from the same lump sum and
 * receives the same monthly top-up; each chart point is net of the exit fee,
 * i.e. what you would actually take home if you cashed out that month.
 */

const DEP_SLOTS = [1, 2, 3, 4, 5, 6, 7, 8];

function depReadRoute(p, i) {
  return {
    slot: i,
    name: p[`dep${i}_name`] || `Route ${i}`,
    cur: p[`dep${i}_cur`] === 'UAH' ? 'UAH' : 'USD',
    compound: p[`dep${i}_comp`] !== 'payout', // payout = coupons not reinvested
    ratePct: p[`dep${i}_ratePct`] || 0,
    taxPct: p[`dep${i}_taxPct`] || 0,
    feeInPct: p[`dep${i}_feeInPct`] || 0,
    feeInFixUSD: p[`dep${i}_feeInFixUSD`] || 0,
    feeOutPct: p[`dep${i}_feeOutPct`] || 0,
    feeOutFixUSD: p[`dep${i}_feeOutFixUSD`] || 0,
    monthlyFeeUSD: p[`dep${i}_monthlyFeeUSD`] || 0,
    sharePct: p[`dep${i}_sharePct`] || 0,
  };
}

function depActiveRoutes(p) {
  const routes = DEP_SLOTS.filter((i) => p[`dep${i}_on`]).map((i) => depReadRoute(p, i));
  return routes.length ? routes : [depReadRoute(p, 1)];
}

/** One full simulation; returns per-month take-home values + fee/interest totals. */
function depRun(p) {
  const months = Math.max(1, Math.round(p.horizonYears * 12));
  const fx = makeFx(p);
  const routes = depActiveRoutes(p);
  const portfolio = !!p.dep_portfolio;
  const totalUAH0 = Math.max(0, p.dep_amountUSD) * p.fx0;
  const totalTopUSD = Math.max(0, p.dep_topUpUSD);

  const st = routes.map((r) => {
    const share = portfolio ? r.sharePct / 100 : 1;
    const myUAH0 = totalUAH0 * share;
    const myTopUSD = totalTopUSD * share;
    const feeIn0 = Math.min(myUAH0,
      myUAH0 * r.feeInPct / 100 + (myUAH0 > 0 ? r.feeInFixUSD * p.fx0 : 0));
    const netUAH0 = myUAH0 - feeIn0;
    return {
      r, myTopUSD, myUAH0,
      bal: r.cur === 'USD' ? netUAH0 / p.fx0 : netUAH0,
      pile: 0,
      interestUAH: 0,
      feeIn0UAH: feeIn0,
      feesInUAH: feeIn0,
      feesMoUAH: 0,
    };
  });

  // take-home value: principal + accumulated coupons marked to UAH, minus the exit fee
  const cashOut = (s, m) => {
    const gross = (s.bal + s.pile) * (s.r.cur === 'USD' ? fx(m) : 1);
    const fee = Math.max(0, gross) * s.r.feeOutPct / 100 +
      (s.bal + s.pile > 0 ? s.r.feeOutFixUSD * fx(m) : 0);
    return { v: gross - fee, fee };
  };

  const series = [{ m: 0, fx: fx(0), v: st.map((s) => cashOut(s, 0).v) }];
  const paid = st.map((s) => s.myUAH0);
  const paidUSD = st.map((s) => s.myUAH0 / p.fx0);

  for (let m = 1; m <= months; m++) {
    const f = fx(m);
    st.forEach((s, i) => {
      // interest, taxed as it accrues. Capitalized: added to the principal and
      // compounds. Paid out (OVDP-style coupons): simple interest on the
      // principal only, piling up as non-earning cash beside it.
      let g;
      if (s.r.compound) {
        g = s.bal * monthlyRate(s.r.ratePct) * (1 - s.r.taxPct / 100);
        s.bal += g;
      } else {
        g = s.bal * (s.r.ratePct / 100 / 12) * (1 - s.r.taxPct / 100);
        s.pile += g;
      }
      s.interestUAH += g * (s.r.cur === 'USD' ? f : 1);
      // monthly top-up goes through the same entry fees as the lump sum
      const topUAH = s.myTopUSD * f;
      if (s.myTopUSD > 0) {
        const fee = Math.min(topUAH, topUAH * s.r.feeInPct / 100 + s.r.feeInFixUSD * f);
        s.feesInUAH += fee;
        const net = topUAH - fee;
        s.bal += s.r.cur === 'USD' ? net / f : net;
        paid[i] += topUAH;
        paidUSD[i] += s.myTopUSD;
      }
      // account maintenance
      if (s.r.monthlyFeeUSD > 0) {
        s.feesMoUAH += s.r.monthlyFeeUSD * f;
        s.bal -= s.r.cur === 'USD' ? s.r.monthlyFeeUSD : s.r.monthlyFeeUSD * f;
      }
    });
    series.push({
      m, fx: f,
      v: st.map((s) => cashOut(s, m).v),
      obl: st.map((s) => s.myTopUSD * f),
    });
  }

  const outs = st.map((s) => cashOut(s, months));
  return { routes, st, series, months, paid, paidUSD, portfolio,
    finals: series[series.length - 1].v, fxEnd: fx(months),
    feesOut: outs.map((o) => o.fee), amountUAH0: totalUAH0 };
}

function depSim(p) {
  const s = depRun(p);
  const { routes, st, series, months, finals } = s;
  const yrs = p.horizonYears;
  const todayUSD = (v) => v / s.fxEnd / Math.pow(1 + p.usdInflPct / 100, yrs);

  const base = 0; // first active route is the comparison point
  let best = 0;
  finals.forEach((v, i) => { if (v > finals[best]) best = i; });
  // the route the "why" breakdown explains: the best one, or — when the
  // baseline itself wins — the runner-up, so the bars show why it loses
  let cmp = best;
  if (cmp === base && routes.length > 1) {
    cmp = finals.reduce((bi, v, i) => (i !== base && v > finals[bi] ? i : bi),
      base === 0 ? 1 : 0);
  }
  const adv = finals[cmp] - finals[base];

  const feesTotal = st.map((x, i) => x.feesInUAH + x.feesMoUAH + s.feesOut[i]);

  // break-even: the month cmp pulls ahead of the baseline for good
  let lastNeg = -1;
  series.forEach((pt, mm) => { if (pt.v[cmp] - pt.v[base] < 0) lastNeg = mm; });
  const be = lastNeg === -1 ? 0 : lastNeg >= months ? null : lastNeg + 1;
  const events = routes.length > 1 && be !== null && be > 0
    ? [{ m: be, label: `${routes[cmp].name} ahead from yr ${(be / 12).toFixed(1)}` }]
    : [];

  const whyRows = [
    { label: `Extra interest earned (net of tax)`, v: st[cmp].interestUAH - st[base].interestUAH },
    { label: 'Entry fees (initial + top-ups)', v: -(st[cmp].feesInUAH - st[base].feesInUAH) },
    { label: 'Account fees', v: -(st[cmp].feesMoUAH - st[base].feesMoUAH) },
    { label: 'Exit fee at the horizon', v: -(s.feesOut[cmp] - s.feesOut[base]) },
  ].filter((row, i) => i === 0 || Math.abs(row.v) > 0.5);
  const residual = adv - whyRows.reduce((a, row) => a + row.v, 0);
  if (Math.abs(residual) > Math.max(1, Math.abs(adv)) * 0.005) {
    whyRows.push({ label: 'FX effect (devaluation on the balance)', v: residual });
  }
  whyRows.push({ label: `Net result (${routes[cmp].name} vs ${routes[base].name})`, v: adv, total: true });

  const bestName = routes[best].name;
  const rateLine = (r) => `${r.cur} ${r.ratePct}%/yr` +
    (r.taxPct > 0 ? `, tax ${r.taxPct}%` : '') +
    (r.compound ? '' : ', coupons out');
  const portfolioTotal = s.portfolio ? finals.reduce((a, v) => a + v, 0) : 0;
  const verdict = s.portfolio
    ? `<strong>Portfolio total: ${usd(todayUSD(portfolioTotal))} in today’s dollars after ${yrs} years.</strong>` +
      `<div class="why">${routes.map((r, i) =>
        `${r.name} (${r.sharePct}%, ${rateLine(r)}) → ${usd(todayUSD(finals[i]))}`).join(' · ')}.</div>`
    : `<strong>${bestName} leaves you the most: ${usd(todayUSD(finals[best]))} in today’s dollars after ${yrs} years.</strong>` +
      `<div class="why">${routes.map((r, i) =>
        `${r.name} (${rateLine(r)}) → ${usd(todayUSD(finals[i]))}`).join(' · ')}.` +
      ` A UAH rate must outrun ~${p.devalPct}%/yr devaluation before it really beats a dollar one;` +
      ` a foreign rate must out-earn its transfer fees.</div>`;

  const seriesDefs = routes.map((r) => ({
    short: r.name.length > 18 ? r.name.slice(0, 17) + '…' : r.name,
    legend: `${r.name} — ${rateLine(r)}`,
  }));

  const tableRows = [];
  routes.forEach((r, i) => {
    const shareLabel = s.portfolio ? ` (${r.sharePct}% of portfolio)` : '';
    tableRows.push(
      ['section', `${r.name} — ${rateLine(r)}${shareLabel}`],
      ['Placed on day 0 (after entry fee)',
        `${uah(st[i].myUAH0 - st[i].feeIn0UAH)} (${usd((st[i].myUAH0 - st[i].feeIn0UAH) / p.fx0)})`],
      ['Entry fees, total (initial + top-ups)', uah(st[i].feesInUAH)],
      ['Interest handling', r.compound
        ? 'capitalized — added to the balance, compounds monthly'
        : 'paid out — coupons pile up as cash and earn nothing'],
      ['Interest earned, net of tax', uah(st[i].interestUAH)],
      ['Coupons sitting as cash at the horizon', r.compound ? '—'
        : uah(st[i].pile * (r.cur === 'USD' ? s.fxEnd : 1))],
      ['Account fees, total', st[i].feesMoUAH > 0.5 ? uah(st[i].feesMoUAH) : '—'],
      ['Exit fee at the horizon', s.feesOut[i] > 0.5 ? uah(s.feesOut[i]) : '—'],
      ['Take home at the horizon', `${uah(finals[i])} (${usd(finals[i] / s.fxEnd)})`],
      ['…in today’s dollars', usd(todayUSD(finals[i]))],
      ['Take-home vs money put in', `${(finals[i] / s.fxEnd / Math.max(1e-9, s.paidUSD[i])).toFixed(2)}× in nominal $`],
    );
  });
  tableRows.push(
    ['section', `Assumptions behind the ${s.portfolio ? 'portfolio' : 'race'}`],
    [s.portfolio ? 'Total money put in' : 'Money put in per route',
      s.portfolio
        ? `${uah(s.paid.reduce((a, v) => a + v, 0))} (${usd(s.paidUSD.reduce((a, v) => a + v, 0))} at transfer-time rates)`
        : `${uah(s.paid[0])} (${usd(s.paidUSD[0])} at transfer-time rates)`],
    ['Exchange rate at horizon', s.fxEnd.toFixed(1) + ' UAH/USD'],
    [`UAH devaluation / UAH CPI / USD CPI`, `${p.devalPct}% / ${p.inflPct}% / ${p.usdInflPct}% per year`],
  );

  return {
    series, months,
    seriesDefs,
    events,
    adv,
    paid: s.paid, paidUSD: s.paidUSD,
    baselineIndex: base,
    verdict,
    kpis: s.portfolio ? [
      { label: 'Portfolio total', value: usd(todayUSD(portfolioTotal)),
        delta: `in today’s dollars after ${yrs} years` },
      { label: 'Total fees drag', value: uah(feesTotal.reduce((a, v) => a + v, 0)),
        delta: `entry + account + exit (${usd(feesTotal.reduce((a, v) => a + v, 0) / s.fxEnd)})` },
      { label: 'Largest share', value: `${routes[best].name} ${routes[best].sharePct}%`,
        delta: `${usd(todayUSD(finals[best]))} in today’s dollars` },
      { label: 'Total put in', value: usd(s.paidUSD.reduce((a, v) => a + v, 0)),
        delta: 'across all routes at transfer-time rates' },
    ] : [
      { label: 'Best route', value: routes[best].name,
        delta: `${usd(todayUSD(finals[best]))} in today’s dollars` },
      { label: `${routes[cmp].name} vs ${routes[base].name}`, value: signed(todayUSD(adv), usd),
        cls: adv >= 0 ? 'good' : 'bad', delta: `today’s dollars at the horizon` },
      { label: 'Ahead of the baseline from', value: routes.length < 2 ? '—'
          : be === null ? 'never (within horizon)' : be === 0 ? 'day 1' : `year ${(be / 12).toFixed(1)}`,
        delta: routes.length < 2 ? 'add a second route to compare' : `${routes[cmp].name} vs ${routes[base].name}` },
      { label: 'Fees drag — best route', value: uah(feesTotal[best]),
        delta: `entry + account + exit (${usd(feesTotal[best] / s.fxEnd)})` },
    ],
    whyTitle: `Why: ${routes[cmp].name} vs ${routes[base].name} — what makes the difference`,
    whyRows,
    tableRows,
    ctx: { inflPct: p.inflPct, usdInflPct: p.usdInflPct, horizonYears: yrs, fxEnd: s.fxEnd },
  };
}
