# Investment Decision Lab — Functional & Logic Documentation

> **Maintenance rule:** This file MUST be updated whenever a feature is added, removed, or its behaviour changes. Each change should also append an entry to the **Changelog** section at the bottom.

Last updated: 2026-04-23

---

## 1. Purpose & Scope

The Investment Decision Lab is a **frontend-only** React + Vite web application aimed at private investors and finance professionals. It constructs reference portfolios with a **fully deterministic, rule-based engine** — there is no backend, no database, no AI/LLM call, and no remote pricing. All computations happen in the browser.

> ### Not AI — rule-based by design
>
> The portfolio proposal is produced by an **explicit, rule-based engine**, not by any AI/ML model. Every weight is the output of:
>
> 1. A static table of **Capital Market Assumptions** (expected return, volatility, correlations) — see §4.1 and `src/lib/metrics.ts`.
> 2. **Closed-form formulas and constants** — equity/defensive split from the risk cap, `cashPct` clamp, market-cap regional anchors, Sharpe overlay `(Sharpe / 0.25)^0.4`, home-bias multipliers, the 65% concentration cap.
> 3. **Hard rules** for satellite sleeves (REIT 6%, Crypto 1–3%, Thematic 3–5%, Gold ≤ 5%) and ETF selection (currency hedging, preferred exchange, synthetic vs physical).
>
> **Identical inputs always produce identical outputs.** No machine learning, no LLM call, no probabilistic optimiser, no training data. Every percentage in a generated portfolio can be re-derived by hand from the Methodology tab. The only stochastic component anywhere in the app is the optional **Monte Carlo projection** on the metrics view, which simulates outcomes for the already-deterministic portfolio — it is not used to construct it.

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

### 4.2 Equity regional weights — principled construction

Replaces the previous fixed regional bases. Implemented by `computeEquityRegionWeights(input)` in `portfolio.ts`.

**Step 1 — Market-cap anchor** (the canonical "neutral" portfolio in modern portfolio theory; approximate MSCI ACWI regional shares):

| Region | Anchor (USD/EUR/GBP base) | Anchor (CHF base) |
|---|---:|---:|
| USA | 0.60 | 0.60 |
| Europe | 0.13 | 0.10 |
| Switzerland | — | 0.04 |
| Japan | 0.05 | 0.05 |
| Emerging Markets | 0.11 | 0.11 |

For CHF base, the Switzerland anchor is carved out of Europe so total developed-Europe exposure is preserved.

**Step 2 — Apply documented overlays** to each anchor:

```
raw_i = anchor_i
        × ((Sharpe_i / 0.25)^0.4)         # damped Sharpe overlay (uses CMA from metrics.ts)
        × home_factor (if home region)    # home-bias overlay
        × 1.3 (if region = EM and h ≥ 10) # long-horizon EM tilt
        × 0.85 (if region = USA and       # Sustainability theme
               thematicPreference = "Sustainability")
```

**Step 3 — Normalise to 100, then apply a 65% concentration cap** per region (excess redistributed proportionally to others). Final weights are scaled to `coreEquity`.

