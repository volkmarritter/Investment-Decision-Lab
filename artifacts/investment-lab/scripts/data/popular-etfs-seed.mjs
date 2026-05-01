// ----------------------------------------------------------------------------
// popular-etfs-seed.mjs
// ----------------------------------------------------------------------------
// Curated seed list of ~110 popular UCITS ETFs used as input to
// scripts/scrape-popular-etfs-instruments.mjs. The script enriches each
// ISIN via the existing per-ISIN justETF scraper and stages the results
// for injection into INSTRUMENTS as orphan catalog entries (no BUCKETS
// assignment) — exposed only to the Explain manual-entry recognition
// flow via getInstrumentByIsin().
//
// Why a curated seed rather than a live scrape of justETF's "most
// popular" page: that page is rendered client-side by Wicket (HTML
// returns ~5 ISINs out of 100), so live extraction would require a
// headless Chromium install + bulk page scraping that is more clearly
// against justETF's terms than the existing per-ISIN preview pattern.
// The popular-UCITS set is sufficiently stable that a curated list
// covering broad-equity, regional, sector/thematic, factor, dividend,
// ESG, commodities, REITs and bond categories yields the same
// end-result as the popularity ranking (the dominant ETFs in each
// category by AUM are well-known).
//
// Selection criteria: large AUM (>500M EUR typical), well-known
// issuers (iShares, Vanguard, Xtrackers, SPDR, Invesco, Amundi,
// WisdomTree, VanEck, L&G), broadly representative across asset
// classes and regions a Swiss/European retail investor would type
// in their Explain workspace.
//
// The list intentionally over-shoots ~110 entries so we still hit
// ~100 successful adds after dropping (a) ISINs already in
// INSTRUMENTS, (b) ISINs that fail to scrape (404 / not on justETF /
// missing required fields).
// ----------------------------------------------------------------------------

