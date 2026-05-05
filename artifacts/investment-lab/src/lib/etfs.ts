import { PortfolioInput } from "./types";
import overridesFile from "@/data/etfs.overrides.json";
import { getUserETFOverride } from "./etfOverrides";
import { getETFSelection } from "./etfSelection";
// Task #122: validateCatalog() needs to know which ISINs the look-through
// JSON references so it can flag entries that have no INSTRUMENTS row.
// Importing only key getters (no PROFILES merge entry-points) keeps this
// file's module-load surface unchanged.
import {
  getLookthroughPoolIsins,
  getLookthroughOverrideIsins,
} from "./lookthrough";

// ----------------------------------------------------------------------------
// Per-bucket alternatives cap.
// ----------------------------------------------------------------------------
// The single source of truth for "how many curated alternatives may a
// bucket carry, on top of its 1 mandatory default ETF". Used by:
//   • validateCatalog() (build-time invariant)
//   • clampSlot() (runtime picker bounds)
//   • the admin UI (single-add gating, batch-add live preflight, badges,
//     copy)
//   • the api-server (single-add + bulk-add server-side preflight, the
//     injectAlternative() helper that writes to etfs.ts via PR, and the
//     bulk-PR reviewer-checklist body)
// The api-server can't TS-import this file (it parses etfs.ts as text
// rather than as a module), so it mirrors the same constant in
// artifacts/api-server/src/lib/limits.ts. If you change this value,
// change that one too.
// ----------------------------------------------------------------------------
export const MAX_ALTERNATIVES_PER_BUCKET = 10;

// ----------------------------------------------------------------------------
// Per-bucket extended-universe pool cap.
// ----------------------------------------------------------------------------
// The "pool" is a third per-bucket slot, separate from default + curated
// alternatives. ISINs in the pool are tagged to a bucket but are NOT
// surfaced as recommended alternatives in the picker — they live behind a
// dedicated "More ETFs" disclosure so the curated alternatives stay
// visible as the operator's recommendations.
//
// Same global-uniqueness rule as alternatives: an ISIN may appear in at
// most one slot across the whole catalog (default OR alternative OR pool).
// validateCatalog() enforces this; the admin PR helpers reject any write
// that would violate it.
//
// Soft cap of 50 per bucket prevents accidental thousand-row pickers from
// breaking the "More ETFs" dialog UX. Bump the constant if a single bucket
// legitimately needs more.
// ----------------------------------------------------------------------------
export const MAX_POOL_PER_BUCKET = 50;

export interface ETFDetails {
  name: string;
  isin: string;
  ticker: string;
  exchange: string;
  terBps: number;
  domicile: string;
  replication: "Physical" | "Physical (sampled)" | "Synthetic";
  distribution: "Accumulating" | "Distributing";
  currency: string;
  comment: string;
  // Optional fields populated by the weekly justETF snapshot refresh
  // (scripts/refresh-justetf.mjs). Undefined when no refresh has run yet.
  aumMillionsEUR?: number;
  inceptionDate?: string; // ISO YYYY-MM-DD
  // ----------------------------------------------------------------------
  // Per-bucket ETF picker support. Surfaced from the engine so the UI can
  // render a dropdown without re-doing the lookupKey() resolution.
  // ----------------------------------------------------------------------
  /** Catalog key the engine resolved to. Null when the bucket has no
   *  catalog entry and a placeholder is returned. */
  catalogKey: string | null;
  /** Currently selected slot: 0 = default (the catalog entry itself),
   *  1..N = nth alternative (where N is at most
   *  MAX_ALTERNATIVES_PER_BUCKET). Always 0 when an override is active
   *  or when no alternatives exist for this bucket. */
  selectedSlot: number;
  /** Lightweight summary of the up-to-3 ETFs the user can pick between
   *  for this bucket: index 0 is the curated default, indices 1+ are
   *  alternatives. Empty when catalogKey is null OR when an override is
   *  active (an override hides curated alternatives — once the user has
   *  hand-replaced the bucket's ETF via the Methodology pane, the curated
   *  alternatives panel no longer applies). */
  selectableOptions: ReadonlyArray<{
    name: string;
    isin: string;
    terBps: number;
    // Task #149 — distinguishes the curated rows (default + alternatives,
    // shown in the inline Select) from the extended-universe pool rows
    // (shown in the "More ETFs" dialog). Optional for backward
    // compatibility.
    kind?: "default" | "alternative" | "pool";
    distribution?: "Accumulating" | "Distributing";
  }>;
}

export type ExchangeCode = "LSE" | "XETRA" | "SIX" | "Euronext";
export type ListingMap = Partial<Record<ExchangeCode, { ticker: string }>>;

export interface ETFRecord {
  name: string;
  isin: string;
  terBps: number;
  domicile: string;
  replication: "Physical" | "Physical (sampled)" | "Synthetic";
  distribution: "Accumulating" | "Distributing";
  currency: string;
  comment: string;
  listings: ListingMap;
  defaultExchange: ExchangeCode;
  // Optional, snapshot-refreshable fields. Curated catalog leaves them
  // undefined; the override layer fills them once the script has run.
  aumMillionsEUR?: number;
  inceptionDate?: string; // ISO YYYY-MM-DD
  // ----------------------------------------------------------------------
  // Curated alternatives (per-bucket ETF picker).
  // Each bucket exposes 1 default (this record itself) plus up to
  // MAX_ALTERNATIVES_PER_BUCKET alternatives. The user picks one via the
  // in-row dropdown on the Build tab; selection is persisted in
  // localStorage (see lib/etfSelection.ts) and consulted by
  // getETFDetails() on the next render. Constraints enforced by
  // validateCatalog():
  //   • alternatives.length ≤ MAX_ALTERNATIVES_PER_BUCKET
  //   • all ISINs within a bucket (default + alternatives) are distinct
  //   • every ISIN appears at most once across the entire catalog —
  //     whether as default or alternative — so the INSTRUMENTS table is
  //     the unambiguous source of truth and bucket assignments cannot
  //     diverge.
  // ----------------------------------------------------------------------
  alternatives?: ETFRecord[];
}

// ----------------------------------------------------------------------------
// Master ETF/instrument table — single source of truth per ISIN.
// ----------------------------------------------------------------------------
// Task #111: split the catalog into two complementary tables so the same
// ETF can never accidentally appear in two places with diverging
// metadata.
//
//   • INSTRUMENTS — keyed by ISIN, holds all per-ETF metadata
//     (name, TER, listings, …). Each ISIN appears EXACTLY ONCE here.
//   • BUCKETS    — keyed by catalog bucket key, holds only the
//     assignment shape `{ default: ISIN, alternatives: [ISIN, ...] }`.
//     Each bucket has exactly 1 default + up to
//     MAX_ALTERNATIVES_PER_BUCKET alternatives.
//
// The legacy `CATALOG` view (Record<bucketKey, ETFRecord>) is preserved
// as a derived join below so every existing consumer (engine,
// Methodology UI, tests, override layer) keeps working unchanged via
// `getCatalog()` / `getCatalogEntry()`.
//
// Cross-bucket uniqueness invariant:
//   The same ISIN MUST NOT appear in more than one bucket slot
//   (whether default or alternative). `validateCatalog()` flags any
//   violation as an error — surfaced in the admin Catalog tab so the
//   operator can resolve the data debt.
// ----------------------------------------------------------------------------
export interface InstrumentRecord {
  name: string;
  isin: string;
  terBps: number;
  domicile: string;
  replication: "Physical" | "Physical (sampled)" | "Synthetic";
  distribution: "Accumulating" | "Distributing";
  currency: string;
  comment: string;
  listings: ListingMap;
  defaultExchange: ExchangeCode;
  aumMillionsEUR?: number;
  inceptionDate?: string; // ISO YYYY-MM-DD
}

export interface BucketAssignment {
  default: string; // ISIN — must exist as a key in INSTRUMENTS
  alternatives: string[]; // ISINs, length <= MAX_ALTERNATIVES_PER_BUCKET
  // Optional extended-universe pool — additional ISINs tagged to this
  // bucket that are pickable in Build (via the "More ETFs" dialog) and
  // in Explain (via the per-bucket IsinPicker), but NOT surfaced as
  // recommended alternatives. length <= MAX_POOL_PER_BUCKET. Same
  // global-uniqueness rule as `alternatives` — every ISIN here must
  // also be absent from every other slot in every other bucket.
  pool?: string[];
}

const I = (r: InstrumentRecord) => r;
const B = (a: BucketAssignment) => a;

