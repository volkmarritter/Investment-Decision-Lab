import { PortfolioInput } from "./types";

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
}

type ListingMap = Partial<Record<"LSE" | "XETRA" | "SIX", { ticker: string }>>;

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
  defaultExchange: "LSE" | "XETRA" | "SIX";
}

const E = (r: ETFRecord) => r;

const CATALOG: Record<string, ETFRecord> = {
  // ---------- Equity (unhedged) ----------
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
    listings: { LSE: { ticker: "CSPX" }, XETRA: { ticker: "SXR8" }, SIX: { ticker: "CSSPX" } },
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
    listings: { LSE: { ticker: "SPXS" }, XETRA: { ticker: "SC0J" }, SIX: { ticker: "SPXS" } },
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
    listings: { LSE: { ticker: "IMEU" }, XETRA: { ticker: "SXR7" }, SIX: { ticker: "CEU" } },
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
    listings: { LSE: { ticker: "SJPA" }, XETRA: { ticker: "SXR4" }, SIX: { ticker: "CSJP" } },
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
    listings: { LSE: { ticker: "EIMI" }, XETRA: { ticker: "IS3N" }, SIX: { ticker: "EIMI" } },
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
    listings: { LSE: { ticker: "IUSE" }, XETRA: { ticker: "IUSE" } },
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
    listings: { LSE: { ticker: "AGGG" }, XETRA: { ticker: "EUNA" }, SIX: { ticker: "AGGH" } },
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
    listings: { XETRA: { ticker: "AGGH" }, LSE: { ticker: "AGGH" } },
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
    listings: { LSE: { ticker: "SGLD" }, XETRA: { ticker: "8PSG" }, SIX: { ticker: "SGLD" } },
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
    listings: { LSE: { ticker: "IWDP" }, XETRA: { ticker: "IQQ6" }, SIX: { ticker: "IWDP" } },
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
    listings: { LSE: { ticker: "BITC" }, XETRA: { ticker: "BITC" }, SIX: { ticker: "BITC" } },
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
    listings: { LSE: { ticker: "IUIT" }, XETRA: { ticker: "QDVE" }, SIX: { ticker: "IUIT" } },
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
    listings: { LSE: { ticker: "HEAL" }, XETRA: { ticker: "2B77" } },
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
    listings: { LSE: { ticker: "INRG" }, XETRA: { ticker: "IQQH" }, SIX: { ticker: "INRG" } },
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
    listings: { LSE: { ticker: "LOCK" }, XETRA: { ticker: "2B7K" } },
    defaultExchange: "LSE",
  }),
};

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
  if (preferred !== "None" && rec.listings[preferred]) {
    return { ticker: rec.listings[preferred]!.ticker, exchange: preferred };
  }
  const def = rec.listings[rec.defaultExchange];
  if (def) return { ticker: def.ticker, exchange: rec.defaultExchange };
  const firstKey = Object.keys(rec.listings)[0] as keyof ListingMap | undefined;
  if (firstKey && rec.listings[firstKey]) {
    return { ticker: rec.listings[firstKey]!.ticker, exchange: firstKey as string };
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
  };
}

// Backwards-compat helper still used elsewhere (e.g. fee/Monte-Carlo flows that look up by name)
export function getExampleETF(assetClass: string, region: string, input: PortfolioInput): string {
  return getETFDetails(assetClass, region, input).name;
}