export const POPULAR_ETF_SEED = [
  // ---- Broad world equity ----
  { isin: "IE00B4L5Y983", category: "Broad world equity", note: "iShares Core MSCI World UCITS Acc" },
  { isin: "IE00B0M62Q58", category: "Broad world equity", note: "iShares MSCI World UCITS Dist" },
  { isin: "IE00B3RBWM25", category: "Broad world equity", note: "Vanguard FTSE All-World UCITS Acc" },
  { isin: "IE00BK5BQT80", category: "Broad world equity", note: "Vanguard FTSE All-World UCITS Dist" },
  { isin: "IE00BFY0GT14", category: "Broad world equity", note: "SPDR MSCI World UCITS Acc" },
  { isin: "LU0274208692", category: "Broad world equity", note: "Xtrackers MSCI World UCITS 1C" },
  { isin: "IE000QO5Q573", category: "Broad world equity", note: "Amundi Prime All Country World UCITS" },
  { isin: "IE00B6R52259", category: "Broad world equity", note: "iShares MSCI ACWI UCITS Acc" },
  { isin: "IE00BK5BQV03", category: "Broad world equity", note: "Vanguard ESG Global All Cap UCITS Acc" },

  // ---- S&P 500 ----
  { isin: "IE00BFMXXD54", category: "S&P 500", note: "Vanguard S&P 500 UCITS Acc" },
  { isin: "IE0031442068", category: "S&P 500", note: "iShares Core S&P 500 UCITS Dist" },
  { isin: "IE00B3YCGJ38", category: "S&P 500", note: "Invesco S&P 500 UCITS Acc (already in catalog — will be skipped)" },
  { isin: "IE00BYTRRD19", category: "S&P 500", note: "Invesco S&P 500 UCITS Acc (synthetic alt)" },
  { isin: "LU0490618542", category: "S&P 500", note: "Xtrackers S&P 500 Swap UCITS 1C" },

  // ---- NASDAQ 100 ----
  { isin: "IE00B53SZB19", category: "NASDAQ 100", note: "iShares Nasdaq 100 UCITS Acc" },
  { isin: "IE0032077012", category: "NASDAQ 100", note: "Invesco EQQQ Nasdaq-100 UCITS Dist" },
  { isin: "IE00BMFKG444", category: "NASDAQ 100", note: "Invesco EQQQ Nasdaq-100 UCITS Acc" },
  { isin: "IE00BYVQ9F29", category: "NASDAQ 100", note: "iShares Nasdaq 100 EUR Hedged UCITS" },
  { isin: "LU1681038243", category: "NASDAQ 100", note: "Lyxor Nasdaq-100 UCITS Acc (Amundi)" },

  // ---- Europe broad ----
  { isin: "IE00B0M62S72", category: "Europe broad", note: "iShares STOXX Europe 600 UCITS Dist" },
  { isin: "DE0002635307", category: "Europe broad", note: "iShares STOXX Europe 600 UCITS Dist (DE share class)" },
  { isin: "LU0908500753", category: "Europe broad", note: "Lyxor STOXX Europe 600 UCITS Acc" },
  { isin: "IE00BKM4H312", category: "Europe broad", note: "iShares Core MSCI Europe UCITS Dist" },
  { isin: "LU0274209237", category: "Europe broad", note: "Xtrackers MSCI Europe UCITS 1C" },

  // ---- Eurozone ----
  { isin: "IE00B53L4350", category: "Eurozone", note: "iShares Core EURO STOXX 50 UCITS Acc" },
  { isin: "IE0008471009", category: "Eurozone", note: "iShares Core EURO STOXX 50 UCITS Dist" },
  { isin: "LU0290358497", category: "Eurozone", note: "Xtrackers EURO STOXX 50 UCITS 1C" },
  { isin: "IE00B0M62Y33", category: "Eurozone", note: "iShares MSCI EMU UCITS" },

  // ---- Emerging markets ----
  { isin: "IE00B0M63177", category: "EM equity", note: "iShares MSCI Emerging Markets UCITS Dist" },
  { isin: "IE00BTJRMP35", category: "EM equity", note: "Xtrackers MSCI Emerging Markets UCITS Acc" },
  { isin: "LU0292107645", category: "EM equity", note: "Xtrackers MSCI Emerging Markets Swap UCITS 1C" },
  { isin: "IE00B8KGV557", category: "EM equity", note: "iShares Edge MSCI EM Min Volatility UCITS" },

  // ---- Japan ----
  { isin: "IE00B53QDK08", category: "Japan equity", note: "iShares Core MSCI Japan IMI UCITS Dist" },
  { isin: "IE00B02KXH56", category: "Japan equity", note: "iShares MSCI Japan UCITS Dist" },
  { isin: "LU0274209740", category: "Japan equity", note: "Xtrackers MSCI Japan UCITS 1C" },

  // ---- Asia / Pacific ex-Japan ----
  { isin: "IE00B52MJY50", category: "Asia ex-Japan", note: "iShares Core MSCI Pacific ex-Japan UCITS" },
  { isin: "IE00B0M63730", category: "Asia ex-Japan", note: "iShares MSCI AC Far East ex-Japan UCITS" },

  // ---- Country UK ----
  { isin: "IE00B3X1NT05", category: "UK equity", note: "iShares Core FTSE 100 UCITS Dist" },

  // ---- Country Germany ----
  { isin: "DE0005933931", category: "Germany equity", note: "iShares Core DAX UCITS" },
  { isin: "LU0274211480", category: "Germany equity", note: "Xtrackers DAX UCITS 1C" },

  // ---- Switzerland / SMI ----
  { isin: "CH0008899764", category: "Switzerland equity", note: "iShares SMI ETF (CH)" },
  { isin: "IE00B53RJK88", category: "Switzerland equity", note: "iShares MSCI Switzerland UCITS" },

  // ---- India / China ----
  { isin: "IE00BZCQB185", category: "India equity", note: "iShares MSCI India UCITS" },
  { isin: "IE00BFMXYX26", category: "China A equity", note: "iShares MSCI China A UCITS" },
  { isin: "IE00B02KXK85", category: "China equity", note: "iShares MSCI China UCITS" },

  // ---- Sectors (S&P 500) ----
  { isin: "IE00B43HR379", category: "Sector US Tech", note: "iShares S&P 500 Information Technology Sector UCITS" },
  { isin: "IE00B4K6B022", category: "Sector US Healthcare", note: "iShares S&P 500 Health Care Sector UCITS" },
  { isin: "IE00B4LJ4031", category: "Sector US Energy", note: "iShares S&P 500 Energy Sector UCITS" },
  { isin: "IE00B4MJ5D07", category: "Sector US Financials", note: "iShares S&P 500 Financials Sector UCITS" },
  { isin: "IE00B40B8R38", category: "Sector US Cons Stap", note: "iShares S&P 500 Consumer Staples Sector UCITS" },

  // ---- Sectors (Europe / World) ----
  { isin: "IE00BMW42181", category: "Thematic Clean Energy", note: "iShares Global Clean Energy UCITS" },
  { isin: "IE00BYZK4552", category: "Thematic Robotics", note: "iShares Automation & Robotics UCITS" },
  { isin: "IE00BGV5VN51", category: "Thematic Cybersecurity", note: "iShares Digital Security UCITS" },
  { isin: "IE00BYWQWR46", category: "Thematic Healthcare Innov", note: "iShares Healthcare Innovation UCITS" },
  { isin: "IE00BYZK4883", category: "Thematic Ageing Pop", note: "iShares Ageing Population UCITS" },
  { isin: "IE00BMDX0K95", category: "Thematic Megatrends", note: "iShares Smart City Infrastructure UCITS" },
  { isin: "IE00BG0J4C88", category: "Thematic Cybersecurity", note: "L&G Cyber Security UCITS" },
  { isin: "IE00BJK9H753", category: "Thematic Hydrogen", note: "L&G Hydrogen Economy UCITS" },
  { isin: "IE00BMDFBW48", category: "Thematic Cloud", note: "WisdomTree Cloud Computing UCITS Acc" },
  { isin: "IE00BMWXKN31", category: "Thematic AI", note: "WisdomTree Artificial Intelligence UCITS Acc" },
  { isin: "IE00BJ5JNZ06", category: "Thematic Cybersecurity", note: "WisdomTree Cybersecurity UCITS Acc" },
  { isin: "IE000U9ODG19", category: "Thematic Defense", note: "VanEck Defense UCITS ETF Acc" },
  { isin: "IE00BMC38736", category: "Thematic Defense", note: "HANetf Future of Defence UCITS" },
  { isin: "IE000FU3UM05", category: "Thematic Semiconductors", note: "Amundi MSCI Semiconductors ESG UCITS" },
  { isin: "IE00BMW3QX54", category: "Thematic EV", note: "iShares Electric Vehicles & Driving Tech UCITS" },

  // ---- Factor: Quality / Value / Momentum / MinVol ----
  { isin: "IE00BP3QZ601", category: "Factor Quality", note: "iShares Edge MSCI World Quality Factor UCITS" },
  { isin: "IE00BP3QZB59", category: "Factor Momentum", note: "iShares Edge MSCI World Momentum Factor UCITS" },
  { isin: "IE00BP3QZ825", category: "Factor Value", note: "iShares Edge MSCI World Value Factor UCITS" },
  { isin: "IE00BD1F4M44", category: "Factor MinVol", note: "iShares Edge MSCI World Minimum Volatility UCITS" },

  // ---- Dividend ----
  { isin: "IE00B6YX5D40", category: "Dividend US", note: "SPDR S&P US Dividend Aristocrats UCITS" },
  { isin: "IE00B9CQXS71", category: "Dividend Global", note: "SPDR S&P Global Dividend Aristocrats UCITS" },
  { isin: "IE00B6YX5C33", category: "Dividend UK", note: "SPDR S&P UK Dividend Aristocrats UCITS" },
  { isin: "IE00B5M1WJ87", category: "Dividend World HY", note: "Vanguard FTSE All-World High Dividend Yield UCITS" },
  { isin: "IE00BCHWNQ94", category: "Dividend World HY", note: "Vanguard FTSE All-World High Dividend Yield UCITS Acc" },
  { isin: "IE00B652H904", category: "Dividend Eurozone", note: "iShares EURO Dividend UCITS" },

  // ---- Small caps ----
  { isin: "IE00B3VWMM18", category: "Small cap World", note: "iShares MSCI World Small Cap UCITS" },
  { isin: "IE00BCBJG560", category: "Small cap Europe", note: "SPDR MSCI Europe Small Cap UCITS" },
  { isin: "IE00B42THM37", category: "Small cap US", note: "SPDR Russell 2000 US Small Cap UCITS" },

  // ---- ESG / SRI ----
  { isin: "IE00BFNM3J75", category: "ESG World SRI", note: "iShares MSCI World SRI UCITS" },
  { isin: "IE00BHZPJ569", category: "ESG US SRI", note: "iShares MSCI USA SRI UCITS" },
  { isin: "IE00BG0J4841", category: "ESG Europe SRI", note: "iShares MSCI Europe SRI UCITS" },
  { isin: "IE00BFNM3P36", category: "ESG EM SRI", note: "iShares MSCI EM SRI UCITS" },

  // ---- Gold / Commodities ----
  { isin: "IE00B4ND3602", category: "Gold (physical)", note: "iShares Physical Gold ETC" },
  { isin: "DE000A0S9GB0", category: "Gold (physical)", note: "Xetra-Gold (DE)" },
  { isin: "CH0044781232", category: "Gold (physical)", note: "ZKB Gold ETF AA CHF (CH)" },
  { isin: "JE00B1VS3770", category: "Gold (physical)", note: "WisdomTree Physical Gold (XAUP)" },
  { isin: "IE00B579F325", category: "Gold (physical)", note: "Invesco Physical Gold ETC" },
  { isin: "DE000A0H0728", category: "Commodities broad", note: "iShares Diversified Commodity Swap UCITS" },

  // ---- REITs ----
  { isin: "IE00B5L01S80", category: "REITs World", note: "iShares Developed Markets Property Yield UCITS" },
  { isin: "IE00B0M63284", category: "REITs Asia", note: "iShares Asia Property Yield UCITS" },

  // ---- Government bonds (EUR) ----
  { isin: "IE00B1FZS798", category: "Govt bonds EUR 7-10", note: "iShares Core EUR Govt Bond UCITS" },
  { isin: "IE00B3VWN518", category: "Govt bonds EUR 1-3", note: "iShares EUR Govt Bond 1-3yr UCITS" },
  { isin: "IE00B4WXJJ64", category: "Govt bonds EUR core", note: "iShares Core EUR Govt Bond UCITS" },

  // ---- Government bonds (USD) ----
  { isin: "IE00B3VWN179", category: "Govt bonds US 7-10", note: "iShares USD Treasury Bond 7-10yr UCITS" },
  { isin: "IE00BSKRJZ44", category: "Govt bonds US core", note: "iShares Core USD Govt Bond UCITS" },
  { isin: "IE00B1FZS244", category: "US Aggregate Bond", note: "iShares Core US Aggregate Bond UCITS" },

  // ---- Inflation-linked ----
  { isin: "IE00B0M62X26", category: "Inflation-linked EUR", note: "iShares EUR Inflation Linked Govt Bond UCITS" },
  { isin: "IE00B1FZSC47", category: "Inflation-linked US", note: "iShares USD TIPS UCITS" },

  // ---- Corporate bonds (IG) ----
  { isin: "IE00B3F81R35", category: "Corp bonds EUR IG", note: "iShares Core EUR Corporate Bond UCITS" },
  { isin: "IE00B3F81G20", category: "Corp bonds USD IG", note: "iShares Core USD Corp Bond UCITS" },

  // ---- Corporate bonds (HY) ----
  { isin: "IE00B66F4759", category: "Corp bonds EUR HY", note: "iShares EUR High Yield Corporate Bond UCITS" },
  { isin: "IE00BJK55C48", category: "Fallen Angels HY", note: "iShares Fallen Angels High Yield Corp Bond UCITS" },

  // ---- EM bonds ----
  { isin: "IE00B2NPKV68", category: "EM bonds USD", note: "iShares J.P. Morgan EM Bond UCITS" },
  { isin: "IE00B5L65R35", category: "EM bonds USD", note: "iShares JPM USD EM Bond UCITS" },
  { isin: "IE00B9M6RS56", category: "EM bonds local", note: "iShares J.P. Morgan EM Local Govt Bond UCITS" },

  // ---- Money market / ultrashort ----
  { isin: "IE00BCRY6557", category: "Money market USD", note: "PIMCO US Dollar Short Maturity UCITS" },
  { isin: "LU0290358497", category: "Eurozone (already listed) — duplicate stress entry", note: "Xtrackers EURO STOXX 50 UCITS 1C — listed twice intentionally to test dedupe" },
];

// Re-export simple metadata that the script + tests can use.
export const SEED_VERSION = "2026-05-01";
export const SEED_PROVENANCE =
  "Curated proxy for justETF popularity ranking — covers high-AUM UCITS ETFs across broad-equity, regional, sector/thematic, factor, dividend, ESG, commodities, REITs and bond categories.";
