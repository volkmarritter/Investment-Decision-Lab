import { PortfolioInput } from "./types";
import overridesFile from "@/data/etfs.overrides.json";

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
}

type ExchangeCode = "LSE" | "XETRA" | "SIX" | "Euronext";
type ListingMap = Partial<Record<ExchangeCode, { ticker: string }>>;

interface ETFRecord {
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
for (const rec of Object.values(CATALOG)) {
  const patch = RAW_OVERRIDES[rec.isin];
  if (!patch) continue;
  const { listings: listingsPatch, ...scalarPatch } = patch;
  Object.assign(rec, scalarPatch);
  if (listingsPatch) {
    rec.listings = { ...rec.listings, ...listingsPatch };
  }
}

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
  };
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
    if (region.includes("Japan")) return "Equity-Japan";
    if (region.includes("EM")) return "Equity-EM";
    if (region === "Technology") return "Equity-Technology";
    if (region === "Healthcare") return "Equity-Healthcare";
    if (region === "Sustainability") return "Equity-Sustainability";
    if (region === "Cybersecurity") return "Equity-Cybersecurity";
  }
  return null;
}

export function getETFDetails(
  assetClass: string,
  region: string,
  input: PortfolioInput
): ETFDetails {
  const key = lookupKey(assetClass, region, input);
  if (!key) return placeholder(assetClass, region);
  const rec = CATALOG[key];
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
  };
}

// Backwards-compat helper still used elsewhere (e.g. fee/Monte-Carlo flows that look up by name)
export function getExampleETF(assetClass: string, region: string, input: PortfolioInput): string {
  return getETFDetails(assetClass, region, input).name;
}
