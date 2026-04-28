import { PortfolioInput } from "./types";
import overridesFile from "@/data/etfs.overrides.json";
import { getUserETFOverride } from "./etfOverrides";
import { getETFSelection } from "./etfSelection";

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
   *  1 = first alternative, 2 = second alternative. Always 0 when an
   *  override is active or when no alternatives exist for this bucket. */
  selectedSlot: 0 | 1 | 2;
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
  // Each bucket exposes 1 default (this record itself) plus up to 2
  // alternatives. The user picks one via the in-row dropdown on the Build
  // tab; selection is persisted in localStorage (see lib/etfSelection.ts)
  // and consulted by getETFDetails() on the next render. Constraints
  // enforced by validateCatalog():
  //   • alternatives.length ≤ 2
  //   • all 1–3 ISINs within a bucket are distinct
  //   • an ISIN used as an alternative is not used as default OR
  //     alternative anywhere else in the catalog (uniqueness preserved
  //     for the alternatives layer; pre-existing default-default ISIN
  //     duplicates between hedged/synthetic variants are tolerated).
  // ----------------------------------------------------------------------
  alternatives?: ETFRecord[];
}

const E = (r: ETFRecord) => r;

const CATALOG: Record<string, ETFRecord> = {
  // ---------- Equity (unhedged) ----------
  "Equity-Global": E({
    name: "SPDR MSCI ACWI IMI UCITS",
    isin: "IE00B3YLTY66",
    terBps: 17,
    domicile: "Ireland",
    replication: "Physical (sampled)",
    distribution: "Accumulating",
    currency: "USD",
    comment:
      "Single-fund global equity (developed + emerging) tracking MSCI ACWI IMI; used when the ETF budget is too small for region-by-region splits.",
    listings: { LSE: { ticker: "SPYI" }, XETRA: { ticker: "SPYI" }, SIX: { ticker: "SPYI" }, Euronext: { ticker: "SPYI" } },
    defaultExchange: "LSE",
    alternatives: [
      {
        name: "Vanguard FTSE All-World UCITS",
        isin: "IE00BK5BQT80",
        terBps: 22,
        domicile: "Ireland",
        replication: "Physical (sampled)",
        distribution: "Accumulating",
        currency: "USD",
        comment:
          "Vanguard's flagship global equity fund: large/mid caps across developed + emerging markets, very deep liquidity on LSE/XETRA/SIX.",
        listings: { LSE: { ticker: "VWRA" }, XETRA: { ticker: "VWCE" }, SIX: { ticker: "VWRL" }, Euronext: { ticker: "VWCE" } },
        defaultExchange: "LSE",
      },
      {
        name: "iShares MSCI ACWI UCITS",
        isin: "IE00B6R52259",
        terBps: 20,
        domicile: "Ireland",
        replication: "Physical (sampled)",
        distribution: "Accumulating",
        currency: "USD",
        comment:
          "MSCI ACWI (developed + emerging large/mid caps); sister fund to SPYI but on the MSCI ACWI parent index rather than ACWI IMI (excludes small caps).",
        listings: { LSE: { ticker: "SSAC" }, XETRA: { ticker: "IUSQ" }, SIX: { ticker: "SSAC" }, Euronext: { ticker: "SSAC" } },
        defaultExchange: "LSE",
      },
    ],
  }),
  "Equity-USA": E({
    name: "iShares Core S&P 500 UCITS",
    isin: "IE00B5BMR087",
    terBps: 7,
    domicile: "Ireland",
    replication: "Physical",
    distribution: "Accumulating",
    currency: "USD",
    comment:
      "Largest, most liquid S&P 500 UCITS with very tight tracking and minimal bid-ask spreads.",
    listings: { LSE: { ticker: "CSPX" }, XETRA: { ticker: "SXR8" }, SIX: { ticker: "CSSPX" }, Euronext: { ticker: "CSPX" } },
    defaultExchange: "LSE",
    alternatives: [
      {
        name: "Vanguard S&P 500 UCITS",
        isin: "IE00BFMXXD54",
        terBps: 7,
        domicile: "Ireland",
        replication: "Physical",
        distribution: "Accumulating",
        currency: "USD",
        comment:
          "Vanguard's accumulating S&P 500 UCITS; same TER as iShares' CSPX, identical underlying basket — useful for diversifying issuer concentration.",
        listings: { LSE: { ticker: "VUAA" }, XETRA: { ticker: "VUAA" }, SIX: { ticker: "VUAA" }, Euronext: { ticker: "VUAA" } },
        defaultExchange: "LSE",
      },
      {
        name: "SPDR S&P 500 UCITS",
        isin: "IE00B6YX5C33",
        terBps: 3,
        domicile: "Ireland",
        replication: "Physical",
        distribution: "Distributing",
        currency: "USD",
        comment:
          "Lowest-TER S&P 500 UCITS in the catalog (3 bps); distributing share class — preferable when the investor wants regular dividend income rather than reinvestment.",
        listings: { LSE: { ticker: "SPY5" }, XETRA: { ticker: "SPY5" }, Euronext: { ticker: "SPY5" } },
        defaultExchange: "LSE",
      },
    ],
  }),
  "Equity-USA-Synthetic": E({
    name: "Invesco S&P 500 UCITS (Synthetic)",
    isin: "IE00B3YCGJ38",
    terBps: 5,
    domicile: "Ireland",
    replication: "Synthetic",
    distribution: "Accumulating",
    currency: "USD",
    comment:
      "Swap-based replication eliminates the 15% US dividend withholding-tax leakage that physical Irish-domiciled ETFs incur, structurally adding ~20–30 bps/yr; introduces counterparty risk to the swap counterparties.",
    listings: { LSE: { ticker: "SPXS" }, XETRA: { ticker: "SC0J" }, SIX: { ticker: "SPXS" }, Euronext: { ticker: "SPXS" } },
    defaultExchange: "LSE",
  }),
  "Equity-Europe": E({
    name: "iShares Core MSCI Europe UCITS",
    isin: "IE00B4K48X80",
    terBps: 12,
    domicile: "Ireland",
    replication: "Physical (sampled)",
    distribution: "Accumulating",
    currency: "EUR",
    comment:
      "Broad pan-European core exposure across UK, eurozone and Switzerland, with very low TER.",
    listings: { LSE: { ticker: "IMEU" }, XETRA: { ticker: "SXR7" }, SIX: { ticker: "CEU" }, Euronext: { ticker: "IMAE" } },
    defaultExchange: "XETRA",
    alternatives: [
      {
        name: "Vanguard FTSE Developed Europe UCITS",
        isin: "IE00B945VV12",
        terBps: 10,
        domicile: "Ireland",
        replication: "Physical (sampled)",
        distribution: "Accumulating",
        currency: "EUR",
        comment:
          "FTSE Developed Europe (large/mid caps, includes UK and Switzerland); marginally lower TER than the iShares MSCI variant.",
        listings: { LSE: { ticker: "VEUA" }, XETRA: { ticker: "VGEA" }, Euronext: { ticker: "VGEA" } },
        defaultExchange: "XETRA",
      },
      {
        name: "Amundi EURO STOXX 50 II UCITS ETF Acc",
        isin: "FR0007054358",
        terBps: 20,
        domicile: "France",
        replication: "Physical",
        distribution: "Accumulating",
        currency: "EUR",
        comment: "",
        listings: { "XETRA": { ticker: "LYSX" }, "SIX": { ticker: "MSE" }, "Euronext": { ticker: "MSE" } },
        defaultExchange: "XETRA",
      },
    ],
  }),
  "Equity-Switzerland": E({
    name: "iShares Core SPI",
    isin: "CH0237935652",
    terBps: 10,
    domicile: "Switzerland",
    replication: "Physical",
    distribution: "Distributing",
    currency: "CHF",
    comment:
      "Comprehensive Swiss equity benchmark covering large, mid and small caps; very deep liquidity on SIX.",
    listings: { SIX: { ticker: "CHSPI" } },
    defaultExchange: "SIX",
    alternatives: [
      {
        name: "iShares SLI ETF (CH)",
        isin: "CH0031768937",
        terBps: 35,
        domicile: "Switzerland",
        replication: "Physical",
        distribution: "Distributing",
        currency: "CHF",
        comment: "",
        listings: { "SIX": { ticker: "CSSLI" } },
        defaultExchange: "SIX",
      },

      {
        name: "Amundi MSCI Switzerland UCITS ETF CHF",
        isin: "LU1681044993",
        terBps: 25,
        domicile: "Luxembourg",
        replication: "Synthetic",
        distribution: "Accumulating",
        currency: "CHF",
        comment: "",
        listings: { "LSE": { ticker: "CSWU" }, "XETRA": { ticker: "18MN" }, "SIX": { ticker: "CSWCHF" } },
        defaultExchange: "SIX",
      },
    ],
  }),
  "Equity-UK": E({
    name: "iShares Core FTSE 100 UCITS",
    isin: "IE00B53HP851",
    terBps: 7,
    domicile: "Ireland",
    replication: "Physical",
    distribution: "Accumulating",
    currency: "GBP",
    comment:
      "FTSE 100 large-cap UK equity used as the GBP home-bias core sleeve; very low TER and deep LSE liquidity.",
    listings: { LSE: { ticker: "CUKX" } },
    defaultExchange: "LSE",
  }),
  "Equity-Japan": E({
    name: "iShares Core MSCI Japan IMI UCITS",
    isin: "IE00B4L5YX21",
    terBps: 12,
    domicile: "Ireland",
    replication: "Physical (sampled)",
    distribution: "Accumulating",
    currency: "JPY",
    comment:
      "Wide-coverage Japan exposure including small caps; useful for a diversified developed-markets sleeve.",
    listings: { LSE: { ticker: "SJPA" }, XETRA: { ticker: "SXR4" }, SIX: { ticker: "CSJP" }, Euronext: { ticker: "IJPA" } },
    defaultExchange: "LSE",
    alternatives: [
      {
        name: "iShares Fallen Angels High Yield Corporate Bond UCITS ETF",
        isin: "IE00BYM31M36",
        terBps: 50,
        domicile: "Ireland",
        replication: "Physical",
        distribution: "Distributing",
        currency: "USD",
        comment: "iShares Core Nikkei 225 — Nikkei index alternative.",
        listings: { "LSE": { ticker: "WING" }, "XETRA": { ticker: "QDVQ" } },
        defaultExchange: "XETRA",
        aumMillionsEUR: 325,
        inceptionDate: "2016-06-21",
      },
    ],
  }),
  "Equity-EM": E({
    name: "iShares Core MSCI EM IMI UCITS",
    isin: "IE00BKM4GZ66",
    terBps: 18,
    domicile: "Ireland",
    replication: "Physical (sampled)",
    distribution: "Accumulating",
    currency: "USD",
    comment:
      "Broadest emerging-markets ETF including small caps; sampled replication keeps tracking error low.",
    listings: { LSE: { ticker: "EIMI" }, XETRA: { ticker: "IS3N" }, SIX: { ticker: "EIMI" }, Euronext: { ticker: "EMIM" } },
    defaultExchange: "LSE",
    alternatives: [
      {
        name: "Vanguard FTSE Emerging Markets UCITS",
        isin: "IE00BK5BR733",
        terBps: 22,
        domicile: "Ireland",
        replication: "Physical (sampled)",
        distribution: "Accumulating",
        currency: "USD",
        comment:
          "Vanguard FTSE EM (large/mid caps; includes Korea — unlike MSCI EM); deeper venue spreads on LSE/XETRA.",
        listings: { LSE: { ticker: "VFEA" }, XETRA: { ticker: "VFEA" }, Euronext: { ticker: "VFEA" } },
        defaultExchange: "LSE",
      },
    ],
  }),
  // ---------- Equity (hedged variants) ----------
  "Equity-USA-EUR": E({
    name: "iShares S&P 500 EUR Hedged UCITS",
    isin: "IE00B3ZW0K18",
    terBps: 20,
    domicile: "Ireland",
    replication: "Physical",
    distribution: "Accumulating",
    currency: "EUR",
    comment:
      "EUR-hedged share class strips out USD/EUR FX volatility; small drag from rolling forwards.",
    listings: { LSE: { ticker: "IUSE" }, XETRA: { ticker: "IUSE" }, Euronext: { ticker: "IUSE" } },
    defaultExchange: "XETRA",
  }),
  "Equity-USA-CHF": E({
    name: "UBS S&P 500 CHF Hedged UCITS",
    isin: "IE00B3ZW0K18",
    terBps: 22,
    domicile: "Ireland",
    replication: "Physical",
    distribution: "Accumulating",
    currency: "CHF",
    comment: "CHF-hedged S&P 500 exposure; eliminates USD/CHF FX risk for Swiss investors.",
    listings: { SIX: { ticker: "S500CHA" } },
    defaultExchange: "SIX",
  }),
  "Equity-USA-GBP": E({
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
  // ---------- Fixed Income ----------
  "FixedIncome-Global": E({
    name: "iShares Core Global Aggregate Bond UCITS",
    isin: "IE00B3F81409",
    terBps: 10,
    domicile: "Ireland",
    replication: "Physical (sampled)",
    distribution: "Accumulating",
    currency: "USD",
    comment:
      "Diversified global investment-grade bond exposure; available in EUR, CHF and GBP hedged share classes.",
    listings: { LSE: { ticker: "AGGG" }, XETRA: { ticker: "EUNA" }, SIX: { ticker: "AGGH" }, Euronext: { ticker: "AGGG" } },
    defaultExchange: "LSE",
    alternatives: [
      {
        name: "Xtrackers II Global Government Bond UCITS",
        isin: "LU0378818131",
        terBps: 25,
        domicile: "Luxembourg",
        replication: "Physical (sampled)",
        distribution: "Distributing",
        currency: "USD",
        comment:
          "Sovereign-only global bond aggregate (excludes corporates); higher TER than the iShares core but cleaner duration profile for defensive sleeves.",
        listings: { LSE: { ticker: "XGGB" }, XETRA: { ticker: "DBZB" }, Euronext: { ticker: "XGGB" } },
        defaultExchange: "XETRA",
      },
    ],
  }),
  "FixedIncome-Global-EUR": E({
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
  "FixedIncome-Global-CHF": E({
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
  "FixedIncome-Global-GBP": E({
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
  // ---------- Commodities ----------
  "Commodities-Gold": E({
    name: "Invesco Physical Gold ETC",
    isin: "IE00B579F325",
    terBps: 12,
    domicile: "Ireland",
    replication: "Physical",
    distribution: "Accumulating",
    currency: "USD",
    comment:
      "Physically-backed gold ETC vaulted in London; very low TER and tight spreads vs spot.",
    listings: { LSE: { ticker: "SGLD" }, XETRA: { ticker: "8PSG" }, SIX: { ticker: "SGLD" }, Euronext: { ticker: "SGLD" } },
    defaultExchange: "LSE",
    alternatives: [
      {
        name: "iShares Physical Gold ETC",
        isin: "IE00B4ND3602",
        terBps: 12,
        domicile: "Ireland",
        replication: "Physical",
        distribution: "Accumulating",
        currency: "USD",
        comment:
          "iShares' physically-backed gold ETC, vaulted with JPMorgan in London; identical TER to Invesco SGLD, useful for issuer diversification.",
        listings: { LSE: { ticker: "SGLN" }, XETRA: { ticker: "IGLN" }, SIX: { ticker: "SGLN" }, Euronext: { ticker: "SGLN" } },
        defaultExchange: "LSE",
      },
      {
        name: "WisdomTree Physical Gold",
        isin: "JE00B1VS3770",
        terBps: 39,
        domicile: "Jersey",
        replication: "Physical",
        distribution: "Accumulating",
        currency: "USD",
        comment:
          "Higher-TER but long-established physical gold ETP (Jersey-domiciled); bullion held with HSBC London — useful as a third issuer alongside Invesco/iShares.",
        listings: { LSE: { ticker: "PHAU" }, XETRA: { ticker: "VZLD" }, SIX: { ticker: "PHAU" }, Euronext: { ticker: "PHAU" } },
        defaultExchange: "LSE",
      },
    ],
  }),
  // ---------- Real Estate ----------
  "RealEstate-GlobalREITs": E({
    name: "iShares Developed Markets Property Yield UCITS",
    isin: "IE00B1FZS350",
    terBps: 59,
    domicile: "Ireland",
    replication: "Physical",
    distribution: "Distributing",
    currency: "USD",
    comment:
      "Global developed-market REITs with above-average dividend yield; meaningful US weight (~60%).",
    listings: { LSE: { ticker: "IWDP" }, XETRA: { ticker: "IQQ6" }, SIX: { ticker: "IWDP" }, Euronext: { ticker: "IWDP" } },
    defaultExchange: "LSE",
  }),
  // ---------- Digital Assets ----------
  "DigitalAssets-BroadCrypto": E({
    name: "CoinShares Physical Bitcoin",
    isin: "GB00BLD4ZL17",
    terBps: 25,
    domicile: "Jersey",
    replication: "Physical",
    distribution: "Accumulating",
    currency: "USD",
    comment:
      "Physically-backed bitcoin ETP with cold-storage custody; concentrated single-asset exposure.",
    listings: { LSE: { ticker: "BITC" }, XETRA: { ticker: "BITC" }, SIX: { ticker: "BITC" }, Euronext: { ticker: "BITC" } },
    defaultExchange: "SIX",
  }),
  // ---------- Thematic ----------
  "Equity-Technology": E({
    name: "iShares S&P 500 Information Technology Sector",
    isin: "IE00B3WJKG14",
    terBps: 15,
    domicile: "Ireland",
    replication: "Physical",
    distribution: "Accumulating",
    currency: "USD",
    comment:
      "Concentrated US tech-sector tilt; high stock-level concentration in mega-cap names.",
    listings: { LSE: { ticker: "IUIT" }, XETRA: { ticker: "QDVE" }, SIX: { ticker: "IUIT" }, Euronext: { ticker: "IUIT" } },
    defaultExchange: "LSE",
    alternatives: [
      {
        name: "iShares Nasdaq 100 UCITS ETF (Acc)",
        isin: "IE00B53SZB19",
        terBps: 30,
        domicile: "Ireland",
        replication: "Physical",
        distribution: "Accumulating",
        currency: "USD",
        comment: "",
        listings: { "LSE": { ticker: "CNDX1" }, "XETRA": { ticker: "SXRV" }, "SIX": { ticker: "CSNDX" } },
        defaultExchange: "LSE",
      },
    ],
  }),
  "Equity-Healthcare": E({
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
  "Equity-Sustainability": E({
    name: "iShares Global Clean Energy UCITS",
    isin: "IE00B1XNHC34",
    terBps: 65,
    domicile: "Ireland",
    replication: "Physical",
    distribution: "Distributing",
    currency: "USD",
    comment:
      "Concentrated global clean-energy basket; historically high volatility and sector concentration.",
    listings: { LSE: { ticker: "INRG" }, XETRA: { ticker: "IQQH" }, SIX: { ticker: "INRG" }, Euronext: { ticker: "INRG" } },
    defaultExchange: "LSE",
  }),
  "Equity-Cybersecurity": E({
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
};

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

for (const rec of Object.values(CATALOG)) {
  const patch = RAW_OVERRIDES[rec.isin];
  if (!patch) continue;
  const { listings: listingsPatch, ...scalarPatch } = patch;
  Object.assign(rec, scalarPatch);
  if (listingsPatch) {
    rec.listings = { ...rec.listings, ...listingsPatch };
  }
}

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
// curated default; slots 1/2 return alternatives[0]/alternatives[1] when
// they exist, falling back to the default if the slot index points past
// the available alternatives. Kept tiny so the hot path stays cheap.
function resolveSelectedETF(curated: ETFRecord, slot: number): ETFRecord {
  if (slot <= 0) return curated;
  const alt = curated.alternatives?.[slot - 1];
  return alt ?? curated;
}

// Clamp a stored slot to 0/1/2 and to what's actually available for the
// bucket. Used both for resolution and for the `selectedSlot` field
// surfaced to the UI so the dropdown highlights the right option even
// when localStorage holds a stale value (e.g. user picked alt-2 of a
// bucket whose alternatives list has since shrunk to 1).
function clampSlot(stored: number, alternativesCount: number): 0 | 1 | 2 {
  if (!Number.isFinite(stored) || stored <= 0) return 0;
  const max = Math.min(2, alternativesCount);
  if (stored >= max) return max as 0 | 1 | 2;
  return stored as 1 | 2;
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
  selectedSlot: 0 | 1 | 2;
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
  input: PortfolioInput
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
  let selectedSlot: 0 | 1 | 2 = 0;
  let selectableOptions: ETFDetails["selectableOptions"] = [];
  if (override) {
    rec = override;
  } else {
    ({ rec, selectedSlot, selectableOptions } = resolvePickerSelection(
      curated,
      getETFSelection(key)
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
// when introducing the alternatives layer:
//
//   • Every CATALOG key has a default (the entry itself — guaranteed by
//     construction since the key cannot exist without an ETFRecord).
//   • alternatives.length ≤ 2 per bucket  (max 1 default + 2 alternatives).
//   • Within a single bucket, all 1–3 ISINs are distinct (no duplicate
//     "role" within a bucket).
//   • An ISIN that appears in any bucket's alternatives list does NOT
//     appear as a default ISIN of another bucket, nor as an alternative
//     ISIN of any other bucket. ("Jeder ETF zur Auswahl benötigt eine
//     eindeutige Bucket-Zuordnung.")
//
// Pre-existing default-only ISIN duplicates between hedged variant keys
// (e.g. Equity-USA-EUR and Equity-USA-CHF historically share an ISIN)
// are tolerated — they're not part of the alternatives layer and the
// validation rule is scoped to the new picker concept.
//
// Wired into a vitest unit test — failures cause CI to refuse the build.
// ----------------------------------------------------------------------------
export interface CatalogValidationIssue {
  severity: "error";
  bucket: string;
  message: string;
}

export function validateCatalog(): CatalogValidationIssue[] {
  const issues: CatalogValidationIssue[] = [];
  // First pass: per-bucket invariants (size cap + intra-bucket ISIN
  // uniqueness). Collect alternative ISINs and their owning bucket for
  // the cross-bucket pass.
  const altOwnership = new Map<string, string>(); // alt-ISIN → owning bucket key
  for (const [key, rec] of Object.entries(CATALOG)) {
    const alts = rec.alternatives ?? [];
    if (alts.length > 2) {
      issues.push({
        severity: "error",
        bucket: key,
        message: `bucket has ${alts.length} alternatives; max is 2 (1 default + 2 alternatives = 3 ETFs total)`,
      });
    }
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
      const prevOwner = altOwnership.get(alt.isin);
      if (prevOwner && prevOwner !== key) {
        issues.push({
          severity: "error",
          bucket: key,
          message: `alternative ISIN ${alt.isin} is also used as an alternative in bucket "${prevOwner}" — alternatives must have a unique bucket assignment`,
        });
      } else {
        altOwnership.set(alt.isin, key);
      }
    }
  }
  // Second pass: alternative ISIN must not collide with any bucket's
  // default ISIN (the alternatives layer must be strictly distinct from
  // the defaults universe).
  for (const [altIsin, owningBucket] of altOwnership.entries()) {
    for (const [otherKey, otherRec] of Object.entries(CATALOG)) {
      if (otherRec.isin === altIsin) {
        issues.push({
          severity: "error",
          bucket: owningBucket,
          message: `alternative ISIN ${altIsin} also serves as the default ISIN of bucket "${otherKey}" — alternatives must not shadow another bucket's default`,
        });
      }
    }
  }
  return issues;
}

// Backwards-compat helper still used elsewhere (e.g. fee/Monte-Carlo flows that look up by name)
export function getExampleETF(assetClass: string, region: string, input: PortfolioInput): string {
  return getETFDetails(assetClass, region, input).name;
}