| Constant | Value |
|---|---|
| Home tilt (USD → USA) | × 1.0 (anchor already dominant) |
| Home tilt (EUR → Europe) | × 1.5 |
| Home tilt (GBP → Europe) | × 1.5 |
| Home tilt (CHF → Switzerland) | × 2.5 |
| Long-horizon EM tilt (h ≥ 10) | × 1.3 |
| Sustainability theme on USA | × 0.85 |
| Concentration cap per region | 65% of equity sleeve |
| Reference risk-free for Sharpe overlay | 2.5% (decoupled from user's risk-free setting so portfolio shape is reproducible) |

Why this design:

- **Anchored on the market portfolio** — the global market-cap weights are the "no-view" benchmark of CAPM/Sharpe; deviations from it are explicit, documented active tilts.
- **Single source of truth for risk/return** — Sharpe overlay uses the same CMA that `metrics.ts` exposes for Sharpe ratio and the efficient frontier; no separate magic numbers.
- **Avoids extreme concentration** — the 65% cap prevents any single market from running away (USA hits the cap roughly when all tilts align in its favour).
- **Balance of growth drivers and stabilisers** — the equity/defensive split (risk-cap and `cashPct` formula) plus the satellite carve-outs deliver this at the portfolio level; market-cap anchoring does it inside the equity sleeve.

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
| `investment-lab.lang.v1` | `i18n.tsx` | Language preference. |
| `idl.riskFreeRate` | `settings.ts` | User-editable risk-free rate. |
| `investment-lab.savedScenarios.v1` | `savedScenarios.ts` | List of named scenarios. |
| `vite-ui-theme` | `components/theme-provider.tsx` (next-themes) | Light/dark mode. |

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

### Test catalog (79 cases)

**Default exchange auto-mapping (5)** — every base currency maps to the right exchange (USD→None, EUR→XETRA, CHF→SIX, GBP→LSE) and the map is exhaustive.

**Engine invariants (3)** — default inputs produce a non-empty allocation summing to ~100%; every non-cash bucket has an ETF with ISIN + ticker; no negative weights even for conservative inputs.

**Risk caps (6)** — Low ≤ 40%, Moderate ≤ 70%, High ≤ 90%, Very High allows 100%; Low disables both crypto and gold (commodities) sleeves.

**Home bias (2)** — CHF base creates a Switzerland equity bucket; USD base does not.

**Global+Home equity fallback (2)** — collapses regional equity into Global+Home when `numETFs` is too small (total equity preserved); does NOT collapse when budget is large enough.

**Look-through coverage (1)** — runs a 192-input matrix (4 currencies × 4 risk levels × 4 ETF counts × synthetic on/off, with all satellites + Technology theme) and asserts that every Equity / Fixed-Income ETF the engine can pick has a look-through profile (catches "unmapped ETF" regressions).

**Natural bucket count (2)** — at least 3 for a basic portfolio; grows when satellites are enabled.

**`runValidation` (9)** — accepts a sane default input; rejects `numETFs<3`, `numETFs>15`, `horizon<1`, and target equity wildly above the risk cap; warns on Low+crypto, complexity (only when `min(naturalBuckets, numETFs) > 10` — so a high Max with a small bucket count does NOT trigger a false "too complex" warning), and "not enough sleeves" when satellites are requested with too few ETFs.

**ETF selection / share-class logic (10)** — hedged + EUR / CHF / GBP base picks the correct hedged S&P 500 ISIN; synthetic + USD picks IE00B3YCGJ38 (Synthetic); hedged wins over synthetic for non-USD; USD + no-hedging + no-synthetic picks CSPX (IE00B5BMR087); Switzerland always selects SPI on SIX; Fixed Income picks the CHF-hedged or unhedged global aggregate as appropriate; `preferredExchange=XETRA` returns SXR8; `preferredExchange=None` falls back to default exchange; thematic Technology resolves to IUIT; Real Estate / Commodities / Digital Assets resolve to real ETFs.

**Engine math (7)** — cash% follows `(10−h)·1.5 + (Low?5:0)`, clamped to `[2, 20]`; long horizon (≥10) increases EM weight; Sustainability theme reduces USA equity vs. no theme; gold sleeve is carved from bonds (≤ 5% and ≤ 15% of bonds); crypto sizing scales with risk (Moderate=1, High=2, Very High=3); thematic sleeve is 3% if `numETFs ≤ 5` else 5%; REIT sleeve is 6% when included.

**Stress test / scenarios (5)** — every defined scenario returns a result; equity-heavy portfolio loses materially in GFC; `Equity_Home` falls back to USA shocks; Cash receives the cash shock; contributions are sorted by absolute size descending.

**Fees (4)** — blended TER is the weighted average of per-bucket TERs; hedging adds extra bps to hedge-able sleeves only (Equity/FI/Real Estate); projection has `horizon+1` entries and final-after-fees < final-zero-fee; `annualFee = investmentAmount × blendedTer`.

**Metrics (5)** — `mapAllocationToAssets` routes regions to the correct asset key (USA→equity_us, EM→equity_em, …); `computeMetrics` returns sane numbers (positive return/vol, Sharpe > 0, drawdown bounded); the benchmark portfolio has β ≈ 1 and tracking error ≈ 0; the efficient frontier returns 21 points (0..100 step 5) with finite return/vol; the correlation matrix is square, symmetric, with diagonal = 1.

**Compare (4)** — identical portfolios produce zero deltas; `equityDelta = equityB − equityA`; an observation flags when only one portfolio has a crypto sleeve; rows are sorted by absolute delta descending.

**Explain (5)** — flags `Inconsistent` when weights don't sum to 100; warns about concentration when a single position is > 25%; warns when stated risk is Low but equity > 50%; warns when there are no bonds or cash; returns `Coherent` for a balanced portfolio.

**Look-through aggregation (4)** — equity sleeve aggregates to ~100% of `geoEquity` for an equity-only portfolio; currency overview reports a hedged share when hedging is on (non-USD base); USD base + hedging off has zero hedged share; default portfolio with USA exposure produces non-empty top-stock concentrations.

**Principled equity-region construction (4)** — no equity region exceeds 50% of the equity sleeve for any base currency (concentration cap); each base currency tilts its home region above the USD-base reference (USD→USA, EUR/GBP→Europe, CHF→Switzerland exclusive to CHF); risk-parity baseline gives lower-vol Japan more weight than higher-vol EM when other tilts are neutral (USD base, short horizon, no theme); equity sleeve sums to `targetEquityPct ± rounding` for the default input.

### Maintenance policy

> Whenever functional behaviour is added or changed, the corresponding test in `tests/engine.test.ts` MUST be added or updated **in the same change**, and the suite MUST be run before completion. Bugfixes MUST be accompanied by a regression test that fails without the fix and passes with it.

---

## 11. Changelog

Append a new entry whenever functionality changes. Newest first.

### 2026-04-23
- **Compare tab: warning details now shown, not just count.** Previously the per-portfolio warning alert only showed the count (e.g. "Portfolio A – Warnungen (2)"); the actual messages were silent. Both warning alerts now expand each `validation.warnings` entry into a list with the warning message and (when present) the suggestion text — same format as the Build tab. Sources: `runValidation` in `src/lib/validation.ts`.
- **Explain Portfolio: beta-version notice.** Added an amber warning banner at the top of the Explain Portfolio tab (EN/DE) clarifying that the module is in early beta and listing planned additions: position-level look-through, factor & style analysis, tax-efficiency scoring, cost comparison vs. benchmark, overlap analysis, and rebalancing suggestions. Wraps the existing two-column layout in a `space-y-6` stack so the banner sits above the input/result columns.
- **Compare tab: full DE translation.** All previously hardcoded English labels now switch with the language toggle: form labels (Basiswährung, Horizont (Jahre), Risikobereitschaft, Aktien-Zielallokation, Thematischer Tilt, Währungsabsicherung, Satelliten-Anlageklassen, Rohstoffe (Gold), Börsennotierte Immobilien, Krypto einbeziehen), all FormDescription subtexts, the Risk Appetite radio labels (Niedrig/Moderat/Hoch/Sehr hoch), the Thematic Tilt options (Keine/Technologie/Gesundheit/Nachhaltigkeit/Cybersicherheit), the submit button ("Portfolios vergleichen"), the validation alerts ("Portfolio A – Fehler/Warnungen/gültig", same for B), the "Strukturelle Unterschiede" card title and its description, the diff-table header ("Anlageklasse / Region", with the delta column flipped from `Δ (B - A)` to the proper minus-sign `Δ (B − A)`), the side-by-side allocation pie titles ("Allokation Portfolio A/B"), and the chart hover label ("Gewicht"). Implemented via a small inline `tr(en, de)` helper to keep the file self-contained without adding ~30 keys to `i18n.tsx`. The legend `data-testid` was switched from a fragile substring match to an explicit `slot: "A" | "B"` so the German titles don't break testing.
- **Risk & Performance Metrics: (i) icons now hover-open like the form fields.** The metric tiles previously used a `Popover` that required a click; switched to the same `Tooltip` primitive that the Build/Compare form labels use, so all (i) icons across the app open on hover (and tap on touch devices) consistently. Same content, same `aria-label`.
- **DE translation for "Ready to Build" / "Configure and Compare" empty states.** The Build tab placeholder now uses the existing `build.empty.title` / `build.empty.desc` keys (DE: "Bereit zur Erstellung" / "Konfigurieren Sie Ihre Präferenzen…") instead of hard-coded English strings. The Compare tab placeholder ("Configure and Compare" / "Setup both portfolios above…") now switches to "Konfigurieren und Vergleichen" / "Konfigurieren Sie oben beide Portfolios…" when the UI is set to German.
- **Compare tab: consistent (i) info tooltips on form fields.** Added the same hover/tap info tooltips that the Build tab uses next to each matching label (Base Currency, Horizon, Risk Appetite, Target Equity Allocation, Thematic Tilt) so the (i) icons behave identically across both tabs and reuse the same translation keys (`build.baseCurrency.tooltip`, `build.horizon.tooltip`, `build.riskAppetite.tooltip`, `build.targetEquity.tooltip`, `build.thematicTilt.tooltip`). The toggle-row fields (Currency Hedging, Commodities, Listed Real Estate, Crypto) keep their existing `FormDescription` subtext, matching the Build tab's pattern for those rows.
- **Compare tab: removed "Number of ETFs (min – max)" and "Preferred Exchange" inputs.** Both portfolios now use the form defaults (Portfolio A: 8–10 ETFs, Portfolio B: 11–13 ETFs; preferred exchange auto-synced from base currency via `defaultExchangeFor`). Eliminates two extra controls per portfolio in the Compare configuration panel; the Build tab keeps both controls. Also removed the now-unused `CompareNumEtfsRangeWarning` helper and the `computeNaturalBucketCount` / `Controller` imports.
- **Compare tab: removed "Include Synthetic ETFs" toggle.** Both Portfolio A and B now always use the default `includeSyntheticETFs: false` (physical replication). Reduces Compare configuration noise; users who want to evaluate synthetic vs physical can still toggle it in the Build tab.
- **Compare tab: Look-Through is always on.** Removed the per-portfolio "Look-Through Analysis" toggle from both Portfolio A and B configuration panels. Look-through decomposition (geographic map + underlying-holding analysis) is now always applied in Compare so the geographic allocation panel and any future look-through-based comparisons always have data and the two sides are always rendered on the same basis. Build tab keeps the toggle (unchanged). The `lookThroughView` field stays in the form state defaulted to `true` for engine compatibility.
- **Compare tab: effective geographic equity allocation per portfolio.** The interactive `GeoExposureMap` (world map with regional shading + numeric breakdown) is now rendered for both Portfolio A and B side-by-side, placed after the allocation pies and before the "Per-Portfolio Deep Dive" card. Single-column on mobile. Both maps use the look-through engine, so the geography reflects underlying ETF holdings, not just the regional bucket weights.
- **Saved scenarios are now usable from the Compare tab (and vice versa).** `SavedScenariosUI` gained an optional `compareSlots` prop. When provided, the toolbar shows two save buttons ("Save Portfolio A" / "Save Portfolio B" — each disabled until that side has been generated) and the Saved Scenarios list shows two compact load buttons ("→ A" / "→ B") instead of the single load action. Mounted under the "Compare Portfolios" button on the Compare tab; loading a scenario fills that side's form via `form.setValue` and shows a toast. The Build tab keeps the existing single-slot behaviour (unchanged API). Bilingual labels (EN/DE).
- **Compare tab: allocation legend + responsive deep-dive layout.** Each allocation pie chart now has a labelled legend below the chart (color swatch + asset-class/region name + weight in %) so readers no longer have to hover the pie to identify slices. The "Per-Portfolio Deep Dive" section is now responsive: on mobile (<md) it keeps the existing A/B tab switcher (saves vertical space), on desktop (≥md) Portfolio A and B sit side-by-side in a two-column grid with their full Risk Metrics / Stress Test / Monte Carlo blocks, so direct visual comparison no longer requires switching tabs.
- **Compare tab: Portfolio A default risk is now Moderate.** Previously both default portfolios sat in the High / Very-High bracket, which made the side-by-side feel narrow. Portfolio A now defaults to Moderate (CHF, horizon 10y, 50% equity) so the out-of-the-box comparison contrasts a balanced portfolio against the aggressive Portfolio B (Very High, 90% equity, Technology theme, crypto).
- **AI prompt: exact horizon years instead of buckets.** Replaced the bucketed labels (`>=10 years` / `7-9 years` / `4-6 years`) with the literal user value, e.g. "Investment horizon: 12 years" (DE: "Anlagehorizont: 12 Jahre"). Singular form for `1 year` / `1 Jahr`. Affected English and German prompts; existing tests updated.
- **AI prompt is now bilingual (EN/DE).** `buildAiPrompt(input, lang)` gained a `lang: "en" | "de"` parameter (default `"en"`) and ships a fully German version of the prompt — role, objective, execution mode, asset-class section, all 15 numbered constraints, output format A–H, and the closing disclaimer instruction. Risk levels (Niedrig/Moderat/Hoch/Sehr hoch), horizon buckets (`>=10 Jahre`), home-bias labels (Schweizer/Eurozonen-/britischen/US-), satellite asset-class names (Rohstoffe/Boersennotierte Immobilien/Krypto-Assets/Thematische Aktien) and the four exchange-preference variants are all translated. The Build tab's "Copy AI Prompt" button now passes the active UI language, so toggling DE/EN in the header swaps the prompt language. Two new tests; suite at 90 cases.
- **AI prompt: commodities now listed under Satellites.** Previously the prompt listed "Commodities / Precious Metals" as a fourth Core asset class alongside Cash / Bonds / Equities. Moved it into the Satellites block (above REITs, Crypto, and Thematic Equity) so Core stays Cash + Bonds + Equities and the Satellites group consistently covers all return-enhancing add-ons. Table 1 group list updated accordingly (Cash, Bonds, Equities, Satellites). Existing test extended to assert commodities appears inside the Satellites section, not in Core. Suite at 88 cases.
- **Toast notifications now actually appear.** The app already used `sonner`'s `toast.success/error` in several places (Copy AI Prompt, PDF export success, scenario save/load/delete, CSV import) but `<SonnerToaster />` was never mounted, so the toasts silently no-opped. Added `<SonnerToaster position="top-center" richColors closeButton duration={2500} />` next to the existing shadcn `<Toaster />` in `App.tsx`. "Prompt copied" and other confirmations now flash for ~2.5 s.
- **Complexity warning is now consistent with the "optimal Min" hint.** Previously the "High complexity" warning fired whenever Max > 10, even if the natural bucket count was lower (e.g. Max=11 with 9 buckets → engine builds 9 ETFs but UI complained "too many"). The validation now uses `min(naturalBuckets, numETFs)` as the effective ETF count, so the two messages no longer contradict each other. Suggestion text also names the actual count and points at the satellite toggles. New regression test added — suite at 88 cases.
- **AI prompt: equity-region list reflects base currency.** Switzerland (CH) is now listed as a separate equity region in the prompt only for CHF base portfolios; USD/EUR/GBP prompts list "USA, Europe, Japan, and Emerging Markets" (no CH carve-out, matching how the deterministic engine builds the equity sleeve in §4.2). New test added — suite at 87 cases.
- **"Copy AI Prompt" feature.** New helper `buildAiPrompt(input)` in `src/lib/aiPrompt.ts` that converts the current Build-Portfolio parameters into a self-contained, copy-paste CFA-style prompt for an external LLM (ChatGPT, Claude, etc.). Substitutes base currency, risk appetite, horizon (with `>=10 years` bucket for long horizons), equity range (`targetEquityPct ± 10`), preferred-exchange line, ETF count range, home-bias label per currency, and conditionally toggles synthetic-ETF / currency-hedging / look-through / commodities / crypto / REIT / thematic instructions. New "Copy AI Prompt" outline button under the "Generate Portfolio" button on the Build tab, with tooltip and toast feedback (EN/DE i18n keys added). 7 new prompt-builder tests; suite now 86 cases. Note: the deterministic engine in this app is unaffected — this is purely a convenience to let the user benchmark the rule-based proposal against an external AI's output.
- **"Not AI — rule-based by design" emphasis.** Added a prominent callout block to §1 of `DOCUMENTATION.md` and a matching "Rule-based, not AI" alert at the top of the Methodology tab UI (EN/DE). Clarifies that no ML model / LLM / probabilistic optimiser is involved in portfolio construction, that identical inputs produce identical outputs, and that the Monte Carlo projection is the only stochastic component (and is not part of construction).
- **Construction baseline switched from `1/σ` (risk parity) to MSCI-ACWI-style market-cap anchors.** The pure risk-parity baseline produced ~30% USA for a USD investor, which felt too far from the market portfolio. New baseline uses anchor weights (USA 60, Europe 13, Japan 5, EM 11; CHF base carves Switzerland 4 out of Europe). Sharpe / horizon / theme overlays unchanged; home tilts retuned (USD ×1.0, EUR/GBP ×1.5, CHF ×2.5); concentration cap raised from 50% to 65%. DOCUMENTATION.md §4.2 and the Methodology UI panel updated accordingly. All 79 tests still green (cap test bumped to 65%, principle test reframed as "USA dominates for USD-base").
- **Methodology UI.** New "Portfolio Construction" accordion section in `Methodology.tsx` (EN/DE) — exposes the risk-parity baseline, Sharpe overlay, home-bias factors, horizon/theme tilts and concentration cap directly to end users, with a constants table and the formula. Defaults to opened on first view.
- **Principled equity-region construction.** Replaced the fixed regional bases (`USA=45`, `Europe=22`, `CH=8 if CHF`, `Japan=8`, `EM=15+5 if h≥10`) with a derived methodology in `computeEquityRegionWeights(input)`: risk-parity baseline (`1/σ`) using the same CMA as `metrics.ts`, plus a damped Sharpe overlay, multiplicative home-bias tilt (USD ×1.2, EUR/GBP ×1.4, CHF ×1.6), long-horizon EM tilt (×1.3 if h≥10), Sustainability USA dampening (×0.85), and a 50% per-region concentration cap with proportional excess redistribution. Defensive sleeve, satellites, risk caps and ETF selection are unchanged. Added 4 new tests for cap, home tilt, risk-parity baseline and equity-sum stability — suite now 79 cases, all green.
- **Doc audit.** Corrected stale `localStorage` key names in §8 Persistence (`investment-lab.lang.v1`, `investment-lab.savedScenarios.v1`, `vite-ui-theme`). Test count, file inventory, engine pipeline and analytical-modules table re-verified against current source.
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
