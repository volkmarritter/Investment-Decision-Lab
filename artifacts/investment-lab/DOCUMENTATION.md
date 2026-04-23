# Investment Decision Lab — Functional & Logic Documentation

> **Maintenance rule:** This file MUST be updated whenever a feature is added, removed, or its behaviour changes. Each change should also append an entry to the **Changelog** section at the bottom.

Last updated: 2026-04-23

---

## 1. Purpose & Scope

The Investment Decision Lab is a **frontend-only** React + Vite web application aimed at private investors and finance professionals. It constructs reference portfolios with a **fully deterministic, rule-based engine** — there is no backend, no database, no AI/LLM call, and no remote pricing. All computations happen in the browser.

Design principles:

- **Transparency** — every number can be traced to an explicit rule.
- **Information density** — professional aesthetic, no decorative content, no emojis (lucide-react icons only).
- **Bilingual** — full EN / DE coverage via `src/lib/i18n.tsx`.
- **No silent fallbacks** — when assumptions break, the UI says so explicitly.

---

## 2. Application Modes

The app has four top-level tabs:

| Tab | Component | Purpose |
|-----|-----------|---------|
| **Build Portfolio** | `BuildPortfolio.tsx` | Construct a reference portfolio from constraints. |
| **Compare Portfolios** | `ComparePortfolios.tsx` | Generate two portfolios side-by-side and diff them. |
| **Explain My Portfolio** | `ExplainPortfolio.tsx` | Paste/import an existing allocation, get coherence checks and metrics. |
| **Methodology** | `Methodology.tsx` | Static explanation of the engine, references and disclaimers. |

A persistent `Disclaimer.tsx` reminds users that nothing here is investment advice.

---

## 3. Inputs (`PortfolioInput`)

Defined in `src/lib/types.ts`:

| Field | Type | Notes |
|-------|------|-------|
| `baseCurrency` | `USD \| EUR \| CHF \| GBP` | Drives home bias and Cash currency. |
| `riskAppetite` | `Low \| Moderate \| High \| Very High` | Caps equity %. |
| `horizon` | `number` (years) | Affects cash %, EM tilt, learning notes. |
| `targetEquityPct` | `number` 0–100 | Capped by risk appetite. |
| `numETFs` | `number` (Max) | Hard ceiling on ETF count used by engine. |
| `numETFsMin` | `number` (optional) | Advisory floor; drives the warning when natural buckets fall below it. |
| `preferredExchange` | `None \| LSE \| XETRA \| SIX` | ETF listing preference. |
| `thematicPreference` | `None \| Technology \| Healthcare \| Sustainability \| Cybersecurity` | Adds a thematic sleeve. |
| `includeCurrencyHedging` | `boolean` | Selects hedged share-classes where available. |
| `includeSyntheticETFs` | `boolean` | Allows swap-based US equity replication. |
| `lookThroughView` | `boolean` | Toggles the look-through analysis panel. |
| `includeCrypto` | `boolean` | Adds 1–3% digital assets sleeve (gated by risk). |
| `includeListedRealEstate` | `boolean` | Adds ~6% global REITs. |
| `includeCommodities` | `boolean` | Adds up to 5% gold (carved from bonds). |

User-editable global setting (`src/lib/settings.ts`, persisted in `localStorage` under `idl.riskFreeRate`):

- **Risk-free rate** — used by Sharpe / Sortino / efficient frontier. Default `2.5%`.

---

## 4. Engine Pipeline (`src/lib/portfolio.ts`)

`buildPortfolio(input, lang)` produces a `PortfolioOutput` in the following deterministic steps:

### 4.1 Equity / Defensive split

1. Cap `equityPct` by risk appetite: Low ≤ 40, Moderate ≤ 70, High ≤ 90, Very High ≤ 100.
2. `defensivePct = 100 − equityPct`.
3. Cash sleeve: `clamp((10 − horizon) × 1.5 + (Low ? 5 : 0), 2, 20)`, then `min(cash, defensive)`.
4. Bonds = `defensive − cash`.

### 4.2 Equity regional base weights