const INSTRUMENTS: Record<string, InstrumentRecord> = {
  "IE00B3YLTY66": I({
    name: "SPDR MSCI ACWI IMI UCITS",
    isin: "IE00B3YLTY66",
    terBps: 17,
    domicile: "Ireland",
    replication: "Physical (sampled)",
    distribution: "Accumulating",
    currency: "USD",
    comment: "Single-fund global equity (developed + emerging) tracking MSCI ACWI IMI; used when the ETF budget is too small for region-by-region splits.",
    listings: { LSE: { ticker: "SPYI" }, XETRA: { ticker: "SPYI" }, SIX: { ticker: "SPYI" }, Euronext: { ticker: "SPYI" } },
    defaultExchange: "LSE",
  }),
  "IE00B5BMR087": I({
    name: "iShares Core S&P 500 UCITS",
    isin: "IE00B5BMR087",
    terBps: 7,
    domicile: "Ireland",
    replication: "Physical",
    distribution: "Accumulating",
    currency: "USD",
    comment: "Largest, most liquid S&P 500 UCITS with very tight tracking and minimal bid-ask spreads.",
    listings: { LSE: { ticker: "CSPX" }, XETRA: { ticker: "SXR8" }, SIX: { ticker: "CSSPX" }, Euronext: { ticker: "CSPX" } },
    defaultExchange: "LSE",
  }),
  "IE00B3YCGJ38": I({
    name: "Invesco S&P 500 UCITS (Synthetic)",
    isin: "IE00B3YCGJ38",
    terBps: 5,
    domicile: "Ireland",
    replication: "Synthetic",
    distribution: "Accumulating",
    currency: "USD",
    comment: "Swap-based replication eliminates the 15% US dividend withholding-tax leakage that physical Irish-domiciled ETFs incur, structurally adding ~20–30 bps/yr; introduces counterparty risk to the swap counterparties.",
    listings: { LSE: { ticker: "SPXS" }, XETRA: { ticker: "SC0J" }, SIX: { ticker: "SPXS" }, Euronext: { ticker: "SPXS" } },
    defaultExchange: "LSE",
  }),
  "IE00B4K48X80": I({
    name: "iShares Core MSCI Europe UCITS",
    isin: "IE00B4K48X80",
    terBps: 12,
    domicile: "Ireland",
    replication: "Physical (sampled)",
    distribution: "Accumulating",
    currency: "EUR",
    comment: "Broad pan-European core exposure across UK, eurozone and Switzerland, with very low TER.",
    listings: { LSE: { ticker: "IMEU" }, XETRA: { ticker: "SXR7" }, SIX: { ticker: "CEU" }, Euronext: { ticker: "IMAE" } },
    defaultExchange: "XETRA",
  }),
  "CH0237935652": I({
    name: "iShares Core SPI",
    isin: "CH0237935652",
    terBps: 10,
    domicile: "Switzerland",
    replication: "Physical",
    distribution: "Distributing",
    currency: "CHF",
    comment: "Comprehensive Swiss equity benchmark covering large, mid and small caps; very deep liquidity on SIX.",
    listings: { SIX: { ticker: "CHSPI" } },
    defaultExchange: "SIX",
  }),
  "IE00B53HP851": I({
    name: "iShares Core FTSE 100 UCITS",
    isin: "IE00B53HP851",
    terBps: 7,
    domicile: "Ireland",
    replication: "Physical",
    distribution: "Accumulating",
    currency: "GBP",
    comment: "FTSE 100 large-cap UK equity used as the GBP home-bias core sleeve; very low TER and deep LSE liquidity.",
    listings: { LSE: { ticker: "CUKX" } },
    defaultExchange: "LSE",
  }),
  "IE00B4L5YX21": I({
    name: "iShares Core MSCI Japan IMI UCITS",
    isin: "IE00B4L5YX21",
    terBps: 12,
    domicile: "Ireland",
    replication: "Physical (sampled)",
    distribution: "Accumulating",
    currency: "JPY",
    comment: "Wide-coverage Japan exposure including small caps; useful for a diversified developed-markets sleeve.",
    listings: { LSE: { ticker: "SJPA" }, XETRA: { ticker: "SXR4" }, SIX: { ticker: "CSJP" }, Euronext: { ticker: "IJPA" } },
    defaultExchange: "LSE",
  }),
  "IE00BKM4GZ66": I({
    name: "iShares Core MSCI EM IMI UCITS",
    isin: "IE00BKM4GZ66",
    terBps: 18,
    domicile: "Ireland",
    replication: "Physical (sampled)",
    distribution: "Accumulating",
    currency: "USD",
    comment: "Broadest emerging-markets ETF including small caps; sampled replication keeps tracking error low.",
    listings: { LSE: { ticker: "EIMI" }, XETRA: { ticker: "IS3N" }, SIX: { ticker: "EIMI" }, Euronext: { ticker: "EMIM" } },
    defaultExchange: "LSE",
  }),
  "IE00B3ZW0K18": I({
    name: "iShares S&P 500 EUR Hedged UCITS",
    isin: "IE00B3ZW0K18",
    terBps: 20,
    domicile: "Ireland",
    replication: "Physical",
    distribution: "Accumulating",
    currency: "EUR",
    comment: "EUR-hedged share class strips out USD/EUR FX volatility; small drag from rolling forwards.",
    listings: { LSE: { ticker: "IUSE" }, XETRA: { ticker: "IUSE" }, Euronext: { ticker: "IUSE" } },
    defaultExchange: "XETRA",
  }),
  "IE00BYX5MS15": I({
    name: "iShares Core S&P 500 GBP Hedged UCITS",
    isin: "IE00BYX5MS15",
    terBps: 20,
    domicile: "Ireland",
    replication: "Physical",
    distribution: "Accumulating",
    currency: "GBP",
    comment: "GBP-hedged share class for sterling-based investors; identical underlying basket.",
    listings: { LSE: { ticker: "GSPX" } },
    defaultExchange: "LSE",
  }),
  "IE00B88DZ566": I({
    name: "UBS Core S&P 500 CHF Hedged UCITS",
    isin: "IE00B88DZ566",
    terBps: 20,
    domicile: "Ireland",
    replication: "Physical",
    distribution: "Accumulating",
    currency: "CHF",
    comment: "CHF-hedged share class for franc-based investors; strips USD/CHF FX volatility from S&P 500 exposure.",
    listings: { SIX: { ticker: "SP5CHA" } },
    defaultExchange: "SIX",
  }),
  "IE00B3F81409": I({
    name: "iShares Core Global Aggregate Bond UCITS",
    isin: "IE00B3F81409",
    terBps: 10,
    domicile: "Ireland",
    replication: "Physical (sampled)",
    distribution: "Accumulating",
    currency: "USD",
    comment: "Diversified global investment-grade bond exposure; available in EUR, CHF and GBP hedged share classes.",
    listings: { LSE: { ticker: "AGGG" }, XETRA: { ticker: "EUNA" }, SIX: { ticker: "AGGH" }, Euronext: { ticker: "AGGG" } },
    defaultExchange: "LSE",
  }),
  "IE00BDBRDM35": I({
    name: "iShares Global Aggregate Bond EUR Hedged",
    isin: "IE00BDBRDM35",
    terBps: 10,
    domicile: "Ireland",
    replication: "Physical (sampled)",
    distribution: "Accumulating",
    currency: "EUR",
    comment: "EUR-hedged global aggregate; preferred for euro-based defensive sleeve.",
    listings: { XETRA: { ticker: "AGGH" }, LSE: { ticker: "AGGH" }, Euronext: { ticker: "AGGH" } },
    defaultExchange: "XETRA",
  }),
  "IE00BDBRDN42": I({
    name: "iShares Global Aggregate Bond CHF Hedged",
    isin: "IE00BDBRDN42",
    terBps: 12,
    domicile: "Ireland",
    replication: "Physical (sampled)",
    distribution: "Accumulating",
    currency: "CHF",
    comment: "CHF-hedged global aggregate; suitable defensive core for Swiss-franc portfolios.",
    listings: { SIX: { ticker: "AGGS" } },
    defaultExchange: "SIX",
  }),
  "IE00BDBRDP65": I({
    name: "iShares Global Aggregate Bond GBP Hedged",
    isin: "IE00BDBRDP65",
    terBps: 10,
    domicile: "Ireland",
    replication: "Physical (sampled)",
    distribution: "Accumulating",
    currency: "GBP",
    comment: "GBP-hedged global aggregate for sterling portfolios.",
    listings: { LSE: { ticker: "AGBP" } },
    defaultExchange: "LSE",
  }),
  "IE00B579F325": I({
    name: "Invesco Physical Gold ETC",
    isin: "IE00B579F325",
    terBps: 12,
    domicile: "Ireland",
    replication: "Physical",
    distribution: "Accumulating",
    currency: "USD",
    comment: "Physically-backed gold ETC vaulted in London; very low TER and tight spreads vs spot.",
    listings: { LSE: { ticker: "SGLD" }, XETRA: { ticker: "8PSG" }, SIX: { ticker: "SGLD" }, Euronext: { ticker: "SGLD" } },
    defaultExchange: "LSE",
  }),
  "IE00B1FZS350": I({
    name: "iShares Developed Markets Property Yield UCITS",
    isin: "IE00B1FZS350",
    terBps: 59,
    domicile: "Ireland",
    replication: "Physical",
    distribution: "Distributing",
    currency: "USD",
    comment: "Global developed-market REITs with above-average dividend yield; meaningful US weight (~60%).",
    listings: { LSE: { ticker: "IWDP" }, XETRA: { ticker: "IQQ6" }, SIX: { ticker: "IWDP" }, Euronext: { ticker: "IWDP" } },
    defaultExchange: "LSE",
  }),
  "GB00BLD4ZL17": I({
    name: "CoinShares Physical Bitcoin",
    isin: "GB00BLD4ZL17",
    terBps: 25,
    domicile: "Jersey",
    replication: "Physical",
    distribution: "Accumulating",
    currency: "USD",
    comment: "Physically-backed bitcoin ETP with cold-storage custody; concentrated single-asset exposure.",
    listings: { LSE: { ticker: "BITC" }, XETRA: { ticker: "BITC" }, SIX: { ticker: "BITC" }, Euronext: { ticker: "BITC" } },
    defaultExchange: "SIX",
  }),
  "IE00B3WJKG14": I({
    name: "iShares S&P 500 Information Technology Sector",
    isin: "IE00B3WJKG14",
    terBps: 15,
    domicile: "Ireland",
    replication: "Physical",
    distribution: "Accumulating",
    currency: "USD",
    comment: "Concentrated US tech-sector tilt; high stock-level concentration in mega-cap names.",
    listings: { LSE: { ticker: "IUIT" }, XETRA: { ticker: "QDVE" }, SIX: { ticker: "IUIT" }, Euronext: { ticker: "IUIT" } },
    defaultExchange: "LSE",
  }),
  "IE00BYZK4776": I({
    name: "iShares Healthcare Innovation UCITS",
    isin: "IE00BYZK4776",
    terBps: 40,
    domicile: "Ireland",
    replication: "Physical",
    distribution: "Accumulating",
    currency: "USD",
    comment: "Global healthcare-innovation theme spanning biotech, devices and digital health.",
    listings: { LSE: { ticker: "HEAL" }, XETRA: { ticker: "2B77" }, Euronext: { ticker: "HEAL" } },
    defaultExchange: "LSE",
  }),
  "IE00B1XNHC34": I({
    name: "iShares Global Clean Energy UCITS",
    isin: "IE00B1XNHC34",
    terBps: 65,
    domicile: "Ireland",
    replication: "Physical",
    distribution: "Distributing",
    currency: "USD",
    comment: "Concentrated global clean-energy basket; historically high volatility and sector concentration.",
    listings: { LSE: { ticker: "INRG" }, XETRA: { ticker: "IQQH" }, SIX: { ticker: "INRG" }, Euronext: { ticker: "INRG" } },
    defaultExchange: "LSE",
  }),
  "IE00BG0J4C88": I({
    name: "iShares Digital Security UCITS",
    isin: "IE00BG0J4C88",
    terBps: 40,
    domicile: "Ireland",
    replication: "Physical",
    distribution: "Accumulating",
    currency: "USD",
    comment: "Global cybersecurity and digital-security theme; smaller AUM, wider spreads possible.",
    listings: { LSE: { ticker: "LOCK" }, XETRA: { ticker: "2B7K" }, Euronext: { ticker: "LOCK" } },
    defaultExchange: "LSE",
  }),
  "IE00BK5BQT80": I({
    name: "Vanguard FTSE All-World UCITS",
    isin: "IE00BK5BQT80",
    terBps: 22,
    domicile: "Ireland",
    replication: "Physical (sampled)",
    distribution: "Accumulating",
    currency: "USD",
    comment: "Vanguard's flagship global equity fund: large/mid caps across developed + emerging markets, very deep liquidity on LSE/XETRA/SIX.",
    listings: { LSE: { ticker: "VWRA" }, XETRA: { ticker: "VWCE" }, SIX: { ticker: "VWRL" }, Euronext: { ticker: "VWCE" } },
    defaultExchange: "LSE",
  }),
  "IE00B6R52259": I({
    name: "iShares MSCI ACWI UCITS",
    isin: "IE00B6R52259",
    terBps: 20,
    domicile: "Ireland",
    replication: "Physical (sampled)",
    distribution: "Accumulating",
    currency: "USD",
    comment: "MSCI ACWI (developed + emerging large/mid caps); sister fund to SPYI but on the MSCI ACWI parent index rather than ACWI IMI (excludes small caps).",
    listings: { LSE: { ticker: "SSAC" }, XETRA: { ticker: "IUSQ" }, SIX: { ticker: "SSAC" }, Euronext: { ticker: "SSAC" } },
    defaultExchange: "LSE",
  }),
  "IE00BFMXXD54": I({
    name: "Vanguard S&P 500 UCITS",
    isin: "IE00BFMXXD54",
    terBps: 7,
    domicile: "Ireland",
    replication: "Physical",
    distribution: "Accumulating",
    currency: "USD",
    comment: "Vanguard's accumulating S&P 500 UCITS; same TER as iShares' CSPX, identical underlying basket — useful for diversifying issuer concentration.",
    listings: { LSE: { ticker: "VUAA" }, XETRA: { ticker: "VUAA" }, SIX: { ticker: "VUAA" }, Euronext: { ticker: "VUAA" } },
    defaultExchange: "LSE",
  }),
  "IE00B6YX5C33": I({
    name: "SPDR S&P 500 UCITS",
    isin: "IE00B6YX5C33",
    terBps: 3,
    domicile: "Ireland",
    replication: "Physical",
    distribution: "Distributing",
    currency: "USD",
    comment: "Lowest-TER S&P 500 UCITS in the catalog (3 bps); distributing share class — preferable when the investor wants regular dividend income rather than reinvestment.",
    listings: { LSE: { ticker: "SPY5" }, XETRA: { ticker: "SPY5" }, Euronext: { ticker: "SPY5" } },
    defaultExchange: "LSE",
  }),
  "LU0490618542": I({
    name: "Xtrackers S&P 500 Swap UCITS ETF 1C",
    isin: "LU0490618542",
    terBps: 15,
    domicile: "Luxembourg",
    replication: "Synthetic",
    distribution: "Accumulating",
    currency: "USD",
    comment: "Xtrackers S&P 500 Swap — alternative synthetic.",
    listings: { LSE: { ticker: "XSPU" }, XETRA: { ticker: "D5BM" } },
    defaultExchange: "XETRA",
    aumMillionsEUR: 4005,
    inceptionDate: "2010-03-26",
  }),
  "IE00B945VV12": I({
    name: "Vanguard FTSE Developed Europe UCITS",
    isin: "IE00B945VV12",
    terBps: 10,
    domicile: "Ireland",
    replication: "Physical (sampled)",
    distribution: "Accumulating",
    currency: "EUR",
    comment: "FTSE Developed Europe (large/mid caps, includes UK and Switzerland); marginally lower TER than the iShares MSCI variant.",
    listings: { LSE: { ticker: "VEUA" }, XETRA: { ticker: "VGEA" }, Euronext: { ticker: "VGEA" } },
    defaultExchange: "XETRA",
  }),
  "FR0007054358": I({
    name: "Amundi EURO STOXX 50 II UCITS ETF Acc",
    isin: "FR0007054358",
    terBps: 20,
    domicile: "France",
    replication: "Physical",
    distribution: "Accumulating",
    currency: "EUR",
    comment: "EURO STOXX 50 (eurozone blue-chips only, 50 names); much narrower than the broad MSCI/FTSE Europe alternatives — no UK or Swiss exposure.",
    listings: { XETRA: { ticker: "LYSX" }, SIX: { ticker: "MSE" }, Euronext: { ticker: "MSE" } },
    defaultExchange: "XETRA",
  }),
  "CH0031768937": I({
    name: "iShares SLI ETF (CH)",
    isin: "CH0031768937",
    terBps: 35,
    domicile: "Switzerland",
    replication: "Physical",
    distribution: "Distributing",
    currency: "CHF",
    comment: "Swiss Leader Index (top 30 Swiss blue-chips with weight caps); narrower than SPI but caps the dominance of Nestlé / Novartis / Roche.",
    listings: { SIX: { ticker: "CSSLI" } },
    defaultExchange: "SIX",
  }),
  "LU1681044993": I({
    name: "Amundi MSCI Switzerland UCITS ETF CHF",
    isin: "LU1681044993",
    terBps: 25,
    domicile: "Luxembourg",
    replication: "Synthetic",
    distribution: "Accumulating",
    currency: "CHF",
    comment: "MSCI Switzerland (large/mid caps, ~40 names); synthetic, accumulating, Luxembourg-domiciled — alternative for portfolios that prefer swap-based replication or accumulation over the SPI default's Swiss-domicile distributing share class.",
    listings: { LSE: { ticker: "CSWU" }, XETRA: { ticker: "18MN" }, SIX: { ticker: "CSWCHF" } },
    defaultExchange: "SIX",
  }),
  "IE00B810Q511": I({
    name: "Vanguard FTSE 100 UCITS ETF (GBP) Distributing",
    isin: "IE00B810Q511",
    terBps: 9,
    domicile: "Ireland",
    replication: "Physical",
    distribution: "Distributing",
    currency: "GBP",
    comment: "Vanguard FTSE 100 — alternative provider, same index.",
    listings: { LSE: { ticker: "VUKE" }, XETRA: { ticker: "VUKE" } },
    defaultExchange: "LSE",
    aumMillionsEUR: 5085,
    inceptionDate: "2012-05-22",
  }),
  "LU0839027447": I({
    name: "Xtrackers Nikkei 225 UCITS ETF 1D",
    isin: "LU0839027447",
    terBps: 9,
    domicile: "Luxembourg",
    replication: "Physical",
    distribution: "Distributing",
    currency: "JPY",
    comment: "Xtrackers Nikkei 225 — Nikkei index alternative.",
    listings: { LSE: { ticker: "XDJP" }, XETRA: { ticker: "XDJP" } },
    defaultExchange: "XETRA",
    aumMillionsEUR: 1795,
    inceptionDate: "2013-01-25",
  }),
  "IE00BK5BR733": I({
    name: "Vanguard FTSE Emerging Markets UCITS",
    isin: "IE00BK5BR733",
    terBps: 22,
    domicile: "Ireland",
    replication: "Physical (sampled)",
    distribution: "Accumulating",
    currency: "USD",
    comment: "Vanguard FTSE EM (large/mid caps; includes Korea — unlike MSCI EM); deeper venue spreads on LSE/XETRA.",
    listings: { LSE: { ticker: "VFEA" }, XETRA: { ticker: "VFEA" }, Euronext: { ticker: "VFEA" } },
    defaultExchange: "LSE",
  }),
  "IE00BTJRMP35": I({
    name: "Xtrackers MSCI Emerging Markets UCITS ETF 1C",
    isin: "IE00BTJRMP35",
    terBps: 18,
    domicile: "Ireland",
    replication: "Physical",
    distribution: "Accumulating",
    currency: "USD",
    comment: "Xtrackers MSCI EM — synthetic, low TER.",
    listings: { LSE: { ticker: "XMME" }, XETRA: { ticker: "XMME" } },
    defaultExchange: "XETRA",
    aumMillionsEUR: 10406,
    inceptionDate: "2017-06-21",
  }),
  "IE00BM67HW99": I({
    name: "Xtrackers S&P 500 UCITS ETF 1C - EUR Hedged",
    isin: "IE00BM67HW99",
    terBps: 5,
    domicile: "Ireland",
    replication: "Physical",
    distribution: "Accumulating",
    currency: "EUR",
    comment: "Xtrackers S&P 500 EUR Hedged — alternative provider.",
    listings: { XETRA: { ticker: "XDPE" } },
    defaultExchange: "XETRA",
    aumMillionsEUR: 471,
    inceptionDate: "2015-02-27",
  }),
  "IE00BRKWGL70": I({
    name: "Invesco S&P 500 EUR Hedged UCITS ETF",
    isin: "IE00BRKWGL70",
    terBps: 5,
    domicile: "Ireland",
    replication: "Synthetic",
    distribution: "Accumulating",
    currency: "EUR",
    comment: "Invesco S&P 500 EUR Hedged — synthetic alternative.",
    listings: { XETRA: { ticker: "E500" } },
    defaultExchange: "XETRA",
    aumMillionsEUR: 2640,
    inceptionDate: "2014-12-08",
  }),
  "LU0378818131": I({
    name: "Xtrackers II Global Government Bond UCITS",
    isin: "LU0378818131",
    terBps: 25,
    domicile: "Luxembourg",
    replication: "Physical (sampled)",
    distribution: "Distributing",
    currency: "USD",
    comment: "Sovereign-only global bond aggregate (excludes corporates); higher TER than the iShares core but cleaner duration profile for defensive sleeves.",
    listings: { LSE: { ticker: "XGGB" }, XETRA: { ticker: "DBZB" }, Euronext: { ticker: "XGGB" } },
    defaultExchange: "XETRA",
  }),
  "IE00BG47KH54": I({
    name: "Vanguard Global Aggregate Bond UCITS ETF EUR Hedged Accumulating",
    isin: "IE00BG47KH54",
    terBps: 8,
    domicile: "Ireland",
    replication: "Physical",
    distribution: "Accumulating",
    currency: "EUR",
    comment: "Vanguard Global Aggregate Bond — alternative provider.",
    listings: { XETRA: { ticker: "VAGF" } },
    defaultExchange: "XETRA",
    aumMillionsEUR: 1952,
    inceptionDate: "2019-06-18",
  }),
  "IE00BG47KB92": I({
    name: "Vanguard Global Aggregate Bond UCITS ETF EUR Hedged Distributing",
    isin: "IE00BG47KB92",
    terBps: 8,
    domicile: "Ireland",
    replication: "Physical",
    distribution: "Distributing",
    currency: "EUR",
    comment: "Vanguard Global Aggregate Bond EUR Hedged — alternative provider.",
    listings: { XETRA: { ticker: "VAGE" } },
    defaultExchange: "XETRA",
    aumMillionsEUR: 123,
    inceptionDate: "2019-06-18",
  }),
  "LU0290355717": I({
    name: "Xtrackers II Eurozone Government Bond UCITS ETF 1C",
    isin: "LU0290355717",
    terBps: 7,
    domicile: "Luxembourg",
    replication: "Physical",
    distribution: "Accumulating",
    currency: "EUR",
    comment: "Xtrackers II Global Government Bond EUR Hedged — government-only alternative.",
    listings: { LSE: { ticker: "XGLE" }, XETRA: { ticker: "XGLE" } },
    defaultExchange: "XETRA",
    aumMillionsEUR: 2268,
    inceptionDate: "2007-05-22",
  }),
  "IE00BG47KJ78": I({
    name: "Vanguard Global Aggregate Bond UCITS ETF USD Hedged Accumulating",
    isin: "IE00BG47KJ78",
    terBps: 8,
    domicile: "Ireland",
    replication: "Physical",
    distribution: "Accumulating",
    currency: "USD",
    comment: "Vanguard Global Aggregate Bond GBP Hedged — alternative provider.",
    listings: { LSE: { ticker: "VAGU" } },
    defaultExchange: "LSE",
    aumMillionsEUR: 555,
    inceptionDate: "2019-06-18",
  }),
  "IE00B4ND3602": I({
    name: "iShares Physical Gold ETC",
    isin: "IE00B4ND3602",
    terBps: 12,
    domicile: "Ireland",
    replication: "Physical",
    distribution: "Accumulating",
    currency: "USD",
    comment: "iShares' physically-backed gold ETC, vaulted with JPMorgan in London; identical TER to Invesco SGLD, useful for issuer diversification.",
    listings: { LSE: { ticker: "SGLN" }, XETRA: { ticker: "IGLN" }, SIX: { ticker: "SGLN" }, Euronext: { ticker: "SGLN" } },
    defaultExchange: "LSE",
  }),
  "JE00B1VS3770": I({
    name: "WisdomTree Physical Gold",
    isin: "JE00B1VS3770",
    terBps: 39,
    domicile: "Jersey",
    replication: "Physical",
    distribution: "Accumulating",
    currency: "USD",
    comment: "Higher-TER but long-established physical gold ETP (Jersey-domiciled); bullion held with HSBC London — useful as a third issuer alongside Invesco/iShares.",
    listings: { LSE: { ticker: "PHAU" }, XETRA: { ticker: "VZLD" }, SIX: { ticker: "PHAU" }, Euronext: { ticker: "PHAU" } },
    defaultExchange: "LSE",
  }),
  "IE00B5L01S80": I({
    name: "HSBC FTSE EPRA NAREIT Developed UCITS ETF USD",
    isin: "IE00B5L01S80",
    terBps: 24,
    domicile: "Ireland",
    replication: "Physical",
    distribution: "Distributing",
    currency: "USD",
    comment: "HSBC FTSE EPRA NAREIT Developed — alternative provider.",
    listings: { LSE: { ticker: "HPRD" }, XETRA: { ticker: "H4ZL" } },
    defaultExchange: "LSE",
    aumMillionsEUR: 1853,
    inceptionDate: "2011-06-20",
  }),
  "NL0009690239": I({
    name: "VanEck Global Real Estate UCITS ETF",
    isin: "NL0009690239",
    terBps: 25,
    domicile: "Netherlands",
    replication: "Physical",
    distribution: "Distributing",
    currency: "EUR",
    comment: "VanEck Global Real Estate — alternative provider.",
    listings: { LSE: { ticker: "TRET" }, XETRA: { ticker: "TRET" } },
    defaultExchange: "XETRA",
    aumMillionsEUR: 411,
    inceptionDate: "2011-04-14",
  }),
  "GB00BJYDH287": I({
    name: "WisdomTree Physical Bitcoin",
    isin: "GB00BJYDH287",
    terBps: 15,
    domicile: "Jersey",
    replication: "Physical",
    distribution: "Accumulating",
    currency: "USD",
    comment: "WisdomTree Physical Bitcoin — alternative crypto ETP.",
    listings: { LSE: { ticker: "BTCW" }, XETRA: { ticker: "WBIT" } },
    defaultExchange: "LSE",
    aumMillionsEUR: 1220,
    inceptionDate: "2019-11-28",
  }),
  "CH1199067674": I({
    name: "21shares Bitcoin Core ETP",
    isin: "CH1199067674",
    terBps: 10,
    domicile: "Switzerland",
    replication: "Physical",
    distribution: "Accumulating",
    currency: "USD",
    comment: "21Shares Bitcoin Core — Swiss-listed, native CHF.",
    listings: { LSE: { ticker: "CBTU" }, XETRA: { ticker: "21BC" } },
    defaultExchange: "LSE",
    aumMillionsEUR: 389,
    inceptionDate: "2022-06-29",
  }),
  "IE00B53SZB19": I({
    name: "iShares Nasdaq 100 UCITS ETF (Acc)",
    isin: "IE00B53SZB19",
    terBps: 30,
    domicile: "Ireland",
    replication: "Physical",
    distribution: "Accumulating",
    currency: "USD",
    comment: "Nasdaq 100 (top 100 non-financial Nasdaq names); broader than the IT-sector default but still mega-cap tech-tilted, with sizeable consumer-discretionary and communication-services weights.",
    listings: { LSE: { ticker: "CNDX1" }, XETRA: { ticker: "SXRV" }, SIX: { ticker: "CSNDX" } },
    defaultExchange: "LSE",
  }),
  "IE00BM67HT60": I({
    name: "Xtrackers MSCI World Information Technology UCITS ETF 1C",
    isin: "IE00BM67HT60",
    terBps: 25,
    domicile: "Ireland",
    replication: "Physical",
    distribution: "Accumulating",
    currency: "USD",
    comment: "Xtrackers MSCI World IT — developed-market tech sector, capped 35%/20% to limit single-stock concentration.",
    listings: { LSE: { ticker: "XDWT" }, XETRA: { ticker: "XDWT" }, SIX: { ticker: "XDWT" } },
    defaultExchange: "LSE",
  }),
  "IE00BM67HK77": I({
    name: "Xtrackers MSCI World Health Care UCITS ETF 1C",
    isin: "IE00BM67HK77",
    terBps: 25,
    domicile: "Ireland",
    replication: "Physical",
    distribution: "Accumulating",
    currency: "USD",
    comment: "Xtrackers MSCI World Health Care — broad healthcare exposure.",
    listings: { LSE: { ticker: "XDWH" }, XETRA: { ticker: "XDWH" } },
    defaultExchange: "XETRA",
    aumMillionsEUR: 2699,
    inceptionDate: "2016-03-04",
  }),
  "IE00B43HR379": I({
    name: "iShares S&P 500 Health Care Sector UCITS ETF (Acc)",
    isin: "IE00B43HR379",
    terBps: 15,
    domicile: "Ireland",
    replication: "Physical",
    distribution: "Accumulating",
    currency: "USD",
    comment: "iShares S&P 500 Health Care Sector — US-focused alternative.",
    listings: { LSE: { ticker: "IUHC" }, XETRA: { ticker: "QDVG" } },
    defaultExchange: "LSE",
    aumMillionsEUR: 2096,
    inceptionDate: "2015-11-20",
  }),
  "IE00BFNM3J75": I({
    name: "iShares MSCI World Screened UCITS ETF USD (Acc)",
    isin: "IE00BFNM3J75",
    terBps: 20,
    domicile: "Ireland",
    replication: "Physical",
    distribution: "Accumulating",
    currency: "USD",
    comment: "iShares MSCI World ESG Screened — broad ESG alternative.",
    listings: { LSE: { ticker: "SAWD" }, XETRA: { ticker: "SNAW" } },
    defaultExchange: "XETRA",
    aumMillionsEUR: 4602,
    inceptionDate: "2018-10-19",
  }),
  "IE00BLRB0242": I({
    name: "Invesco Global Clean Energy UCITS ETF Acc",
    isin: "IE00BLRB0242",
    terBps: 60,
    domicile: "Ireland",
    replication: "Physical",
    distribution: "Accumulating",
    currency: "USD",
    comment: "Invesco Global Clean Energy — global renewable-energy theme tracking the WilderHill New Energy Global Innovation index.",
    listings: { LSE: { ticker: "GCLE" }, XETRA: { ticker: "G1CE" }, SIX: { ticker: "GCLE" } },
    defaultExchange: "LSE",
  }),
  "IE00BYPLS672": I({
    name: "L&G Cyber Security UCITS ETF",
    isin: "IE00BYPLS672",
    terBps: 69,
    domicile: "Ireland",
    replication: "Physical",
    distribution: "Accumulating",
    currency: "USD",
    comment: "L&G Cyber Security — pure-play cybersecurity.",
    listings: { LSE: { ticker: "USPY" }, XETRA: { ticker: "USPY" } },
    defaultExchange: "LSE",
    aumMillionsEUR: 2236,
    inceptionDate: "2015-09-28",
  }),
  "IE00BLPK3577": I({
    name: "WisdomTree Cybersecurity UCITS ETF USD Acc",
    isin: "IE00BLPK3577",
    terBps: 45,
    domicile: "Ireland",
    replication: "Physical",
    distribution: "Accumulating",
    currency: "USD",
    comment: "WisdomTree Cybersecurity — newer cybersec alternative.",
    listings: { LSE: { ticker: "WCBR" }, XETRA: { ticker: "W1TB" } },
    defaultExchange: "LSE",
    aumMillionsEUR: 312,
    inceptionDate: "2021-01-25",
  }),
  "IE00BLCHJB90": I({
    name: "Global X Robotics & Artificial Intelligence UCITS ETF USD Accumulating",
    isin: "IE00BLCHJB90",
    terBps: 50,
    domicile: "Ireland",
    replication: "Physical",
    distribution: "Accumulating",
    currency: "USD",
    comment: "Global X Robotics & AI — thematic exposure to robotics and AI beneficiaries worldwide.",
    listings: { "LSE": { ticker: "BOTZ" }, "XETRA": { ticker: "XB0T" }, "SIX": { ticker: "BOTZ" } },
    defaultExchange: "LSE",
  }),
  "IE00BLR6QB00": I({
    name: "Global X Telemedicine & Digital Health UCITS ETF Acc USD",
    isin: "IE00BLR6QB00",
    terBps: 68,
    domicile: "Ireland",
    replication: "Physical",
    distribution: "Accumulating",
    currency: "USD",
    comment: "Global X Telemedicine & Digital Health — niche health-tech theme, very small AUM.",
    listings: { "LSE": { ticker: "EDOC" }, "XETRA": { ticker: "DDOC" }, "SIX": { ticker: "EDOC" } },
    defaultExchange: "LSE",
  }),
  "LU0136234654": I({
    name: "UBS MSCI USA UCITS ETF USD dis",
    isin: "LU0136234654",
    terBps: 14,
    domicile: "Luxembourg",
    replication: "Physical",
    distribution: "Distributing",
    currency: "USD",
    comment: "UBS MSCI USA — broad US large-cap, distributing alternative.",
    listings: { "LSE": { ticker: "UC67" }, "XETRA": { ticker: "UIM6" }, "SIX": { ticker: "USAUSA" } },
    defaultExchange: "LSE",
  }),
  "IE0008471009": I({
    name: "iShares Core EURO STOXX 50 UCITS ETF EUR (Dist)",
    isin: "IE0008471009",
    terBps: 10,
    domicile: "Ireland",
    replication: "Physical",
    distribution: "Distributing",
    currency: "EUR",
    comment: "iShares Core EURO STOXX 50 — 50 largest eurozone blue chips, distributing.",
    listings: { "LSE": { ticker: "EUE" }, "XETRA": { ticker: "EUN2" }, "SIX": { ticker: "EUNE" }, "Euronext": { ticker: "EUEA" } },
    defaultExchange: "LSE",
  }),
  "IE00B3RBWM25": I({
    name: "Vanguard FTSE All-World UCITS ETF (USD) Distributing",
    isin: "IE00B3RBWM25",
    terBps: 19,
    domicile: "Ireland",
    replication: "Physical",
    distribution: "Distributing",
    currency: "USD",
    comment: "Vanguard FTSE All-World — developed + emerging markets worldwide, distributing share class.",
    listings: { "LSE": { ticker: "VWRD" }, "XETRA": { ticker: "VGWL" }, "SIX": { ticker: "VWRL" }, "Euronext": { ticker: "VWRL" } },
    defaultExchange: "LSE",
  }),
  "LU0292100046": I({
    name: "Xtrackers MSCI Korea UCITS ETF 1C",
    isin: "LU0292100046",
    terBps: 45,
    domicile: "Luxembourg",
    replication: "Physical",
    distribution: "Accumulating",
    currency: "USD",
    comment: "Xtrackers MSCI Korea — large/mid-cap Korean stocks, capped 35%/20% to limit single-stock concentration.",
    listings: { "LSE": { ticker: "XKSD" }, "XETRA": { ticker: "DBX8" } },
    defaultExchange: "LSE",
  }),

  // ----- BEGIN auto-added popular-ETFs orphans -----
  // ----------------------------------------------------------------------------
  // Auto-added orphan popular-ETF entries (no BUCKETS assignment).
  // Source: scripts/inject-popular-etfs.mjs from scripts/data/popular-etfs-staged.json
  // Generated: 2026-05-01. 80 entries.
  // These ISINs are recognised by getInstrumentByIsin() in the Explain
  // manual-entry flow but DO NOT appear in any model-portfolio bucket
  // dropdown (which iterates BUCKETS).
  // ----------------------------------------------------------------------------
  "IE00B4L5Y983": I({
    name: "iShares Core MSCI World UCITS ETF USD (Acc)",
    isin: "IE00B4L5Y983",
    terBps: 20,
    domicile: "Ireland",
    replication: "Physical",
    distribution: "Accumulating",
    currency: "USD",
    comment: "Popular UCITS ETF auto-added on 2026-05-01 as orphan catalog entry — recognised in Explain manual-entry but not assigned to any model-portfolio bucket. Seed note: iShares Core MSCI World UCITS Acc.",
    listings: { LSE: { ticker: "IWDA" }, XETRA: { ticker: "EUNL" }, SIX: { ticker: "SWDA" }, Euronext: { ticker: "IWDA" } },
    defaultExchange: "LSE",
    aumMillionsEUR: 115407,
    inceptionDate: "2009-09-25",
  }),
  "IE00B0M62Q58": I({
    name: "iShares MSCI World UCITS ETF (Dist)",
    isin: "IE00B0M62Q58",
    terBps: 50,
    domicile: "Ireland",
    replication: "Physical",
    distribution: "Distributing",
    currency: "USD",
    comment: "Popular UCITS ETF auto-added on 2026-05-01 as orphan catalog entry — recognised in Explain manual-entry but not assigned to any model-portfolio bucket. Seed note: iShares MSCI World UCITS Dist.",
    listings: { LSE: { ticker: "IDWR" }, XETRA: { ticker: "IQQW" }, SIX: { ticker: "IWRD" }, Euronext: { ticker: "IWRD" } },
    defaultExchange: "LSE",
    aumMillionsEUR: 7587,
    inceptionDate: "2005-10-28",
  }),
  "IE00BFY0GT14": I({
    name: "State Street SPDR MSCI World UCITS ETF USD Unhedged",
    isin: "IE00BFY0GT14",
    terBps: 12,
    domicile: "Ireland",
    replication: "Physical",
    distribution: "Accumulating",
    currency: "USD",
    comment: "Popular UCITS ETF auto-added on 2026-05-01 as orphan catalog entry — recognised in Explain manual-entry but not assigned to any model-portfolio bucket. Seed note: SPDR MSCI World UCITS Acc.",
    listings: { LSE: { ticker: "SWRD" }, XETRA: { ticker: "SPPW" }, SIX: { ticker: "SWRD" }, Euronext: { ticker: "SWRD" } },
    defaultExchange: "LSE",
    aumMillionsEUR: 15101,
    inceptionDate: "2019-02-28",
  }),
  "LU0274208692": I({
    name: "Xtrackers MSCI World Swap UCITS ETF 1C",
    isin: "LU0274208692",
    terBps: 45,
    domicile: "Luxembourg",
    replication: "Synthetic",
    distribution: "Accumulating",
    currency: "USD",
    comment: "Popular UCITS ETF auto-added on 2026-05-01 as orphan catalog entry — recognised in Explain manual-entry but not assigned to any model-portfolio bucket. Seed note: Xtrackers MSCI World UCITS 1C.",
    listings: { LSE: { ticker: "XMWD" }, XETRA: { ticker: "DBXW" }, SIX: { ticker: "XMWO" } },
    defaultExchange: "LSE",
    aumMillionsEUR: 4865,
    inceptionDate: "2006-12-19",
  }),
  "IE00BK5BQV03": I({
    name: "Vanguard FTSE Developed World UCITS ETF Acc",
    isin: "IE00BK5BQV03",
    terBps: 12,
    domicile: "Ireland",
    replication: "Physical",
    distribution: "Accumulating",
    currency: "USD",
    comment: "Popular UCITS ETF auto-added on 2026-05-01 as orphan catalog entry — recognised in Explain manual-entry but not assigned to any model-portfolio bucket. Seed note: Vanguard ESG Global All Cap UCITS Acc.",
    listings: { LSE: { ticker: "VHVE" }, XETRA: { ticker: "VGVF" } },
    defaultExchange: "LSE",
    aumMillionsEUR: 5453,
    inceptionDate: "2019-09-24",
  }),
  "IE0031442068": I({
    name: "iShares Core S&P 500 UCITS ETF USD (Dist)",
    isin: "IE0031442068",
    terBps: 7,
    domicile: "Ireland",
    replication: "Physical",
    distribution: "Distributing",
    currency: "USD",
    comment: "Popular UCITS ETF auto-added on 2026-05-01 as orphan catalog entry — recognised in Explain manual-entry but not assigned to any model-portfolio bucket. Seed note: iShares Core S&P 500 UCITS Dist.",
    listings: { LSE: { ticker: "IDUS" }, XETRA: { ticker: "IUSA" }, SIX: { ticker: "IUSA" }, Euronext: { ticker: "IUSA" } },
    defaultExchange: "LSE",
    aumMillionsEUR: 17723,
    inceptionDate: "2002-03-15",
  }),
  "IE00BYTRRD19": I({
    name: "State Street SPDR MSCI World Technology UCITS ETF USD",
    isin: "IE00BYTRRD19",
    terBps: 30,
    domicile: "Ireland",
    replication: "Physical",
    distribution: "Accumulating",
    currency: "USD",
    comment: "Popular UCITS ETF auto-added on 2026-05-01 as orphan catalog entry — recognised in Explain manual-entry but not assigned to any model-portfolio bucket. Seed note: Invesco S&P 500 UCITS Acc (synthetic alt).",
    listings: { LSE: { ticker: "WTEC" }, XETRA: { ticker: "SPFT" }, SIX: { ticker: "WTEC" }, Euronext: { ticker: "WTCH" } },
    defaultExchange: "LSE",
    aumMillionsEUR: 951,
    inceptionDate: "2016-04-29",
  }),
  "IE0032077012": I({
    name: "Invesco EQQQ Nasdaq-100 UCITS ETF",
    isin: "IE0032077012",
    terBps: 30,
    domicile: "Ireland",
    replication: "Physical",
    distribution: "Distributing",
    currency: "USD",
    comment: "Popular UCITS ETF auto-added on 2026-05-01 as orphan catalog entry — recognised in Explain manual-entry but not assigned to any model-portfolio bucket. Seed note: Invesco EQQQ Nasdaq-100 UCITS Dist.",
    listings: { LSE: { ticker: "EQQU" }, XETRA: { ticker: "EQQQ" }, SIX: { ticker: "EQQQ" }, Euronext: { ticker: "EQQQ" } },
    defaultExchange: "LSE",
    aumMillionsEUR: 9887,
    inceptionDate: "2002-12-02",
  }),
  "IE00BMFKG444": I({
    name: "Xtrackers Nasdaq 100 UCITS ETF 1C",
    isin: "IE00BMFKG444",
    terBps: 20,
    domicile: "Ireland",
    replication: "Physical",
    distribution: "Accumulating",
    currency: "USD",
    comment: "Popular UCITS ETF auto-added on 2026-05-01 as orphan catalog entry — recognised in Explain manual-entry but not assigned to any model-portfolio bucket. Seed note: Invesco EQQQ Nasdaq-100 UCITS Acc.",
    listings: { LSE: { ticker: "XNAS" }, XETRA: { ticker: "XNAS" }, SIX: { ticker: "XNAS" } },
    defaultExchange: "LSE",
    aumMillionsEUR: 1781,
    inceptionDate: "2021-01-21",
  }),
  "IE00BYVQ9F29": I({
    name: "iShares Nasdaq 100 UCITS ETF EUR Hedged Acc",
    isin: "IE00BYVQ9F29",
    terBps: 33,
    domicile: "Ireland",
    replication: "Physical",
    distribution: "Accumulating",
    currency: "EUR",
    comment: "Popular UCITS ETF auto-added on 2026-05-01 as orphan catalog entry — recognised in Explain manual-entry but not assigned to any model-portfolio bucket. Seed note: iShares Nasdaq 100 EUR Hedged UCITS.",
    listings: { XETRA: { ticker: "NQSE" } },
    defaultExchange: "XETRA",
    aumMillionsEUR: 2007,
    inceptionDate: "2018-09-10",
  }),
  "LU1681038243": I({
    name: "Amundi Nasdaq-100 Swap UCITS ETF EUR Acc",
    isin: "LU1681038243",
    terBps: 23,
    domicile: "Luxembourg",
    replication: "Synthetic",
    distribution: "Accumulating",
    currency: "EUR",
    comment: "Popular UCITS ETF auto-added on 2026-05-01 as orphan catalog entry — recognised in Explain manual-entry but not assigned to any model-portfolio bucket. Seed note: Lyxor Nasdaq-100 UCITS Acc (Amundi).",
    listings: { XETRA: { ticker: "6AQQ" }, Euronext: { ticker: "ANX" } },
    defaultExchange: "XETRA",
    aumMillionsEUR: 1449,
    inceptionDate: "2010-06-08",
  }),
  "IE00B0M62S72": I({
    name: "iShares Euro Dividend UCITS ETF",
    isin: "IE00B0M62S72",
    terBps: 40,
    domicile: "Ireland",
    replication: "Physical",
    distribution: "Distributing",
    currency: "EUR",
    comment: "Popular UCITS ETF auto-added on 2026-05-01 as orphan catalog entry — recognised in Explain manual-entry but not assigned to any model-portfolio bucket. Seed note: iShares STOXX Europe 600 UCITS Dist.",
    listings: { LSE: { ticker: "IDVY" }, XETRA: { ticker: "IQQA" }, SIX: { ticker: "IDVY" }, Euronext: { ticker: "IDVY" } },
    defaultExchange: "LSE",
    aumMillionsEUR: 1442,
    inceptionDate: "2005-10-28",
  }),
  "DE0002635307": I({
    name: "iShares STOXX Europe 600 UCITS ETF (DE)",
    isin: "DE0002635307",
    terBps: 20,
    domicile: "Germany",
    replication: "Physical",
    distribution: "Distributing",
    currency: "EUR",
    comment: "Popular UCITS ETF auto-added on 2026-05-01 as orphan catalog entry — recognised in Explain manual-entry but not assigned to any model-portfolio bucket. Seed note: iShares STOXX Europe 600 UCITS Dist (DE share class).",
    listings: { XETRA: { ticker: "EXSA" }, SIX: { ticker: "SXPIEX" } },
    defaultExchange: "XETRA",
    aumMillionsEUR: 8904,
    inceptionDate: "2004-02-13",
  }),
  "LU0908500753": I({
    name: "Amundi Core Stoxx Europe 600 UCITS ETF Acc",
    isin: "LU0908500753",
    terBps: 7,
    domicile: "Luxembourg",
    replication: "Physical",
    distribution: "Accumulating",
    currency: "EUR",
    comment: "Popular UCITS ETF auto-added on 2026-05-01 as orphan catalog entry — recognised in Explain manual-entry but not assigned to any model-portfolio bucket. Seed note: Lyxor STOXX Europe 600 UCITS Acc.",
    listings: { LSE: { ticker: "MEUS" }, XETRA: { ticker: "LYP6" }, Euronext: { ticker: "MEUD" } },
    defaultExchange: "LSE",
    aumMillionsEUR: 17674,
    inceptionDate: "2013-04-03",
  }),
  "IE00BKM4H312": I({
    name: "iShares MSCI USA Quality Dividend Advanced UCITS ETF USD (Dist)",
    isin: "IE00BKM4H312",
    terBps: 35,
    domicile: "Ireland",
    replication: "Physical",
    distribution: "Distributing",
    currency: "USD",
    comment: "Popular UCITS ETF auto-added on 2026-05-01 as orphan catalog entry — recognised in Explain manual-entry but not assigned to any model-portfolio bucket. Seed note: iShares Core MSCI Europe UCITS Dist.",
    listings: { LSE: { ticker: "QDIV" }, XETRA: { ticker: "QDVD" }, SIX: { ticker: "QDIV" } },
    defaultExchange: "LSE",
    aumMillionsEUR: 565,
    inceptionDate: "2014-06-06",
  }),
  "LU0274209237": I({
    name: "Xtrackers MSCI Europe UCITS ETF 1C",
    isin: "LU0274209237",
    terBps: 12,
    domicile: "Luxembourg",
    replication: "Physical",
    distribution: "Accumulating",
    currency: "USD",
    comment: "Popular UCITS ETF auto-added on 2026-05-01 as orphan catalog entry — recognised in Explain manual-entry but not assigned to any model-portfolio bucket. Seed note: Xtrackers MSCI Europe UCITS 1C.",
    listings: { LSE: { ticker: "XMED" }, XETRA: { ticker: "XMEU" }, SIX: { ticker: "XMEU" } },
    defaultExchange: "LSE",
    aumMillionsEUR: 7224,
    inceptionDate: "2007-01-10",
  }),
  "IE00B53L4350": I({
    name: "iShares Dow Jones Industrial Average UCITS ETF (Acc)",
    isin: "IE00B53L4350",
    terBps: 33,
    domicile: "Ireland",
    replication: "Physical",
    distribution: "Accumulating",
    currency: "USD",
    comment: "Popular UCITS ETF auto-added on 2026-05-01 as orphan catalog entry — recognised in Explain manual-entry but not assigned to any model-portfolio bucket. Seed note: iShares Core EURO STOXX 50 UCITS Acc.",
    listings: { LSE: { ticker: "CIND" }, XETRA: { ticker: "SXRU" }, SIX: { ticker: "CSINDU" } },
    defaultExchange: "LSE",
    aumMillionsEUR: 1491,
    inceptionDate: "2010-01-26",
  }),
  "LU0290358497": I({
    name: "Xtrackers II EUR Overnight Rate Swap UCITS ETF 1C",
    isin: "LU0290358497",
    terBps: 10,
    domicile: "Luxembourg",
    replication: "Synthetic",
    distribution: "Accumulating",
    currency: "EUR",
    comment: "Popular UCITS ETF auto-added on 2026-05-01 as orphan catalog entry — recognised in Explain manual-entry but not assigned to any model-portfolio bucket. Seed note: Xtrackers EURO STOXX 50 UCITS 1C.",
    listings: { XETRA: { ticker: "XEON" }, SIX: { ticker: "XEON" } },
    defaultExchange: "XETRA",
    aumMillionsEUR: 20333,
    inceptionDate: "2007-05-25",
  }),
  "IE00B0M62Y33": I({
    name: "iShares AEX UCITS ETF",
    isin: "IE00B0M62Y33",
    terBps: 30,
    domicile: "Ireland",
    replication: "Physical",
    distribution: "Distributing",
    currency: "EUR",
    comment: "Popular UCITS ETF auto-added on 2026-05-01 as orphan catalog entry — recognised in Explain manual-entry but not assigned to any model-portfolio bucket. Seed note: iShares MSCI EMU UCITS.",
    listings: { LSE: { ticker: "IAEX" }, SIX: { ticker: "IAEX" }, Euronext: { ticker: "IAEX" } },
    defaultExchange: "LSE",
    aumMillionsEUR: 683,
    inceptionDate: "2005-11-18",
  }),
  "IE00B0M63177": I({
    name: "iShares MSCI EM UCITS ETF (Dist)",
    isin: "IE00B0M63177",
    terBps: 18,
    domicile: "Ireland",
    replication: "Physical",
    distribution: "Distributing",
    currency: "USD",
    comment: "Popular UCITS ETF auto-added on 2026-05-01 as orphan catalog entry — recognised in Explain manual-entry but not assigned to any model-portfolio bucket. Seed note: iShares MSCI Emerging Markets UCITS Dist.",
    listings: { LSE: { ticker: "IDEM" }, XETRA: { ticker: "IQQE" }, SIX: { ticker: "IEEM" }, Euronext: { ticker: "IEMM" } },
    defaultExchange: "LSE",
    aumMillionsEUR: 8203,
    inceptionDate: "2005-11-18",
  }),
  "LU0292107645": I({
    name: "Xtrackers MSCI Emerging Markets Swap UCITS ETF 1C",
    isin: "LU0292107645",
    terBps: 49,
    domicile: "Luxembourg",
    replication: "Synthetic",
    distribution: "Accumulating",
    currency: "USD",
    comment: "Popular UCITS ETF auto-added on 2026-05-01 as orphan catalog entry — recognised in Explain manual-entry but not assigned to any model-portfolio bucket. Seed note: Xtrackers MSCI Emerging Markets Swap UCITS 1C.",
    listings: { LSE: { ticker: "XMMD" }, XETRA: { ticker: "XMEM" }, SIX: { ticker: "XMEM" } },
    defaultExchange: "LSE",
    aumMillionsEUR: 807,
    inceptionDate: "2007-06-22",
  }),
  "IE00B8KGV557": I({
    name: "iShares Edge MSCI EM Minimum Volatility UCITS ETF",
    isin: "IE00B8KGV557",
    terBps: 40,
    domicile: "Ireland",
    replication: "Physical",
    distribution: "Accumulating",
    currency: "USD",
    comment: "Popular UCITS ETF auto-added on 2026-05-01 as orphan catalog entry — recognised in Explain manual-entry but not assigned to any model-portfolio bucket. Seed note: iShares Edge MSCI EM Min Volatility UCITS.",
    listings: { LSE: { ticker: "EMMV" }, XETRA: { ticker: "EUNZ" }, SIX: { ticker: "EMLV" } },
    defaultExchange: "LSE",
    aumMillionsEUR: 335,
    inceptionDate: "2012-11-30",
  }),
  "IE00B53QDK08": I({
    name: "iShares MSCI Japan UCITS ETF USD (Acc)",
    isin: "IE00B53QDK08",
    terBps: 12,
    domicile: "Ireland",
    replication: "Physical",
    distribution: "Accumulating",
    currency: "USD",
    comment: "Popular UCITS ETF auto-added on 2026-05-01 as orphan catalog entry — recognised in Explain manual-entry but not assigned to any model-portfolio bucket. Seed note: iShares Core MSCI Japan IMI UCITS Dist.",
    listings: { LSE: { ticker: "CJPU" }, XETRA: { ticker: "SXR5" }, SIX: { ticker: "CSJP" }, Euronext: { ticker: "CSJP" } },
    defaultExchange: "LSE",
    aumMillionsEUR: 1211,
    inceptionDate: "2010-01-11",
  }),
  "IE00B02KXH56": I({
    name: "iShares MSCI Japan UCITS ETF (Dist)",
    isin: "IE00B02KXH56",
    terBps: 12,
    domicile: "Ireland",
    replication: "Physical",
    distribution: "Distributing",
    currency: "USD",
    comment: "Popular UCITS ETF auto-added on 2026-05-01 as orphan catalog entry — recognised in Explain manual-entry but not assigned to any model-portfolio bucket. Seed note: iShares MSCI Japan UCITS Dist.",
    listings: { LSE: { ticker: "IJPU" }, XETRA: { ticker: "IQQJ" }, SIX: { ticker: "IJPN" }, Euronext: { ticker: "IJPN" } },
    defaultExchange: "LSE",
    aumMillionsEUR: 2189,
    inceptionDate: "2004-10-01",
  }),
  "LU0274209740": I({
    name: "Xtrackers MSCI Japan UCITS ETF 1C",
    isin: "LU0274209740",
    terBps: 12,
    domicile: "Luxembourg",
    replication: "Physical",
    distribution: "Accumulating",
    currency: "USD",
    comment: "Popular UCITS ETF auto-added on 2026-05-01 as orphan catalog entry — recognised in Explain manual-entry but not assigned to any model-portfolio bucket. Seed note: Xtrackers MSCI Japan UCITS 1C.",
    listings: { LSE: { ticker: "XMJD" }, XETRA: { ticker: "DBXJ" }, SIX: { ticker: "XMJP" } },
    defaultExchange: "LSE",
    aumMillionsEUR: 4910,
    inceptionDate: "2007-01-09",
  }),
  "IE00B52MJY50": I({
    name: "iShares Core MSCI Pacific ex Japan UCITS ETF (Acc)",
    isin: "IE00B52MJY50",
    terBps: 20,
    domicile: "Ireland",
    replication: "Physical",
    distribution: "Accumulating",
    currency: "USD",
    comment: "Popular UCITS ETF auto-added on 2026-05-01 as orphan catalog entry — recognised in Explain manual-entry but not assigned to any model-portfolio bucket. Seed note: iShares Core MSCI Pacific ex-Japan UCITS.",
    listings: { LSE: { ticker: "CPXJ" }, XETRA: { ticker: "SXR1" }, SIX: { ticker: "CSPXJ" }, Euronext: { ticker: "CPXJ" } },
    defaultExchange: "LSE",
    aumMillionsEUR: 3186,
    inceptionDate: "2010-01-12",
  }),
  "IE00B0M63730": I({
    name: "iShares MSCI AC Far East ex-Japan UCITS ETF",
    isin: "IE00B0M63730",
    terBps: 74,
    domicile: "Ireland",
    replication: "Physical",
    distribution: "Distributing",
    currency: "USD",
    comment: "Popular UCITS ETF auto-added on 2026-05-01 as orphan catalog entry — recognised in Explain manual-entry but not assigned to any model-portfolio bucket. Seed note: iShares MSCI AC Far East ex-Japan UCITS.",
    listings: { LSE: { ticker: "IDFF" }, XETRA: { ticker: "IQQF" }, SIX: { ticker: "IFFF" }, Euronext: { ticker: "IFFF" } },
    defaultExchange: "LSE",
    aumMillionsEUR: 1361,
    inceptionDate: "2005-10-28",
  }),
  "DE0005933931": I({
    name: "iShares Core DAX® UCITS ETF (DE) EUR (Acc)",
    isin: "DE0005933931",
    terBps: 16,
    domicile: "Germany",
    replication: "Physical",
    distribution: "Accumulating",
    currency: "EUR",
    comment: "Popular UCITS ETF auto-added on 2026-05-01 as orphan catalog entry — recognised in Explain manual-entry but not assigned to any model-portfolio bucket. Seed note: iShares Core DAX UCITS.",
    listings: { XETRA: { ticker: "EXS1" }, SIX: { ticker: "DAXEX" }, Euronext: { ticker: "EXS1" } },
    defaultExchange: "XETRA",
    aumMillionsEUR: 8362,
    inceptionDate: "2000-12-27",
  }),
  "LU0274211480": I({
    name: "Xtrackers DAX UCITS ETF 1C",
    isin: "LU0274211480",
    terBps: 9,
    domicile: "Luxembourg",
    replication: "Physical",
    distribution: "Accumulating",
    currency: "EUR",
    comment: "Popular UCITS ETF auto-added on 2026-05-01 as orphan catalog entry — recognised in Explain manual-entry but not assigned to any model-portfolio bucket. Seed note: Xtrackers DAX UCITS 1C.",
    listings: { LSE: { ticker: "OXDX" }, XETRA: { ticker: "DBXD" }, SIX: { ticker: "XDAX" } },
    defaultExchange: "LSE",
    aumMillionsEUR: 6750,
    inceptionDate: "2007-01-10",
  }),
  "CH0008899764": I({
    name: "iShares SMI (CH)",
    isin: "CH0008899764",
    terBps: 35,
    domicile: "Switzerland",
    replication: "Physical",
    distribution: "Distributing",
    currency: "CHF",
    comment: "Popular UCITS ETF auto-added on 2026-05-01 as orphan catalog entry — recognised in Explain manual-entry but not assigned to any model-portfolio bucket. Seed note: iShares SMI ETF (CH).",
    listings: { SIX: { ticker: "CSSMI" } },
    defaultExchange: "SIX",
    aumMillionsEUR: 2562,
    inceptionDate: "1999-10-06",
  }),
  "IE00BZCQB185": I({
    name: "iShares MSCI India UCITS ETF USD (Acc)",
    isin: "IE00BZCQB185",
    terBps: 65,
    domicile: "Ireland",
    replication: "Physical",
    distribution: "Accumulating",
    currency: "USD",
    comment: "Popular UCITS ETF auto-added on 2026-05-01 as orphan catalog entry — recognised in Explain manual-entry but not assigned to any model-portfolio bucket. Seed note: iShares MSCI India UCITS.",
    listings: { LSE: { ticker: "NDIA" }, XETRA: { ticker: "QDV5" }, Euronext: { ticker: "NDIA" } },
    defaultExchange: "LSE",
    aumMillionsEUR: 4391,
    inceptionDate: "2018-05-24",
  }),
  "IE00BFMXYX26": I({
    name: "Vanguard FTSE Japan UCITS ETF (USD) Accumulating",
    isin: "IE00BFMXYX26",
    terBps: 10,
    domicile: "Ireland",
    replication: "Physical",
    distribution: "Accumulating",
    currency: "USD",
    comment: "Popular UCITS ETF auto-added on 2026-05-01 as orphan catalog entry — recognised in Explain manual-entry but not assigned to any model-portfolio bucket. Seed note: iShares MSCI China A UCITS.",
    listings: { LSE: { ticker: "VJPA" }, XETRA: { ticker: "VJPA" }, SIX: { ticker: "VJPA" } },
    defaultExchange: "LSE",
    aumMillionsEUR: 1142,
    inceptionDate: "2019-09-24",
  }),
  "IE00B02KXK85": I({
    name: "iShares China Large Cap UCITS ETF",
    isin: "IE00B02KXK85",
    terBps: 74,
    domicile: "Ireland",
    replication: "Physical",
    distribution: "Distributing",
    currency: "USD",
    comment: "Popular UCITS ETF auto-added on 2026-05-01 as orphan catalog entry — recognised in Explain manual-entry but not assigned to any model-portfolio bucket. Seed note: iShares MSCI China UCITS.",
    listings: { LSE: { ticker: "IDFX" }, XETRA: { ticker: "IQQC" }, SIX: { ticker: "FXC" }, Euronext: { ticker: "FXC" } },
    defaultExchange: "LSE",
    aumMillionsEUR: 805,
    inceptionDate: "2004-10-21",
  }),
  "IE00B4K6B022": I({
    name: "HSBC EURO STOXX 50 UCITS ETF EUR",
    isin: "IE00B4K6B022",
    terBps: 5,
    domicile: "Ireland",
    replication: "Physical",
    distribution: "Distributing",
    currency: "EUR",
    comment: "Popular UCITS ETF auto-added on 2026-05-01 as orphan catalog entry — recognised in Explain manual-entry but not assigned to any model-portfolio bucket. Seed note: iShares S&P 500 Health Care Sector UCITS.",
    listings: { LSE: { ticker: "H50E" }, XETRA: { ticker: "H4ZA" }, SIX: { ticker: "H50E" }, Euronext: { ticker: "50E" } },
    defaultExchange: "LSE",
    aumMillionsEUR: 1398,
    inceptionDate: "2009-10-05",
  }),
  "IE00B40B8R38": I({
    name: "iShares S&P 500 Consumer Staples Sector UCITS ETF",
    isin: "IE00B40B8R38",
    terBps: 15,
    domicile: "Ireland",
    replication: "Physical",
    distribution: "Accumulating",
    currency: "USD",
    comment: "Popular UCITS ETF auto-added on 2026-05-01 as orphan catalog entry — recognised in Explain manual-entry but not assigned to any model-portfolio bucket. Seed note: iShares S&P 500 Consumer Staples Sector UCITS.",
    listings: { LSE: { ticker: "IUCS" }, XETRA: { ticker: "2B7D" }, SIX: { ticker: "IUCS" } },
    defaultExchange: "LSE",
    aumMillionsEUR: 392,
    inceptionDate: "2017-03-20",
  }),
  "IE00BMW42181": I({
    name: "iShares MSCI Europe Health Care Sector UCITS ETF EUR (Acc)",
    isin: "IE00BMW42181",
    terBps: 18,
    domicile: "Ireland",
    replication: "Physical",
    distribution: "Accumulating",
    currency: "EUR",
    comment: "Popular UCITS ETF auto-added on 2026-05-01 as orphan catalog entry — recognised in Explain manual-entry but not assigned to any model-portfolio bucket. Seed note: iShares Global Clean Energy UCITS.",
    listings: { LSE: { ticker: "ESIH" }, XETRA: { ticker: "ESIH" } },
    defaultExchange: "LSE",
    aumMillionsEUR: 830,
    inceptionDate: "2020-11-17",
  }),
  "IE00BYZK4552": I({
    name: "iShares Automation & Robotics UCITS ETF",
    isin: "IE00BYZK4552",
    terBps: 40,
    domicile: "Ireland",
    replication: "Physical",
    distribution: "Accumulating",
    currency: "USD",
    comment: "Popular UCITS ETF auto-added on 2026-05-01 as orphan catalog entry — recognised in Explain manual-entry but not assigned to any model-portfolio bucket. Seed note: iShares Automation & Robotics UCITS.",
    listings: { LSE: { ticker: "RBOT" }, XETRA: { ticker: "2B76" }, SIX: { ticker: "RBOT" }, Euronext: { ticker: "RBOE" } },
    defaultExchange: "LSE",
    aumMillionsEUR: 3750,
    inceptionDate: "2016-09-08",
  }),
  "IE00BGV5VN51": I({
    name: "Xtrackers Artificial Intelligence & Big Data UCITS ETF 1C",
    isin: "IE00BGV5VN51",
    terBps: 35,
    domicile: "Ireland",
    replication: "Physical",
    distribution: "Accumulating",
    currency: "USD",
    comment: "Popular UCITS ETF auto-added on 2026-05-01 as orphan catalog entry — recognised in Explain manual-entry but not assigned to any model-portfolio bucket. Seed note: iShares Digital Security UCITS.",
    listings: { LSE: { ticker: "XAID" }, XETRA: { ticker: "XAIX" }, SIX: { ticker: "XAIX" } },
    defaultExchange: "LSE",
    aumMillionsEUR: 6143,
    inceptionDate: "2019-01-29",
  }),
  "IE00BYWQWR46": I({
    name: "VanEck Video Gaming and eSports UCITS ETF",
    isin: "IE00BYWQWR46",
    terBps: 55,
    domicile: "Ireland",
    replication: "Physical",
    distribution: "Accumulating",
    currency: "USD",
    comment: "Popular UCITS ETF auto-added on 2026-05-01 as orphan catalog entry — recognised in Explain manual-entry but not assigned to any model-portfolio bucket. Seed note: iShares Healthcare Innovation UCITS.",
    listings: { LSE: { ticker: "ESPO" }, XETRA: { ticker: "ESP0" }, SIX: { ticker: "ESPO" }, Euronext: { ticker: "ESPO" } },
    defaultExchange: "LSE",
    aumMillionsEUR: 564,
    inceptionDate: "2019-06-24",
  }),
  "IE00BYZK4883": I({
    name: "iShares Digitalisation UCITS ETF",
    isin: "IE00BYZK4883",
    terBps: 40,
    domicile: "Ireland",
    replication: "Physical",
    distribution: "Accumulating",
    currency: "USD",
    comment: "Popular UCITS ETF auto-added on 2026-05-01 as orphan catalog entry — recognised in Explain manual-entry but not assigned to any model-portfolio bucket. Seed note: iShares Ageing Population UCITS.",
    listings: { LSE: { ticker: "DGTL" }, XETRA: { ticker: "2B79" }, SIX: { ticker: "DGTL" }, Euronext: { ticker: "DGTL" } },
    defaultExchange: "LSE",
    aumMillionsEUR: 598,
    inceptionDate: "2016-09-08",
  }),
  "IE00BMDX0K95": I({
    name: "CSIF (IE) FTSE EPRA Nareit Developed Green Blue UCITS ETF A USD",
    isin: "IE00BMDX0K95",
    terBps: 25,
    domicile: "Ireland",
    replication: "Physical",
    distribution: "Distributing",
    currency: "USD",
    comment: "Popular UCITS ETF auto-added on 2026-05-01 as orphan catalog entry — recognised in Explain manual-entry but not assigned to any model-portfolio bucket. Seed note: iShares Smart City Infrastructure UCITS.",
    listings: { XETRA: { ticker: "CSYZ" }, SIX: { ticker: "GREIT" } },
    defaultExchange: "XETRA",
    aumMillionsEUR: 164,
    inceptionDate: "2020-06-26",
  }),
  "IE00BJK9H753": I({
    name: "JPMorgan BetaBuilders US Equity UCITS ETF (Acc)",
    isin: "IE00BJK9H753",
    terBps: 4,
    domicile: "Ireland",
    replication: "Physical",
    distribution: "Accumulating",
    currency: "USD",
    comment: "Popular UCITS ETF auto-added on 2026-05-01 as orphan catalog entry — recognised in Explain manual-entry but not assigned to any model-portfolio bucket. Seed note: L&G Hydrogen Economy UCITS.",
    listings: { LSE: { ticker: "BBUS" }, XETRA: { ticker: "BBUS" }, SIX: { ticker: "BBUS" } },
    defaultExchange: "LSE",
    aumMillionsEUR: 75,
    inceptionDate: "2019-05-06",
  }),
  "IE00BMWXKN31": I({
    name: "HSBC Hang Seng TECH UCITS ETF HKD",
    isin: "IE00BMWXKN31",
    terBps: 50,
    domicile: "Ireland",
    replication: "Physical",
    distribution: "Accumulating",
    currency: "HKD",
    comment: "Popular UCITS ETF auto-added on 2026-05-01 as orphan catalog entry — recognised in Explain manual-entry but not assigned to any model-portfolio bucket. Seed note: WisdomTree Artificial Intelligence UCITS Acc.",
    listings: { LSE: { ticker: "HSTE" }, XETRA: { ticker: "H4ZX" }, SIX: { ticker: "HSTE" }, Euronext: { ticker: "HSTE" } },
    defaultExchange: "LSE",
    aumMillionsEUR: 1381,
    inceptionDate: "2020-12-09",
  }),
  "IE00BJ5JNZ06": I({
    name: "iShares MSCI World Health Care Sector Advanced UCITS ETF USD (Dist)",
    isin: "IE00BJ5JNZ06",
    terBps: 18,
    domicile: "Ireland",
    replication: "Physical",
    distribution: "Distributing",
    currency: "USD",
    comment: "Popular UCITS ETF auto-added on 2026-05-01 as orphan catalog entry — recognised in Explain manual-entry but not assigned to any model-portfolio bucket. Seed note: WisdomTree Cybersecurity UCITS Acc.",
    listings: { XETRA: { ticker: "CBUF" }, SIX: { ticker: "WHCS" }, Euronext: { ticker: "WHCS" } },
    defaultExchange: "XETRA",
    aumMillionsEUR: 480,
    inceptionDate: "2019-10-17",
  }),
  "IE000U9ODG19": I({
    name: "iShares Global Aerospace & Defence UCITS ETF USD (Acc)",
    isin: "IE000U9ODG19",
    terBps: 35,
    domicile: "Ireland",
    replication: "Physical",
    distribution: "Accumulating",
    currency: "USD",
    comment: "Popular UCITS ETF auto-added on 2026-05-01 as orphan catalog entry — recognised in Explain manual-entry but not assigned to any model-portfolio bucket. Seed note: VanEck Defense UCITS ETF Acc.",
    listings: { LSE: { ticker: "DFND" }, XETRA: { ticker: "5J50" }, SIX: { ticker: "DFND" }, Euronext: { ticker: "DFND" } },
    defaultExchange: "LSE",
    aumMillionsEUR: 1482,
    inceptionDate: "2024-02-01",
  }),
  "IE00BMC38736": I({
    name: "VanEck Semiconductor UCITS ETF",
    isin: "IE00BMC38736",
    terBps: 35,
    domicile: "Ireland",
    replication: "Physical",
    distribution: "Accumulating",
    currency: "USD",
    comment: "Popular UCITS ETF auto-added on 2026-05-01 as orphan catalog entry — recognised in Explain manual-entry but not assigned to any model-portfolio bucket. Seed note: HANetf Future of Defence UCITS.",
    listings: { LSE: { ticker: "SMH" }, XETRA: { ticker: "VVSM" }, SIX: { ticker: "SMHV" }, Euronext: { ticker: "SMH" } },
    defaultExchange: "LSE",
    aumMillionsEUR: 5289,
    inceptionDate: "2020-12-01",
  }),
  "IE00BMW3QX54": I({
    name: "L&G ROBO Global Robotics and Automation UCITS ETF",
    isin: "IE00BMW3QX54",
    terBps: 80,
    domicile: "Ireland",
    replication: "Physical",
    distribution: "Accumulating",
    currency: "USD",
    comment: "Popular UCITS ETF auto-added on 2026-05-01 as orphan catalog entry — recognised in Explain manual-entry but not assigned to any model-portfolio bucket. Seed note: iShares Electric Vehicles & Driving Tech UCITS.",
    listings: { LSE: { ticker: "ROBO" }, XETRA: { ticker: "IROB" }, SIX: { ticker: "ROBO" }, Euronext: { ticker: "ROBO" } },
    defaultExchange: "LSE",
    aumMillionsEUR: 1139,
    inceptionDate: "2014-10-27",
  }),
  "IE00BP3QZ601": I({
    name: "iShares Edge MSCI World Quality Factor UCITS ETF (Acc)",
    isin: "IE00BP3QZ601",
    terBps: 25,
    domicile: "Ireland",
    replication: "Physical",
    distribution: "Accumulating",
    currency: "USD",
    comment: "Popular UCITS ETF auto-added on 2026-05-01 as orphan catalog entry — recognised in Explain manual-entry but not assigned to any model-portfolio bucket. Seed note: iShares Edge MSCI World Quality Factor UCITS.",
    listings: { LSE: { ticker: "IWQU" }, XETRA: { ticker: "IS3Q" }, SIX: { ticker: "IWQU" } },
    defaultExchange: "LSE",
    aumMillionsEUR: 4235,
    inceptionDate: "2014-10-03",
  }),
  "IE00BP3QZB59": I({
    name: "iShares Edge MSCI World Value Factor UCITS ETF",
    isin: "IE00BP3QZB59",
    terBps: 25,
    domicile: "Ireland",
    replication: "Physical",
    distribution: "Accumulating",
    currency: "USD",
    comment: "Popular UCITS ETF auto-added on 2026-05-01 as orphan catalog entry — recognised in Explain manual-entry but not assigned to any model-portfolio bucket. Seed note: iShares Edge MSCI World Momentum Factor UCITS.",
    listings: { LSE: { ticker: "IWVL" }, XETRA: { ticker: "IS3S" }, SIX: { ticker: "IWVL" } },
    defaultExchange: "LSE",
    aumMillionsEUR: 5457,
    inceptionDate: "2014-10-03",
  }),
  "IE00BP3QZ825": I({
    name: "iShares Edge MSCI World Momentum Factor UCITS ETF (Acc)",
    isin: "IE00BP3QZ825",
    terBps: 25,
    domicile: "Ireland",
    replication: "Physical",
    distribution: "Accumulating",
    currency: "USD",
    comment: "Popular UCITS ETF auto-added on 2026-05-01 as orphan catalog entry — recognised in Explain manual-entry but not assigned to any model-portfolio bucket. Seed note: iShares Edge MSCI World Value Factor UCITS.",
    listings: { LSE: { ticker: "IWMO" }, XETRA: { ticker: "IS3R" }, SIX: { ticker: "IWMO" } },
    defaultExchange: "LSE",
    aumMillionsEUR: 3797,
    inceptionDate: "2014-10-03",
  }),
  "IE00BD1F4M44": I({
    name: "iShares Edge MSCI USA Value Factor UCITS ETF",
    isin: "IE00BD1F4M44",
    terBps: 20,
    domicile: "Ireland",
    replication: "Physical",
    distribution: "Accumulating",
    currency: "USD",
    comment: "Popular UCITS ETF auto-added on 2026-05-01 as orphan catalog entry — recognised in Explain manual-entry but not assigned to any model-portfolio bucket. Seed note: iShares Edge MSCI World Minimum Volatility UCITS.",
    listings: { LSE: { ticker: "IUVL" }, XETRA: { ticker: "QDVI" }, SIX: { ticker: "IUVL" } },
    defaultExchange: "LSE",
    aumMillionsEUR: 3828,
    inceptionDate: "2016-10-13",
  }),
  "IE00B6YX5D40": I({
    name: "State Street SPDR S&P U.S. Dividend Aristocrats UCITS ETF USD Unhedged (Dist)",
    isin: "IE00B6YX5D40",
    terBps: 35,
    domicile: "Ireland",
    replication: "Physical",
    distribution: "Distributing",
    currency: "USD",
    comment: "Popular UCITS ETF auto-added on 2026-05-01 as orphan catalog entry — recognised in Explain manual-entry but not assigned to any model-portfolio bucket. Seed note: SPDR S&P US Dividend Aristocrats UCITS.",
    listings: { LSE: { ticker: "UDVD" }, XETRA: { ticker: "SPYD" }, SIX: { ticker: "USDV" } },
    defaultExchange: "LSE",
    aumMillionsEUR: 3071,
    inceptionDate: "2011-10-14",
  }),
  "IE00B9CQXS71": I({
    name: "State Street SPDR S&P Global Dividend Aristocrats UCITS ETF USD",
    isin: "IE00B9CQXS71",
    terBps: 45,
    domicile: "Ireland",
    replication: "Physical",
    distribution: "Distributing",
    currency: "USD",
    comment: "Popular UCITS ETF auto-added on 2026-05-01 as orphan catalog entry — recognised in Explain manual-entry but not assigned to any model-portfolio bucket. Seed note: SPDR S&P Global Dividend Aristocrats UCITS.",
    listings: { LSE: { ticker: "GLDV" }, XETRA: { ticker: "ZPRG" }, SIX: { ticker: "GLDV" } },
    defaultExchange: "LSE",
    aumMillionsEUR: 1335,
    inceptionDate: "2013-05-14",
  }),
  "IE00B5M1WJ87": I({
    name: "State Street SPDR S&P Euro Dividend Aristocrats UCITS ETF EUR",
    isin: "IE00B5M1WJ87",
    terBps: 30,
    domicile: "Ireland",
    replication: "Physical",
    distribution: "Distributing",
    currency: "EUR",
    comment: "Popular UCITS ETF auto-added on 2026-05-01 as orphan catalog entry — recognised in Explain manual-entry but not assigned to any model-portfolio bucket. Seed note: Vanguard FTSE All-World High Dividend Yield UCITS.",
    listings: { LSE: { ticker: "EUDI" }, XETRA: { ticker: "SPYW" }, SIX: { ticker: "EUDV" }, Euronext: { ticker: "EUDV" } },
    defaultExchange: "LSE",
    aumMillionsEUR: 1617,
    inceptionDate: "2012-02-28",
  }),
  "IE00BCHWNQ94": I({
    name: "Xtrackers MSCI World Screened UCITS ETF 1D",
    isin: "IE00BCHWNQ94",
    terBps: 19,
    domicile: "Ireland",
    replication: "Physical",
    distribution: "Distributing",
    currency: "USD",
    comment: "Popular UCITS ETF auto-added on 2026-05-01 as orphan catalog entry — recognised in Explain manual-entry but not assigned to any model-portfolio bucket. Seed note: Vanguard FTSE All-World High Dividend Yield UCITS Acc.",
    listings: { LSE: { ticker: "XDWY" }, XETRA: { ticker: "XDWY" } },
    defaultExchange: "LSE",
    aumMillionsEUR: 122,
    inceptionDate: "2018-03-26",
  }),
  "IE00B652H904": I({
    name: "iShares Emerging Markets Dividend UCITS ETF",
    isin: "IE00B652H904",
    terBps: 65,
    domicile: "Ireland",
    replication: "Physical",
    distribution: "Distributing",
    currency: "USD",
    comment: "Popular UCITS ETF auto-added on 2026-05-01 as orphan catalog entry — recognised in Explain manual-entry but not assigned to any model-portfolio bucket. Seed note: iShares EURO Dividend UCITS.",
    listings: { LSE: { ticker: "IEDY" }, XETRA: { ticker: "EUNY" }, SIX: { ticker: "IEDY" } },
    defaultExchange: "LSE",
    aumMillionsEUR: 1199,
    inceptionDate: "2011-11-25",
  }),
  "IE00B3VWMM18": I({
    name: "iShares MSCI EMU Small Cap UCITS ETF (Acc)",
    isin: "IE00B3VWMM18",
    terBps: 58,
    domicile: "Ireland",
    replication: "Physical",
    distribution: "Accumulating",
    currency: "EUR",
    comment: "Popular UCITS ETF auto-added on 2026-05-01 as orphan catalog entry — recognised in Explain manual-entry but not assigned to any model-portfolio bucket. Seed note: iShares MSCI World Small Cap UCITS.",
    listings: { LSE: { ticker: "CSEMUS" }, XETRA: { ticker: "SXRJ" }, SIX: { ticker: "CSEMUS" } },
    defaultExchange: "LSE",
    aumMillionsEUR: 962,
    inceptionDate: "2009-07-01",
  }),
  "IE00BCBJG560": I({
    name: "State Street SPDR MSCI World Small Cap UCITS ETF USD Unhedged (Acc)",
    isin: "IE00BCBJG560",
    terBps: 45,
    domicile: "Ireland",
    replication: "Physical",
    distribution: "Accumulating",
    currency: "USD",
    comment: "Popular UCITS ETF auto-added on 2026-05-01 as orphan catalog entry — recognised in Explain manual-entry but not assigned to any model-portfolio bucket. Seed note: SPDR MSCI Europe Small Cap UCITS.",
    listings: { LSE: { ticker: "WDSC" }, XETRA: { ticker: "ZPRS" }, SIX: { ticker: "WOSC" } },
    defaultExchange: "LSE",
    aumMillionsEUR: 1526,
    inceptionDate: "2013-11-25",
  }),
  "IE00BHZPJ569": I({
    name: "iShares MSCI World ESG Enhanced CTB UCITS ETF USD (Acc)",
    isin: "IE00BHZPJ569",
    terBps: 20,
    domicile: "Ireland",
    replication: "Physical",
    distribution: "Accumulating",
    currency: "USD",
    comment: "Popular UCITS ETF auto-added on 2026-05-01 as orphan catalog entry — recognised in Explain manual-entry but not assigned to any model-portfolio bucket. Seed note: iShares MSCI USA SRI UCITS.",
    listings: { LSE: { ticker: "EGMW" }, XETRA: { ticker: "EDMW" }, SIX: { ticker: "EDMW" } },
    defaultExchange: "LSE",
    aumMillionsEUR: 3785,
    inceptionDate: "2019-04-16",
  }),
  "IE00BG0J4841": I({
    name: "iShares Digital Security UCITS ETF USD (Dist)",
    isin: "IE00BG0J4841",
    terBps: 40,
    domicile: "Ireland",
    replication: "Physical",
    distribution: "Distributing",
    currency: "USD",
    comment: "Popular UCITS ETF auto-added on 2026-05-01 as orphan catalog entry — recognised in Explain manual-entry but not assigned to any model-portfolio bucket. Seed note: iShares MSCI Europe SRI UCITS.",
    listings: { LSE: { ticker: "SHLD" }, XETRA: { ticker: "IS4S" } },
    defaultExchange: "LSE",
    aumMillionsEUR: 140,
    inceptionDate: "2018-10-29",
  }),
  "IE00BFNM3P36": I({
    name: "iShares MSCI EM IMI Screened UCITS ETF USD (Acc)",
    isin: "IE00BFNM3P36",
    terBps: 18,
    domicile: "Ireland",
    replication: "Physical",
    distribution: "Accumulating",
    currency: "USD",
    comment: "Popular UCITS ETF auto-added on 2026-05-01 as orphan catalog entry — recognised in Explain manual-entry but not assigned to any model-portfolio bucket. Seed note: iShares MSCI EM SRI UCITS.",
    listings: { LSE: { ticker: "SAEM" }, XETRA: { ticker: "AYEM" }, SIX: { ticker: "SAEM" } },
    defaultExchange: "LSE",
    aumMillionsEUR: 5550,
    inceptionDate: "2018-10-19",
  }),
  "CH0044781232": I({
    name: "Swisscanto ETF Precious Metal Physical Gold CHF A",
    isin: "CH0044781232",
    terBps: 41,
    domicile: "Switzerland",
    replication: "Physical",
    distribution: "Distributing",
    currency: "CHF",
    comment: "Popular UCITS ETF auto-added on 2026-05-01 as orphan catalog entry — recognised in Explain manual-entry but not assigned to any model-portfolio bucket. Seed note: ZKB Gold ETF AA CHF (CH).",
    listings: { SIX: { ticker: "JBGOCA" } },
    defaultExchange: "SIX",
    aumMillionsEUR: 418,
    inceptionDate: "2008-10-24",
  }),
  "DE000A0H0728": I({
    name: "iShares Diversified Commodity Swap UCITS ETF (DE)",
    isin: "DE000A0H0728",
    terBps: 46,
    domicile: "Germany",
    replication: "Synthetic",
    distribution: "Accumulating",
    currency: "EUR",
    comment: "Popular UCITS ETF auto-added on 2026-05-01 as orphan catalog entry — recognised in Explain manual-entry but not assigned to any model-portfolio bucket. Seed note: iShares Diversified Commodity Swap UCITS.",
    listings: { XETRA: { ticker: "EXXY" }, Euronext: { ticker: "CMSE" } },
    defaultExchange: "XETRA",
    aumMillionsEUR: 306,
    inceptionDate: "2007-08-07",
  }),
  "IE00B0M63284": I({
    name: "iShares European Property Yield UCITS ETF",
    isin: "IE00B0M63284",
    terBps: 40,
    domicile: "Ireland",
    replication: "Physical",
    distribution: "Distributing",
    currency: "EUR",
    comment: "Popular UCITS ETF auto-added on 2026-05-01 as orphan catalog entry — recognised in Explain manual-entry but not assigned to any model-portfolio bucket. Seed note: iShares Asia Property Yield UCITS.",
    listings: { LSE: { ticker: "IPRP" }, XETRA: { ticker: "IQQP" }, SIX: { ticker: "IPRP" }, Euronext: { ticker: "IPRP" } },
    defaultExchange: "LSE",
    aumMillionsEUR: 899,
    inceptionDate: "2005-11-04",
  }),
  "IE00B1FZS798": I({
    name: "iShares USD Treasury Bond 7-10yr UCITS ETF (Dist)",
    isin: "IE00B1FZS798",
    terBps: 7,
    domicile: "Ireland",
    replication: "Physical",
    distribution: "Distributing",
    currency: "USD",
    comment: "Popular UCITS ETF auto-added on 2026-05-01 as orphan catalog entry — recognised in Explain manual-entry but not assigned to any model-portfolio bucket. Seed note: iShares Core EUR Govt Bond UCITS.",
    listings: { LSE: { ticker: "IDTM" }, XETRA: { ticker: "IUSM" }, SIX: { ticker: "IBTM" }, Euronext: { ticker: "BTMA" } },
    defaultExchange: "LSE",
    aumMillionsEUR: 2880,
    inceptionDate: "2006-12-08",
  }),
  "IE00B3VWN518": I({
    name: "iShares USD Treasury Bond 7-10yr UCITS ETF (Acc)",
    isin: "IE00B3VWN518",
    terBps: 7,
    domicile: "Ireland",
    replication: "Physical",
    distribution: "Accumulating",
    currency: "USD",
    comment: "Popular UCITS ETF auto-added on 2026-05-01 as orphan catalog entry — recognised in Explain manual-entry but not assigned to any model-portfolio bucket. Seed note: iShares EUR Govt Bond 1-3yr UCITS.",
    listings: { LSE: { ticker: "CBU0" }, XETRA: { ticker: "SXRM" }, SIX: { ticker: "CSBGU0" } },
    defaultExchange: "LSE",
    aumMillionsEUR: 4049,
    inceptionDate: "2009-06-03",
  }),
  "IE00B4WXJJ64": I({
    name: "iShares Core Euro Government Bond UCITS ETF (Dist)",
    isin: "IE00B4WXJJ64",
    terBps: 7,
    domicile: "Ireland",
    replication: "Physical",
    distribution: "Distributing",
    currency: "EUR",
    comment: "Popular UCITS ETF auto-added on 2026-05-01 as orphan catalog entry — recognised in Explain manual-entry but not assigned to any model-portfolio bucket. Seed note: iShares Core EUR Govt Bond UCITS.",
    listings: { LSE: { ticker: "SEGA" }, XETRA: { ticker: "EUNH" }, SIX: { ticker: "IEGA" }, Euronext: { ticker: "IEGA" } },
    defaultExchange: "LSE",
    aumMillionsEUR: 4907,
    inceptionDate: "2009-04-17",
  }),
  "IE00B3VWN179": I({
    name: "iShares USD Treasury Bond 1-3yr UCITS ETF (Acc)",
    isin: "IE00B3VWN179",
    terBps: 7,
    domicile: "Ireland",
    replication: "Physical",
    distribution: "Accumulating",
    currency: "USD",
    comment: "Popular UCITS ETF auto-added on 2026-05-01 as orphan catalog entry — recognised in Explain manual-entry but not assigned to any model-portfolio bucket. Seed note: iShares USD Treasury Bond 7-10yr UCITS.",
    listings: { LSE: { ticker: "CBU3" }, SIX: { ticker: "CSBGU3" } },
    defaultExchange: "LSE",
    aumMillionsEUR: 558,
    inceptionDate: "2009-06-03",
  }),
  "IE00BSKRJZ44": I({
    name: "iShares USD Treasury Bond 20+yr UCITS ETF USD (Dist)",
    isin: "IE00BSKRJZ44",
    terBps: 7,
    domicile: "Ireland",
    replication: "Physical",
    distribution: "Distributing",
    currency: "USD",
    comment: "Popular UCITS ETF auto-added on 2026-05-01 as orphan catalog entry — recognised in Explain manual-entry but not assigned to any model-portfolio bucket. Seed note: iShares Core USD Govt Bond UCITS.",
    listings: { LSE: { ticker: "IDTL" }, XETRA: { ticker: "IS04" }, SIX: { ticker: "IDTL" } },
    defaultExchange: "LSE",
    aumMillionsEUR: 856,
    inceptionDate: "2015-01-20",
  }),
  "IE00B1FZS244": I({
    name: "iShares Asia Property Yield UCITS ETF",
    isin: "IE00B1FZS244",
    terBps: 59,
    domicile: "Ireland",
    replication: "Physical",
    distribution: "Distributing",
    currency: "USD",
    comment: "Popular UCITS ETF auto-added on 2026-05-01 as orphan catalog entry — recognised in Explain manual-entry but not assigned to any model-portfolio bucket. Seed note: iShares Core US Aggregate Bond UCITS.",
    listings: { LSE: { ticker: "IDAR" }, XETRA: { ticker: "IQQ4" }, SIX: { ticker: "IASP" }, Euronext: { ticker: "IASP" } },
    defaultExchange: "LSE",
    aumMillionsEUR: 180,
    inceptionDate: "2006-10-20",
  }),
  "IE00B0M62X26": I({
    name: "iShares Euro Inflation Linked Government Bond UCITS ETF",
    isin: "IE00B0M62X26",
    terBps: 9,
    domicile: "Ireland",
    replication: "Physical",
    distribution: "Accumulating",
    currency: "EUR",
    comment: "Popular UCITS ETF auto-added on 2026-05-01 as orphan catalog entry — recognised in Explain manual-entry but not assigned to any model-portfolio bucket. Seed note: iShares EUR Inflation Linked Govt Bond UCITS.",
    listings: { LSE: { ticker: "IBC1" }, XETRA: { ticker: "IBCI" }, SIX: { ticker: "IBCI" }, Euronext: { ticker: "IBCI" } },
    defaultExchange: "LSE",
    aumMillionsEUR: 1823,
    inceptionDate: "2005-11-18",
  }),
  "IE00B1FZSC47": I({
    name: "iShares USD TIPS UCITS ETF USD (Acc)",
    isin: "IE00B1FZSC47",
    terBps: 10,
    domicile: "Ireland",
    replication: "Physical",
    distribution: "Accumulating",
    currency: "USD",
    comment: "Popular UCITS ETF auto-added on 2026-05-01 as orphan catalog entry — recognised in Explain manual-entry but not assigned to any model-portfolio bucket. Seed note: iShares USD TIPS UCITS.",
    listings: { LSE: { ticker: "IDTP" }, XETRA: { ticker: "IUST" }, SIX: { ticker: "ITPS" }, Euronext: { ticker: "TPSA" } },
    defaultExchange: "LSE",
    aumMillionsEUR: 2421,
    inceptionDate: "2006-12-08",
  }),
  "IE00B3F81R35": I({
    name: "iShares Core EUR Corporate Bond UCITS ETF (Dist)",
    isin: "IE00B3F81R35",
    terBps: 9,
    domicile: "Ireland",
    replication: "Physical",
    distribution: "Distributing",
    currency: "EUR",
    comment: "Popular UCITS ETF auto-added on 2026-05-01 as orphan catalog entry — recognised in Explain manual-entry but not assigned to any model-portfolio bucket. Seed note: iShares Core EUR Corporate Bond UCITS.",
    listings: { LSE: { ticker: "IEAC" }, XETRA: { ticker: "EUN5" }, SIX: { ticker: "IEAC" }, Euronext: { ticker: "IEAC" } },
    defaultExchange: "LSE",
    aumMillionsEUR: 8972,
    inceptionDate: "2009-03-06",
  }),
  "IE00B3F81G20": I({
    name: "iShares MSCI Emerging Markets Small Cap UCITS ETF",
    isin: "IE00B3F81G20",
    terBps: 74,
    domicile: "Ireland",
    replication: "Physical",
    distribution: "Distributing",
    currency: "USD",
    comment: "Popular UCITS ETF auto-added on 2026-05-01 as orphan catalog entry — recognised in Explain manual-entry but not assigned to any model-portfolio bucket. Seed note: iShares Core USD Corp Bond UCITS.",
    listings: { LSE: { ticker: "IEMS" }, XETRA: { ticker: "EUNI" }, SIX: { ticker: "IEMS" } },
    defaultExchange: "LSE",
    aumMillionsEUR: 316,
    inceptionDate: "2009-03-06",
  }),
  "IE00B66F4759": I({
    name: "iShares EUR High Yield Corporate Bond UCITS ETF EUR (Dist)",
    isin: "IE00B66F4759",
    terBps: 50,
    domicile: "Ireland",
    replication: "Physical",
    distribution: "Distributing",
    currency: "EUR",
    comment: "Popular UCITS ETF auto-added on 2026-05-01 as orphan catalog entry — recognised in Explain manual-entry but not assigned to any model-portfolio bucket. Seed note: iShares EUR High Yield Corporate Bond UCITS.",
    listings: { LSE: { ticker: "IHYG" }, XETRA: { ticker: "EUNW" }, SIX: { ticker: "IHYG" } },
    defaultExchange: "LSE",
    aumMillionsEUR: 4945,
    inceptionDate: "2010-09-03",
  }),
  "IE00BJK55C48": I({
    name: "iShares EUR High Yield Corporate Bond ESG SRI UCITS ETF EUR (Acc)",
    isin: "IE00BJK55C48",
    terBps: 25,
    domicile: "Ireland",
    replication: "Physical",
    distribution: "Accumulating",
    currency: "EUR",
    comment: "Popular UCITS ETF auto-added on 2026-05-01 as orphan catalog entry — recognised in Explain manual-entry but not assigned to any model-portfolio bucket. Seed note: iShares Fallen Angels High Yield Corp Bond UCITS.",
    listings: { XETRA: { ticker: "AYE2" }, SIX: { ticker: "EHYA" }, Euronext: { ticker: "EHYA" } },
    defaultExchange: "XETRA",
    aumMillionsEUR: 3308,
    inceptionDate: "2019-11-12",
  }),
  "IE00B2NPKV68": I({
    name: "iShares J.P. Morgan USD Emerging Markets Bond UCITS ETF (Dist)",
    isin: "IE00B2NPKV68",
    terBps: 45,
    domicile: "Ireland",
    replication: "Physical",
    distribution: "Distributing",
    currency: "USD",
    comment: "Popular UCITS ETF auto-added on 2026-05-01 as orphan catalog entry — recognised in Explain manual-entry but not assigned to any model-portfolio bucket. Seed note: iShares J.P. Morgan EM Bond UCITS.",
    listings: { LSE: { ticker: "IEMB" }, XETRA: { ticker: "IUS7" }, SIX: { ticker: "IEMB" } },
    defaultExchange: "LSE",
    aumMillionsEUR: 3395,
    inceptionDate: "2008-02-15",
  }),
  "IE00B5L65R35": I({
    name: "iShares GBP Corporate Bond 0-5yr UCITS ETF",
    isin: "IE00B5L65R35",
    terBps: 20,
    domicile: "Ireland",
    replication: "Physical",
    distribution: "Distributing",
    currency: "GBP",
    comment: "Popular UCITS ETF auto-added on 2026-05-01 as orphan catalog entry — recognised in Explain manual-entry but not assigned to any model-portfolio bucket. Seed note: iShares JPM USD EM Bond UCITS.",
    listings: { LSE: { ticker: "IS15" }, SIX: { ticker: "IS15" } },
    defaultExchange: "LSE",
    aumMillionsEUR: 1821,
    inceptionDate: "2011-03-30",
  }),
  "IE00B9M6RS56": I({
    name: "iShares J.P. Morgan USD EM Bond EUR Hedged UCITS ETF (Dist)",
    isin: "IE00B9M6RS56",
    terBps: 50,
    domicile: "Ireland",
    replication: "Physical",
    distribution: "Distributing",
    currency: "EUR",
    comment: "Popular UCITS ETF auto-added on 2026-05-01 as orphan catalog entry — recognised in Explain manual-entry but not assigned to any model-portfolio bucket. Seed note: iShares J.P. Morgan EM Local Govt Bond UCITS.",
    listings: { LSE: { ticker: "EMBE" }, XETRA: { ticker: "IS3C" }, SIX: { ticker: "EMBE" } },
    defaultExchange: "LSE",
    aumMillionsEUR: 2145,
    inceptionDate: "2013-07-08",
  }),
  "IE00BCRY6557": I({
    name: "iShares EUR Ultrashort Bond UCITS ETF EUR (Dist)",
    isin: "IE00BCRY6557",
    terBps: 9,
    domicile: "Ireland",
    replication: "Physical",
    distribution: "Distributing",
    currency: "EUR",
    comment: "Popular UCITS ETF auto-added on 2026-05-01 as orphan catalog entry — recognised in Explain manual-entry but not assigned to any model-portfolio bucket. Seed note: PIMCO US Dollar Short Maturity UCITS.",
    listings: { LSE: { ticker: "ERNE" }, XETRA: { ticker: "IS3M" }, SIX: { ticker: "ERNE" }, Euronext: { ticker: "ERNE" } },
    defaultExchange: "LSE",
    aumMillionsEUR: 3605,
    inceptionDate: "2013-10-16",
  }),
  // ----- END auto-added popular-ETFs orphans -----
};

