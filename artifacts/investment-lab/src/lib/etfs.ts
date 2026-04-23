import { PortfolioInput } from "./types";

export function getExampleETF(assetClass: string, region: string, input: PortfolioInput): string {
  const suffixMap: Record<string, string> = {
    "None": "",
    "NYSE": " (NYSE)",
    "LSE": " (LSE)",
    "XETRA": " (XETR)",
    "SIX": " (SIX)",
  };
  const suf = suffixMap[input.preferredExchange] || "";

  const base = input.baseCurrency;
  const hedgeable =
    input.includeCurrencyHedging &&
    base !== "USD" &&
    (assetClass === "Equity" || assetClass === "Fixed Income" || assetClass === "Real Estate");

  // Foreign equities for non-USD investors when hedging is OFF should not get a hedged tag;
  // local-market exposure (e.g. CHF investor in MSCI Switzerland, EUR investor in FTSE Europe) is already domestic
  const isLocalMarket =
    (base === "CHF" && region.includes("Switzerland")) ||
    (base === "EUR" && region.includes("Europe")) ||
    (base === "GBP" && region.includes("UK"));

  const hedgeTag = hedgeable && !isLocalMarket ? ` ${base} Hedged` : "";

  if (assetClass === "Fixed Income")
    return "iShares Core Global Aggregate Bond" + hedgeTag + suf;
  if (assetClass === "Commodities") return "Invesco Physical Gold" + suf;
  if (assetClass === "Real Estate") return "iShares Global REIT" + hedgeTag + suf;
  if (assetClass === "Digital Assets") return "CoinShares Physical Bitcoin" + suf;

  if (assetClass === "Equity") {
    if (region.includes("USA")) return "iShares Core S&P 500" + hedgeTag + suf;
    if (region.includes("Europe"))
      return "Vanguard FTSE Developed Europe" + (isLocalMarket ? "" : hedgeTag) + suf;
    if (region.includes("Switzerland"))
      return "iShares MSCI Switzerland" + (isLocalMarket ? "" : hedgeTag) + suf;
    if (region.includes("Japan")) return "iShares MSCI Japan" + hedgeTag + suf;
    if (region.includes("EM")) return "iShares Core MSCI EM IMI" + hedgeTag + suf;

    if (region === "Technology") return "iShares S&P 500 Information Tech" + hedgeTag + suf;
    if (region === "Healthcare") return "iShares Healthcare Innovation" + hedgeTag + suf;
    if (region === "Sustainability") return "iShares Global Clean Energy" + hedgeTag + suf;
    if (region === "Cybersecurity") return "iShares Digital Security" + hedgeTag + suf;
  }

  return "Generic Global ETF" + suf;
}