| Region | Base | Adjustments |
|--------|------|-------------|
| USA | 45 | −5 if `thematicPreference = Sustainability` |
| Europe | 22 | −8 when CHF is base currency (re-allocated to CH bucket) |
| Switzerland | 0 | +8 only when CHF is base currency |
| Japan | 8 | — |
| Emerging Markets | 15 | +5 when `horizon ≥ 10` |

### 4.3 Satellite sleeves

- **REIT**: 6% if `includeListedRealEstate`.
- **Crypto**: 1 / 2 / 3% for Moderate / High / Very High when `includeCrypto`. Disabled for Low.
- **Thematic**: 3% if `numETFs ≤ 5`, otherwise 5%.
- **Gold (commodities)**: `min(5%, 15% × bondsPct)` if enabled and risk ≠ Low; carved out of bonds.

Satellites reduce `coreEquity = equityPct − (REIT + Crypto + Thematic)`. Core equity is then split across regional buckets in proportion to their bases.

### 4.4 Compaction for low ETF counts

If `numETFs ≤ 5`, the smallest satellite sleeves (REIT, Crypto, Thematic, Commodities) are dropped in ascending order to leave at most `numETFs − 3` of them; their weights are folded back into Equity-USA (equity satellites) or Bonds (commodities).

### 4.5 Global+Home equity fallback

If, after the above, the number of non-zero buckets still exceeds `numETFs` AND ≥3 distinct equity regions are present, the engine collapses regional equity into:

- **Equity-Global** — MSCI ACWI IMI (`SPYI` / `IE00B3YLTY66`).
- **Equity-Home** — home-market tilt based on `baseCurrency` (USD → USA, CHF → CH, EUR/GBP → Europe).

For CHF / EUR / GBP without a pre-existing home bucket, a tilt is carved from the global pool (CHF: 8%, EUR/GBP: 12%) so the home bias survives consolidation. Total equity exposure is preserved exactly.

### 4.6 Rounding

Each weight is rounded to one decimal; any rounding residual is added to the largest bucket so totals sum to 100.0%.

### 4.7 ETF implementation

Each non-cash bucket is mapped to a concrete ETF via `getETFDetails(assetClass, region, input)` in `src/lib/etfs.ts`. The chosen ETF respects:

- `preferredExchange` (LSE / XETRA / SIX, else default listing).
- `includeCurrencyHedging` (hedged share class when available and base ≠ USD).
- `includeSyntheticETFs` (swap-based S&P 500 for US equity, only when not hedged).

Each `ETFImplementation` row exposes ISIN, ticker, exchange, TER (bps), domicile, replication, distribution, currency, and a structured `comment`.

### 4.8 Narrative output

`buildPortfolio` also returns:

- `rationale` — bullet points justifying the split (EN/DE).
- `risks` — drawdown, currency, volatility, inflation warnings as applicable.
- `learning` — up to 3 didactic notes adapted to the inputs (horizon, equity %, satellites, etc.).

### 4.9 Helper

`computeNaturalBucketCount(input)` re-runs the engine with `numETFs = 15` to count how many distinct buckets the user's inputs would naturally produce. The Build form uses this to surface a warning + suggested Min/Max range when the user's range is too tight.

---

## 5. Analytical Modules

All under `src/lib/`. Each is pure and deterministic.

| Module | What it computes |
|--------|------------------|
| `metrics.ts` | Capital-market assumptions (CMA) for each asset, expected return, volatility, Sharpe, Sortino, max drawdown estimate, **efficient frontier** points, **correlation matrix**. Sharpe uses the user's risk-free rate. |
| `monteCarlo.ts` | Forward simulation of portfolio paths from CMA inputs. Returns percentile fan chart and probability of meeting a target. |
| `scenarios.ts` | Deterministic stress-test shocks for each asset bucket (e.g. 2008 GFC, COVID, stagflation). Equity-Global has its own shock; Equity-Home falls back to USA shocks. |
| `lookthrough.ts` | Decomposes ETFs into geo / sector / currency / single-stock weights using ISIN-keyed profiles in `PROFILES` + `ALIAS`. Reference date `Q4 2024`. New ETFs require a profile entry or they will be flagged "unmapped". |
| `geomap.ts` | Aggregates look-through into a country/region world-map dataset for `GeoExposureMap.tsx`. |
| `homebias.ts` | Compares portfolio's home-country share vs. base-currency reference and emits a verdict + suggestions. |
| `fees.ts` | Estimates blended TER using `TER_BPS_BY_ASSET_CLASS`; produces yearly + 10-year cost figures. |
| `compare.ts` | `diffPortfolios(a, b)` — bucket-level deltas and metric deltas for the Compare tab. |
| `explain.ts` | `analyzePortfolio(positions)` — coherence verdict for user-provided allocations (sum ≠ 100, conflicting sleeves, etc.). |
| `validation.ts` | `runValidation(input, lang)` — input sanity errors and warnings (incompatible toggles, out-of-range numbers, etc.). |
| `csvImport.ts` | Parses CSVs for the Explain tab; tolerant of common column-name variants. |
| `savedScenarios.ts` | Persists named scenarios to `localStorage` (key `idl.savedScenarios`). |
| `exportPdf.ts` | PDF export via `html2canvas-pro` + `jspdf` (Tailwind v4 requires the `-pro` variant). |