const BUCKETS: Record<string, BucketAssignment> = {
  "Equity-Global": B({
    default: "IE00B3YLTY66",
    alternatives: ["IE00BK5BQT80", "IE00B6R52259"],
    pool: ["IE00B4L5Y983", "IE00B0M62Q58", "IE00BFY0GT14", "LU0274208692", "IE00BK5BQV03", "IE00BP3QZ601", "IE00BP3QZB59", "IE00BP3QZ825", "IE00BD1F4M44", "IE00B9CQXS71", "IE00B5M1WJ87", "IE00BCHWNQ94", "IE00B3VWMM18"],
  }),
  "Equity-USA": B({
    default: "IE00B5BMR087",
    alternatives: ["IE00BFMXXD54", "IE00B6YX5C33", "LU0136234654"],
    pool: ["IE0031442068", "IE00BYTRRD19", "IE00B6YX5D40"],
  }),
  "Equity-USA-Synthetic": B({
    default: "IE00B3YCGJ38",
    alternatives: ["LU0490618542"],
  }),
  "Equity-Europe": B({
    default: "IE00B4K48X80",
    alternatives: ["IE00B945VV12", "FR0007054358", "IE0008471009"],
    pool: ["IE00B0M62S72", "DE0002635307", "LU0908500753", "IE00BKM4H312", "LU0274209237", "IE00B53L4350", "IE00B0M62Y33", "DE0005933931", "LU0274211480", "IE00B652H904", "IE00BCBJG560"],
  }),
  "Equity-Switzerland": B({
    default: "CH0237935652",
    alternatives: ["CH0031768937", "LU1681044993"],
    pool: ["CH0008899764"],
  }),
  "Equity-UK": B({
    default: "IE00B53HP851",
    alternatives: ["IE00B810Q511"],
  }),
  "Equity-Japan": B({
    default: "IE00B4L5YX21",
    alternatives: ["LU0839027447"],
    pool: ["IE00B53QDK08", "IE00B02KXH56", "LU0274209740"],
  }),
  "Equity-EM": B({
    default: "IE00BKM4GZ66",
    alternatives: ["IE00BK5BR733", "IE00BTJRMP35"],
    pool: ["IE00B0M63177", "LU0292107645", "IE00B8KGV557", "IE00B52MJY50", "IE00B0M63730", "IE00BZCQB185", "IE00BFMXYX26", "IE00B02KXK85"],
  }),
  "Equity-USA-EUR": B({
    default: "IE00B3ZW0K18",
    alternatives: ["IE00BM67HW99", "IE00BRKWGL70"],
  }),
  "Equity-USA-CHF": B({
    default: "IE00B88DZ566",
    alternatives: [],
  }),
  "Equity-USA-GBP": B({
    default: "IE00BYX5MS15",
    alternatives: [],
  }),
  "FixedIncome-Global": B({
    default: "IE00B3F81409",
    alternatives: ["LU0378818131", "IE00BG47KH54"],
    pool: ["IE00B3VWN179", "IE00BSKRJZ44", "IE00B1FZS244", "IE00B1FZSC47", "IE00B3F81G20", "IE00BJK55C48", "IE00B2NPKV68", "IE00B5L65R35", "IE00B9M6RS56"],
  }),
  "FixedIncome-Global-EUR": B({
    default: "IE00BDBRDM35",
    alternatives: ["IE00BG47KB92", "LU0290355717"],
    pool: ["IE00B1FZS798", "IE00B3VWN518", "IE00B4WXJJ64", "IE00B0M62X26", "IE00B3F81R35", "IE00B66F4759"],
  }),
  "FixedIncome-Global-CHF": B({
    default: "IE00BDBRDN42",
    alternatives: [],
  }),
  "FixedIncome-Global-GBP": B({
    default: "IE00BDBRDP65",
    alternatives: ["IE00BG47KJ78"],
  }),
  "Commodities-Gold": B({
    default: "IE00B579F325",
    alternatives: ["IE00B4ND3602", "JE00B1VS3770"],
    pool: ["CH0044781232"],
  }),
  "RealEstate-GlobalREITs": B({
    default: "IE00B1FZS350",
    alternatives: ["IE00B5L01S80", "NL0009690239"],
    pool: ["IE00B0M63284"],
  }),
  "DigitalAssets-BroadCrypto": B({
    default: "GB00BLD4ZL17",
    alternatives: ["GB00BJYDH287", "CH1199067674"],
  }),
  "Equity-Technology": B({
    default: "IE00B3WJKG14",
    alternatives: ["IE00B53SZB19", "IE00BM67HT60"],
    pool: ["IE0032077012", "IE00BMFKG444", "IE00BYVQ9F29", "LU1681038243", "IE00BYZK4552", "IE00BMDX0K95", "IE00BMWXKN31"],
  }),
  "Equity-Healthcare": B({
    default: "IE00BYZK4776",
    alternatives: ["IE00BM67HK77", "IE00B43HR379"],
    pool: ["IE00B4K6B022", "IE00BYWQWR46"],
  }),
  "Equity-Sustainability": B({
    default: "IE00B1XNHC34",
    alternatives: ["IE00BFNM3J75", "IE00BLRB0242"],
    pool: ["IE00BMW42181", "IE00BJK9H753", "IE00BMW3QX54", "IE00BHZPJ569", "IE00BG0J4841", "IE00BFNM3P36"],
  }),
  "Equity-Cybersecurity": B({
    default: "IE00BG0J4C88",
    alternatives: ["IE00BYPLS672", "IE00BLPK3577"],
    pool: ["IE00BGV5VN51", "IE00BJ5JNZ06"],
  }),
};

