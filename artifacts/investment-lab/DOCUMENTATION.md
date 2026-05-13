# Investment Decision Lab — Functional & Logic Documentation

> **Maintenance rule:** This file MUST be updated whenever a feature is added, removed, or its behaviour changes. Each change should also append an entry to the **Changelog** section at the bottom.

> **See also:** `DB_MIGRATION_OVERVIEW.md` — five-phase plan for migrating the data-as-code catalog/overrides to a database.

Last updated: 2026-05 (explain-import-lookthrough-pending-spinner — Task #262)

---

## 1. Purpose & Scope

The Investment Decision Lab is a **frontend-only** React + Vite web application aimed at private investors and finance professionals. It constructs reference portfolios with a **fully deterministic, rule-based engine** — there is no backend, no database, no AI/LLM call, and no remote pricing. All computations happen in the browser.

> ### Not AI — rule-based by design
>
> The portfolio proposal is produced by an **explicit, rule-based engine**, not by any AI/ML model. Every weight is the output of:
>
> 1. A static table of **Capital Market Assumptions** (expected return, volatility, correlations) — see §4.1 and `src/lib/metrics.ts`.
> 2. **Closed-form formulas and constants** — equity/defensive split from the risk cap, `cashPct` clamp, market-cap regional anchors, Sharpe overlay `(Sharpe / 0.25)^0.4`, home-bias multipliers, the 65% concentration cap.
> 3. **Hard rules** for satellite sleeves (REIT 6%, Crypto 1–3%, Gold ≤ 5%), the thematic tilt within the equity sleeve (3–5%), and ETF selection (currency hedging, preferred exchange, synthetic vs physical).
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
| **Explain My Portfolio** | `ExplainPortfolio.tsx` | Bring-your-own-ETFs workspace: pick concrete ISINs from the curated catalog, set per-ETF weights, and run the same medium-depth analysis Build provides (validation, PortfolioMetrics, Monte Carlo, look-through, currency overview, fees). Persists to `localStorage["investment-lab.explainPortfolio.v1"]`. |
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

| Region | Anchor (USD/EUR base) | Anchor (GBP base) | Anchor (CHF base) |
|---|---:|---:|---:|
| USA | 0.60 | 0.60 | 0.60 |
| Europe | 0.13 | 0.10 | 0.10 |
| United Kingdom | — | 0.04 | — |
| Switzerland | — | — | 0.04 |
| Japan | 0.05 | 0.05 | 0.05 |
| Emerging Markets | 0.11 | 0.11 | 0.11 |

For CHF and GBP bases, the home market (Switzerland or United Kingdom respectively) is carved out of Europe into its own anchor slot so the home equity bucket is first-class — it gets its own home-bias multiplier, its own ETF (`Equity-Switzerland` / `Equity-UK`), its own row in the consolidation home-key map (§4.5), and its own slice of the ACWI benchmark (§7).

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
| Home tilt (GBP → United Kingdom) | × 1.5 |
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

### 4.3 Satellite sleeves and the equity thematic tilt

**Satellite sleeves** (REITs, crypto, gold) sit alongside the equity sleeve and reduce `coreEquity`:

- **REIT**: 6% if `includeListedRealEstate`.
- **Crypto**: 1 / 2 / 3% for Moderate / High / Very High when `includeCrypto`. Disabled for Low.
- **Gold (commodities)**: `min(5%, 15% × bondsPct)` if enabled and risk ≠ Low; carved out of bonds.

**Thematic tilt** is a sub-allocation **inside** the equity sleeve, not a satellite:

- **Thematic**: 3% if `numETFs ≤ 5`, otherwise 5% — only when `thematicPreference !== "None"`.
- It is a small theme-tilted slice (Technology, Healthcare, Sustainability, or Cybersecurity) **carved out of the equity budget**: the slice counts toward the total equity allocation, not as a separate satellite, and the AllocationGroupSummary tile (Build / Compare panels) groups it under **Equities**.
- This affects framing and downstream consumers (group tile, AI prompt, methodology copy, validation, charts), but the numeric weights are unchanged: `coreEquity = equityPct − thematicPct − (any other equity carve-outs); satellitesTotal = REIT + Crypto + Gold`. Core equity is then split across regional buckets in proportion to their bases.

### 4.4 Compaction for low ETF counts

If `numETFs ≤ 5`, the smallest **satellite** sleeves (REIT, Crypto, Commodities) are dropped in ascending order to leave at most `numETFs − 3` of them; their weights are folded back into Equity-USA (equity satellites) or Bonds (commodities). The thematic tilt is **not** in this drop list — it is part of the equity sleeve and survives consolidation.

### 4.5 Global+Home equity fallback

If, after the above, the number of non-zero buckets still exceeds `numETFs` AND ≥3 distinct equity regions are present, the engine collapses regional equity into:

- **Equity-Global** — MSCI ACWI IMI (`SPYI` / `IE00B3YLTY66`).
- **Equity-Home** — home-market tilt based on `baseCurrency` (USD → USA, CHF → CH, GBP → UK, EUR → Europe).

For EUR (and the rare CHF / GBP path with no pre-existing home bucket left after compaction), a tilt is carved from the global pool (CHF: 8%, EUR/GBP: 12%) so the home bias survives consolidation. With the GBP / CHF carve-outs in §4.2 the home bucket normally already carries weight, so this fallback only fires in edge cases. Total equity exposure is preserved exactly.

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
   - `region === "Home"` (only used by §4.5 Global+Home compaction): map base currency to the home equity sleeve — USD → `Equity-USA` (with hedging / synthetic resolution as below), CHF → `Equity-Switzerland`, GBP → `Equity-UK`, EUR → `Equity-Europe`.
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
| `explain.ts` | Legacy `analyzePortfolio(positions)` coherence verdict — kept for back-compat with the previous Explain UI but no longer wired to the live tab; superseded by `personalPortfolio.ts`. |
| `personalPortfolio.ts` | Explain-tab core (Task #135). `synthesizePersonalPortfolio(positions, baseCurrency)` reshapes per-ISIN holdings into the `AssetAllocation[]` + `ETFImplementation[]` pair the Build analysis cards already speak (one allocation row per bucketKey, one ETFImplementation row per ISIN). `runExplainValidation(positions, riskAppetite, baseCurrency, lang)` produces the shared `ValidationResult` shape (sum ≠ 100, dup ISIN, per-row weight bounds, equity-vs-risk cap soft+hard, hedging incoherence, stale bucketKey, unknown bucket, empty portfolio). Tested in `tests/personalPortfolio.test.ts`. |
| `etfs.ts` (catalog accessors) | `listInstruments()` joins `INSTRUMENTS` with `BUCKETS` so every ISIN exposes its `bucketKey`; `getInstrumentByIsin`, `getBucketKeyForIsin`, `getBucketMeta`, `ALL_BUCKET_KEYS`, `pickDefaultListing` are the surface the Explain ISIN picker and synthesizer build on. The inverse `ISIN_TO_BUCKET` map is built once at module load from `BUCKETS` and is one-to-one by construction (enforced by `validateCatalog`). |
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

**One-command listings refresh (Task #275).** The same nightly job that runs in CI as `Refresh ETF listings (nightly justETF snapshot)` (`.github/workflows/refresh-listings.yml`, cron + `workflow_dispatch`) is exposed as two pnpm scripts so an operator can reproduce the run locally without typing the long invocation:

```bash
# from the workspace root
pnpm --filter @workspace/investment-lab run refresh:listings      # real run — writes etfs.overrides.json + run-log + changes log
pnpm --filter @workspace/investment-lab run refresh:listings:dry  # DRY_RUN — fetches & parses, writes nothing on disk
```

The dry-run variant sets `DRY_RUN=1` and is genuinely read-only: it leaves `src/data/etfs.overrides.json`, `src/data/refresh-runs.log.md`, and `src/data/refresh-changes.log.jsonl` untouched (and the opportunistic `backfill-comments` pass that follows the real run is also skipped, so `src/lib/etfs.ts` is never written either). Use it before a manual `workflow_dispatch` to confirm the extractors still match justETF's current markup.

To trigger the same job in GitHub instead, open the **Actions** tab → **Refresh ETF listings (nightly justETF snapshot)** → **Run workflow** (the workflow's `workflow_dispatch` entry is what the cron path calls into; both run identical steps).

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
| `ExplainPortfolio.tsx` | Bring-your-own-ETFs workspace (Task #135). Two-column layout: settings (base currency, stated risk profile, horizon, hedged + look-through toggles) + bucket-grouped position editor (searchable Popover/Command ISIN picker, per-row weight input that uses `parseDecimalInput` on commit, delete). Validator summary card shows verdict (Coherent / Needs attention / Inconsistent) using `runExplainValidation`. When `validation.isValid` and at least one position is present, renders the same medium-depth analysis Build does: `CurrencyOverview`, `LookThroughAnalysis` + `TopHoldings` (when look-through is on), `MonteCarloSimulation`, `PortfolioMetrics`, `FeeEstimator`. The full state (settings + positions) is persisted to `localStorage["investment-lab.explainPortfolio.v1"]` on every change; weight drafts are transient and not persisted. |
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

**Principled equity-region construction (4)** — no equity region exceeds 50% of the equity sleeve for any base currency (concentration cap); each base currency tilts its home region above the USD-base reference (USD→USA, EUR→Europe, GBP→UK exclusive to GBP, CHF→Switzerland exclusive to CHF); risk-parity baseline gives lower-vol Japan more weight than higher-vol EM when other tilts are neutral (USD base, short horizon, no theme); equity sleeve sums to `targetEquityPct ± rounding` for the default input.

### Maintenance policy

> Whenever functional behaviour is added or changed, the corresponding test in `tests/engine.test.ts` MUST be added or updated **in the same change**, and the suite MUST be run before completion. Bugfixes MUST be accompanied by a regression test that fails without the fix and passes with it.

---

## 11. Changelog

Append a new entry whenever functionality changes. Newest first.

### 2026-05 (consistent-country-region-routing — Task #294)
- **Both CMA routers in `src/lib/metrics.ts` now agree on Canada / Ireland / Asia Pacific ex-Japan / Other.** Previously the look-through router (`mapAllocationToAssetsLookthrough`) routed Canada and Ireland into `equity_other`, while the row-region router (`mapAllocationToAssets` and the `routeByRegion` fallback) sent the manual region "Asia Pacific ex-Japan" to `equity_thematic` and the manual region "Other" also to `equity_thematic`. Toggling the Look-Through Analysis switch on a portfolio with Asia-Pacific exposure thus moved the bucket from Thematic to Japan, and "Other" landed in two different residual buckets depending on the toggle.
- **New rule (applies identically with look-through ON or OFF):** Canada → `equity_us`, Ireland → `equity_eu`, Asia Pacific ex-Japan (Australia, Hong Kong, Singapore, New Zealand at the country-slice level; "Asia Pacific ex-Japan" at the manual-region level) → `equity_jp`, manual region "Other" → `equity_other`. Sector / theme labels (Technology, Healthcare, Sustainability, Cybersecurity, Thematic, …) keep falling through to `equity_thematic`. justETF's catch-all "Other" country slice still flows into `equity_other` via the `unmappedShare` fallback.
- **Surfaces affected.** Build, Compare, Explain (catalog rows + manual-add live preview + committed rows), Report PDF, Monte Carlo, Correlation Matrix, Current Allocation card — all consume `mapAllocationToAssets` / `mapAllocationToAssetsLookthrough`, so they pick up the new mapping with no extra wiring. No new UI toggles.
- **Methodology copy updated in DE + EN** in both the CMA-routing note (around the "Where do ETFs without a recognised region land?" callout) and the "Conservative country map" paragraph in the Look-Through section, documenting the new mapping and the look-through-invariant guarantee.
- **Tests.** Added focused regression tests in `tests/engine.test.ts` covering: (a) `mapAllocationToAssetsLookthrough` with a synthetic Canada / Ireland / Australia / generic-"Other" profile → assertions on `equity_us`, `equity_eu`, `equity_jp`, `equity_other`; (b) `mapAllocationToAssets` with rows of region "Asia Pacific ex-Japan" and "Other" → `equity_jp` / `equity_other` (not `equity_thematic`); (c) `routeByRegion` fallback (no profile) with the same regions; (d) sector label "Technology" still routes to `equity_thematic` so the catch-all is preserved. `pnpm run typecheck`, `pnpm --filter @workspace/investment-lab run test:engine`, `test:components`, and `test:e2e:explain` green.

### 2026-05 (explain-manual-row-stable-identity-and-offcatalog-isin-button — Task #292)
- **Stable per-row identity for Explain positions.** `PersonalPosition` (in `artifacts/investment-lab/src/lib/personalPortfolio.ts`) gained an optional `uid?: string` field. Two new helpers — `generatePositionUid()` (prefers `crypto.randomUUID()`, falls back to a `Date.now() + Math.random()` suffix) and `ensurePositionUid(p)` — back the new contract. Every code path that **creates** an Explain row now stamps a uid: `addPositionInBucket`, `addCashPosition`, `addManualPosition`, the import path (`replaceWithImportedRows`), the saved-workspace loader (`loadWorkspace`), the Build → Explain hand-off in the `subscribeExplainLoadRequests` effect, and the `loadState` initial hydrate (which backfills any legacy persisted row missing a uid). The savedExplainPortfolios sanitizer round-trips `uid` when present and lets the loader backfill on import otherwise.
- **React keys switched from array index to uid.** All four PositionRow / CashPositionRow render blocks (`{cashRowIndices.map}`, the catalog-bucket `{idx.map}`, the Manual-entries `{manualRowIndices.map}`, the legacy Unassigned `{unassignedRowIndices.map}`) now use `key={state.positions[i].uid ?? "<scope>-<i>"}` instead of `key={i}`. Removing a manual row in the middle of the group no longer makes React reconcile the next row's transient input/popover state onto the survivor — which previously caused row B's delete to visually drop row A. The remove implementation itself is unchanged (`removePosition(index)` filters both `state.positions` and `weightDrafts` at the same captured index).
- **Off-catalog manual ISIN look-through button.** New helper `detailsEtfForRow(i)` in `ExplainPortfolio.tsx` synthesizes a minimal `ETFImplementation` row from `manualMeta` (assetClass, name, currency, terBps) for off-catalog manual entries whose typed ISIN passes the `^[A-Z]{2}[A-Z0-9]{9}\d$` shape check but does not resolve in the catalog. The existing `explain-etf-isin-button-manual-${idx}` clickable affordance now renders for those rows and opens the same shared `ETFDetailsDialog` Build mounts (the dialog's own "no profile" empty state covers the unrecognised-ISIN case). All three render blocks (catalog / manual / unassigned) consume the helper via `detailsEtf={detailsEtfForRow(i)}`.
- **No engine, MC, look-through, allocation, hedging, catalog or persistence semantics changed.** The new `uid` field is optional in the type and ignored by every downstream consumer (engine, synthesizer, validation). Methodology page does not document Explain-editor row identity or the look-through button surface, so no Methodology update was needed.
- **Per-row visual frame (follow-up).** Each `PositionRow` now wraps its controls + asset/region selectors + origin badge + scrape spinner + EtfInfoPreview card in a single bordered, padded container so it's obvious at a glance which preview card / asset selectors / weight input belong to the same ETF. Manual rows use a slightly more prominent frame (`rounded-md border border-border/70 bg-card/40 p-3`) since they accumulate the most stacked content; catalog rows use a lighter version (`border-border/40 bg-card/20 p-2`) for visual consistency within a bucket group. The previous flat `space-y-2` layout left adjacent rows hard to disambiguate when an EtfInfoPreview was open. No behaviour change — purely a CSS wrapper class on the existing outer `<div>`.
- **Tests.** Two new e2e cases in `tests/e2e/explain-portfolio.spec.ts`: (1) "deleting a middle Manual row preserves its siblings" types three distinct off-catalog ISINs into three Manual rows, deletes the middle row, and asserts the remaining two retain their typed ISINs at indices 0 and 1; (2) "an off-catalog manual ISIN exposes the clickable ISIN look-through affordance" types `LU0000000444` into a Manual row and verifies `explain-etf-isin-button-manual-0` is visible and opens the `etf-details-dialog`.

### 2026-05 (methodology-cma-routing-note — Task #291)
- **Methodology → Capital Market Assumptions section** now opens with a short bilingual remark explaining where ETFs without a recognised region land in the CMA table. The note appears between the section intro paragraph and the "Where these values are used in the tool" callout, in a neutral muted-background card (`data-testid="cma-routing-note"`). DE + EN copy covers: equity ETFs with one of the listed regions (USA, Europe, UK, Switzerland, Japan, EM) flow directly into that row; ETFs with no recognised region or a sector/theme label (e.g. Technology, Healthcare, Asia Pacific ex-Japan) land in **Thematic Equity**; look-through country slices that don't map to a dedicated bucket (Canada, Ireland, justETF's "Other", …) land in **Other / Residual**; pointer to the full routing tables in the Look-Through section below.
- **No engine, routing, look-through, allocation, hedging, catalog or persistence behaviour changed.** Pure explanatory copy in `Methodology.tsx`; the underlying rules (`mapAllocationToAssetsLookthrough` + `COUNTRY_TO_EQUITY_KEY` in `src/lib/metrics.ts`) are untouched.
- **Tests.** `pnpm run typecheck` clean; `pnpm --filter @workspace/investment-lab run test:components` green.

### 2026-05 (auto-detect-sector-themes — Task #287)
- **`inferAssetClassRegionFromInstrument` in `src/lib/etfs.ts` now also recognises sector themes** for off-catalog ETFs the user pastes into the Explain manual editor. After the existing geographic-region pass leaves `region = "Global"`, an opt-in sector pass kicks in for Equity rows only and assigns `Cybersecurity`, `Healthcare`, `Sustainability`, or `Technology` based on name/comment keywords (cybersecurity / cyber security; healthcare / biotech / pharma / medical; clean energy / ESG / climate / sustainable; technology / info tech / semiconductor / AI / robotics / software). Geo wins over sector by construction — `S&P 500 Information Technology` still classifies as USA, while `MSCI World Information Technology` lands on Technology. Non-equity asset classes (Fixed Income, Real Estate, Commodities, Digital Assets) keep their `Global` default.
- **No engine, MC, look-through, allocation, hedging, catalog or persistence behaviour changed.** This is purely a quick-fill heuristic in the manual-editor; the user can still override the dropdown.
- **Tests.** Added six new cases to `tests/unassignedInstrumentPicker.test.tsx` covering each sector keyword family, the geo-wins precedence rule, and the non-equity guard. `pnpm run typecheck` clean; `pnpm --filter @workspace/investment-lab run test:components` 16 files / 80 tests green.
- **Methodology page** unchanged — the manual-editor heuristic is not described there.

### 2026-05 (ai-prompt-preview-dialog — Task #283)
- **Build → Copy AI Prompt section** now opens a preview dialog instead of copying the prompt straight to the clipboard. The two buttons (`Basic & Fast`, `Pro & Strict`) keep their layout, icons and tooltips; clicking one opens `AiPromptPreviewDialog` with the clicked mode pre-selected.
- **Dialog content.** New component `artifacts/investment-lab/src/components/investment/AiPromptPreviewDialog.tsx`. Header shows title + one-line helper; toolbar lets the user toggle between Basic and Pro without closing the dialog (Memo recomputes the prompt via `buildAiPrompt(input, lang, mode)`); body is a scrollable monospace `<pre>` with `whitespace-pre-wrap` (max-height 70vh, internal scroll, no horizontal overflow on iPhone-13 viewport); footer carries `Close` (secondary) + `Copy` (primary). Copy reuses the existing `navigator.clipboard.writeText` + `toast.success/error` calls and the existing `build.toast.aiPromptCopied` / `build.toast.aiPromptError` strings — no toast-copy change.
- **i18n.** Added new keys `build.aiPrompt.preview.title`, `…helper`, `…copy`, `…close` (EN + DE). Existing mode-label keys `build.btn.copyAiPromptBasic` / `…Pro` are reused for the toggle.
- **No engine / catalog / persistence behaviour changed.** `buildAiPrompt()` output, the Explain-import payload and every other surface that consumes the prompt are untouched. Methodology page does not document the AI-prompt copy flow, so no Methodology update was needed.
- **Tests.** `pnpm run typecheck` clean; `pnpm --filter @workspace/investment-lab run test:components` 16 files / 74 tests green.

### 2026-05 (catalog-row-drift-guardrail-and-second-sweep — Tasks #276 / #277)
- **#276 audit (no code change needed).** Walked the seven admin direct-write helpers in `artifacts/api-server/src/lib/github.ts` (`injectEntry`, `injectAlternative`, `setBucketDefault`, `injectPool`, `removePool`, `removeAlternative`, plus the bundled attach path) and confirmed the row renderer is already correct: `injectEntry` calls `renderEntryBlock(entry, "  ")` with an explicit canonical 2-space indent, and `appendInstrumentRow` delegates to the same renderer. The 8 + 3 drifted rows we found in `etfs.ts` therefore stem from a pre-`renderEntryBlock` admin path that no longer exists, not from current code. Conclusion: today's `etfs.ts` reformat clears the legacy debt; the live mutators don't reintroduce drift.
- **#277 guardrail — closed the blind spot in the existing pinning test.** `tests/backfillRowRegex.test.ts` previously enumerated "expected rows" using `^ {2}"<ISIN>": I\(\{` — the same 2-space anchor that ROW_RE itself uses. Both regexes shared the same blind spot: a drifted row was invisible to *both*, so the test stayed green even when 11 real rows were silently being skipped by the nightly backfill. Replaced the enumerator with the indent-AGNOSTIC `^ +"<ISIN>": I\(\{` and added a third targeted test (`rejects any INSTRUMENTS row whose opener has drifted away from the canonical 2-space indent`) that prints each offending ISIN + indent width with a one-line repair instruction in the failure message. The new test ran red on first invocation and surfaced 3 additional drifted rows the morning's manual sweep had mistakenly classified as nested-in-BUCKETS noise — proving the guardrail has real teeth.
- **Second indent sweep.** Dedented the 3 newly-found rows: `CH0237935652` (16 → 2 spaces), `IE00BMW42181` (10 → 2), `IE00BJ5JNZ06` (26 → 2). Done with the same indent-agnostic sed pass as the morning sweep (`s|^ +("[A-Z]{2}[A-Z0-9]{9}[0-9]": I\(\{)$|  \1|`), file is byte-identical when whitespace stripped. ROW_RE probe: 163 → **166 matches**, all uniform 2-space — the full canonical catalog is now covered for the first time since the legacy admin path drifted these rows.
- **Tests.** Root `pnpm run typecheck` clean; `pnpm --filter @workspace/investment-lab run test:catalog` 22 files / 290 tests green (was 289 before — the new guardrail counts as one additional case).
- **Methodology page** unchanged — pure-data file whitespace + a test-only guardrail; no engine, MC, look-through, allocation, hedging, catalog, or persistence behaviour changed.

### 2026-05 (canonicalize-drifted-catalog-row-indents — follow-up to Task #275)
- **Symptom found while smoke-testing Task #275's regex fix locally.** The new `ROW_RE` (`/(\n( +)"<ISIN>": I\(\{...\n\2\}\),)/g`) tolerates any leading-whitespace level, but only when the opener and the closing `}),` share that indent — the back-reference `\2` enforces symmetry. A local `node` probe over `src/lib/etfs.ts` matched only 155 of 163 INSTRUMENTS rows. The remaining 8 rows had an asymmetric layout: the `"<ISIN>": I({` opener sat at 6 or 8 leading spaces while its closing `}),` was at the canonical 2 spaces — almost certainly the residue of older admin direct-write paths that wrote the opener with the previous helper's indent but used the file-level closer. TypeScript parses these rows fine (whitespace-insensitive), so the catalog/engine/UI all behaved correctly, but the nightly `backfill-comments` step silently skipped them, meaning their `comment`/`commentDe` fields were excluded from every refresh.
- **Fix.** Pure-whitespace reformat of those 8 opener lines to 2-space indent (`FR0007054358`, `IE0008471009`, `IE00B0M63177`, `LU0292107645`, `CH0008899764`, `IE00BDBRT036` from 6 → 2 spaces; `IE00B4K6B022`, `IE000LXEN6X4` from 8 → 2 spaces). File is byte-identical to the previous version when ignoring whitespace; no field values, no row order, no catalog semantics changed. After the reformat the local `ROW_RE` probe matches all 163 rows uniformly at 2 spaces, so the next nightly refresh will cover the full catalog instead of silently skipping ~5 % of it.
- **Tests.** Root `pnpm run typecheck` clean; `pnpm --filter @workspace/investment-lab run test:catalog` 22 files / 289 tests green (incl. the previously-flaky `backfillSourcePriority.test.ts`).
- **Methodology page** unchanged — pure data-file whitespace normalisation, no engine, MC, look-through, allocation, hedging, catalog, or persistence behaviour changed.

### 2026-05 (refresh-listings-row-regex-and-local-script — Task #275)
- **Diagnosed and fixed the nightly `Refresh ETF listings` GitHub Action failure (run #19, 2026-05-11).** The justETF scrape step itself was green (139 ok / 27 fail — well under the half-fail abort threshold), but the follow-up `pnpm run typecheck && pnpm run test` step failed with `tests/backfillSourcePriority.test.ts` expecting `[ 'IE00B53L3W79' ]` and getting `[]`. Root cause: the `IE00B53L3W79` row in `src/lib/etfs.ts` on `main` had been written with **4-space indent** (drifted from the 2-space canonical form, almost certainly via an admin direct-write helper), and `ROW_RE` in `scripts/backfill-comments.mjs` was anchored to exactly two spaces — so the regex silently skipped that row, the mocked fetcher was never called, and the assertion failed. Locally the same test passed because the workspace copy of `etfs.ts` still has the correct 2-space indent.
- **Fix.** `ROW_RE` now captures the leading whitespace (`(\n( +)"<ISIN>": I\(\{...\n\2\}\),)`) and requires the closing `}),` to sit at the same indent as the opener — so any indent level (2, 4, …) is matched and back-referenced for the closer, preventing future indent drift from silently muting the backfill. The helper-internal `rowReFresh` regex inside `backfillCatalogComments` was relaxed identically. Capture-group destructuring updated (`m[3]` is now the ISIN, `m[4]` the row body).
- **One-command local trigger.** Two new pnpm scripts in `artifacts/investment-lab/package.json` reproduce the same nightly job locally: `pnpm --filter @workspace/investment-lab run refresh:listings` (real run — same as CI) and `pnpm --filter @workspace/investment-lab run refresh:listings:dry` (sets `DRY_RUN=1`). Section 5.2 documents both invocations alongside the existing `workflow_dispatch` path.
- **Honest dry-run.** `scripts/refresh-justetf.mjs`'s `DRY_RUN` branch no longer appends a `dryRun:true` entry to `refresh-runs.log.md` — the dry-run is now genuinely read-only across all three persisted files (`etfs.overrides.json`, `refresh-runs.log.md`, `refresh-changes.log.jsonl`), and the opportunistic `backfill-comments` pass that would write `etfs.ts` is already skipped via the early `process.exit` so `src/lib/etfs.ts` is also untouched.
- **Tests.** `tests/backfillSourcePriority.test.ts` (3 cases) and `tests/scrapers.test.ts` (66 cases) both green; root `pnpm run typecheck` clean.
- **Methodology page** unchanged — no engine, MC, look-through, allocation, hedging, catalog, or persistence behaviour changed; this is a script-robustness fix plus operator ergonomics.

### 2026-05 (compare-slot-preview-warmup — Task #272)
- **Compare slots loaded from an Explain workspace now auto-fetch live justETF TER for off-catalog ISINs.** Task #270's three-step manual-row TER fallback (operator → cached scrape → asset-class default) reaches step 2 only if the in-tab `SCRAPE_CACHE` already has the ISIN. In Explain that cache is warmed by `useEtfInfo`'s manual-entry preview hook the moment the row renders. In Compare, when the user taps "Load from Explain" with a fresh tab (no Explain visit beforehand), the cache is cold for every off-catalog ISIN, so the Fee Estimator silently fell through to the asset-class default — a Vanguard FTSE All-World row could land on a generic "Equity-World" 18 bps default instead of its real ~22 bps justETF TER, with no visible cue that better data was reachable.
- **Fix.** New helper `triggerCompareSlotPreviewWarmups(workspace, deps)` in `src/lib/explainCompare.ts` mirrors `triggerImportLookthroughScrapes`: it walks the workspace's positions, dedupes by ISIN, skips catalog hits (`getInstrumentByIsin`), cash sentinels, malformed ISINs, rows with operator-confirmed `manualMeta.terBps`, and any ISIN already cached (`hasFreshScrapeCacheEntry`), then fans out the same `/api/etf-preview/:isin` request the Explain hook would have fired (via the new `warmEtfPreviewCache` export in `src/lib/useEtfInfo.ts`). Both helpers populate the shared `SCRAPE_CACHE`, so the very next `explainWorkspaceToSlotPortfolio` re-synthesise picks up the live TER through `getCachedScrapeTerBps`.
- **Wiring in Compare.** `ComparePortfolios.tsx`'s `loadFromExplain` bumps a per-slot epoch (`explainSlotEpochA/B`) before installing the new workspace, then calls the helper. As each warm-up resolves, an `onResult` callback (a) checks the epoch is still current — so a stale callback from a detached / replaced slot can't repaint it — (b) removes the ISIN from the slot's `pendingPreviewIsinsA/B` set, and (c) re-runs `explainWorkspaceToSlotPortfolio` so the freshly-cached TER flows into `outputA/B`. `detachExplainSource` also bumps the epoch and clears the pending set, so a quick "Load → Detach" cycle leaves no orphan spinners.
- **Spinner.** `pendingPreviewIsinsA/B` is mapped to a bucket-key set (`pendingPreviewBucketsA/B`, memoised against the slot's `etfImplementation`) and threaded into all four `<FeeEstimator>` instances (mobile A/B + desktop A/B). `FeeEstimator.tsx` gained an optional `pendingPreviewBuckets?: ReadonlySet<string>` prop and renders a small `<Loader2 className="h-3 w-3 animate-spin" />` next to the breakdown row's bucket name when the row's key is in the set (`data-testid="fee-row-preview-pending-${row.key}"`, `role="status"`, `aria-live="polite"`, `title={t("fee.previewPending")}`). Build leaves the prop undefined, so the spinner never renders there.
- **i18n.** New key `fee.previewPending` ("Loading live ETF fee data…" / "Lade Live-ETF-Gebührendaten…").
- **Tests.** New unit suite `tests/compareSlotPreviewWarmup.test.ts` with 5 cases (catalog rows skipped, dedupe, `manualMeta.terBps` skip, cash + malformed-ISIN skip, `onResult` per warmed ISIN).
- **Methodology page** unchanged — this task is wiring/UX only; the engine's TER fallback chain that the Methodology page documents is unchanged.

### 2026-05 (fee-estimator-ter-source-badge — Task #271)
- **The Fee Estimator now shows where each manual-row TER came from.** Task #270 added a three-step fallback for off-catalog manual ETFs (operator → live justETF scrape → asset-class default), but the table only displayed the resolved bps value, so users couldn't tell whether a row reflected a real number or the generic fallback. Each manual row now renders a small inline badge next to its TER cell ("operator" / "justETF" / "default" in EN, "Operator" / "justETF" / "Standard" in DE) with a `title` tooltip describing the fallback chain. Catalog rows continue to render unchanged (no badge).
- **Wiring.** `ETFImplementation` (`src/lib/types.ts`) gained an optional `terSource?: "operator" | "justetf" | "default"` discriminator, set by `synthesizePersonalPortfolio` (`src/lib/personalPortfolio.ts`) on the manual-row branch only — the catalog-row branch leaves it undefined, so Build/Compare keep emitting badge-less rows. `estimateFees` (`src/lib/fees.ts`) propagates the source to the per-bucket breakdown row only when **every** contributing row in that bucket carries the **same** source — buckets with conflicting explicit sources, or buckets that mix a sourced manual row with an unsourced catalog row, resolve to undefined so the weighted-blend TER never gets a misleading badge. `FeeEstimator.tsx` reads it from each breakdown row and renders the badge using `useT`.
- **i18n.** New keys `fee.terSource.{operator,justetf,default}` and `fee.terSource.tooltip.{operator,justetf,default}` in EN and DE.
- **Tests.** Extended the existing Task #270 regression in `tests/personalPortfolio.test.ts` to assert each manual row carries the matching `terSource` value, added a new test that catalog rows leave `terSource` undefined, and added a `terSource aggregation on breakdown rows` block in `tests/engine.test.ts` covering all-agree (badge propagated), conflicting explicit sources (undefined), catalog-mixed-with-manual (undefined), and catalog-only (undefined).
- **Methodology page synced** — the manual-ISIN "Konsequenzen für die Berechnung" / "Consequences for the calculation" paragraph now mentions the per-row badge alongside the three-step fallback chain (DE + EN).

### 2026-05 (manual-row-ter-fallback-chain — Task #270)
- **Off-catalog manual ETFs no longer drop the Fee Estimator to 0.0 bps when their TER is unknown.** `synthesizePersonalPortfolio` (`src/lib/personalPortfolio.ts`) used to write `terBps: typeof mm.terBps === "number" ? mm.terBps : 0` for every manual row, so an Explain workspace with off-catalog positions where the operator hadn't pressed "Use these values" on the EtfInfoPreview card showed a 0.0 bps row in the Fee Estimator and dragged Blended TER, Annual Fee, and the 30-year drag chart down accordingly.
- **Fix — three-step fallback.** The synthesizer now resolves the row's TER via:
  1. operator-supplied `manualMeta.terBps` (Quick fill or typed),
  2. caller-supplied `terLookup(isin)` — defaults to `getCachedScrapeTerBps` from `src/lib/useEtfInfo.ts`, a new read-through into the in-tab justETF scrape cache (`SCRAPE_CACHE`, 10-minute TTL) that mirrors `EtfInfoPreview.pickTerBps` (accepts both `fields.terBps` and `fields.ter` percent),
  3. asset-class default from `getETFTer(assetClass, region)` — the same value the Fee Estimator falls back to for unknown buckets.
- **Wiring.** `synthesizePersonalPortfolio` gained an optional 4th `terLookup?: ManualTerLookup` parameter (new exported type). `ExplainPortfolio.tsx` passes `getCachedScrapeTerBps`. `explainCompare.ts` re-exports the helper and `explainWorkspaceToSlotPortfolio` accepts and forwards `terLookup`; `ComparePortfolios.tsx`'s 3 call sites pass it through, so the Compare slot's Fee Estimator gets the same benefit.
- **Catalog rows are unaffected** — they take `inst.terBps` directly. Pure look-through-only profiles (which carry no TER) never enter this code path.
- **Tests.** New regression in `tests/personalPortfolio.test.ts` ("Task #270 — falls back to terLookup then asset-class default for manual rows") proves: no `manualMeta.terBps` + no lookup hit → asset-class default (> 0); cache lookup wins when `manualMeta.terBps` is absent; operator-typed `manualMeta.terBps` wins over the lookup.
- **Methodology page synced** — the "Konsequenzen für die Berechnung" / "Consequences for the calculation" paragraph in the manual-ISIN section of `Methodology.tsx` now describes the three-step TER fallback chain (DE + EN).

### 2026-05 (explain-import-lookthrough-pending-spinner — Task #262)
- **Show a small inline spinner on imported off-catalog rows while their look-through scrape is still in flight.** Task #259 made the import path fan out background `lookthrough-scrape` calls for off-catalog ISINs (`found-unassigned`, `off-universe`), but the import dialog closes immediately and the user only sees the eventual success / failure toast. For multi-second scrapes (justETF latency, rate-limit waits) the rows looked "done" while their Geo / Sector / Top-Holdings cards were still empty — no visible cue that data was on its way.
- **Fix.** New component-local state `pendingScrapeIsins: ReadonlySet<string>` in `ExplainPortfolio.tsx`. `replaceWithImportedRows` captures the list returned by `triggerImportLookthroughScrapes(...)` and seeds the set; the per-ISIN `onResult` callback removes each entry as the scrape resolves (success OR failure) before delegating to `handleManualScrapeResult`. `PositionRow` gains an optional `isLookthroughScrapePending` prop, threaded through all three call sites (catalog tree rows, manual-entries pseudo-group, legacy unassigned tail) by checking `pendingScrapeIsins.has(position.isin)`. When true, an unobtrusive `<Loader2 />` spinner + "Loading look-through… / Lade Look-Through…" line renders right above the manual-row `EtfInfoPreview` block (`data-testid="explain-row-lookthrough-pending-${rowIndex}"`, `role="status"`, `aria-live="polite"`).
- **Catalog rows are unaffected** — the spinner is gated on `isManual` so curated rows (which always carry bundled look-through) never render it. The set is component-local and resets on full reload, matching the lifetime of the import action.
- **i18n.** New key `explain.row.lookthroughPending` in both DE ("Lade Look-Through…") and EN ("Loading look-through…").
- **Tests.** Existing `tests/explainImportPortfolio.test.ts` still pins the fan-out helper; the spinner is purely presentational and gated on the same set this helper returns. No engine / catalog / persistence behaviour changes.

### 2026-05 (explain-import-lookthrough-scrape-on-import — Task #259)
- **Trigger look-through scrapes when a portfolio is imported.** Operator pasted a portfolio that contained off-catalog ISINs (`found-unassigned` and `off-universe`) into the Explain → "Import portfolio" dialog and watched the rows arrive in the editor — but the Geo / Sector / Top-Holdings cards stayed empty for those positions. Cause: the on-demand `GET /api/lookthrough-scrape/:isin` only fired from `setManualIsin` (the row-level ISIN editor), never from the import path. The operator had to delete the row and retype the same ISIN to populate the charts.
- **Fix.** New pure helper `triggerImportLookthroughScrapes(rows, { profileFor, scrape, onResult })` in `src/lib/importLookthroughScrape.ts` iterates the imported rows, picks the ones with `manualMeta` and a well-formed ISIN whose `lookthroughProfileFor` returns null (i.e. neither curated nor already cached at runtime), de-dupes, and fires the scrape. Catalog rows (no `manualMeta`) and bundled-overrides hits are skipped automatically. Wired from `replaceWithImportedRows` (`src/components/investment/ExplainPortfolio.tsx`) right after the `setState` + weight-draft writes.
- **Shared result handling.** Extracted the success / failure post-scrape logic out of `setManualIsin` into a new in-component `handleManualScrapeResult(trimmed, result, { deferToast, allowMute })` helper so the import path reuses the same equity / fixed-income classification, `registerRuntimeLookthroughProfile` write, version bump, success toast, and bilingual destructive-toast wording. Two flags control the failure-path differences between the two callers:
  - `deferToast` — the import path passes `false` (fire immediately) because import rows already carry an operator-classified `manualMeta` from the dialog and don't need the 1500 ms Stammdaten-mute gate that protects fresh in-row edits in `setManualIsin` (which still passes `true`).
  - `allowMute` — the import path passes `false`, bypassing the `autoClassifiedIsinsRef` suppression. The `setManualIsin` path opts in (`true`) so a parallel auto-classification can suppress the redundant red toast — but the import path's classification did NOT come from the auto-classifier, so the operator must always see the failure feedback even if the same ISIN happened to be auto-classified earlier in the same session. The mute decision lives in a tiny pure helper `shouldSuppressScrapeFailureToast({ trimmed, autoClassifiedIsins, allowMute })` (`src/lib/importLookthroughScrape.ts`) so it is unit-tested independently.
- **Tests.** New cases in `tests/explainImportPortfolio.test.ts`: "import triggers look-through scrape for off-catalog ISINs" uses an injected fake `scrape` and pins (a) catalog rows are not scraped; only the off-catalog row is, (b) ISINs already covered by `profileFor` are skipped, (c) malformed ISINs are skipped, (d) duplicate off-catalog ISINs in the same import fan out to a single scrape call. A second describe block "shouldSuppressScrapeFailureToast" pins (e) the setManualIsin path mutes auto-classified ISINs, (f) the import path does NOT mute even when the ISIN was auto-classified earlier, (g) absence from the auto-classified set never mutes regardless of `allowMute`. All 30 Explain e2e specs continue to pass — the existing "off-catalog ISIN clears the unmapped-ETF alert once the scrape resolves" e2e is now also satisfied by the import path, not just by typing.

### 2026-05 (admin-curated-lookthrough-badge — Task #252)
- **Fix the look-through status badge for hand-curated profiles in the admin Catalog → Browse view.** ETFs whose look-through profile lives in `DISTINCT_PROFILES` (`src/lib/lookthrough.ts`) — typically swap-based or niche funds that justETF cannot scrape (LU0274208692, LU1681038243, IE00BLCHJB90, …; ~7 ISINs) — were rendered with a red "Keine LT-Daten" / "No LT data" badge in the per-bucket tree, even though the engine resolves their look-through correctly via the curated profile.
- **Server.** `GET /api/admin/lookthrough-pool` now extracts the ISIN keys of `DISTINCT_PROFILES` directly from `lookthrough.ts` on disk via a new `readDistinctProfileIsinsFromDisk()` helper (string-aware brace walker; cached by `mtimeMs`; new `getLookthroughTsPath()` in `data-paths.ts` mirrors `getCatalogPath()` and returns `null` when the file is absent in production bundles). Each curated ISIN that is **not** already in the merged `overrides + pool` map is appended as a synthetic entry with `source: "curated"` and sentinel counts `topHoldingCount: -1, geoCount: -1, sectorCount: -1`. `LookthroughPoolEntry.source` (admin-api) gains `"curated"` as a valid value.
- **Frontend.** `computePoolStatus` (`src/components/admin/badges.tsx`) returns a new `"curated"` tone first, ahead of the `ok / stale / missing` heuristic. `poolStatusLabel` adds DE "Kuratiert" / EN "Curated"; `LookthroughStatusBadge` renders the badge in indigo (`border-indigo-600 text-indigo-700 dark:text-indigo-400`) with a tooltip explaining that the profile is hand-curated in `lookthrough.ts (DISTINCT_PROFILES)` and not scraped from justETF. The existing `Daten OK / Veraltet / Daten fehlen` paths for scraped entries are unchanged.
- **No engine / catalog changes.** Look-through resolution itself is unaffected — this is purely a faithful representation of the existing curated coverage in the operator's catalog tree. No new tests added (the change is presentational; e2e badge-text coverage is tracked under existing test tasks).

### 2026-05 (auto-classify-manual-entries — Task #251)
- **Auto-classify off-catalog manual entries in the Explain tab.** Operator pasted an off-catalog ISIN (e.g. an Invesco Physical Gold ETC, a CHF-denominated SMI fund, an S&P 500 UCITS ETF) and watched the row default to **Equity / Global** + a red "look-through unavailable" toast — even though the ETF-preview Stammdaten arriving moments later (name + currency) carried more than enough signal to pick a sensible asset class and region. The redundant red toast was the loudest UX cue precisely when the app could have helped.
- **Fix.** When the live `useEtfInfo` scrape lands for an off-catalog manual row, `EtfInfoPreview` (`src/components/explain/EtfInfoPreview.tsx`) feeds `name + currency` through `inferAssetClassRegionFromInstrument` (`src/lib/etfs.ts:3289`, the same heuristic the unassigned-instruments picker already uses) and fires a new `onAutoClassify` callback. The callback is gated client-side **and** in the parent setter:
  - **Precedence rule (operator picks always win).** The effect only fires when the row still carries the *fresh* `{Equity, Global}` defaults AND is not already flagged as auto-classified. The parent setter `autoClassifyManualMeta` (`ExplainPortfolio.tsx`) re-checks the same invariant before writing — even a concurrent operator pick races safely.
  - **No false flag.** If the heuristic only produces the generic `Equity / Global`, the effect short-circuits — flagging the row as "auto-classified" while still showing the defaults would be misleading.
  - **Hint.** When the row is auto-classified, a small italic line "Asset-Klasse + Region automatisch aus dem Namen abgeleitet — überschreibbar" / "Asset class + region auto-detected from the name — you can override" renders right under the master block (`data-testid="etf-info-auto-classified-${rowIndex}"`).
  - **Reverting.** As soon as the operator touches either dropdown, `setManualMetaField` strips the `autoClassified` flag (the hint disappears) and removes the ISIN from `autoClassifiedIsinsRef` so the effect won't re-fire later in the same session.
- **Quieter look-through toast on auto-classified rows.** `setManualIsin`'s `lookthrough_*` / `scrape_failed` red toast is now deferred ~1.5 s and suppressed when the ISIN ended up in `autoClassifiedIsinsRef.current` — the in-row amber 0 % banner stays visible and is the right channel to communicate "no geo / sector data". Only genuinely un-classifiable rows still raise the loud toast.
- **State.** New optional `autoClassified?: boolean` on `PersonalPosition.manualMeta` (`src/lib/personalPortfolio.ts`); `loadState`'s migration in `ExplainPortfolio.tsx` persists the flag.
- **Methodology page.** "Manual ETF Entry — Live Preview & Look-Through" Section gains two new bullets DE + EN documenting the auto-classify + the muted look-through-toast — operator surfaces and precedence rule are spelled out.
- **Tests.** New `tests/etfInfoPreviewAutoClassify.test.tsx` pins (a) Gold ETC → Commodities/Global, (b) S&P 500 → Equity/USA, (c) no-fire when operator pre-set Region=Europe, (d) no-fire when row already flagged auto-classified, (e) no-fire when heuristic == defaults, (f) bilingual hint renders when `currentAutoClassified=true`.

### 2026-05 (hide-region-picker-for-fixed-income — Task #247)
- **Hide the Region selector on Explain manual rows whose asset class is Fixed Income.** Operator noticed that picking "Fixed Income" in a manual row still surfaced the Region picker (Global / USA / Europe / Switzerland / …), suggesting that e.g. "Fixed Income / Switzerland" vs "Fixed Income / USA" would compute differently — when in fact `monteCarlo.ts:bucketKey()` collapses every Fixed Income sleeve to a single `bonds` CMA bucket regardless of region, so the picker carried no engine signal and was actively misleading.
- **Fix.** Added `"Fixed Income"` to `NO_REGION_ASSET_CLASSES` in `src/lib/personalPortfolio.ts`. That single set drives both surfaces:
  - **UI guard** — `assetClassNeedsRegion(...)` returns `false` for FI, so the existing `showRegion ? two-col : one-col` branch in `ExplainPortfolio.tsx` (around the `explain-manual-region-${rowIndex}` Select) hides the Region picker. The on-change auto-snap in the asset-class Select already calls `onManualMetaChange("region", "Global")` when `!assetClassNeedsRegion(v)`, so switching from Equity → Fixed Income normalises the stored region in the same tick.
  - **Engine safety net** — `resolveSleeve(...)` collapses any stored region to `"Global"` for region-less classes before the synthesizer groups sleeves, so legacy saved files (`investment-lab.explainPortfolio.v1`) and paste-imported portfolios that carry e.g. `manualMeta: { assetClass: "Fixed Income", region: "Switzerland" }` no longer produce duplicate "Fixed Income / Switzerland" + "Fixed Income / USA" allocation rows that compute identically downstream — they merge into a single `Fixed Income - Global` sleeve.
- **Catalog FI buckets are unaffected.** The catalog path (`bucketKey` set, `getBucketMeta(...)` wins before the manualMeta branch) preserves curated FI sleeves' declared regions (e.g. `FixedIncome-Global`, `FixedIncome-Global-CHF`). The change only governs the manual / off-catalog path.
- **Tests.** New engine cases in `tests/personalPortfolio.test.ts` cover (a) `NO_REGION_ASSET_CLASSES` + `assetClassNeedsRegion` membership for the four region-less classes, (b) a single FI manual row with stored region `"Switzerland"` synthesising as `Fixed Income - Global`, (c) two FI manual rows with different stored regions collapsing into ONE sleeve, and (d) catalog FI buckets staying untouched. New e2e regression in `tests/e2e/explain-portfolio.spec.ts` ("Region picker hidden for Fixed Income, restored when switching back to Equity") exercises the actual Select via `explain-add-manual` → `explain-manual-asset-0` → asserts `explain-manual-region-0` toggles between visible and `count===0`.
- **Methodology page.** No copy update needed — the manual-entry section (`Methodology.tsx`) only states that manual rows accept "asset class, region and weight"; it never claimed FI region carries analytical signal, so the rewritten engine still matches the documented behaviour.

### 2026-05 (manual-entry-lookthrough-banner-honesty)
- **Stop the amber "no look-through data" notice from firing on rows whose live justETF lookup actually succeeded.** Operator reported a 100 % position in `CH0111762537` (UBS ETF (CH) SMIM CHF A-dis) where the Allocation card already showed the correct 70.6 % Swiss / 29.4 % Other-Residual split (matching justETF's published 70.62 / 29.38 country table) — yet the per-row preview still rendered the amber **"No look-through data in pool — this position contributes 0 % to Geo / Sector / TopHoldings cards and Home-Bias"** notice. Cause was a stale-memo bug, not a data issue.
- **Root cause.** `useEtfInfo` (src/lib/useEtfInfo.ts) computed `pool` via `useMemo(() => profileFor(isin), [isin, valid])`. When `setManualIsin` (src/components/investment/ExplainPortfolio.tsx) fired the on-demand `GET /api/lookthrough-scrape/:isin` and resolved successfully, it called `registerRuntimeLookthroughProfile(isin, profile)` (src/lib/lookthrough.ts) which mutated the module-local `RUNTIME_PROFILES` registry. The parent ExplainPortfolio re-rendered (via `setRuntimeProfileVersion`), but the child preview's `useMemo` returned its cached `null` because its deps (`isin`, `valid`) hadn't changed — so `hasPool` stayed `false` for the row's lifetime, the green "look-through available" banner never appeared, and the amber 0 % notice fired despite the geo cards already populating correctly. The Methodology page (`Methodology.tsx`) faithfully described this buggy behaviour, which doubled the operator's confusion.
- **Fix.** Added a tiny pub/sub to `src/lib/lookthrough.ts` — `subscribeRuntimeLookthrough(listener)`, `getRuntimeLookthroughVersion()`, internal `bumpRuntimeVersion()` called from `registerRuntimeLookthroughProfile` and `clearRuntimeLookthroughProfiles`. `useEtfInfo` now subscribes via `useSyncExternalStore(subscribeRuntimeLookthrough, getRuntimeLookthroughVersion, getRuntimeLookthroughVersion)` and includes the version token in the `pool` memo deps, so the memo recomputes the moment a runtime profile is registered for any ISIN — without coupling the hook to ExplainPortfolio's own `runtimeProfileVersion` state.
- **Wording.** `EtfInfoPreview.tsx` badge label changed from "Look-Through aus Pool" / "look-through in pool" → "Look-Through verfügbar" / "look-through available" (now accurate whether the profile came from the curated pool or the live runtime fetch). Amber notice copy clarified to "Keine Look-Through-Daten verfügbar (weder im kuratierten Pool noch über den Live-Abruf von justETF) …" / "No look-through data available (neither in the curated pool nor from the live justETF lookup) …" so the message is unambiguous when it does fire (e.g. CH-domiciled funds without a justETF country table).
- **Methodology page.** "Look-through banner" bullet (`Methodology.tsx`, "Manual entry" Section) rewritten DE + EN to reflect both sources of look-through data and the `useSyncExternalStore` subscription path. The wider "Look-through coverage in three places" / "off-catalog look-through cache" paragraphs from Task #238 still hold and were not touched.
- **Tests.** New regression case in `tests/useEtfInfo.test.tsx` ("re-evaluates `pool` when a runtime profile is registered for the typed ISIN") pins the subscription wiring with the exact ISIN from the operator report (`CH0111762537`) and the exact 70.62 / 29.38 country shares from the screenshot — guards against any future memo-deps regression.

### 2026-05 (other-residual-honest-surfacing — Task #241)
- **Stop silently leaking the look-through "Other" / Ireland residual into US Equity / North America.** Operator spotted that a 100 % position in IE00BKX55T58 (Vanguard FTSE Developed World) was reported in the Explain tab as ~76 % US Equity even though the fund's published geo profile lists only 63.62 % US. Two upstream "Other"-style slices were being silently re-routed:
  - **Look-through CMA layer (`src/lib/metrics.ts`)** — `mapAllocationToAssetsLookthrough` walks the `profile.geo` country histogram, looks each country up in `COUNTRY_TO_EQUITY_KEY`, and any unmapped name (e.g. justETF's aggregate "Other" catch-all + context-dependent labels like "Ireland") was funnelled through `routeByRegion(allocationRow.region, share)` → which in turn used the `BENCHMARK` region weights, dumping ~60 % of the residual back into `equity_us` for any Equity-Global / Equity-DM row. Geomap layer (`src/lib/geomap.ts`) was doing the same thing on the other axis: `REGION_BUCKETS` carried explicit `"Other DM" → {NA: 28, Europe: 7, Other: 65}` and `"Other" → {NA: 14, Europe: 4, EM: 35, Other: 47}` rules that pushed several percentage points of the residual into NA / Europe / EM tiles before falling through to the grey "Other" tile.
  - **Fix.** New CMA bucket `equity_other` ("Other / Residual", μ 7.2 % · σ 17 %, developed-world-equity blend) added to `AssetKey`, `BASE_SEED`, `CMA_BUILDING_BLOCKS`, both correlation matrices `C` / `CRISIS_C` (mirroring developed-equity's correlation profile against US/EU/UK/CH/JP/EM/Thematic + the rest), `WHT_DRAG`, both `mapAllocationToAssets` map inits, the `equityKeys` frontier list and `CORR_DISPLAY_ORDER`. The `routeByRegion(unmappedShare)` call in `mapAllocationToAssetsLookthrough` is replaced by `map.equity_other += unmappedShare`. `REGION_BUCKETS["Other DM"]` and `["Other"]` rows are deleted (with explanatory comment) so those labels fall through `classifyCountry` → `otherPct` honestly. Per code-review, Ireland was also removed from `EUROPE_COUNTRIES` and Canada was removed from `COUNTRY_TO_EQUITY_KEY` so `equity_us` reflects only the published US share and Canada flows through `equity_other` (geographic NA tile on the geomap is unchanged — the geographic-vs-CMA distinction is documented in the Methodology + Geo Map tooltip).
  - **UI surfacing.** `CurrentAllocationCard` localizes the new bucket label to "Sonstige / Rest" in DE (English label is the CMA default "Other / Residual"). `GeoExposureMap` adds a dedicated grey legend tile (`data-testid="build-geomap-other-tile"`, bilingual tooltip) when `otherPct > 0.5` so the residual is visible at a glance instead of only in the small caption beneath the legend grid. `chartColors.ts` gains an `equityOther` colour (neutral grey `hsl(220, 12%, 55%)`) plus `RULES` / `ORDER_RULES` entries that match both DE and EN labels and sort the bucket *after* all named equity buckets but inside the equity group (rank 35).
  - **Catalog whitelists.** `CMA_VALID_KEYS` (`settings.ts`), `ASSET_KEYS` (`appDefaults.ts`, api-server `app-defaults.ts`), `ASSET_KEYS_ORDER` (`appDefaultsPresets.ts`), `AppDefaultsAssetKey` (`admin-api.ts`) and `CMA_KEYS_UI` (`AppDefaultsPanel.tsx`) all extended so operators can override μ / σ for the new bucket from `/admin → Globale Defaults`.
  - **i18n.** `bb.src.equity_other` (DE + EN — Methodology building-blocks card) and `build.geomap.other` (DE + EN — caption beneath the geo legend) reworded to explicitly call out the residual nature and the no-silent-rerouting promise.
  - **Methodology page.** "Conservative country map" paragraph (`Methodology.tsx`) rewritten DE + EN to explain the residual bucket, the leak it replaces, and where the residual is now visible in the UI. The `noteFor` building-blocks legend gets a new `equity_other: "Catch-all residual (justETF "Other" + Ireland + Canada)"` row in both languages.
  - **Monte Carlo deliberately untouched** — `monteCarlo.ts` routes from user-set allocation rows where `equity_other` never appears (it only emerges from look-through), so its `bucketKey()` switch needs no new case.
  - **Tests.** Two new regression tests in `tests/engine.test.ts`: (1) the IE00BKX55T58 case asserts `total ≈ 1.0`, `equity_us` reflects the published US share only, and `equity_other ≈ 15 %` (Other 10.87 + Ireland 1.13 + Canada 3.06); (2) a `buildRegionWeights` test pins that `"Other DM" + "Other"` slices flow entirely into `otherPct` with zero leak into NA / Europe / EM. New e2e test in `tests/e2e/explain-portfolio.spec.ts` ("100 % FTSE Developed World surfaces 'Other / Residual' on Current Allocation and Geo Map legend") asserts the localized residual row on the Current Allocation card and a non-zero `build-geomap-other-tile`.

### 2026-05 (lookthrough-runtime-persistence — Task #238 round 8)
- **Goal.** Address the standing code-review concern that off-catalog
  Explain rows lose their look-through profile on reload. The earlier
  rounds had to keep the persistence path off the public scrape route
  itself (round-4 reviewer correctly flagged a public-route write to
  the curated pool overrides as an admin-boundary bypass — public
  callers carry no admin token), so a server-side persistence path is
  not viable. Round 8 instead persists the runtime profile registry to
  the operator's own browser via `window.localStorage`, so the next
  reload of the same browser tab still has the off-catalog profile
  available without re-running the public scrape and without granting
  unauthenticated callers any write capability against the canonical
  catalog.
- **`src/lib/lookthrough.ts`.** Added a per-browser persistence layer
  around the existing `RUNTIME_PROFILES` registry: `registerRuntime
  LookthroughProfile` now mirrors writes into `localStorage` under
  the key `investment-lab.lookthrough.runtime.v1`, and module load
  hydrates `RUNTIME_PROFILES` from that key (with a strict shape
  guard that drops malformed entries). `clearRuntimeLookthrough
  Profiles` also clears the cache. All storage access is wrapped in
  `try/catch` and feature-detected via `hasLocalStorage()` so server
  builds (`buildLookthrough` runs in the engine tests under Node)
  remain unaffected. Documented at the comment block above
  `RUNTIME_PROFILES` why a public-route disk write was rejected and
  why the canonical pool overrides remain the only authoritative
  source — the cache only patches in user-typed off-catalog rows the
  central pool doesn't yet cover.
- **Methodology (DE + EN).** Bumped the `manual-isin` section to
  `v2.0 · May 2026` and appended a fourth bullet under "Datenquellen
  (Reihenfolge)" / "Data sources (priority order)" describing the
  off-catalog look-through cache, its `localStorage` key, and the
  reload-survival guarantee (in both languages, per the Methodology
  sync rule).
- **Tests.** Added `tests/runtimeLookthroughPersistence.test.ts` (5
  cases) under the `engine` vitest project: write-through to
  localStorage, survival across a `vi.resetModules()`-simulated
  reload, full clear semantics, corrupt-JSON tolerance, and per-entry
  shape-guard rejection. Engine suite goes 222 → 423 + 2 skipped over
  17 files (full engine group).
- **Validation.** `pnpm run typecheck` clean. `pnpm --filter
  @workspace/investment-lab run test:engine` 423 passed / 2 skipped
  (17 files). E2e remains green from round 7.

### 2026-05 (lookthrough-per-isin-hardening — Task #238 round 3)
- **Goal.** Address the second code-review rejection of Task #238: (a) drop the
  ALIAS-substitution shortcut entirely (some entries were misclassifications —
  Nasdaq-100 ≠ broad-tech, Robotics/AI ≠ broad-tech, CleanEnergy ≠ ESG, MSCI
  World ≠ S&P 500, EUR-Govt ≠ Global Aggregate); (b) make the public
  look-through scrape strictly read-only (no direct-write or PR side effect);
  (c) hard-block the manual-ISIN UX on scrape failure with a destructive toast
  instead of silently parking the row in the unmapped alert; (d) add regression
  tests covering both anti-substitution and the user-reported nine-ISIN
  UK-leaning portfolio attribution.
- **`src/lib/lookthrough.ts`.** Removed the `ALIAS` map and the
  `key = ALIAS[isin] ?? isin` shortcut from `profileFor`. Look-through is now
  strictly per-ISIN. Two new structured tables sit alongside the curated
  primary `PROFILES` map:
  - **`SHARED_BASKET_PROFILES`** (~18 entries): true index / share-class
    equivalents that legitimately share an underlying basket (multiple S&P 500
    trackers, MSCI EM Amundi mirror, Global Aggregate hedged share class, gold
    ETCs, Bitcoin ETPs). The `variantOf()` helper builds each variant's profile
    from a primary, applying per-ISIN currency overrides for hedged share
    classes.
  - **`DISTINCT_PROFILES`** (5 hand-curated entries): funds that previously
    aliased onto a misclassified sibling (LU0274208692 MSCI World, LU1681038243
    Nasdaq-100, IE00BLCHJB90 Robotics/AI, IE00BDBRT036 Clean Energy,
    IE00B3VTML14 EUR Govt 3–7yr) — each ships its own geo/sector/currency.
  Both tables are merged into `PROFILES` at module load via `Object.assign`,
  so call sites are unchanged.
- **`artifacts/api-server/src/routes/etf-preview.ts`.** The public
  `GET /api/lookthrough-scrape/:isin` endpoint no longer imports
  `openAddLookthroughPoolPr` or `directWriteMode` and no longer persists the
  scrape into the pool overrides file. It is now strictly read-only. Per the
  threat model, the public route must not become a repository-mutation hole —
  pool persistence stays in the token-gated admin API.
- **`src/lib/etf-api.ts`.** `scrapeLookthroughForIsin` now returns a
  discriminated union `ScrapeLookthroughResult` (`{ ok: true, profile }` or
  `{ ok: false, reason, message }`) with reasons `invalid_isin |
  network_error | rate_limited | lookthrough_incomplete | scrape_failed`. The
  prior `null` return type would have made it impossible to surface a useful
  failure message in the UI.
- **`src/components/investment/ExplainPortfolio.tsx` (`setManualIsin`).**
  Awaits the new result and, on failure, fires a destructive `toast.error`
  with bilingual reason text. The row no longer slides silently into the
  destructive "unmapped ETFs" alert — the user is told *why* the look-through
  is missing (network, rate limit, justETF returned no data).
- **Tests (`tests/engine.test.ts`).** Added two regression suites under the
  Task #238 group:
  - **"distinct funds keep distinct profiles"** — asserts FTSE 100 ≠ S&P 500,
    MSCI World ≠ S&P 500, Robotics/AI ≠ S&P 500 IT, Clean Energy ≠ ESG
    global, EUR Govt 3–7yr ≠ Global Aggregate. Locks down the anti-
    substitution invariant so a future ALIAS-style shortcut would fail CI.
  - **"nine-position UK-leaning portfolio surfaces UK geo attribution"** —
    builds a 9-ISIN portfolio (FTSE 100 35% + S&P 500 + MSCI Europe + EM +
    Japan + Global Agg GBP-Hedged + Gold + Bitcoin) and asserts no row drops
    into `unmappedEtfs` and the equity-geo aggregate's "United Kingdom"
    component is ≥ 35pp. Pins the user-reported regression where FTSE 100 was
    being routed through a non-UK sibling profile.
- **Methodology (DE + EN).** Updated the "Gap-free coverage (Task #238)"
  block in `src/components/investment/Methodology.tsx` to (a) document that
  the public scrape path is read-only with a brief threat-model rationale,
  (b) describe the new failure-toast behaviour explicitly, and (c) explain
  the per-ISIN model with the three table groups (`PROFILES`,
  `SHARED_BASKET_PROFILES`, `DISTINCT_PROFILES`) and the explicit absence of
  any ALIAS lookup.
- **Validation.** `pnpm run typecheck` clean across investment-lab and
  api-server. `pnpm --filter @workspace/investment-lab run test:engine` →
  416 passed / 2 skipped (16 files). New Task #238 suite goes from 4 → 6
  tests, all green.

### 2026-05 (lookthrough-coverage-guarantee — Task #238)
- **Goal.** Guarantee every portfolio ETF has its own
  look-through profile so the geo / sector / single-stock
  aggregates and the home-bias card never silently miss a
  position. Six concrete steps:
  1. **Backfill.** Relaxed the
     `/admin/backfill-lookthrough-pool` gate to require only
     `geo + sector` (matching the runtime `addInto` contract);
     `topHoldings` and `currency` stay optional.
     `LookthroughPoolEntry` in `artifacts/api-server/src/lib/github.ts`
     was loosened to mark those two fields optional too — bond /
     money-market / synthetic ETFs that scrape geo+sector but no
     holdings table now produce a usable pool entry. The
     re-run added 7 entries (IE0005042456, IE00B3F81409,
     LU0378818131, IE00BG47KH54, IE00BDBRDM35, IE00BG47KB92,
     LU0290355717). The remaining ~12 catalog gaps are
     bond / gold / money-market funds where justETF publishes
     no breakdown at all — those are now caught by the loud-fail
     UI below.
  2. **Tightened admin add-flows.** All four catalog add /
     swap routes — `POST /admin/buckets/:key/alternatives`,
     `PUT /admin/buckets/:key/default`,
     `POST /admin/buckets/:key/pool`, plus the alternative
     scraper inside `POST /admin/instruments` — now refuse to
     persist when the on-demand
     `scrapeLookthrough(isin)` cannot return at least
     `geo + sector`. The route returns
     `422 lookthrough_incomplete` with a localized message.
     Operators can override with a `force: true` body flag —
     the new ISIN is then accepted but will appear under the
     destructive "unmapped ETFs" alert until a real profile
     is registered.
  3. **On-demand scrape for off-catalog manual ISINs in
     Explain.** New public route
     `GET /api/lookthrough-scrape/:isin` (in
     `artifacts/api-server/src/routes/etf-preview.ts`) shares
     the same per-IP token-bucket rate limiter, in-memory TTL
     cache and in-flight dedup as `/etf-preview` so it cannot
     be used as an open scraping proxy. The Explain tab calls
     it from `setManualIsin` whenever the typed ISIN is
     well-formed AND has no static profile. The scraped
     `{geo, sector, currency, topHoldings}` is registered
     into a new in-memory runtime registry
     (`registerRuntimeLookthroughProfile` in
     `artifacts/investment-lab/src/lib/lookthrough.ts`); the
     existing `profileFor(isin)` falls back to that registry
     after the static `PROFILES` lookup. A new
     `runtimeProfileVersion` state in `ExplainPortfolio.tsx`
     is bumped on registration so the `portfolio` `useMemo`
     recomputes — the destructive alert clears for that row
     without a manual reload, and a Sonner toast confirms
     "Look-through profile loaded for ISIN".
  4. **Loud-fail UI.** `LookthroughResult` now carries a
     structured `unmappedEtfs: Array<{isin, name, weight}>`
     (`UnmappedEtfRow` in `lookthrough.ts`) alongside the
     legacy human-readable `unmapped: string[]`.
     `LookThroughAnalysis.tsx` renders a destructive `Alert`
     with `data-testid="alert-lookthrough-unmapped"` (and a
     `unmapped-row-${isin}` testid per row) that ALWAYS sits
     above the collapsible body — operators see missing
     positions even when the panel is collapsed. New i18n
     keys `build.lookthrough.unmapped.title` and
     `build.lookthrough.unmapped.desc` (DE+EN) carry the
     copy.
  5. **`validateLookthroughCoverage()` + tests.**
     `artifacts/investment-lab/src/lib/etfs.ts` exports
     `validateLookthroughCoverage(hasProfile)` returning
     `LookthroughCoverageGap[]` for every catalog default /
     alternative / pool slot whose ISIN is missing a
     profile. Three new Vitest cases in
     `artifacts/investment-lab/tests/engine.test.ts` lock
     the contract: (a) `unmappedEtfs[]` is the structured
     mirror of `unmapped[]`; (b) returns empty for a
     fully-mapped portfolio; (c) every catalog DEFAULT ISIN
     is covered (the most-shown picker option per bucket).
     Alternative + pool gaps are tolerated because they're
     guaranteed to surface live in the loud-fail alert and
     the on-demand scrape clears off-catalog rows.
- **Methodology page sync.** The Look-Through Routing and
  Manual ETF Entry sections in
  `artifacts/investment-lab/src/components/investment/Methodology.tsx`
  were updated in both languages to document (i) the
  destructive "unmapped ETFs" alert, (ii) the new
  `/api/lookthrough-scrape/:isin` endpoint and the runtime
  registry, and (iii) the operator-override `force` flag on
  admin add-flows.

### 2026-05 (explain-import-lookthrough-regression-coverage — Task #236)
- **Reported symptom.** A user reported that pasting a portfolio
  into the Explain tab's import dialog left the **Effective
  Geographic Equity Exposure (Look-Through)** card showing stale
  numbers until they toggled any ETF row's picker (which then
  "self-healed" the card).
- **Investigation.** Traced both row writers — the import path
  (`buildPositionsFromMapping` → `replaceWithImportedRows`) and the
  picker path (`pickIsinForRow` / `pickUnassignedInstrumentForRow` /
  the manual-add helpers) — through the engine. Both produce
  byte-identical `synthesizePersonalPortfolio` +
  `buildLookthrough` output for the user's 9-ISIN reproducer
  (`equityWeightTotal`, `geoEquity`, `geoFixedIncome`). React state
  for `state.positions` is replaced atomically by
  `replaceWithImportedRows` and the `portfolio` `useMemo`'s
  `[state.positions, state.baseCurrency, lang]` deps already trigger
  a recompute. We could NOT reproduce a stale-value delta in
  Vitest, jsdom-component, or headless Playwright runs against the
  current code.
- **No code change.** No engine, lookthrough, allocation, hedging,
  persistence, or `replaceWithImportedRows` behaviour changed in
  this entry. The Methodology page is unaffected.
- **Regression coverage added.** Two complementary tests now lock
  the import path's look-through output so any future drift would
  be caught immediately:
  1. **Engine parity** in `tests/explainImportPortfolio.test.ts`
     ("Task #236 — paste-import vs picker look-through parity")
     feeds the user's 9-ISIN reproducer through both writers and
     asserts numerically identical `equityWeightTotal`,
     `fixedIncomeWeightTotal`, `geoEquity` and `geoFixedIncome`.
  2. **UI regression** in `tests/e2e/explain-import-lookthrough.spec.ts`
     pastes the same 9-ISIN reproducer through the real Explain
     import dialog (CHF base) and reads each visible region cell of
     `GeoExposureMap` directly from the rendered DOM — asserting
     each `{NA, Europe, Switzerland, Japan, EM}` percent is within
     ±0.15 of the engine's expected value, with NO picker toggle in
     between. Reproduces the originally-reported user flow end-to-
     end and would fail loudly if any future React-state regression
     causes the displayed look-through to lag the engine.

### 2026-05 (explain-import-replace-semantics — Task #232)
- **Bugfix.** Pasting a portfolio into the Explain tab's import dialog
  used to **append** the imported rows on top of whatever was already
  in the editor (typically state restored from the previous session
  via `localStorage`). When the same ISIN appeared in both the stale
  and the imported set the row weights effectively doubled, and the
  derived metrics (asset-class allocation totals, home-bias share,
  look-through baskets) showed wrong figures until the user manually
  re-picked an ETF — the re-pick rebuilt the array and the stale
  duplicates happened to be overwritten. The dialog represents
  "this is my portfolio", so the correct semantics is **replace**.
- **Fix.** `ExplainPortfolio.appendImportedRows` was renamed to
  `replaceWithImportedRows` and now sets
  `state.positions = rows` (and resets `weightDrafts` to match the
  imported rows) instead of pushing onto the existing arrays. The
  import dialog gained a `hasExistingPositions` prop: when true it
  shows a destructive `Alert` (`data-testid="explain-import-replace-warning"`)
  above the textarea and the submit button label switches from
  "Import N positions" to "Replace with N positions" so the user
  cannot trigger the destructive operation by accident.
- **Copy.** `explain.import.desc` (DE+EN) was rewritten — the prior
  text explicitly promised "rows are appended … nothing is
  overwritten", which is no longer true. Two new keys
  (`explain.import.submit.replace`,
  `explain.import.warning.replacesExisting`) were added in both
  languages.
- **Tests.** Two new unit cases in
  `tests/explainImportPortfolio.test.ts` lock in (a) that the rows
  array passed to setState is exactly the imported rows (sums to
  100% rather than the 200% the old append path produced when stacked
  on a stale row), and (b) that `synthesizePersonalPortfolio` +
  `evaluateHomeBias` produce identical figures whether the rows came
  from the import path or from a fresh manual build. The mobile e2e
  spec at `tests/e2e/explain-import.spec.ts` already wipes
  `localStorage` before importing, so its post-import row count and
  total-weight assertions remain correct under the new semantics; the
  test title was updated from "appends rows" to "replaces editor
  contents" to reflect the new contract.
- Files: `artifacts/investment-lab/src/components/investment/ExplainPortfolio.tsx`,
  `artifacts/investment-lab/src/components/investment/ImportPortfolioDialog.tsx`,
  `artifacts/investment-lab/src/lib/i18n.tsx`,
  `artifacts/investment-lab/tests/explainImportPortfolio.test.ts`,
  `artifacts/investment-lab/tests/e2e/explain-import.spec.ts`.

### 2026-05 (explain-import-smart-delimiters — Task #230)
- **Smarter paste parsing.** `parseImportText` in
  `ImportPortfolioDialog.tsx` now auto-detects the column separator per
  line: `/`, tab, `;`, or `,` (first one that appears wins). This makes
  pastes straight out of Excel / Google Sheets (TSV), European CSV
  (`;`-separated), and standard CSV (`,`-separated) work without the
  user having to massage the text into the original
  `ISIN / weight` shape. The original `/` syntax keeps working
  unchanged.
- **Optional header row.** A header line on the FIRST non-empty,
  non-comment line that contains `ISIN` plus a weight synonym
  (`weight`, `gewicht`, `anteil`, `allocation`, or `%`) is detected
  and skipped. Subsequent header-shaped lines further down in the
  paste are intentionally NOT skipped — they surface as
  `invalid-isin` rows so a malformed paste is visible.
- **Comma-decimal weights with comma column-separator.** When a line
  uses `,` as the column separator, a SECOND comma in the weight
  half is still treated as the decimal mark (e.g.
  `IE00…,12,5` parses to `weight = 12.5`).
- **Tests.** 7 new unit cases in
  `tests/explainImportPortfolio.test.ts` cover TSV, `;`-CSV, `,`-CSV
  with comma-decimal weight, English (`ISIN\tWeight`) and German
  (`ISIN;Gewicht`) header rows, the "only first line is a header"
  rule, and a regression check that the original `ISIN / weight`
  syntax is unaffected.
- Files: `artifacts/investment-lab/src/components/investment/ImportPortfolioDialog.tsx`,
  `artifacts/investment-lab/tests/explainImportPortfolio.test.ts`.

### 2026-05 (explain-copy-as-text — Task #229)
- **New affordance.** The Explain positions card gained a **Copy as
  text** button (data-testid `explain-copy-as-text`) next to the
  existing **Import** button. It is the symmetric counterpart of the
  paste-to-import flow added in Task #227.
- **What it copies.** All current positions that carry an ISIN, one per
  line in the same `ISIN / weight` format the import dialog accepts —
  so the output round-trips cleanly back into Import (or any external
  spreadsheet / advisor email).
- **Order.** Lines are emitted in the same order the editor renders
  them: catalog asset-class groups in catalog order (`bucketsByAssetClass`
  → `positionsByBucket`), then the **Manual entries** pseudo-group, then
  the legacy **Unassigned** tail.
- **Skipped rows.** Cash sentinel rows and any half-filled manual rows
  with an empty ISIN are skipped (the import format requires an ISIN
  per line). The button itself is disabled when no row carries an ISIN.
- **Feedback.** Success toast reads "Copied N positions to clipboard"
  / "N Positionen in die Zwischenablage kopiert"; clipboard failures
  surface as an error toast. DE + EN copy added under
  `explain.btn.copyAsText` and `explain.copyAsText.toast.*` in
  `i18n.tsx`.
- Files: `artifacts/investment-lab/src/components/investment/ExplainPortfolio.tsx`,
  `artifacts/investment-lab/src/lib/i18n.tsx`.

### 2026-05 (explain-paste-to-import — Task #227)
- **New affordance.** The Explain tab gained an **Import** button next
  to the Reset button in the positions card header. It opens a small
  dialog (`ImportPortfolioDialog.tsx`) where the user can paste one
  position per line as `ISIN / weight` (weight in %, comma or dot
  decimals both accepted, lines starting with `#` treated as comments).
- **Routing per line.**
  - **catalog** → ISIN found in the curated catalog AND assigned to a
    bucket → row appended as a normal catalog row in that bucket
    (`bucketKey` = bucket of the ISIN, no `manualMeta`).
  - **found-unassigned** → ISIN found in INSTRUMENTS but not slotted
    into any bucket → manual row, seeded with the instrument's name /
    currency / TER and a guessed assetClass+region via
    `inferAssetClassRegionFromInstrument` (same heuristic the
    Unassigned-Instrument picker uses).
  - **off-universe** → valid ISIN format but not in the catalog →
    manual row at the bottom with default Equity / Global meta.
  - **error** → invalid ISIN or invalid weight → reported per-line in
    the dialog preview, NOT imported.
- **Append-only.** Existing positions are preserved; imported rows are
  pushed to the tail of `state.positions` and the matching weight
  drafts are seeded so the imported weights show up in the inputs
  immediately.
- **Subgroup ordering.** Within a single import, rows are emitted in
  three blocks: catalog rows first (in input order), then
  found-unassigned rows (in input order), then off-universe rows last
  (in input order) — even when the source paste interleaves the kinds.
- **Two-step error gate.** When the paste contains any unparseable
  line, the first click on Import does NOT commit anything — it only
  flips the button into a "Review errors" state so the user sees the
  per-line error list. A second click ("Import {n} anyway") commits
  the valid subset. Editing the textarea resets the gate so the user
  must reconfirm.
- **Summary toast + sum check.** After import, a `toast.success` shows
  `Imported {total} positions ({catalog} catalog, {unassigned}
  unassigned, {offUniverse} off-universe)`. If the imported weights
  don't sum to 100% (±0.01), a `toast.warning` reminds the user to use
  Normalize. The dialog itself also surfaces the sum-≠-100 warning
  inline in the preview before submission.
- **Per-row origin badge.** `PositionRow` now derives a small badge
  for any manual row whose `isin` is set:
  - `not part of the ETF universe` (off-universe)
  - `ETF found, but not assigned to a bucket` (found-unassigned)
  Derived from the live catalog state, so it's accurate regardless of
  whether the row was added via paste-import or by hand. Empty-ISIN
  manual rows show nothing.
- **i18n.** Full DE+EN coverage under the `explain.import.*` and
  `explain.row.badge.*` namespaces in `src/lib/i18n.tsx`.
- **Tests.** New `tests/explainImportPortfolio.test.ts` covers the
  pure parser (`parseImportText`), the catalog mapper
  (`classifyImportLines`) and the row builder
  (`buildPositionsFromMapping`) — happy-path catalog/off-universe
  routing, comma decimals, comment/blank-line skipping, invalid ISIN
  and invalid weight error reporting, 1-based line numbers, and the
  off-universe → manual-row default seeding. New
  `tests/e2e/explain-import.spec.ts` covers the dialog end-to-end on
  the iPhone-13 viewport: open dialog → paste a mixed catalog +
  off-universe paste → live preview → submit → two rows appended →
  total reflects imported weights → off-universe badge visible →
  persistence across reload.
- **No engine change.** Methodology page does not need updating —
  this is a pure workspace affordance, not engine logic.
- **Files.** `artifacts/investment-lab/src/components/investment/ImportPortfolioDialog.tsx` (new),
  `…/ExplainPortfolio.tsx` (Import button, `appendImportedRows`
  helper, dialog mount, per-row origin badge in `PositionRow`),
  `src/lib/i18n.tsx` (new keys), `tests/explainImportPortfolio.test.ts`
  (new), `tests/e2e/explain-import.spec.ts` (new).

### 2026-05 (blended-bucket-badge — Task #222)
- **New affordance.** Allocation rows whose bucket holds 2+ ETFs in
  the `etfImplementation` array now show a small "N ETFs" badge
  (Layers icon + count) next to the row's region label, with a
  bilingual (DE+EN) tooltip explaining that the look-through view
  blends the ETFs proportionally to their weights so the metrics,
  geography, currency and Monte Carlo numbers reflect a weighted mix
  rather than a single fund.
- **Surfaces.** Build's "Allokation nach Bucket (deine Auswahl)"
  table (`BuildPortfolio.tsx`), Explain's `CurrentAllocationCard`
  per-bucket table, and Compare's "Structural Differences" table —
  the Compare row prefixes each badge with `A` / `B` so operators
  can tell which side is blended.
- **Implementation.** New shared
  `artifacts/investment-lab/src/components/investment/BlendedBucketBadge.tsx`
  exports the `BlendedBucketBadge` component plus two pure helpers
  (`bucketEtfCounts`, `bucketKeyFor`) so each table can compute its
  per-row count from the `bucket` field on `ETFImplementation`
  (`${assetClass} - ${region}`). New i18n keys
  `blendedBucket.badge` and `blendedBucket.tooltip` (DE+EN) drive the
  copy. No engine, MC, or look-through routing change — purely a
  visual hint over the existing data flow added by Task #221.

### 2026-05 (lookthrough-routing-multi-etf-bucket — Task #221)
- **Bug fixed.** `mapAllocationToAssetsLookthrough` in
  `artifacts/investment-lab/src/lib/metrics.ts` previously built a
  single-ISIN `Map<bucket, isin>` by iterating `etfImplementation` and
  overwriting on collision. When two or more ETFs shared the same
  bucket key (e.g. an MSCI World fund + an S&P 500 fund both assigned
  to a single Equity-Global slot in an Explain workspace), the map only
  retained the last ETF and the entire combined bucket weight was
  routed through that one geo profile.
- **Fix.** The map is now `Map<bucket, Array<{isin, weight}>>`. For
  each equity allocation row the function distributes the row weight
  across all ETFs in the bucket proportionally to each ETF's weight,
  routes each slice independently through its own profile (with the
  existing `routeByRegion` fallback applied per slice when an ETF
  lacks a usable equity profile or has unmapped country labels), and
  sums the contributions. Total row weight is conserved; the visual
  look-through cards (`buildLookthrough`, `buildCurrencyOverview`)
  were already correct and are unchanged.
- **Surfaces affected.** All metrics that consume
  `mapAllocationToAssetsLookthrough` — portfolio expected return,
  Sharpe, vol/beta/alpha, TE decomposition, the
  `CurrentAllocationCard` and `PortfolioMetrics` numbers, Monte Carlo
  routing, the Compare tab, and the PDF report — now reflect a true
  weighted blend of all ETFs in a bucket. Previously only the
  Geography / Currency / Top-Holdings / Home-Bias look-through cards
  showed the correct picture; the metrics cards and downstream
  surfaces silently disagreed.
- **Test.** New regression in
  `artifacts/investment-lab/tests/engine.test.ts`
  (`"mapAllocationToAssetsLookthrough blends multiple ETFs sharing the
  same bucket"`) constructs a single Equity-Global allocation row with
  two ETFs in the same bucket (MSCI Europe + S&P 500), verifies total
  weight conservation, asserts that the blended UK exposure lies
  strictly between the two single-ETF results, and pins both UK and
  US exposure to the closed-form 60/40 weighted blend of the
  single-ETF runs.

### 2026-05 (admin-instruments-regenerate-description — Task #211)
- **What changed.** The admin **Instruments** sub-tab now lets operators
  re-derive the description for any registered ISIN without manually
  copy-pasting from justETF.
  - **Per-row icon button** (`Sparkles`,
    `data-testid="button-instrument-regenerate-${isin}"`) sits next to
    the existing edit/delete actions. Clicking it calls
    `POST /admin/instruments/:isin/regenerate-description`, which:
    1. tries justETF EN+DE descriptions in parallel via the same
       `scripts/lib/justetf-extract.mjs` extractors used by the scheduled
       refresh; if both succeed, `commentSource` is stamped `justetf`,
    2. otherwise falls back to `describeEtf` from
       `scripts/lib/describe-etf.mjs` using the union of pool profile +
       lookthrough overrides as input; on success `commentSource` is
       stamped `auto`,
    3. returns 422 `no_description_source` if neither path produces text.
    On success the helper persists via `openInstrumentPr({action: "edit"})`
    so direct-write vs PR mode behaves identically to PATCH /admin/instruments.
  - **Edit-form button** (`button-instrument-refresh-description`) inside
    `InstrumentForm` runs the same endpoint with `{dryRun: true}`,
    populates the Comment textarea from the response, and lets the
    operator review before clicking Save. Mirrors the existing
    `handlePrefill` "preview-only" contract.
  - **Manual-row guard.** When `commentSource === "manual"` (or, in the
    edit form, when the manual row already has non-empty text), both
    flows surface a `window.confirm` warning before overwriting.
  - **Provenance priority.** justETF wins when available; auto is the
    fallback. Manual content is only ever overwritten via these explicit
    operator-initiated actions (never by background scrapers).
  - **Scrape failure vs empty description.** The server distinguishes
    "fetch threw / 5xx" (hard error → 502 `scrape_failed`, existing
    description untouched, operator sees an error toast) from "fetched
    OK but page has no description field" (legitimate empty → fall
    through to auto). Only when BOTH locales succeed-but-empty does the
    auto template ever overwrite a justETF row.
  - **Edit-form provenance round-trip.** The `InstrumentForm` draft now
    carries `commentDe` + `commentSource` (seeded from the existing
    row, refreshed by the dry-run regenerate). On Save, those fields
    flow through PATCH /admin/instruments and `stampSourceIfMissing`
    leaves the regenerated `justetf` / `auto` tag intact. If the
    operator subsequently types into the Comment textarea, its
    onChange clears `commentSource` so the server stamps it back to
    `manual` — keeping the "edited prose = manual" invariant.
- **API contract.** `lib/api-spec/openapi.yaml` adds the new path and
  schemas `RegenerateDescriptionRequest` (optional `dryRun: boolean`)
  + `RegenerateDescriptionResponse` (`isin`, `comment`, `commentDe`,
  `commentSource`, `prUrl`, `prNumber`). Codegen regenerated. Client
  helper: `adminApi.regenerateInstrumentDescription(isin, { dryRun? })`
  in `artifacts/investment-lab/src/lib/admin-api.ts`.
- **Files.**
  - `lib/api-spec/openapi.yaml`
  - `artifacts/api-server/src/routes/admin.ts` (new
    `resolveInstrumentDescription` helper + route)
  - `artifacts/api-server/src/types/justetf-scraper.d.ts` (added
    `USER_AGENT`, `fetchWithRetry`, plus a shim for `describe-etf.mjs`)
  - `artifacts/investment-lab/src/lib/admin-api.ts`
  - `artifacts/investment-lab/src/components/admin/InstrumentsPanel.tsx`
- **Validation.** typecheck + `test:components` + `test:engine` +
  `test:e2e:admin` per `replit.md` validation policy (multi-concern: new
  server route + admin UI surface). All pass.

### 2026-05 (admin-instruments-separate-de-comment-field)
- **What changed.** The admin Instruments edit form
  (`src/components/admin/InstrumentsPanel.tsx → InstrumentForm`) now
  exposes the German `commentDe` field as its own textarea, separate
  from the existing English `comment` field. Previously only `comment`
  was editable in the form, so curating the German prose required
  hand-editing `etfs.ts` — and any in-form edit to the EN field that
  carried `commentDe` along would feel like "EN and DE moved
  together" because there was no way to split them.
- **Behaviour.**
  - Field labels are now **Comment (EN) / Kommentar (EN)** and
    **Comment (DE) / Kommentar (DE)**.
  - Empty DE textarea → `commentDe` is dropped from the payload
    (`undefined`), so the row falls back to the EN comment in DE
    locale (matches the existing display resolver in
    `etfImplementationCommentText.ts` and the new
    `InstrumentsPanel` table cell).
  - Editing either textarea clears `commentSource` so the server's
    `stampSourceIfMissing` flips it back to `"manual"` on Save —
    consistent with the contract introduced in Task #211.
  - The "Refresh from justETF" button continues to populate both
    fields in one shot (the dry-run regenerate endpoint already
    returned `commentDe`); its tooltip now says "EN + DE" explicitly.
- **Test hook.** New stable testid
  `textarea-instrument-comment-de`.
- **Files.** `artifacts/investment-lab/src/components/admin/InstrumentsPanel.tsx`.
- **Validation.** Pure JSX/component change → typecheck PASS per
  `replit.md` validation policy. No server, schema, engine or catalog
  contracts were touched (the wire shape and PATCH validator already
  accept `commentDe` end-to-end since Task #207 / #211).

### 2026-05 (admin-instruments-description-column)
- **What changed.** The admin **Instruments** sub-tab
  (`/admin/catalog/instruments`, rendered by
  `src/components/admin/InstrumentsPanel.tsx`) now exposes a
  **Description / Beschreibung** column between *Domizil* and *Verwendet
  in*. Each cell renders the localized comment text — `commentDe` when
  the active locale is `de` and the field is non-empty, otherwise the
  English `comment` — clamped to two lines (`line-clamp-2`,
  `max-w-[28rem]`) with the full text in the cell's `title` tooltip on
  hover. A small uppercase provenance badge sits to the left of the text
  so operators can spot the source at a glance:
  - `justETF` (emerald) — `commentSource === "justetf"`
  - `auto` / `auto` (amber) — `commentSource === "auto"`
  - `manual` / `manuell` (muted) — `commentSource === "manual"` or
    legacy rows with `commentSource` undefined
  Empty rows render an em-dash placeholder. The empty-state row's
  `colSpan` was bumped from 7 → 8 to match.
- **Search.** The existing search input now matches against `comment`
  and `commentDe` in addition to ISIN/name/currency/domicile, so an
  operator can find ETFs by keywords from the description text.
- **Test hooks.** Two new stable testids:
  `cell-instrument-description-${isin}` and (when present)
  `badge-instrument-comment-source-${isin}`.
- **Files.** `artifacts/investment-lab/src/components/admin/InstrumentsPanel.tsx`.
- **Validation.** Pure JSX/component change → typecheck + unit tests
  per `replit.md` validation policy. Both pass; no logic changed in the
  catalog/engine paths so e2e was not re-run.

### 2026-05 (persist-auto-etf-descriptions — Task #207)
- **What changed.** ETF "comment" prose is now persisted into the catalog
  rather than re-derived at render time on every Build/Explain mount.
  Two new optional fields on `InstrumentRecord` / `ETFRecord` /
  `ETFDetails` / `ETFImplementation` carry the data:
  - `commentDe?: string` — German-language counterpart to the existing
    English `comment`. The Build tab's `EtfImplementationCommentCell`
    and the resolver in `src/lib/etfImplementationCommentText.ts`
    prefer it when the active locale is `de` and the field is
    non-empty.
  - `commentSource?: "manual" | "justetf" | "auto"` — provenance tag.
    Undefined for legacy curated rows (treated as operator-curated:
    don't overwrite). The admin pane stamps `"manual"` on every
    operator-driven add / edit (`/admin/add-isin`,
    `/admin/render-entry`, `/admin/bucket-alternatives` and
    `/render`, `/admin/bucket-alternatives/bulk`, POST + PATCH
    `/admin/instruments`); the auto-backfill stamps `"justetf"` (or
    `"auto"` for the deterministic-template fallback).
- **Auto-backfill.** New script
  `artifacts/investment-lab/scripts/backfill-comments.mjs` scans
  `src/lib/etfs.ts` for INSTRUMENTS rows whose `comment` is empty
  AND `commentSource` is missing, fetches the justETF
  "Investment objective" / "Anlageziel" prose for both EN + DE via
  the existing `PREVIEW_EXTRACTORS.description` extractor, and
  rewrites the row in place (adding `comment`, `commentDe` and
  `commentSource: "justetf"`). The script is wired as a best-effort
  tail step into `refresh-justetf.mjs` and `refresh-lookthrough.mjs`
  so every scheduled refresh opportunistically freshens the inline
  catalog prose; failures don't fail the parent run. Runs sequentially
  with the same 1.5 s justETF politeness delay used elsewhere. Pass
  `FORCE=1` to re-scrape rows that already carry
  `commentSource ∈ {justetf, auto}`. Per-field diffs are appended to
  `refresh-changes.log.jsonl` under `source: "backfill-comments"`.
- **UI behaviour change.** The "auto-generated from look-through data"
  hint label that the cell + ETF Details dialog + Look-through dialog
  used to render below the runtime fallback is REMOVED. Once the
  backfill stamps justETF prose into `comment`, the disclaimer would
  be misleading — backfilled prose is at least as authoritative as a
  hand-written comment. The runtime fallback (deterministic
  `describeEtf()` template) still runs for ISINs the backfill hasn't
  reached, but it now flags itself only via the existing italic
  styling — no separate hint text. The i18n keys
  `etf.details.autoDescriptionHint` (EN+DE) were dropped.
- **Validators.** `validateEntry` and `validateAlternative` in
  `artifacts/api-server/src/routes/admin.ts` accept the two new
  optional fields and enforce: `commentDe` ≤ 2000 chars (operators
  occasionally paste the full justETF "Anlageziel" prose, which can
  run a bit longer than the 1000-char `comment` cap), and
  `commentSource ∈ {manual, justetf, auto}`. The renderer + parser +
  `joinCatalog` all round-trip both fields.
- **Tests.** `tests/etfImplementationCommentCell.test.tsx` and
  `tests/etfImplementationReadOnlyComment.test.tsx` were updated to
  drop the hint-label expectations; a new case in the cell test pins
  that a backfilled `commentSource: "justetf"` row renders as curated
  text (no italic, no fallback). The renderer/parser round-trip and
  the resolver's `commentDe`-preference behaviour remain covered by
  the existing engine + parser test suites. Two new dedicated suites
  were added: `tests/etfImplementationCommentResolver.test.ts`
  (8 cases) for the shared resolver and
  `tests/backfillCommentsModes.test.ts` (12 cases) for the
  mode-gated `comment-only`/`auto`-fallback flows. 704/704 unit
  tests + 25/25 mobile e2e PASS.
- **Round-3 follow-ups (2026-05-08).** Three contract gaps caught in
  review were closed before the catalog was actually backfilled:
  - **Provenance preservation.** A central
    `stampSourceIfMissing()` helper in `routes/admin.ts` now applies
    `commentSource: "manual"` ONLY when the inbound payload didn't
    already carry a value; `/admin/preview-isin` annotates the draft
    with `"justetf"` whenever justETF returned a non-empty
    description so the round-trip into `/admin/add-isin` keeps the
    correct provenance; the bulk-import path leaves
    `commentSource` unset for empty operator comments (so the next
    auto-refresh can fill them in) and stamps `"manual"` only when
    the operator pasted real per-row prose. `NewAlternativeEntry`
    grew matching `commentDe?` + `commentSource?` fields so
    alternative-row writes round-trip the metadata too.
  - **Single change-line per ISIN.** The backfill no longer reuses
    the per-field `appendChangeEntries()` helper. It writes one
    JSONL record per touched ISIN with shape
    `{timestamp, source: "auto-description-refresh", mode, isin,
    changes: [{field, before, after}, …]}` directly via
    `fs.appendFile`. The admin "Recent data changes" panel still
    unpacks `changes[]` for per-field rendering.
  - **Full runtime profile dump.** `loadMergedProfiles()` now
    spawns the new tsx helper
    `scripts/dump-lookthrough-profiles.ts`, which imports
    `profileFor()` from `src/lib/lookthrough` and emits the merged
    curated-PROFILES + JSON-overrides map for every ISIN found in
    `etfs.ts`. The auto-template now sees the same look-through
    profile the runtime UI would show, instead of only the JSON
    overrides layer. A best-effort fallback to JSON-only keeps the
    script safe in stripped envs (e.g. CI without tsx).
- **Actual backfill applied (2026-05-08).** Ran
  `MODE=lookthrough-refresh node scripts/backfill-comments.mjs`
  in the workspace and committed the resulting changes to
  `src/lib/etfs.ts`: 9 instrument rows received freshly-generated
  EN+DE auto descriptions plus `commentSource: "auto"`. The 6
  remaining empty-comment rows had neither a justETF profile nor a
  look-through profile available and were left untouched (they keep
  rendering the runtime fallback until either source materialises).
  One per-ISIN line was appended to
  `src/data/refresh-changes.log.jsonl`.

### 2026-05 (compare-comparability-warning)

Added a comparability-warning Alert at the top of the Compare tab's
results section (above the **Structural Differences** card). It
appears whenever Portfolio A and Portfolio B were configured with
mismatched horizons (`inputA.horizon !== inputB.horizon`) and/or
asymmetric look-through (`inputA.lookThroughView !==
inputB.lookThroughView`), and lists each mismatch as a bullet with a
short rationale (fee/drawdown/horizon-scaling for the horizon row;
fund-wrapper-vs.-underlying-holdings for the look-through row).
Implementation: inline IIFE inside the existing
`outputA && outputB && diff` block in
`artifacts/investment-lab/src/components/investment/ComparePortfolios.tsx`,
reusing the same `bg-warning/10` Alert + `ShieldAlert` styling as the
per-portfolio warnings above. Pure UI hint — does not block the
diff. E2E hooks: `compare-comparability-warning`,
`compare-warn-horizon`, `compare-warn-lookthrough`.

### 2026-05 (fee-estimator-multi-etf-bucket-ter — Task #196)

Fixed a TER calculation bug in the Fee Estimator table for buckets that
hold more than one ETF (only reachable from Explain — Build emits one
ETF per bucket by construction). Previously `estimateFees` in
`src/lib/fees.ts` built `terByBucket` with a plain `Map.set` per
implementation row, so when N ETFs shared a bucket the last one's TER
silently overwrote the others while the allocation row already carried
the **summed** weight. The bucket's effective TER was therefore
arbitrary (last-write-wins) and ignored weights entirely.

`estimateFees` now does a two-pass aggregation: it sums
`terBps × weight` and `weight` per bucket from `etfImplementations`,
then divides to get a true weight-averaged TER per bucket. A
single-ETF bucket is unaffected (average of one entry equals that
entry). The `etfImplementations` Pick was widened to include an
optional `weight`; if a caller omits it the entry is treated as
weight=1, so existing call sites that supplied only `bucket`+`terBps`
keep working and degrade to a plain mean instead of dropping rows.

Regression test: `tests/engine.test.ts` — "weight-averages TER across
multiple ETFs in the same bucket" — covers the 10% @ 20 bps + 5% @ 60
bps → 33.33 bps case from the task description plus a single-ETF
sanity check.

### 2026-05 (explain-picker-alt-sort-by-slot — Task #194)

Explain's per-row ISIN picker (`IsinPicker` in
`src/components/investment/ExplainPortfolio.tsx`) now sorts the rows
inside each bucket group by their **catalog role and slot order**
instead of alphabetically by name. The order is:

1. **Default** (one row),
2. **Alt 1, Alt 2, …, Alt N** in the order they appear in the
   bucket's `alternatives` array (matches the numbering Build's
   inline `<Select>` and the per-row Alt-N badges already use),
3. **Pool** entries in their catalog (insertion) order — preserved
   via `Array.sort` stability,
4. **Unassigned** rows (alphabetical name tiebreak).

Previously the code re-sorted everything inside the same role
alphabetically by name, so e.g. for `Equity-USA` the alternatives
showed up as SPDR → UBS → Vanguard rather than Vanguard (Alt 1) →
SPDR (Alt 2) → UBS (Alt 3). The bucket-group ordering is unchanged
(groups stay alphabetical by `bucketKey`); Build's picker is
unchanged (it already iterated catalog slot order).

Implementation: the comparator was extracted as a top-level export
`comparePickerRows` in the same file (with a tiny `PickerRowForSort`
type) so the regression test in `tests/engine.test.ts` can exercise
the order against real catalog data without rendering the picker.
### 2026-05 (scroll-to-top-on-tab-change — Task #193)

Switching tabs now scrolls the window back to the top. Because all four
tab panels share the window scroll position (`forceMount` + `hidden`),
scrolling down in one tab (e.g. to the Monte Carlo card on Build) and
then switching to another tab used to leave the user partway down the
destination tab. We now call
`window.scrollTo({ top: 0, behavior: "instant" })` from two paths:
`handleTabChange` in `src/pages/InvestmentLab.tsx` (tab-bar clicks)
and `navigateToTab` in `src/lib/explainCompare.ts` (programmatic
navigation, e.g. the Build → Explain "Send to Explain" hand-off and
Compare's "Open in Explain"). The Methodology section deep-link path
is preserved: when `navigateToTab` is called with a `sectionHash`, the
top-scroll is skipped so the subsequent `hashchange` can still scroll
the targeted accordion into view.

### 2026-05 (cash-mu-display-per-currency — Task #192)

The Methodology tab's CMA-editor "Active μ" column for the Cash row and
the building-blocks accordion's `bb.cash.rate` component no longer
display the legacy hardcoded 3.00 % seed — they now mirror what the
engine actually uses (`effectiveCashExpReturn(baseCurrency)`), so the
displayed cash μ matches the per-currency RF rate (CHF ≈ 0.5 %,
EUR ≈ 2.5 %, USD ≈ 4.25 %, GBP ≈ 4 %) and re-prices live when the
user switches base currency in Build or Explain. Override-wins
semantics are preserved: a manual cash CMA override in the Methodology
editor still wins (because `effectiveCashExpReturn` returns the
override when present). Engine code, the `CMA_BUILDING_BLOCKS` table,
and the persisted seed are all unchanged — this is a pure display
fix that closes the cosmetic gap between what the editor showed
(3.00 %) and what the headline metrics actually used (per-currency RF).

Implementation: a new lightweight cross-tab channel
`lastBaseCurrency` (`getLastBaseCurrency` / `setLastBaseCurrency` /
`subscribeLastBaseCurrency` in `src/lib/settings.ts`, in-memory,
ungated) is published by `BuildPortfolio.tsx` on
`form.watch("baseCurrency")` and by `ExplainPortfolio.tsx` on
`state.baseCurrency`. `Methodology.tsx` subscribes (default `"USD"`
before either tab has been visited) and:
- the Cash row's "Active μ" cell now renders
  `fmtPct(k === "cash" ? effectiveCashExpReturn(baseCurrency) : CMA[k].expReturn)`,
- the building-blocks accordion clones the cash `bb` and replaces
  the `bb.cash.rate` component's `value` with
  `effectiveCashExpReturn(baseCurrency)`, then recomputes `sum` and
  `delta` from the dynamic components (so the "Δ vs Seed" line is
  also accurate against the persisted 3.00 % seed).

The i18n string `bb.src.cash` (EN+DE) was updated to describe the row
as the per-currency RF rate (CHF SARON, EUR ESTR, GBP SONIA, USD
T-Bills) instead of the previous "approximate G4 cash-rate average"
wording.

### 2026-05 (cash-mu-per-currency)

The Cash sleeve's expected return is now per-currency: it tracks the
per-currency risk-free rate (the same value already used in the Sharpe
denominator) instead of the single global 3.0 % seed. Switching the
displayed currency in Explain (or rebuilding with a different base
currency) re-prices the cash row in the same render — a CHF investor
sees Cash earning 0.50 %, a USD investor 4.25 %, etc. Conceptually this
matches what the CMA building-blocks already labelled cash as
("Short-term policy / money-market rate"), the implementation just
didn't honour the per-currency split before.

Implementation: `effectiveCashExpReturn(baseCurrency)` in
`src/lib/metrics.ts` returns `getRiskFreeRate(baseCurrency)` unless the
user has manually overridden the cash CMA in the Methodology editor
(`getCMAOverrides().cash?.expReturn !== undefined`), in which case the
explicit override still wins. `portfolioReturn(exp, baseCurrency?)`
gained an optional second parameter that swaps in the effective cash μ
for any `key === "cash"` row; omitting it falls back to `CMA.cash.expReturn`
for back-compat with existing tests / callers. The four `portfolioReturn`
callsites in `computeMetrics` and `computeFrontier` (portfolio + frontier
blended/current) all pass `baseCurrency` through. Monte Carlo's
`muSigmaForKey` in `src/lib/monteCarlo.ts` uses the same helper so MC
paths and analytical Risk & Performance metrics agree on the cash μ.
The benchmark contains no cash bucket so `rB` is unaffected.

Regression test in `tests/engine.test.ts` (under
`describe("CMA layered overrides")`) asserts (a) `effectiveCashExpReturn`
returns the four shipped per-currency RFs (USD 4.25 %, EUR 2.50 %,
GBP 4.00 %, CHF 0.50 %), (b) `portfolioReturn` of a 100 % cash exposure
matches the per-currency RF when `baseCurrency` is passed and falls
back to `CMA.cash.expReturn` when it isn't, and (c) `computeMetrics` on
a 60/30/10 portfolio shifts headline `expReturn` by exactly
`0.10 × (RF_USD − RF_CHF) = 37.5 bps` between USD and CHF base —
proving the cash sleeve is the only currency-sensitive contributor.

**Phase 2 (per-row cash currency in Explain, 2026-05):** the Explain
editor lets each cash row carry its own `cashCurrency`, so a portfolio
displayed in USD can hold a GBP cash row + a CHF cash row at the same
time. Phase 1 only honoured the displayed `baseCurrency`, which
collapsed all cash rows to one currency — phase 2 prices each cash row
off its own RF. Implementation: a new exported helper
`cashSleeveMu(allocation, baseCurrency)` in `src/lib/metrics.ts`
weight-averages `effectiveCashExpReturn(rowCcy)` across all cash rows
(`region ∈ {USD, EUR, GBP, CHF}` → that currency; `"Global"` /
unknown → falls back to `baseCurrency`). It returns `undefined` when
there is no cash so callers can skip the blend cleanly. A new third
parameter `cashMuOverride?: number` on `portfolioReturn` lets the
user-portfolio engine callsites pass the per-row blend through:
`computeMetrics`'s headline `r`, and `computeFrontier`'s `current`
dot. **Crucially, the swept frontier mix points keep using
`baseCurrency` only** — they represent an abstract "what if you
shifted to X % equity?" reference, NOT the user's specific cash
sleeve, so they must still re-price cash off the displayed currency
(the legacy phase-1 behaviour every existing frontier test depended
on). Monte Carlo's `runMonteCarlo` computes the same blend once at
the top and threads it into both `muSigmaForKey` callsites
(look-through path + region-only path via `bucketAssumption`'s new
6th parameter), so MC paths and analytical metrics stay byte-identical
with each other on the per-row blend. A manual cash CMA override
collapses every per-row contribution to that override (override-wins
preserved), and Build's single cash row (`region === baseCurrency`)
degenerates to phase 1's behaviour, so neither flow regresses.

Phase 2 regression test in `tests/engine.test.ts` (`cash μ blends
per-row currency in Explain`) asserts (a) `cashSleeveMu` of a 50 % GBP
+ 50 % CHF cash sleeve equals `0.5×RF_GBP + 0.5×RF_CHF`, (b)
`portfolioReturn` honours the override on a 100 % cash exposure, (c)
`computeMetrics` on a 60/20/(10 GBP cash + 10 CHF cash) portfolio
shifts headline `expReturn` vs the same allocation collapsed to a
single 20 % USD cash row by exactly `0.20 × (blend − RF_USD)`, (d)
Build's single same-currency cash row degenerates to the per-currency
RF, (e) `"Global"` cash falls back to `baseCurrency`, and (f)
no-cash portfolios return `undefined` so callers can skip the blend.

### 2026-05 (welcome-reveal-polish — Task #206)

Two welcome-dismiss polish tweaks, both now firing on every fresh
app load (no per-browser or per-session silencing).

(1) The Build tab's donut + horizontal allocation bar now play a
real reveal animation on every welcome-OK / Generate trigger,
matching the radial donut sweep the user already sees when
navigating between top-menu modules. A `revealAnimationKey`
counter in `BuildPortfolio.tsx` is bumped on (a) the welcome
dialog's OK via `subscribeRequestBuildSampleGeneration` and (b)
explicit Generate Portfolio clicks in `onSubmit`. The `<PieChart>`
and the horizontal stacked-bar wrapper are both keyed off this
counter, so each bump fully unmounts and remounts them — Recharts
then plays its default radial mount animation on the donut, and
the CSS keyframe `allocation-bar-sweep` (`scaleX(0) → scaleX(1)`,
`transform-origin: left center`, 900 ms ease-out) replays on the
bar in lockstep. The key bump is deferred across **two
`requestAnimationFrame`s** so React commits the result-section
render and the browser lays out the chart's `ResponsiveContainer`
*before* the remount — without this, Recharts measures the
container as 0×0 on first mount (since the welcome-OK callback
flips `output` from null → set in the same React batch as the
key bump) and silently skips the mount animation. The Build pie no longer overrides Recharts'
animation defaults (`isAnimationActive`, `animationDuration`, …)
— it explicitly mirrors the Compare and CurrentAllocationCard
pies, which already had the desired look. Using a counter (not a
boolean) means the second, third, … Generate click also replay
the animation, not just the first.

(2) The blue nav-dot flash from Task #187 is no longer one-shot
per browser **or** per session — the persistence gate in
`InvestmentLab.tsx`'s `handleWelcomeDismiss` was removed entirely,
so `setFlashDots(true)` runs unconditionally on every welcome OK,
followed by the existing 1.2 s reset timer. The
`getNavDotsFlashedOnce` / `markNavDotsFlashedOnce` helpers in
`lib/settings.ts` are no longer imported by the page (they remain
exported for backwards compatibility but are now unused in app
code). Net effect: the dots pulse on every welcome confirm, every
single time the user opens or reloads the app.

### 2026-05 (nav-dot-build-hint — Task #188)

Layered a small one-shot tooltip on top of the Task #187 nav-dot
flash. Right after the welcome dialog is dismissed for the very
first time in this browser, alongside the existing 1.2 s dot-flash
animation, a Radix tooltip pinned above the **Build** tab pops
open for ~3 s with the localized hint "Your sample portfolio is
ready in Build" / "Ihr Beispielportfolio ist in „Erstellen" bereit"
(i18n key `nav.hint.build`). The hint is dismissed by:

1. The 3 s timeout firing,
2. Pressing **Esc**, or
3. Tapping anywhere on the page (a single capture-phase
   `pointerdown` listener with `once: true` — taps on the Build
   tab itself both navigate AND clear the hint in one gesture).

One-shot persistence lives in a sibling localStorage key
`idl.navDotsHintShownOnce` with `get/markNavDotsHintShownOnce` in
`src/lib/settings.ts`, deliberately separate from
`navDotsFlashedOnce` so the two cues can be reset independently.

Both nav surfaces are wired:

- **Desktop header** (`HeaderTabBar`): the existing per-tab
  `<Tooltip>` is switched to `open: true` when the Build tab is
  the hint target, and its `<TooltipContent>` swaps to the hint
  text (with `data-testid="nav-hint-build"`).
- **Mobile bottom bar** (`MobileTabBar`): the Build button is
  unwrapped by default (preserving the original "no Tooltip on
  touch" behaviour to avoid swallowing taps), but conditionally
  wrapped in a `<Tooltip open>` for the ~3 s the hint is showing
  (`data-testid="nav-hint-build-mobile"`, side="top").

### 2026-05 (per-bucket-lookthrough-backfill)

Added a per-bucket variant of the catalog tree's existing global
"Fetch missing data" backfill. Each bucket header in
`/admin/catalog/browse` now carries a `Fetch LT (N)` button that
shows the count of ISINs in that bucket without look-through data
and is disabled when N=0 (with a "covered" tooltip). Clicking it
triggers the same justETF scrape pipeline as the global header
button — sequential ~5s/ISIN scrape, validate that all four fields
(top holdings, geo, sector, currency) are non-empty, then write to
`lookthrough.overrides.json`'s `pool` section either via direct
write (workspace) or one combined PR (production).

Backend: new `POST /admin/buckets/:key/backfill-lookthrough` route
in `artifacts/api-server/src/routes/admin.ts`. Same body shape as
the global handler plus a `bucketKey` echo. Candidate set is the
bucket's default + alternatives + pool ISINs, de-duplicated and
filtered against `overrides ∪ pool` coverage. 404 on unknown
bucket key.

Frontend: `backfillBucketLookthrough(bucketKey)` added to
`src/lib/admin-api.ts`. `ConsolidatedEtfTreePanel` got a
`bucketBackfillingKey` lock (one bucket at a time, justETF
politeness) and a `runBucketBackfill` handler that surfaces results
via toast (success / partial-failure warning / empty / error)
instead of the inline alert the global header uses — bucket runs
are typically <5 ISINs so a transient toast is enough; the per-row
LT-status badges refresh on the existing `prsRefreshKey` bump.

### 2026-05 (nav-dot-user-driven — Task #186)

Fixed three nav-bar content-indicator dot misbehaviours:

1. **Build dot stayed lit after reset.** The reset/refresh button on
   Build flipped `hasGenerated` back to `false` but never republished
   the cross-tab Build channels, so the dot kept showing.
2. **Compare dot lit up on fresh load.** Compare's `linked` flag
   default-on'd against Build's auto-generated example portfolio,
   which immediately reported a "filled" Slot A to the nav.
3. **Dots flashed on first paint.** The above two combined with
   subscribe-effect timing produced visible blink-in/blink-out.

Implementation: a new `lastBuildUserDriven` channel in
`src/lib/settings.ts` (with `set/get/subscribe` siblings to the
existing `lastBuildInput` channel). The flag is set to `true` only
on the explicit user-driven Build paths (`onSubmit` — covers both
the **Build Portfolio** button click and saved-scenario load), and
explicitly back to `false` on the Build reset button (alongside a
defensive `setLastBuildInput(null)` so Compare's link mirror also
stops echoing the discarded input). The auto-generate-on-mount path
(Task #96) deliberately leaves the flag at its initial `false`.

`InvestmentLab.useNavSignals` now seeds and subscribes
`buildHas` from `getLastBuildUserDriven()` instead of
`getLastBuildInput() !== null`. `ComparePortfolios` subscribes to the
same channel and gates its Slot A "filled" calculation on
`(linked && buildUserDriven) || …` — so auto-link to an
auto-generated Build no longer triggers the Compare dot, but a real
user-driven Build still does. The Compare "Linked / Re-link" badge is
unchanged (still keyed off `hasBuildPublished`); only the nav-dot
contract was tightened.

Regression test: `tests/buildUserDrivenSignal.test.ts` (3 cases) —
fresh-load default `false`, set/clear round-trip, and dedup'd
subscribe stream.

### 2026-05 (send-to-explain-cash — Task #182)

Build's **Send to Explain** hand-off now includes the portfolio's Cash
slice. Previously the converter only mapped `etfImplementation` rows,
so Cash (which has no ISIN and is excluded from that table) was
dropped — Explain ended up with a portfolio that summed to less than
100%.

- `buildToExplainWorkspace` in `src/lib/explainCompare.ts` now also
  reads `output.allocation` for the Cash row (`assetClass === "Cash"`)
  and, when its weight is > 0, appends a Cash sentinel position
  (`isin: ""`, `bucketKey: EXPLAIN_CASH_BUCKET_SENTINEL`,
  `cashCurrency: input.baseCurrency`). Build inputs with 0% Cash add
  no row (no zero-weight noise). The receiving `ExplainPortfolio`
  ingestion path needed no changes — it already accepts the Cash
  sentinel + `cashCurrency` shape from manual adds and the file
  round-trip.
- Two new cases in `tests/buildToExplain.test.ts` cover the non-zero
  Cash → sentinel-row + currency assertion (and total-weight
  preservation) and the 0% Cash → no Cash row assertion.

### 2026-05 (slot-tag-tooltips — Task #167)

Added hover/tap tooltips to the **Default / Alternative / Pool** slot
tags rendered in Build and Explain. Plain-language copy is provided in
EN + DE via three new `slotTag.tooltip.*` keys in `src/lib/i18n.tsx`.

- New shared component `src/components/investment/SlotTagBadge.tsx`
  wraps the existing slot `<Badge>` (preserving its `variant` /
  `className` from `etfSlotBadge.ts`) inside the app's standard
  Radix `<Tooltip>` so behaviour matches the rest of the app
  (hover, focus, and touch via long-press).
- Wired into Build's two slot-tag render sites in
  `BuildPortfolio.tsx` — the inline tag next to the per-bucket
  `<Select>` trigger and the per-option tag inside the unified
  picker dropdown — and into Explain's per-bucket tag in
  `ExplainPortfolio.tsx` (the `getInstrumentRole`-driven badge).
- Existing slot colors (default = secondary, alternative = green,
  pool = orange) and layout are unchanged; only the tooltip
  affordance is added.

### 2026-05 (explain-cash-pseudo-group — Task #174)

Added a first-class **Cash** pseudo-group at the top of the Explain
tab's bucket-tree editor that mirrors Build's first-class Cash slider.

- New sentinel `EXPLAIN_CASH_BUCKET_SENTINEL = "Cash"` exported from
  `src/lib/personalPortfolio.ts`. The sentinel is intentionally NOT
  registered in `BUCKETS` / `ALL_BUCKET_KEYS` (it's a pseudo-bucket).
- `PersonalPosition` gained an optional `cashCurrency?: BaseCurrency`
  field. `resolveSleeve` maps a Cash sentinel row to
  `{assetClass: "Cash", region: cashCurrency ?? "Global"}` so the
  synthesizer threads it through the standard allocation pipeline
  (matching Build's `portfolio.ts:337` shape where the Cash sleeve
  region is the workspace base currency).
- Editor: rendered as the canonical first asset-class group (above
  Equity / Fixed Income / …). The `[+]` button (testid
  `explain-add-in-bucket-Cash`) appends a row directly without
  opening any IsinPicker. The row shows weight + currency Select
  (USD / EUR / CHF / GBP) + delete — no ISIN, no role badge, no
  look-through, no PositionRow chrome. Smart-default expand: open
  iff at least one Cash row already exists.
- Manual-entry asset-class options no longer include "Cash" — the
  pseudo-group is the canonical entry point now. Legacy rows with
  `manualMeta.assetClass === "Cash"` are migrated into the sentinel
  shape on workspace load (both the in-component `loadState` and the
  shared `savedExplainPortfolios.sanitizeWorkspace` path used by
  saved portfolios + file import).
- Validation: `runExplainValidation` skips the "Row has no ETF
  selected" check for Cash sentinel rows (they're ISIN-less by
  design). All other downstream checks already operate on
  `positions.filter(p => !!p.isin)` so they naturally bypass Cash.
- `explainWorkspaceHasContent` and `cloneWorkspace` in
  `explainCompare.ts` were updated so a Cash-only workspace is
  treated as non-empty and `cashCurrency` round-trips through the
  Compare-handoff clone path.
- i18n: new keys `explain.btn.addCashPosition`, `explain.tree.cash.desc`,
  `explain.cash.currency.label` (DE + EN). Existing
  `explain.assetClass.Cash` is reused for the group header.
- Tests:
  - Unit (`tests/engine.test.ts`, new "Explain Cash sentinel" block):
    sleeve mapping with explicit `cashCurrency`, "Global" fallback,
    no-ETF-selected exemption, `explainWorkspaceHasContent`
    Cash-only positivity, equity-cap denominator unaffected.
  - E2E (`tests/e2e/explain-portfolio.spec.ts`, new "Cash
    pseudo-group" test): `[+]` adds row directly without picker,
    weight contributes to total, sentinel shape persists across
    reload (no ISIN, no manualMeta, optional `cashCurrency`).
- **Build / engine / PDF / admin: unchanged.** This is a
  presentation + persistence change scoped to the Explain editor
  and its synthesizer wiring — Build's Cash slider, the portfolio
  engine, the PDF report renderer, and the admin catalog UI all
  remain on their existing code paths.

### 2026-05 (explain-picker-alt-sort-by-slot — Task #192) — Picker alternatives sorted by slot index

Explain's `IsinPicker` now sorts the "Curated Alternatives" group by their 1-based slot index (Alt 1, Alt 2, ...) rather than alphabetically by name. This ensures that the order in Explain matches the explicit priority order in the catalog and the Build tab's dropdown.

- **Implementation:** `IsinPicker` uses a new `getInstrumentAltIndex(isin)` helper to sort alternatives before rendering the group.
- **Verification:** Unit tests in `tests/explainPickerRoleBadge.test.tsx` updated to assert slot-based sort order.

### 2026-05 (scroll-to-top-on-tab-change — Task #193) — Reset scroll when switching tabs

All four tab panels (Build, Compare, Explain, Methodology) now reset the window scroll position to the top whenever the user switches between them. This fixes the "carry-over scroll" issue where scrolling down on one tab (e.g. to see Monte Carlo results) left the user partway down the page on the next tab.

- **Logic:**
  - `handleTabChange` (the shared Radix + custom navigation handler) calls `window.scrollTo({ top: 0, behavior: "instant" })`.
  - `navigateToTab` (the imperative navigation helper) also calls it, but **skips the reset** if a `sectionHash` is provided. This preserves the deep-link behavior for the Methodology section, where the browser needs to scroll to a specific accordion.
- **Verification:** Verified manually across all tab transitions and the "Send to Explain" hand-off. Unit and e2e suites pass.

### 2026-05 (build-to-explain-handoff) — "Send to Explain" button on Build tab

Mirrors the existing Explain → Compare handoff pattern so a generated
Build portfolio can be carried into the Explain tab for position-level
editing without re-entering everything by hand.

- New helper `buildToExplainWorkspace(input, output)` in
  `src/lib/explainCompare.ts` converts a `PortfolioInput` /
  `PortfolioOutput` pair into the Explain `ExplainWorkspace` shape:
  copies `baseCurrency`, `riskAppetite`, `horizon`,
  `lookThroughView`, renames `includeCurrencyHedging` → `hedged`,
  and maps each `etfImplementation` row to a `PersonalPosition`
  (`isin`, `bucketKey: row.catalogKey ?? ""`, `weight`). Drops empty-ISIN
  and zero-weight rows so off-catalog suggestions never poison Explain.
- New cross-tab channel `requestExplainLoadFromBuild` /
  `takePendingExplainLoadRequest` / `subscribeExplainLoadRequests`
  (same pattern as the existing Explain→Compare load channel).
  `ExplainPortfolio` mounts a `useEffect` that drains any pending
  request on mount and subscribes for live ones, applies the workspace
  via `setState` + `syncDraftsFromPositions`, and toasts
  "Loaded from Build" / "Aus Build geladen".
- New "Send to Explain" outline button in the BuildPortfolio results
  header (next to the PDF buttons), gated on `output && validation.isValid`.
  Replace-with-confirm contract: if the existing Explain workspace
  already contains content (`explainWorkspaceHasContent`), an
  `AlertDialog` asks the operator to confirm; otherwise the workspace
  is replaced silently. After replace, the active tab switches to
  Explain and a success toast fires.
- I18n keys added (EN+DE): `build.btn.sendToExplain`,
  `build.btn.sendToExplain.tooltip`, `build.btn.sendToExplain.toast`,
  `build.sendToExplain.dialog.{title,body,cancel,confirm}`.
- Tests: new unit suite `tests/buildToExplain.test.ts` (3 cases) for
  the converter (settings copy, bucketKey mapping, drop empty/zero
  rows). New e2e `tests/e2e/build-to-explain.spec.ts` covering the
  silent first-load path and the second-click confirm dialog.

### 2026-05 (fast-track-add-etf — Task #165) — one-step add-ETF flow with auto-Comment + look-through chain

`/admin/catalog` now opens with a `FastTrackAddEtfPanel` card on top of
the existing sub-tabs. The operator pastes an ISIN, clicks **Vorbelegen
/ Prefill**, every justETF field is filled in (TER, AUM, domicile,
replication, distribution, currency, inception, listings) **and the
Comment field is seeded from the "Investment objective" / "Anlageziel"
block**. A single **Destination** selector offers four mutually-exclusive
options — Register only · Set as default of … · Add as alternative of …
· Add to pool of … — with bucket dropdowns whose disabled options carry
a tooltip explaining the rule (strict global ISIN uniqueness; pool cap
`MAX_POOL_PER_BUCKET = 50`; alternatives cap
`MAX_ALTERNATIVES_PER_BUCKET = 10`). One **Save** dispatches to the
right existing backend route (no new routes added):

- Register only → `POST /admin/instruments`
- Add as alternative → `POST /admin/instruments` then
  `POST /admin/buckets/:key/alternatives` (the picker-style attach
  route that already auto-bundles a look-through scrape when the JSON
  sidecar lacks data for the ISIN)
- Set as default → `POST /admin/instruments` then
  `PUT /admin/buckets/:key/default` (2 sequential writes; in PR mode this
  produces 2 PRs, accepted per spec)
- Add to pool → `POST /admin/instruments` then
  `POST /admin/buckets/:key/pool` (same 2-write pattern)

The "Also fetch look-through data" checkbox (default on) chains
`POST /admin/lookthrough-pool/:isin` after the catalog write succeeds —
best-effort: a look-through failure does not undo the catalog save, the
toast surfaces the partial result instead. When unchecked, the
explicit chain is skipped; the alternative attach route may still
auto-bundle look-through into its own PR (Task #122 contract) — the
toast wording reports `Look-through bundled in the same PR` in that
case. The success toast respects `directWrite` ("Saved" / "Gespeichert"
vs "Pull request opened") and matches the wording of the existing
panels.

Above the editable fields the panel surfaces the same
**policy-fit badges** (AUM OK / TER OK + notes) and "View on justETF"
link as `PreviewEditor`, so operators see the same scraped fit
verdict before saving.

E2E coverage: `tests/e2e/admin-fast-track-add-etf.spec.ts` mocks
`/api/admin/*` via `page.route()` and exercises all four destinations
plus the look-through chain on/off behaviour. Total e2e suite is now
20 tests.

The Comment auto-fill also flows into the existing
`InstrumentsPanel` and `AddAlternativeForm` prefill paths via the
shared helpers in `src/components/admin/shared.tsx`:

- `buildDraftFromPreview` now seeds `comment` from `f.description` when
  present;
- `mergePreviewIntoAlternativeDraft` and
  `mergePreviewIntoInstrumentDraft` only overwrite the comment when the
  current value is empty — manual edits always win on a re-prefill.

Scraper side: a new `description` extractor was added to
`PREVIEW_EXTRACTORS` in `scripts/lib/justetf-extract.mjs`. It matches
both English ("Investment objective") and German ("Anlageziel")
headings, strips HTML tags, decodes the few entities justETF uses,
collapses whitespace, and caps the result at 500 chars with an
ellipsis. The api-server's `/api/admin/preview-isin` route auto-iterates
`PREVIEW_EXTRACTORS` into its `fields` payload so the new field flows
through without route-level changes. Test coverage: 4 new cases in
`tests/scrapers.test.ts` — happy path against the captured fixture,
missing-block returns undefined, German-locale heading variant,
length-cap behaviour. All 656 unit tests pass.

The existing Instruments / Add ISIN / "+ Alternative" panels are
unchanged in shape — fast-track is strictly additive.

### 2026-05 (explain-clickable-isin) — clickable ISIN in Explain opens the ETF Details dialog

Brings Build's ISIN affordance to the Explain tab. Every Explain row
whose ISIN resolves to a registered catalog instrument now renders the
ISIN as a small button (with a `Search` icon) below the picker /
manual-input row. Clicking it opens the existing `ETFDetailsDialog`
(fund characteristics + look-through baskets + top holdings) — the same
component Build mounts. Manual-ISIN rows expose the button when the
typed ISIN matches a registered instrument; for unknown ISINs the
existing inline `EtfInfoPreview` behaviour is preserved untouched.

- Wired into `src/components/investment/ExplainPortfolio.tsx`:
  - new `detailsEtf` state + single `<ETFDetailsDialog>` mount,
    mirroring Build's pattern;
  - `etfByIsin` map built from `portfolio.etfImplementation` and
    filtered through `getInstrumentByIsin` so unresolved off-catalog
    manual rows don't get a dead button;
  - `PositionRow` gains `detailsEtf` + `onOpenDetails` props and
    renders the clickable ISIN button with testid
    `explain-etf-isin-button-${bucketKey}` (catalog rows) or
    `explain-etf-isin-button-manual-${rowIndex}` (manual rows).
- Reuses the existing i18n key `build.impl.isin.openDetails` for the
  tooltip / aria-label so no new translation work.
- E2E coverage: `tests/e2e/explain-portfolio.spec.ts` now opens the
  dialog from a catalog row and asserts `etf-details-dialog` is
  visible, then closes it and asserts the editor state (selections,
  weights, expanded groups) survives.

### 2026-05 (fast-track-add-etf-v2)
- Added Fast-Track Add ETF card to `/admin/catalog`.
- Single ISIN input with justETF prefill and look-through chain support.
- Revised route flow (POST /admin/instruments then POST /admin/buckets/:key/alternatives).
- Added policy-fit badges and "View on justETF" link.
- New e2e test suite: `tests/e2e/admin-fast-track-add-etf.spec.ts`.
- Updated justETF scraper with description extraction.

### 2026-05 (explain-current-allocation-card)
- Added "Current Allocation" card to Build/Compare results.
- Visual breakdown of Equity vs Defensive vs Satellites.
- Validation logic for risk-appetite alignment.

### 2026-05 (explain-role-badges-unified-colors) — Default/Alt N/Pool badges in Explain, unified color scheme

- Explain's per-bucket IsinPicker now renders the **full** Default / Alt N / Pool role badge for every option (not just pool entries). Default ETF → neutral "Default" badge; curated alternatives → green "Alt 1", "Alt 2", … numbered by their 1-based slot order in the bucket's `alternatives` array; extended-universe pool → orange "Pool" badge. Build's picker dropdown and trigger-side badge already use the same `slotBadgeClassName` / `slotBadgeVariant` helpers, so the two surfaces are now visually consistent (alt = green, pool = orange, default = neutral) — the Pool badge in particular is now orange everywhere it appears (Build trigger, Build dropdown row, Build pool hint, Explain picker), no longer green.
- New helper `getInstrumentAltIndex(isin)` in `src/lib/etfs.ts` returns the 1-based alt slot index inside the ISIN's bucket, or `null` for default / pool / unassigned ISINs. Used by Explain's badge composer; Build keeps deriving the index from the picker's slot index directly.
- New i18n strings `explain.picker.default` (EN "Default" / DE "Standard") and `explain.picker.alt` (EN "Alt" / DE "Alt.") reused with the existing `explain.picker.pool`. New stable test-ids: `isin-option-default-badge-${isin}`, `isin-option-alt-badge-${isin}`; `isin-option-pool-badge-${isin}` is unchanged.
- New unit test `tests/explainPickerRoleBadge.test.tsx` locks in the badge label, color class, and test-id per role, plus the alt-index numbering contract.

### 2026-05 (admin-tree-bucketed-lookthrough) — Look-through dialog reachable for bucketed ETFs

- **Operator-Wunsch (Task #158):** Im Admin → Catalog → Browse-Baum zeigte die Spalte „LT-Status" zwar Data OK / Stale / Daten fehlen für jede Default-/Alt-/Pool-Zeile innerhalb eines Buckets, ließ sich aber nicht öffnen — der Look-through-Dialog (Top-Holdings, Geo, Sektor, Currency, justETF-Deeplink) war bisher nur über die „Pool-only"-Zeilen oben (Unclassified) erreichbar.
- **Lösung:** `BucketRowsTable.tsx` bekommt in der bisher leeren Aktions-Spalte (rechts neben „Entfernen") für JEDE Zeile (Default, Alt, Pool) einen kleinen Ghost-Button „Look-through". Beim Klick öffnet sich der bereits existierende `EtfLookthroughDialog` (derselbe, der oben für Pool-only-Zeilen verwendet wird) für die ISIN dieser Zeile, mit Top-Holdings / Geo / Sektor / Currency und justETF-Deeplink. Hat eine ISIN keine Look-through-Daten, sagt der Dialog explizit „Keine LT-Daten" — die existierende „Fehlende Daten holen"-Sammelaktion im Header bleibt der Weg, um sie nachzuziehen.
- **Implementierung:** Eine einzige `useState`-Slot `openLt: { isin, name } | null` pro Tabelle (eine pro Bucket); der Dialog wird einmalig unter `<table>` gerendert und mit der zuletzt geklickten ISIN befüllt — kein N-fach-DOM, keine zusätzlichen Re-Mounts. Bestehende „Entfernen"-Buttons (Alt/Pool) bleiben unverändert. Test-ID `button-tree-lookthrough-${isin}` folgt dem bestehenden Schema (gleicher Name wie auf den Pool-only-Zeilen — die beiden Surfaces sind nie gleichzeitig sichtbar, da sie in verschiedenen Bereichen des Trees liegen).
- **Verifikation:** Typecheck PASS, Unit-Tests grün, e2e PASS (kein Selector verändert).

### 2026-05 (explain-manual-catalog-hint) — hint when manual ISIN is already in the catalog

- **Operator-Wunsch (Task #155):** Wenn im Explain-Tab in der Gruppe „Manuell erfasst (nicht im Katalog)" eine ISIN getippt wird, die bereits im kuratierten Katalog liegt (grünes „im Katalog"-Badge), zeigt die `EtfInfoPreview`-Karte jetzt einen freundlichen, informationsfarbenen Hinweis an, der den Bucket beim Namen nennt (Asset-Klasse — Region, inkl. hedged/synthetic-Suffix wo relevant) und darauf hinweist, dass der ETF auch direkt aus der Baumansicht oben hinzugefügt werden kann — eine manuelle Eingabe ist dafür nicht nötig.
- **Code-Änderungen:** `EtfInfoPreview.tsx` importiert `getBucketKeyForIsin` und `getBucketMeta` aus `etfs.ts`, baut ein Memo `catalogBucket`, das nur dann gesetzt wird, wenn `info.catalogInstrument` UND eine Bucket-Zuordnung existieren (Pool-only-Look-Through-Treffer triggern den Hinweis nicht), und rendert eine bilinguale `text-sky-700`-Zeile mit Test-ID `etf-info-catalog-hint-${rowIndex}` direkt unter den Badges. Bestehender Manual-Row-Flow bleibt unverändert — rein advisorisch, kein Auto-Convert.
- **Tests:** Neue Komponenten-Suite `tests/etfInfoPreviewCatalogHint.test.tsx` (3 Cases) — Hinweis sichtbar bei Katalog-Treffer (samt korrektem Bucket-Label "Equity — USA"), versteckt bei Off-Catalog-ISIN, versteckt bei Pool-only-Look-Through ohne Katalog-Eintrag. Suite jetzt 651 Cases, alle grün.

### 2026-05 (explain-manual-unassigned-picker) — pick unassigned catalog ETFs in Explain manual entry

- **Operator-Wunsch (Task #156):** Im Explain-Tab ist das Free-Form-ISIN-Feld in der Gruppe „Manuell erfasst (nicht im Katalog)" oft die schnellste Eingabe für einen ETF, der zwar in INSTRUMENTS registriert, aber (noch) keinem Bucket zugeordnet ist. Statt die ISIN von Hand abzutippen soll daneben ein kleiner Picker stehen, der genau die „unassigned"-Instrumente listet. Auswahl füllt isin + manualMeta (Name, Währung, TER) atomar in einem Klick.
- **Code-Änderungen:**
  - Neuer Helper `listUnassignedInstruments()` in `src/lib/etfs.ts` — iteriert INSTRUMENTS, filtert via `getInstrumentRole(isin) === "unassigned"`, sortiert alphabetisch nach Name.
  - Neues Komponenten-Modul `src/components/explain/UnassignedInstrumentPicker.tsx` (Popover + Command) — mit `excludeIsins` (bereits im Workspace verwendete ISINs werden ausgeblendet) und Empty-State „No unassigned ETFs in the catalog" / „Keine ungebundenen ETFs im Katalog".
  - `ExplainPortfolio.tsx` `PositionRow`: Manual-Branch zeigt jetzt `[Picker | Free-Form-Input]` nebeneinander statt nur den Input. Picker-Test-ID `explain-unassigned-picker-${rowIndex}`. Free-Form-Eingabe für echte off-catalog-ISINs bleibt unverändert.
  - Neuer Handler `pickUnassignedInstrumentForRow` (atomar: setzt `isin` + `manualMeta` mit name/currency/terBps; assetClass/region default Equity/Global, da unassigned-Rows keine Bucket-Geographie haben — die existierenden Selects unter der Zeile lassen den User das nachträglich anpassen).
  - 3 i18n-Keys (EN+DE): `explain.manual.unassigned.{label,search,empty}`.
  - **Auto-Klassifikation beim Pick:** neuer Helper `inferAssetClassRegionFromInstrument(rec)` in `etfs.ts` parst Name + Comment per Keyword-Heuristik (Bond/REIT/Gold/Bitcoin → Asset Class; S&P/EURO STOXX/Nikkei/EM/CHF → Region) und wird vom Pick-Handler genutzt, sodass der User nach dem Pick direkt eine plausible Asset-Klasse + Region sieht. Hatte der User vor dem Pick bereits eine nicht-Default-Wahl (≠ Equity/Global) für die Zeile getroffen, gewinnt seine Wahl. Die Selects unter der Zeile bleiben unverändert für Korrekturen.
  - **Row-aware Exclusion:** Picker bekommt `currentIsin?: string` Prop — die ISIN der eigenen Zeile bleibt im Picker wählbar, auch wenn sie in `excludeIsins` (=alle Workspace-ISINs) steht. Dieselbe Konvention wie `IsinPicker` — nur ISINs aus ANDEREN Zeilen werden ausgeblendet.
  - **Tests:** 3 Helper-Unit-Tests in `tests/engine.test.ts` + 15 neue Tests in `tests/unassignedInstrumentPicker.test.tsx` (4 Komponenten-Render-Tests via @testing-library/react: Render-Liste, Exclusion, current-row-Allowance, onPick-Payload; 11 `inferAssetClassRegionFromInstrument`-Cases pro Asset-Class und Region).
- **Verifikation:** Typecheck PASS, Unit-Tests grün (645 / 645 = 627 vorher + 18 neue).

### 2026-05 (build-picker-slot-badge) — always-visible Default/Alt N/Pool tag with consistent colours

- **Operator-Wunsch (Task #154):** „Im Build-Tab soll rechts neben jedem ETF-Dropdown immer ein Tag stehen, das auf einen Blick zeigt, ob der gerade gewählte ETF der Bucket-Default, eine kuratierte Alternative oder ein Pool-ETF ist." Der Tag erschien bisher nur, wenn ein Pool-ETF gewählt war.
- **Visual-Schema (Build-Tab):** Default → neutral (`Badge variant="secondary"`, keine Farbklassen), Alternative → grün (`outline` + `border-emerald-600 text-emerald-700 dark:text-emerald-400`), Pool → orange (`outline` + `border-orange-600 text-orange-700 dark:text-orange-400`). Trigger-Tag-Text: „Default" / „Standard" für Slot 0, „Alt N" (EN) / „Alt. N" (DE) für Alternative-Slots, „Pool" für Pool-Slots. In-Dropdown-Item-Badges nutzen weiterhin den langen Begriff „Alternative N" mit derselben grünen Farbe; Pool-Items wechseln von Grün auf Orange, damit Trigger und Dropdown visuell zusammenpassen.
- **Code-Änderungen:**
  - Neuer Pure-Helper `src/components/investment/etfSlotBadge.ts` (`getSlotKind`, `slotBadgeVariant`, `slotBadgeClassName`) — wird sowohl für das Trigger-Tag als auch für die In-Dropdown-Item-Badges genutzt.
  - `src/components/investment/BuildPortfolio.tsx` (Picker-Block ~Zeile 1334-1448): „nur-bei-Pool"-Badge ersetzt durch immer sichtbares Tag mit `data-testid="etf-picker-slot-badge-${etf.bucket}"`. SelectItem-Badges nutzen jetzt die Helper-Funktionen statt der alten hand-codierten Klassen.
  - `src/lib/i18n.tsx`: neuer Key `build.impl.picker.altShort` (EN „Alt", DE „Alt.").
  - Neuer Unit-Test `tests/etfSlotBadge.test.ts` (9 Cases) sichert die Slot-Index-→-Kind-Mappings und die korrekten Farb-Klassen pro Kind.
- **Out of scope (separate Aufgabe — Task #160):** Explain-Tab-IsinPicker bekommt das gleiche Tag-Schema in einer Folge-Aufgabe. PDF-Report und Compare-Tab bleiben unverändert.
- **Verifikation:** Typecheck PASS, 627 / 627 Unit-Tests grün (618 vorher + 9 neue).

### 2026-05-05 (drop-orphan-staging-concept) — collapse "orphan-staged" into plain catalog state

- **Operator-Wunsch:** „Ich will nur ETFs, und entweder sind sie in einem Bucket oder nicht. Wenn sie in einem Bucket sind, haben sie ein Tag: default, Alt 1-n, oder pool." → Der zusätzliche Status „orphan-staged" (eingeführt durch den 2026-05-01-Bulk-Add) wird abgeschafft. Es gibt nur noch zwei Zustände: **in einem Bucket** (mit Slot-Tag default | alternative[i] | pool[j]) oder **nicht in einem Bucket**. Die Pflicht-Review-Schranke „bulk-added Instrumente dürfen nicht ohne Review zum Default/Alt werden" entfällt — der Operator entscheidet nun frei pro ISIN, wann immer er möchte.
- **Code-Änderungen:**
  - `tests/popular-etfs-orphan.test.ts` **gelöscht** (war die einzige Stelle, die das Staging-Konzept zur Laufzeit erzwungen hat).
  - `src/lib/etfs.ts`: `BEGIN/END auto-added popular-ETFs orphans`-Marker-Block entfernt; alle 80 ehemals-orphan Einträge bekommen einen kurzen, sprechenden Kommentar im Schema `"<Kategorie> — <Issuer/Produktname>."` (z. B. `"Broad world equity — iShares Core MSCI World UCITS Acc."`) statt der generischen Auto-Boilerplate `"Popular UCITS ETF auto-added on 2026-05-01..."`.
  - `src/lib/lookthrough.ts`: Verweis auf den gelöschten Test in einem Code-Kommentar gestrichen.
- **Beibehalten (Scraper-only-Artefakte):** `scripts/data/popular-etfs-seed.mjs` und `scripts/data/popular-etfs-staged.json` bleiben unverändert. Sie sind weiterhin Input bzw. Output von `scripts/scrape-popular-etfs-instruments.mjs` + `scripts/inject-popular-etfs.mjs`, werden aber nicht mehr zur Laufzeit oder im Test-Suite gelesen. Beim nächsten Bulk-Add läuft die Pipeline genauso wie bisher; das Ergebnis landet einfach direkt in INSTRUMENTS (ohne separater „staged"-Marker).
- **Verifikation:** Typecheck PASS, 618 / 618 Unit-Tests grün (vorher 625; die 7 gelöschten Orphan-Tests entfallen erwartungsgemäß).

### 2026-05 (admin-direct-write) — admin catalog mutations write straight to the workspace

- **Operator-Wunsch:** Solange der api-server im Replit-Workspace läuft, sollen Admin-Katalog-Mutationen (ISIN hinzufügen, Alternative attachen/entfernen, Default ändern, Pool +/-, Instrument bearbeiten) **nicht** mehr den Umweg über GitHub-Pull-Requests nehmen. Direkt in `etfs.ts` (und `lookthrough.overrides.json` falls beim Attach-Alternative-Flow gebündelt) auf Disk schreiben — sofort sichtbar nach dem nächsten dev-server-Reload. In Production (Deploy/Publish) existieren die Workspace-Dateien nicht im Runtime-FS, also dort weiterhin der bestehende PR-Pfad.
- **Auto-Detect (`artifacts/api-server/src/lib/github.ts`):** `directWriteMode()` läuft beim Boot von `process.cwd()` rückwärts hoch und sucht `artifacts/investment-lab/src/lib/etfs.ts`; gefunden + schreibbar + `ADMIN_DIRECT_WRITE_DISABLED !== "1"` → direct-write. Sonst PR-Modus. Die 7 PR-Helper (`openAddEtfPr`, `openInstrumentPr`, `openSetBucketDefaultPr`, `openAttachBucketAlternativePr`, `openRemoveBucketAlternativePr`, `openAddBucketPoolPr`, `openRemoveBucketPoolPr`) wurden auf zwei neue gemeinsame Helfer (`fetchEtfsBase` / `commitEtfsChange`) umgezogen, die je nach Modus entweder GitHub blob-API oder lokales `fs.readFile` / `fs.writeFile` nutzen. Im direct-write-Modus liefern alle Helper `{prUrl: "", prNumber: 0}` zurück.
- **Route-Gates (`artifacts/api-server/src/routes/admin.ts`):** Alle 16 Mutation-Routen erlauben jetzt `directWriteMode() || githubConfigured()` (vorher nur `githubConfigured()`). `GET /admin/whoami` liefert zusätzlich `directWrite: boolean`.
- **UI-Anpassung (`AdminContext` + Sektionen):** Im direct-write-Modus werden ausgeblendet — das **Operations → "Workspace-Sync"-Sub-Tab** (kein main→workspace-Pull nötig), das **Operations → "Pull Requests"-Sub-Tab** (es gibt keine PRs zu tracken), die **Overview-Karten "Workspace-Sync" + "Pending PRs"** sowie der GitHub-not-configured-Fehler-Banner. Operations defaultet jetzt auf das `Datenänderungen`-Sub-Tab statt `Workspace-Sync`. 5 Toast-Surfaces (`SuggestIsinPanel`, `AddAlternativeForm`, `InstrumentPicker`, `InstrumentsPanel ×2`, `ConsolidatedEtfTreePanel ×2`) sagen jetzt „Gespeichert" / „Saved" statt „Pull Request #N geöffnet" und zeigen den `Open`-Action-Button nicht mehr, wenn `prUrl === ""`. Der Catalog-Subtitle für `add-isin` / `batch` sagt im direct-write-Modus „in einem Schritt speichern" statt „einen Pull Request öffnen". Ein dezenter Overview-Hinweis erklärt den Modus an einer Stelle: „Direkt-Schreib-Modus — Katalog-Änderungen werden sofort in den Workspace gespeichert (kein Pull Request)."
- **Force-PR-Mode lokal:** `ADMIN_DIRECT_WRITE_DISABLED=1` setzen und api-server-Workflow neu starten — dann verhält sich die Admin-UI bit-identisch zur Production.
- **Bekannte Limitation:** Multi-File-Writes (`etfs.ts` + `lookthrough.overrides.json` beim Attach-Alternative-Flow) sind im direct-write-Modus nicht atomar; in der Praxis fast risikolos, da der JSON-Write nach erfolgreichem `etfs.ts`-Write praktisch nie fehlschlägt.
- **Verifikation:** Typecheck (investment-lab + api-server) PASS, 625 / 625 Unit-Tests grün, 14 / 14 e2e grün.
- **Doku:** `ETF_DATA_CONTROL.md` §12 grundlegend überarbeitet (neue „Two write modes"-Sektion, neue Env-Var `ADMIN_DIRECT_WRITE_DISABLED`, `whoami`-Tabelle erweitert um `directWrite`, „Open PR"-Wording auf „Save / Open PR" generalisiert). `replit.md` enthält bereits eine eigene „Admin direct-write mode (2026-05)"-Sektion.

### 2026-05-05 (pool-bulk-fill) — 74 popular orphan ETFs assigned to bucket pools

- **Operator-Wunsch:** Nachdem das Pool-Slot-Feature (Eintrag direkt unten) gelandet war, blieben alle Bucket-Pools leer (`More ETFs (0)` überall). Diese Änderung füllt sie aus dem 80er-Bestand der orphan popular UCITS ETFs, die bereits in `INSTRUMENTS` registriert waren (siehe `popular-etfs-orphan-bulk-add` weiter unten).
- **Mapping:** 74 von 80 Orphans wurden anhand ihrer `popular-etfs-seed.mjs`-Kategorie auf einen passenden bestehenden Bucket abgebildet und in dessen `pool: [...]`-Slot eingehängt — Equity-Global (+13), Equity-USA (+3), Equity-Technology (+7, inkl. NASDAQ100/AI/Cloud/Semis), Equity-Europe (+11), Equity-EM (+8), Equity-Japan (+3), Equity-Switzerland (+1), Equity-Healthcare (+3), Equity-Sustainability (+6, alle ESG/SRI/Clean-Energy/EV), Equity-Cybersecurity (+2), Commodities-Gold (+1), RealEstate-GlobalREITs (+1), FixedIncome-Global-EUR (+6), FixedIncome-Global (+9). 6 Orphans bleiben unzugeordnet (kein passender Bucket im Katalog): US-Sector-ConsStaples, 2× Thematic-Defense, Money-Market-USD, Commodities-broad, plus eine Eurozone-Duplikat-Stress-Entry.
- **Test-Anpassung (`tests/popular-etfs-orphan.test.ts`):** Invariante #3 hieß zuvor „kein staged ISIN ist von `getBucketKeyForIsin()` adressierbar" — diese Regel wurde durch das Pool-Feature obsolet (Pool-Einträge erscheinen ja absichtlich in `ISIN_TO_BUCKET`). Neue Invariante: `getInstrumentRole(isin) ∈ {"unassigned", "pool"}` für jeden staged ISIN — d. h. staged Popular-ETFs dürfen weiterhin niemals als `default` oder `alternative` landen, aber Pool-Placement ist jetzt explizit erlaubter, dokumentierter Pfad. Die Marker-Block-Invariante und die Coverage-Gates bleiben unverändert.
- **Konsequenzen für die UI:** Build's `MoreEtfsDialog` zeigt jetzt für die 14 oben gelisteten Buckets statt `More ETFs (0)` einen echten Pool (z. B. `More ETFs (13)` für Equity-Global). Explain's `IsinPicker` flaggt diese Einträge automatisch via `getInstrumentRole === "pool"` mit Pool-Badge.
- **Folge-Tweak (Sort-Reihenfolge im IsinPicker):** Innerhalb jeder Bucket-Gruppe im Explain-`IsinPicker` sind die Rows jetzt nach Rolle sortiert: `default → alternative → pool → unassigned`, mit alphabetischem Namens-Tiebreak. Vorher war die Reihenfolge die `listInstruments()`-Insertion-Order, was die Pool-Einträge nach dem Bulk-Fill teilweise vor die kuratierten Alternativen geschoben hätte; jetzt sieht der Operator die kuratierten Picks immer zuerst, gefolgt von den Pool-Einträgen mit ihrem Pool-Badge.
- **Folge-Tweak (Build-Picker UX, Schritt 1):** Im Build-Tab wurde der `More ETFs (N)`-Eintrag zunächst als zusätzlicher letzter Eintrag im Inline-`<Select>`-Dropdown angeboten (Sentinel `__more__` → öffnet `MoreEtfsDialog`), und der `MoreEtfsDialog` wurde auf Desktop verbreitert.
- **Folge-Tweak (Build-Picker UX, Schritt 2 — Vereinheitlichung):** Auf Operator-Wunsch wurde der separate `MoreEtfsDialog` komplett entfernt. Default + Alternativen + Pool werden jetzt **alle in genau demselben `<Select>`-Dropdown** in slot-Reihenfolge gerendert (`default → alt 1..N → pool 1..M`); jeder Pool-Eintrag trägt seinen eigenen grünen `Pool`-Badge in der Zeile, und ein dezenter Footer-Hinweis zählt am Dropdown-Ende `… · N Pool` auf. Die Auswahl eines Pool-Eintrags committet einfach den entsprechenden Slot via dem bestehenden `setETFSelection(catalogKey, slot)`-Pfad — die ausgewählte ETF (egal ob default, alt oder pool) erscheint identisch im Trigger und neben dem Trigger als separater Pool-Badge falls zutreffend. `MoreEtfsDialog.tsx` und der zugehörige `button-more-etfs-…`-Standalone-Button entfallen ersatzlos. `<SelectContent>` bekam `max-h-[60vh]` damit auch Buckets mit 50 Pool-Einträgen scrollbar bleiben.
- **Verifikation:** Typecheck PASS; 625 / 625 Unit-Tests grün (inkl. der angepassten Orphan-Test-Suite); 14 / 14 e2e grün — `validateCatalog()` (Strict-Uniqueness über `{default, alternative, pool}`) reportet 0 Issues, alle Build-/Explain-/Compare-Pfade verhalten sich identisch für die kuratierten Default+Alternative-Slots.

### 2026-05-05 (extended-universe-pool) — per-bucket "extended universe" pool of pickable ETFs

- **Operator-Wunsch:** Pro Bucket einen dritten Slot-Typ neben `default` und `alternatives` einführen — den **Pool**: weitere ISINs, die der Operator in Build (über einen neuen „More ETFs"-Dialog) und in Explain (über den existierenden per-Bucket `IsinPicker`) auswählen kann, **ohne** dass sie im Methodology-Empfehlungspfad auftauchen. Cap pro Bucket: 50.
- **Datenmodell (`src/lib/etfs.ts`):** `BucketAssignment` um `pool?: string[]` erweitert; `validateCatalog()` erzwingt strikte globale ISIN-Uniqueness über alle drei Slot-Typen `{default, alternative, pool}` hinweg. `MAX_POOL_PER_BUCKET = 50`. `listInstruments()` liefert pro Eintrag jetzt ein `role: "default" | "alternative" | "pool" | "unassigned"`.
- **Engine (`src/lib/etfSelection.ts` + `resolvePickerSelection` in `etfs.ts`):** Slot-Range erweitert: `0` = curated default, `1..altCount` = alternatives, `altCount+1..altCount+poolCount` = pool. `clampSlot` nimmt jetzt `(stored, alternativesCount, poolCount=0)` mit Default für Backward-Compat (alle bestehenden 2-arg-Aufrufe in Tests bleiben grün); Out-of-range-Slots fallen auf den höchsten verfügbaren Slot zurück (Legacy-Verhalten erhalten). Persisted-Slot-Cap (`MAX_TOTAL_SLOT = MAX_ALTERNATIVES_PER_BUCKET + MAX_POOL_PER_BUCKET`) wird **lazily** in `readAll()` berechnet, weil `etfs.ts ↔ etfSelection.ts` einen Import-Zyklus bilden — eine Top-Level-Berechnung würde `MAX_POOL_PER_BUCKET` als `undefined` beobachten und alle gespeicherten Selektionen via `v <= NaN` silent droppen. `selectableOptions` (Typ `ETFDetails["selectableOptions"]` in `lib/types.ts` und der lokalen Variante in `lib/etfs.ts`) bekommt zwei optionale Felder: `kind: "default" | "alternative" | "pool"` und `distribution`.
- **Build-UI (`src/components/investment/BuildPortfolio.tsx` + neue `MoreEtfsDialog.tsx`):** Inline-`<Select>` zeigt nur noch `default + alternatives` (gefiltert via `kind !== "pool"`). Daneben rendert ein `More ETFs (N)`-Ghost-Button (Test-ID `button-more-etfs-${bucket}`) den `MoreEtfsDialog` — eine durchsuchbare Liste der Pool-Einträge mit Name, ISIN, TER, Distribution-Badge und einem Pool-Badge in Smaragd. Auswahl ruft `setETFSelection(catalogKey, slot)` mit dem absoluten Slot-Index in `selectableOptions` auf, sodass sich der bestehende Persistenz-/Re-Render-Pfad nicht ändert. Wenn der aktuell selektierte Slot ein Pool-Eintrag ist, zeigt der Trigger-Bereich zusätzlich einen kleinen Pool-Badge (Test-ID `etf-picker-pool-badge-${bucket}`).
- **Explain-UI (`src/components/investment/ExplainPortfolio.tsx`):** Der bestehende `IsinPicker` iteriert bereits über `listInstruments()` und filtert nach `bucketKey` — Pool-Einträge erscheinen automatisch (sie liegen via `ISIN_TO_BUCKET` im richtigen Bucket). Zusätzlich rendert jede Pool-Row im Picker einen Pool-Badge (`isin-option-pool-badge-${isin}`) via `getInstrumentRole(r.isin) === "pool"`, damit Operator kuratierte Alternativen vom breiteren Pool optisch unterscheiden kann.
- **Admin (T002+T003 — bereits gelandet):** `injectPool`/`removePool` in `artifacts/api-server/src/lib/github.ts` als PR-only Mutatoren mit Uniqueness-Enforcement. Routen `POST /admin/buckets/:key/pool` und `DELETE /admin/buckets/:key/pool/:isin`. UI-Surfaces: dritter „+ Pool"-Action-Button pro Tree-Row, Role-Spalte in `InstrumentsPanel`, Glossary-Eintrag „Pool" (DE+EN).
- **i18n:** Neue Keys (DE+EN) für Build: `build.impl.picker.pool`, `build.impl.moreEtfs.{button,tooltip,title,desc,search,empty,disclaimer,close}`. Neuer Key `explain.picker.pool` für Explain.
- **Verifikation:** Typecheck PASS; **625 / 625 Unit-Tests grün** (inkl. der bestehenden `etfSelection.test.ts`-Suite, die das Backward-Compat-2-arg-Signaturversprechen abdeckt). E2E-Suite (Mobile-Viewport-Regressions) ebenfalls grün — Slot-Persistenz, Build-Picker-Verhalten und Explain-Editor unverändert für Default-/Alternative-Pfade.

### 2026-05-01 (popular-etfs-orphan-bulk-add) — 80 popular UCITS ETFs added as orphan instruments + look-through pool fill
- **Operator-Wunsch:** Damit der Live-ETF-Info-Preview im Explain-Editor (siehe Eintrag `manual-etf-info-preview` weiter unten) auch für die **gängigsten** UCITS-ETFs sofort einen Catalog-Treffer liefert (statt nur „off-catalog manual entry"), den kuratierten 62-Bucket-Katalog aber **nicht** durch Dutzende neuer Default/Alternative-Slots aufzublähen, brauchen wir eine dritte Kategorie: **Orphan-Instruments** — Einträge, die in `INSTRUMENTS` registriert und damit von `getInstrumentByIsin()` aufgelöst werden, aber von **keinem** `BUCKETS`-Slot referenziert werden. Gleichzeitig soll der Look-Through-Pool dieselben ISINs vom ersten Tag an mit Geo/Sektor/Top-Holdings-Daten füllen, damit Methodology-Look-Through-Karten und Home-Bias-Analyse sofort funktionieren.
- **Datenmenge:** **80 neue Orphans** in `INSTRUMENTS` (`src/lib/etfs.ts` — 62 Bucket-bound + 80 Orphans = 142 ISINs total). Look-Through-Pool: **74 von 80 mit voller Geo+Sektor-Abdeckung** (92.5 %); davon **60 zusätzlich mit Top-10-Holdings**. Die 6 verbleibenden Partials (LU0274208692, LU1681038243, LU0290358497, LU0292107645, CH0044781232, DE000A0H0728) sind synthetische Swap-basierte ETFs, deren justETF-Profile keine Holdings/Breakdown-Tabellen rendern — by-design-Limit der Datenquelle, nicht des Scrapers.
- **Curated seed (`scripts/data/popular-etfs-seed.mjs`):** 107 ISINs als kuratierter Proxy für die justETF-Popularitäts-Rangliste (die selbst Wicket/JS-rendered und nicht ohne Chromium / ToS-Risiko bulk-scrapeable ist). Abdeckung: Broad World Equity, S&P 500, NASDAQ 100, MSCI Europe / Stoxx 600 / EuroStoxx, Eurozone Mid/Small, MSCI EM/IMI, MSCI Japan, Pacific ex-Japan, Country (UK/DE/CH/FR/IT/IN/CN), Sector/Thematic (Tech, Healthcare, Energy, Defense, Semis, Water, Clean Energy, AI/Robotics), Small/Mid-Cap, Factor (Value/Quality/Momentum), Dividend, ESG/SRI, Gold/Precious Metals, Broad Commodities, REITs, Government Bonds (EUR/USD/Global, Short/Long), Corporate Bonds (IG/HY), Inflation-Linked, Money-Market (EUR/USD/CHF). Über-shoot, sodass nach Drop von Duplikaten zu den 62 bestehenden + Scrape-Fails noch ≥ 80 übrig bleiben.
- **Enrichment-Script (`scripts/scrape-popular-etfs-instruments.mjs`):** Resumable, polite-rate-limited (1.5 s zwischen ISINs) Scraper. Nutzt die bestehenden CORE/PREVIEW/LISTINGS-Extractoren aus `scripts/lib/justetf-extract.mjs`. Bail-Policy pro Eintrag: wenn `name | currency | domicile | terBps | replication | distribution | defaultExchange (LSE > XETRA > SIX > Euronext)` undefined → Skip in `failed[]`. Schreibt nach jedem Eintrag inkrementell in `scripts/data/popular-etfs-staged.json`. Drei Chunks à LIMIT=40 → final 80 staged + 9 failed (z. B. delisted oder ISIN-Tippfehler im Seed).
- **Inject-Script (`scripts/inject-popular-etfs.mjs`):** Idempotenter Splicer mit BEGIN/END-Marker-Kommentaren (`// ----- BEGIN auto-added popular-ETFs orphans -----`) direkt vor dem schließenden `};` von `INSTRUMENTS`. Re-Run = No-op (erkennt vorhandene Marker und skippt). Kommentar pro Eintrag: kurz, faktisch — z. B. „Popular UCITS ETF auto-added from curated justETF top-list on 2026-05-01; orphan catalog entry available for Explain manual-entry recognition." Seed-Notes (z. B. `_seedNote: "iShares Core MSCI World"`) werden bewusst aus dem TS-Output gestrippt, da justETF-Daten authoritativ sind.
- **Look-Through-Pool-Fill (`scripts/scrape-popular-etfs-pool.mjs`):** Resumable per-ISIN-Scraper, der die existierenden Helper aus `scripts/refresh-lookthrough.mjs` (`fetchLookthroughProfile`, `extractEtfName`, `hasLoadMoreLink`, `fetchBreakdownAjax`, `BREAKDOWN_AJAX_PATHS`) wiederverwendet — diese wurden hierfür als named exports verfügbar gemacht. Pool-Entry-Shape: `{ name, geo, sector, breakdownsAsOf, _source: "justetf", _addedAt, _addedVia: "scrape-popular-etfs-pool", isEquity, topHoldings?, topHoldingsAsOf?, currency? }`. **Politik-Anpassung #1 (Coverage):** `buildPoolEntry()` schreibt einen Eintrag bereits, wenn `geo + sector` vorhanden sind — `topHoldings` ist optional, weil justETF die Top-Holdings-Tabelle nur für Equity-ETFs publiziert; Bond/Commodity/Synthetic-ETFs liefern valide Geo+Sektor-Breakdowns aber keine Holdings, und genau diese Geo+Sektor-Daten sind es, die der Look-Through-Engine in `metrics.ts` konsumiert (Holdings sind nur „what's-inside"-Vorschau). **Politik-Anpassung #2 (Asset-Class-Routing — kritisch, post-review-fix):** `buildPoolEntry()` setzt `isEquity` explizit basierend auf der `_seedCategory` (Map `seedCategoryByIsin` aus `popular-etfs-seed.mjs`); Bond/Money-Market/Inflation-Linked/Fallen-Angels-Kategorien (Regex `FIXED_INCOME_CATEGORY_RE`) → `isEquity:false`, alle anderen (inkl. Equity, Sektor, Thematic, Commodity, REIT) → `isEquity:true`. Komplementär dazu wurde der **Reader-Side-Merge-Gate** in `src/lib/lookthrough.ts` (Pool-Merge-Loop bei L596+) zwei Mal angepasst: (a) Eintritt nur noch wenn `geo + sector` vorhanden ist (vorher: zusätzlich `topHoldings`-required → 14 Bond-Einträge wurden silent gedroppt), (b) `isEquity` wird aus dem Pool-Eintrag übernommen (`entry.isEquity ?? true` für Backward-Compat mit pre-Task-#127 Curated-Overrides, die alle Equity sind). Der `LookthroughOverride`-Typ (L470) ist um optional `isEquity?: boolean` erweitert. Persistenz nach jedem ISIN, sodass ein SIGTERM mid-batch ≤ 1 ISIN Arbeit kostet. `_meta.lastRefreshed` wird bei jedem Persist gebumpt. Backfill für 16 bestehende Bond-Pool-Einträge (`isEquity:false` nachgetragen) via Ad-hoc-Script — verifiziert per Test #7.
- **Verifikations-Test (`tests/popular-etfs-orphan.test.ts`):** Sieben Invarianten: (1) BEGIN/END-Marker-Block in `etfs.ts` intakt, (2) ≥ 80 Staged-Entries (DoD-Minimum), (3) jeder Staged-ISIN via `getInstrumentByIsin()` auflösbar, (4) **kein** Staged-ISIN von `getBucketKeyForIsin()` zurückgegeben (Orphan-Invariante — sie dürfen NICHT in BUCKETS auftauchen), (5) `validateCatalog()` returnt leere Issues-Liste (Strict-Uniqueness und INSTRUMENTS↔BUCKETS-Konsistenz nicht durch den neuen Block verletzt), (6) **Runtime-Coverage-Gate:** ≥ 80 % der Orphans liefern via `profileFor(isin)` ein Profil mit nicht-leerem `geo + sector` zurück (statt vorher: rohe `pool[isin]`-JSON-Key-Presence — die alte Variante wäre grün geblieben, selbst wenn der Reader-Side-Merge-Gate die Einträge silent dropped; aktuell 92.5 %), (7) **Asset-Class-Routing-Gate:** Bond/Money-Market/Inflation-Linked-ISINs aus dem Seed haben `isEquity:false` im Pool-Eintrag (Pool-direkt geprüft, nicht via `profileFor()`, weil eine kleine vorbestehende `ALIAS`-Map einige Hedged-Share-Class-ISINs absichtlich auf das Equity-Underlying umleitet — z. B. EUR-hedged S&P-500-Slots).
- **Konsequenzen für die UI:** (a) `IsinPicker` und alle BUCKETS-iterierenden Dropdowns bleiben **unverändert** — Orphans erscheinen nicht in Bucket-Pickern (sie haben keinen Bucket). (b) Der Live-ETF-Info-Preview im Explain-Editor zeigt für die 80 neuen ISINs jetzt sofort den Catalog-Hit-State (Master-Daten aus `INSTRUMENTS`, nicht aus async Scrape) plus den Pool-Look-Through-Banner mit Counts (geo:N · sector:N · top-holdings:N) für die 74 mit kompletten Pool-Daten. (c) Bei manuellem Eintrag fließt die Position via `profileFor(p.isin)` in `metrics.ts` automatisch in Geo/Sektor/Top-Holdings/Home-Bias-Karten ein.
- **Verifikation:** Typecheck PASS; **599 / 599 Unit-Tests grün** (591 vorbestehend + 7 neue Orphan-Invariant-Tests + 1 vorhandener wiederhergestellt) + 14 / 14 e2e + Playwright-Smoke (manueller Eintrag von `IE00BFNM3P36` zeigt Catalog-Recognized-State mit 14 Geo / 12 Sektor). Look-Through-Overrides-Datei: 11 Curated Overrides (unverändert) + 103 Pool-Entries (29 vorbestehend + 74 neu via `_addedVia: "scrape-popular-etfs-pool"`); 16 Bond-Pool-Einträge mit `isEquity:false` (14 neu + 2 backfilled, die bereits Geo+Sektor hatten).

### 2026-05-01 (manual-etf-info-methodology-section) — Methodology section + What's-new pill for manual ETF entry
- **Operator-Wunsch (Folge-Iteration):** Die im vorherigen Eintrag ausgelieferte Live-Vorschau & Pool-Look-Through-Anreicherung für manuell erfasste ISINs braucht eine **dokumentierte Quelle der Wahrheit** in der Methodik-Ansicht — sodass externe Leser (Demo-Publikum, Reviewer) nachvollziehen können, woher die Vorschau-Daten kommen, in welcher Reihenfolge sie aufgelöst werden und welche Garantien der Hook gibt — und gleichzeitig im permanenten „Was ist neu"-Panel sichtbar wird.
- **Neue Methodik-Section (`Methodology.tsx`):** `<Section value="manual-isin">` direkt nach `lookthrough` (Gruppe „Wie Ergebnisse berechnet werden"), Icon `Sparkles`. Vier Subsektionen: (1) Datenquellen in Prioritätsreihenfolge wie sie die Vorschau verwendet — Catalog (sync, lokal, `getInstrumentByIsin()` aus `src/lib/etfs.ts`) > Pool (sync, lokal, `profileFor()` aus `src/lib/lookthrough.ts`) > justETF-Vorschau (async, debounced 500 ms, `/api/etf-preview/:isin`, 10 min Browser-Cache, server-Rate-Limit 10/min/IP); (2) Was die Vorschau zeigt — Master-Daten + Pool-Look-Through-Banner + Quick-Fill-Button (mit Doppel-Gating-Hinweis: nie überschreiben); (3) Konsequenzen für die Berechnung — präzise beschrieben, dass Vorschau und ETF-Implementation-Tabelle entkoppelt sind: TER & Currency aus `manualMeta` (per Quick-Fill vor dem Speichern), Replikation/Domizil leer, Distribution hardcoded „Accumulating"; Pool-Daten beeinflussen im Synthesizer **nur** den Comment-Text + Freshness-Stamp; die eigentliche Look-Through-Mathematik läuft unabhängig in `metrics.ts`; (4) Robustheit beim Tippen — Per-Effect-Epoch-Token + AbortController gegen Stale-Resolves; nur strukturell fehlerhafte Antworten (Sentinel `ETF_PREVIEW_MALFORMED`) werden lokalisiert (DE/EN), HTTP-Fehler (429/504/4xx/5xx) werden mit der server-gelieferten Originalmeldung inline gerendert.
- **Versions-Panel (Single-Source-of-Truth `SECTION_VERSIONS`):** Neuer Eintrag `"manual-isin": { version: "v1.8", month: "May 2026" }`. Damit erscheint der Eintrag automatisch (a) als grüne `v1.8`-Pille rechts neben dem Section-Titel via `version={sectionVersionLong("manual-isin")}`, (b) als Mini-Pille im JumpMenu-ToC via `version: sectionVersionShort("manual-isin")`, und (c) als Top-Level-Item im `<WhatsNewPanel>` (jetzt 4 Einträge — vorher 3). Headline-Override im Panel-Label-Overrider: „Live preview & pool look-through for manually-entered ISINs" / „Live-Vorschau & Pool-Look-Through für manuell erfasste ISINs" (verb-y, statt der nüchterneren ToC-Bezeichnung „Manual ETF Entry").
- **Routing-Allow-List:** `"manual-isin"` zu `VALID_SECTION_IDS` (zwischen `lookthrough` und `hedging`) hinzugefügt, sodass Deep-Links wie `/?tab=methodology#manual-isin` und Klicks aus dem What's-new-Panel die Section auch nach Page-Reload korrekt aufklappen + scrollen.
- **Verifikation:** Typecheck PASS; **592 / 592 Unit-Tests grün** (kein bestehender Test berührt die Methodik-Section, der zusätzliche Eintrag ist datengetrieben über den existierenden Flow); Live-Preview-Screenshot zeigt das What's-new-Panel mit „4" als Counter und „v1.8 · May 2026 — Live preview & pool look-through for manually-entered ISINs" als oberster Eintrag. Last-reviewed-Stamp im Methodology-Header bleibt unverändert auf `Q2 2026` (passt zum Mai 2026-Release).

### 2026-05-01 (manual-etf-info-preview) — Live ETF info preview for off-catalog manual entries
- **Operator-Wunsch:** Off-Catalog-ETFs (manuell erfasste ISINs ausserhalb des kuratierten Katalogs) sollen im Explain-Editor sofort mit Stamm- und Look-Through-Daten unterlegt werden — sowohl als Live-Vorschau direkt im Eingabeformular (zum Sanity-Checken vor dem Hinzufügen) als auch in der ETF-Implementation-Tabelle und den Look-Through-Karten danach. Die Look-Through-Berechnung selbst funktionierte für manuelle ETFs **bereits** (`profileFor(isin)` in `metrics.ts` ist auf die ISIN gekeyed, nicht auf den `bucketKey` — sobald der monatliche Cron den Pool für diese ISIN befüllt, fließt die Position automatisch in Geo/Sektor/TopHoldings/HomeBias ein); die Lücke war reine **Sichtbarkeit**.
- **Hook (`src/lib/useEtfInfo.ts`):** Konsolidiert drei Quellen für eine ISIN:
  1. **Catalog** — synchron via `getInstrumentByIsin()` (rare hit: Operator tippt eine ISIN, die zufällig im kuratierten Katalog ist).
  2. **Pool** — synchron via `profileFor()` aus `lookthrough.overrides.json` (selber Datenquelle wie für Katalog-ETFs — entscheidend für die Operator-Information „diese Position trägt zu den Look-Through-Karten bei").
  3. **Scrape** — async, debounced (500 ms) via `GET /api/etf-preview/:isin` (server-seitig rate-limited 10/min/IP, 5-min in-memory TTL, 8 s Timeout pro Upstream-Scrape). Module-level `Map<isin, {ok|err, at}>`-Cache mit 10 min TTL verhindert Re-Fetches innerhalb desselben Tabs (z. B. wenn der Operator die Section zu- und wieder aufklappt). Stale-resolve-Schutz via `inflightIsin`-Ref (gegen Race-Conditions bei schnellem Tippen). ISIN-Validierung gegen `/^[A-Z]{2}[A-Z0-9]{9}\\d$/`. Returnt `{isValidIsin, catalogInstrument, pool, scrape, scrapeLoading, scrapeError}` — Fehler werden niemals geworfen, nur über `scrapeError` exposed.
- **Preview-Component (`src/components/explain/EtfInfoPreview.tsx`):** Kompakte Karte unterhalb der ISIN-Inputs in manuellen Rows, gerendert nur wenn die ISIN das Regex-Match passiert. Drei Sektionen, jede nur wenn Daten vorhanden:
  - **Master-Daten** (Catalog > Scrape, da kuratierte Daten Priorität haben): Name, Currency, TER (bps + %), AUM (M EUR oder bn EUR ab ≥ 1000), Inception, Replication, Distribution, Domicile. TER-Heuristik: Scrape liefert manche Extractoren als Prozent (0.07), andere als bps (7) — `<= 5` wird als Prozent interpretiert und × 100 normalisiert.
  - **Pool-Look-Through-Banner** mit Badge „Look-Through aus Pool" + Counts (N Regionen, N Sektoren, N Top-Holdings) + Freshness-Stamps (`breakdownsAsOf`, `topHoldingsAsOf`). Wenn KEIN Pool: amber-Hinweis „Keine Look-Through-Daten im Pool — diese Position trägt 0 % zu Geo-/Sektor-/Top-Holdings-Karten und Home-Bias bei."
  - **Quick-Fill-Button** „Werte übernehmen" / „Use these values": kopiert Name, Currency, TER aus Scrape/Catalog in `manualMeta` — **nur in Felder, die der Operator noch nicht gesetzt hat** (Doppel-Gating: Component filtert clientseitig welche Keys im Payload landen, State-Setter `quickFillManualMeta` re-checkt vor dem Merge gegen Race-Conditions). Button verschwindet wenn nichts mehr zu füllen ist. Loading-Spinner und Error-Alert (nur wenn weder Catalog noch Pool was haben — sonst wäre der rote Alert irreführend, da die Position trotzdem korrekt enriched ist) inline. justETF-Source-Link mit `target="_blank" rel="noopener"`. Bilingual via `useT().lang` mit lokalem `tx(de, en)`-Helper (der `t`-Helper im Explain-Workspace nimmt nur Key-Strings, keine `{de,en}`-Objekte).
- **Mount (`src/components/investment/ExplainPortfolio.tsx`):** `<EtfInfoPreview>` direkt unter der ISIN/Asset-Class/Region-Inputs der manuellen `PositionRow` gerendert (nicht für Katalog-Picker-Rows — dort gibt es bereits den `IsinPicker` mit eigener Anzeige). Neue PositionRow-Prop `onManualMetaQuickFill: (values: QuickFillValues) => void` separat von `onManualMetaChange` gehalten, damit der bestehende Field-Setter-Vertrag eng bleibt. Neue State-Funktion `quickFillManualMeta(index, values)` neben `setManualMetaField`. Alle drei `PositionRow`-Aufruf-Sites (Bucket-Tree, Manual-Pseudo-Group, Legacy-Unassigned) wired.
- **ETF-Implementation-Row-Enrichment (`src/lib/personalPortfolio.ts` L137 ff.):** Im `manualMeta`-Branch von `synthesizePersonalPortfolio` zusätzlich `profileFor(p.isin)` gerufen (der Catalog-Lookup darüber hat bereits `undefined` zurückgegeben — sonst wären wir im anderen Branch). Wenn Pool existiert → Comment wird zu „Manuell erfasst — Pool-Look-Through aus justETF (Stand: YYYY-MM-DD)." mit `breakdownsAsOf ?? topHoldingsAsOf` als Stamp; sonst der bestehende „keine Katalog-Look-Through-Daten verfügbar"-Fallback. Damit sieht der Operator in der ETF-Implementation-Tabelle direkt, ob die Position zu den Look-Through-Karten beiträgt und wie alt die zugrundeliegenden Pool-Daten sind. Die anderen Felder (TER, Currency, etc.) bleiben unverändert auf `manualMeta`-Werten — die kommen jetzt via Quick-Fill aus der Preview, nicht aus einem zweiten Server-Lookup im Synthesizer (wäre teuer und redundant).
- **Verifikation:** Typecheck PASS; **591 / 591 Unit-Tests grün** (kein Test berührt das neue Hook/Component-Paar — sie sind reine UI/Live-Lookup-Layer); e2e-runTest gegen `/explain` PASS — manueller Eintrag mit ISIN `IE00B4L5Y983` rendert Preview-Karte mit „iShares Core MSCI World UCITS ETF USD (Acc)" + USD + ~20 bps TER + ~115 Mrd EUR AUM + Inception 2009-09-25 + justETF-Link; Quick-Fill befüllt manualMeta korrekt; Preview verschwindet bei invalider Partial-ISIN; Fallback-State (nur Header, ohne Master-Daten) bei valider aber unbekannter ISIN `XX0000000000`; keine Console-Errors. Smoke-Curl gegen `/api/etf-preview/IE00B4L5Y983` ohne Auth → 200 + erwarteter Shape (Endpoint ist absichtlich public, durch Rate-Limit + Server-Cache gegated).

### 2026-05-01 (admin-file-compare-viewer) — Per-file Replit ↔ GitHub-main side-by-side viewer
- **Operator-Wunsch:** Der `WorkspaceSyncPanel` auf `/admin/operations/sync` zeigt zwar an, **wie viele Commits** der Workspace gegenüber `origin/main` zurück- oder vorausläuft, beantwortet aber nicht die operativ wichtigste Folgefrage: **welche konkreten Felder** in den vom monatlichen Cron-Job gepflegten Override-Dateien haben sich geändert? Bevor man pullt (oder einen lokalen Stand committet), will der Betreiber Zeile für Zeile sehen, was genau divergent ist.
- **Allow-list (3 Dateien, beidseits hartkodiert):** `etfs.overrides.json` (Cron-gepflegte ETF-Stammdaten-Overrides — TER, AUM, Inception), `lookthrough.overrides.json` (Cron-gepflegter Look-Through-Pool — Top-Holdings, Geo, Sektor) und `etfs.ts` (hand-kuratierter Katalog — Buckets, Default-Tickers, Listings). Die fileId ist ein opaker Schlüssel (`"etfs-overrides" | "lookthrough-overrides" | "etfs-ts"`), die Route echot **niemals** einen vom Client benannten Pfad an die Disk weiter — Path-Traversal ist by-design unmöglich.
- **Backend (`artifacts/api-server/src/routes/admin.ts`):** Neuer Endpoint `GET /admin/file-compare/:fileId` (durch `requireAdmin` gegated, wie alle anderen `/admin/*`). Liest die lokale Datei via `dataFile()` / `getCatalogPath()` (funktioniert in pnpm-dev und im gebündelten Prod-Mode), holt den GitHub-Blob über das bestehende `octokit.repos.getContent({ ref: "heads/${base}" })`-Pattern (Base-Branch via `GITHUB_BASE_BRANCH ?? "main"`, gleicher PAT wie für die PR-Flows), und berechnet einen `structuredPatch` aus `diff@9` mit Kontext = 3. Hard-Cap pro Seite: **1 MB** — wird sie auf irgendeiner Seite überschritten, kommt symmetrisch ein `200`-Response mit `truncated: true`, leerem `hunks: []` und `htmlUrl` zurück (nicht `413` — das wäre für die Local-Seite asymmetrisch zur GitHub-Seite gewesen und hätte die UI-Fallback-Logik kaputtgemacht). Typisierte Fehler-Keys: `unknown_file_id`, `local_file_missing`, `local_read_failed`, `github_not_configured`, `github_fetch_failed`, `github_file_missing`.
- **Client-Typen (`src/lib/admin-api.ts`):** Neue `FileCompareFileId`, `FileCompareHunk` (Mirror von `StructuredPatchHunk`, ohne `@types/diff` ins Bundle zu ziehen) und `FileCompareResponse`-Interfaces. `adminApi.fileCompare(fileId)` benutzt den bestehenden `call<>()`-Helper (sessionStorage-Bearer-Token).
- **UI (`src/components/admin/FileCompareViewer.tsx`):** Chip-Selektor für die 3 Dateien (Default = `etfs-overrides`), Header-Zeile mit Repo-Pfad, Byte-Größen pro Seite, GitHub-Short-SHA als Link auf `htmlUrl` und Status-Pill (`identisch` grün / `N Hunks` amber / `Datei zu groß` amber / Fehler-Alert rot). Body: zwei-spaltiges, scrollbares Grid (max-h-600px) mit Hunk-Headern und Zeilen-Pairing. Pairing-Algorithmus: pro Hunk werden `-`-Runs und `+`-Runs gepuffert und beim nächsten Kontext-Trigger Index-für-Index gepaart, kürzere Seite mit Blank gepadded — Kontext-Zeilen erscheinen mit derselben Zeilennummer beidseits. Bilingual via `useAdminT()`. Test-IDs: `file-compare-card`, `file-compare-selector`, `button-file-compare-pick-{id}`, `file-compare-status-pill`, `file-compare-sbs`, `file-compare-row-context`, `file-compare-row-change`, `file-compare-cell-{added|removed}-{lineNo}`, `link-file-compare-github`.
- **Mount (`src/pages/admin/Operations.tsx`):** Im `sync`-Sub-Tab erscheint `FileCompareViewer` direkt unter `WorkspaceSyncPanel`, gewrappt in `<div className="space-y-4">`. Andere Sub-Tabs (prs/changes/runs/freshness) bleiben unverändert.
- **Verifikation:** API-Server-Build PASS (esbuild 130ms); Typecheck PASS; **591 / 591 Unit-Tests grün**; Smoke-Curl gegen `/api/admin/file-compare/etfs-overrides` ohne Auth → `401` (Route mounted + admin-gated wie erwartet).

### 2026-05-01 (explain-analysis-order-mirrors-build) — Explain analysis-block order matches Build
- **Operator-Wunsch:** „apply the same order to the analysis blocks in My Portfolio as they are in Build" — die Cards unter dem Explain-Editor erschienen in einer anderen Reihenfolge als im Build-Tab, was beim Wechsel zwischen den beiden Tabs zu einer kognitiven Reibung führte (gleiche Daten, andere Lese-Reihenfolge).
- **Build-Reihenfolge (`BuildPortfolio.tsx` L1559–L1643, unverändert):** ETF-Implementation → CurrencyOverview → (Look-Through-Block: GeoExposureMap + LookThroughAnalysis + TopHoldings) → MonteCarloSimulation → PortfolioMetrics (Risk & Performance) → StressTest → HomeBiasAnalysis (non-USD) → Learning Insights → FeeEstimator.
- **Explain vorher (`ExplainPortfolio.tsx`):** PortfolioMetrics → CurrencyOverview → (Look-Through-Block) → FeeEstimator → MonteCarloSimulation → StressTest → HomeBiasAnalysis. Drei Blöcke an der falschen Stelle: PortfolioMetrics zu früh, FeeEstimator vor MonteCarlo, MonteCarlo nach FeeEstimator.
- **Explain nachher (jetzt):** CurrencyOverview → (Look-Through-Block) → MonteCarloSimulation → PortfolioMetrics → StressTest → HomeBiasAnalysis (non-USD) → FeeEstimator. Identischer Flow wie Build, abzüglich der zwei Build-eigenen Cards (ETF Implementation Chooser, Learning Insights), die in Explain konzeptionell nicht existieren — der Anwender bringt seine ETFs schon mit, und es gibt keine Synthesizer-Lerntexte.
- **Begründung der Reihenfolge (jetzt einheitlich):** „where am I exposed?" (Currency, Geo, Look-Through) → „what could happen?" (Monte Carlo) → „what risk did I take?" (Metrics, Sharpe/Beta/etc.) → „what if a known crisis hits?" (Stress) → „is my home market underrepresented?" (Home Bias) → „what does this cost me?" (Fees). Der Inline-Comment in `ExplainPortfolio.tsx` dokumentiert die Mirror-Invariante explizit, damit zukünftige Block-Hinzufügungen synchron bleiben.
- **Verifikation:** Typecheck PASS; **591 / 591 Unit-Tests grün** (kein Test verlässt sich auf die alte Block-Reihenfolge — die e2e-Suite tappt nur auf `data-testid="explain-analysis"` als Container und auf einzelne Card-testids wie `mc-mdd-p50`); **14 / 14 e2e-Tests grün** in 2.0 min, einschließlich CHF/EUR/GBP-Home-Bias und Persistenz-Roundtrip-Tests, die sicherstellen, dass HomeBiasAnalysis weiterhin innerhalb des `explain-analysis`-Containers gefunden wird.

### 2026-05-01 (bucket-label-hedge-currency) — Hedge currency surfaced in bucket labels (Explain editor)
- **Operator-Wunsch:** Im neuen Tree-of-Buckets-Editor (Task #148) listet die `Equity → USA`-Section drei Hedged-Varianten — `Equity-USA-EUR`, `Equity-USA-CHF`, `Equity-USA-GBP` — die alle als „USA (hedged)" gerendert wurden und dadurch im Picker-Group-Header und im Bucket-Sub-Header **nicht unterscheidbar** waren. Currency soll im Label sichtbar sein.
- **Datenmodell (`src/lib/etfs.ts`):** `BucketMeta` um optionales Feld `hedgeCurrency?: "EUR" | "CHF" | "GBP"` erweitert. `decodeBucketKey()` extrahiert das Suffix (`-EUR` / `-CHF` / `-GBP`) jetzt zusätzlich als `hedgeCurrency` (statt es nur durch `hedged: true` zu konsumieren). `BUCKET_META_CACHE` profitiert automatisch — alle Konsumenten von `getBucketMeta()` sehen das Feld ab sofort.
- **Render-Sites (`src/components/investment/ExplainPortfolio.tsx`):** Beide Stellen, die das Hedged-Suffix rendern, ziehen jetzt die Währung mit:
  - IsinPicker `CommandGroup`-Header (Z. 248–262): `(hedged)` → `(EUR-hedged)` / `(CHF-hedged)` / `(GBP-hedged)`; DE: `(EUR-gehedgt)` etc.
  - `bucketHeader(meta)` (Z. 775–785): identisches Format, sodass Picker-Header und Bucket-Sub-Header denselben String tragen (Mirror-Invariante aus dem Inline-Kommentar bewahrt).
  - Synthetic-Tail (` · synthetic` / ` · synthetisch`) bleibt unverändert.
  - Fallback: wenn `hedgeCurrency` für irgendeinen Grund fehlt (z. B. zukünftige Hedged-Buckets ohne Suffix), fällt das Label sauber auf das alte `(hedged)` zurück (`ccyPrefix = ""`).
- **Verifikation:** Typecheck PASS; **591 / 591 Unit-Tests grün** (keine Tests verlassen sich auf das alte Label-Format); **14 / 14 e2e-Tests grün** in 1.9 min — die Tree-of-Buckets-Tests aus #148 navigieren über `data-testid="explain-add-in-bucket-${bucketKey}"`, also unabhängig von der gerenderten Heading-Schreibweise. Beobachteter Effekt im Build: `Equity → USA`-Section zeigt jetzt vier unterscheidbare Buckets — `USA`, `USA (EUR-hedged)`, `USA (CHF-hedged)`, `USA (GBP-hedged)`.

### 2026-05-01 (explain-defaults-mirror-build) — Explain default workspace settings mirror Build (Task #149)
- **Operator-Wunsch:** „Make same default values as in build" — die Default-Settings im Explain-Tab (Base Currency, Risk Profile) sollen mit den Build-Defaults übereinstimmen, damit ein neuer Anwender denselben Startpunkt sieht, wenn er zwischen den beiden Tabs wechselt.
- **Änderung (`ExplainPortfolio.tsx`):** `DEFAULT_STATE.baseCurrency` von `"USD"` → `"CHF"` und `DEFAULT_STATE.riskAppetite` von `"Moderate"` → `"High"` — gleicher Stand wie `defaultValues` in `BuildPortfolio.tsx` (`baseCurrency: "CHF", riskAppetite: "High", horizon: 10, includeCurrencyHedging: false, lookThroughView: true`). `horizon`, `hedged` und `lookThroughView` waren bereits konsistent. Keine Änderung am Persistenz-Schema, an den Whitelists in `loadState()`, oder an irgendeiner Engine-/Synthesizer-/Validator-Logik — bestehender `localStorage["investment-lab.explainPortfolio.v1"]`-State wird weiterhin Field-für-Field validiert restored, der neue Default greift nur, wenn kein gespeicherter State existiert oder der gespeicherte Wert die Whitelist-Validierung nicht passiert.
- **e2e (`tests/e2e/explain-portfolio.spec.ts`):** Zwei Stellen angepasst, die explizit „USD default" annahmen — (a) der Inline-Kommentar im „add three ETFs"-Test über Geo/Stress/Home-Bias-Sichtbarkeit (jetzt: CHF default → Home Bias mountet ebenfalls, dedizierte NON_USD_BASES-Tests decken das ab); (b) im NON_USD_BASES-Block die alte „Sanity: USD default → Home Bias suppressed"-Assertion entfernt — sie ist nicht mehr anwendbar, der Test verlässt sich jetzt nur noch auf die positive Assertion (Home-Label sichtbar nach Switch zu `code`). Der CHF-Case wechselt nominell von CHF default → CHF (no-op) und passt weiterhin durch das gleiche Select-Flow (force-click auf Option, Trigger-Text-Verifikation).
- **Verifikation:** Typecheck PASS; **591 / 591 Unit-Tests grün** (keine Fixtures hatten Hard-Codes auf die alten Defaults); **14 / 14 e2e-Tests grün** in 1.9 min (8 Explain-spezifische Tests einschließlich Manual-ISIN, File-Roundtrip, CHF/EUR/GBP-Home-Bias, Persistenz-Roundtrip).

### 2026-05-01 (explain-tree-of-buckets) — Explain editor rebuilt as a tree of catalog buckets (Task #148)
- **Operator-Wunsch:** der Explain-Tab-Editor war eine flache Liste mit zwei redundanten Toolbar-Eingängen („Add ETF" + „By bucket"-Popover). Umbau zu einem Baum: jede Asset-Class des Katalogs (Equity, Fixed Income, Real Estate, Commodities, Digital Assets, Cash) ist eine ausklappbare Chevron-Section; jeder Bucket innerhalb einer aufgeklappten Section trägt seinen eigenen `[+]`-Button, der einen auf genau diesen Bucket vorgefilterten ISIN-Picker öffnet. Toolbar enthält nur noch „Manual entry" (für Off-Catalog-ISINs) + „Reset". Smart-Default: eine Section ist von Haus aus auf, wenn mindestens ein Bucket darin eine Position trägt; die explizite User-Toggle (Klick auf den Chevron) gewinnt für den Rest der Tab-Session.
- **UI (`ExplainPortfolio.tsx`):** Neuer State `expandedGroups: Record<assetClass, boolean>` + `toggleGroup(ac, smartDefault)` (kein `useEffect` — Toggles greifen sofort). `addPosition()` und der `Layers`-Toolbar-Knopf entfernt. Render-Pipeline ersetzt: `bucketsByAssetClass` (Map asset-class → BucketMeta[], aus `ALL_BUCKET_KEYS`/`getBucketMeta`) treibt die Tree-Struktur. `positionsByBucket` partitioniert non-manual rows nach `bucketKey` (nur wenn der Key in `validBucketKeys = new Set(ALL_BUCKET_KEYS)` ist — alles andere wandert in „Unassigned"). Helpers: `bucketWeight`, `assetClassSummary` (`{weight, etfCount, hasAnyRow}`), `rowsWeightSum`, `bucketHeader`, `assetClassLabel`, `assetClassSlug`, `etfCountLabel` (i18n-Plural). Render: Tree mit `data-testid="explain-bucket-tree"`, pro Section ein `<button data-testid="explain-group-${slug}" data-state="open|closed" aria-expanded>`, pro Bucket ein `[+]` mit `data-testid="explain-add-in-bucket-${bucketKey}"` (öffnet IsinPicker mit `bucketKey` pre-set), darunter pro Position eine kompakte Row (Picker · Weight-Input · Trash · Look-Through-Hinweis). Tail-Pseudo-Groups: „Manual entries" (alle `manualMeta`-Zeilen) und „Unassigned" (alle non-manual mit fehlendem ODER stale `bucketKey`).
- **Smart-Default-Regel:** `assetClassSummary(buckets).hasAnyRow` (nicht `etfCount > 0`) — damit eine frisch hinzugefügte Zeile, deren ISIN noch nicht gewählt wurde, die umgebende Section sofort aufklappt. `expandedGroups[ac] ?? smartDefault` resolved den effektiven State.
- **i18n (`src/lib/i18n.tsx`, EN+DE):** `addEtf`/`addByBucket`/`byBucket.*`-Keys entfernt. Neu: `explain.tree.manual`, `explain.tree.etfCount.{zero,one,other}` (Plural-Surface mit `{n}`-Substitution), `explain.assetClass.{Equity|Fixed Income|Real Estate|Commodities|Digital Assets|Cash}`. `explain.positions.desc` und `explain.empty.positions` neu formuliert (verweisen auf die Tree + per-Bucket-`[+]`-Mechanik). `addManual` + `addInThisBucket` bleiben.
- **Tests (e2e, `tests/e2e/explain-portfolio.spec.ts` + `…file-roundtrip.spec.ts`):** Helper `addCatalogRow(page, rowIndex, isin, bucketKey, groupSlug)` neu — expand-section idempotent über `ensureGroupExpanded` (liest `data-state` am Toggle-Button und tappt nur wenn `closed`), tappt `explain-add-in-bucket-${bucketKey}`, tappt den Picker-Trigger der gerade hinzugefügten Zeile, **force-clickt** die `isin-option-${isin}`-Zeile (umgeht das `<div cmdk-group-heading aria-hidden>` der `cmdk`-Gruppe, das auf iphone-13 nach dem ersten Scroll innerhalb des Popovers das Hit-Rect der Option überlagert) und wartet ≤1 s auf Radix-Scroll-Lock-Release (`data-scroll-locked` + `pointer-events`-Poll) bevor zurückgekehrt wird. Manual-ISIN-Test pickt die Asset-Class ebenfalls via `click({ force: true })`. Per-Test-Timeout in `playwright.config.ts` von 30 s auf 60 s angehoben — der „add three ETFs"-Test macht jetzt drei Chevron-Expands + drei `[+]`-Klicks zusätzlich zur vorherigen Arbeit (Monte Carlo + Reload + Persistence-Roundtrip).
- **Verifikation:** Typecheck PASS; **591 / 591 Unit-Tests grün** (keine Engine-/Synthesizer-/Validator-Änderung); explain-Portfolio-e2e-Suite grün (4 Tests in `explain-portfolio.spec.ts` + 1 Test in `…file-roundtrip.spec.ts`). Code-Review (architect, evaluate_task, includeGitDiff): zwei Findings adressiert — (a) Stale-`bucketKey`-Rows landen in „Unassigned" statt unsichtbar zu verschwinden (`positionsByBucket` filtert über `validBucketKeys`, `unassignedRowIndices` nimmt sowohl leere als auch stale Keys mit auf); (b) Smart-Default rechnet jetzt über `hasAnyRow` statt `etfCount > 0`, damit eine frisch hinzugefügte Zeile ohne ISIN/Weight die Section trotzdem öffnet. Keine Engine-/Persistenz-Änderung — Existing `localStorage["investment-lab.explainPortfolio.v1"]`-State und Save-to-File-Format bleiben bit-kompatibel.

### 2026-04-30 (explain-bring-your-own-etfs) — Explain My Portfolio upgraded to a bring-your-own-ETFs workspace (Task #135)
- **Operator-Wunsch:** das bisherige sketch-style Explain-Tab (frei eingegebene `assetClass / region / weight`-Zeilen, gefolgt von einer reinen Coherence-Verdict-Karte) wird zu einem echten Workspace ausgebaut, in dem der Anwender seine **konkret gehaltenen** UCITS-ETFs aus dem kuratierten `INSTRUMENTS`-Katalog per ISIN/Name auswählt, pro ETF die tatsächliche Gewichtung setzt, und dieselbe mittlere Analyse bekommt, die Build liefert (Validation, PortfolioMetrics, Monte Carlo, Look-Through, CurrencyOverview, FeeEstimator). Tab-`value` bleibt `"explain"` — Test-Selektoren bleiben stabil.
- **Katalog-Accessoren (`src/lib/etfs.ts`):** Neue Surface direkt nach `getCatalog()` hinzugefügt: `BucketMeta { key, assetClass, region, hedged, synthetic }`, `ALL_BUCKET_KEYS`, `getInstrumentByIsin(isin)`, `getBucketKeyForIsin(isin)` (basiert auf der einmal beim Modul-Load aus `BUCKETS` aufgebauten inversen `ISIN_TO_BUCKET`-Map — durch `validateCatalog()` als one-to-one garantiert), `getBucketMeta(bucketKey)`, `listInstruments()` (joined `INSTRUMENTS` mit `bucketKey`), `pickDefaultListing(inst)` (default exchange + ticker fallback). Reine Accessoren — keine Engine-/Analysis-Änderung.
- **Personal-Portfolio-Synthesizer (`src/lib/personalPortfolio.ts`, neu):** `synthesizePersonalPortfolio(positions, baseCurrency, lang?)` gruppiert Positionen pro `bucketKey` zu einer `AssetAllocation`-Zeile (eine pro Sleeve, Asset-Class-Sortierung wie Build) und emittiert pro ISIN eine `ETFImplementation`-Zeile mit voller Instrument-Metadaten (TER, Domizil, Replikation, Default-Listing, Comment) — so spielen Look-Through, TopHoldings und CurrencyOverview gegen die **echten** ISINs des Anwenders, nicht gegen die kuratierten Bucket-Defaults. `runExplainValidation(positions, riskAppetite, baseCurrency, lang)` produziert die geteilte `ValidationResult`-Form: E1 Summe ≠ 100% (±0.5), E2 per-row Bounds (0,100], E3 doppelte ISIN, E4 Equity-vs-Risk-Cap > +15 hart, E5 unbekannter Bucket, W1 Hedging-Inkohärenz (gleiches logisches Sleeve hedged + unhedged), W2 leichtes Cap-Überschreiten, W3 stale persisted bucketKey (ISIN inzwischen umgebuckt), W4 leeres Portfolio. Kein Aufruf von `runValidation()` — das validiert `PortfolioInput`, hier wird auf Positionsebene geprüft.
- **UI (`ExplainPortfolio.tsx`, rewrite):** Zwei-Spalten-Layout. Links: Settings-Card (Base Currency, Stated Risk Profile, Horizon, Hedged- + Look-Through-Toggle) + Positions-Card mit per-Bucket gruppierten Zeilen. Jede Zeile = `Popover`+`Command` ISIN-Picker (Suche über Name/ISIN/Currency, Gruppierung nach Sleeve, schon vergebene ISINs ausgegraut), `Input` mit `parseDecimalInput`-Commit-Semantik (gleicher Pattern wie Build/manualWeights), Trash-Button. Rechts: Verdict-Card (Coherent / Needs attention / Inconsistent + Errors/Warnings-Listen). Voll-breite Analyse-Karten unten, sobald `validation.isValid && positions > 0`: `CurrencyOverview` immer; `LookThroughAnalysis` + `TopHoldings` nur wenn Look-Through-Toggle an; `MonteCarloSimulation` + `PortfolioMetrics` (geteiltes `riskRegime`-State, gleiches Pattern wie Build); `FeeEstimator`. Bewusst NICHT übernommen (per Task-Scope): GeoExposureMap, StressTest, HomeBiasAnalysis, Scenarios, AI-Prompt, PDF-Export, Compare-Integration, Save/Load-Slots, Custom-CMAs.
- **Persistenz:** der gesamte Workspace-State (Settings + Positionen mit `{ isin, bucketKey, weight }`, Schema-Version `v: 1`) wird auf jede Änderung in `localStorage["investment-lab.explainPortfolio.v1"]` serialisiert. Beim Mount restored mit Bounds-Validierung pro Feld (Base Currency / Risk Appetite Whitelist, Horizon clamp 1–40, Position-Filter über Type-Guard). Weight-Drafts sind absichtlich transient — beim Reload werden die committeten numerischen Gewichte zurück in Drafts gespiegelt.
- **i18n (`src/lib/i18n.tsx`, EN+DE):** neuer `explain.*`-Block: `intro.title/desc`, `settings.title/desc`, `riskProfile.label`, `horizon.label`, `toggles.label`, `hedged.label`, `lookthrough.label`, `positions.title/desc/unassigned`, `empty.positions`, `btn.addEtf/reset/analyze`, `picker.placeholder/search/empty`, `verdict.coherent/attention/inconsistent`, `badge.valid`, `issues.critical/findings`, `sound`. Die Legacy-Schlüssel (`explain.current.*`, `explain.btn.template/importCsv/addRow`, `explain.table.*`, `explain.empty.title/desc`, `explain.toast.imported`, `explain.coherent.msg`, `explain.valid`, `explain.criticalIssues`, `explain.findings`) bleiben erhalten — `ImportCsvDialog` und CSV-Templates referenzieren sie noch und sollen nicht aufgeräumt werden, bevor das CSV-Import-Feature explizit aus dem Repo gezogen wird.
- **Tests (`tests/personalPortfolio.test.ts`, neu):** 21 Cases. **Synthesizer:** Bucket-Aggregation (zwei USA-ETFs in einer Allocation-Zeile, 3 ETF-Implementations), Asset-Class-Sortierung (FI vor Equity), Drop von 0%-Positions, voller Instrument-Metadata-Roundtrip, deutscher Rationale-Text. **Validator:** Sum-Error, Sum-OK ohne Warnings, Duplicate-ISIN-Error, Per-Row-Bounds-Error, Empty-Portfolio (Warning, kein Error, blockt aber Analyse), Equity-Cap-Soft-Warning (Low + 50% Equity → Warning), Equity-Cap-Hard-Error (Low + 100% → Error), Hedging-Inkohärenz-Warning (USA + USA-EUR), Stale-bucketKey-Warning, Unbekannter-Bucket-Error, deutsche Fehlertexte. **Inverse-Map:** jede Katalog-ISIN resolved zu genau einem Bucket; `listInstruments().bucketKey` stimmt mit `getBucketKeyForIsin()` überein; `getBucketMeta` decodiert hedged/synthetic-Suffixes korrekt; unbekannte ISIN/Bucket → `undefined`; `ALL_BUCKET_KEYS` non-empty + alle Keys decodieren. **Integration:** Validator-Sum stimmt mit Synthesizer-Total für ein sauberes Portfolio überein.
- **Verifikation:** Typecheck PASS; **567 / 567 Unit-Tests grün** (546 vorher + 21 neue); 7 / 7 bestehende e2e-Tests bleiben grün (das Tab `value="explain"` ist stabil und keine Build-/Compare-Surface wurde berührt). Keine numerischen Engine-Änderungen — Build-Outputs bit-identisch zu vor dem Task.
- **Post-Review-Nachzieharbeiten (Code-Review #135-Folge):** vier Blocker aus dem ersten Review behoben:
  1. **`normalizeWeights(positions)`** als exportierter Helper in `personalPortfolio.ts` — proportionale Skalierung auf exakt 100 %, Rounding-Residuum landet auf der größten Position. Neuer „Auf 100 % normalisieren / Normalize to 100%"-Button (`data-testid="explain-normalize"`) ersetzt den alten „Re-analyze"-Button und wird visuell hervorgehoben (default-variant), wenn die Summe um > 0.5 pp von 100 abweicht. 5 neue Unit-Tests (scale-up, scale-down, residual-absorption, zero-input no-op, manualMeta-preservation).
  2. **Live-Commit der Gewichte** — `setWeightDraft()` committet jetzt auf jedem Tastenanschlag den geparsten numerischen Weight in `state.positions[i].weight` (nicht mehr nur on blur / Re-analyze). Der „Sum: X%"-Indikator und die Validator-Errors aktualisieren sich tatsächlich live; der String-Draft bleibt als Eingabepuffer erhalten, damit ein Mid-Edit-Wert wie „0." nicht zu 0 kollabiert. Live-Total wird direkt aus `state.positions` summiert, nicht mehr aus dem synthetisierten `portfolio.totalWeight` (so zählen unfertige Zeilen ohne ISIN auch mit).
  3. **Manual-Entry-Fallback** für ETFs außerhalb des Katalogs — neuer `addManualPosition()`-Handler + „Manual / Manuell"-Button (`data-testid="explain-add-manual"`). Manuelle Zeilen tragen `manualMeta: { assetClass, region, name?, currency?, terBps? }`; rendern mit Klartext-ISIN-Input (`explain-manual-isin-{i}`) plus zwei Selects (`explain-manual-asset-{i}`, `explain-manual-region-{i}`) für die User-supplied Sleeve-Zuordnung. Der Synthesizer aggregiert manuelle Positionen über einen neuen `resolveSleeve(p)`-Helper genauso wie Katalog-Positionen (eine `AssetAllocation`-Zeile pro `assetClass+region`-Sleeve), emittiert eine minimale `ETFImplementation`-Zeile (kein Look-Through, weil keine Katalog-Holdings) und der Validator skippt für manuelle Zeilen die W1-Hedging-Kohärenz, W3-Stale-bucketKey und E5-Unbekannter-Bucket-Checks (sonst würde jede Off-Catalog-ISIN als „nicht mehr im Katalog registriert" geflaggt). Persisted-State-Restore (`loadState()`) bewahrt `manualMeta` mit Field-by-Field-Type-Guards. UI gruppiert manuelle Zeilen unter einer eigenen „Manually entered positions"-Überschrift. 3 neue Unit-Tests (Sleeve-Aggregation, Validator skippt Unknown-Bucket, Validator skippt Hedging-Kohärenz).
  4. **Playwright-e2e-Spec** `tests/e2e/explain-portfolio.spec.ts` (mobile, iphone-13-chromium): zwei Tests. (a) „add three ETFs, weights sum live, normalize, analysis renders, persists across reload" — clear localStorage, 3 Katalog-Picker (Equity-USA / Equity-Europe / FixedIncome-Global), European-Decimal-Tippen (`33,3`/`33,3`/`30`), Live-Sum tickt zu 96.6 % (Error sichtbar), `Normalize`-Tap snappt zu 100 % → `explain-analysis` rendert → `localStorage["investment-lab.explainPortfolio.v1"]` enthält die 3 ISINs → Hard-Reload restored State + Analyse. (b) „manual ISIN entry produces an analysis with user-supplied asset class" — Katalog-USA-Row + Manual-Row mit Off-Catalog-ISIN `LU0000000123` + Asset-Class-Switch zu Fixed Income → 60/40-Split → Analyse rendert ohne „no longer registered"-Warning. Playwright-Trick: nach Picker-Tap auf `expect(option).toBeHidden()` warten, damit der Popover-Overlay nicht das nächste Input verdeckt; `fill()` statt `tap()` für Weight-Inputs unterhalb der Mobile-Fold.
  - Außerdem: `vitest.config.ts` `testTimeout`/`hookTimeout` auf 15000 ms angehoben (war 5000) — fixt zwei vorher gelegentliche Flakes in `compareMcMetricsAgreement.test.tsx` + `biconBrand.test.tsx` unter Last (recharts ResponsiveContainer-Init im jsdom + sequentielle Slot-A/B-Renders sind regelmäßig knapp am 5 s-Default).
- **Verifikation post-review:** Typecheck PASS; **575 / 575 Unit-Tests grün** (567 vorher + 5 normalizeWeights + 3 manualMeta); **9 / 9 e2e-Tests grün** (7 vorher + 2 explain-portfolio); keine numerische Änderung in Build/Compare/Methodology-Engines.

### 2026-04-30 (engine-thematic-tilt-is-equity-not-satellite) — Thematic tilt is part of the equity sleeve, not a satellite
- **Operator-Wunsch:** „map the thematic tilt not to satellites but equity". Bisher war der kleine 3 – 5 % Themen-Slice (Technology / Healthcare / Sustainability / Cybersecurity) konzeptuell ein **Satellite-Sleeve** auf Augenhöhe mit REITs, Crypto und Gold — er erschien in der Satellite-Drop-Liste, im AI-Prompt unter `Satellites:`, im Group-Summary-Tile (Build/Compare) als Teil von „Satellites", und in der Methodik-Aufzählung der Satellite-Sleeves. Der Slice ist aber rechnerisch immer schon aus dem Equity-Budget abgezogen worden (`equityPct − thematicPct`) — er IST also eine Aktien-Tilt, nicht ein zusätzliches Risikoasset. Die Ausweisung wird jetzt überall an die Mathematik angepasst.
- **Engine (`src/lib/portfolio.ts`):** `thematicPct` ist nicht mehr Teil von `satellitesTotal`; numerisch identisch (wird weiterhin direkt vom Aktienbudget abgezogen), aber konzeptuell Equity-intern. Thematic ist außerdem aus der Satellite-Drop-Liste entfernt (die bei `numETFs ≤ 5` die kleinsten Satelliten verwirft) — Thematic überlebt jetzt eine enge ETF-Cap, anstatt als „nächstkleinster Satellit" nach Crypto gedroppt zu werden.
- **Group-Klassifikation (`src/lib/allocationGroups.ts`):** `classifyGroup()` mappt thematische Region-Labels (`Technology` / `Healthcare` / `Sustainability` / `Cybersecurity`) ab sofort auf `"Equities"` statt `"Satellites"`. Das ist die Quelle für das **AllocationGroupSummary-Tile** in den Build- und Compare-Panels — die „Satellites"-Kachel zeigt jetzt nur noch REITs + Crypto + Gold, und der Themen-Slice fließt sichtbar in die „Equities"-Kachel.
- **Chart-Sortierung (`src/lib/chartColors.ts`):** Thematic-`ORDER_RULES`-Rang von 70 (zwischen Gold und Crypto) auf 30 gesenkt, sodass die Themen-Slice innerhalb des Equity-Blocks nach Gewicht einsortiert wird (in der Praxis als kleinste Equity-Slice am Ende). Die dedizierte Themen-Farbregel (lila Schattierung) bleibt erhalten.
- **AI Prompt (`src/lib/aiPrompt.ts`, EN+DE):** Thematic ist aus der `Satellites:`-Aufzählung entfernt und stattdessen als zusätzliche Equity-Sub-Zeile beschrieben („Thematic equity tilt within the equity sleeve: <theme> — small theme-tilted slice carved out of equity (counts toward the equity allocation, not as a satellite)" / dt. „Thematischer Aktien-Tilt innerhalb des Aktien-Sleeves: ..."). Der Group-Classification-Hinweis im Output-Block wurde von „commodities, listed real estate, crypto, **and thematic equity** all belong to the Satellites group" auf „commodities, listed real estate, and crypto belong to the Satellites group; **thematic equity belongs to the Equities group**, as it is a tilt within the equity sleeve" geändert.
- **i18n (`src/lib/i18n.tsx`, EN+DE):** `build.thematicTilt.tooltip` neu formuliert („Carve a small theme-tilted slice out of the equity sleeve. Counts as part of equity, not a separate satellite."). `build.numEtfs.tooltip` listet bei „smallest satellites" jetzt nur noch REITs / Crypto / Gold und ergänzt einen Hinweis, dass die Themen-Tilt durch die Konsolidierung erhalten bleibt.
- **Validation (`src/lib/validation.ts`, EN+DE):** Komplexitäts-Warnung listet „Crypto, REITs, Gold" als Satelliten und nennt den thematischen Equity-Tilt explizit separat als reduzierbares Element.
- **Methodology (`Methodology.tsx`, EN+DE):** Satellite-Sleeve-Aufzählung verliert „Thematic 3 – 5 %"; stattdessen neuer Punkt „thematic tilt within the equity sleeve (3 – 5 %)".
- **Datenhygiene (Bonus, blockierte sonst Validation):** zwei verwaiste Pool-Einträge (`IE000U58J0M1`, `IE00BF20LF40`) aus `src/data/lookthrough.overrides.json` entfernt — sie waren als Look-Through-Pools registriert, aber ihre zugrundeliegenden ISINs fehlten in `INSTRUMENTS` (Altlast aus #131-Merge). Keine sonstige Code-Referenz, sicher zu entfernen; `validateCatalog()` läuft jetzt wieder grün.
- **Tests:** Neuer Engine-Test „thematic tilt is part of the equity sleeve, not a satellite" (`tests/engine.test.ts`) — `numETFs=5` mit REITs + Crypto + Theme=Technology, prüft (a) Thematic-Equity-Zeile überlebt die Cap, (b) Total-Equity bleibt gegenüber dem No-Theme-Lauf konstant (Equity-Budget-Konservierung), (c) End-to-End: `summarizeAllocationByGroup()` weist denselben Equities-/Satellites-Anteil aus wie ohne Theme. Zwei bestehende AI-Prompt-Tests aktualisiert: thematic erscheint im Equity-Block VOR `Satellites:`, ist nicht mehr im Satellites-Listing, und die neue „thematic equity belongs to the Equities group"-Zeile wird positiv geprüft. `tests/allocationGroups.test.ts` umgestellt: thematic-Equity-Sleeves klassifizieren als `"Equities"`; das Aggregations-Sample-Portfolio prüft jetzt Equities = 58 / Satellites = 7 (vorher 55 / 10).
- **Verifikation:** Typecheck PASS; **546 / 546 Unit-Tests grün** (vorher 545 / 546 wegen vor-existierendem catalog-validate-Issue, jetzt mitgefixt); 7 / 7 e2e Tests grün. Architect-Review APPROVED_WITH_COMMENTS — die Comments betreffen Legacy-Pool-PR-Helpers aus früheren Merged-Tasks und sind explizit non-blocking. **Keine Änderung der numerischen Gewichte** in irgendeinem Portfolio-Output.
- **Bekannte Einschränkung (out of scope, als Follow-up vermerkt):** der Endcounts-Cap-Pass in `buildPortfolio()` garantiert in pathologischen Kombinationen (`numETFs = 4` + Theme + REITs + Crypto) nicht streng `allocation.length ≤ numETFs` — Thematic, das nun durchläuft, kann diese vor-existierende Lücke verstärken.

### 2026-04-29 (build-currency-overview-honours-lookthrough-toggle) — Consolidated Currency Overview reagiert auf Look-Through-Toggle (per Seite)
- **Operator-Wunsch:** die „Consolidated Currency Overview (Post-Hedge)"-Karte soll dem Look-Through-Toggle gehorchen — wenn das Toggle aus ist, soll keine kuratierte Underlying-Currency-Aufteilung mehr stattfinden, sondern die ungesicherten ETFs sollen ihre volle Position der **Anteilsklassen-Währung** zugeordnet bekommen. Der Modus muss im Header klar erkennbar sein.
- **Engine (`src/lib/lookthrough.ts`):** `buildCurrencyOverview()` bekommt einen optionalen `useLookThroughCurrency`-Parameter (Default `true`, rückwärtskompatibel). `buildLookthrough()` reicht ein neues `options: { useLookThroughCurrency? }`-Bag durch. Der Loop wurde umgeordnet: gehedgte ETFs werden **immer zuerst** der Anteilsklassen-Währung zugeordnet (auch wenn kein kuratiertes Profil existiert) — damit ist `hedgedShareOfPortfolio` strikt invariant unter dem Toggle. Erst danach trennt sich die Logik: ON → ungesichert via `addInto(unhedgedMap, profile.currency, e.weight)` (kuratierter Underlying-Split, MSCI World → USD/EUR/JPY/GBP/CHF/...); OFF → ungesichert in `unhedgedMap[e.currency || baseCurrency]` (kein Split).
- **UI (`CurrencyOverview.tsx`):** neue optionale Prop `lookThroughView?: boolean` (Default `true`) wird an `buildLookthrough()` durchgereicht. Im Card-Header rendert ein kompakter Mode-Badge — emerald-getönt bei „Look-Through · zugrundeliegende Währungen", amber-getönt bei „Nur ETF-Währung · kein Look-Through" — mit `data-testid="fx-mode-badge"` und `data-mode`-Attribut. Der Disclaimer am Boden der Karte wird im OFF-Modus durch eine eigene Copy ersetzt, die explizit darauf hinweist, dass kein Underlying-Look-Through angewandt wurde.
- **Wiring:** `BuildPortfolio.tsx` reicht `form.getValues().lookThroughView` an die einzige CurrencyOverview-Instance durch. `ComparePortfolios.tsx` reicht `inputA.lookThroughView` bzw. `inputB.lookThroughView` an alle vier Render-Sites durch (Mobile A/B-Tabs + Desktop A/B-Grid), sodass die beiden Compare-Slots unabhängig die Aufteilung umschalten können — passt zur Per-Slot-Toggle-Architektur aus #88.
- **i18n:** sechs neue Keys (DE+EN): `build.fx.mode.lookthrough`, `build.fx.mode.etfOnly`, `build.fx.disclaimer.etfOnly`.
- **Tests:** drei neue Engine-Tests in `tests/engine.test.ts`: (a) Look-Through-On vs Off auf einem Default-CHF-Portfolio — Total-Weight bleibt erhalten, ETF-Only hat keine `unmappedWeight`, ON liefert mehr distinct currencies und die zwei Views unterscheiden sich messbar; (b) Hand-gebauter Mini-Portfolio-Fixture mit unbekannten ISINs zeigt, dass `hedgedShareOfPortfolio` strikt invariant bleibt und gehedgte Weight nie als „unmapped" verloren geht; (c) ETF-Only-Modus ordnet jede Reihe einer realen Anteilsklassen-Währung (oder Base) zu. Test-Suite jetzt **474/474 grün** (engine: 187), e2e weiterhin grün.
- **Bewusste Nicht-Änderungen:** keine Verlagerung der Karte unter den `lookThroughView`-Gate (sie bleibt dauerhaft sichtbar — der Modus wechselt, nicht die Existenz). Keine Änderung an `PortfolioReport`, `HomeBias`, `TopHoldings`, `GeoExposureMap`, `LookThroughAnalysis` — sie nutzen weiterhin `buildLookthrough()` ohne Options-Bag und behalten damit ihr bisheriges Look-Through-Verhalten.

### 2026-04-28 (build-etf-per-bucket-alternatives) — Per-Bucket-ETF-Picker mit kuratierten Alternativen
- **Operator-Wunsch:** „Jeder ETF der zur Auswahl gelangen soll, benötigt eine eindeutige Bucket-Zuordnung." Pro Bucket soll der Nutzer zwischen 1 Default und bis zu 2 kuratierten Alternativen wählen können — ohne in die Methodology-„Swap-ETF"-Pane wechseln zu müssen, die ein freier Override-Mechanismus ist.
- **Datenebene (`src/lib/etfs.ts`):** `ETFRecord` bekommt `alternatives?: ETFRecord[]` (max 2). `ETFDetails` bekommt drei neue Felder: `catalogKey: string | null`, `selectedSlot: 0|1|2`, `selectableOptions: {name,isin,terBps}[]`. Sechs Headline-Buckets erhalten Alternativen: Equity-Global (Vanguard VWRA, iShares SSAC), Equity-USA (Vanguard VUAA, SPDR SPY5), Equity-Europe (Vanguard VEUA), Equity-EM (Vanguard VFEA), FixedIncome-Global (Xtrackers XGGB), Commodities-Gold (iShares SGLN, WisdomTree PHAU). Hedged/Synthetic-Variant-Keys bleiben bewusst ohne Alternativen (sie sind konditionale Defaults, keine Picker-Targets).
- **Auflösungs-Layer in `getETFDetails()` — drei klar geordnete Stufen:**
  1. Methodology-Override (`getUserETFOverride`) — wenn aktiv, wird `selectableOptions` leer zurückgegeben (Picker bleibt unsichtbar; der Override IST die Antwort).
  2. Per-Bucket-Slot-Selection (`getETFSelection(catalogKey)`) → `resolveSelectedETF(curated, slot)` mit `clampSlot()` für Stale-localStorage-Werte.
  3. Curated default (`CATALOG[key]`).
- **Persistenz (`src/lib/etfSelection.ts` NEW):** `localStorage["il.etfSelection.v1"] = Record<catalogKey, 1|2>`. Slot 0 (Default) wird nie persistiert (Absenz = Default). Modul-API: `getETFSelection`, `setETFSelection`, `clearETFSelection`, `clearAllETFSelections`, `subscribeETFSelections` (CustomEvent `il-etf-selection-changed` für Cross-Component-Koordination, mirrors `etfOverrides.ts`-Pattern). Defensive Parse: ungültige Werte werden silent verworfen.
- **Integrity-Guard `validateCatalog()`:** prüft drei Invarianten — `alternatives.length ≤ 2`, ISINs innerhalb eines Buckets distinct, Alt-ISINs global eindeutig (kein Overlap mit anderen Buckets' Defaults oder Alternatives). Pre-existing Default↔Default-ISIN-Duplikate zwischen Hedged-Variant-Keys (z. B. Equity-USA-EUR ↔ Equity-USA-CHF) bleiben toleriert (legacy data, nicht Teil des Picker-Konzepts). CI-gated via `tests/catalog-validate.test.ts`.
- **UI (`BuildPortfolio.tsx`):** in der ETF-Implementation-Tabelle wird die ETF-Name-Zelle zu einem `<Select>` umgebaut, wenn `selectableOptions.length > 1`. Trigger ist sehr kompakt (h-7, dashed border, 280px max-width); SelectItem zeigt Name + Default/Alternative-Badge + ISIN + TER. Slot-Wahl ruft `setETFSelection(catalogKey, slot)`, was via `subscribeETFSelections` einen monoton steigenden Tick im Build-Effekt-Dep-Array inkrementiert → automatischer `buildPortfolio()`-Re-Run → alle Downstream-Surfaces (Fees, Monte Carlo, Look-Through, Top-10) reagieren ohne weiteren User-Click. Buckets ohne Alternativen rendern weiterhin Plain-Text (kein leerer Picker).
- **i18n:** vier neue Keys (DE+EN): `build.impl.picker.label`, `build.impl.picker.default`, `build.impl.picker.alt`, `build.impl.picker.terSuffix`.
- **Tests:** zwei neue Files — `catalog-validate.test.ts` (7 tests: validateCatalog returns [], headline 6 buckets vorhanden, alle Invarianten) und `etfSelection.test.ts` (10 tests: Storage-Roundtrip, Clear-Semantik, Corrupt-Value-Drop, End-to-End-Auflösung default/slot-1/slot-2/clamp/no-alternatives). Test-Suite jetzt **369/369 grün**, e2e weiterhin grün, typecheck clean.
- **Bewusste Nicht-Änderungen:** keine Alternativen für Hedged/Synthetic-Variant-Keys (würde die Picker-Semantik mit den konditionalen Resolution-Layern kollidieren lassen). Override gewinnt vollständig vor Alternative-Picker (kein gemischtes UI). Kein Reset-All-Button für Selections im UI (analog zur initialen Manual-Weights-Iteration: erst dann aufnehmen, wenn der Operator nach Cleanup-UX explizit fragt). Keine Persistenz von Slot 0 (Default-State = keine Storage-Entry, hält den Blob klein und macht „Default" und „nie geklickt" semantisch identisch).

### 2026-04-28 (build-pdf-report-page-break-top-inset) — Header-Atemluft auf Page-Break-Seite
- **Operator-Folgewunsch:** „some header space" — nach dem Page-Break klebte der Section-Titel „MONTE CARLO PROJECTION" hart am oberen Rand der zweiten PDF-Seite.
- **Ursache:** der Off-Screen-Container hat `padding-top: 12mm`, aber dieses Padding existiert nur einmal im rasterisierten Bild (am Beginn der ersten Seite). Beim Slicing an festen 297mm-Grenzen beginnt jede weitere Seite mitten im Content-Strom mit Null Top-Inset, sodass der Page-Break-Marker exakt auf der Page-Top-Linie landet.
- **Fix in `exportPdf.ts`:** neue Konstante `PDF_PAGE_BREAK_TOP_INSET_MM = 12`. Spacer-Höhe wird jetzt mit `padMm = (297 − overshoot) + 12` statt nur `(297 − overshoot)` berechnet, sodass der Marker im PDF auf `nextPageStart + 12mm` landet — derselbe visuelle Atemraum wie auf Seite 1. Die 12mm matchen das Container-Top-Padding für konsistente Vertikal-Rhythmik.
- **352/352 Tests grün, Typecheck clean.** Bewusste Nicht-Änderungen: keine Anpassung am Container-Padding (würde bei jedem Export greifen, nicht nur bei Page-Breaks); keine zusätzlichen Markup-Änderungen am Report; das Inset bleibt eine reine Exporter-Konzern-Konstante.

### 2026-04-28 (build-pdf-report-page-break-primitive) — `data-pdf-page-break="before"` Primitive + Page-Break vor Monte-Carlo-Sektion
- **Operator-Folgewunsch nach dem Detailed-Report-Release:** „page break before monte carlo" — die Monte-Carlo-Sektion soll nicht mitten zwischen Seite 1 und Seite 2 zerschnitten werden, sondern auf einer frischen A4-Seite starten.
- **Problem:** der bisherige PDF-Exporter rastert das gesamte Off-Screen-Element zu einem einzigen Canvas und schneidet danach an festen 297mm-Grenzen — CSS `page-break-before: always` wird komplett ignoriert, weil html2canvas keine Seitengrenzen kennt.
- **Lösung — generisches Page-Break-Primitive in `exportPdf.ts`:** vor dem html2canvas-Pass scannt der Exporter das Element nach Descendants mit `data-pdf-page-break="before"`. Für jeden Marker wird der aktuelle vertikale Offset relativ zum Container in mm umgerechnet (über `element.offsetWidth / 210`-Ratio, da der Off-Screen-Container exakt `210mm` breit ist) und dann ein transparenter Weiß-Spacer mit Höhe `(297 - markerTopMm % 297)mm` direkt vor dem Marker eingefügt. Nach dem Render-Pass werden alle Spacer im `finally`-Block wieder entfernt, damit der Off-Screen-Mount für den nächsten Export sauber bleibt. Re-measurement pro Marker (statt Cache), weil jeder neu eingefügte Spacer die Position nachfolgender Marker verschiebt. Skip-Threshold von 3mm verhindert Sliver-Whitespace, wenn der Marker schon nahe am Seitenanfang sitzt.
- **Anwendung:** in `PortfolioReport.tsx` bekommt die Monte-Carlo-`<section>` im DetailedSections-Block das Attribut `data-pdf-page-break="before"`. Die anderen Sektionen bleiben unmarkiert; sie fließen natürlich um den Page-Break herum (Top 10 endet auf Seite 1, Monte Carlo + Fees laufen auf Seite 2 weiter, eventuell teilweise auf Seite 3 wegen der Fee-Tabelle).
- **Bewusste Nicht-Änderungen:** keine CSS-Änderungen am Report (Markup-driven, nicht style-driven). Keine Page-Break-Marker im Basic-One-Pager (der soll natürlich einseitig bleiben). Das Primitive ist generisch — andere Sektionen können später mit demselben Attribut markiert werden, ohne den Exporter erneut anzupassen. Single-Page-Tolerance (`SINGLE_PAGE_TOLERANCE_MM = 2`) bleibt unverändert, beeinflusst nur die Single-vs-Multi-Page-Detection nach dem Spacer-Pass.
- **352/352 Tests grün, Typecheck clean, e2e bestätigt:** Klick auf „Ausführlicher PDF-Report" lädt eine valide Multi-Page-PDF (809 KB, vorher 1-Seiten-Detailed war ~560 KB, jetzt 2-3 Seiten mit Page-Break), Toast erscheint, keine Console-Errors, Basic-Button funktioniert weiterhin parallel.

### 2026-04-28 (build-pdf-report-detailed-variant) — Zweiter „ausführlicher" PDF-Report-Button + Look-Through-Status im Header
- **Operator-Folgewunsch nach dem One-Pager:** „look through only when enabled" (verifizieren) und „bauen Sie einen zweiten Knopf für einen ausführlicheren Report mit zusätzlich Top-10 Equity Holdings (immer Look-Through), Monte-Carlo-Chart + wichtigste Kennzahlen, und Fee-Estimator-Zusammenfassung".
- **Punkt 1 (Look-Through nur wenn aktiviert):** der bestehende `mapAllocationToAssetsLookthrough()`-Fix von früher heute ist korrekt (Look-Through wird im Report nur dann angewendet, wenn `input.lookThroughView === true`); zusätzlich neuer sichtbarer Status-Hinweis im Report-Subtitle: „Einseitiger Portfolio-Report · Look-Through-Sicht" oder „· Surface-Allokation". So sieht der Operator beim Öffnen jeder PDF auf einen Blick, welche View exportiert wurde.
- **Punkt 2 (zweiter Button):** `PortfolioReport` bekommt einen neuen `variant?: "basic" | "detailed"` Prop (Default `"basic"`, voll rückwärtskompatibel). `BuildPortfolio.tsx` rendert einen zweiten off-screen Mount (`pdfDetailedRef`, `position:fixed; left:-99999px; width:210mm`) mit `<PortfolioReport variant="detailed" />` und einen zweiten Button („Ausführlicher PDF-Report" / „Detailed PDF", primary-Variante neben dem outline-Variante-Basic-Button). `handleExportDetailedPDF` wiederverwendet `exportToPdf(pdfDetailedRef.current, filename)` — die Pagination-Logik handhabt automatisch den Mehr-Seiten-Output.
- **Drei neue Sektionen im Detailed-Report (zwischen ETF-Tabelle und Methodik-Footer):**
  - **Top 10 Equity Holdings (Look-Through):** Tabelle aus `buildLookthrough(etfs, lang, baseCurrency).topConcentrations.slice(0, 10)` mit Position/Quelle/% Portfolio/% Aktienteil. „immer Look-Through" ist automatisch erfüllt: `buildLookthrough()` IST der Look-Through-Engine, unabhängig vom on-screen-Toggle.
  - **Monte-Carlo-Projektion:** `runMonteCarlo(allocation, horizonYears, 100'000, { hedged, baseCurrency, syntheticUsEffective, riskRegime: "normal", tailModel: "gauss" })` mit illustrativem Anlagebetrag von **100'000 in Basiswährung** (matcht den on-screen Default des MC-Widgets). Vier MetricTiles (Erw. Rendite p.a., Erw. Vol p.a., Endwert P50 mit P10/P90 als Sub-Text, P(Verlust)/P(Verdoppelung)) plus Inline-SVG-Mini-Chart `MonteCarloMiniChart` mit drei Polylinien (P10/P90 in Slate-300, P50-Median in Slate-900), Y-Achse mit 5 Ticks (Compact-Notation), gestrichelter Referenz-Linie auf den initialen Anlagebetrag, X-Achsen-Labels für Y0/Mid/YN. Inline-SVG (kein Recharts) — off-screen-stabiler weil keine ResponsiveContainer-Messung benötigt wird.
  - **Fee-Estimator-Zusammenfassung:** `estimateFees(allocation, horizonYears, 100'000, { hedged: hedged && baseCurrency !== "USD" })` mit drei MetricTiles (Mittlere TER %, Jährliche Gebühr in Basiswährung, Projizierter Drag % vom Endwert) plus Bucket-Breakdown-Tabelle (Bucket/Gewicht/TER bps/Beitrag bps), sortiert nach Beitrag absteigend (kommt aus `estimateFees`).
- **i18n:** 6 neue Keys (DE+EN): `build.btn.exportPdfDetailed`, `build.pdf.successDetailed`, `report.subtitle.detailed`, `report.feature.surfaceView`. Die DetailedSections-Strings sind inline-bilingual (`de ? "..." : "..."`), parallel zur Konvention im Disclaimer-Block.
- **Bewusste Nicht-Änderungen:** Investitionsbetrag ist NICHT konfigurierbar (Snapshot-Determinismus, illustrativer Vergleichswert in Basiswährung mit Hinweis im Sektions-Titel). Der Basic-Report ist unverändert (Default-Verhalten bleibt One-Pager). Kein Risk-Regime-Toggle (wie beim Basic: bewusst auf `"normal"` festgenagelt). MC-Pfade fest auf 2'000 (Default von `runMonteCarlo`). Kein Stress-Test im Detailed-Report (das passt nicht in den Snapshot-Charakter — Stress ist eine explorative on-screen-Ansicht).
- **352/352 Tests grün, Typecheck clean. e2e bestätigt:** Klick auf „Ausführlicher PDF-Report" zeigt Loading-State, lädt eine Multi-Page-PDF, Toast „Ausführlicher PDF-Report erfolgreich exportiert" erscheint, Basic-Button bleibt parallel verfügbar und disabled-while-other-running, keine Console-Errors.

### 2026-04-28 (build-pdf-report-weight-and-lookthrough-fix) — Zwei Bugs im neuen PDF-Report
- **Operator-Befund unmittelbar nach Release:** „gewichte sind 100 mal zu hoch und ohne look through" — beides bestätigt.
- **Bug 1 (Skalierung):** der Report nutzte `fmtPct(x) = (x*100).toFixed(1)+"%"` für ALLE Prozent-Felder, inklusive der Allokations- und ETF-Gewichte. `AssetAllocation.weight` und `ETFImplementation.weight` werden vom Engine aber bereits auf der Prozent-Skala [0..100] geliefert (siehe `BuildPortfolio.tsx` Zeilen 963/1076: `alloc.weight.toFixed(1)%`, `etf.weight.toFixed(2)%`). Resultat: 36.6% wurde als „3660.0%" gerendert. `computeMetrics`-Outputs (expReturn, vol, alpha, maxDrawdown, rf) sind dagegen Fraktionen [0..1], dort war `*100` korrekt.
- **Fix Bug 1:** zwei klar benannte Helper statt einem mehrdeutigen — `fmtPctFromFraction(x)` (für Engine-Metriken, mit `*100`) und `fmtPctFromPercent(x)` (für Engine-Allokationen, ohne `*100`). Aufruf-Sites entsprechend gesplittet. Mini-Filter `weight > 0.0005` (passend zur Fraktionsskala) auf `weight > 0.05` (passend zur Prozentskala) angehoben, damit die noise-floor-Schwelle weiterhin „weniger als 0.05 Prozentpunkte" bedeutet, nicht „weniger als 0.05 Prozentpunkte VON 0.05 Prozentpunkten".
- **Bug 2 (Look-Through):** der Report rendere immer `output.allocation` (die Surface-Routing-Form „Equity - North America" / „Fixed Income - World"), unabhängig vom `lookThroughView`-Toggle. Auf dem Bildschirm zerlegt der Donut die Equity-Region-Zeilen via `mapAllocationToAssetsLookthrough()` in die tatsächlichen Länder-Buckets (US Equity, Swiss Equity, Europe Equity, UK Equity, Japan Equity, EM Equity), wenn der Toggle an ist. Der PDF-Report ignorierte das.
- **Fix Bug 2:** `PortfolioReport.allocationRows`-Memo rebuildet — wenn `input.lookThroughView` AND eine ETF-Implementation existieren, wird `mapAllocationToAssetsLookthrough(allocation, etfImpl, baseCurrency)` aufgerufen und das Ergebnis pro `AssetKey` auf `{ label: CMA[key].label, weight: e.weight*100, color: colorForBucket(label) }` gemappt (Look-Through liefert Fraktionen, daher hier `*100` korrekt). Sonst: bisherige Surface-Allokation. `compareBuckets`-Sortierung in beiden Pfaden identisch. Header-Chip „Look-Through-Sicht" bleibt unverändert sichtbar — der Toggle wird also dokumentiert UND wirkt.
- **Bewusste Nicht-Änderungen:** ETF-Implementation-Tabelle bleibt unverändert (das ist immer die Liste der konkret gehaltenen ETFs, look-through-orthogonal). On-Screen-Block bleibt unverändert.
- **352/352 Tests grün, Typecheck clean. e2e bestätigt visuell:** mit Look-Through ON zeigen die Allokations-Bars „Cash 2.0%, Global Bonds 33.0%, US Equity 36.6%, EM Equity 8.2%, Swiss Equity 7.1%, Europe Equity 4.0%, Japan Equity 2.9%, UK Equity 1.2%, Gold 5.0%" (Summe = 100%). ETF-Gewichte: 33.0% / 36.6% / 8.3% / 6.2% / 6.1% / 2.8% / 5.0% (Summe ≈ 98%, Rest ist Cash, das nicht in der ETF-Tabelle erscheint).

### 2026-04-28 (build-pdf-report-curated-onepager) — Kuratierter One-Page-PDF-Report statt Bildschirm-Bitmap
- **Operator-UX-Audit Top-Item #1 umgesetzt:** der bisherige PDF-Export war ein `html2canvas`-Snapshot des kompletten Results-Stacks (Validation-Alerts, Donut, Geo-Map, Allokations-Tabellen, Look-Through, Monte Carlo, Metric-Grid, Stress-Test, Rationale, Risiken, Home-Bias, Learning, Fee-Estimator) — gestreckt über mehrere A4-Seiten als 10.7 MB PNG-Bitmap. Sieht aus wie ein Website-Screenshot, nicht wie der Berater-One-Pager, den ein Privatinvestor seinem Bankberater mitnehmen würde.
- **Neue Komponente `src/components/investment/PortfolioReport.tsx`** rendert einen kuratierten A4-Portrait-Layout (Breite hartkodiert auf `210mm`, padding `12mm 14mm`, Schriftgrößen 7.5–13px). Sechs Sektionen: (1) Header mit Titel + Erstellungs-Zeitstempel + Basiswährung; (2) Profil-Chip-Strip (Risiko, Horizont, Aktien-Ziel, ETF-Anzahl, aktive Features wie Hedging/Synthetic/Look-Through/Thematic); (3) fünf Metric-Tiles für ExpReturn / Vol / Sharpe / MaxDD / Alpha mit `sharpeBand()`-Klartext-Einordnung („solide" / „solid" etc.); (4) horizontale Inline-SVG-Bars für die Ziel-Allokation, sortiert via `compareBuckets()` (Cash → Bonds → Equity → Satellites), Farben via `colorForBucket()`; (5) ETF-Implementation-Tabelle mit ISIN/Ticker/TER/Gewicht und Sub-Zeile für Bucket+Exchange+Currency+Distribution; (6) Methodik-Einzeiler + voller 7-Sektionen-Rechts-Disclaimer (parity zur alten `DisclaimerPdfBlock`, restyled in der Report-Typografie).
- **Metriken aus derselben Engine wie der Bildschirm:** `computeMetrics(allocation, baseCurrency, lookThroughView ? etfImplementation : undefined, isSyntheticUsEffective(...), "normal")` plus `getRiskFreeRate(baseCurrency)` für den Sharpe-Subtext. Risk-Regime ist im Report bewusst auf `"normal"` festgenagelt (das Crisis-Regime ist eine explorative On-Screen-Ansicht, kein dokumentierbarer Snapshot-Wert).
- **Off-Screen-Mount-Pattern:** der `pdfRef` wandert vom Bildschirm-Results-Block in einen `position:fixed; left:-99999px; top:0; width:210mm; aria-hidden="true"; pointerEvents:none`-Container am Ende von `BuildPortfolio.tsx`, der nur den `<PortfolioReport>` enthält. `html2canvas` capturet diesen Container; der Operator sieht ihn nie. Der Bildschirm-Results-Block (alle Cards, Charts, Stress-Test etc.) bleibt visuell unverändert.
- **`exportPdf.ts` zwei Tweaks:** (a) PNG → JPEG q=0.92 — für eine print-style Report-Darstellung visuell unsichtbar, schrumpft das Resultat von 10.7 MB auf ~560 KB (≈19× kleiner, mailbar). (b) Pagination-Logik begradigt: `SINGLE_PAGE_TOLERANCE_MM = 2` wird NUR für die Single-Page-Detection genutzt, NICHT global von `heightLeft` abgezogen — multipage-Exports werden jetzt an echten A4-Grenzen geschnitten statt 2mm pro Seite zu beschneiden. Die `.pdf-only`-Reveal-Mechanik bleibt für Legacy-Aufrufer erhalten.
- **Button-Label übersetzt:** war hartkodiert „Export PDF" / „Generating PDF…", jetzt `t("build.btn.exportPdf")` = „PDF-Report" / „PDF report" und `t("build.btn.exportingPdf")` = „PDF wird erstellt…" / „Generating PDF…". 21 neue i18n-Keys (DE+EN) für Report-Header, Chips, Sektions-Titel, Tabellen-Header, Methodik-Body und Disclaimer-Body.
- **Bewusste Nicht-Änderungen:** keine Änderung am On-Screen-Results-Block (das bleibt der explorative Detail-View), kein PDF-Export auf Compare/Explain-Tabs (kommt als #1b/#1c später, falls vom Operator gewünscht), keine Recharts-Komponenten im Report (Inline-SVG-Bars sind off-screen-stabiler und färbungs-konsistent zum Donut), kein Risk-Regime-Toggle im Report (Snapshot soll deterministisch sein), Code-Review-Findings angegangen: HIGH (Disclaimer-Regression) gefixt durch Inline der vollen 7 Sektionen, MEDIUM (Pagination-Tolerance) gefixt durch Single-Page-only Anwendung.
- **352/352 Tests grün, Typecheck clean. e2e bestätigt zweimal:** Klick auf „PDF-Report" / „PDF report" lädt eine valide PDF-Datei (`%PDF`-Header) mit Filename-Pattern `investment-decision-lab_<CCY>_<Risk>_<ISO>.pdf`, 563 KB inkl. vollem Disclaimer (vorher 10.7 MB), Toast „PDF erfolgreich exportiert" erscheint, Button-Label switcht korrekt zwischen DE und EN, off-screen-Render zeigt alle sechs Sektionen mit echten Werten ohne Console-Errors.

### 2026-04-28 (admin-recent-runs-github-freshness-banner) — „Live-Bundle vs. GitHub"-Vergleichszeile
- **Operator-Folgefrage nach dem Timestamp-Polish:** „Aber morgen früh zeigt die Live-App ja noch den alten Stand, weil das Bundle statisch ist?" — exakt richtig erkannt. Replit-Autoscale-Deploys triggern nicht automatisch auf Cron-Pushes nach GitHub. Statt einen Auto-Deploy-Hook zu bauen, gibt die Admin-Konsole jetzt sichtbar Auskunft über die Lücke.
- **Neue Banner-Zeile in `RecentRunsCard`** (oberhalb der Tabelle, `data-testid="run-log-freshness-banner"`) mit zwei Vergleichszeilen + Status-Pill:
  - **Live-Bundle:** der frischeste Run im ausgelieferten `refresh-runs.log.md` (entspricht `runs[0]["Started (UTC)"]`), formatiert via dem bestehenden `formatRunTimestamp()` als „28.04.2026, 07:37 · vor 1 Std.". `title=`-Tooltip zeigt das Original-ISO.
  - **GitHub:** Commit-Datum des letzten Commits, der `refresh-runs.log.md` geändert hat — geholt direkt vom Browser via `https://api.github.com/repos/volkmarritter/Investment-Decision-Lab/commits?path=...&per_page=1` (anonymes Read, 60/h/IP — für Single-Operator-Konsole reichlich; bewusst KEIN Server-Proxy gebaut, weil das nur Rate-Limit + Secret-Handling ohne Mehrwert addiert hätte). Drei Zustände: `lädt …` während des Fetch, klickbarer Commit-Link bei Erfolg, dezentes „nicht erreichbar" mit Error-Tooltip bei Rate-Limit/Network-Fehler.
  - **Status-Pill:** vergleicht GitHub-Commit-Datum mit Bundle-Newest. Differenz > `REPUBLISH_LAG_THRESHOLD_MS` (10 min — komfortabel über dem Cron-Commit-Lag von ~Sekunden, weit unter jeder Cron-Kadenz) → amber „Republish fällig" (`data-testid="run-log-republish-pill"`) plus amber Banner-Background. Sonst grün „aktuell". 10-Minuten-Schwelle bewusst, damit der natürliche „Cron startet → Cron finished+commit" Versatz von ~5–60 Sekunden nicht ständig zu False-Positives führt.
- **Neuer `useGithubLastCommit(filePath)`-Hook** vor `RunCell`. `AbortController` für Component-Unmount, defensives Parsing (committer.date → author.date Fallback), TypeScript-Interface `GithubCommitState` mit Discriminated Union via `status`. Eine Anfrage pro Page-Mount, kein Polling — der Operator lädt die Admin-Konsole sowieso bewusst.
- **Erklär-Caption unter den beiden Datums-Zeilen:** „Cron-Commits seit dem letzten Republish sind erst nach erneutem Deploy in der Live-App sichtbar." — beantwortet die Frage direkt im UI, statt sie der Operator-Memory zu überlassen.
- **Bewusste Nicht-Änderungen:** kein Auto-Deploy-Hook (das ist eine Replit-Settings-Frage, kein Code-Problem); kein Server-Endpoint (Browser-Fetch ist hier ehrlicher und einfacher); kein Test-Touch (visuelle Add-on-UI ohne neue Geschäftslogik); Repo-Name als Konstante hartkodiert (`GITHUB_REPO = "volkmarritter/Investment-Decision-Lab"`) — single-tenant Tool, keine Konfigurations-Notwendigkeit.
- **352/352 Tests grün, Typecheck clean. e2e bestätigt:** Banner erscheint, Live-Bundle „28/04/2026, 05:37 · 1 hour ago", GitHub „28/04/2026, 05:38 · 1 hour ago" (1 Min Versatz = innerhalb Schwelle), grüne „up to date"-Pill, GitHub-Datum ist klickbarer Link auf den Commit (`github.com/volkmarritter/Investment-Decision-Lab/commit/<sha>`).

### 2026-04-28 (admin-recent-runs-readable-timestamps) — „Recent runs"-Tabelle: ISO → leserlich
- **Operator-Beschwerde:** in der Admin-Konsole zeigte die Karte „Letzte Läufe / Recent runs" rohe ISO-Strings wie `2026-04-27T05:31:06.809Z` in der ersten Spalte. Korrekt (UTC ist die ehrlichste Speicherform für ein cron-getriebenes Log), aber für Augenüberflug ungeeignet. Jetzt zweizeilige Zelle, lokal-zentriert.
- **Neue Helpers in `Admin.tsx` direkt vor `RecentRunsCard`:** `ISO_TIMESTAMP_RX` (strikter Regex `^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$` — matched nur echte ISO-Z-Strings, lässt andere Werte unberührt), `TIMESTAMP_COL_NAMES` Set + Substring-Check auf `started`/`finished` (deckt aktuelle UND mögliche zukünftige Spaltennamen wie „Finished (UTC)" ab), `formatRelative(diffMs, lang)` mit DE/EN-Branches und Pluralformen (gerade eben/Min./Std./Tag/Tagen bzw. just now/min/mins/hour/hours/day/days), und `formatRunTimestamp(iso, lang)` das `{ local, relative, utc }` zurückgibt — `local` via `toLocaleString("de-CH" | "en-GB", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false })`, `utc` via `getUTCHours/Minutes`-padded (kein Re-Parse, kein Locale-Zufall — der Operator soll im UTC-Tail das Original wiedererkennen).
- **Neue `RunCell`-Subkomponente** rendert für Timestamp-Spalten zwei Zeilen: oben `font-medium tabular-nums` mit „28.04.2026 07:37"-Stil (lokale Zeit), unten `text-[10px] text-muted-foreground` mit „vor X Std. · 05:37 UTC". Volles Original-ISO im `title=`-Tooltip, damit der Operator beim Korrelieren mit `refresh-runs.log.md` oder einer CI-Run-URL die exakte Sub-Sekunden-Genauigkeit per Hover bekommt. Nicht-Timestamp-Zellen verbleiben als plain `<span>` — keine Verhaltensänderung für „Script", „Mode", „ISINs", „OK", „Fail".
- **Spaltenüberschrift mitgewandelt:** „Started (UTC)" → „Gestartet (lokal)" / „Started (local)", da der primär dargestellte Wert jetzt Lokalzeit ist (UTC bleibt im Sub-Label sichtbar). Inline `headerFor()`-Mapping in `RecentRunsCard`, kein neuer i18n-Key nötig (Pattern matched bereits etablierten Inline-`t({de,en})`-Stil im File).
- **Bewusste Nicht-Änderungen:** `runs[0]` Spalten-Slice bleibt bei `.slice(0, 6)` (Operator hat nichts an Spaltenmenge moniert, nur an Lesbarkeit); `refresh-runs.log.md` und alle Scraper-Scripts bleiben unverändert (UTC ist die korrekte persistente Form, Lokalisierung ist reine Präsentationsschicht); kein Test-Touch (visuelle Polish ohne neue Logik in der Engine oder im Datenpfad).
- **352/352 Tests grün, Typecheck clean. e2e bestätigt:** Row 1 zeigt „28/04/2026, 05:37" + „1 hour ago · 05:37 UTC", Row 2 zeigt „27/04/2026, 05:31" + „25 hours ago · 05:31 UTC", `title`-Hover liefert das volle Original-ISO. (Test-Browser nutzt `en-GB`-Format mit Slashes; in der DE-App-Sprache mit `de-CH` rendert der Browser des Operators dieselben Felder mit Dot-Separator.)

### 2026-04-28 (etf-details-dialog-ux-polish) — Sichtbarer Scroll + Datums-Anzeige nach oben
- **Native Scrollbar im Detail-Modal.** Operator-Feedback: Radix-`ScrollArea` versteckt die Scrollleiste bis zum Hover, deshalb war für viele Nutzer nicht erkennbar, dass das Modal weiter unten noch Top-Holdings + den justETF-Button enthält. `ScrollArea` durch nativen `overflow-y-auto`-Container (`min-h-0 flex-1`) ersetzt — die Browser-Scrollleiste ist jetzt immer sichtbar, sobald der Inhalt überläuft. Header und Footer haben jetzt zudem sichtbare Border-Lines (`border-t border-b` am Body), so sieht man auf einen Blick, wo der scrollbare Bereich anfängt und endet. `data-testid="etf-details-scroll"` für e2e.
- **Datum der angezeigten Daten direkt im Header.** Vorher war der „Stand"-Footer ganz unten in 10px-Text und nur sichtbar wenn man bis zum Ende scrollte — jetzt sitzt er prominent im Header (mit Kalender-Icon, `text-[11px]`, `data-testid="etf-details-asof"`) direkt unter ETF-Name und ISIN. Format: „Aufteilung Stand `<Datum>` · Holdings Stand `<Datum>`", mit kuratiertem Stichtag-Fallback (`Q4 2024`) und kursivem „(kuratierter Stichtag)" wenn die ISIN noch nicht durch den `refresh-lookthrough.mjs`-Job gelaufen ist. ISO-Timestamps aus dem Refresh-Job werden in `formatStamp()` auf `YYYY-MM-DD` gekürzt — der Time-of-Day-Anteil ist UI-Lärm. Ehemaliger Footer-Block am Ende des Body entfernt (war redundant). Neue i18n-Keys `etf.details.asof.{label,holdings,curated}`; alte `etf.details.freshness.*`-Keys entfernt. 352/352 Tests grün, Typecheck clean, e2e bestätigt: erste ISIN ohne Refresh-Stamp zeigt „Breakdown as of Q4 2024 (curated reference)", S&P-500-ISIN zeigt „Breakdown as of 2026-04-24 · holdings as of 2026-04-24"; Scrollleiste sichtbar; Top-Holdings + justETF-Button bleiben erreichbar.

### 2026-04-28 (etf-details-dialog) — ETF-Listen-Klick auf ISIN → Detail-Modal mit Look-through & justETF-Link
- **ISIN in der ETF-Implementation-Tabelle ist jetzt klickbar.** Operator-Anfrage: in der ETF-Liste pro ETF die Details inkl. Look-through-Körbe per Klick auf die ISIN anzeigen, plus jeweils einen Link zu justETF. Umsetzung: ISIN-Zelle in `BuildPortfolio.tsx` ist nun ein echter `<button>` (statt nur Text) mit Hover-Effekt, Focus-Ring, kleinem Lupen-Icon, `aria-label` inkl. ISIN für Screen-Reader und `data-testid="etf-isin-button-{bucket}"`.
- **Neues Detail-Modal `ETFDetailsDialog.tsx`** zeigt zur angeklickten ISIN: (1) Header mit ETF-Name, ISIN (mono), Ticker(Börse), Asset-Class-Badge; (2) Quick-Facts-Grid (TER, Domizil, Replikation, Aussch/Thes, Währung, Gewicht im Portfolio); (3) Kommentar/Rationale aus dem Catalog; (4) Look-through-Körbe aus `profileFor(isin)` in `src/lib/lookthrough.ts` — Geo (Top 12), Sektor (Top 12), Währung (Top 8), Top-10-Holdings — alle als sortierte Liste mit kleinen Bar-Indikatoren; (5) Freshness-Stamps via `breakdownsStampFor` / `topHoldingsStampFor` mit Fallback auf `LOOKTHROUGH_REFERENCE_DATE`; (6) Footer-Button „Auf justETF öffnen" → `https://www.justetf.com/{de|en}/etf-profile.html?isin={ISIN}` mit `target="_blank"`, `rel="noopener noreferrer"`, ISIN URL-encoded; Locale-Auswahl folgt der App-Sprache. Empty-State wenn kein Profil hinterlegt ist (kein Mapping in `PROFILES`). `data-testid="etf-details-dialog"` und `data-testid="etf-details-justetf-link"` für e2e. Voll i18n DE/EN (neue Keys unter `etf.details.*` und `build.impl.isin.openDetails`). Keine Engine-Logik, keine Look-through-Daten, keine Metrics berührt — reines UI-Add-on. 352/352 Tests grün, Typecheck clean, Architect PASS, e2e bestätigt: Klick auf ISIN öffnet Modal mit allen Sektionen, justETF-Link enthält die ISIN, Wechsel zwischen ETFs aktualisiert den Inhalt.

### 2026-04-28 (wht-derivation-block) — Methodology-Erklär-Erweiterung
- **Neuer „Wie der Drag berechnet wird"-Block in der WHT-Section.** Wiederkehrende Operator-Frage: WHT trifft ja nur Dividenden — wie kommen die bp-Werte konkret zustande? Antwort als strukturierter Sub-Block direkt nach dem Intro-Absatz der bestehenden `wht`-Section: explizite Formel `drag = WHT-rate (after treaty) × dividend yield` (über die wiederverwendete `Formula`-Komponente) plus Herleitungstabelle mit 8 Zeilen (US, EM, EU/UK/JP/Thematic, CH non-CHF, CH CHF resident, US synthetic, Bonds/Cash, Gold/REITs/Crypto). Tabelle zeigt für jede Anlageklasse die angenommene Div-Yield, den Residual-WHT-Satz nach Treaty und das resultierende Drag in bps — Operator kann jede Zeile selbst nachrechnen. CHF-Resident-Override und Synthetic-Carve-Out optisch hervorgehoben (`bg-muted/40` bzw. `bg-emerald-50`). Dazu zwei Footer-Notes: (a) „Static-by-design" — Drag-Werte sind Konstanten in `WHT_DRAG`, nicht live aus tagesaktuellen Yields, mit Begründung (Quartals-Drift < LTCMA-Provider-Streuung); (b) „Bewusste Vereinfachungen" — REITs (~50 bps in der Realität, im Modell 0) und HY-Corporate-Bonds. **EU-Zeile-Korrektur nach Architect-Hinweis:** ursprünglich „15%" angezeigt (matched `metrics.ts`-Source-Comment, multipliziert sich aber zu 30 bps statt 20) — auf „~10% (blended treaty)" geändert, sodass die angezeigte Arithmetik aufgeht. Voll i18n DE/EN, `data-testid="wht-derivation-block"`. Keine Engine-Änderung, kein Test-Touch, 352/352 grün, Architect PASS.

### 2026-04-28 (mc-thousands-separator-and-chf-sharpe-explainer) — UX-Politur
- **MC Investment-Amount mit Tausender-Trenner.** Der Betrags-Input in der Monte-Carlo-Kachel formatiert während der Eingabe live mit Schweizer Apostroph (z. B. `100'000`, `1'000'000.50`). Default-Wert `100'000`. Zwei MC-lokale Helpers in `MonteCarloSimulation.tsx`: `stripGrouping` entfernt Apostroph (ASCII + Curly), normalen Space und NBSP; `formatAmountWithGrouping` splittet auf erstem Decimal-Mark, gruppiert den Integer-Teil per `\B(?=(\d{3})+(?!\d))` und hängt die Fractional-Part verbatim an (so überleben trailing zeros und in-flight Decimal-Mark beim Editieren). `useMemo` für `investmentAmount` strippt vor `parseDecimalInput`. Apostroph als Wahl bewusst — einziges Trennzeichen, das in DE und EN gleichzeitig eindeutig ist (Punkt kollidiert mit EN-Decimal, Komma mit DE-Decimal). Kein Engine-Touch, alle 352 Tests grün.
- **Methodology-Section um „Warum CHF-Strategien einen höheren Sharpe zeigen" erweitert.** Wiederkehrende Operator-Frage. Neuer Erklär-Block am Ende der `rf`-Section mit kurzer Sharpe-Herleitung, Beispieltabelle (USD/EUR/CHF Sharpe für ein typisches 60/40 — `r=5.50%`, `σ=9.50%`; Excess-Return × σ rechnet exakt 0.13 / 0.32 / 0.53 nach), einem expliziten „Kein Free Lunch"-Hinweis (Sharpe misst die jeweilige Cash-Hürde, CHF-Sharpe und USD-Sharpe sind nicht direkt vergleichbar), und einem „Self-Test"-Vorschlag (CHF-RF testweise auf 4.25 % setzen, Sharpe in Build-Kachel kollabiert auf USD-Niveau — beweist, dass der Unterschied vollständig aus rf stammt). Block sitzt direkt nach der bestehenden „Bekannte Einschränkung"-Alert, voll i18n DE/EN, `data-testid="rf-chf-sharpe-explainer"`. Kein Engine-Touch, kein Test-Touch.

### 2026-04-28 (tail-realism-crisis-sigma-and-student-t) — Methodik Batch B
- **Zwei optionale Tail-Realismus-Schalter freigegeben — beide rückwärtskompatibel mit Default off.** Operator-Anschluss an die Architect-Beobachtung aus Welle 1: die Engine arbeitet konservativ-mainstream (Gauss + Long-Run-Korrelationsmatrix), für eine pessimistischere Sicht fehlten dem Operator zwei Stellschrauben. Die werden jetzt per zwei unabhängige Schalter geliefert, die einzeln oder gestapelt aktiviert werden können.
  - **Crisis-Σ (Korrelations-Regime).** Neue `CRISIS_C`-Matrix in `metrics.ts` mit stress-aware Korrelationen (Equity-Equity 0.85–0.95 statt 0.55–0.85; Equity↔Bonds +0.30 statt ~+0.10 — Flight-to-Quality bricht in Krisen zusammen, ist die Post-2022-Stylized-Fact; Equity↔REITs 0.80–0.88; Equity↔Crypto 0.55–0.75; Equity↔Gold dreht auf 0 / −0.05; **Equity↔Cash bewusst auf 0 belassen** — Cash bleibt der einzige reine Diversifier, das ist die Story-Konsistenz). Neuer Type `RiskRegime = "normal" | "crisis"` exportiert. Alle σ-getriebenen Engine-Funktionen (`computeMetrics`, `computeFrontier`, `portfolioVol`, `covariance`, `decomposeTrackingError`, `buildCorrelationMatrix`, `corr`) erhalten einen optionalen `riskRegime: RiskRegime = "normal"` als trailing Default-Param — alle ~90 bestehenden Test-Aufrufstellen bleiben unverändert.
  - **Student-t Tail-Modell (df=5).** Neuer `studentT(rng, df)`-Sampler in `monteCarlo.ts`: konstruiert χ² als Summe-quadrierter-Standard-Normals (exakt für integer df, dadurch keine Gamma-Approximation nötig) und korrigiert anschließend die Varianz via `× sqrt((df-2)/df)`, sodass `Var(t_df,corrected) = 1` für jedes df > 2. Effekt: σ bleibt identisch zur Gauss-σ, Median und P10/P90 ändern sich nur marginal — nur die fetten Tails werden sichtbar (CVaR99 sinkt typischerweise 5–15 %, Path-MDD-P05 ebenfalls). Neuer Type `TailModel = "gauss" | "studentT"` exportiert. `runMonteCarlo`-Opts erweitert um `tailModel`, `riskRegime`, `studentTDf` (clamped auf [3, 100], Default 5 — df ≤ 2 wäre Varianz-undefiniert, df ≥ 100 ist effektiv Gauss). Sampler-Dispatch via `drawShock`-Closure einmal außerhalb der Pfad-Schleife.
  - **UI-Verdrahtung.** `PortfolioMetrics.tsx`: Crisis-Σ-Pill (2 Buttons Normal/Krise) zwischen Metrik-Grid und „Show Details", verdrahtet über lokales `useState<RiskRegime>` und in alle 5 useMemo-Dependencies eingehängt (m, frontier, correlation, teDecomp). `MonteCarloSimulation.tsx`: Tail-Realismus-Box (mit beiden Toggles + Hinweistext bei Aktivierung) direkt unter dem Investment-Amount-Input. **Bewusste UX-Entscheidung:** lokale States pro Tile statt globaler Form-Field, damit Compare-Tab-Pfade unverändert bleiben und der Operator pro Tile gezielt vergleichen kann — Architect's „state duplicated"-Hinweis ist als Folge-Task vorgeschlagen (active-assumptions-banner als ergänzende Sichtbarkeit, kein Refactor des State-Modells).
  - **Methodology-Section neu: `value="tail-realism"` (v1.6).** Liegt direkt nach der MC-Section, dokumentiert beide Schalter mit Kalibrierungs-Anchorn (AQR/Bridgewater für Crisis-Σ; Cont 2001 für Student-t df=5), Wirkungs-Erklärung (was steigt, was bleibt unverändert), und einem „Wo bedienen?"-Block mit explizitem Hinweis: **Stress-Test ist deterministisch konstruiert** (fixe historische Drawdowns je Asset) und nutzt die Crisis-Σ-Matrix bewusst NICHT — sonst würde Doppel-Pessimismus entstehen. Die existierende MC-Section wurde minimal erweitert (Verweis auf die neue Section, „slightly negative"-Copy zu „nahe null bzw. leicht positiv (~+0.10)" korrigiert nach Architect-Review).
  - **Tests:** sieben neue Tests in `tests/engine.test.ts` (Block „Lieferung 2"): (1) Crisis-Σ erhöht Portfolio-σ und TE strikt für jeden imperfekt korrelierten Mix (β bewusst NICHT asserted — kann komprimieren wenn Var(ACWI) schneller wächst als Cov(p,ACWI)); (2) Crisis-Σ verschlechtert MC-CVaR99 strikt bei gleichem Seed, Median bewegt sich < 5 %; (3) Default `riskRegime` ist „normal" — bit-identisch zu vor dem Patch (12 Dezimalstellen für analytische, 6 für MC); (4) Student-t mit df=5 verschlechtert CVaR99 messbar vs. Gauss bei gleichem Seed, Median ändert sich < 6 %; (5) Default `tailModel` ist „gauss" — bit-identisch; (6) df-Clamp [3, 100] greift; (7) Crisis-Σ × Student-t Orthogonalität — gestapelt mindestens so schlecht wie jeder einzeln. Plus zwei statistische Regressions-Tests (auf Architect-Hinweis): empirische P10/P90-Spread des Student-t über df ∈ {3, 5, 10, 30} bleibt innerhalb 15 % der Gauss-Spread (Varianz-Korrektur-Guard); CVaR99 strikt schlechter als Gauss für jedes df ∈ {3, 5, 10}. **352/352 Tests grün** (vorher 343), Typecheck clean.
- **Bewusst nicht in diesem Batch:** Stress-Test bleibt Σ-unabhängig (siehe Methodology-Box „Wo bedienen?"); df-Slider (operator default reicht für jetzt — Folgevariante leicht nachzuziehen); Currency-aware Frontier und BaseCurrency-Type-Härtung (Folge-Tasks aus Welle 1, weiterhin offen).

### 2026-04-27 (synthetic-aware-wht-drag-test-coverage) — Test-Härtung
- **Drei neue Engine-Regressionstests** in `tests/engine.test.ts` schließen die zwei Lücken aus dem Architect-Review des vorherigen Synthetic-Patches: (1) **Linear-Scaling-Test** vergleicht zwei Compare-Szenarien (A=30 % US vs B=60 % US, sonst identisch); pinnt `Lift = w_us × WHT_DRAG.equity_us` und `Lift_60 = 2 × Lift_30`. Wenn die `includeSyntheticETFs`-Prop bei einem zukünftigen Refactor in einer der 4 ComparePortfolios-Aufrufstellen (Mobile A+B, Desktop A+B) wegfällt, kollabiert der Lift auf 0 → Test failt. (2) **Zero-US-Edge-Case** (70 % EU + 30 % Bonds, Synthetic on): expReturn/alpha/outperformance/benchmarkReturn müssen bit-identisch zu physical sein. Schützt davor, dass jemand die Carve-Out-Bedingung von `key === "equity_us"` aus Versehen auf alle Equity-Buckets erweitert. (3) **CMA-Override × Synthetic-Additivität**: mutiert `CMA.equity_us.expReturn` auf 0.10, prüft dass der Lift weiterhin exakt `w_us × WHT_DRAG.equity_us` ist (override-magnitude-invariant) und der physical-Leg die überschriebene μ minus vollen Drag nutzt. Sichert die additive Komposition CMA-Layer × WHT-Layer ab — kein Double-Count, keine Multiplikativität.
- **Kein Engine-Code geändert**, reine Test-Coverage-Erweiterung. **343/343 Tests grün** (vorher 340), Typecheck clean.

### 2026-04-27 (synthetic-aware-wht-drag) — Mini-Patch nach Batch A
- **Synthetic-ETF-Schalter wirkt jetzt auch auf den WHT-Drag.** Operator-Beobachtung nach Batch A: der `includeSyntheticETFs`-Schalter im Builder beeinflusst die Risiko-Engine nicht — der Rationale-Text in `portfolio.ts:378-389` verspricht „struktureller Pickup von ~20–30 bp/Jahr durch Eliminierung der 15 % US-Dividenden-WHT", aber `mapAllocationToAssets` mappt `{Equity, USA}` immer auf den Bucket `equity_us` und `portfolioWhtDrag` zog die vollen 30 bp ab — egal ob Synthetic an oder aus war. Inkonsistenz zwischen Prosa und Zahlen, jetzt geschlossen.
  - **`whtDragForKey(key, baseCurrency, syntheticUsEffective)`** und **`portfolioWhtDrag(exp, baseCurrency, syntheticUsEffective)`** in `metrics.ts` haben einen optionalen dritten Parameter (Default `false`, also rückwärtskompatibel). Wenn `key === "equity_us" && syntheticUsEffective`, ist der Drag 0. Methodik: ein swap-basierter UCITS-ETF auf den S&P 500 (Invesco IE00B3YCGJ38) erhält die US-Dividenden rechtlich nicht selbst — der Total-Return-Swap liefert die Index-Brutto-Rendite, also entfällt die 15 % US-WHT strukturell.
  - **Neuer Helper `isSyntheticUsEffective(includeSyntheticETFs, baseCurrency, hedged)`** zentralisiert die Gating-Logik. Spiegelt 1:1 die Bedingung aus `portfolio.ts:378` und `etfs.ts:488/500`: aktiv genau dann, wenn der Schalter an ist UND nicht durch `hedged && baseCurrency !== "USD"` überschrieben (für hedged non-USD-Bases gibt es im Katalog keine Synthetic-Hedged-Anteilsklasse, ETF-Picker bleibt physical → kein Pickup).
  - **`computeMetrics`, `computeFrontier`, `decomposeTrackingError` (kein Drag-Param nötig — TE ist drag-invariant) und `runMonteCarlo`** durchgeschleust mit `syntheticUsEffective`. **Asymmetrie bewusst:** der ACWI-Benchmark behält seinen vollen WHT-Drag (er steht für die praktische Alternative — physisch replizierender ACWI-ETF), die Portfolio-Seite spart die 30 bp auf dem US-Anteil. So wird die Synthetic-Wahl korrekt als Implementations-Alpha (~30 bp × US-Anteil im Aktien-Sleeve, also ~18 bp bei 60 % US-Equity) sichtbar — Alpha und Outperformance steigen entsprechend, Vol/β/TE bleiben unverändert.
  - **Komponenten-Verdrahtung:** `PortfolioMetrics` und `MonteCarloSimulation` erhalten neue Props `includeSyntheticETFs?: boolean` und (für PortfolioMetrics) `hedged?: boolean`. `BuildPortfolio.tsx` (1 Stelle) und `ComparePortfolios.tsx` (4 Aufrufstellen — Mobile-Tabs A+B + Desktop-Side-by-Side A+B) reichen die Form-Werte (`form.getValues().includeSyntheticETFs` bzw. `inputA/B.includeSyntheticETFs`) und den Hedging-Wert durch.
  - **Methodology-Section `value="wht"` auf v1.5 angehoben** mit emerald-akzentuierter Box „Synthetik-Carve-Out (v1.5)", die Wirkung, Risiko-Tradeoff (Kontrahentenrisiko, UCITS-10 %-Cap, tägliches Collateral) und Größenordnung in beiden Sprachen erklärt.
  - **Tests:** drei neue Engine-Tests im `CMA layered overrides`-Block: (1) MC-Pickup auf 100 % US-Equity ist exakt `WHT_DRAG.equity_us`; (2) `computeMetrics` auf 60/25/15-Portfolio: `expReturn`, `alpha`, `outperformance` steigen exakt um `0.60 × WHT_DRAG.equity_us`, `benchmarkReturn`/Vol/β/TE invariant; (3) Gate-Logik `isSyntheticUsEffective` deckt alle 8 Kombinationen aus {synthetic on/off} × {USD/non-USD} × {hedged on/off} ab. **340/340 Tests grün, Typecheck clean.**
- **Bewusst nicht geändert:** Benchmark-Drag bleibt voll (siehe Asymmetrie-Begründung oben — Symmetrie-Bruch ist hier das *richtige* Verhalten, weil der Benchmark die physical-ACWI-Alternative repräsentiert). Andere Synthetic-Buckets (z. B. EU/JP) bleiben außer Scope — der Synthetic-Toggle aktiviert im Katalog nur den US-Sleeve, weil dort der Steuervorteil materiell ist.

### 2026-04-27 (wht-drag-and-path-mdd) — Methodik Batch A
- **Quellensteuer-Drag (WHT) auf Erwartungsrenditen.** Bisher waren die ausgewiesenen μ pre-tax — für einen typischen CH/EU-Privatanleger via IE-domizilierte UCITS-ETFs aber spürbar zu optimistisch (hauptsächlich US-Equity-Dividenden). Neue `WHT_DRAG`-Konstante in `src/lib/metrics.ts` mit Defaults: US 30 bp, EM 40 bp, EU/UK/JP/Thematic 20 bp, CH 20 bp regulär aber **0 bp bei Basiswährung CHF** (CH-Resident kann die 35 % Verrechnungssteuer voll zurückfordern), Bonds/Cash/Gold/REITs/Crypto = 0 bp. Helfer `whtDragForKey(key, baseCurrency)` und `portfolioWhtDrag(allocation, baseCurrency)` aggregieren auf Portfolio-Ebene.
  - **`computeMetrics` und `computeFrontier`** (beide in `metrics.ts`) ziehen den Drag jetzt symmetrisch vom Portfolio UND vom ACWI-Benchmark ab. Effekt: `expReturn`, alle Frontier-Punkte, Sharpe, Alpha und Outperformance werden konsistent net-of-WHT ausgewiesen, Tracking Error bleibt unverändert (nur σ-Effekt). Kritisch ist die symmetrische Anwendung — sonst würde Alpha künstlich hochgepusht, weil der Benchmark-μ unbesteuert bliebe.
  - **`monteCarlo.ts:bucketAssumption`** zieht denselben Drag von μ ab, bevor die log-normalen Pfade gezogen werden. Ein 100 %-S&P-500-Portfolio sieht jetzt also μ ≈ 7.7 % statt 8.0 %, und das schlägt sauber auf P10/P50/P90, CVaR und die neue Path-MDD durch.
  - **Limitierung dokumentiert:** Modell unterstellt IE-domizilierte Vehikel und CH-Resident als Default. Für US-domizilierte ETFs wären die Sätze ~doppelt so hoch (60 bp statt 30 bp); für EU-Resident-Setups oder spezielle Treaty-Konstellationen sind die Defaults konservativ. Kapitalgewinn-/Vermögenssteuer (kantonal CH) sind weiterhin nicht modelliert — explizit out of scope für diesen Batch.
- **Realized Max Drawdown aus MC-Pfaden.** Die alte Heuristik `MDD ≈ −min(0.85, (1.8 + 1.4·equityShare)·σₚ)` ist eine Faustformel auf σ-Basis und kennt weder Pfad-Asymmetrie noch Tail-Korrelationen. `runMonteCarlo` berechnet jetzt zusätzlich für jeden simulierten Pfad den schlimmsten Peak-to-Trough-Verlust *entlang des Pfads* (laufendes Maximum bis Jahr y, dann `value/peak − 1`). Über alle Pfade berichten wir Median (`realizedMddP50`) und 5.-Perzentil (`realizedMddP05`) als zusätzliche Felder im `MonteCarloResult`.
  - **Neue UI-Kachel** in `MonteCarloSimulation.tsx` direkt unter dem CVaR-Tile, mit demselben amber-Akzent — zwei Werte (Median + P5) und einer Erklärung in beiden Sprachen (i18n-Keys `mc.mdd.title/median/p05/desc`).
  - **PortfolioMetrics-MDD-Kachel umbeschriftet:** Sub-Label jetzt explizit „Heuristik · MC-Tab für Pfad-MDD" statt „geschätzt", damit klar ist, wo die rigorosere Zahl steht. Heuristik bleibt absichtlich auf der Risk-&-Performance-Tile, weil sie ohne Simulation funktioniert.
  - **Neue Methodology-Sektionen:** `value="wht"` (zwischen MC und Hedging) erklärt den WHT-Drag inkl. der Default-Tabelle und Domicile-Limitierung; die MC-Section wurde um eine amber-akzentuierte Box „Pfadbasierter Max Drawdown (v1.4, Apr 2026)" erweitert. Zwei neue Formel-Zeilen im Formeln-Block: Path-MDD (`MDDₚₐₜₕ = minₜ (Vₜ / maxₛ≤ₜ Vₛ − 1); reported = quantileₚ(...)`) und WHT-net Expected Return (`E[Rₚ]ₙₑₜ = Σᵢ wᵢ · (μᵢ − whtᵢ)`).
- **Bug fix in passing:** `monteCarlo.ts:bucketAssumption` rief `bucketKey(ac, rg)` ohne `baseCurrency`-Parameter, sodass die CH-Routing-Logik aus dem `metrics-home-global-fix`-Patch in der MC-Pfad ignoriert wurde. Jetzt: `bucketKey(ac, rg, baseCurrency)`. Folgeänderung: `MonteCarloSimulation.tsx` Prop `baseCurrency` ist jetzt vom Typ `BaseCurrency` (war `string`).
- **Tests:** drei bestehende Engine-Tests adaptiert (Benchmark-Test berücksichtigt jetzt den symmetrischen WHT-Abzug auf Benchmark-Seite; zwei MC-Tests importieren `WHT_DRAG`/`portfolioWhtDrag` für die erwartete Drift). 335/335 Tests grün, Typecheck clean.
- **Bewusst nicht in diesem Batch:** Crisis-Σ in Stress-Tests + Student-t-Toggle (Methodik Batch B, separat freizugeben). CH-Steuern-Layer (Verrechnungssteuer auf inländische Dividenden, Vermögenssteuer, Kapitalgewinne) bleibt explizit out of scope.

### 2026-04-27 (lookthrough-pie-and-shorter-toggle-desc)
- **Allokations-Pie + Stacked-Bar respektieren jetzt den Look-Through-Schalter.** Operator-Anschluss an `lookthrough-toggle-global-gate`: vorher zeigte der Pie immer die Top-Level-Buckets der Allokation, auch wenn die Risiko-Engine schon mit Look-Through routet — Inkonsistenz behoben.
  - **BuildPortfolio (`BuildPortfolio.tsx`):** `chartData` ist jetzt eine abgeleitete Größe. Wenn `watchedLookThroughView === true` UND `output.etfImplementation.length > 0`, ruft sie `mapAllocationToAssetsLookthrough(allocation, etfImplementation, watchedBaseCcy)` und mappt die `{key, weight}`-Liste auf `{name: CMA[key].label, value: weight*100}`. Pie + Stacked-Bar konsumieren beides denselben Datensatz. Bei AUS oder fehlender ETF-Implementation: Original-Verhalten (`assetClass - region`-Buckets).
  - **ComparePortfolios (`ComparePortfolios.tsx`):** identische Logik in einer kleinen Helper-Funktion `buildChartData(out, input)`, die den Schalter **per Portfolio** liest (`inputA.lookThroughView` / `inputB.lookThroughView`) und die jeweilige Basiswährung an die Look-Through-Routing-Funktion durchreicht. Operator kann also visuell direkt vergleichen, was eine MSCI-Europe-Position als „Equity-Europe-Klotz" vs. zerlegt in UK/CH/EU bedeutet.
  - **Bewusst NICHT geändert:** die Allokations-Tabelle direkt unter dem Pie iteriert weiterhin `output.allocation` (zeigt also die vom User gewählten Buckets). Das ist die Antwort auf „was habe ich ausgewählt", während Pie + Bar die Antwort auf „was halte ich effektiv" sind. Methodology-Section entsprechend umgeschrieben: Pie + Bar in der „greift"-Box, Tabelle in der „greift bewusst NICHT"-Box mit Begründung.
- **Schalter-Beschreibung gekürzt.** `build.lookThrough.desc` (DE+EN) auf einen Satz reduziert: nennt jetzt knapp die drei Wirkungsorte (Pie, Risiko-Kennzahlen, Korrelationsmatrix) und das AUS-Verhalten. Das vorherige Beispiel mit den iShares-Core-MSCI-Europe-Zahlen (~20 % UK, ~14 % CH) bleibt im Methodology-Tab erhalten, im Form-Tooltip war es zu lang.
- 335/335 Tests grün, Typecheck clean.

### 2026-04-27 (lookthrough-toggle-global-gate)
- **Schalter „Look-Through-Analyse" wirkt jetzt global, nicht mehr nur auf das Visualisierungs-Panel.** Operator-Beobachtung: Schalter-Beschreibung versprach „decompose selected ETFs into their underlying country, sector and top-holding exposures", in Wirklichkeit blendete er aber nur das Geo-Map-/Top-10-Panel ein/aus, während die Risiko-Engine seit `lookthrough-aware-risk-metrics` immer mit Look-Through routet (Inkonsistenz). Fix: der Schalter gatet jetzt das Routing auf der ganzen App.
  - **BuildPortfolio (`BuildPortfolio.tsx`):** `watchedLookThroughView = form.watch("lookThroughView")` triggert ein erweitertes Publish-`useEffect`. AN → `setLastEtfImplementation(output.etfImplementation)`, ETF-Liste auch als Prop an `<PortfolioMetrics etfImplementation=...>` (Single-Portfolio-Sicht). AUS → `setLastEtfImplementation(null)`, Prop = `undefined`. Beide Pfade konsumieren dann den Look-Through-aware oder den Row-Region-Pfad in `metrics.ts` (`mapAllocationToAssetsLookthrough` vs. `mapAllocationToAssets`).
  - **ComparePortfolios (`ComparePortfolios.tsx`):** vier Aufrufstellen (Mobile-Tabs A+B in `TabsContent`, Desktop-Side-by-Side A+B) gaten jetzt **per Portfolio** über `inputA.lookThroughView` / `inputB.lookThroughView`. So kann der Operator A mit Look-Through und B ohne (oder umgekehrt) vergleichen, um zu sehen, welche Treiber sich allein durch die Routing-Wahl ändern.
  - **Methodology-Korrelationsmatrix:** sieht den Schalter automatisch — `setLastEtfImplementation(null)` wenn AUS heißt `getLastEtfImplementation()` liefert `null`, der Code-Pfad mit `corrEtfImpl=undefined` bleibt aktiv und `buildCorrelationMatrix(allocation, undefined, undefined)` fällt auf Row-Region-Routing zurück. Zusätzlich: italic-Hinweis unter der Matrix zeigt explizit an, ob Look-Through-Routing gerade aktiv ist (mit Zahlenbeispiel UK ~20 %, CH ~14 %) oder aus (mit Verweis auf den Schalter).
  - **Neue Methodology-Section `value="lookthrough"`** zwischen `corr` und `bench`, in beiden Sprachen. Vier abgesetzte Boxen: (1) **Wo das Routing greift** — Vol/Beta/TE/Alpha/Sharpe, TE-Contribution, Effiziente Frontier, Korrelationsmatrix, Compare-Tab pro Portfolio; (2) **Wo das Routing bewusst NICHT greift** — Allokations-Pie (UX-Designentscheidung), Monte Carlo (eigener `bucketKey`-Pfad in `monteCarlo.ts`, bekannter Folge-Schritt), Stress-Test (Schock-Vektoren auf Region/Asset-Klassen-Ebene kalibriert); (3) **Steuerung über den Schalter im Tab Build** — Wirkungsbeschreibung pro Stellung; (4) **Konservativer Länder-Map** — explizit nur UK/CH/JP/US/Polen ausgespalten; mehrdeutige Profil-Buckets („Other Europe", „Ireland") fallen bewusst auf Row-Region zurück, damit Total-Gewicht invariant bleibt.
  - **i18n (`build.lookThrough.desc`):** Beschreibung in DE+EN umgeschrieben, jetzt explizit „When ON, this also routes the Risk & Performance metrics … via the actual ETF holdings — e.g. iShares Core MSCI Europe is split into ~20 % UK + ~14 % CH + continental EU. When OFF, those metrics fall back to row-region routing and the Look-Through panel is hidden." Damit ist der Schalter-Tooltip nicht mehr im Widerspruch zum Verhalten.
  - **Backwards-Kompatibilität:** Default `lookThroughView=true` (BuildPortfolio + Compare A/B), d.h. ohne User-Eingriff verhält sich die App genau wie nach `lookthrough-aware-risk-metrics`. Tests, Typecheck, Lint clean — Suite 335/335.

### 2026-04-27 (te-contribution-table)
- **Risk & Performance Metrics: neue „Tracking Error Contribution"-Tabelle im Detail-Bereich + geschärfter Tooltip auf der TE-Kachel.** Operator-Frage: „dieses doch eher defensive Portfolio (Cash 3 % / Bonds 0 % / Equities 89.5 % / Gold 7.5 %, mit Schweizer Home-Tilt) hat einen TE von 2.5 %?" — die Zahl ist mathematisch korrekt, die Verteilung der Treiber war aber im UI nirgends sichtbar. Implementierung:
  - **`decomposeTrackingError(allocation, baseCurrency)` in `metrics.ts`** liefert die marginale Beitragszerlegung pro Anlageklasse: `c_i = a_i · (Σa)_i / TE` mit `a = w_p − w_b`. Mathematische Garantie: `Σ_i c_i = a' Σ a / TE = TE² / TE = TE`, d.h. die Zeilen summieren sich exakt auf den TE-Headline-Wert (auf Floating-Point-Niveau). Vorzeichenbehaftet — negative Einträge sind Diversifikatoren gegen den Rest des aktiven Books.
  - **Eingaben** sind die echte Allokation und die Basiswährung; die Funktion ruft `mapAllocationToAssets` auf (also durchläuft sie denselben Home/Global-Compaction-Fix wie Vol/Beta/TE selbst), bildet die Vereinigung von Portfolio- und Benchmark-Keys, berechnet `Σa` über die echte Korrelations-/Vol-Matrix (`corr(...) × σ_i × σ_j`), filtert Zeilen mit weder Portfolio- noch Benchmark-Exposure heraus und sortiert nach `|c_i|` absteigend.
  - **UI in `PortfolioMetrics.tsx`:** neue Sektion zwischen „Expected Returns by Asset Class" und „Efficient Frontier" innerhalb des `Show Details`-Bereichs. Spalten: Asset · Portfolio % · Benchmark % · Active (pp) · TE-Beitrag. Aktive Wette farbcodiert (grün positiv / rot negativ). Total-Zeile unten zeigt die Summe = `m.trackingError`. Erklärt im Legend-Footer, warum Cash/Anleihen/Gold hier auftauchen (Benchmark = 100 % Aktien-ACWI).
  - **Tooltip-Update auf der Tracking-Error-Kachel:** Beide Sprachen erweitert um den Hinweis, dass der Benchmark-Vergleich ein 100 %-Aktien-ACWI-Proxy ist, also Cash/Anleihen/Gold und regionale Tilts (Home-Bias) den TE mechanisch erhöhen. Verweis auf den `Show Details`-Toggle für die Beitragstabelle.
  - **i18n-Keys** `metrics.teContrib.*` (9 Keys × 2 Sprachen) für Titel, Beschreibung, Spaltenköpfe, Total, Legend.
  - **Regressionstest** `decomposeTrackingError contributions sum to total TE and surface gold + home-bias as drivers` rekonstruiert die Operator-Allokation exakt (CHF base, 51.3/13.9/11.6/8.7/4.0 + 7.5 Gold + 3 Cash) und prüft: (1) `d.total ≈ m.trackingError` auf 6 Nachkommastellen, (2) `Σ c_i ≈ d.total` (Schließungseigenschaft der Zerlegung), (3) US-Untergewicht ist der größte positive Treiber (>30 % Anteil), (4) Gold trägt >10 % bei, (5) **Schweizer Übergewicht ist hier ein Diversifikator** (negativer Beitrag) — kontraintuitiv und deshalb gepinnt: weil das Portfolio gleichzeitig stark US/EU/UK-untergewichtet ist, fängt der CH-Tilt einen Teil dieser Untergewichts-Vol ab statt sie zu verstärken; (6) UK ist mit Portfolio=0/Benchmark=4/Active=−4 in der Tabelle vertreten. Zusatzcase: reines Benchmark-Portfolio → `d.total < 0.001`. Suite jetzt 332 Tests, alle grün.
  - Konkrete Zahlen für die Operator-Allokation (CHF, TE = 2.52 %): US Equity −8.7 pp → +1.11 pp Beitrag (44 % Anteil), Europe −5.3 → +0.67 (26 %), Gold +7.5 → +0.51 (20 %), UK −4.0 → +0.41 (16 %), EM −2.4 → +0.34 (13 %), Schweiz +9.9 → **−0.52** (−21 %, Diversifikator), Cash und Japan ≈ 0. D.h. die TE kommt eigentlich aus den Aktien-Untergewichten gegen ACWI plus Gold; der Schweizer Home-Bias absorbiert sogar einen Teil davon.

### 2026-04-27 (metrics-home-global-fix)
- **Bugfix — Risk & Performance Metrics ergaben für komprimierte Equity-Sleeves völlig falsche Vol / Beta / Tracking Error.** Wenn der ETF-Budget zu eng war, kollabiert die Engine das Aktien-Sleeve in zwei Zeilen `region: "Home"` + `region: "Global"` (siehe `portfolio.ts:280-287`, `etfs.ts:480-494`). `mapAllocationToAssets()` in `metrics.ts` und das parallel gehaltene `bucketKey()` in `monteCarlo.ts` kannten diese beiden Region-Werte aber nicht und schmissen sie still in den Fallback `equity_thematic` (Vol 22 %, ExpReturn 8 %, korreliert nur ~0.85 mit US-Equity, nicht im ACWI-Benchmark enthalten). Folge im UI: ein 64.7 % S&P 500 / 35.3 % MSCI ACWI IMI Portfolio zeigte Vol 22.00 %, Expected Return 8.00 %, Beta 1.25 und **Tracking Error 11.4 %** — also den Fingerabdruck eines reinen Themenfonds gegen ACWI, obwohl die Realität eher Vol ~16 %, Beta ~1.05 und TE ~3-4 % wäre. Fix:
  - `mapAllocationToAssets(allocation, baseCurrency)` löst `region === "Home"` jetzt anhand der Basiswährung in den passenden Equity-Bucket auf (USD → `equity_us`, CHF → `equity_ch`, GBP → `equity_uk`, EUR → `equity_eu`) — analog zur Logik im ETF-Picker.
  - `region === "Global"` wird über die ACWI-Benchmark-Gewichte (60 / 14 / 4 / 4 / 4 / 14) auf die sechs Regional-Buckets verteilt. Damit hat ein 100 %-ACWI-Portfolio Tracking Error ≈ 0 und Beta ≈ 1.0, wie es muss.
  - `computeMetrics`, `computeFrontier` und `buildCorrelationMatrix` reichen die Basiswährung jetzt durch; `PortfolioMetrics.tsx` übergibt sie entsprechend.
  - Monte-Carlo-Pfad (`monteCarlo.ts`) bekommt die gleiche Behandlung: `bucketKey(assetClass, region, baseCurrency)` und ein expliziter Vor-Schritt, der `Equity-Global`-Zeilen in die sechs ACWI-Regionen aufspannt, bevor die Buckets gebaut werden — sonst weicht die analytische Vol von der MC-Vol auf der Run-Monte-Carlo-Ansicht ab.
  - Neuer Regressionstest `mapAllocationToAssets resolves Equity-Home + Equity-Global from sleeve compaction` prüft alle drei Eigenschaften (Home-Routing nach Basiswährung, Global-Aufteilung gemäß BENCHMARK, TE eines reinen Global-Bestands < 0.5 %). Suite jetzt 331 Tests, alle grün.

### 2026-04-27 (auto-merge-backfill-prefix)
- **Auto-Merge-Action akzeptiert jetzt einen vierten Branch-Prefix `backfill-`.** Bisher hörte `.github/workflows/admin-auto-merge.yml` nur auf die drei vom in-app Admin erzeugten Prefixes (`add-etf/`, `add-lookthrough-pool/`, `update-app-defaults/`). Operator-seitige One-off-Backfill-PRs — wie zuletzt PR #8, der die drei offiziellen ETF-Namen in die bestehenden Pool-Einträge nachgezogen hat (Branch `backfill-pool-names/2026-04-27T18-56-46`) — fielen aus dem Filter heraus und mussten manuell per REST-API gemergt werden. Mit dem neuen Prefix laufen künftige Backfills (egal ob Pool-Namen, Override-Korrekturen, Refresh-Daten-Repair) wieder ohne Handgriff durch denselben Pfad: PR öffnen → Action squash-mergt → Branch wird gelöscht. Action-Kommentar und der Operator-facing-Erklärtext im DocsPanel (DE + EN) wurden auf „vier Prefixes" aktualisiert. Hinweis: Da das Replit-PAT keinen `workflow`-Scope hat, musste die Workflow-Datei wie üblich manuell über die GitHub-Web-UI committet werden — die lokale Datei ist die Source of Truth.

### 2026-04-27 (admin-pool-table-name-and-source-sort)
- **Look-through-Pool-Tabelle: offizieller ETF-Name pro Auto-Refresh-Zeile + Sortierung primär nach Quelle.** Bisheriges Problem: Pool-ISINs, die nicht im statischen Katalog (`etfs.ts`) stehen — also genau die per Admin-Add neu aufgenommenen Auto-Refresh-Einträge wie `IE00B53SZB19`, `IE00BM67HT60`, `CH0031768937` — zeigten in der Spalte „Name (Katalog)" nur kursiv „— nicht im Katalog". Operator musste die ISIN extern (justETF, Google) nachschlagen, um zu erkennen, was er da eigentlich vor sich hatte. Fix:
  - **Scrape-Layer:** Neue Funktion `extractEtfName(html)` in `artifacts/api-server/src/lib/lookthrough-scrape.ts` extrahiert den offiziellen Namen aus dem stabilen `<h1 data-testid="etf-profile-header_etf-name">…</h1>`-Block des justETF-Profilkopfs, mit Fallback auf den HTML-`<title>` (Format `<Name> | <WKN> | <ISIN>`). Wird in `scrapeLookthrough()` mit zurückgegeben (`ScrapedLookthrough.name?: string`). Spiegelung in `artifacts/investment-lab/scripts/refresh-lookthrough.mjs`, sodass der monatliche Refresh-Job bestehende Pool-Einträge auf seinem nächsten Lauf automatisch backfillt.
  - **Persistenz:** `LookthroughPoolEntry` (sowohl in `api-server/src/lib/github.ts` als auch in `investment-lab/src/lib/admin-api.ts`) bekommt ein optionales `name?: string`-Feld. Beim Open-PR-Schreiben wird `name` als erstes Feld in den Pool-Eintrag aufgenommen. GET `/admin/lookthrough-pool` liefert `name` (oder `null`) pro Eintrag mit aus.
  - **One-time Backfill:** Die drei aktuell im Pool stehenden Einträge wurden direkt mit ihren scrapeten Namen versorgt (`iShares SLI ETF (CH)`, `iShares Nasdaq 100 UCITS ETF (Acc)`, `Xtrackers MSCI World Information Technology UCITS ETF 1C`), damit der Operator sofort den Effekt sieht ohne auf den nächsten Cron warten zu müssen.
  - **Sortierung primär nach Quelle.** GET `/admin/lookthrough-pool` sortiert jetzt mit definiertem Quellen-Rang: `pool` (Auto-Refresh) → `both` → `overrides` (Kuratiert), sekundär nach ISIN. Die drei dynamischen Auto-Refresh-Einträge stehen damit oben in der Tabelle gruppiert — genau die, für die der gescrapete Name die einzige Identifikation ist. Bisher war die Tabelle rein alphabetisch nach ISIN sortiert, sodass die Auto-Refresh-Zeilen zwischen den 11 kuratierten Einträgen versteckt waren.
  - **UI-Render in `LookthroughPoolPanel` (Admin.tsx).** Die „Name (Katalog)"-Zelle hat jetzt drei Branches: (1) ISIN ist im Katalog → wie bisher Katalog-Name + Bucket-Key, (2) ISIN ist nicht im Katalog aber Pool-Eintrag liefert `name` → kursiver justETF-Name + dezenter Hinweis „justETF · nicht im Katalog" (bilingual), (3) Fallback wie bisher „— nicht im Katalog". Italic + zweite Zeile grenzen visuell ab, damit kuratierte Katalog-Namen klar von Live-gescrapeten unterscheidbar bleiben. Neuer `data-testid="pool-name-{isin}"` für künftige E2E-Coverage.
  - 330/330 Tests grün, Typecheck clean. Schema-Änderung ist additiv (optionales Feld) — bestehende Pool-Einträge ohne `name` rendern den Fallback wie zuvor.

### 2026-04-27 (admin-pending-prs-widget)
- **Neuer „Offene PRs (warten auf Merge)"-Block direkt im LookthroughPoolPanel** — umgeht den GitHub-Search-Index-Bug, der dem Operator heute echte Probleme gemacht hat. Symptom: `github.com/.../pulls?q=is%3Apr+is%3Aopen` zeigte „0 open PRs", obwohl die REST-API `pulls.list({state: "open"})` zwei offene Pool-PRs (#4 IE00B53SZB19, #5 IE00BTJRMP35, beide `mergeable: true`, `mergeable_state: clean`) zurücklieferte. Ursache: GitHub baut das Suchindex asynchron neu auf — bei frisch geöffneten PRs kann der Index minuten- bis stundenlang hinter dem Datenbankstand zurückliegen, und die Default-`/pulls`-Listenseite verwendet das Suchindex, nicht den DB-State. Operator hätte also nie sehen können, dass seine Klicks tatsächlich PRs erzeugt haben. Lösung: Backend-Endpoint **`GET /admin/github/prs?prefix=<branch-prefix>`** ruft `pulls.list({state: "open", per_page: 100})` direkt (REST, kein Search), filtert client-seitig auf `head.ref.startsWith(prefix)` und liefert `{number, url, title, headRef, createdAt, draft}` zurück. Frontend-Karte `PendingPrsCard` (Admin.tsx) rendert das mit `GitPullRequest`-Icon + Count-Badge + relativer Zeit (`vor X Min/Std/Tagen` ↔ `X min/h/d ago`) + manuellem Refresh-Button + Direktlink pro PR. Auto-Refresh nach jedem erfolgreichen wie auch fehlgeschlagenen Add (`prsRefreshKey`-State-Counter), damit auch das 422-„Branch existiert bereits"-Szenario sofort sichtbar macht, dass der vorherige PR noch offen wartet. Bilingual (`useAdminT()`). Komponente ist generisch über `prefix`-Prop und kann später für die anderen beiden Flows (`add-etf/`, `update-app-defaults/`) wiederverwendet werden — heute zunächst nur im LookthroughPoolPanel eingebaut, weil dort der Bug entdeckt wurde. Backend-Helper `listOpenPrs(prefix?)` mit `OpenPrInfo`-Interface in `artifacts/api-server/src/lib/github.ts`. `data-testid`-Konvention `pending-prs-{slug}` / `pending-pr-{number}` / `pending-pr-link-{number}` für künftige E2E-Coverage. Live verifiziert: Endpoint liefert beide tatsächlich offenen PRs trotz „0 open" im Search-UI.

### 2026-04-27 (admin-docs-github-links-and-republish-insight)
- **DocsPanel — GitHub-Direktlinks pro Flow + neue „Republish-nach-Merge"-Insight.** Operator-Bug-Hunt am 2026-04-27: zwei PRs (RF-Raten, Lookthrough-Pool ISIN `CH0031768937`) waren auf `main` gemergt, der Workspace zeigte die neuen Werte korrekt — die Live-App auf `bicon.co` servierte aber weiterhin die alten Built-in-Defaults (USD 4.25 / EUR 2.50 / GBP 4.00 / CHF 0.50, also exakt `BUILT_IN_RF` ohne Overlay). Root cause: Replit baut den Deploy-Snapshot aus dem Workspace-Stand zum Zeitpunkt des „Publish"-Klicks; wenn der GitHub→Workspace-Sync den Merge-Commit noch nicht eingespielt hat, deployt Replit einen Pre-Merge-Snapshot, obwohl `main` auf GitHub aktuell ist. Fix für den Operator: nach dem Merge **kurz warten, bis der Workspace-File-Tree die Änderung zeigt, _dann_ erst Republish klicken**. Diese Insight wandert jetzt prominent in den DocsPanel als gelb hinterlegter `AfterMergeCallout` direkt unter dem Intro-Absatz (bilingual, mit konkreter 4-Schritt-Reihenfolge + Hinweis dass Flow 5 davon unberührt ist, weil Override-Layer-Dateien zur Laufzeit gelesen werden).
- **GitHub-Links pro Flow.** Backend `/admin/whoami` liefert jetzt zusätzlich `githubOwner`, `githubRepo`, `githubBaseBranch` (nur Metadaten, kein PAT) — wird beim Token-Login geladen und durch `Admin.tsx` als `github`-Prop an `DocsPanel` durchgereicht. Pro `FlowSection` rendert die Komponente zwei Buttons: **„Datei auf GitHub"** (Deep-Link auf `blob/{baseBranch}/{file}`) und **„PRs dieses Flows"** (gefiltert nach Branch-Prefix der jeweiligen Helper-Funktion in `lib/github.ts` — `add-etf/`, `add-lookthrough-pool/`, `update-app-defaults/`). Flow 5 (Cron) bekommt stattdessen einen Link auf `/.github/workflows` und „GitHub Actions öffnen". Footer-Block „GitHub-Direktlinks" mit drei allgemeinen Shortcuts: Repository, Alle Pull Requests, GitHub Actions. Wenn `GITHUB_OWNER` / `GITHUB_REPO` nicht gesetzt sind, werden alle Links unterdrückt und ein dezenter Hinweis erscheint im Footer.
- **Test-Robustheit gegen Default-Verschiebungen.** Drei Vitest-Cases in `tests/engine.test.ts` (per-currency RF defaults, cross-currency isolation, sanitization) hatten die ursprünglichen `BUILT_IN_RF`-Zahlen hartkodiert (`0.0250`, `0.0400`, `0.0050`) und brachen, sobald die erste `app-defaults.json`-PR (EUR 0,03 / GBP 0,049 / CHF 0,004) gemergt war. Umgestellt auf `settings.RF_DEFAULTS.{USD|EUR|GBP|CHF}` als Source of Truth + ein zusätzlicher struktureller Sanity-Check (alle vier Currencies vorhanden, alle Werte in `[0, 0.2]`). Damit überleben sie jede zukünftige Default-Anpassung über die Admin-PR-Pipeline. 330/330 Tests grün, Typecheck clean, E2E 2/2.

### 2026-04-27 (admin-bilingual-and-docs-card)
- **`/admin` page now fully bilingual (EN/DE) with its own language toggle.** Previously the public app honoured the EN/DE switch via `LanguageProvider` / `useT()`, but the entire admin surface was hard-coded English (Browse Buckets panel, Suggest ISIN flow, Preview editor, Diff panel, Lookthrough-Pool panel, Data-Updates column with Freshness / Recent Changes / Recent Runs cards, Global Defaults editor including all preset toasts and validation messages, plus the pre-auth Token prompt). The German-speaking operator had to read English UI for every PR action. New thin wrapper `useAdminT()` in `src/lib/admin-i18n.ts` proxies the existing `LanguageProvider` so the same `investment-lab.lang.v1` localStorage key drives both surfaces. Pattern: `t({ de, en })` for short strings, `lang === "de" ? <>…</> : <>…</>` ternaries for rich JSX with code/strong/em tags, ternary on template literals for runtime values (toasts, PR numbers, validation messages with field counts and pluralisation). New `<LangToggle />` component (DropdownMenu DE/EN) sits next to `<ThemeToggle />` in the admin header. The pre-auth `<TokenPrompt />` carries its own inline EN/DE button since no header is mounted before login. All `data-testid` attributes preserved unchanged so the e2e suite still passes. `computePoolStatus()` was refactored to return `{ tone }` only with a new `poolStatusLabel(tone, lang)` helper moving the label to the view layer.
- **New "Update Flows" documentation card at the top of `/admin`.** Collapsible card (default open, sessionStorage-persisted under `investment-lab.admin.docs.v1`) that explicitly enumerates the **five distinct ways** to change data shipped today, so the operator can confirm which flow is running before clicking "Open PR". Each flow gets a tone-coded badge (PR / instant / cron) and lists: target file/storage, scope of visibility, latency until end users see the change, and the trigger UI. Flows covered: (1) ETF catalog PR (`etfs.config.ts`), (2) Look-through pool PR (`lookthrough.overrides.json`), (3) App-defaults PR (`app-defaults.json` for RF / HB / CMA), (4) Methodology localStorage (per-user, instant, no PR), (5) Monthly refresh cron job (`etfs.overrides.json` + `lookthrough.overrides.json`). Helper `<FlowSection />` renders each entry consistently. New file: `src/components/admin/DocsPanel.tsx`. Bilingual; uses single-quoted string literals for German strings that contain `„…"` typographic quotes (the inner ASCII `"` would otherwise close a double-quoted string).

### 2026-04-27 (admin-lookthrough-pool-pr-flow)
- **Architektur-Fix: `POST /admin/lookthrough-pool/:isin` schreibt nicht mehr direkt auf Disk, sondern öffnet einen GitHub-PR.** Operator meldete einen Widerspruch in der Oberfläche: die Admin-Pool-Tabelle zeigte 13 ETFs als „Auto-Refresh" / „Daten OK" an, der `EtfOverrideDialog` derselben ISIN sagte aber „no look-through data on file". Ursache war ein doppelter Architekturfehler im Schreibpfad: (1) der Endpoint schrieb mit `writeFile(...)` direkt in `artifacts/investment-lab/src/data/lookthrough.overrides.json` — dieses Verzeichnis ist auf der Production-Container-Disk **ephemer** und ging beim nächsten Restart verloren; (2) selbst wenn die Schreibe überlebt hätte, hätte das Frontend sie nicht gesehen, weil dort `lookthrough.overrides.json` zur **Build-Zeit** in das Vite-Bundle gezogen wird (`src/lib/lookthrough.ts` → `import overrides from "../data/lookthrough.overrides.json"`). Der `LookthroughPoolPanel` zeigte also den Server-Disk-Zustand, der `EtfOverrideDialog` den Bundle-Zustand — beide divergierten.
  - **Fix (Option B — gewählt vom Operator)**: der Schreibpfad spiegelt jetzt den bewährten ETF-PR-Flow. Neue Helper-Funktion `openAddLookthroughPoolPr({isin, entry})` in `artifacts/api-server/src/lib/github.ts` (~Zeile 144): liest die aktuelle `lookthrough.overrides.json` von `main`, fügt den neuen Eintrag in die `pool`-Sektion ein (oder kein-op, wenn bereits in `overrides` oder `pool` vorhanden — Antwort `alreadyInBaseFile: true`), commitet auf einen deterministischen Branch `add-lookthrough-pool/{isin-lowercase}` und öffnet einen PR. Determinismus per ISIN verhindert PR-Duplikate bei wiederholten Klicks. Die Route `POST /admin/lookthrough-pool/:isin` (`src/routes/admin.ts` ~Zeile 295) wurde komplett umgeschrieben: `writeFile`-Pfad entfernt, neuer `githubConfigured()`-Guard mit 503-Antwort wenn `GITHUB_*`-Secrets fehlen, lokale Disk-Datei wird nur noch als schneller Dedup-Check vor dem (teuren) justETF-Scrape gelesen — der eigentliche persistente Schreibpfad ist ausschließlich der PR. Antwort-Shape um `prUrl: string` und `prNumber: number` erweitert.
  - **Frontend** — `addLookthroughPoolIsin` in `src/lib/admin-api.ts` (~Zeile 187) übernimmt die neuen Pflichtfelder im Return-Type. `LookthroughPoolPanel` (`Admin.tsx` ~Zeile 1146) bekommt einen neuen `lastPr`-State; der Erfolgs-Toast zeigt jetzt `PR #N geöffnet für {ISIN}` mit „Öffnen"-Action-Button (öffnet GitHub-Tab); ein zusätzliches grünes Inline-`Alert` (Test-IDs `alert-pool-pr-success` und `link-pool-pr-{ISIN}`) erklärt unmissverständlich, dass die ISIN erst nach Merge + Redeploy in Tabelle und Methodology-Tausch-Ansicht erscheint. Der erläuternde Intro-Absatz oberhalb des ISIN-Eingabefelds wurde entsprechend umformuliert (vorher: „Ein App-Neustart ist nötig …"; nachher: explizite Beschreibung des PR → Merge → Redeploy-Workflows mit den beiden konkreten UI-Stellen, an denen das Ergebnis sichtbar wird).
  - **Was bewusst nicht geändert wurde** — die `pool`-Sektion bleibt vom monatlichen `lookthrough-refresh`-Job weiterhin Live-überschrieben (das ist der Sinn dieser Sektion); curated `overrides` bleibt geschützt und wird vom Schreibpfad nie angefasst. Der Frontend-Build-Time-Bundle-Mechanismus bleibt unverändert (kein Runtime-Fetch eingeführt) — er ist die Single Source of Truth, sobald der PR gemerged ist.
  - **Tests / Validierung** — keine bestehenden Tests verändert (alle E2E- und Unit-Selektoren auf `data-testid` greifen nach wie vor). 330 / 330 Vitest-Tests grün, Typecheck clean, E2E 2 / 2.

### 2026-04-27 (admin-de-translation-builtin-display-pool-list)
- **Drei kleine Verbesserungen am `/admin`-Bereich** auf Operator-Wunsch: (1) komplette deutsche Übersetzung der noch englischen UI-Strings, (2) sichtbare Anzeige der Built-in-Defaults neben jedem Editor-Feld der "Globale Defaults"-Karte, (3) Anreicherung der Look-through-Datenpool-Liste um ETF-Name und ein Status-Badge pro Eintrag.
  - **Übersetzung** — alle verbleibenden englischen UI-Texte in `src/pages/Admin.tsx` ins Deutsche überführt: Header (`Operator-Bereich`, `Abmelden`), Token-Prompt (`Admin-Anmeldung`, `Admin-Token`, `Anmelden`), `BrowseBucketsPanel` (`Bestehende Buckets durchsuchen`, `Anzeigen` / `Verbergen`, `Lade …`, `Namens­konvention …`), `SuggestIsinPanel` + `PreviewEditor` (`ISIN vorschlagen`, `Vorschau`, `Auf justETF ansehen`, `Katalog-Key`, `Domizil`, `Währung`, `Replikation`, `Ausschüttung`, `Auflagedatum` / `JJJJ-MM-TT`, `Standard-Börse`, `AUM (Mio. EUR)`, `Kommentar (wird in Tooltips angezeigt)`, `Listings (Ticker je Börse)` / `(keine)`, `PR wird geöffnet …`, `PR öffnen: bestehenden Eintrag ersetzen` / `PR öffnen: zum Katalog hinzufügen`, `ISIN-Konflikt oben beheben, um fortzufahren`), `DiffPanel` (`Katalog wird geladen …`, `Doppelte ISIN`, `Neuer Bucket`, `Ersetzt bestehenden Eintrag`, Spaltenköpfe `Feld` / `Aktuell (im Katalog)` / `Vorgeschlagen (dieser PR)`, der Override-Layer-Hinweis), `GeneratedCodeDisclosure` (`Generierten Code anzeigen` / `verbergen`, `Wird gerendert …`), `DataUpdatesColumn` + `FreshnessCard` + `RecentChangesCard` + `RecentRunsCard` (`Aktualisieren`, `Datenaktualität`, `Aktuelle Datenänderungen`, `Letzte Läufe`, `Noch keine Läufe protokolliert.`), Toasts (`Pull-Request geöffnet` / `Öffnen`, `{key} kopiert`). Sämtliche `data-testid`-Attribute bleiben unverändert — Tests greifen ausschließlich darauf zu, weshalb keine bestehenden Test- oder E2E-Selektoren angefasst werden mussten.
  - **Built-in-Werte sichtbar in der Globale-Defaults-Karte** — `BUILT_IN_RF` (`src/lib/settings.ts:35`), `BUILT_IN_HB` (`src/lib/settings.ts:292`) und `BASE_SEED` (`src/lib/metrics.ts:43`) werden jetzt exportiert (waren vorher modul-private Konstanten). Die `AppDefaultsPanel`-Sektionen rendern unter jedem RF- / HB-Eingabefeld eine `text-[10px]`-Mono-Caption (`Built-in: 4.250 %` bzw. `Built-in: 1.0×`) und in der CMA-Tabelle eine zusätzliche Spalte `Built-in μ / σ` (`μ 7.0% / σ 16.0%` etc.). Die Eingabefelder bekommen jeweils den Built-in-Wert als HTML-`placeholder` — leere Felder zeigen den Fallback also schon optisch an. Neue stabile Test-IDs: `builtin-rf-{USD|EUR|GBP|CHF}`, `builtin-hb-{USD|EUR|GBP|CHF}`, `builtin-cma-{assetKey}`. Keine Engine- oder Default-Werte verändert — reine Anzeige.
  - **Look-through-Datenpool — angereicherte Tabelle** — `LookthroughPoolPanel` nimmt jetzt das `catalog`-Prop entgegen (`Admin.tsx:166`) und baut daraus per `useMemo` ein `Map<ISIN, {key, name}>`. Die Tabelle wurde um zwei Spalten erweitert: **Status** (Badge mit `border-emerald|amber|rose-600`-Tönen) und **Name (Katalog)** (Name + Bucket-Key oder italic `— nicht im Katalog`); die ISIN-Spalte zeigt zusätzlich zur ISIN keine Daten mehr ohne Kontext. Die Status-Heuristik in der neuen reinen Funktion `computePoolStatus(entry)` (Zeile 1128) liefert `{tone, label}`: `Daten OK` ⇔ `topHoldingCount > 0 && geoCount > 0 && sectorCount > 0` UND letzter Scrape ≤ 60 Tage alt; `Veraltet` ⇔ alle drei Quellen vorhanden, aber Scrape älter als 60 Tage; `Daten fehlen` ⇔ mindestens eine Quelle leer. Über der Tabelle erläutert ein kurzer Hinweis-Block die drei Zustände inline mit Badges. Neue Test-IDs: `row-pool-{ISIN}` und `badge-pool-status-{ISIN}`.
  - **Architect-Review-Folge-Fixes** — (a) verbleibende englische Strings in `Admin.tsx` deutsch gemacht: Kartentitel jetzt `Globale Defaults (Risikoloser Zins / Home-Bias / Kapitalmarkt­annahmen)`, CMA-Tabellenkopf `Anlageklasse / Built-in μ / σ / Erw. Rendite % / Volatilität %`, Pool-Spalte `Holdings → Positionen`, Policy-Fit-Badges `Fail → ungenügend`. (b) Edge-Case in `computePoolStatus`: ein fehlender oder unparsbarer `topHoldingsAsOf`/`breakdownsAsOf` wird jetzt als `Veraltet` (statt `OK`) klassifiziert — wir können die Frische ohne validen Zeitstempel nicht garantieren.
  - **Bugfix: Globale-Defaults-Editor verschluckte Komma-Eingaben stillschweigend.** Operator meldete „ich denke ich bin genau so vorgegangen" beim Versuch CMA-Werte zu submitten. Ursache: `parsePct`/`parseNum` in `AppDefaultsPanel` (`Admin.tsx:1711`) verwendeten `Number(s)`, das **ausschließlich Punkt** als Dezimaltrennzeichen akzeptiert — `Number("7,5")` liefert `NaN`. Im deutschen Browser-Locale tippt der Operator natürlicherweise `7,5` → das Feld wurde als „leer" interpretiert → der `touched`-Counter blieb 0 → der PR enthielt nur einen `_meta`-Update ohne CMA-/RF-/HB-Werte, **ohne dass der Operator irgendeinen Hinweis bekam**. **Fix**: neuer pure-Helper `parseDecimal(s)` normalisiert Komma → Punkt (`s.replace(",", ".")`) und gibt einen dreiwertigen Status zurück (`number` | `"invalid"` | `undefined`); `parsePct` baut darauf auf. `buildPayload()` gibt jetzt zusätzlich `invalidFields: string[]` zurück (mit menschenlesbaren Feldnamen wie `"CMA Globale Aktien (entwickelt) → Erw. Rendite"`). `onSubmit` (a) bricht mit explizitem Toast ab, wenn ein Feld unparsbar ist (Liste der ersten 5 Feldnamen), (b) öffnet bei `touched === 0` einen `window.confirm`-Dialog (verhindert versehentliches Wegspülen aller Overrides), (c) zeigt im Erfolgs-Toast jetzt die Anzahl tatsächlich übermittelter Felder an. Keine Änderung am Server, an Default-Werten oder Engine-Logik. Eine spätere Arbeit könnte die Helpers extrahieren und mit `parseDecimalInput` aus `manualWeights` konsolidieren.
  - **Bugfix: Look-through-Datenpool zeigte 0 statt 11 ETFs.** Operator meldete „ich habe einige im Pool, sehe aber keine?". Ursache: `lookthrough.overrides.json` hat zwei gleich strukturierte Sektionen — `overrides` (manuell kuratierte Baseline, Repo-eingecheckt — hier liegen die 11 ETFs) und `pool` (vom monatlichen Refresh-Job geschriebene Live-Daten — derzeit leer). Der Admin-Endpoint `GET /api/admin/lookthrough-pool` las bislang **nur** `pool` und lieferte daher konstant `[]`. **Fix**: neuer Helper `readLookthroughSources()` liefert beide Sektionen; die Route vereinigt die ISIN-Mengen (Set-Union) und reichert jeden Eintrag um ein `source`-Feld an (`"overrides"` | `"pool"` | `"both"` — bei Kollisionen gewinnt inhaltlich `pool`, weil frischer). Die alte `readLookthroughPool()`-Funktion bleibt für die Schreibroute `POST /api/admin/lookthrough-pool/:isin` erhalten — der Operator-Schreibpfad darf weiterhin nur in `pool` schreiben (nie in die kuratierte Baseline). **UI**: neue Spalte „Quelle" mit Badge `Kuratiert` (slate) / `Auto-Refresh` (sky) / `Beide` (violet); Status-Legende über der Tabelle erklärt beide Quellen. Frontend-Type `LookthroughPoolEntry` (in `admin-api.ts`) bekam das neue Pflichtfeld `source`. Neue Test-ID: `badge-pool-source-{ISIN}`.
  - **Tests / Validierung** — keine bestehenden Tests verändert, da alle Selektoren auf `data-testid` basieren. 330 / 330 Tests grün, Typecheck clean (zwei Pakete), E2E 2 / 2.

### 2026-04-27 (admin-app-defaults-presets)
- **Vorlagen ("Preset-Sets") für die Globale-Defaults-Karte.** Operators can now load a pre-canned configuration into the `/admin` Globale-Defaults editor with a single click instead of typing every number by hand. New module `src/lib/appDefaultsPresets.ts` exposes a registry of named presets and a pure `applyPresetToFields(preset, current)` helper used by the panel. The dropdown only sets the selected preset; an explicit **"Vorlage anwenden"** button performs the merge into the editor fields, and **"Aktuelle Werte neu laden"** discards any manual edits and re-fetches the server state. Applying a preset never auto-submits — the operator can still tweak fields, then writes the actual PR through the same `POST /admin/app-defaults` endpoint that already validates strictly server-side.
  - **Preset shape**: `{ id, label, description, clear?: ('rf'|'hb'|'cma')[], payload?: AppDefaultsPayload }`.
  - **Application semantics** (two phases, in order, per RF / HB / CMA section):
    1. **Clear**: every section listed in `clear` is wiped to all-empty fields.
    2. **Merge**: each key in `payload` overwrites the matching editor field; keys that the payload does NOT mention stay as they are (after phase 1). For CMA the merge is per-key AND per-attribute, so a preset that sets only `expReturn` for a given asset leaves that asset's `vol` untouched.
  - This composes cleanly: a preset can wipe a whole section (`clear: ['rf']` + no `payload`), set one or two values without touching anything else (just `payload`), or do both ("clear RF then set USD/EUR/GBP/CHF" — the canonical "scenario" preset shape).
  - **Shipped presets** (5):
    - `reset-builtin` — "Built-in-Defaults wiederherstellen". `clear: ['rf','hb','cma']`, no payload → submitting this clears every global override and reverts to the in-code built-ins.
    - `rf-low-rate` — "Niedrigzins-Umfeld (Beispiel)". `clear: ['rf']` + RF payload USD 1.0 % / EUR 0.5 % / GBP 1.0 % / CHF 0.0 %.
    - `rf-high-rate` — "Hochzins-Umfeld (Beispiel)". `clear: ['rf']` + RF payload USD 5.5 % / EUR 4.0 % / GBP 5.25 % / CHF 1.75 %.
    - `hb-global` — "Home-Bias neutral / global (Beispiel)". `clear: ['hb']` + HB payload set to 1.0 across all currencies (no home tilt).
    - `cma-conservative-equity` — "Konservative Equity-CMA (Beispiel)". Payload only (no clear): equity `expReturn` ~1.5 pp below built-in across US/EU/UK/CH/JP/EM/Thematic + REITs. Volatilities and bonds/cash/gold/crypto are NOT in the payload, so they remain whatever the editor showed before the preset was applied — matching the description text exactly.
  - **Tests** — 15 cases in `tests/app-defaults-presets.test.ts` enforce both **registry validity** (ids unique kebab-case, non-empty label & ≥20-char description, every payload value passes the frontend sanitiser unchanged so the backend strict validator can never reject it, only whitelisted RF/HB/asset keys, all values within the documented bounds RF [0, 0.20] / HB [0, 5] / CMA mu [-0.5, 1] / vol [0, 2]) and **`applyPresetToFields` semantics** (reset wipes everything; RF preset replaces RF and leaves HB/CMA alone; CMA preset preserves vol + non-equity rows; HB preset sets all currencies to 1; custom `clear`-only blanks listed sections; `clear` + `payload` does clear-then-merge in that order; payload-only preserves untouched keys including manual edits). Total 330 / 330 (was 315), typecheck clean for both packages, e2e 2/2 green.

### 2026-04-27 (admin-app-defaults)
- **New "Globale Defaults" admin section.** The Methodology editor (per-user, localStorage) now has a server-backed counterpart at `/admin`. Operators can edit the ship-wide defaults for **Risk-Free Rates**, **Home-Bias multipliers**, and **CMA** (expReturn / vol per asset) and submit them via a single GitHub PR. After merge + redeploy the values become the new built-in defaults for **all** users, while per-user Methodology overrides keep layering on top — same priority ladder as before, just with one additional rung between built-in and consensus.
  - **Storage** — new file `artifacts/investment-lab/src/data/app-defaults.json` (initially empty `{}`). Bundled at build time, so the frontend stays static (no runtime API call to render the app). Layout: `{ _meta, riskFreeRates?, homeBias?, cma? }` with each section partial — only set values override built-in defaults.
  - **Frontend hydration** — new module `src/lib/appDefaults.ts` exports a defensively-sanitised `APP_DEFAULTS` (drops unknown currencies, unknown asset keys, out-of-range values). `settings.ts`'s `RF_DEFAULTS` and `HOME_BIAS_DEFAULTS` and `metrics.ts`'s `CMA_SEED` are now built as `BUILT_IN_xxx merged with APP_DEFAULTS.xxx` at module load. The Methodology editor reads the same constants, so its "Default" column already shows the live shipped value.
  - **Backend** — new `lib/app-defaults.ts` in api-server with strict `validateAppDefaults` (returns explicit errors instead of silently dropping), `renderAppDefaultsFile` (2-space indent + trailing newline), and `stampMeta` (sets `_meta.lastUpdated`/`lastUpdatedBy` server-side so the operator cannot forge a date). New `openUpdateAppDefaultsPr` in `lib/github.ts` performs whole-file replacement (safe for JSON) on a per-call branch `update-app-defaults/<epoch>-<rand6>` (epoch + 6-char random suffix so two requests in the same millisecond cannot collide). New routes `GET /admin/app-defaults` (returns current on-disk content, re-validated) and `POST /admin/app-defaults` (validates → stamps → opens PR → returns `{prUrl, prNumber}`).
  - **Admin UI** — new `AppDefaultsPanel` card on `/admin` with three editor tables (RF, Home-Bias, CMA), preloaded from `getAppDefaults()`. Inputs are in the same units as the Methodology editor (% for RF / CMA, multiplier for Home-Bias). Empty fields = "no override → built-in default applies". A required summary input populates the PR title. Submitting an entirely empty payload is intentionally allowed — that is the operator's path to wipe all global overrides and revert to the pure built-in defaults. Surfaces the resulting PR URL on success; shows a 503 banner when GitHub credentials are missing.
  - **Tests** — 12 new cases in `tests/app-defaults.test.ts` covering the frontend sanitiser (happy path + defensive drops including the bug it caught: an asset-key whitelist was missing in v0 of the loader), and 17 new cases in `tests/api-app-defaults.test.ts` covering the backend strict validator (good shapes + every error class) and the `renderAppDefaultsFile` / `stampMeta` helpers. Total 315 / 315 (was 286), typecheck clean for both packages.

### 2026-04-27 (justetf-fetch-retry-backoff)
- **All justETF live fetches now retry transient failures with exponential backoff before flipping the workflow red.** The 2026-04-26 morning smoke run was the trigger — extractors still matched the live markup (a manual rerun five hours later was fully green) but a single 429 / 503 from one of the three canary fetches turned the scheduled job red. The same brittleness affected the manual `Refresh ETF listings` run that came back as `partial` (16 OK / 4 fail) for the same reason.
  - **`scripts/lib/justetf-extract.mjs`** — new exported `fetchWithRetry(url, init, opts)` helper. Policy: retry on **HTTP 429** (Too Many Requests), any **5xx** (server-side), and any thrown network error (DNS / TCP / TLS / abort). Do NOT retry on other 4xx (404, 403) so real not-found / forbidden still fails loudly. Backoff = `baseDelayMs × 2^attempt + Random(0, 500ms)`, capped at `maxDelayMs`. Honours the `Retry-After` response header (integer seconds OR HTTP-date) when justETF sends one. Defaults: `retries = 3`, `baseDelayMs = 2 000`, `maxDelayMs = 30 000` → worst case ≈ 14 s wait per URL, well under the 6-min Actions step timeout. `onRetry` callback hook lets each caller log retry attempts without a shared logger dependency. `fetchImpl` parameter is a test seam — defaults to global `fetch` in production, lets unit tests inject fakes without monkey-patching the global.
  - **`scripts/lib/justetf-extract.mjs#fetchProfile`**, **`scripts/refresh-lookthrough.mjs#fetchProfile`** + **`#fetchBreakdownAjax`**, and **`scripts/smoke-justetf.mjs#fetchProfile`** — all four call sites now route through `fetchWithRetry` with an `onRetry` hook that logs each retry attempt (`! ISIN: ... attempt N/M failed (...), retrying in Xs`) so a slow-rolling justETF degradation is still visible in the run log.
  - **Tests** — 8 new cases in `tests/scrapers.test.ts#fetchWithRetry`: returns immediately on 200, retries on 429 / 503 / thrown network errors, does NOT retry on 404 / 403, gives up after `retries` attempts and surfaces the last error, fires the `onRetry` hook with 1-indexed attempt metadata. Uses `fetchImpl` injection with `baseDelayMs: 0` so the suite stays fast. Total 281 / 281 (was 273); typecheck clean; live smoke check still green.

### 2026-04-26 (welle-1-cfa-methodology-upgrades)
- **Three CFA-/institutional-grade methodology upgrades shipped together as "Welle 1": (1) CVaR / Expected Shortfall in Monte Carlo, (2) Building-Block CMA decomposition, (3) Reverse Stress Test.** All three are pure additions on top of the existing rule-based engine — no existing weights, defaults, or test outputs change. The goal is *transparency* and *tail-aware risk*, the two areas where the previous build trailed institutional reporting standards (CFA, Solvency II, Basel).
  - **(1) CVaR / Expected Shortfall — `src/lib/monteCarlo.ts`.** `MonteCarloResult` gained four new fields: `cvar95Final`, `cvar95Return`, `cvar99Final`, `cvar99Return`. New helper `cvarTail(q)` averages the worst `(1 − q)` slice of the already-sorted `sortedFinals` array, so the cost is one extra mean over `N × 0.05` (≈ 100 paths at the default 2 000) — negligible vs the Cholesky pre-step. Implementation note: `k = max(1, floor(N × (1 − q)))` so the worst path is always included even at `N = 20`. Returns are computed as `cvarFinal / initial − 1`, matching the existing `finalP10/P50/P90` convention. **`MonteCarloSimulation.tsx`** added a red-bordered tail-risk row (Flame icon) between the P10/P50/P90 row and the chart, showing CVaR(95) and CVaR(99) both as currency and as horizon return, with a one-line description that calls out the difference vs P10 (threshold) and references CFA / Solvency-II / Basel as the standard tail-loss metric. EN/DE i18n keys added (`mc.tail.{title, cvar95, cvar99, desc}`).
  - **(2) Building-Block CMA decomposition — `src/lib/metrics.ts`.** New `BuildingBlock` / `BuildingBlocks` interfaces and a `CMA_BUILDING_BLOCKS: Record<AssetKey, BuildingBlocks>` constant decomposing the 12 asset-class seed expReturns into observable institutional components: equity → dividend yield + net buyback yield + real EPS growth + inflation + valuation drift (DDM-style); bonds → YTM + roll-down − expected credit loss; cash → short-term policy rate; gold → real return + inflation pass-through + crisis-hedge premium; REITs → net income yield + real NOI growth + inflation; crypto → pure speculative drift. Components are tuned per region/asset (e.g. US `−0.4 %` valuation drift vs UK `−1.1 %` reflecting starting valuations; Japan TSE PBR-1 reform raises buyback yield; CH lower inflation pulls the nominal anchor down) and sum within ≤ 50 bps of the seed. New `sumBuildingBlocks(key)` helper exposed for the UI. The decomposition is **read-only documentation** — the engine still consumes `CMA[k].expReturn` directly; editing the CMA in the UI does NOT retro-fit the components, by design (components describe the seed and live in the Methodology tab so the user can audit *why* each default has the value it does, in line with how JPM LTCMA, BlackRock, Research Affiliates, GMO disclose). **`Methodology.tsx`** added a `cma-building-blocks` accordion item inside the existing CMA section, after the "Per asset class notes" item. Renders one bordered card per asset with the seed `μ` shown in the corner, a 2-column component table (component label · contribution %), a sum row that flags any rounding `Δ` > 0.05 %, and an italic source-note line. Negative components (e.g. valuation drift, credit loss) render in `text-destructive`. EN/DE i18n keys: `bb.section.{title,desc}`, `bb.col.{component,value,sum,seed,delta}`, `bb.equity.{div,buyback,realGrowth,inflation,valuationDrift}`, `bb.bonds.{ytm,roll,creditLoss}`, `bb.cash.rate`, `bb.gold.{real,inflation,hedge}`, `bb.reits.{income,realGrowth,inflation}`, `bb.crypto.drift`, plus `bb.src.<assetKey>` source notes for all 12 assets.
  - **(3) Reverse Stress Test — `src/lib/scenarios.ts`.** New `runReverseStressTest(allocation, targetLoss = -30, baseCurrency?)` returns the closed-form solution for "what would have to happen for the plan to break?". Two complementary views: (a) **Scenario-multiplier view** — for each historical SCENARIO, solve for the scalar `λ ≥ 0` such that `λ × baselineTotal = targetLoss`. Since the portfolio total is linear in `λ` for a fixed allocation, this is `λ = targetLoss / baselineTotal` whenever `baselineTotal < 0`; otherwise null (no positive scaling can produce a loss from a non-negative scenario). `alreadyExceeds = (multiplier !== null && multiplier < 1)` flags scenarios that are already worse than the user's pain threshold at λ = 1. (b) **Single-factor equity-only view** — what uniform shock applied to all `assetClass === "Equity"` sleeves alone (bonds / cash / gold / etc. unchanged) is needed to hit the target loss: `shock = targetLoss / (equityWeight / 100)`. Returns null when the portfolio carries no equity. Both are O(allocation × scenarios) and recomputed on every render via `useMemo`. **`StressTest.tsx`** added an amber-bordered subsection (Search icon) above the existing scenario chart with a target-loss input (text-buffer pattern, `parseDecimalInput` clamped to `[-99.9, -0.1]`, default `-30`) and a 3-column table showing scenario · baseline (×1.0) · required-multiplier; equity-only row at the bottom with the equity weight share and the uniform shock. Uses badge `destructive` for `alreadyExceeds`, italic muted text for `noLoss` / `noEquity` / `impossible` (shock < -99.9 %). EN/DE i18n keys: `stress.reverse.{title,desc,targetLabel,driver,baseline,required,equityOnly,equityWeightSuffix,alreadyExceeds,noLoss,noEquity,impossible}`.
  - **Methodology tab — `t` is now destructured from `useT()` alongside `lang`** (was: `lang` only). Required for the new building-block accordion to consume i18n keys via `t(...)`.
  - **Tests** — 7 new cases added to `tests/engine.test.ts`: (a) MC CVaR(95) / CVaR(99) populated, finite, ordered (CVaR(99) ≤ CVaR(95) ≤ P10) for a 100 % USA equity allocation; (b) building-blocks sum within 50 bps of every seed expReturn and every component carries a `bb.*` key + finite value + `bb.src.*` source; (c) reverse stress 60/40 vs GFC at -30 % — multiplier reconstructs target within 0.5 %; (d) equity-only shock = `target / (equityWeight/100)`; (e) bonds-only allocation returns `null` equity-only shock and 0 % equity weight; (f) 100 % cash returns `null` multipliers because no scenario is negative for it; (g) `alreadyExceeds` flag exactly matches `multiplier < 1`. Suite now at 273 / 273 passing; typecheck clean.

### 2026-04-26 (gbp-uk-equity-carve-out)
- **GBP base now treats UK equity as a first-class bucket, mirroring the existing CHF → Switzerland carve-out — but the home-bias *multiplier* itself is intentionally left at the existing 1.5.** The home market for a GBP investor (FTSE-100 / MSCI UK) gets its own market-cap anchor slot, its own ETF row (`Equity-UK`, `IE00B53HP851` — already in the catalog), its own row in the consolidation home-key map, and its own slice of the ACWI benchmark. Previously the GBP home tilt routed into the broad `Equity-Europe` bucket, so a UK-specific FTSE-100 sleeve was unreachable through the engine. The scope is structural — give UK its own bucket / ETF / anchor — without changing the magnitude of the tilt that the user has been seeing.
  - **`src/lib/portfolio.ts`** — added `MCAP_ANCHOR_GBP = { USA 0.60, Europe 0.10, UK 0.04, Japan 0.05, EM 0.11 }` (structurally identical to `MCAP_ANCHOR_CHF`, only the carved-out region differs). Replaced the inline `baseCurrency === "CHF" ? CHF : DEFAULT` ternary with an `ANCHOR_BY_BASE: Record<BaseCurrency, …>` lookup table so the per-currency anchor selection scales cleanly. `HOME_TILT_REGION.GBP` flipped from `"Europe"` → `"UK"`. `REGION_TO_CMA` gained `UK → equity_uk`. The §4.5 consolidation `equityRegionKeys` and `homeMap.GBP` updated to include / point at `Equity_UK`.
  - **`src/lib/metrics.ts`** — new `equity_uk` `AssetKey` with seed CMA `(μ 6.5 %, σ 15 %)` (FTSE 100: dividend-heavy, slightly lower expected return than broad-Europe but lower vol; sits between CH and EU on both axes). New correlation row in `C` — UK / EU 0.85 (highly co-moving developed European markets), UK / US 0.78, UK / CH 0.72, UK / JP 0.55, UK / EM 0.62, UK / thematic 0.65, UK / bonds 0.10, UK / gold 0.10, UK / REITs 0.65, UK / crypto 0.25. `mapAllocationToAssets` recognises `region === "UK"` (or `"United Kingdom"`); `CORR_DISPLAY_ORDER` and the frontier `equityKeys` include `equity_uk`. **`BENCHMARK` rebalanced** to `{ US 60, EU 14, UK 4, CH 4, JP 4, EM 14 }` so the ACWI proxy carves UK out of broad-Europe (was `{ US 60, EU 18, CH 4, JP 4, EM 14 }`). Total still 100 %.
  - **`src/lib/settings.ts`** — left untouched. `HOME_BIAS_DEFAULTS.GBP` stays at `1.5`; the home-tilt multiplier is unchanged. The deliberate scope is "give UK its own bucket and its own ETF" — the magnitude of the tilt remains the user-editable per-currency multiplier and is not altered by this carve-out.
  - **`src/lib/monteCarlo.ts`** — `bucketKey` recognises UK regions; `bucketAssumption.homeKey` map gained `GBP → equity_uk` so a GBP investor holding a hedged UK sleeve no longer gets the foreign-equity FX-hedge sigma cut applied to it.
  - **Methodology tab** — anchor table grew from 3 columns (USD/EUR/GBP | CHF) to 4 (USD/EUR | GBP | CHF) with a UK row; the surrounding prose now reads "For CHF and GBP portfolios, the home market is carved out of Europe into its own bucket". The CMA "where used" helpers (`noteFor`, `regionFromKey`, `regionLabel`) gained `equity_uk` rows; the Europe label updated from "Europe (ex CH)" → "Europe (ex CH/UK)".
  - **DOCUMENTATION.md** — §4.2 anchor table now has a GBP column and a UK row; §4.5 home-key map text mentions `GBP → UK`; the home-tilt constants table shows `GBP → United Kingdom × 1.5` (unchanged).
  - **`src/lib/scenarios.ts`** — added `Equity_UK` shock entries to all three historical scenarios (GFC `-41`, COVID Q1 `-25`, 2022 Rates Shock `-2` — the FTSE 100's energy/value tilt outperformed materially in 2022 vs broad EU/US). Added a `region === "UK" | "United Kingdom"` resolver branch (falls back to `Equity_Europe` then `Equity_Global`). The `region === "Home"` branch (used by §4.5 compaction) now takes an optional `baseCurrency` argument and routes via `HOME_SHOCK_KEY` (USD→`Equity_USA`, EUR→`Equity_Europe`, GBP→`Equity_UK`, CHF→`Equity_Switzerland`); legacy single-arg callers fall back to `Equity_USA`. `runStressTest` and `StressTest.tsx` plumb `baseCurrency` through; `BuildPortfolio.tsx` and `ComparePortfolios.tsx` pass it from the form / inputA / inputB.
  - **`src/lib/aiPrompt.ts`** — added a GBP branch (EN + DE) to the `coreLines` list. GBP prompts now read "Equities by region: USA, Europe ex-UK, United Kingdom (UK), Japan, and Emerging Markets" / "USA, Europa ex-UK, Vereinigtes Koenigreich (UK), Japan und Schwellenlaender", matching the engine's actual region split (mirror of the existing CHF special-case).
  - **DOCUMENTATION.md** — §4.2 anchor table now has a GBP column and a UK row; §4.5 home-key map text mentions `GBP → UK`; §4.7 ETF mapping splits `EUR → Equity-Europe`, `GBP → Equity-UK`; §10 test-catalog principled-construction summary lists the GBP→UK home tilt; the home-tilt constants table shows `GBP → United Kingdom × 1.5` (unchanged).
  - **Tests** — six engine/scenario surfaces touched: (a) the existing concentration-cap test gained `"UK"` to its swept regions list; (b) the home-bias-overlay test changed its GBP assertion from `gbp.Europe > usd.Europe` to `gbp.UK > 0 ∧ usd.UK == 0 ∧ eur.UK == 0` (mirrors the existing CHF / Switzerland assertion); (c) the `benchAlloc` reference in the β ≈ 1 test was updated to the new BENCHMARK shape (added a UK 4 % row, dropped Europe 18 → 14); (d) the AI-prompt CHF-only-carve-out test was tightened to USD/EUR (no longer asserting GBP carries the generic phrasing) and a new GBP-specific carve-out test was added (EN + DE). Three brand-new regression tests added: (1) `GBP base produces a separate Equity-UK bucket and ETF` — asserts the GBP allocation has an Equity-UK row that picks the FTSE-100 tracker (`IE00B53HP851`); (2) `CMA whitelist accepts equity_uk overrides` — asserts UK CMA overrides survive `CMA_VALID_KEYS` filtering; (3) `UK equity sleeve picks up the dedicated Equity_UK shock` and `compacted Home equity row picks up the home-currency shock` — assert UK shocks flow through both the dedicated UK region and the §4.5 compacted Home row, for all four base currencies. Suite at 266 / 266 passing; typecheck clean.

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

### 2026-05 (manual-entries-identity — Task #292)
- **Manual entries in the Explain tab now have a stable identity (UID) and support off-catalog ISIN look-through.**
  - **Stable Identity:** Each manual position row now carries a unique `uid`. This ensures that deleting a middle row no longer causes the UI to incorrectly reconcile state onto the remaining rows.
  - **Off-catalog ISIN Look-through:** Manual positions with ISINs not found in the catalog now show a look-through button if the ISIN format is valid. The `ETFDetailsDialog` was updated to handle these "synthesized" ETFs, allowing users to see look-through data even for manual entries.
  - **Implementation Details:**
    - `PersonalPosition` gained an optional `uid`.
    - `generatePositionUid()` and `ensurePositionUid()` helpers added to `src/lib/personalPortfolio.ts`.
    - All position row creators (manual, imported, hydrated) now stamp a UID.
    - `detailsEtfForRow` synthesizes a minimal `ETFImplementation` for off-catalog ISINs.
- **Tests:** Two new e2e cases in `tests/e2e/explain-portfolio.spec.ts` cover middle-row deletion and off-catalog look-through.

- **AI prompt now also asks for an Explain-import block (section I).** Added a new output section `I) ETF implementation import file for the Investment Decision Lab "Explain my Portfolio" tab` (DE: `I) ETF-Umsetzungs-Importdatei fuer den Tab "Mein Portfolio erklaeren" des Investment Decision Lab`) to both `buildPromptEn` and `buildPromptDe` in `src/lib/aiPrompt.ts`. The section instructs the LLM to emit a plain-text block (no table, no markdown fences) with one position per line in the format `ISIN;weight` — weight as a plain number without `%`, dot decimal separator, no header row, weights summing to 100. Same per-instrument validation list (constraint 11) was switched from `1.…5.` to `a)…e)` to avoid visual collision with the outer 1–13 numbering.
- **Tests:** `tests/engine.test.ts` — the `always emits the full output-format scaffold (sections A-H + closing)` spec now also asserts the new `I)` marker, and a new bilingual spec (`includes the Explain-import file section I) in EN + DE`) checks the section header, the `ISIN;weight` literal, and the "sum to 100" wording in both languages. The hedging/synthetic toggle spec was tightened to also pin the new `7.` and `9.` constraint numbers. Engine suite: 441 passed / 2 pre-existing skips. Typecheck clean.

### 2026-05 (copy-ai-prompt-rewrite — Task #261)
- **Copy AI Prompt template restructured (EN + DE).** The prompt produced by `buildAiPrompt` in `src/lib/aiPrompt.ts` now matches the user-provided wording revision:
  - **Commodities / Precious Metals moved into the Core asset classes block** (when `includeCommodities` is true) instead of being listed under Satellites. The Satellites block now only collects Listed Real Estate (REITs) and Crypto Assets when their toggles are on, and falls back to "Satellites: none requested by the investor." / "Satelliten: vom Anleger nicht gewuenscht." when neither is selected.
  - **Constraints renumbered from 1–15 to 1–13.** Old items 6 (cost efficiency), 7 (no tactical forecasts), 8 (rules-based decision) and 9 (sensible assumptions) were dropped. Home bias is now constraint 6, hedging 7, look-through 8, synthetic 9, broad-diversification 10, English/Deutsch 13. The two new MANDATORY blocks are constraint 11 ("Critical ETF validation requirement (MANDATORY)" / "Kritische ETF-Validierungsanforderung (VERPFLICHTEND)" — verification sources, 5-step per-instrument checks, fallback wording) and constraint 12 ("Final consistency checks (MANDATORY)" / "Abschliessende Konsistenzpruefungen (VERPFLICHTEND)" — unique ISINs, currently active/tradable, exchange preference respected or exception explained).
  - **Output A) header expanded** — Table 1 group header is now `Group: Cash, Bonds, Equities, Commodities, Satellites` (DE: `Gruppe: Cash, Anleihen, Aktien, Rohstoffe, Satelliten`) and the "Percentage allocation per group" sentence sums across the same five groups. The old parenthetical that routed commodities/REITs/crypto into Satellites and thematic into Equities was removed.
  - All existing dynamic substitutions still work (`baseCurrency`, `riskAppetite`, horizon label, equity range, exchange line, ETF count range, home-bias label, hedging/look-through/synthetic conditional lines, satellites toggles, thematic equity tilt). Sections B–H and the closing disclaimer instruction are unchanged. German variant uses the same plain-ASCII style (no umlauts) as the rest of `aiPrompt.ts`.
  - **Tests:** `tests/engine.test.ts → describe("AI Prompt builder (buildAiPrompt)", …)` updated. The "includes / excludes satellite asset classes" test now asserts Commodities appears BEFORE Satellites and that the dropped Output-A parenthetical does not creep back in. Three new specs cover (a) Commodities-on placing the bullet inside the Core block in both languages with the empty-Satellites fallback, (b) the two new MANDATORY blocks (`Critical ETF validation requirement (MANDATORY)` / `Final consistency checks (MANDATORY)` and the German equivalents) plus the absence of the dropped EN+DE constraints, (c) the new five-group Table 1 headers in EN and DE, and the satellites-toggle test now asserts a Crypto-only `Satellites:\n- Crypto Assets` / `Satelliten:\n- Krypto-Assets` block.
  - Validation: `pnpm run typecheck` and `pnpm --filter @workspace/investment-lab run test:engine` both green (440 / 442 with 2 pre-existing skips). Pure text/template change — engine, MC, look-through and UI controls untouched. Methodology page does not document the AI-prompt template, so the methodology-sync rule does not trigger.

### 2026-05 (fixed-income-alts-lookthrough — Task #249)
- **Look-through profiles added for the four Fixed Income alternative ISINs** (`LU0378818131`, `IE00BG47KH54`, `IE00BG47KB92`, `LU0290355717`) so `validateLookthroughCoverage()` no longer reports gaps and the engine test suite is green again.
  - **`SHARED_BASKET_PROFILES` (src/lib/lookthrough.ts):** `IE00BG47KH54` (Vanguard Global Aggregate Bond EUR Hedged Acc) and `IE00BG47KB92` (Vanguard Global Aggregate Bond EUR Hedged Dist) added as `variantOf("IE00B3F81409", { currency: { EUR: 98, USD: 2 } })` — both track the Bloomberg Global Aggregate, identical underlying basket to the iShares default, currency re-denominated to EUR by the hedge.
  - **`DISTINCT_PROFILES` (src/lib/lookthrough.ts):** `LU0378818131` (Xtrackers II Global Government Bond UCITS) added as a sovereign-only global bond aggregate (excludes corporates / securitised; geo + currency mirror FTSE WGBI). `LU0290355717` (Xtrackers II Eurozone Government Bond 1C) added as Eurozone-sovereign-only (single-currency EUR, single-sector government, broader maturity range than the existing IE00B3VTML14 3-7yr pool entry). Both carry `isEquity: false`.
  - **`HEDGED_ISINS` (src/lib/lookthrough.ts AND scripts/refresh-lookthrough.mjs):** the two Vanguard EUR-hedged ISINs added so the monthly justETF refresh leaves the hedged-currency map alone instead of overwriting it with a derived geo-based one.
  - All four ISINs now resolve via per-ISIN `PROFILES` entries; `validateLookthroughCoverage` returns `[]`. `pnpm --filter @workspace/investment-lab run test:engine` passes (429 / 431 with 2 pre-existing skips); `pnpm run typecheck` clean.

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
- **Methodology tab: download link for the default-profile Excel snapshot.** Added a download button in the Methodology header (DE+EN) linking to `${BASE_URL}default-profile-snapshot.xlsx`. The file is generated by `pnpm --filter @workspace/scripts run default-profile-snapshot` and now mirrored into `artifacts/investment-lab/public/` so Vite serves it as a static asset under the artifact's base path. The workbook contains 7 sheets (Allocation, CMA Assumptions, Correlations, Look-through Exposures, _Covariance, Risk & Performance, Parameters); every derived cell is a live Excel formula (Allocation totals, CMA Sharpe, look-through μ_effective, the 13×13 covariance matrix and all eight risk/performance metrics use SUMPRODUCT/MMULT against the weight, covariance and benchmark ranges, mirroring `metrics.ts:computeMetrics` line-for-line). Default profile encoded in the workbook: CHF / High / 10y / 60 % equity / Gold ✓ / REITs ✗ / Crypto ✗ / no hedging, look-through view on, snapshot date 2026-05-12.
- **Explain Portfolio: beta-version notice.** Added an amber warning banner at the top of the Explain Portfolio tab (EN/DE) clarifying that the module is in early beta and listing planned additions: position-level look-through, factor & style analysis, tax-efficiency scoring, cost comparison vs. benchmark, overlap analysis, and rebalancing suggestions. Wraps the existing two-column layout in a `space-y-6` stack so the banner sits above the input/result columns.
- **Compare tab: full DE translation.** All previously hardcoded English labels now switch with the language toggle: form labels (Basiswährung, Horizont (Jahre), Risikobereitschaft, Aktien-Zielallokation, Thematischer Tilt, Währungsabsicherung, Satelliten-Anlageklassen, Rohstoffe (Gold), Börsennotierte Immobilien, Krypto einbeziehen), all FormDescription subtexts, the Risk Appetite radio labels (Niedrig/Moderat/Hoch/Sehr hoch), the Thematic Tilt options (Keine/Technologie/Gesundheit/Nachhaltigkeit/Cybersicherheit), the submit button ("Portfolios vergleichen"), the validation alerts ("Portfolio A – Fehler/Warnungen/gültig", same for B), the "Strukturelle Unterschiede" card title and its description, the diff-table header ("Anlageklasse / Region", with the delta column flipped from `Δ (B - A)` to the proper minus-sign `Δ (B − A)`), the side-by-side allocation pie titles ("Allokation Portfolio A/B"), and the chart hover label ("Gewicht"). Implemented via a small inline `tr(en, de)` helper to keep the file self-contained without adding ~30 keys to `i18n.tsx`. The legend `data-testid` was switched from a fragile substring match to an explicit `slot: "A" | "B"` so the German titles don't break testing.
- **Risk & Performance Metrics: (i) icons now hover-open like the form fields.** The metric tiles previously used a `Popover` that required a click; switched to the same `Tooltip` primitive that the Build/Compare form labels use, so all (i) icons across the app open on hover (and tap on touch devices) consistently. Same content, same `aria-label`.
- **DE translation for "Ready to Build" / "Configure and Compare" empty states.** The Build tab placeholder now uses the existing `build.empty.title` / `build.empty.desc` keys (DE: "Bereit zur Erstellung" / "Konfigurieren Sie Ihre Präferenzen…") instead of hard-coded English strings. The Compare tab placeholder ("Configure and Compare" / "Setup both portfolios above…") now switches to "Konfigurieren und Vergleichen" / "Konfigurieren Sie oben beide Portfolios…" when the UI is set to German.
- **Compare tab: consistent (i) info tooltips on form fields.** Added the same hover/tap info tooltips that the Build tab uses next to each matching label (Base Currency, Horizon, Risk Appetite, Target Equity Allocation, Thematic Tilt) so the (i) icons behave identically across both tabs and reuse the same translation keys (`build.baseCurrency.tooltip`, `build.horizon.tooltip`, `build.riskAppetite.tooltip`, `build.targetEquity.tooltip`, `build.thematicTilt.tooltip`). The toggle-row fields (Currency Hedging, Commodities, Listed Real Estate, Crypto) keep their existing `FormDescription` subtext, matching the Build tab's pattern for those rows.
- **Compare tab: removed "Number of ETFs (min – max)" and "Preferred Exchange" inputs.** Both portfolios now use the form defaults (Portfolio A: 8–10 ETFs, Portfolio B: 11–13 ETFs; preferred exchange auto-synced from base currency via `defaultExchangeFor`). Eliminates two extra controls per portfolio in the Compare configuration panel; the Build tab keeps both controls. Also removed the now-unused `CompareNumEtfsRangeWarning` helper and the `computeNaturalBucketCount` / `Controller` imports.
- **Compare tab: removed "Include Synthetic ETFs" toggle.** Both Portfolio A and B now always use the default `includeSyntheticETFs: false` (physical replication). Reduces Compare configuration noise; users who want to evaluate synthetic vs physical can still toggle it in the Build tab.
- **Compare tab: Look-Through is always on.** Removed the per-portfolio "Look-Through Analysis" toggle from both Portfolio A and B configuration panels. Look-through decomposition (geographic map + underlying-holding analysis) is now always applied in Compare so the geographic allocation panel and any future look-through-based comparisons always have data and the two sides are always rendered on the same basis. Build tab keeps the toggle (unchanged). The `lookThroughView` field stays in the form state defaulted to `true` for engine compatibility.
- **Compare tab: effective geographic equity allocation per portfolio.** The interactive `GeoExposureMap` (world map with regional shading + numeric breakdown) is now rendered for both Portfolio A and B side-by-side, placed after the allocation pies and before the "Per-Portfolio Deep Dive" card. Single-column on mobile. Both maps use the look-through engine, so the geography reflects underlying ETF holdings, not just the regional bucket weights.
- **Bugfix — `Unhedged` share classes no longer detected as currency-hedged.** The fallback hedge-detection regex in `lookthrough.ts` (`isHedged()`) was `/Hedged/i`, which also matched names ending in "Unhedged" (e.g. `State Street SPDR MSCI World UCITS ETF USD Unhedged`). Such positions were silently routed into the hedged sleeve of the currency overview. Tightened to `/(?<!un)hedged/i` and added a regression test. Engine suite now 430 cases.
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

- **Methodology: Excel snapshot section in What's New (Task #288).** Added a
  new accordion section `value="excel-export"` (icon `FileSpreadsheet`) under
  the "Reference & context" group of the Methodology page, focused on the
  static default-profile snapshot linked from the Methodology header. The
  section explains that the .xlsx is a working calculation model — every
  derived cell is a live Excel formula, so users can change μ, σ,
  correlations or weights and watch the metrics recompute. Lists the seven
  sheets and what each contains: Allocation, CMA Assumptions, Correlations,
  Look-through Exposures, _Covariance, Risk & Performance, Parameters. The
  encoded profile is fixed at CHF / High / 10 yr / 60 % equity / Gold ✓ /
  REITs ✗ / Crypto ✗ / no hedging. Wiring: `"excel-export"` added to
  `VALID_SECTION_IDS`, `SECTION_VERSIONS` (v2.1 · May 2026 — floats it to
  the top of the What's New panel), `tocBlocks` reference group, and the
  WhatsNewPanel label-override map (DE "Excel-Snapshot — sehen, wie alles
  berechnet wird" / EN "Excel snapshot — see how everything is calculated").
  Bilingual (DE+EN). The Build-tab ETF Implementation export is
  intentionally out of scope here — the section is explicitly about the
  snapshot.

### Earlier (consolidated)
- **Min–Max ETF range** in Build & Compare (3–15) replacing the single `numETFs` input. Min is advisory; Max is the hard cap. Inline warning suggests an optimal range when the user's range is incompatible with their inputs.
- **Global+Home equity fallback** when the ETF budget is too small to hold every regional equity bucket: collapses to MSCI ACWI IMI (`Equity-Global`) + a home tilt (`Equity-Home`) based on base currency, preserving total equity exposure and home bias.
- **Look-through profile** for MSCI ACWI IMI (`IE00B3YLTY66`) added so the global equity ETF decomposes into geo / sector / currency / top holdings instead of appearing as "unmapped".
- **Stress scenarios** updated: `Equity_Global` has its own shock, `Equity_Home` falls back to USA shocks; tooltip explanation added in EN/DE.
- **User-editable risk-free rate** persisted in `localStorage` under `idl.riskFreeRate` and used by Sharpe / Sortino / efficient frontier.
- **Saved scenarios** (`localStorage`-backed) with save / load / delete UI.
- **PDF export** migrated to `html2canvas-pro` for Tailwind v4 compatibility.