---

## 6. UI Components (`src/components/investment/`)

| Component | Responsibility |
|-----------|---------------|
| `BuildPortfolio.tsx` | Main build form + result panels (allocation pie, ETF table, metrics, look-through, stress, Monte Carlo, fees, geo map, home bias, top holdings, currency overview). Includes **Reset** (preserves Currency / Horizon / Risk Appetite), **Save Scenario**, **Saved scenarios list**. |
| `ComparePortfolios.tsx` | Two parallel build forms with diff view. |
| `ExplainPortfolio.tsx` | Manual/CSV input grid + coherence analysis + metrics. |
| `Methodology.tsx` | Long-form bilingual methodology document. |
| `PortfolioMetrics.tsx` | Risk/return KPIs, efficient frontier chart, correlation matrix. |
| `MonteCarloSimulation.tsx` | Fan chart + percentile table. |
| `StressTest.tsx` | Per-scenario portfolio P&L bars. |
| `LookThroughAnalysis.tsx` | Geo / sector / currency tables. |
| `GeoExposureMap.tsx` | World choropleth of country exposure. |
| `HomeBiasAnalysis.tsx` | Home vs. world comparison chart + verdict. |
| `TopHoldings.tsx` | Aggregated single-stock concentration table. |
| `CurrencyOverview.tsx` | Currency exposure summary. |
| `FeeEstimator.tsx` | Blended TER and 10y cost projection. |
| `SavedScenariosUI.tsx` | Save / load / delete persisted scenarios. |
| `ImportCsvDialog.tsx` | CSV upload for Explain mode. |
| `Disclaimer.tsx` | Persistent disclaimer banner. |

---

## 7. Internationalisation

`src/lib/i18n.tsx` exports a React context with:

- `lang: "en" | "de"` (persisted in `localStorage`).
- `t(key)` lookup with parallel EN/DE dictionaries.
- `setLang(...)`.

Every visible string must have both EN and DE entries. Engine-generated narratives (rationale, risks, learning, intent, comments) are rendered in the active language directly from `buildPortfolio`.

---

## 8. Persistence

All persistence is `localStorage`-only:

| Key | Owner | Purpose |
|-----|-------|---------|
| `idl.lang` | `i18n.tsx` | Language preference. |
| `idl.riskFreeRate` | `settings.ts` | User-editable risk-free rate. |
| `idl.savedScenarios` | `savedScenarios.ts` | List of named scenarios. |
| `idl.theme` | shadcn theme provider | Light/dark mode. |

There is no server, no cookie, and no telemetry.

---

## 9. Conventions for Contributors

- **Never edit `src/index.css` colour tokens** — design system is centrally tuned.
- **No emojis** anywhere; use `lucide-react` icons only.
- Keep engine logic in `src/lib/`; components should be presentational.
- New ETFs must be added to:
  1. `etfs.ts` (selection rules), and
  2. `lookthrough.ts` (`PROFILES` + `ALIAS`) — otherwise they show as **unmapped** in look-through.
- New scenarios go in `scenarios.ts` and need a shock value for every asset bucket including `Equity_Global` / `Equity_Home`.
- Custom form layouts must use plain `<label>` + `Controller` (shadcn `FormLabel/FormControl` require `FormField+FormItem` context).
- Tailwind v4 is in use → the PDF export uses `html2canvas-pro`, not `html2canvas`.
- Run `pnpm --filter @workspace/investment-lab run typecheck` before committing.