// ----------------------------------------------------------------------------
// Joined view: `CATALOG: Record<bucketKey, ETFRecord>` — built once at
// module load. Every existing reader of CATALOG (engine, Methodology UI,
// tests) goes through this thin compatibility accessor without changes.
// ----------------------------------------------------------------------------
function buildJoinedCatalog(
  instruments: Record<string, InstrumentRecord>,
  buckets: Record<string, BucketAssignment>,
): Record<string, ETFRecord> {
  const result: Record<string, ETFRecord> = {};
  for (const [key, assignment] of Object.entries(buckets)) {
    const def = instruments[assignment.default];
    if (!def) {
      throw new Error(
        `Bucket "${key}" references unknown default ISIN "${assignment.default}" — INSTRUMENTS table is out of sync with BUCKETS.`,
      );
    }
    const alts: ETFRecord[] = [];
    for (const altIsin of assignment.alternatives) {
      const alt = instruments[altIsin];
      if (!alt) {
        throw new Error(
          `Bucket "${key}" references unknown alternative ISIN "${altIsin}" — INSTRUMENTS table is out of sync with BUCKETS.`,
        );
      }
      alts.push({ ...alt });
    }
    // Pool entries are NOT folded into the joined ETFRecord — the
    // joined view drives the picker's recommended-alternatives row,
    // which intentionally stays the curated short list. Pool entries
    // are reachable via getBucketPool() and ISIN_TO_BUCKET so the
    // "More ETFs" dialog and Explain's IsinPicker can find them.
    // Existence of every pool ISIN in INSTRUMENTS is still enforced
    // here so a typo in the pool array fails fast at module load.
    for (const poolIsin of assignment.pool ?? []) {
      if (!instruments[poolIsin]) {
        throw new Error(
          `Bucket "${key}" references unknown pool ISIN "${poolIsin}" — INSTRUMENTS table is out of sync with BUCKETS.`,
        );
      }
    }
    result[key] = {
      ...def,
      ...(alts.length > 0 ? { alternatives: alts } : {}),
    };
  }
  return result;
}

