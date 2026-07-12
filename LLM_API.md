# LLM / programmatic API

This app is a set of pure-function simulators over a shared engine — no build,
no dependencies, no DOM required. Three integration surfaces, all returning the
same JSON summary:

## 1. CLI (recommended for agents)

```bash
node cli.js <mode> [key=value ...] [--series]
node cli.js '<json>'
echo '<json>' | node cli.js
```

Modes: `car` (cash vs credit), `home` (mortgage vs cash vs rent vs buy-to-let),
`mort` (up to ten mortgage down-payment + term variants vs renting),
`life` (multi-criteria life decisions), `biz` (business ideas vs keeping your job).

```bash
# What should I do with $20k over 10 years?
node cli.js life savings=20000 horizonYears=10

# Compare business ideas with scaling on, sweeping planned-revenue optimism
node cli.js '{"mode":"biz",
  "overrides":{"savings":80000,"horizonYears":10,"bz_scaleOn":true},
  "sweep":{"id":"bz_revFactorPct","values":[60,80,100,120]}}'

# Month-by-month net-worth curves included
node cli.js car dpPct=50 --series
```

Every parameter not overridden uses `PARAM_DEFAULTS` from `defaults.js` (the
same defaults the UI shows) and the merged set is echoed back under
`.assumptions`. Unknown parameter names are rejected with
`{"error": "unknown parameter ..."}` — no silent typos. Exit code 1 on error.

## 2. Browser global (Playwright / console)

```js
LDM.run('life', { savings: 20000 })        // → same JSON summary, UI untouched
LDM.apply('biz', { bz_scaleOn: true })     // → set the sidebar + re-render
LDM.defaults                               // → all parameters with defaults
LDM.modes                                  // → ['car','home','life','biz']
```

## 3. URL parameters

`index.html?mode=life&savings=20000&horizonYears=10&lifeActive=edu,biz,combo`
boots the UI with those assumptions. Any parameter name from the reference
below works; booleans as `true`/`false`; `lifeActive` comma-separated.

## Result schema

```jsonc
{
  "mode": "life",
  "horizonYears": 10,
  "fxAtHorizon": 90.03,            // UAH per USD at the end
  "verdict": "...",                // plain-text verdict, same as the UI banner
  "baseline": "Change nothing",    // deltas are relative to this path
  "paths": [{
    "name": "Start a business — quit and build",
    "finalNetWorthTodayUSD": 342126,  // net worth at horizon, today's purchasing power
    "finalNetWorthUAH": 41393442,     // nominal
    "vsBaselineTodayUSD": 188589,
    "totalPaidOutUAH": -15788736,     // cumulative required payments (negative = net income)
    "warning": null                   // e.g. "runs out of cash in year 3.0"
  }],
  "scoreboard": [{                 // life mode only, ranked; null elsewhere
    "rank": 1, "name": "...", "score": 77,
    "criteria": {"Wealth": 90, "Crisis": 71, "Stress": 66, "Liquidity": 100, "Lifestyle": 60},
    "warnings": []
  }],
  "bizBreakEvenMonth": 16,         // life mode; null if never / not applicable
  "kpis": [{"label": "...", "value": "...", "note": "..."}],
  "details": ["## Section", "Row label: value", ...],  // the UI's numbers table
  "assumptions": { /* every parameter actually used */ },
  "series": [ /* only with --series / "series": true */
    {"month": 0, "fx": 41.7, "netWorthUAH": [/* one per path, paths order */]}
  ]
}
```

With `"sweep"`, the top level is `{mode, sweep: [{<id>: value, ...summary}], assumptions}`
(per-point summaries omit `assumptions`/`details`).

## Parameter reference

Defaults in parentheses. `*USD` = US dollars, `*UAH` = hryvnia, `*Pct` = % per
year unless stated. Source of truth: `defaults.js`.

### Macro & horizon (all modes)
- `horizonYears` (5) — comparison horizon
- `fx0` (41.7) — UAH per USD today
- `inflPct` (11) — UAH CPI
- `usdInflPct` (3) — US CPI ("today's $" deflator)
- `devalPct` (8) — UAH devaluation vs USD

### You & investing (life, biz; salary/investment also used by car & home burden math)
- `savings` (10000), `savingsCurrency` ('USD'|'UAH')
- `salaryAmt` (1500), `salaryCurrency` ('USD'|'UAH'), `salaryGrowthPct` (3)
- `l_curRentUSD` (0) — current housing cost, $/month
- `l_livExpUSD` (700) — other living expenses, $/month
- `invCurrency` ('UAH'), `invYieldPct` (16.5), `invTaxPct` (0), `yieldDriftPp` (0)
- `investOff` (false) — true turns investment returns off everywhere: freed-up
  money accumulates as 0%-yield cash (still in `invCurrency`), so path gaps
  show pure costs (interest, fees, insurance, rent) with no investment income

### Car (car mode; life decisions carCash/carCredit/combo)
- `price` (25000), `priceCurrency` ('USD'), `carDepPct` (12, USD-terms)
- `pensionPct` (3, % of price), `regFeeUAH` (1500), `cashDiscountPct` (0)
- `dpPct` (30), `loanYears` (5), `loanRatePct` (16), `commissionPct` (1.5),
  `monthlyFeeUAH` (0), `kaskoPct` (5.5, % of value/yr), `kaskoCash` (false),
  `lifeInsPct` (0, %/yr of debt)

