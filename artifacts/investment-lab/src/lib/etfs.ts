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

  if (assetClass === "Fixed Income") return "iShares Core Global Aggregate Bond" + suf;
  if (assetClass === "Commodities") return "Invesco Physical Gold" + suf;
  if (assetClass === "Real Estate") return "iShares Global REIT" + suf;
  if (assetClass === "Digital Assets") return "CoinShares Physical Bitcoin" + suf;
  
  if (assetClass === "Equity") {
    if (region.includes("USA")) return "iShares Core S&P 500" + suf;
    if (region.includes("Europe")) return "Vanguard FTSE Developed Europe" + suf;
    if (region.includes("Switzerland")) return "iShares MSCI Switzerland" + suf;
    if (region.includes("Japan")) return "iShares MSCI Japan" + suf;
    if (region.includes("EM")) return "iShares Core MSCI EM IMI" + suf;
    
    if (region === "Technology") return "iShares S&P 500 Information Tech" + suf;
    if (region === "Healthcare") return "iShares Healthcare Innovation" + suf;
    if (region === "Sustainability") return "iShares Global Clean Energy" + suf;
    if (region === "Cybersecurity") return "iShares Digital Security" + suf;
  }

  return "Generic Global ETF" + suf;
}