// ----------------------------------------------------------------------------
// Optional data refresh overrides (see scripts/refresh-justetf.mjs).
// The CATALOG above is the curated, deterministic source of truth. The refresh
// script writes ISIN-keyed partial records into src/data/etfs.overrides.json;
// at module load we shallow-merge them on top of the matching CATALOG entry so
// the engine, tests and UI continue to work unchanged when the file is empty.
//
// Two CI cadences populate this file:
//   - Weekly  (Sundays 03:00 UTC): terBps, aumMillionsEUR, inceptionDate,
//             distribution, replication.
//   - Nightly (02:00 UTC):         listings (per-exchange ticker map).
//
// `defaultExchange`, `comment`, `name`, `isin`, `domicile`, and `currency`
// stay hand-curated and are intentionally NOT in the override Pick<> — they
// reflect editorial decisions made when the ETF is added to the catalog.
// The `listings` override merges via per-exchange spread so a partial scrape
// (e.g. only LSE + XETRA found) never wipes out a hand-curated SIX listing.
// ----------------------------------------------------------------------------
type ETFOverride = Partial<
  Pick<
    ETFRecord,
    | "terBps"
    | "aumMillionsEUR"
    | "inceptionDate"
    | "distribution"
    | "replication"
  >
> & {
  listings?: ListingMap;
};
const RAW_OVERRIDES = (overridesFile as { overrides?: Record<string, ETFOverride> }).overrides ?? {};

