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
    comment: "",
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
    comment: "",
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
    comment: "",
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
    comment: "",
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
    comment: "",
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
    comment: "",
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
    comment: "",
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
    comment: "",
    listings: { "LSE": { ticker: "XKSD" }, "XETRA": { ticker: "DBX8" } },
    defaultExchange: "LSE",
  }),
};

const BUCKETS: Record<string, BucketAssignment> = {
  "Equity-Global": B({
    default: "IE00B3YLTY66",
    alternatives: ["IE00BK5BQT80", "IE00B6R52259"],
  }),
  "Equity-USA": B({
    default: "IE00B5BMR087",
    alternatives: ["IE00BFMXXD54", "IE00B6YX5C33", "LU0136234654"],
  }),
  "Equity-USA-Synthetic": B({
    default: "IE00B3YCGJ38",
    alternatives: ["LU0490618542"],
  }),
  "Equity-Europe": B({
    default: "IE00B4K48X80",
    alternatives: ["IE00B945VV12", "FR0007054358", "IE0008471009"],
  }),
  "Equity-Switzerland": B({
    default: "CH0237935652",
    alternatives: ["CH0031768937", "LU1681044993"],
  }),
  "Equity-UK": B({
    default: "IE00B53HP851",
    alternatives: ["IE00B810Q511"],
  }),
  "Equity-Japan": B({
    default: "IE00B4L5YX21",
    alternatives: ["LU0839027447"],
  }),
  "Equity-EM": B({
    default: "IE00BKM4GZ66",
    alternatives: ["IE00BK5BR733", "IE00BTJRMP35"],
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
  }),
  "FixedIncome-Global-EUR": B({
    default: "IE00BDBRDM35",
    alternatives: ["IE00BG47KB92", "LU0290355717"],
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
  }),
  "RealEstate-GlobalREITs": B({
    default: "IE00B1FZS350",
    alternatives: ["IE00B5L01S80", "NL0009690239"],
  }),
  "DigitalAssets-BroadCrypto": B({
    default: "GB00BLD4ZL17",
    alternatives: ["GB00BJYDH287", "CH1199067674"],
  }),
  "Equity-Technology": B({
    default: "IE00B3WJKG14",
    alternatives: ["IE00B53SZB19", "IE00BM67HT60"],
  }),
  "Equity-Healthcare": B({
    default: "IE00BYZK4776",
    alternatives: ["IE00BM67HK77", "IE00B43HR379"],
  }),
  "Equity-Sustainability": B({
    default: "IE00B1XNHC34",
    alternatives: ["IE00BFNM3J75", "IE00BLRB0242"],
  }),
  "Equity-Cybersecurity": B({
    default: "IE00BG0J4C88",
    alternatives: ["IE00BYPLS672", "IE00BLPK3577"],
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

// Resolve which curated record (default or alternative) to use for a bucket
// based on the user's per-bucket selection. Slot 0 always returns the
// curated default; slots 1..N return alternatives[slot-1] when they
// exist, falling back to the default if the slot index points past the
// available alternatives. Kept tiny so the hot path stays cheap.
function resolveSelectedETF(curated: ETFRecord, slot: number): ETFRecord {
  if (slot <= 0) return curated;
  const alt = curated.alternatives?.[slot - 1];
  return alt ?? curated;
}

// Clamp a stored slot to 0..MAX_ALTERNATIVES_PER_BUCKET and to what's
// actually available for the bucket. Used both for resolution and for
// the `selectedSlot` field surfaced to the UI so the dropdown highlights
// the right option even when localStorage holds a stale value (e.g.
// user picked alt-3 of a bucket whose alternatives list has since
// shrunk to 1).
function clampSlot(stored: number, alternativesCount: number): number {
  if (!Number.isFinite(stored) || stored <= 0) return 0;
  const max = Math.min(MAX_ALTERNATIVES_PER_BUCKET, alternativesCount);
  if (stored >= max) return max;
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
  storedSlot: number
): PickerResolution {
  const altCount = curated.alternatives?.length ?? 0;
  const selectedSlot = clampSlot(storedSlot, altCount);
  const rec = resolveSelectedETF(curated, selectedSlot);
  const selectableOptions: ETFDetails["selectableOptions"] =
    altCount > 0
      ? [
          { name: curated.name, isin: curated.isin, terBps: curated.terBps },
          ...curated.alternatives!.map((a) => ({
            name: a.name,
            isin: a.isin,
            terBps: a.terBps,
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
  const ownership = new Map<string, Array<{ bucket: string; role: "default" | "alternative" }>>();
  function note(isin: string, bucket: string, role: "default" | "alternative") {
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