---

## 10. Automated Test Suite

Location: `artifacts/investment-lab/tests/engine.test.ts`. Runner: **Vitest** (Node environment, no browser, runs in ~1 s).

Run locally:

```bash
pnpm --filter @workspace/investment-lab run test       # one-shot
pnpm --filter @workspace/investment-lab run test:watch # watch mode
```

Also registered as the named validation step **`test`** and **`typecheck`**.

### Test catalog (75 cases)

**Default exchange auto-mapping (5)** — every base currency maps to the right exchange (USD→None, EUR→XETRA, CHF→SIX, GBP→LSE) and the map is exhaustive.

**Engine invariants (3)** — default inputs produce a non-empty allocation summing to ~100%; every non-cash bucket has an ETF with ISIN + ticker; no negative weights even for conservative inputs.

**Risk caps (6)** — Low ≤ 40%, Moderate ≤ 70%, High ≤ 90%, Very High allows 100%; Low disables both crypto and gold (commodities) sleeves.

**Home bias (2)** — CHF base creates a Switzerland equity bucket; USD base does not.

**Global+Home equity fallback (2)** — collapses regional equity into Global+Home when `numETFs` is too small (total equity preserved); does NOT collapse when budget is large enough.

**Look-through coverage (1)** — runs a 192-input matrix (4 currencies × 4 risk levels × 4 ETF counts × synthetic on/off, with all satellites + Technology theme) and asserts that every Equity / Fixed-Income ETF the engine can pick has a look-through profile (catches "unmapped ETF" regressions).

**Natural bucket count (2)** — at least 3 for a basic portfolio; grows when satellites are enabled.

**`runValidation` (8)** — accepts a sane default input; rejects `numETFs<3`, `numETFs>15`, `horizon<1`, and target equity wildly above the risk cap; warns on Low+crypto, complexity (`numETFs>10`), and "not enough sleeves" when satellites are requested with too few ETFs.

**ETF selection / share-class logic (10)** — hedged + EUR / CHF / GBP base picks the correct hedged S&P 500 ISIN; synthetic + USD picks IE00B3YCGJ38 (Synthetic); hedged wins over synthetic for non-USD; USD + no-hedging + no-synthetic picks CSPX (IE00B5BMR087); Switzerland always selects SPI on SIX; Fixed Income picks the CHF-hedged or unhedged global aggregate as appropriate; `preferredExchange=XETRA` returns SXR8; `preferredExchange=None` falls back to default exchange; thematic Technology resolves to IUIT; Real Estate / Commodities / Digital Assets resolve to real ETFs.

**Engine math (7)** — cash% follows `(10−h)·1.5 + (Low?5:0)`, clamped to `[2, 20]`; long horizon (≥10) increases EM weight; Sustainability theme reduces USA equity vs. no theme; gold sleeve is carved from bonds (≤ 5% and ≤ 15% of bonds); crypto sizing scales with risk (Moderate=1, High=2, Very High=3); thematic sleeve is 3% if `numETFs ≤ 5` else 5%; REIT sleeve is 6% when included.

**Stress test / scenarios (5)** — every defined scenario returns a result; equity-heavy portfolio loses materially in GFC; `Equity_Home` falls back to USA shocks; Cash receives the cash shock; contributions are sorted by absolute size descending.

**Fees (4)** — blended TER is the weighted average of per-bucket TERs; hedging adds extra bps to hedge-able sleeves only (Equity/FI/Real Estate); projection has `horizon+1` entries and final-after-fees < final-zero-fee; `annualFee = investmentAmount × blendedTer`.

**Metrics (5)** — `mapAllocationToAssets` routes regions to the correct asset key (USA→equity_us, EM→equity_em, …); `computeMetrics` returns sane numbers (positive return/vol, Sharpe > 0, drawdown bounded); the benchmark portfolio has β ≈ 1 and tracking error ≈ 0; the efficient frontier returns 21 points (0..100 step 5) with finite return/vol; the correlation matrix is square, symmetric, with diagonal = 1.