// Snapshot freshness metadata written by scripts/refresh-justetf.mjs.
// `lastRefreshedMode` indicates which cadence wrote the file most recently:
//   - "core"     → weekly Sundays 03:00 UTC (TER, AUM, inception, distribution, replication)
//   - "listings" → nightly 02:00 UTC (per-exchange ticker map)
// Since both modes write to the same file, we only ever know the latest run's
// stamp + mode, not separate per-mode stamps.
export type ETFsSnapshotMode = "core" | "listings";
export interface ETFsSnapshotMeta {
  lastRefreshed: string | null;
  lastRefreshedMode: ETFsSnapshotMode | null;
}
const _ETFS_META = (overridesFile as {
  _meta?: { lastRefreshed?: string | null; lastRefreshedMode?: string | null };
})._meta ?? {};
const _ETFS_SNAPSHOT_META: ETFsSnapshotMeta = {
  lastRefreshed: _ETFS_META.lastRefreshed ?? null,
  lastRefreshedMode:
    _ETFS_META.lastRefreshedMode === "core" || _ETFS_META.lastRefreshedMode === "listings"
      ? _ETFS_META.lastRefreshedMode
      : null,
};
export function getETFsSnapshotMeta(): ETFsSnapshotMeta {
  return _ETFS_SNAPSHOT_META;
}

