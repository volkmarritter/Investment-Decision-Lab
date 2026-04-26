# Investment Decision Lab — Functional & Logic Documentation

> **Maintenance rule:** This file MUST be updated whenever a feature is added, removed, or its behaviour changes. Each change should also append an entry to the **Changelog** section at the bottom.

Last updated: 2026-04-26 (per-base-currency-risk-free-rates — Task #32)

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
| `preferredExchange` | `None \| LSE \| XETRA \| SIX` | ETF listing preference (`None` = engine picks the most liquid European listing per ETF). Euronext Amsterdam is kept inside the catalog data as a last-resort fallback but is not exposed as a user-pickable option. |
| `thematicPreference` | `None \| Technology \| Healthcare \| Sustainability \| Cybersecurity` | Adds a thematic sleeve. |
| `includeCurrencyHedging` | `boolean` | Selects hedged share-classes where available. |
| `includeSyntheticETFs` | `boolean` | Allows swap-based US equity replication. |
| `lookThroughView` | `boolean` | Toggles the look-through analysis panel. |
| `includeCrypto` | `boolean` | Adds 1–3% digital assets sleeve (gated by risk). |
| `includeListedRealEstate` | `boolean` | Adds ~6% global REITs. |
| `includeCommodities` | `boolean` | Adds up to 5% gold (carved from bonds). |

User-editable global settings (`src/lib/settings.ts`, persisted in `localStorage` under `idl.riskFreeRates`):

- **Risk-free rate (per base currency)** — used by Sharpe / Sortino / efficient frontier and by the Sharpe-tilt step of equity-region construction. The rate looked up at calculation time matches the portfolio's `baseCurrency`. Defaults: USD `4.25%`, EUR `2.50%`, GBP `4.00%`, CHF `0.50%`. Each row can be overridden independently in the Methodology tab; the legacy single-rate key `idl.riskFreeRate` is dropped on module load (no value migration).

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
| Risk-free for Sharpe overlay | User-editable per base currency (USD `4.25%` / EUR `2.50%` / GBP `4.00%` / CHF `0.50%` defaults). Looked up at build time via `getRiskFreeRate(input.baseCurrency)`. |

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

#### 4.6.1 Canonical asset-class display order

After rounding (and again after any manual override pass — see §4.10), `allocation` is sorted into a fixed canonical order: **Cash → Bonds (Fixed Income) → Equities → Commodities → REITs (Real Estate) → Crypto (Digital Assets)**. Within an asset class (e.g. multiple equity regions: USA, Europe, Switzerland, Japan, EM, Thematic), rows remain sorted by weight descending as the tiebreaker. The same order propagates to `etfImplementation`, which is built by iterating `allocation` and skipping the cash row, so the Build tab's Implementation table and every downstream consumer of the row order share a single source of truth (`sortAllocationCanonical` in `src/lib/portfolio.ts`).

### 4.7 ETF implementation — catalog, mapping, and selection logic

Once §§4.1–4.6 have produced the abstract `allocation` (asset-class + region + weight rows), each non-cash row must be turned into a real, tradable UCITS ETF — that is the job of `getETFDetails(assetClass, region, input)` in `src/lib/etfs.ts`. This section documents the full mechanism end-to-end so a contributor can add or swap an ETF without breaking the engine.

#### 4.7.1 Catalog data model

The catalog is a single in-code object: `const CATALOG: Record<string, ETFRecord>`. Each entry is keyed by an **abstract product slot** (e.g. `"Equity-USA"`, `"Equity-USA-EUR"`, `"FixedIncome-Global-CHF"`), not by ticker or ISIN. The fields on `ETFRecord`:

| Field | Type | Meaning |
|-------|------|---------|
| `name` | string | Full marketing name of the ETF / ETC / ETP. |
| `isin` | string | ISIN — also the join key used by the data-refresh overrides file. |
| `terBps` | number | Total Expense Ratio in basis points; refreshed weekly by the justETF script (see §5.2). |
| `domicile` | string | Fund domicile (mostly Ireland — UCITS / Section 110 — plus Switzerland for the SPI tracker and Jersey for the Bitcoin ETP). |
| `replication` | `"Physical" \| "Physical (sampled)" \| "Synthetic"` | Tracking method; affects the `comment` and the synthetic toggle. |
| `distribution` | `"Accumulating" \| "Distributing"` | Income treatment; surfaced in the Implementation table. |
| `currency` | string | Fund currency of the share class (not the trading currency). |
| `comment` | string | One-line plain-language note on what the ETF is and why it was picked; shown in the UI. |
| `listings` | `Partial<Record<ExchangeCode, { ticker: string }>>` | Map of available exchange listings → trading symbol. `ExchangeCode = "LSE" \| "XETRA" \| "SIX" \| "Euronext"`. |
| `defaultExchange` | `ExchangeCode` | Which listing to use when the user has no preference (`preferredExchange === "None"`). Must exist in `listings`. **Never set this to `"Euronext"`** — Euronext is reserved as a last-resort fallback only (see §4.7.4). |

#### 4.7.2 The catalog at a glance

There are 22 entries. Grouped by purpose:

**Core equity (unhedged)**

| Catalog key | ETF | ISIN | TER | Default | Listings |
|-------------|-----|------|-----|---------|----------|
| `Equity-Global` | SPDR MSCI ACWI IMI UCITS | IE00B3YLTY66 | 17 bps | LSE | LSE / XETRA / SIX / Euronext (all `SPYI`) |
| `Equity-USA` | iShares Core S&P 500 UCITS | IE00B5BMR087 | 7 bps | LSE | LSE `CSPX` / XETRA `SXR8` / SIX `CSSPX` / Euronext `CSPX` |
| `Equity-USA-Synthetic` | Invesco S&P 500 UCITS (Swap) | IE00B3YCGJ38 | 5 bps | LSE | LSE `SPXS` / XETRA `SC0J` / SIX `SPXS` / Euronext `SPXS` |
| `Equity-Europe` | iShares Core MSCI Europe | IE00B4K48X80 | 12 bps | XETRA | LSE `IMEU` / XETRA `SXR7` / SIX `CEU` / Euronext `IMAE` |
| `Equity-Switzerland` | iShares Core SPI | CH0237935652 | 10 bps | SIX | SIX `CHSPI` only |
| `Equity-Japan` | iShares Core MSCI Japan IMI | IE00B4L5YX21 | 12 bps | LSE | LSE `SJPA` / XETRA `SXR4` / SIX `CSJP` / Euronext `IJPA` |
| `Equity-EM` | iShares Core MSCI EM IMI | IE00BKM4GZ66 | 18 bps | LSE | LSE `EIMI` / XETRA `IS3N` / SIX `EIMI` / Euronext `EMIM` |

**Core equity (currency-hedged share classes)**

| Catalog key | ETF | ISIN | TER | Default | Listings |
|-------------|-----|------|-----|---------|----------|
| `Equity-USA-EUR` | iShares S&P 500 EUR Hedged | IE00B3ZW0K18 | 20 bps | XETRA | LSE / XETRA / Euronext (all `IUSE`) |
| `Equity-USA-CHF` | UBS S&P 500 CHF Hedged | IE00B3ZW0K18 | 22 bps | SIX | SIX `S500CHA` only |
| `Equity-USA-GBP` | iShares Core S&P 500 GBP Hedged | IE00BYX5MS15 | 20 bps | LSE | LSE `GSPX` only |

**Fixed income**

| Catalog key | ETF | ISIN | TER | Default | Listings |
|-------------|-----|------|-----|---------|----------|
| `FixedIncome-Global` | iShares Core Global Aggregate Bond | IE00B3F81409 | 10 bps | LSE | LSE `AGGG` / XETRA `EUNA` / SIX `AGGH` / Euronext `AGGG` |
| `FixedIncome-Global-EUR` | iShares Global Aggregate Bond EUR Hedged | IE00BDBRDM35 | 10 bps | XETRA | XETRA / LSE / Euronext (all `AGGH`) |
| `FixedIncome-Global-CHF` | iShares Global Aggregate Bond CHF Hedged | IE00BDBRDN42 | 12 bps | SIX | SIX `AGGS` only |
| `FixedIncome-Global-GBP` | iShares Global Aggregate Bond GBP Hedged | IE00BDBRDP65 | 10 bps | LSE | LSE `AGBP` only |

**Satellites**

| Catalog key | ETF | ISIN | TER | Default | Listings |
|-------------|-----|------|-----|---------|----------|
| `Commodities-Gold` | Invesco Physical Gold ETC | IE00B579F325 | 12 bps | LSE | LSE `SGLD` / XETRA `8PSG` / SIX `SGLD` / Euronext `SGLD` |
| `RealEstate-GlobalREITs` | iShares Developed Markets Property Yield | IE00B1FZS350 | 59 bps | LSE | LSE `IWDP` / XETRA `IQQ6` / SIX `IWDP` / Euronext `IWDP` |
| `DigitalAssets-BroadCrypto` | CoinShares Physical Bitcoin | GB00BLD4ZL17 | 25 bps | SIX | LSE / XETRA / SIX / Euronext (all `BITC`) |

**Thematic tilts** (only used when `thematicPreference !== "None"`)

| Catalog key | ETF | ISIN | TER | Default | Listings |
|-------------|-----|------|-----|---------|----------|
| `Equity-Technology` | iShares S&P 500 Information Technology | IE00B3WJKG14 | 15 bps | LSE | LSE `IUIT` / XETRA `QDVE` / SIX `IUIT` / Euronext `IUIT` |
| `Equity-Healthcare` | iShares Healthcare Innovation | IE00BYZK4776 | 40 bps | LSE | LSE `HEAL` / XETRA `2B77` / Euronext `HEAL` |
| `Equity-Sustainability` | iShares Global Clean Energy | IE00B1XNHC34 | 65 bps | LSE | LSE `INRG` / XETRA `IQQH` / SIX `INRG` / Euronext `INRG` |
| `Equity-Cybersecurity` | iShares Digital Security | IE00BG0J4C88 | 40 bps | LSE | LSE `LOCK` / XETRA `2B7K` / Euronext `LOCK` |

TER values (and a small set of additional fields — see §5.2) are subject to the weekly refresh job; the table above shows the curated baseline.

#### 4.7.3 Step 1 — Bucket → catalog key (`lookupKey`)

For each non-cash allocation row the engine first chooses **which catalog slot** to use. The decision is encoded in `lookupKey(assetClass, region, input)` and follows this strict priority:

1. **Fixed Income**
   - If `includeCurrencyHedging === true` AND `baseCurrency !== "USD"` AND a matching `FixedIncome-Global-<base>` slot exists → use it.
   - Otherwise → `FixedIncome-Global` (USD-denominated).
2. **Commodities** → always `Commodities-Gold`.
3. **Real Estate** → always `RealEstate-GlobalREITs`.
4. **Digital Assets** → always `DigitalAssets-BroadCrypto`.
5. **Equity** — region-driven:
   - `region === "Global"` → `Equity-Global` (the compaction fallback from §4.5).
   - `region === "Home"` (only used by §4.5 Global+Home compaction): map base currency to the home equity sleeve — USD → `Equity-USA` (with hedging / synthetic resolution as below), CHF → `Equity-Switzerland`, EUR/GBP → `Equity-Europe`.
   - `region` includes `"USA"`:
     1. If hedging is on AND base ≠ USD AND `Equity-USA-<base>` exists → that hedged sleeve.
     2. Else if `includeSyntheticETFs === true` → `Equity-USA-Synthetic` (the swap-based S&P 500).
     3. Else → `Equity-USA` (physical iShares CSPX).
   - `region` includes `"Europe"` → `Equity-Europe`.
   - `region` includes `"Switzerland"` → `Equity-Switzerland`.
   - `region` includes `"Japan"` → `Equity-Japan`.
   - `region` includes `"EM"` → `Equity-EM`.
   - `region === "Technology" / "Healthcare" / "Sustainability" / "Cybersecurity"` → the matching thematic sleeve.
6. If none of the above branches matches → return `null`. The caller (`getETFDetails`) then emits a generic placeholder row (§4.7.5) so the portfolio still renders without throwing.

**Tie-breaking notes**

- *Hedging beats synthetic.* For US equity with both `includeCurrencyHedging` and `includeSyntheticETFs` enabled and base ≠ USD, the hedged physical share class wins because the catalog has no hedged-synthetic variant.
- *Synthetic is US-only by design.* The catalog deliberately ships only one synthetic sleeve (the Invesco S&P 500 swap ETF) — that is where the 15 % US dividend-withholding leakage justifies the swap structure. Other regions stay physical.

#### 4.7.4 Step 2 — Catalog key → concrete listing (`pickListing`)

Once `lookupKey` has chosen a slot, `pickListing(rec, preferredExchange)` resolves which **exchange + ticker** to display. The 4-step order is:

1. **Honour an explicit user preference.** If `preferredExchange ∈ {"LSE","XETRA","SIX"}` AND the ETF has a listing on that venue → return that ticker on that venue.
2. **Otherwise use the ETF's declared `defaultExchange`** (provided it isn't Euronext — and it isn't for any current catalog entry).
3. **Fallback chain in deterministic order:** try `LSE`, then `XETRA`, then `SIX`. Return the first one that exists in the ETF's `listings`.
4. **Last-resort fallback: Euronext.** Only used when `preferredExchange === "None"` AND none of the venues above lists this ETF. With today's catalog this branch is unreachable (every ETF has at least one of LSE/XETRA/SIX); it is kept for forward-compatibility if a Euronext-only ETF is added later.

**Why Euronext is in the data but never a user choice.** The Build tab's Preferred Exchange dropdown only exposes `None / LSE / XETRA / SIX`. The Amsterdam tickers are kept in the catalog for reference (so e.g. an investor copy-pasting the Implementation table into a broker still sees the canonical Euronext ticker if they enable that venue manually), but the engine will not silently pick Euronext when a non-Euronext listing exists. A regression test in `tests/engine.test.ts` walks every implementation row of a generated portfolio and asserts none resolves to Euronext.

#### 4.7.5 Placeholder / unknown buckets

If `lookupKey` returns `null` (asset-class + region combination not covered by the catalog), `getETFDetails` returns a `placeholder(assetClass, region)` row with `ticker: "—"`, `exchange: "—"`, `terBps: 25` and a comment flagging it as illustrative. This guarantees the engine never throws on an unknown bucket — an important contract for the deterministic narrative output.

#### 4.7.6 TER override layer

After `CATALOG` is declared, the module loads `src/data/etfs.overrides.json` (see §5.2 for the refresh pipeline) and shallow-merges any ISIN-keyed `{ terBps?, name?, domicile?, currency?, aumMillionsEUR?, inceptionDate?, distribution?, replication? }` patch onto the matching record. The merge is by ISIN, not by catalog key, so a single override entry updates every share class with the same ISIN. The committed default file is empty, so when no refresh has run the engine behaves identically to the in-code values.

#### 4.7.7 Output: `ETFImplementation`

`getETFDetails` returns an `ETFDetails` row containing: `name`, `isin`, `ticker`, `exchange`, `terBps`, `domicile`, `replication`, `distribution`, `currency`, and a `comment`. `buildPortfolio` then attaches the bucket weight and emits the array as `etfImplementation`, which the UI renders in the Build tab's Implementation table.

#### 4.7.8 What is intentionally NOT in the selection logic

- **No provider rotation / diversification across issuers.** The catalog stores exactly one "best-in-class" ETF per slot; if you want iShares ↔ Vanguard alternation, add it to the catalog.
- **No live data calls at runtime.** All catalog data is in code; only the snapshot-refreshable fields listed in §5.2 (TER, fund size, inception date, distribution policy, replication method) can change via the JSON override. The user's browser never makes a market-data API call.
- **No tax-residency-aware switching.** Domicile is Ireland by default for the UCITS-tax-leakage benefits; this is shown as data but not used as a selection input.
- **No on-the-fly bid-ask / liquidity ranking.** Listing order in the fallback chain is fixed (LSE → XETRA → SIX) for determinism. Real liquidity considerations are baked into which listing is set as `defaultExchange` per ETF.

#### 4.7.9 How to add or swap an ETF

1. Pick a stable **catalog key** that describes the slot, not the product (e.g. `Equity-EM-SmallCap`, `FixedIncome-EM-USD`).
2. Add an `ETFRecord` literal inside the relevant comment block in `src/lib/etfs.ts`. Fill every field, including at least one entry under `listings` and a corresponding `defaultExchange`.
3. If the new slot is reachable through a *new* asset-class/region combination, extend `lookupKey` so the engine routes that bucket to your key.
4. Add a sanity test in `tests/engine.test.ts` (use one of the existing ETF-resolution tests as a template) covering: (a) the slot resolves under the expected inputs, (b) `pickListing` returns the right ticker for every supported preferred exchange, (c) hedging / synthetic fallbacks behave as intended.
5. Run `pnpm --filter @workspace/investment-lab run typecheck` and `… run test` — both must pass.
6. Update §4.7.2 (catalog table) and §11 (changelog) in this document. The maintenance rule is enforced by review.

### 4.8 Narrative output

`buildPortfolio` also returns:

- `rationale` — bullet points justifying the split (EN/DE).
- `risks` — drawdown, currency, volatility, inflation warnings as applicable.
- `learning` — up to 3 didactic notes adapted to the inputs (horizon, equity %, satellites, etc.).

### 4.9 Helper

`computeNaturalBucketCount(input)` re-runs the engine with `numETFs = 15` to count how many distinct buckets the user's inputs would naturally produce. The Build form uses this to surface a warning + suggested Min/Max range when the user's range is too tight.

### 4.10 Manual ETF weight overrides (`src/lib/manualWeights.ts`)

Users can pin individual rows of the Build-tab Implementation table to a custom weight. The override is applied **inside the engine**, after the natural allocation is computed but before the look-through, metrics, stress-test and Monte Carlo modules run, so every downstream view uses the exact post-override weights the table displays.

- **Storage.** Pinned weights live in `localStorage` under the key `investment-lab.manualWeights.v1` as a flat `Record<string, number>` keyed by `bucket = "${assetClass} - ${region}"` (the same string the engine already produces). They survive reloads, language switches and any change of the form inputs. The Build tab keeps a single global "how I prefer to see my live portfolio" set in this slot, while the Compare tab carries one snapshot **per slot** (A and B) so the two sides can hold different overrides at the same time without leaking. Saved portfolios additionally snapshot the active set onto the `SavedScenario.manualWeights` field, so loading a saved entry into Build, Compare A, or Compare B reproduces the exact allocation the user saved (Task #24); see §4.10.1 below for the snapshot contract.
- **Engine application.** `buildPortfolio(input, lang, manualWeights?)` calls `applyManualWeights(naturalRows, overrides)` after the bucket allocation is finalised:
  1. Each pinned row keeps the user's typed weight (clamped to `[0, 100]`, rounded to one decimal).
  2. Non-pinned rows are scaled proportionally by `(100 - sum_pinned) / sum_natural_non_pinned` so the portfolio still sums to exactly 100%.
  3. If `sum_pinned ≥ 100` (saturated), pinned rows are scaled **down** proportionally so they sum to 100 and non-pinned rows are zeroed; the UI shows a destructive-variant warning explaining the displayed values were rescaled.
  4. If every row is pinned and `sum_pinned < 100`, pinned rows are scaled **up** proportionally to fill 100.
  5. Rounding drift after one-decimal rounding is absorbed by the largest non-pinned row (or the largest pinned row when no non-pinned rows exist).
  Each affected row is marked `isManualOverride = true` on both `AssetAllocation` and `ETFImplementation`.
- **Stale overrides.** Entries whose bucket is not in the current allocation (e.g. a Crypto override after the user disables `includeCrypto`) are kept untouched in storage and re-apply automatically when the bucket reappears. The UI surfaces their count in a small note above the table so the user knows they are still parked there.
- **UI.** In `BuildPortfolio.tsx` the weight column of the Implementation table is rendered by the `ManualWeightCell` sub-component: an inline numeric `<Input>` (`step=0.1`, `min=0`, `max=100`) bound to the override on commit (Enter or blur). Pinned rows show a `Custom` / `Manuell` badge next to the asset class and a small `×` reset button next to the input. Above the table, a banner reports the number of active overrides with a global `Reset all` button; saturated and stale states get their own alerts. Engine rebuilds are triggered by a `useEffect` on `manualWeights` that re-calls `buildPortfolio` whenever storage changes, including from the "storage" event (cross-tab sync).

The behaviour is unit-tested in `tests/engine.test.ts` (see the `manualWeights.applyManualWeights` describe block: 10 cases covering the no-override, single-pin, multi-pin, saturated `> 100`, exactly-100, stale-bucket, zero-override, clamp, all-pinned-undershoot and rounding-drift paths, plus an end-to-end test asserting `buildPortfolio` honours the overrides and `etfImplementation` mirrors the flag).

### 4.10.1 Custom-weights snapshot on saved portfolios (Task #24)

Saved portfolios carry an optional snapshot of the user's custom (pinned) ETF weights so that loading a saved entry — into Build, Compare A, or Compare B — reproduces the exact allocation the user saved. The snapshot is a contract change on `SavedScenario`; the engine itself is unchanged.

- **Shape.** `SavedScenario` gains an optional `manualWeights?: ManualWeights` field (`Record<string, number>` keyed by `bucket`). `saveScenario(name, input, manualWeights?)` only attaches the field when the user has at least one pinned row, so a clean save stays clean and pre-Task-#24 saves remain valid (loading them produces the natural allocation, exactly as before).
- **Save behaviour.** From the Build tab, `SavedScenariosUI` snapshots the live `manualWeights` state via the new `getCurrentManualWeights` prop. From the Compare tab, the snapshot saved alongside `Save Portfolio A` / `Save Portfolio B` is the per-slot snapshot currently associated with that side (`getSnapshotA` / `getSnapshotB`). A side that was filled in by hand (no saved entry loaded into it) has no snapshot and saves clean.
- **Load behaviour.**
  - **Build:** loading a scenario resets the form **and** rewrites the global `localStorage` overrides — `clearAllManualWeights()` first, then one `setManualWeight(bucket, w)` per snapshot entry, so the `subscribeManualWeights` listener re-syncs the local state and the [`manualWeights`] effect re-runs `buildPortfolio` with the snapshot. A scenario without a snapshot clears the active overrides so the load is a clean restore.
  - **Compare:** loading into A or B replaces only that slot's local snapshot state (`manualWeightsA` / `manualWeightsB`); the other slot is untouched. The next click on `Compare Portfolios` calls `buildPortfolio(parsedA, "en", manualWeightsA)` and `buildPortfolio(parsedB, "en", manualWeightsB)` so each side's pinned values and `Custom` badges show up just like in Build today, without leaking across sides.
- **Out of scope.** The Compare tab still has no UI to author custom weights directly inside A or B — they are authored in Build and travel via save / load. The engine signature is unchanged: `buildPortfolio(input, lang, manualWeights?)` still treats `undefined` and `{}` as "no overrides".
- **Tests.** `tests/engine.test.ts` adds the `savedScenarios — manual-weights snapshot round-trips through buildPortfolio` describe block (3 cases): (i) snapshot-load equals direct overrides on the same allocation; (ii) `undefined` / `{}` snapshots produce the natural allocation (back-compat); (iii) two independent slot snapshots applied to the same input do not contaminate each other and both still sum to 100.

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

### 5.1 Validation Rules (`validation.ts`)

`runValidation(input, lang)` returns `{ errors, warnings, isValid }`. Errors block portfolio construction; warnings are advisory and do not block.

**Errors (block build)**

| Condition | Message |
|-----------|---------|
| `targetEquityPct > cap + 15` (cap = Low 40 / Moderate 70 / High 90 / Very High 100) | Target equity significantly exceeds the typical maximum for the chosen risk profile. |
| `numETFsMin < 3`, `> 15`, or `> numETFs` | Invalid ETF range. |
| `numETFs < 3` or `> 15` | Invalid number of ETFs. |
| `horizon < 1` | Investment horizon too short. |

**Warnings (advisory)**

| Condition | Message |
|-----------|---------|
| `riskAppetite = Low` AND `targetEquityPct > 30` | Equity allocation slightly high for "Low" risk. |
| `riskAppetite = Very High` AND `horizon < 10` | Short horizon combined with "Very High" risk. |
| `riskAppetite = High` AND `horizon < 5` | Short horizon combined with "High" risk. |
| `horizon < 3` AND `targetEquityPct > 50` | High equity allocation for a short horizon (Horizon Risk). |
| `includeCrypto` AND `riskAppetite = Low` | Cryptocurrency inclusion contradicts "Low" risk profile. |
| `effectiveCount > 10` (where `effectiveCount = min(naturalBuckets, numETFs)`) | High complexity (Complexity Risk). **Suppressed in the Compare tab** because the ETF cap is not user-adjustable there. |
| `numETFs ≤ 4` AND any of (`includeCrypto`, `thematicPreference ≠ None`, `includeListedRealEstate`) | Not enough sleeves to express your selections. |

All messages and suggestions are localised (EN/DE). The `lang` parameter defaults to `"en"`; `BuildPortfolio` and `ComparePortfolios` pass the active UI language.

---

### 5.2 Data Refresh Pipeline (snapshot build)

The app stays **frontend-only at runtime**. Reference data is refreshed via a **weekly** snapshot build that bakes the latest values into the bundle — the user's browser never makes a live API call.

**Source.** [justETF](https://www.justetf.com) public ETF profile pages.

**Components.**

| File | Role |
|------|------|
| `scripts/refresh-justetf.mjs` | Node script. Reads every ISIN from `src/lib/etfs.ts`, fetches its justETF profile, extracts the fields listed in `EXTRACTORS` (currently `terBps`, `aumMillionsEUR`, `inceptionDate`, `distribution`, `replication` — each with EN + DE label fallback), and writes them to the snapshot file. Polite (1.5 s delay between requests), descriptive `User-Agent`, sanity-bounded (rejects TER outside `(0%, 3%]`, AUM outside `[1, 1_000_000]` EUR-millions, inception years outside `[1990, currentYear+1]`), exits non-zero if more than half the ISINs fail. Supports `DRY_RUN=1` and a positional ISIN allow-list. |
| `src/data/etfs.overrides.json` | Snapshot file. ISIN-keyed partial `ETFRecord` patches with a `_meta.lastRefreshed` timestamp. Empty by default; populated by the script. |
| `src/lib/etfs.ts` (override layer) | At module load, shallow-merges every override into the matching `CATALOG[isin]` entry. Empty file ⇒ no-op ⇒ engine and tests behave exactly as before. |
| `.github/workflows/refresh-data.yml` | GitHub Action. Runs the script **weekly on Sundays at 03:00 UTC** (cron `0 3 * * 0`, also `workflow_dispatch`), runs `typecheck` + `test` against the new snapshot, commits the diff directly to the default branch if any. |

**Refreshed fields.**

- `terBps` — Total Expense Ratio in basis points (sanity guard: `(0%, 3%]`).
- `aumMillionsEUR` — Fund size in millions of EUR. USD-quoted entries are ignored to keep the unit consistent (sanity guard: `[1, 1_000_000]`).
- `inceptionDate` — Inception date as ISO `YYYY-MM-DD` (sanity guard: year in `[1990, currentYear+1]`).
- `distribution` — `"Accumulating"` or `"Distributing"` (mapped from EN/DE wording: Distributing/Accumulating/Capitalisation, Ausschüttend/Thesaurierend).
- `replication` — `"Physical"`, `"Physical (sampled)"` or `"Synthetic"` (mapped from EN/DE wording: Physical / Physical (Sampling) / Synthetic, Physisch / Physisch (Sampling) / Synthetisch).

Adding more is a two-step change: add an entry to the `EXTRACTORS` map of `scripts/refresh-justetf.mjs` (with EN + DE label fallbacks) **and** widen the `Pick<>` of `ETFOverride` in `src/lib/etfs.ts` so the type system permits the new field on disk.

**What stays curated by hand** (not touched by the snapshot): `listings`, `defaultExchange`, `comment`, every look-through profile in `lookthrough.ts` (reference date Q4 2024), all CMAs in `metrics.ts`, all stress scenarios in `scenarios.ts`. These are stable, editorial decisions and changing them automatically would defeat the determinism guarantee. Note: `distribution` and `replication` were curated-only until 2026-04-24 — they are now also refreshed by the script (the on-disk override patches the in-code default; if no override is written for a field the curated value still wins).

**Local usage.**

```bash
# from artifacts/investment-lab/
node scripts/refresh-justetf.mjs                 # refresh everything
node scripts/refresh-justetf.mjs IE00B5BMR087    # one ISIN only
DRY_RUN=1 node scripts/refresh-justetf.mjs       # parse & log, do not write
```

**Edit before deploying to your fork.** Update the `User-Agent` string in `scripts/refresh-justetf.mjs` to point at your own contact address; justETF asks scrapers to identify themselves.

---

### 5.3 Capital Market Assumptions — consensus & user overrides

The CMA table in `src/lib/metrics.ts` (`CMA_SEED`, the historical engine fallback) is the deepest assumption in the entire app. Every metric — Sharpe, alpha/beta, frontier, Monte Carlo, drawdown estimate — depends on the μ/σ values per asset class. To keep the engine deterministic but the assumptions transparent and adjustable, three layers are stacked at module load:

| Priority | Layer | Source | Editable by |
|----|----|----|----|
| 1 (highest) | **User overrides** | `localStorage["idl.cmaOverrides"]` | End user, via the editable table in the Methodology tab |
| 2 | **Multi-provider consensus** | `src/data/cmas.consensus.json` (committed) | Maintainer (yearly) |
| 3 (fallback) | **Engine seed** | `CMA_SEED` constant in `metrics.ts` | Developer (code change) |

`applyCMALayers()` in `metrics.ts` re-applies the three layers in order and mutates the leaf objects of the exported `CMA` record in place — every existing caller (`CMA[k].expReturn`, `CMA[k].vol`) keeps working without changes. It is called once at module load and again whenever the user dispatches a CMA-change event from the Methodology editor.

**Layer 2 — multi-provider consensus (Option A).** `cmas.consensus.json` ships empty by default (engine falls back to seed values). The maintainer fills it once a year by reading the publicly published Long-Term Capital Market Assumptions of major asset managers and computing the per-asset-class mean. Recommended source set:

| Provider | Document | Cadence |
|----|----|----|
| BlackRock Investment Institute | Capital Market Assumptions | Quarterly (use latest of the year) |
| J.P. Morgan Asset Management | Long-Term Capital Market Assumptions | Annual (October) |
| Vanguard | Vanguard Capital Markets Model — Investment Outlook | Annual + monthly updates |
| Schroders | 30-Year Return Forecasts | Annual |
| Robeco | Expected Returns 5-Year Outlook | Annual |
| BNY Mellon | 10-Year Capital Market Assumptions | Annual |
| Invesco | Long-Term Capital Market Assumptions | Annual |

JSON shape:

```json
{
  "_meta": { "lastReviewed": "2026-Q1", "providers": ["BlackRock 2026", "JPM 2026", "Vanguard 2026", "Schroders 2026", "Robeco 2026"] },
  "assets": {
    "equity_us": {
      "consensus": { "expReturn": 0.068, "vol": 0.165, "n": 5 },
      "providers": {
        "BlackRock 2026": { "expReturn": 0.063, "vol": 0.168, "asOf": "2025-Q4" },
        "JPM 2026":       { "expReturn": 0.072, "vol": 0.163, "asOf": "2025-09" }
      }
    }
  }
}
```

Only `consensus.expReturn` and `consensus.vol` are read by the engine; `providers` and `asOf` exist for traceability and may be surfaced in the Methodology UI later. Asset keys must match the `AssetKey` union (`equity_us`, `equity_eu`, `equity_ch`, `equity_jp`, `equity_em`, `equity_thematic`, `bonds`, `cash`, `gold`, `reits`, `crypto`).

**Why manual and not scraped.** Each provider publishes their CMAs in a different format (PDF, HTML article, sometimes Excel) and frequently restructures their layout. A scraper would either break silently within a year or produce incorrect numbers. Since CMAs change only once a year, a 30-minute manual update by the maintainer is more reliable than 200 lines of brittle PDF extraction.

**Layer 1 — user overrides (Option B).** The Methodology tab exposes an editable table where the user can type custom μ and σ per asset class. Empty cells fall through to the consensus or seed value. On **Apply**, the values are persisted to `localStorage` under `idl.cmaOverrides` and broadcast via the `idl-cma-changed` custom event. `PortfolioMetrics` and `MonteCarloSimulation` subscribe via `subscribeCMAOverrides`, call `applyCMALayers()` to refresh the in-memory `CMA` record, and re-run `useMemo` so the metrics block (Sharpe, alpha/beta, frontier, drawdown) and the Monte Carlo simulation (`runMonteCarlo` reads μ/σ directly from `CMA` after the refactor) immediately reflect the new assumptions. **Reset** wipes overrides and restores the consensus/seed values.

**What is *not* affected by CMA overrides** (intentional separation):

- **Stress test scenarios** (`scenarios.ts`) — these are *historical-style return shocks* per asset bucket (e.g. 2008 GFC: equity_usa = -45%, bonds = +6%), not μ/σ assumptions. They live independently so a user can keep mainstream CMAs but still stress against a tail event. Add new scenarios in `scenarios.ts` directly.
- **Portfolio construction** (`portfolio.ts → buildPortfolio`) — uses CMA at construction time (Sharpe overlay in `computeEquityRegionWeights`), so a *fresh* portfolio built after overrides have been set will reflect them. Already-built portfolios are not retro-rebuilt; the user must hit "Generate Portfolio" again to redraw. This is by design — building is an explicit user action.
- **Validation rules** (`validation.ts`) — risk caps and horizon thresholds are independent of expected returns.

Source badges in the UI (`Custom` / `Consensus` / `Engine`) make the active source explicit per asset and per μ/σ field, so the user can always see which assumption is currently driving the numbers.

**Validation bounds.** μ is clamped to `[-50%, +100%]` p.a., σ to `[0%, 200%]` p.a. — these are sanity bounds, not realism bounds. The Methodology UI does not warn for unusual values; the user is assumed to know what they are doing when overriding house assumptions.

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
| `idl.riskFreeRates` | `settings.ts` | Per-base-currency user-editable risk-free rates (`USD\|EUR\|GBP\|CHF` → number, range `[0, 0.20]`); sanitized on read (currency whitelist + value clamp). The legacy single-rate key `idl.riskFreeRate` is removed on module load (no value migration). |
| `idl.cmaOverrides` | `settings.ts` | Per-asset-class μ/σ overrides set in the Methodology tab; sanitized on read (key whitelist + value bounds). |
| `idl.homeBiasOverrides` | `settings.ts` | Per-base-currency home-bias multipliers (`USD\|EUR\|GBP\|CHF` → number, range `[0, 5]`); sanitized on read (currency whitelist + value clamp). Read by `computeEquityRegionWeights` at portfolio-build time via `resolvedHomeBias()`. |
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

### 2026-04-26 (per-base-currency-risk-free-rates — Task #32)
- **The single global risk-free rate is replaced by four independent per-base-currency RFs (USD `4.25%`, EUR `2.50%`, GBP `4.00%`, CHF `0.50%`).** Sharpe / Sortino / efficient-frontier metrics and the Sharpe-tilt step of equity-region construction now look up the rate that matches the portfolio's `baseCurrency`, so a CHF investor no longer sees their Sharpe ratio computed against a USD-style RF.
  - **`src/lib/settings.ts`** rewritten around a per-currency API: `RFCurrency`, `RF_DEFAULTS` (the four numbers above), `getRiskFreeRates()`, `getRiskFreeRateOverrides()`, `getRiskFreeRate(ccy)`, `setRiskFreeRate(ccy, rate)`, `resetRiskFreeRate(ccy)`, `resetAllRiskFreeRates()`, `subscribeRiskFreeRate(cb)`. Persistence key changed from `idl.riskFreeRate` (single number) to `idl.riskFreeRates` (object keyed by currency, range-clamped `[0, 0.20]`, unknown keys dropped on read). The legacy key is **removed** from `localStorage` on module load — no value migration (deliberate: the old single value would be wrong for at least three of the four base currencies).
  - **`src/lib/metrics.ts`** — `computeMetrics(...)` and `computeFrontier(...)` now take a required `baseCurrency` argument and resolve their RF via `getRiskFreeRate(baseCurrency)` instead of the old global getter.
  - **`src/lib/portfolio.ts`** — `computeEquityRegionWeights` now reads `getRiskFreeRate(input.baseCurrency)` once per build for the `(Sharpe / 0.25)^0.4` damped tilt; the dead path that used a single global RF is gone.
  - **`PortfolioMetrics.tsx`** takes `baseCurrency` as a prop and threads it into `computeMetrics` / `computeFrontier`. All five call sites in `BuildPortfolio.tsx` and `ComparePortfolios.tsx` updated.
  - **Methodology tab** — RF section is now a 4-row editor table (one input per currency, Default / Custom badge, per-row reset). The Construction overlay table now lists all four RFs inline at their live values. A new known-limitation alert (EN/DE) flags that the CMAs themselves remain currency-nominal — only the RF subtraction is base-currency-aware. The editable-overview blurb mentions per-currency defaults.
  - **Tests** — the previous single-RF regression test in `tests/engine.test.ts` was rewritten for the per-currency API; five new tests added: defaults match `RF_DEFAULTS`, cross-currency isolation (setting USD does not move EUR / GBP / CHF), sanitization + clamping of unknown keys and out-of-bounds values, `computeMetrics` Sharpe differs between USD and CHF for the same input portfolio, and the legacy `idl.riskFreeRate` key is wiped from `localStorage` on module load. Suite now at 255 / 255 passing; typecheck clean; both Playwright e2e specs still green.

### 2026-04-26 (construction-rf-unified-with-user-rf)
- **The portfolio engine now uses the user-editable risk-free rate for the Sharpe-tilt step of equity-region construction**, replacing the previously hard-wired `RISK_FREE_FOR_CONSTRUCTION = 0.025` constant in `src/lib/portfolio.ts`. There is now exactly one RF in the system: `getRiskFreeRate()` from `settings.ts` (default 2.50 %, persisted in `localStorage` under `idl.riskFreeRate`).
  - **Before:** Editing the RF in the Methodology tab moved the Sharpe / Alpha / Sortino numbers in the report, but bucket weights stayed fixed because the construction engine used its own constant. Two RFs on screen at once was confusing even with the recently-added clarifying footnote.
  - **After:** RF is now read once per `computeEquityRegionWeights(input)` call (`getRiskFreeRate()`), used in `sharpe = (expReturn − rf) / vol`, and the result feeds the same damped tilt as before (`(Sharpe / 0.25)^0.4`). A user editing RF from 2.5 % → 6 % shifts the equity-region mix on the next "Generate Portfolio" click, in addition to moving the report metrics.
  - **Why this is consistent:** the Methodology tab already names this input "the one input tied to current market conditions". It is now reflected in *both* the report layer and the construction layer, which matches the user's mental model.
  - **Methodology UI updated.** The Construction overlay table row was relabelled from "Reference risk-free rate (construction only) — 2.50 %" to "Risk-free rate (Sharpe tilt) — {live value}". The footnote now reads "Uses the same editable RF as report metrics. Changing it shifts the bucket weights on the next 'Generate Portfolio' click." (EN/DE). The dead constant `RISK_FREE_FOR_CONSTRUCTION` was removed from `portfolio.ts`; the header comment block in that file documents the new behaviour.
  - **Regression test added** (`tests/engine.test.ts`, "risk-free rate override: changing RF shifts equity bucket weights; reset restores baseline"). Builds a baseline portfolio at default RF, raises RF to 6 % via `setRiskFreeRate`, asserts that USA + EM equity-region weights together move by > 0.5 percentage points, then resets RF and asserts the baseline is restored within 0.01 pp. Suite now at 255 / 255 passing; typecheck clean.

### 2026-04-26 (methodology-redundancy-cleanup)
- **Methodology tab — copy/text de-duplication, no behaviour change.** Audit of `Methodology.tsx` surfaced several spots where the same fact was repeated 2–4 times across sections. Cleaned up so each fact lives in one canonical place; cross-references replace duplicated content. No engine, settings, or data changes.
  - Portfolio-volatility formula `σₚ = √(ΣΣ wᵢwⱼσᵢσⱼρᵢⱼ)` was inlined in 4 places (CMA "where used", Correlation "where used", Monte-Carlo bullet, Formulas section). Now lives only in the Formulas section; the other three carry a one-line cross-reference.
  - "Sharpe / Beta / Alpha / Tracking Error" enumeration appeared in both the CMA and Correlation "where used" callouts in nearly identical wording. Consolidated to a single concise mention in the CMA callout, with the Correlation callout focusing on what the matrix uniquely drives (off-diagonal diversification effect on σₚ).
  - FX-hedging `σ`-reduction explanation appeared in three sections (CMA callout, Correlation "NICHT-antreibt" list, dedicated Hedging section). Hedging section is the canonical source; the other two now just point to it.
  - Construction overlay constants (Home-Bias defaults, EM × 1.3, Sustainability × 0.85, cap 65 %) were duplicated in both prose and the constants table directly below. Prose now describes the *concept* of each tilt; the table holds the values.
  - "Stored locally in your browser (localStorage)" sentence was repeated 4× (top editable-overview box, RF tip, Home-Bias editor, ETF override panel). Kept only in the top overview box where it covers all editable inputs at once.
  - "Live editierbar / live editable" header text was repeated on top of inline editor blocks even though the section header already carries an Editable badge. Removed from inline blocks.
  - "Last reviewed Q2 2026" appeared in both the page-header badge and the ETF section's "Last editorial review" line. Kept only the header badge; the constant `LAST_REVIEWED` still drives that single label.
  - Construction section title trimmed from "Portfolio-Konstruktion (regelbasiert, nicht starr)" to "Portfolio-Konstruktion" (the rule-based-not-AI message is already carried by the two top alerts and the "What this app does NOT do" section).
  - **Clarification, not removal:** the Construction overlay table row "Reference risk-free rate (construction only) 2.50 %" stays — it correctly discloses that `RISK_FREE_FOR_CONSTRUCTION = 0.025` in `portfolio.ts` is independent of the user's editable RF (which only affects report metrics). Added a small footnote under the row label so users no longer have to dig into the source to see why two different RF values can be on screen at once.
  - All 254 unit tests still green; typecheck clean. Pure copy edit — no formulas, constants, settings or persistence keys touched.

### 2026-04-24 (comma-decimal-sweep)
- **Locale-comma decimals now accepted across every decimal numeric input — the same mobile-keyboard fix from Task #12 (manual ETF weight cell) extended to the rest of the app.** A user on a Swiss / German / French phone keypad who typed `100000,50` into Investment Amount, or `12,5` into a position weight, used to silently get an empty field because `<input type="number">` strips comma decimals on mobile. The fix generalises the existing parser:
  - `src/lib/manualWeights.ts` now exports a public `parseDecimalInput(raw, { min?, max?, decimals? })` that wraps the same regex / mid-edit semantics (`"12."` → 12, `",5"` → 0.5, garbage → null) and exposes per-callsite bounds. The original `parseManualWeightInput` is now a thin wrapper (`min: 0, max: 100, decimals: 1`) — its public contract and tests are unchanged.
  - **FeeEstimator → Investment Amount** and **MonteCarloSimulation → Investment Amount** were converted from `<Input type="number" value={number}>` to `<Input type="text" inputMode="decimal" value={draftString}>`, with the numeric value derived via `useMemo(() => parseDecimalInput(draft, { min: 0 }) ?? 0)`. The engine still runs in real time; null falls back to 0 while the user is mid-edit.
  - **ExplainPortfolio positions table → Weight %** cell is now `type="text" inputMode="decimal"` (react-hook-form retains whatever the user types). The submit handler now routes each position weight through `parseDecimalInput(String(p.weight), { min: 0, max: 100, decimals: 2 })` instead of the bare `Number(p.weight)`.
- **Audit (kept as `<input type="number">` on purpose)** — documented in the parser's header comment in `src/lib/manualWeights.ts`:
  - BuildPortfolio "Horizon (Years)" (1–40, integer; desktop spinner useful)
  - BuildPortfolio "Target Equity Allocation" (0–100, slider step=1, integer)
  - BuildPortfolio "Number of ETFs Min / Max" (3–15, integer)
  - ComparePortfolios mirrors of the three above (same rationale)
  - Methodology editors (CMA μ/σ, home-bias, risk-free rate) — admin-only, outside the build/explain hot path; tracked as a separate sweep. **(Swept in by Task #19 — see entry below.)**
- **Tests.** Added a new `manualWeights.parseDecimalInput` describe block to `tests/engine.test.ts` (8 cases: dot/comma equivalence, no-clamp behaviour, min clamp, max clamp, decimal rounding, garbage rejection, mid-edit partial decimals, and an equivalence assertion that `parseManualWeightInput` matches `parseDecimalInput({min:0,max:100,decimals:1})` so Task #12's contract did not regress). Suite now at 177 / 177 passing; typecheck clean.

### 2026-04-24 (manual-weights, exactly-100 quiet — Task #22)
- **The destructive red "Manual weights sum to … at or above 100%" alert in the ETF Implementation section no longer fires when the user's pinned weights sum to exactly 100%.** Previously the warning gated on `pinnedSum >= 100`, which fired in the benign case where the manual weights already total 100 (no scaling happens — pinned rows stay as typed and non-pinned rows correctly go to 0). It also tripped spuriously on float drift like 99.9999998% from accumulated 0.1-step inputs. The fix:
  - In `src/lib/manualWeights.ts`, the `ApplyResult` now exposes two flags. `saturated: boolean` keeps its old meaning (pinned rows fill the budget so non-pinned rows go to 0 — true at and above 100). `over: boolean` is the new flag and is true *only* when the sum is strictly above 100 (within a `MANUAL_WEIGHTS_SUM_EPSILON = 1e-6` tolerance), i.e. when pinned rows actually had to be scaled down. The internal branches were split: at exactly 100% pinned values are written through with no scaling (the math used to be a no-op `* 100/100` anyway); above 100% the existing proportional scale-down still runs.
  - `BuildPortfolio.tsx` now imports `MANUAL_WEIGHTS_SUM_EPSILON` and computes its local gate as `pinnedSum > 100 + MANUAL_WEIGHTS_SUM_EPSILON` instead of `>= 100`. The destructive alert only renders in the `over` case; the informational "manual overrides active" banner and the reset-all button are unchanged.
  - The `build.impl.manual.warnSaturated` strings now read "above 100%" (EN) / "über 100%" (DE) instead of "at or above 100%" / "≥ 100%", so when the warning does fire the wording matches what the code now does.
- **Tests.** Updated the existing "scales pinned rows down proportionally when their sum >= 100" case to assert both `saturated` and `over` are true, and renamed the >= comment to "strictly above". Updated the existing "treats sum exactly 100 as saturated" case to assert `over === false` and that pinned values are kept exactly as typed (70 / 30, not just close to). Added a new "just-above-100 (110)" case asserting `over === true` and proportional scale-down. Added a new "near-exact-100 sum (float drift like 33.1 + 33.2 + 33.7)" case asserting `over === false` and that pinned values are still kept as-is — guarding the epsilon tolerance against future regressions. Suite now at 210 / 210 passing; typecheck clean.

### 2026-04-24 (comma-decimal-sweep, Methodology follow-on — Task #19)
- **Comma-decimal fix extended to the Methodology tab's four numeric editors** so a user on a Swiss / German / French phone keypad who types `2,5` for the risk-free rate, `1,2` for a home-bias multiplier, or `0,5` for a CMA μ/σ override no longer hits the silent-empty-field bug. The four editors — Risk-Free Rate (`#rf-input`), Home-Bias multipliers (`#hb-USD` … `#hb-CHF`), CMA μ override (`data-testid="cma-mu-{key}"`) and CMA σ override (`data-testid="cma-sigma-{key}"`) — were converted from `<Input type="number" step="…">` to `<Input type="text" inputMode="decimal">`. Their three apply handlers (`applyRf`, `applyHbDraft`, `applyCmaDraft`) now route the draft string through the existing shared `parseDecimalInput` from `src/lib/manualWeights.ts` instead of `parseFloat(raw.replace(",", "."))`, so empty / garbage / mid-edit partial decimals (`"2,"`, `",5"`) follow the same null-vs-finite contract as the other tabs. The audit comment in `manualWeights.ts` now lists these four under "FIXED" so future contributors see the full sweep at a glance. No new tests required: the parser is already covered by the 8 cases added in the previous changelog entry.

### 2026-04-24 (night, canonical-order)
- **Asset-class display order is now fixed: Cash → Bonds → Equities → Commodities → REITs → Crypto.** Previously the `allocation` and `etfImplementation` rows were sorted strictly by weight descending, which moved bonds above or below equities depending on risk profile and shuffled the satellites depending on the user's pinned weights. A small `sortAllocationCanonical` helper in `src/lib/portfolio.ts` (rank table `Cash:0, Fixed Income:1, Equity:2, Commodities:3, Real Estate:4, Digital Assets:5`) now drives the order both immediately after the natural allocation is built (replacing the line `allocation.sort((a, b) => b.weight - a.weight)`) and again after the manual-override reducer in §4.10 has re-shaped the weights. Within a class the tiebreaker is still weight descending so equity sub-rows (USA / Europe / Switzerland / Japan / EM / Thematic) remain ordered by size. New §4.6.1 documents the rule. One regression test added (`buildPortfolio — invariants → asset classes are sorted in canonical order …`) that exercises a maximum-diversity input (all satellites = Yes, horizon 15) and asserts both the cross-class rank monotonicity and the intra-class weight-desc tiebreaker, plus the same monotonicity on `etfImplementation`. Suite at 113 / 113 passing; typecheck clean. No engine math changed; only row order.

### 2026-04-24 (night, manual-weights)
- **Manual ETF weight overrides on the Build tab.** Each row of the Implementation table now exposes an inline numeric input (`step=0.1`, `[0, 100]`); pinning a value writes it to a new `localStorage` slot (`investment-lab.manualWeights.v1`) keyed by bucket (`"${assetClass} - ${region}"`), persists across reloads / language switches / setting changes, and is applied **inside** `buildPortfolio` so look-through, metrics, stress-test and Monte Carlo all use the post-override weights. Pinned rows get a `Custom` / `Manuell` badge plus a small `×` reset button; a summary banner above the table shows the active count and a `Reset all` button. Two further alerts cover the edge cases: a destructive-variant warning when pinned weights sum to ≥ 100% (engine scales pinned down proportionally and zeroes non-pinned to keep the total at 100), and an info alert listing how many stored overrides do not match any current bucket (stale entries are kept and re-apply when the bucket reappears). The engine layer is a new pure module `src/lib/manualWeights.ts` with `loadManualWeights` / `setManualWeight` / `clearManualWeight` / `clearAllManualWeights` / `subscribeManualWeights` (custom event + cross-tab `storage` sync) and the pure `applyManualWeights(naturalRows, overrides)` reducer that handles redistribution, saturation, all-pinned-undershoot and one-decimal rounding-drift fixup. `AssetAllocation` and `ETFImplementation` gained an optional `isManualOverride?: boolean` flag and `buildPortfolio(input, lang, manualWeights?)` now takes the overrides as an optional third argument; `BuildPortfolio.tsx` reads them from storage on mount, subscribes to changes, and passes them in both call sites (initial submit + lang-rebuild effect). The Compare tab's `buildPortfolio` calls do **not** pass overrides, so A-vs-B comparisons stay on the natural allocation. Bilingual (EN + DE) strings added for badge, banner copy, reset, edit / reset titles, saturated and stale warnings. Documentation: new §4.10 "Manual ETF weight overrides" with the full storage / engine / UI contract. Tests: 10 new unit tests on `applyManualWeights` covering no-override, single-pin, multi-pin, saturated `> 100`, exactly-100, stale-bucket, zero-override, clamp, all-pinned-undershoot and rounding-drift cases, plus an end-to-end `buildPortfolio` regression that asserts the override is honoured on both the allocation and the implementation table — full suite green.

### 2026-04-24 (night, refresh-weekly)
- **justETF snapshot refresh moved from daily to weekly, and four more fields are now refreshed.** `.github/workflows/refresh-data.yml` now runs on cron `0 3 * * 0` (Sundays 03:00 UTC) instead of `0 3 * * *` — weekly cadence, with `workflow_dispatch` still available for ad-hoc runs from the Actions tab. The commit message in the workflow changed from `nightly` to `weekly`. The `EXTRACTORS` map in `scripts/refresh-justetf.mjs` was extended from a single field to five: `terBps` (existing), `aumMillionsEUR`, `inceptionDate`, `distribution`, `replication`. Each extractor accepts both English and German label variants of the justETF profile page (Total expense ratio / Gesamtkostenquote, Fund size / Fondsgröße, Inception / Auflagedatum, Distribution policy / Ertragsverwendung, Replication / Replikationsmethode), and each one is sanity-bounded (TER `(0%, 3%]`, AUM `[1, 1_000_000]` EUR-millions with USD entries deliberately rejected to keep the unit consistent, inception year `[1990, currentYear+1]`, distribution and replication mapped onto our two- / three-value enums). A small shared `parseDateLoose` helper handles the `12 May 2010` / `12. Mai 2010` / `12.05.2010` / ISO date forms justETF prints. `ETFRecord` and `ETFDetails` in `src/lib/etfs.ts` gained two new optional fields (`aumMillionsEUR?: number`, `inceptionDate?: string`); `getETFDetails` now threads them through to the UI; the `ETFOverride` `Pick<>` was widened to admit all five refreshable fields plus the existing `terBps`/`name`/`domicile`/`currency`. The Methodology "Data Refresh & Freshness" section text now reads "weekly, Sundays at 03:00 UTC" / "wöchentlich, sonntags 03:00 UTC" in both languages, the "Refreshed fields" line lists all five fields, and the "Curated by hand" list was shrunk accordingly (distribution and replication moved from curated-only to refreshed-with-curated-fallback). `scripts/README.md`, the JSON snapshot's `_meta.note`, and DOCUMENTATION §4.7.1 / §4.7.6 / §5.2 were updated in lockstep. No engine math changed; existing snapshot still only carries `terBps` overrides so behaviour is identical until the next Sunday refresh; suite at 101 / 101 passing, typecheck clean.

### 2026-04-24 (night, corr-share)
- **The "held" markers on the correlation matrix are now also shown on the Methodology tab**, so they no longer disappear when the user navigates away from the Build tab. Implementation: a new in-memory pub/sub slot in `src/lib/settings.ts` (`setLastAllocation` / `getLastAllocation` / `subscribeLastAllocation`, event `idl-last-allocation-changed`) is published from `BuildPortfolio` whenever its `output` state transitions (built, language re-build, validation failure → null, reset → null), and consumed by the Methodology tab's correlation-matrix Section. The publish is centralised in a single `useEffect([output])` so there is exactly one source of truth and no duplicate events; the lang-rebuild effect simply calls `setOutput(next)` and lets the [output] effect re-publish. The reset button explicitly clears `output`/`validation`/`hasGenerated` so the Methodology held markers are removed immediately when the user resets the Build form. When a portfolio is currently built, the Methodology matrix uses the user's actual `output.allocation` and applies the same bold-row + dot-marker + dimmed-row treatment as `PortfolioMetrics`; when no portfolio has been built yet, it falls back to the BENCHMARK (equity-only ACWI proxy) and renders without held markers, with a small hint line under the table telling the reader to build a portfolio in the Build tab to see holdings highlighted. Storage is intentionally **in-memory only** (not localStorage) so the Methodology reference matrix doesn't show stale "held" markers from a previous browser session. `setLastAllocation` deep-copies item objects on write and `getLastAllocation` deep-copies on read, so external consumers cannot mutate the internal in-memory store by reference. EN+DE legend strings are inline. No engine math changed; suite is 101 / 101 passing (1 new regression test: round-trip publish/get/subscribe, clone-on-set, null/[] both clear, unsubscribe stops further callbacks).

### 2026-04-24 (night, corr)
- **Correlation matrix in the Metrics card now always shows the full 11×11 reference grid** (US / Europe / Switzerland / Japan / EM / Thematic equities, Bonds, Cash, Gold, Listed Real Estate, Crypto), regardless of which asset classes are actually held in the current portfolio. Previously the matrix only rendered rows/columns for assets with weight > 0, so a 100 %-equity portfolio (or any portfolio without bonds/gold/REITs/crypto satellites) showed only equity rows even though the underlying correlation table covers all eleven keys. The asset classes actually present in the user's portfolio are now visually marked: bold text and a small primary-color dot in the row label, with non-held rows dimmed to ~60 % opacity. A new legend line under the table explains the marker. Display order is fixed: equities (developed → EM → thematic) → Bonds & Cash → Gold/REITs/Crypto. `buildCorrelationMatrix` now returns `{ keys, labels, matrix, held }` (added `keys` and `held` arrays). Two new regression tests assert (a) the matrix is always 11×11 even for a 100 %-equity input, with `held=false` for bonds/gold/reits/crypto and the off-diagonal correlations still populated, and (b) `held=true` is set for every asset class that the engine actually included. EN + DE strings updated (`metrics.corr.desc` reworded; new `metrics.corr.heldLegend` key added). No engine math changed.

### 2026-04-24 (night, doc)
- **Documented the full ETF logic and selection mechanism in §4.7.** Section 4.7 was expanded from a four-line paragraph to a comprehensive reference covering: (4.7.1) the `ETFRecord` data model and what every catalog field means; (4.7.2) the entire 22-entry catalog grouped into core equity / hedged share classes / fixed income / satellites / thematic, with key, ETF name, ISIN, TER, default exchange and per-venue tickers (LSE / XETRA / SIX / Euronext); (4.7.3) the `lookupKey` step that maps an abstract `(assetClass, region)` bucket to a catalog slot, including the strict priority order for hedging vs synthetic vs region match and the documented tie-breaker that hedged-physical beats synthetic when both are requested; (4.7.4) the 4-step `pickListing` resolver that picks the exchange/ticker, with an explicit explanation of why Euronext lives in the data but is never user-pickable; (4.7.5) the placeholder/unknown-bucket contract; (4.7.6) the TER override layer keyed by ISIN; (4.7.7) the `ETFImplementation` output shape; (4.7.8) what is intentionally NOT in the selection logic (no provider rotation, no live data, no liquidity ranking); (4.7.9) a step-by-step "how to add or swap an ETF" recipe for contributors. No code change, no test change.

### 2026-04-24 (night)
- **Removed "Euronext (Amsterdam)" from the Preferred Exchange dropdown — but kept the catalog data and added a last-resort fallback rule.** The Build tab Select now offers only `None (European listings)`, `LSE`, `XETRA`, `SIX`; the user can no longer pick Euronext explicitly. `PreferredExchange` union in `types.ts` is back to `"None" | "LSE" | "XETRA" | "SIX"`; `aiPrompt.ts` `EXCHANGE_LINE` no longer carries Euronext lines (EN/DE); `i18n.tsx` lost `build.preferredExchange.option.euronext` (EN/DE) and the tooltip says "LSE, XETRA or SIX" / "LSE, XETRA oder SIX"; `BuildPortfolio.tsx` Select renders four items only.
- **Catalog still carries the 16 Euronext Amsterdam tickers** (CSPX, EMIM, SPYI, IMAE, SGLD, IWDP, BITC, IUIT, HEAL, INRG, AGGG, AGGH, …) under the `Euronext` entry of each ETF's `listings` map. `ExchangeCode` in `etfs.ts` keeps `"Euronext"` as a valid internal exchange code so this data is type-safe. The `pickListing` resolver now follows a strict 4-step order: (1) honour the user's preferred exchange when listed, (2) use the ETF's `defaultExchange` if it isn't Euronext, (3) try LSE → XETRA → SIX in order, (4) fall back to Euronext **only** when `preferredExchange === "None"` and no other venue lists this ETF (a path no current catalog entry triggers, but available for future Euronext-only additions). Net effect: Euronext is invisible to the user but the canonical Amsterdam tickers stay queryable inside the data layer. New regression test verifies (a) Euronext never wins for any of the existing ETFs at any preferredExchange setting and (b) explicit LSE/XETRA/SIX preferences still resolve correctly. Suite at 98 passing tests. Typecheck clean.

### 2026-04-24 (evening)
- **Methodology page restructured: collapsed-by-default + clear "what is editable" pointer.** All sections in the Methodology tab now live inside a single multi-accordion that opens fully **collapsed** by default (previously "Portfolio Construction" was open and the Risk-Free Rate / Data Refresh blocks were always-expanded standalone cards above the accordion). The Risk-Free Rate editor and the Data Refresh & Freshness reference are now collapsible accordion sections (`value="rf"` and `value="data-refresh"`) — they sit at the top of the accordion. The intro card at the top of the page gained a new highlighted **"Live-editable in this view"** panel (data-testid `editable-overview`) that names the three sections containing live inputs — Risk-Free Rate, Home-Bias Multipliers (inside Portfolio Construction), and Capital Market Assumptions (μ / σ) — so the reader can immediately tell which sections to expand to change runtime values. The local `<Section>` helper accepts a new `editable` / `editableLabel` prop and renders a small pencil-icon **Editable** badge (data-testid `badge-editable-{value}`) right after the section title in the collapsed header, so the same signal also appears next to each editable section's name. Sections marked editable: `rf`, `construction` ("Home-bias editable" / "Home-Bias editierbar"), `cma` ("μ / σ editable" / "μ / σ editierbar"). Read-only sections (`data-refresh`, `corr`, `bench`, `stress`, `mc`, `formulas`, `etfs`, `limits`) carry no badge. EN/DE strings inline. No engine changes; all 98 existing tests still pass and typecheck is clean. E2E verified with the testing agent: page opens fully collapsed, the overview panel lists the three editable areas, the Editable badges show only on the three editable section headers, expanding "Risk-Free Rate" reveals the `rf-input` field + Apply, expanding "Portfolio Construction" reveals the home-bias inputs and Apply.

### 2026-04-24 (later)
- **Live-editable home-bias overlay.** The home-bias multipliers that tilt the equity-region anchor toward the user's home market (USD ×1.0, EUR ×1.5, GBP ×1.5, CHF ×2.5 by default) are no longer hard-coded constants — they are now exposed as a four-input editor in the Methodology tab (range 0.0–5.0 per currency, with Apply / Reset and a "Custom" badge once an override is active). `settings.ts` gained `getHomeBiasOverrides`, `setHomeBiasOverrides`, `resetHomeBiasOverrides`, `subscribeHomeBiasOverrides`, `resolvedHomeBias` and `HOME_BIAS_DEFAULTS`; values persist in `localStorage["idl.homeBiasOverrides"]` and are sanitized on read (currency whitelist + clamp to `[0, 5]`). `computeEquityRegionWeights` in `portfolio.ts` now reads `resolvedHomeBias(input.baseCurrency)` at every build, so changes take effect on the next "Generate Portfolio" click. The Methodology constants table updates live (× value + Custom badge per currency). 2 new tests cover (i) CHF override raises Switzerland equity weight + reset restores the baseline, (ii) `getHomeBiasOverrides` drops unknown currencies and clamps out-of-bounds multipliers.
- **Euronext (Amsterdam) added as 4th preferred exchange.** `PreferredExchange` union extended in `types.ts` with `"Euronext"`; `etfs.ts` `ListingMap` gained an optional `Euronext` slot and 16 major ETFs received their canonical Euronext Amsterdam tickers (e.g. CSPX, EMIM, SPYI, IMAE, SGLD, IWDP, BITC, IUIT, HEAL, INRG, AGGG, AGGH) — Equity-Switzerland and CHF-hedged share-classes are intentionally NOT given Euronext listings (SIX-only / Frankfurt-only). The Build tab Select gained a "Euronext (Amsterdam)" option; the legacy "None" option was relabelled "None (European listings)" to make the engine's behaviour explicit (it picks the most liquid European listing per ETF). `aiPrompt.ts` `EXCHANGE_LINE` got matching EN/DE Euronext lines so the Copy-AI-Prompt feature stays exhaustive. 1 new engine test verifies (i) `preferredExchange="Euronext"` builds without throwing, (ii) CSPX/EMIM/SGLD resolve with `exchange === "Euronext"`, (iii) Switzerland equity gracefully falls back to SIX (CHSPI) since it has no Euronext listing. Suite at 98 cases.
- §8 Persistence updated with the new `idl.homeBiasOverrides` key. §3 input-table now shows `Euronext` in the `preferredExchange` enum.

### 2026-04-24
- **Capital Market Assumptions are now layered: seed → consensus → user.** The CMA table in `metrics.ts` (the deepest assumption in the engine — drives Sharpe, frontier, alpha/beta and Monte Carlo) is no longer a single hard-coded record. It is now a three-layer stack applied at module load, with strict priority: (1) **user overrides** from `localStorage["idl.cmaOverrides"]`, (2) **multi-provider consensus** from the new `src/data/cmas.consensus.json` snapshot file, (3) **engine seed** (`CMA_SEED`, the previous in-code defaults). `applyCMALayers()` mutates the leaf objects of the exported `CMA` record in place, so every existing caller (`CMA[k].expReturn`, `CMA[k].vol`) keeps working without any code change. The Methodology tab gained two new UI blocks inside the CMA section: a **multi-provider consensus status** banner (shows whether `cmas.consensus.json` is populated, the `lastReviewed` date, the list of providers mixed in, or "engine defaults active" when empty), and an **editable CMA table** where the user can type custom μ and σ per asset class. Each row shows the seed value as a hint, the currently-active μ/σ, two input cells, and source badges (`Custom` / `Consensus` / `Engine`) for both μ and σ — making the active assumption explicit. **Apply** persists to localStorage and broadcasts an `idl-cma-changed` event; `PortfolioMetrics` and `MonteCarloSimulation` subscribe and re-run `useMemo` so the metrics block (Sharpe, frontier, α/β, drawdown) and the Monte Carlo simulation reflect the new assumptions immediately. **Reset** wipes overrides.
- **Monte Carlo now reads μ/σ from CMA** instead of a duplicated `bucketAssumption` table. `runMonteCarlo` previously had its own copy of expected returns and volatilities per asset bucket — this would have silently bypassed user overrides. Refactored to look up the active values via a thin `bucketKey(assetClass, region)` mapper and `CMA[key]`, so Sharpe, frontier and Monte Carlo all share a single source of truth. The FX-hedge σ reduction for foreign equity (≈3pp DM, 2pp EM, σ floor 5%) is now applied *after* the CMA read so user overrides and hedging stay composable. End-to-end verified: Sharpe -25.5 → -39.6 and Monte Carlo expected return 5.69% → 10.75% when US equity μ is overridden to 20%; both revert on Reset. Added 5 regression tests (CMA wiring, manual CMA mutation reflected in MC, FX-hedge σ composition, sanitization of tampered localStorage with unknown keys / out-of-bounds values / wrong types, sanitizer holds across repeated `applyCMALayers()` calls). Suite at 95 tests.
- **Hardened CMA boundary validation.** Sanitization now lives **inside** `applyCMALayers()` (one code path, runs on every call — at module load *and* on every `idl-cma-changed` event). Consensus JSON values are type-checked and clamped (μ → `[-50%, +100%]`, σ → `[0%, 200%]`) before they enter `CMA`; `getCMAOverrides()` additionally enforces an asset-key whitelist on the user-overrides path. Earlier draft used a one-shot IIFE which would have let later `applyCMALayers()` calls re-introduce malformed consensus values — caught in code review and folded into a single sanitized layering function. Added a regression test that injects an out-of-bounds consensus value, calls `applyCMALayers()` three times, and asserts the bounds hold every time.
- **Stress test independence documented.** Stress shocks in `scenarios.ts` are *historical-style return shocks* per asset bucket, not μ/σ assumptions, and are intentionally decoupled from CMA overrides so a user can keep mainstream CMAs while stressing against tail events. §5.3 now lists what is and is not affected by overrides.
- The consensus JSON ships empty by default — the engine falls back to the seed values, so the existing tests still pass unchanged. Full details in section 5.3 above. Per-asset-class notes were folded into a collapsed accordion to keep the editor visible without scroll. §8 Persistence updated with the new `idl.cmaOverrides` key.

### 2026-04-23
- **Snapshot-build data refresh pipeline (justETF).** Added a Node script `scripts/refresh-justetf.mjs` that pulls per-ISIN fields (currently TER) from public justETF profile pages and writes them to `src/data/etfs.overrides.json`. `src/lib/etfs.ts` shallow-merges those overrides on top of the in-code `CATALOG` at module load — when the file is empty (the committed default) the engine behaves exactly as before, so the 90-test suite still passes. New GitHub Action `.github/workflows/refresh-data.yml` runs the script nightly, runs typecheck + tests against the snapshot, and commits the diff if any. The Methodology tab now has a dedicated "Data Refresh & Freshness" card explaining the pipeline (EN/DE) and listing what stays curated by hand. Full details in section 5.2 above. App stays frontend-only at runtime; the user's browser never makes a live API call.
- **Validation: new "High" risk + short-horizon warning.** Mirrors the Very-High rule one step down: when risk appetite is "High" and horizon is < 5 years, a warning is shown suggesting a longer horizon or reducing risk to Moderate (EN/DE).
- **Validation: "Very High" risk warning now triggers for horizons < 10 years (was < 5).** Aligns the rule with the typical recommendation that an aggressive 100% equity-tolerance profile presupposes a long horizon to ride out drawdowns. Single-line change in `src/lib/validation.ts`; affects both Build and Compare tabs (EN/DE).
- **Compare tab: suppress non-actionable "High complexity" warning.** Portfolio B's defaults (`numETFsMin: 11`, `numETFs: 13`) intentionally produce a more diversified comparison portfolio, but the user can no longer adjust the ETF max-cap in Compare (control was removed earlier). The complexity warning therefore always fired without any way to act on it. The warning is now filtered out at the Compare call site (matched by message string in EN and DE) so only actionable warnings remain. The Build tab keeps surfacing it because the cap is still adjustable there.
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