**Compare (4)** — identical portfolios produce zero deltas; `equityDelta = equityB − equityA`; an observation flags when only one portfolio has a crypto sleeve; rows are sorted by absolute delta descending.

**Explain (5)** — flags `Inconsistent` when weights don't sum to 100; warns about concentration when a single position is > 25%; warns when stated risk is Low but equity > 50%; warns when there are no bonds or cash; returns `Coherent` for a balanced portfolio.

**Look-through aggregation (4)** — equity sleeve aggregates to ~100% of `geoEquity` for an equity-only portfolio; currency overview reports a hedged share when hedging is on (non-USD base); USD base + hedging off has zero hedged share; default portfolio with USA exposure produces non-empty top-stock concentrations.

### Maintenance policy

> Whenever functional behaviour is added or changed, the corresponding test in `tests/engine.test.ts` MUST be added or updated **in the same change**, and the suite MUST be run before completion. Bugfixes MUST be accompanied by a regression test that fails without the fix and passes with it.

---

## 11. Changelog

Append a new entry whenever functionality changes. Newest first.

### 2026-04-23
- **Test suite expanded to 75 cases.** New coverage: ETF selection (hedged / synthetic / preferred-exchange), engine math (cash formula, EM horizon tilt, Sustainability USA reduction, gold carve-out, crypto sizing, thematic & REIT sizing), stress-test behaviour (Home→USA fallback, sort order), fees (blended TER, hedging cost, projection), metrics (asset mapping, β≈1 for benchmark, frontier shape, correlation symmetry), portfolio compare diff, explain verdict & warnings, look-through aggregation totals + currency overview. Suite still runs in ~1 s.
- **Automated test suite** added (`tests/engine.test.ts`, Vitest). Initial 22 cases covering exchange auto-mapping, engine invariants, risk caps, home bias, Global+Home fallback, and look-through coverage. New `test` and `test:watch` scripts. Registered as named validation steps. Maintenance policy documented above.
- Extracted **`defaultExchangeFor` / `DEFAULT_EXCHANGE_FOR_CURRENCY`** to `src/lib/exchange.ts`; consumed by Build & Compare auto-sync, fully unit-tested. **`profileFor`** in `lookthrough.ts` is now exported so tests can verify that every ETF the engine picks is mapped (no "unmapped" regressions).
- **Bugfix — Preferred Exchange not switching with Base Currency.** All form `<Select>`/`<RadioGroup>` controls in Build, Compare and Explain were using `defaultValue={field.value}` (uncontrolled), so when Base Currency changed and the auto-sync set `preferredExchange` via `form.setValue`, the form state updated but the visible dropdown did not. Same issue would have affected the new Reset button and Load Scenario. Fixed by switching every form Select/RadioGroup to controlled `value={field.value}`.
- **Reset button** added to Build Portfolio header. Restores all defaults while preserving Base Currency, Horizon and Risk Appetite. Icon-only (`RotateCcw`) with bilingual tooltip.
- **DOCUMENTATION.md** created (this file). Maintenance policy: every functional change updates this document and adds a changelog entry.

### Earlier (consolidated)
- **Min–Max ETF range** in Build & Compare (3–15) replacing the single `numETFs` input. Min is advisory; Max is the hard cap. Inline warning suggests an optimal range when the user's range is incompatible with their inputs.
- **Global+Home equity fallback** when the ETF budget is too small to hold every regional equity bucket: collapses to MSCI ACWI IMI (`Equity-Global`) + a home tilt (`Equity-Home`) based on base currency, preserving total equity exposure and home bias.
- **Look-through profile** for MSCI ACWI IMI (`IE00B3YLTY66`) added so the global equity ETF decomposes into geo / sector / currency / top holdings instead of appearing as "unmapped".
- **Stress scenarios** updated: `Equity_Global` has its own shock, `Equity_Home` falls back to USA shocks; tooltip explanation added in EN/DE.
- **User-editable risk-free rate** persisted in `localStorage` under `idl.riskFreeRate` and used by Sharpe / Sortino / efficient frontier.
- **Saved scenarios** (`localStorage`-backed) with save / load / delete UI.
- **PDF export** migrated to `html2canvas-pro` for Tailwind v4 compatibility.