// Apply snapshot overrides to the master INSTRUMENTS table FIRST so
// every reader (joined CATALOG view, getInstrumentByIsin) sees the
// patched values. Then build the joined CATALOG from the patched
// instruments + the bucket assignments.
for (const isin of Object.keys(INSTRUMENTS)) {
  const patch = RAW_OVERRIDES[isin];
  if (!patch) continue;
  const rec = INSTRUMENTS[isin];
  const { listings: listingsPatch, ...scalarPatch } = patch;
  Object.assign(rec, scalarPatch);
  if (listingsPatch) {
    rec.listings = { ...rec.listings, ...listingsPatch };
  }
}

const CATALOG: Record<string, ETFRecord> = buildJoinedCatalog(INSTRUMENTS, BUCKETS);

// Surfaced freshness metadata (UI displays "core data as of <date>" and
// "listings as of <date>" stamps next to the ETF Implementation table).
// On a fresh checkout where no refresh job has run yet the file's _meta has
// `lastCoreRefresh` / `lastListingsRefresh` set to null and the UI hides the
// stamp gracefully.
type OverridesMeta = {
  source?: string;
  lastRefreshed?: string | null;
  // The refresh script normalises every run to "core" or "listings" via
  // lastRefreshedModeFor() — see scripts/refresh-justetf.mjs. A bare
  // `--mode=all` developer run is collapsed to "core" so the UI's
  // "(last refresh job: ...)" hint always renders.
  lastRefreshedMode?: "core" | "listings" | null;
  lastCoreRefresh?: string | null;
  lastListingsRefresh?: string | null;
};
export const ETF_OVERRIDES_META: OverridesMeta =
  (overridesFile as { _meta?: OverridesMeta })._meta ?? {};

function placeholder(assetClass: string, region: string): ETFDetails {
  return {
    name: `Generic ${assetClass} ETF — ${region}`,
    isin: "—",
    ticker: "—",
    exchange: "—",
    terBps: 25,
    domicile: "—",
    replication: "Physical",
    distribution: "Accumulating",
    currency: "USD",
    comment: "Illustrative placeholder; replace with a concrete UCITS ETF before any real use.",
    catalogKey: null,
    selectedSlot: 0,
    selectableOptions: [],
  };
}

// Resolve which record (default, alternative or pool) to use for a
// bucket based on the user's per-bucket selection. Slot 0 always
// returns the curated default; slots 1..altCount return
// alternatives[slot-1]; slots altCount+1..altCount+poolCount return
// the pool entries (Task #149). Falls back to the default whenever
// the slot index points past the available rows.
function resolveSelectedETF(
  curated: ETFRecord,
  slot: number,
  pool: ReadonlyArray<InstrumentRecord>,
): ETFRecord {
  if (slot <= 0) return curated;
  const altCount = curated.alternatives?.length ?? 0;
  if (slot <= altCount) return curated.alternatives![slot - 1];
  const poolIdx = slot - altCount - 1;
  const poolRec = pool[poolIdx];
  if (!poolRec) return curated;
  // Pool entries live in INSTRUMENTS (no `alternatives` field). Lift
  // them into ETFRecord shape — same fields, no nested alternatives.
  return { ...poolRec };
}

// Clamp a stored slot to 0..(altCount + poolCount), and to what's
// actually available for the bucket. Used both for resolution and for
// the `selectedSlot` field surfaced to the UI so the dropdown
// highlights the right option even when localStorage holds a stale
// value (e.g. user picked alt-3 of a bucket whose alternatives list
// has since shrunk, or picked a pool entry that has since been
// removed). Out-of-range slots silently fall back to the default.
function clampSlot(
  stored: number,
  alternativesCount: number,
  poolCount: number = 0,
): number {
  if (!Number.isFinite(stored) || stored <= 0) return 0;
  const altMax = Math.min(MAX_ALTERNATIVES_PER_BUCKET, alternativesCount);
  const poolMax = Math.min(MAX_POOL_PER_BUCKET, poolCount);
  const total = altMax + poolMax;
  if (total === 0) return 0;
  // Preserve legacy "clamp to highest available" behaviour — stored
  // values past the end fall back to the last available row rather
  // than to the default. Keeps existing scenarios stable when a
  // bucket's alternative/pool list shrinks between sessions.
  if (stored >= total) return total;
  return Math.floor(stored);
}

// ----------------------------------------------------------------------------
// resolvePickerSelection()
// ----------------------------------------------------------------------------
// Pure picker-resolution helper extracted from getETFDetails(). Given a
// curated bucket entry and a stored slot index (e.g. from localStorage),
// returns the chosen ETFRecord, the clamped slot the UI should highlight,
// and the dropdown's selectableOptions list (empty when the bucket has no
// alternatives, signalling the picker UI should stay hidden).
//
// Exposed so canary tests can validate the picker semantics — slot
// clamping, default vs alternative selection, and the empty-options
// contract — against synthetic ETFRecord fixtures rather than live
// curated buckets. The live catalog grows new alternatives over time
// (every refresh PR or operator-curated addition can flip a bucket from
// "0 alternatives" to "1", or "1" to "2"), which would silently break
// any test that hard-codes "Equity-Europe has exactly 1 alternative".
// ----------------------------------------------------------------------------
export interface PickerResolution {
  rec: ETFRecord;
  selectedSlot: number;
  selectableOptions: ETFDetails["selectableOptions"];
}
export function resolvePickerSelection(
  curated: ETFRecord,
  storedSlot: number,
  // Task #149 — extended-universe pool entries for this bucket. Empty
  // by default for backward compatibility with callers that don't
  // care about the pool (engine tests, legacy consumers).
  pool: ReadonlyArray<InstrumentRecord> = [],
): PickerResolution {
  const altCount = curated.alternatives?.length ?? 0;
  const poolCount = pool.length;
  const selectedSlot = clampSlot(storedSlot, altCount, poolCount);
  const rec = resolveSelectedETF(curated, selectedSlot, pool);
  // The selectable list always starts with the curated default + every
  // alternative; the pool entries are appended after so slot indexing
  // matches `resolveSelectedETF`. The `kind` discriminator lets the UI
  // split the inline Select (default + alternatives) from the
  // "More ETFs" dialog (pool only) without re-deriving the lists.
  const selectableOptions: ETFDetails["selectableOptions"] =
    altCount > 0 || poolCount > 0
      ? [
          {
            name: curated.name,
            isin: curated.isin,
            terBps: curated.terBps,
            kind: "default" as const,
            distribution: curated.distribution,
          },
          ...(curated.alternatives ?? []).map((a) => ({
            name: a.name,
            isin: a.isin,
            terBps: a.terBps,
            kind: "alternative" as const,
            distribution: a.distribution,
          })),
          ...pool.map((p) => ({
            name: p.name,
            isin: p.isin,
            terBps: p.terBps,
            kind: "pool" as const,
            distribution: p.distribution,
          })),
        ]
      : [];
  return { rec, selectedSlot, selectableOptions };
}

function pickListing(
  rec: ETFRecord,
  preferred: PortfolioInput["preferredExchange"]
): { ticker: string; exchange: string } {
  // 1. Honour an explicit user preference (LSE / XETRA / SIX) when the listing exists.
  //    Note: "Euronext" is intentionally not exposed as a user-pickable preferredExchange
  //    in the UI — see PreferredExchange in types.ts — so this branch never matches Euronext.
  if (preferred !== "None" && rec.listings[preferred as ExchangeCode]) {
    return { ticker: rec.listings[preferred as ExchangeCode]!.ticker, exchange: preferred };
  }
  // 2. Use the ETF's declared default listing — provided it isn't Euronext.
  //    Euronext is reserved as a last-resort fallback (see step 4) so it never wins
  //    when the user has not explicitly opted into it.
  if (rec.defaultExchange !== "Euronext") {
    const def = rec.listings[rec.defaultExchange];
    if (def) return { ticker: def.ticker, exchange: rec.defaultExchange };
  }
  // 3. Try the other non-Euronext venues in a deterministic order.
  const fallbackOrder: ExchangeCode[] = ["LSE", "XETRA", "SIX"];
  for (const ex of fallbackOrder) {
    const lst = rec.listings[ex];
    if (lst) return { ticker: lst.ticker, exchange: ex };
  }
  // 4. Last-resort fallback: Euronext is only used when the user expressed no preference
  //    AND no other venue lists this ETF (e.g. a future Euronext-only addition to the catalog).
  if (preferred === "None" && rec.listings.Euronext) {
    return { ticker: rec.listings.Euronext.ticker, exchange: "Euronext" };
  }
  return { ticker: "—", exchange: "—" };
}