### Apartment (home mode; life decisions flatLive/flatBtl/combo)
- `h_price` (75000 USD), `h_apprPct` (2, USD-terms), `h_feesPct` (2.5),
  `h_maintPct` (0.8, %/yr of value)
- `h_dpPct` (20), `h_loanYears` (20), `h_ratePct` (7), `h_commPct` (1),
  `h_insPct` (0.4, %/yr of value while mortgaged)
- `h_rentUSD` (500, $/mo), `h_rentGrowthPct` (2), `h_ownRentUSD` (500, home-tab
  buy-to-let only), `h_vacancyPct` (8), `h_rentTaxPct` (23)

### Mortgage variants (mort mode)
Up to ten down-payment + term combinations for the apartment above, raced in
one engine run against renting + investing (baseline). Uses `h_price`,
`h_ratePct`, `h_commPct`, `h_insPct`, `h_feesPct`, `h_maintPct`, `h_rentUSD`,
`h_rentGrowthPct` from the apartment/mortgage sections; the shared `h_dpPct`
and `h_loanYears` are ignored (they only serve as a fallback when no variant
is on). A 100% down payment behaves as a cash purchase.
- `mv{1..10}_on` — defaults: 1–6 true, 7–10 false
- `mv{1..10}_dpPct` (10, 20, 30, 20, 30, 50, 50, 70, 40, 100)
- `mv{1..10}_years` (20, 20, 20, 10, 15, 10, 20, 10, 7, 1)
- two-scenario side-by-side charts (UI card only, not in `LDM.run` output):
  `sc{1,2}_dpPct` (20/50), `sc{1,2}_years` (20/10), `sc{1,2}_horizonYr` (20/10)
  — each scenario is one dp+term+horizon combo plotted vs renting in nominal
  and inflation-adjusted dollars

### Life mode: decision set & evaluation
- `lifeActive` (['carCredit','flatLive','edu','biz','combo']) — which decisions
  to compare besides "change nothing"; any of `carCash carCredit flatLive
  flatBtl edu job migrate biz combo`, max 6
- weights 0–10: `w_wealth` (5), `w_robust` (3), `w_stress` (2), `w_liq` (1), `w_qol` (3)
- lifestyle scores 0–10: `qol_nothing` (5), `qol_carCash` (7), `qol_carCredit` (6),
  `qol_flatLive` (9), `qol_flatBtl` (6), `qol_edu` (7), `qol_job` (6),
  `qol_migrate` (5), `qol_biz` (6), `qol_combo` (8)

### Life mode: per-decision inputs
- education: `edu_costUSD` (3000), `edu_months` (12), `edu_dropPct` (0, % of
  salary lost while studying), `edu_bumpPct` (25, permanent raise after)
- job change: `job_changePct` (15, immediate pay change), `job_newGrowthPct` (8)
- moving abroad: `mig_costUSD` (3000), `mig_salaryUSD` (3000/mo),
  `mig_rentUSD` (900/mo), `mig_livUSD` (1200/mo)
- business (always quit-and-run on this tab): `biz_investUSD` (15000),
  `biz_rampMonths` (6), `biz_revenueUSD` (4000/mo), `biz_costsUSD` (2000/mo),
  `biz_taxPct` (6, % of revenue), `biz_growthPct` (10), `biz_residualPct` (40,
  resale % of investment)
- combo: `combo_flatDelayYr` (3) — years until the flat purchase

### Biz mode: global controls
- reality check: `bz_revFactorPct` (100), `bz_costFactorPct` (100) — every
  idea's revenue / bills as % of its plan
- scaling: `bz_scaleOn` (false), `bz_reinvestPct` (50, % of profit retained
  while expanding), `bz_unitCostPct` (80, next unit as % of original
  investment), `bz_maxUnits` (3)

### Biz mode: idea slots 1–4 (replace N)
- `bzN_on` (1–3 true, 4 false), `bzNPreset` ('carwash'|'coffee'|'barber'|'shop'|'custom' —
  display name only; numbers below are what count)
- `bzN_who` ('staff' = keep your salary, hire staff | 'quit' = run it yourself)
- `bzN_investUSD`, `bzN_rampMonths`, `bzN_revenueUSD`, `bzN_costsUSD`,
  `bzN_taxPct`, `bzN_growthPct`, `bzN_residualPct`, `bzN_staffUSD` (staff to
  replace you; extra scaled units always pay it)
- slot defaults: 1 = car wash ($70k, staff-run), 2 = coffee ($10k), 3 =
  barbershop ($25k), 4 = online store ($6k, off)

## Model conventions worth knowing

- Every path in `life`/`biz` shares the same salary and living expenses;
  income changes are modelled as deltas, so `vsBaselineTodayUSD` isolates the
  decision's own effect.
- A `warning` on a path means it doesn't fit the budget (upfront cash or a
  negative account month) — treat its numbers as optimistic.
- `life` re-runs everything under a crisis macro (deval +12 pp, inflation
  +8 pp, yields −4 pp, property −3 pp, business revenue −30%) for the Crisis
  criterion in `scoreboard`.
- "today's $" = nominal UAH ÷ FX at horizon ÷ US CPI over the horizon.