function lookupKey(assetClass: string, region: string, input: PortfolioInput): string | null {
  const base = input.baseCurrency;
  const hedged = input.includeCurrencyHedging && base !== "USD";

  if (assetClass === "Fixed Income") {
    if (hedged) {
      const hedgedKey = `FixedIncome-Global-${base}`;
      if (CATALOG[hedgedKey]) return hedgedKey;
    }
    return "FixedIncome-Global";
  }
  if (assetClass === "Commodities") return "Commodities-Gold";
  if (assetClass === "Real Estate") return "RealEstate-GlobalREITs";
  if (assetClass === "Digital Assets") return "DigitalAssets-BroadCrypto";

  if (assetClass === "Equity") {
    if (region === "Global") return "Equity-Global";
    if (region === "Home") {
      if (base === "USD") {
        if (hedged) {
          const hk = `Equity-USA-${base}`;
          if (CATALOG[hk]) return hk;
        }
        if (input.includeSyntheticETFs) return "Equity-USA-Synthetic";
        return "Equity-USA";
      }
      if (base === "CHF") return "Equity-Switzerland";
      if (base === "GBP") return "Equity-UK";
      return "Equity-Europe";
    }
    if (region.includes("USA")) {
      if (hedged) {
        const hk = `Equity-USA-${base}`;
        if (CATALOG[hk]) return hk;
      }
      if (input.includeSyntheticETFs) return "Equity-USA-Synthetic";
      return "Equity-USA";
    }
    if (region.includes("Europe")) return "Equity-Europe";
    if (region.includes("Switzerland")) return "Equity-Switzerland";
    if (region.includes("UK") || region.includes("United Kingdom")) return "Equity-UK";
    if (region.includes("Japan")) return "Equity-Japan";
    if (region.includes("EM")) return "Equity-EM";
    if (region === "Technology") return "Equity-Technology";
    if (region === "Healthcare") return "Equity-Healthcare";
    if (region === "Sustainability") return "Equity-Sustainability";
    if (region === "Cybersecurity") return "Equity-Cybersecurity";
  }
  return null;
}

// Look up the canonical bucket entry. Exposed for the override / browse
// UI on the Methodology tab — those flows want to inspect the curated
// record (name, listings, etc.) before deciding to swap it.
export function getCatalogEntry(key: string): ETFRecord | undefined {
  return CATALOG[key];
}

export function getCatalog(): Readonly<Record<string, ETFRecord>> {
  return CATALOG;
}

// Bring-your-own-ETFs accessors (Task #135).

export interface BucketMeta {
  key: string;
  assetClass: string;
  region: string;
  hedged: boolean;
  hedgeCurrency?: "EUR" | "CHF" | "GBP";
  synthetic: boolean;
}

const ISIN_TO_BUCKET: Record<string, string> = (() => {
  const m: Record<string, string> = {};
  for (const [key, assignment] of Object.entries(BUCKETS)) {
    m[assignment.default] = key;
    for (const altIsin of assignment.alternatives) {
      m[altIsin] = key;
    }
    // Pool entries belong to the same bucket as default+alternatives.
    // Including them here means listInstruments() automatically picks
    // them up and Explain's IsinPicker (which scopes by bucketKey)
    // sees pool entries with no extra wiring.
    for (const poolIsin of assignment.pool ?? []) {
      m[poolIsin] = key;
    }
  }
  return m;
})();

// Per-bucket extended-universe pool accessor. Returns the list of
// InstrumentRecords tagged to a bucket via BUCKETS[key].pool, in
// declaration order. Empty when the bucket has no pool. Used by the
// Build "More ETFs" dialog and the admin Catalog tree to render the
// pool independently of default+alternatives.
export function getBucketPool(bucketKey: string): ReadonlyArray<InstrumentRecord> {
  const assignment = BUCKETS[bucketKey];
  if (!assignment || !assignment.pool || assignment.pool.length === 0) return [];
  const out: InstrumentRecord[] = [];
  for (const isin of assignment.pool) {
    const rec = INSTRUMENTS[isin];
    if (rec) out.push(rec);
  }
  return out;
}

// Per-instrument role in the catalog. "unassigned" means the ISIN is
// registered in INSTRUMENTS but absent from every BUCKETS slot — that
// path remains supported for transitional editing in /admin.
export type InstrumentRole = "default" | "alternative" | "pool" | "unassigned";

export function getInstrumentRole(isin: string): InstrumentRole {
  const bucketKey = ISIN_TO_BUCKET[isin];
  if (!bucketKey) return "unassigned";
  const assignment = BUCKETS[bucketKey];
  if (!assignment) return "unassigned";
  if (assignment.default === isin) return "default";
  if (assignment.alternatives.includes(isin)) return "alternative";
  if (assignment.pool?.includes(isin)) return "pool";
  return "unassigned";
}

function decodeBucketKey(key: string): BucketMeta {
  const HEDGE_SUFFIXES: ReadonlyArray<"-EUR" | "-CHF" | "-GBP"> = [
    "-EUR",
    "-CHF",
    "-GBP",
  ];
  let hedged = false;
  let hedgeCurrency: BucketMeta["hedgeCurrency"];
  let synthetic = false;
  let core = key;
  for (const sfx of HEDGE_SUFFIXES) {
    if (core.endsWith(sfx)) {
      hedged = true;
      hedgeCurrency = sfx.slice(1) as BucketMeta["hedgeCurrency"];
      core = core.slice(0, -sfx.length);
      break;
    }
  }
  if (core.endsWith("-Synthetic")) {
    synthetic = true;
    core = core.slice(0, -"-Synthetic".length);
  }
  const dashAt = core.indexOf("-");
  if (dashAt < 0) {
    return { key, assetClass: core, region: "—", hedged, hedgeCurrency, synthetic };
  }
  const head = core.slice(0, dashAt);
  const tail = core.slice(dashAt + 1);
  let assetClass = head;
  let region = tail;
  if (head === "FixedIncome") assetClass = "Fixed Income";
  else if (head === "RealEstate") {
    assetClass = "Real Estate";
    region = tail === "GlobalREITs" ? "Global REITs" : tail;
  } else if (head === "DigitalAssets") {
    assetClass = "Digital Assets";
    region = tail === "BroadCrypto" ? "Broad Crypto" : tail;
  }
  return { key, assetClass, region, hedged, hedgeCurrency, synthetic };
}

const BUCKET_META_CACHE: Record<string, BucketMeta> = (() => {
  const m: Record<string, BucketMeta> = {};
  for (const key of Object.keys(BUCKETS)) m[key] = decodeBucketKey(key);
  return m;
})();

export const ALL_BUCKET_KEYS: readonly string[] = Object.freeze(
  Object.keys(BUCKETS),
);

export function getInstrumentByIsin(
  isin: string,
): Readonly<InstrumentRecord> | undefined {
  return INSTRUMENTS[isin];
}

export function getBucketKeyForIsin(isin: string): string | undefined {
  return ISIN_TO_BUCKET[isin];
}

export function getBucketMeta(bucketKey: string): BucketMeta | undefined {
  return BUCKET_META_CACHE[bucketKey];
}

export function listInstruments(): ReadonlyArray<
  Readonly<InstrumentRecord & { bucketKey: string; bucketMeta: BucketMeta }>
> {
  const rows: Array<InstrumentRecord & { bucketKey: string; bucketMeta: BucketMeta }> = [];
  for (const isin of Object.keys(INSTRUMENTS)) {
    const bk = ISIN_TO_BUCKET[isin];
    if (!bk) continue;
    rows.push({ ...INSTRUMENTS[isin], bucketKey: bk, bucketMeta: BUCKET_META_CACHE[bk] });
  }
  rows.sort((a, b) => a.name.localeCompare(b.name));
  return rows;
}

export function pickDefaultListing(
  rec: InstrumentRecord,
): { ticker: string; exchange: string } {
  if (rec.defaultExchange !== "Euronext") {
    const def = rec.listings[rec.defaultExchange];
    if (def) return { ticker: def.ticker, exchange: rec.defaultExchange };
  }
  const fallbackOrder: ExchangeCode[] = ["LSE", "XETRA", "SIX"];
  for (const ex of fallbackOrder) {
    const lst = rec.listings[ex];
    if (lst) return { ticker: lst.ticker, exchange: ex };
  }
  if (rec.listings.Euronext) {
    return { ticker: rec.listings.Euronext.ticker, exchange: "Euronext" };
  }
  return { ticker: "—", exchange: "—" };
}

export function getETFDetails(
  assetClass: string,
  region: string,
  input: PortfolioInput,
  // Optional per-call selection map (catalog key → 1-based alternative
  // slot, 0 = default). When provided, takes the place of the global
  // localStorage-backed getETFSelection() lookup so a Compare slot can
  // honour a saved scenario's picker snapshot without mutating the
  // shared store the Build tab is reading from. The Methodology
  // override layer still wins — admin-pinned ETFs take precedence over
  // any user picker selection, mirroring today's resolution chain.
  selections?: Record<string, number>,
): ETFDetails {
  const key = lookupKey(assetClass, region, input);
  if (!key) return placeholder(assetClass, region);
  // Resolution layers, highest precedence first:
  //   1. User override (Methodology "swap ETF" pane)  → bypasses the
  //      curated alternatives entirely; the override IS the answer.
  //   2. Curated default + user-selected alternative slot (per-bucket
  //      ETF picker on the Build tab; lib/etfSelection.ts).
  //   3. Curated default (CATALOG[key]).
  // Override fully replaces alternatives because it represents an
  // explicit "use THIS specific ETF" decision; once active, surfacing
  // alternative-picker UI would be confusing (the user wouldn't see
  // their pinned override among the choices).
  const override = getUserETFOverride(key);
  const curated = CATALOG[key];
  let rec: ETFRecord;
  let selectedSlot: number = 0;
  let selectableOptions: ETFDetails["selectableOptions"] = [];
  if (override) {
    rec = override;
  } else {
    const slot = selections !== undefined
      ? (selections[key] ?? 0)
      : getETFSelection(key);
    ({ rec, selectedSlot, selectableOptions } = resolvePickerSelection(
      curated,
      slot,
      getBucketPool(key),
    ));
  }
  const { ticker, exchange } = pickListing(rec, input.preferredExchange);
  return {
    name: rec.name,
    isin: rec.isin,
    ticker,
    exchange,
    terBps: rec.terBps,
    domicile: rec.domicile,
    replication: rec.replication,
    distribution: rec.distribution,
    currency: rec.currency,
    comment: rec.comment,
    aumMillionsEUR: rec.aumMillionsEUR,
    inceptionDate: rec.inceptionDate,
    catalogKey: key,
    selectedSlot,
    selectableOptions,
  };
}

// ----------------------------------------------------------------------------
// validateCatalog()
// ----------------------------------------------------------------------------
// Deterministic structural integrity check for the curated catalog.
// Asserts the per-bucket-ETF-picker invariants the operator demanded
// when introducing the alternatives layer + the strict cross-bucket
// uniqueness invariant introduced with Task #111 (split INSTRUMENTS
// table):
//
//   • Every CATALOG key has a default (the entry itself — guaranteed by
//     construction since the key cannot exist without an ETFRecord).
//   • alternatives.length ≤ MAX_ALTERNATIVES_PER_BUCKET per bucket
//     (max 1 default + MAX_ALTERNATIVES_PER_BUCKET alternatives).
//   • Within a single bucket, all 1..N ISINs are distinct (no duplicate
//     "role" within a bucket).
//   • Every ISIN appears AT MOST ONCE across the entire catalog —
//     whether as default or as alternative, in any bucket. This is the
//     unique bucket-assignment rule the operator demanded so the
//     INSTRUMENTS table stays the unambiguous source of truth.
//
// Wired into a vitest unit test — failures cause CI to refuse the build.
// ----------------------------------------------------------------------------
export interface CatalogValidationIssue {
  // "warning" entries are surfaced (test output, admin pane) but do NOT
  // block the build. "error" entries fail the catalog-validate test in
  // CI. Task #122 introduces "warning" so the look-through ⊆ INSTRUMENTS
  // check can land in two phases: warn first (T002), flip to error
  // once the pool/overrides JSON has been cleaned (T003).
  severity: "error" | "warning";
  bucket: string;
  message: string;
}

export function validateCatalog(): CatalogValidationIssue[] {
  const issues: CatalogValidationIssue[] = [];
  // ownership[isin] = list of "bucketKey:role" usages; any ISIN with
  // more than one usage is a global-uniqueness violation.
  const ownership = new Map<string, Array<{ bucket: string; role: "default" | "alternative" | "pool" }>>();
  function note(isin: string, bucket: string, role: "default" | "alternative" | "pool") {
    const list = ownership.get(isin) ?? [];
    list.push({ bucket, role });
    ownership.set(isin, list);
  }
  for (const [key, rec] of Object.entries(CATALOG)) {
    const alts = rec.alternatives ?? [];
    if (alts.length > MAX_ALTERNATIVES_PER_BUCKET) {
      issues.push({
        severity: "error",
        bucket: key,
        message: `bucket has ${alts.length} alternatives; max is ${MAX_ALTERNATIVES_PER_BUCKET} (1 default + ${MAX_ALTERNATIVES_PER_BUCKET} alternatives = ${MAX_ALTERNATIVES_PER_BUCKET + 1} ETFs total)`,
      });
    }
    note(rec.isin, key, "default");
    const seenInBucket = new Set<string>([rec.isin]);
    for (const alt of alts) {
      if (seenInBucket.has(alt.isin)) {
        issues.push({
          severity: "error",
          bucket: key,
          message: `duplicate ISIN ${alt.isin} within bucket — every ETF slot in a bucket must have a distinct ISIN`,
        });
      } else {
        seenInBucket.add(alt.isin);
      }
      note(alt.isin, key, "alternative");
    }
    // Pool slot — same per-bucket distinctness + cap rules, separate
    // capacity (MAX_POOL_PER_BUCKET). The pool is consulted directly
    // from BUCKETS[key].pool because the joined CATALOG view does not
    // surface pool entries (they are not picker recommendations).
    const pool = BUCKETS[key]?.pool ?? [];
    if (pool.length > MAX_POOL_PER_BUCKET) {
      issues.push({
        severity: "error",
        bucket: key,
        message: `bucket pool has ${pool.length} entries; max is ${MAX_POOL_PER_BUCKET}`,
      });
    }
    for (const poolIsin of pool) {
      if (seenInBucket.has(poolIsin)) {
        issues.push({
          severity: "error",
          bucket: key,
          message: `duplicate ISIN ${poolIsin} within bucket — pool entries must not overlap with default or alternatives`,
        });
      } else {
        seenInBucket.add(poolIsin);
      }
      note(poolIsin, key, "pool");
    }
  }
  // Cross-bucket uniqueness pass: any ISIN that shows up in more than
  // one bucket slot is a violation, regardless of role.
  for (const [isin, usages] of ownership.entries()) {
    if (usages.length <= 1) continue;
    // Report the second+ occurrence(s); the first usage is implicitly
    // "the existing one" the new edit collides with.
    const [first, ...rest] = usages;
    for (const u of rest) {
      issues.push({
        severity: "error",
        bucket: u.bucket,
        message: `ISIN ${isin} is already assigned to bucket "${first.bucket}" as ${first.role} — every ISIN may appear in at most one bucket slot`,
      });
    }
  }
  // Task #122: look-through ISIN ⊆ INSTRUMENTS keys. Every ISIN keyed in
  // src/data/lookthrough.overrides.json (`overrides` and `pool` maps)
  // MUST also be a registered instrument. The runtime folds pool
  // entries into PROFILES (lookthrough.ts) and shallow-merges overrides
  // onto PROFILES, but neither path is reachable from the UI for an
  // ISIN that no instrument row references — so a look-through entry
  // without an INSTRUMENTS row is structurally unreachable data and
  // silently signals "INSTRUMENTS table is out of sync with the
  // look-through JSON". Phase 2 (T003): with the JSON cleaned by T002
  // and the refresh job tightened by T005, severity is "error" so any
  // future zombie entry trips the catalog-validate unit test in CI
  // before it can ship.
  const instrumentSet = new Set(Object.keys(INSTRUMENTS));
  const ltPool = getLookthroughPoolIsins();
  const ltOverrides = getLookthroughOverrideIsins();
  for (const isin of ltPool) {
    if (!instrumentSet.has(isin)) {
      issues.push({
        severity: "error",
        bucket: "lookthrough.pool",
        message: `Pool ISIN ${isin} is known to look-through but not registered in INSTRUMENTS. Register it via the Instruments tab first, then re-add the pool entry to src/data/lookthrough.overrides.json.`,
      });
    }
  }
  for (const isin of ltOverrides) {
    if (!instrumentSet.has(isin)) {
      issues.push({
        severity: "error",
        bucket: "lookthrough.overrides",
        message: `Override ISIN ${isin} is known to look-through but not registered in INSTRUMENTS. Register it via the Instruments tab first, then re-add the override entry to src/data/lookthrough.overrides.json.`,
      });
    }
  }
  return issues;
}

// Backwards-compat helper still used elsewhere (e.g. fee/Monte-Carlo flows that look up by name)
export function getExampleETF(assetClass: string, region: string, input: PortfolioInput): string {
  return getETFDetails(assetClass, region, input).name;
}
