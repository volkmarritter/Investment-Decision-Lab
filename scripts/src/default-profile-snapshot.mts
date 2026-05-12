/**
 * Generates an Excel workbook documenting the Investment Decision Lab's
 * default profile (Risk High / 10y / CHF / numETFs 10 / Gold ✓ / REITs ✗ /
 * Crypto ✗ / Hedging ✗) as of the snapshot date below.
 *
 * The sheets that *can* express their derivation in Excel (CMA Sharpe,
 * total weight, look-through effective μ, the full covariance matrix and
 * the eight risk/performance metrics) are written as live formulas that
 * recompute when the workbook is opened. Inputs the engine treats as
 * data (CMA μ/σ, correlations, geo profiles, benchmark weights) are
 * written as values; the formulas in dependent cells reference them so
 * editing any input recomputes the metrics.
 *
 * When the engine source-of-truth files change, re-read the comments
 * marking each block and bump the values accordingly. Re-running this
 * script regenerates the workbook in scripts/output/.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync } from "node:fs";
import ExcelJS from "exceljs";

const SNAPSHOT_DATE = "2026-05-12";

// ---------------------------------------------------------------------------
// Capital-market assumptions (after the 4-layer merge: seed → app-defaults →
// consensus → user). At snapshot time, app-defaults.json carries no `cma`
// overrides and cmas.consensus.json is empty, so the active values equal
// BASE_SEED in artifacts/investment-lab/src/lib/metrics.ts.
// ---------------------------------------------------------------------------
type AssetKey =
  | "equity_us" | "equity_eu" | "equity_uk" | "equity_ch" | "equity_jp"
  | "equity_em" | "equity_thematic" | "equity_other"
  | "bonds" | "cash" | "gold" | "reits" | "crypto";

const CMA: Record<AssetKey, { label: string; mu: number; sigma: number }> = {
  equity_us:       { label: "US Equity",          mu: 0.070, sigma: 0.16 },
  equity_eu:       { label: "Europe Equity",      mu: 0.075, sigma: 0.17 },
  equity_uk:       { label: "UK Equity",          mu: 0.065, sigma: 0.15 },
  equity_ch:       { label: "Swiss Equity",       mu: 0.060, sigma: 0.13 },
  equity_jp:       { label: "Japan Equity",       mu: 0.060, sigma: 0.16 },
  equity_em:       { label: "EM Equity",          mu: 0.085, sigma: 0.22 },
  equity_thematic: { label: "Thematic Equity",    mu: 0.080, sigma: 0.22 },
  equity_other:    { label: "Other / Residual",   mu: 0.072, sigma: 0.17 },
  bonds:           { label: "Global Bonds",       mu: 0.035, sigma: 0.06 },
  cash:            { label: "Cash",               mu: 0.030, sigma: 0.005 },
  gold:            { label: "Gold",               mu: 0.040, sigma: 0.16 },
  reits:           { label: "Listed Real Estate", mu: 0.065, sigma: 0.18 },
  crypto:          { label: "Crypto",             mu: 0.120, sigma: 0.70 },
};

// WHT drag (metrics.ts WHT_DRAG). For CHF base, equity_ch is overridden
// to 0 (CHF residents fully reclaim the 35% federal anticipatory tax).
const WHT_BASE: Record<AssetKey, number> = {
  equity_us: 0.0030, equity_eu: 0.0020, equity_uk: 0.0020,
  equity_ch: 0.0020, equity_jp: 0.0020, equity_em: 0.0040,
  equity_thematic: 0.0020, equity_other: 0.0025,
  bonds: 0, cash: 0, gold: 0, reits: 0, crypto: 0,
};
function whtForCHF(k: AssetKey): number {
  return k === "equity_ch" ? 0 : WHT_BASE[k];
}

// Risk-free rates per currency: BUILT_IN_RF in settings.ts overlaid by
// app-defaults.json (CHF 0.004, EUR 0.03, GBP 0.049). USD has no override.
const RF: Record<"USD" | "EUR" | "GBP" | "CHF", number> = {
  USD: 0.0425, EUR: 0.0300, GBP: 0.0490, CHF: 0.0040,
};
const RF_CHF = RF.CHF;

// Home-bias factors: BUILT_IN_HB in settings.ts (no app-defaults override).
const HOME_BIAS: Record<"USD" | "EUR" | "GBP" | "CHF", number> = {
  USD: 1.0, EUR: 1.5, GBP: 1.5, CHF: 2.5,
};

// CHF anchor (MCAP_ANCHOR_CHF in portfolio.ts).
const ANCHOR_CHF: Record<string, number> = {
  USA: 0.60, Europe: 0.10, Switzerland: 0.04, Japan: 0.05, EM: 0.11,
};
const REGION_TO_CMA: Record<string, AssetKey> = {
  USA: "equity_us", Europe: "equity_eu", UK: "equity_uk",
  Switzerland: "equity_ch", Japan: "equity_jp", EM: "equity_em",
};

// Normal-regime correlation matrix (C in metrics.ts).
const ASSET_ORDER: AssetKey[] = [
  "equity_us","equity_eu","equity_uk","equity_ch","equity_jp","equity_em",
  "equity_thematic","equity_other","bonds","cash","gold","reits","crypto",
];
const C_RAW: Partial<Record<AssetKey, Partial<Record<AssetKey, number>>>> = {
  equity_us: { equity_eu: 0.82, equity_uk: 0.78, equity_ch: 0.70, equity_jp: 0.70, equity_em: 0.72, equity_thematic: 0.85, equity_other: 0.85, bonds: 0.10, cash: 0.00, gold: 0.05, reits: 0.70, crypto: 0.30 },
  equity_eu: { equity_uk: 0.85, equity_ch: 0.78, equity_jp: 0.65, equity_em: 0.72, equity_thematic: 0.78, equity_other: 0.80, bonds: 0.10, cash: 0.00, gold: 0.05, reits: 0.70, crypto: 0.28 },
  equity_uk: { equity_ch: 0.72, equity_jp: 0.55, equity_em: 0.62, equity_thematic: 0.65, equity_other: 0.75, bonds: 0.10, cash: 0.00, gold: 0.10, reits: 0.65, crypto: 0.25 },
  equity_ch: { equity_jp: 0.55, equity_em: 0.60, equity_thematic: 0.65, equity_other: 0.70, bonds: 0.15, cash: 0.00, gold: 0.10, reits: 0.62, crypto: 0.20 },
  equity_jp: { equity_em: 0.60, equity_thematic: 0.65, equity_other: 0.70, bonds: 0.10, cash: 0.00, gold: 0.05, reits: 0.55, crypto: 0.22 },
  equity_em: { equity_thematic: 0.75, equity_other: 0.75, bonds: 0.05, cash: 0.00, gold: 0.15, reits: 0.65, crypto: 0.40 },
  equity_thematic: { equity_other: 0.80, bonds: 0.05, cash: 0.00, gold: 0.05, reits: 0.65, crypto: 0.45 },
  equity_other: { bonds: 0.10, cash: 0.00, gold: 0.05, reits: 0.65, crypto: 0.30 },
  bonds: { cash: 0.40, gold: 0.20, reits: 0.30, crypto: 0.05 },
  cash: { gold: 0.05, reits: 0.00, crypto: 0.00 },
  gold: { reits: 0.10, crypto: 0.20 },
  reits: { crypto: 0.30 },
};
function corr(a: AssetKey, b: AssetKey): number {
  if (a === b) return 1;
  return C_RAW[a]?.[b] ?? C_RAW[b]?.[a] ?? 0;
}

// Benchmark: MSCI ACWI proxy (BENCHMARK in metrics.ts).
const BENCHMARK_W: Partial<Record<AssetKey, number>> = {
  equity_us: 0.60, equity_eu: 0.14, equity_uk: 0.04,
  equity_ch: 0.04, equity_jp: 0.04, equity_em: 0.14,
};

const EQUITY_REGION_CAP = 65;

// ---------------------------------------------------------------------------
// Default ETF per bucket — pulled from BUCKETS + INSTRUMENTS in
// artifacts/investment-lab/src/lib/etfs.ts.
// ---------------------------------------------------------------------------
type EtfMeta = { name: string; isin: string; ter: number; sixTicker?: string; defaultExchange: string; defaultTicker: string };
const ETF_BY_BUCKET: Record<string, EtfMeta> = {
  "Equity-USA":              { name: "iShares Core S&P 500 UCITS",              isin: "IE00B5BMR087", ter: 0.07, sixTicker: "CSSPX", defaultExchange: "LSE",   defaultTicker: "CSPX" },
  "Equity-Europe":           { name: "iShares Core MSCI Europe UCITS",          isin: "IE00B4K48X80", ter: 0.12, sixTicker: "CEU",   defaultExchange: "XETRA", defaultTicker: "SXR7" },
  "Equity-Switzerland":      { name: "iShares Core SPI",                        isin: "CH0237935652", ter: 0.10, sixTicker: "CHSPI", defaultExchange: "SIX",   defaultTicker: "CHSPI" },
  "Equity-Japan":            { name: "iShares Core MSCI Japan IMI UCITS",       isin: "IE00B4L5YX21", ter: 0.12, sixTicker: "CSJP",  defaultExchange: "LSE",   defaultTicker: "SJPA" },
  "Equity-EM":               { name: "iShares Core MSCI EM IMI UCITS",          isin: "IE00BKM4GZ66", ter: 0.18, sixTicker: "EIMI",  defaultExchange: "LSE",   defaultTicker: "EIMI" },
  "FixedIncome-Global":      { name: "iShares Core Global Aggregate Bond UCITS", isin: "IE00B3F81409", ter: 0.10, sixTicker: "AGGH", defaultExchange: "LSE",   defaultTicker: "AGGG" },
  "Commodities-Gold":        { name: "Invesco Physical Gold ETC",               isin: "IE00B579F325", ter: 0.12, sixTicker: "SGLD",  defaultExchange: "LSE",   defaultTicker: "SGLD" },
};
const REGION_TO_BUCKET: Record<string, string> = {
  USA: "Equity-USA", Europe: "Equity-Europe", Switzerland: "Equity-Switzerland",
  Japan: "Equity-Japan", EM: "Equity-EM",
};

// ---------------------------------------------------------------------------
// Look-through geo profiles (curated PROFILES + lookthrough.overrides.json
// snapshot of 2026-05-11). Only the country labels matter for routing —
// CMA mapping uses COUNTRY_TO_EQUITY_KEY in metrics.ts.
// ---------------------------------------------------------------------------
const COUNTRY_TO_KEY: Record<string, AssetKey> = {
  "United States": "equity_us", "USA": "equity_us",
  "United Kingdom": "equity_uk", "UK": "equity_uk",
  "Switzerland": "equity_ch",
  "Japan": "equity_jp",
  "France": "equity_eu", "Germany": "equity_eu", "Netherlands": "equity_eu",
  "Sweden": "equity_eu", "Italy": "equity_eu", "Spain": "equity_eu",
  "Denmark": "equity_eu", "Norway": "equity_eu", "Belgium": "equity_eu",
  "Austria": "equity_eu", "Finland": "equity_eu", "Portugal": "equity_eu",
  "Other Europe": "equity_eu", "Other EU": "equity_eu", "Europe": "equity_eu",
  "Australia": "equity_jp", "Hong Kong": "equity_jp",
  "Singapore": "equity_jp", "New Zealand": "equity_jp",
  "China": "equity_em", "India": "equity_em", "Taiwan": "equity_em",
  "Brazil": "equity_em", "South Korea": "equity_em", "Mexico": "equity_em",
  "South Africa": "equity_em", "Saudi Arabia": "equity_em",
  "Indonesia": "equity_em", "Thailand": "equity_em", "Malaysia": "equity_em",
  "Poland": "equity_em", "United Arab Emirates": "equity_em",
  "Other EM": "equity_em",
};
const ETF_GEO: Record<string, Record<string, number>> = {
  "IE00B5BMR087": { "United States": 95.16, "Ireland": 1.44, "Other": 3.4 },
  "IE00B4K48X80": {
    "United Kingdom": 19.61, "France": 14.17, "Germany": 13.58,
    "Switzerland": 12.28, "Netherlands": 8.55, "Spain": 5.47,
    "Italy": 4.63, "Sweden": 4.62, "Finland": 1.62, "Denmark": 1.61,
    "Belgium": 1.33, "Ireland": 1.07, "Norway": 1.02, "Other": 10.44,
  },
  "CH0237935652": { "Switzerland": 79.59, "Other": 20.41 },
  "IE00B4L5YX21": { "Japan": 97.09, "Other": 2.91 },
  "IE00BKM4GZ66": {
    "Taiwan": 21.99, "China": 21, "South Korea": 15.19, "India": 11.53,
    "Brazil": 4.44, "Saudi Arabia": 3.07, "South Africa": 2.79,
    "Mexico": 1.84, "Malaysia": 1.42, "Hong Kong": 1.21, "Thailand": 1.17,
    "United Arab Emirates": 1.15, "Poland": 1.14, "Other": 12.06,
  },
};

// ---------------------------------------------------------------------------
// Replicate computeEquityRegionWeights for the default inputs (CHF, 10y).
// ---------------------------------------------------------------------------
function round1(x: number): number { return Math.round(x * 10) / 10; }

function computeEquityRegionWeights(): { regionPct: Record<string, number>; derivation: Record<string, string> } {
  const rf = RF_CHF;
  const regions = Object.keys(ANCHOR_CHF);
  const raw: Record<string, number> = {};
  const derivation: Record<string, string> = {};
  for (const r of regions) {
    const c = CMA[REGION_TO_CMA[r]];
    const sharpe = (c.mu - rf) / c.sigma;
    const sharpeMult = Math.pow(Math.max(sharpe, 0.05) / 0.25, 0.4);
    raw[r] = ANCHOR_CHF[r] * sharpeMult;
    derivation[r] = `anchor ${(ANCHOR_CHF[r] * 100).toFixed(0)}% × (max(Sharpe,0.05)/0.25)^0.4 = ${ANCHOR_CHF[r].toFixed(2)} × ${sharpeMult.toFixed(3)}`;
  }
  raw["Switzerland"] *= HOME_BIAS.CHF;
  derivation["Switzerland"] += ` × home-bias ${HOME_BIAS.CHF}`;
  raw["EM"] *= 1.3;
  derivation["EM"] += ` × 1.3 (horizon ≥ 10)`;
  let total = 0;
  for (const r of regions) total += raw[r];
  const w: Record<string, number> = {};
  for (const r of regions) w[r] = (raw[r] / total) * 100;
  for (let iter = 0; iter < 6; iter++) {
    let excess = 0;
    for (const r of regions) {
      if (w[r] > EQUITY_REGION_CAP) {
        excess += w[r] - EQUITY_REGION_CAP;
        w[r] = EQUITY_REGION_CAP;
      }
    }
    if (excess <= 0.01) break;
    const belowSum = regions.filter(r => w[r] < EQUITY_REGION_CAP).reduce((s, r) => s + w[r], 0);
    if (belowSum <= 0) break;
    for (const r of regions) {
      if (w[r] < EQUITY_REGION_CAP) w[r] += (w[r] / belowSum) * excess;
    }
  }
  return { regionPct: w, derivation };
}

// ---------------------------------------------------------------------------
// Replicate buildPortfolio (default inputs).
// ---------------------------------------------------------------------------
type Row = {
  assetClass: string;
  region: string;
  weightPct: number;
  derivation: string;
  bucket?: string;
};

function buildAllocation(): Row[] {
  const equityPct = Math.min(60, 90); // targetEquityPct vs maxEquityMap[High]
  const defensivePct = 100 - equityPct; // 40
  let cashPct = Math.min(Math.max((10 - 10) * 1.5 + 0, 2), 20); // = 2
  cashPct = Math.min(cashPct, defensivePct);
  let bondsPct = defensivePct - cashPct; // 38
  const goldPct = Math.min(5, bondsPct * 0.15); // 5%
  bondsPct -= goldPct; // 33

  const coreEquity = equityPct;
  const { regionPct, derivation } = computeEquityRegionWeights();

  const all: { class: string; region: string; weight: number; deriv: string; bucketKey?: string }[] = [];
  for (const r of Object.keys(regionPct)) {
    const w = (regionPct[r] / 100) * coreEquity;
    if (w > 0) {
      all.push({
        class: "Equity", region: r, weight: w,
        deriv: `${derivation[r]} → ${regionPct[r].toFixed(2)}% of equity sleeve × ${coreEquity}% equity = ${w.toFixed(2)}%`,
        bucketKey: REGION_TO_BUCKET[r],
      });
    }
  }
  all.push({ class: "Commodities", region: "Gold", weight: goldPct,
    deriv: `min(5, bonds(38) × 0.15 = 5.70) = 5.00%; subtracted from bonds`, bucketKey: "Commodities-Gold" });
  all.push({ class: "Fixed Income", region: "Global", weight: bondsPct,
    deriv: `defensive(40) − cash(2) − gold(5) = 33%`, bucketKey: "FixedIncome-Global" });
  all.push({ class: "Cash", region: "CHF", weight: cashPct,
    deriv: `clamp((10−horizon) × 1.5 + 0, 2, 20) = 2%; capped by defensive sleeve` });

  let total = 0;
  for (const r of all) { r.weight = round1(r.weight); total += r.weight; }
  const sorted = [...all].sort((a, b) => b.weight - a.weight);
  const diff = round1(100 - total);
  if (diff !== 0) sorted[0].weight = round1(sorted[0].weight + diff);

  const orderRank: Record<string, number> = {
    "Cash": 0, "Fixed Income": 1, "Equity": 2,
    "Commodities": 3, "Real Estate": 4, "Digital Assets": 5,
  };
  all.sort((a, b) => {
    const ra = orderRank[a.class] ?? 99;
    const rb = orderRank[b.class] ?? 99;
    if (ra !== rb) return ra - rb;
    return b.weight - a.weight;
  });

  return all.map(r => ({
    assetClass: r.class, region: r.region, weightPct: r.weight,
    derivation: r.deriv, bucket: r.bucketKey,
  }));
}

// ---------------------------------------------------------------------------
// Look-through routing → 13-bucket exposure vector (matches
// mapAllocationToAssetsLookthrough in metrics.ts for CHF base).
// ---------------------------------------------------------------------------
type ExposureRow = { key: AssetKey; weight: number; derivation: string };

function lookthroughExposures(allocation: Row[]): ExposureRow[] {
  const map: Record<AssetKey, number> = {
    equity_us: 0, equity_eu: 0, equity_uk: 0, equity_ch: 0, equity_jp: 0, equity_em: 0,
    equity_thematic: 0, equity_other: 0, bonds: 0, cash: 0, gold: 0, reits: 0, crypto: 0,
  };
  const derivParts: Record<AssetKey, string[]> = {} as Record<AssetKey, string[]>;
  for (const k of ASSET_ORDER) derivParts[k] = [];

  for (const r of allocation) {
    const w = r.weightPct / 100;
    if (w <= 0) continue;
    if (r.assetClass === "Cash") {
      map.cash += w;
      derivParts.cash.push(`Cash ${r.region} ${(w * 100).toFixed(1)}%`);
    } else if (r.assetClass === "Fixed Income") {
      map.bonds += w;
      derivParts.bonds.push(`${r.assetClass}-${r.region} ${(w * 100).toFixed(1)}%`);
    } else if (r.assetClass === "Commodities") {
      map.gold += w;
      derivParts.gold.push(`${r.assetClass}-${r.region} ${(w * 100).toFixed(1)}%`);
    } else if (r.assetClass === "Equity" && r.bucket) {
      const isin = ETF_BY_BUCKET[r.bucket]?.isin;
      const geo = isin ? ETF_GEO[isin] : undefined;
      if (!geo) {
        // Fallback to region routing.
        const k = REGION_TO_CMA[r.region] ?? "equity_other";
        map[k] += w;
        derivParts[k].push(`Equity-${r.region} ${(w * 100).toFixed(1)}% (no LT)`);
        continue;
      }
      const total = Object.values(geo).reduce((s, v) => s + v, 0);
      let unmapped = 0;
      for (const [country, pct] of Object.entries(geo)) {
        const slice = (pct / total) * w;
        const k = COUNTRY_TO_KEY[country];
        if (k) {
          map[k] += slice;
          derivParts[k].push(`Equity-${r.region}×${country} ${(slice * 100).toFixed(2)}%`);
        } else {
          unmapped += slice;
        }
      }
      if (unmapped > 0) {
        map.equity_other += unmapped;
        derivParts.equity_other.push(`Equity-${r.region} unmapped ${(unmapped * 100).toFixed(2)}%`);
      }
    }
  }

  return ASSET_ORDER.map(k => ({
    key: k, weight: map[k],
    derivation: derivParts[k].join(" + ") || "—",
  }));
}

// ---------------------------------------------------------------------------
// Spreadsheet column letters (covers up to ZZ; we only need ~14).
// ---------------------------------------------------------------------------
function col(n: number): string {
  let s = "";
  let x = n;
  while (x > 0) {
    const r = (x - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    x = Math.floor((x - 1) / 26);
  }
  return s;
}

// ---------------------------------------------------------------------------
// Workbook construction.
// ---------------------------------------------------------------------------
async function main() {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const outDir = path.resolve(__dirname, "../output");
  mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "default-profile-snapshot.xlsx");
  // Mirror copy: serve the same file from the investment-lab's static
  // public/ directory so the Methodology tab can link to it via Vite's
  // BASE_URL. Both files are written from the same workbook instance,
  // so they stay in lockstep.
  const publicDir = path.resolve(__dirname, "../../artifacts/investment-lab/public");
  const publicPath = path.join(publicDir, "default-profile-snapshot.xlsx");

  const wb = new ExcelJS.Workbook();
  wb.creator = "Investment Decision Lab";
  wb.created = new Date(SNAPSHOT_DATE);

  const HEADER_FILL: ExcelJS.FillPattern = {
    type: "pattern", pattern: "solid", fgColor: { argb: "FFE7EEF7" },
  };
  const NOTE_FILL: ExcelJS.FillPattern = {
    type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF8E1" },
  };
  const styleHeader = (row: ExcelJS.Row) => {
    row.font = { bold: true };
    row.fill = HEADER_FILL;
    row.alignment = { vertical: "middle" };
  };

  // ---------------- Sheet 1: Allocation ----------------
  const ws1 = wb.addWorksheet("Allocation");
  ws1.columns = [
    { header: "Asset Class",       key: "ac",    width: 18 },
    { header: "Region / Bucket",   key: "reg",   width: 22 },
    { header: "Allocation %",      key: "w",     width: 14 },
    { header: "Derivation",        key: "der",   width: 80 },
    { header: "Default ETF",       key: "etf",   width: 42 },
    { header: "ISIN",              key: "isin",  width: 16 },
    { header: "Listing",           key: "list",  width: 16 },
    { header: "TER %",             key: "ter",   width: 10 },
  ];
  styleHeader(ws1.getRow(1));

  const allocation = buildAllocation();
  const allocStartRow = 2;
  const rowIndex: Record<string, number> = {};
  allocation.forEach((r, i) => {
    const etf = r.bucket ? ETF_BY_BUCKET[r.bucket] : undefined;
    let listing = "—";
    if (etf) {
      if (etf.sixTicker) listing = `SIX: ${etf.sixTicker}`;
      else listing = `${etf.defaultExchange}: ${etf.defaultTicker}`;
    }
    ws1.addRow({
      ac: r.assetClass, reg: r.region, w: r.weightPct / 100,
      der: r.derivation, etf: etf?.name ?? "(no ETF — cash sleeve)",
      isin: etf?.isin ?? "—", list: listing,
      ter: etf ? etf.ter / 100 : null,
    });
    rowIndex[`${r.assetClass}|${r.region}`] = allocStartRow + i;
  });
  // Total = SUM formula.
  const allocLastRow = ws1.lastRow!.number;
  const totalRow = ws1.addRow({ ac: "Total" });
  totalRow.getCell("w").value = { formula: `SUM(C${allocStartRow}:C${allocLastRow})`, result: 1 };
  totalRow.font = { bold: true };
  totalRow.fill = HEADER_FILL;

  ws1.getColumn("w").numFmt = "0.00%";
  ws1.getColumn("ter").numFmt = "0.00%";
  ws1.getColumn("der").alignment = { wrapText: true, vertical: "top" };

  // -----------------------------------------------------------------
  // Equity Construction block (live formulas for THIS example).
  //
  // Mirrors computeEquityRegionWeights in portfolio.ts:
  //   raw_r       = anchor_r · POWER(MAX(Sharpe_r, 0.05)/0.25, 0.4)
  //                 · home_bias_r · em_tilt_r
  //   normalized  = raw_r / SUM(raw) · equity_share (60%)
  //
  // Sharpe is a live cell on the CMA Assumptions sheet, so editing μ
  // or σ there will recompute the equity sleeve automatically.
  // The 65% concentration cap is not encoded — for this profile no
  // region hits it, so the simple normalisation reproduces the engine.
  // -----------------------------------------------------------------
  const ecEquityShare = 0.60; // targetEquityPct for the documented default profile
  type EcRegion = { name: string; anchor: number; cmaRow: number; home: number; emTilt: number };
  const EC_REGIONS: EcRegion[] = [
    { name: "USA",         anchor: 0.60, cmaRow: 2, home: 1.0, emTilt: 1.0 },
    { name: "Europe",      anchor: 0.10, cmaRow: 3, home: 1.0, emTilt: 1.0 },
    { name: "Switzerland", anchor: 0.04, cmaRow: 5, home: 2.5, emTilt: 1.0 },
    { name: "Japan",       anchor: 0.05, cmaRow: 6, home: 1.0, emTilt: 1.0 },
    { name: "EM",          anchor: 0.11, cmaRow: 7, home: 1.0, emTilt: 1.3 },
  ];
  const ecTitleRow = ws1.addRow([]);
  ws1.addRow([]);
  const ecHeaderRowNum = ws1.lastRow!.number + 1;
  ws1.getCell(`A${ecTitleRow.number + 1}`).value =
    "Equity Construction (this example) — anchor × POWER(MAX(Sharpe,0.05)/0.25, 0.4) × home-bias × EM tilt, normalised, × equity share (60%)";
  ws1.getCell(`A${ecTitleRow.number + 1}`).font = { bold: true };
  const ecHeader = ws1.addRow([
    "Region", "Anchor", "Sharpe (live)", "Overlay", "Home-bias", "EM tilt", "Raw", "Normalised × 60%",
  ]);
  ecHeader.font = { bold: true };
  ecHeader.fill = HEADER_FILL;
  void ecHeaderRowNum;
  const ecDataStart = ws1.lastRow!.number + 1;
  EC_REGIONS.forEach((rg, i) => {
    const r = ecDataStart + i;
    const c = CMA[REGION_TO_CMA[rg.name]];
    const sharpeVal = c.sigma > 0 ? (c.mu - RF_CHF) / c.sigma : 0;
    const overlayVal = Math.pow(Math.max(sharpeVal, 0.05) / 0.25, 0.4);
    const rawVal = rg.anchor * overlayVal * rg.home * rg.emTilt;
    ws1.getCell(`A${r}`).value = rg.name;
    ws1.getCell(`B${r}`).value = rg.anchor;
    ws1.getCell(`C${r}`).value = {
      formula: `'CMA Assumptions'!E${rg.cmaRow}`,
      result: sharpeVal,
    };
    ws1.getCell(`D${r}`).value = {
      formula: `POWER(MAX(C${r},0.05)/0.25,0.4)`,
      result: overlayVal,
    };
    ws1.getCell(`E${r}`).value = rg.home;
    ws1.getCell(`F${r}`).value = rg.emTilt;
    ws1.getCell(`G${r}`).value = {
      formula: `B${r}*D${r}*E${r}*F${r}`,
      result: rawVal,
    };
  });
  const ecDataEnd = ecDataStart + EC_REGIONS.length - 1;
  const rawSumRange = `G${ecDataStart}:G${ecDataEnd}`;
  let sumRaw = 0;
  EC_REGIONS.forEach((rg) => {
    const c = CMA[REGION_TO_CMA[rg.name]];
    const sharpeVal = c.sigma > 0 ? (c.mu - RF_CHF) / c.sigma : 0;
    const overlayVal = Math.pow(Math.max(sharpeVal, 0.05) / 0.25, 0.4);
    sumRaw += rg.anchor * overlayVal * rg.home * rg.emTilt;
  });
  EC_REGIONS.forEach((rg, i) => {
    const r = ecDataStart + i;
    const c = CMA[REGION_TO_CMA[rg.name]];
    const sharpeVal = c.sigma > 0 ? (c.mu - RF_CHF) / c.sigma : 0;
    const overlayVal = Math.pow(Math.max(sharpeVal, 0.05) / 0.25, 0.4);
    const normVal = (rg.anchor * overlayVal * rg.home * rg.emTilt) / sumRaw * ecEquityShare;
    ws1.getCell(`H${r}`).value = {
      formula: `G${r}/SUM(${rawSumRange})*${ecEquityShare}`,
      result: normVal,
    };
  });
  // Format the construction block.
  for (let r = ecDataStart; r <= ecDataEnd; r++) {
    ws1.getCell(`B${r}`).numFmt = "0.00";
    ws1.getCell(`C${r}`).numFmt = "0.000";
    ws1.getCell(`D${r}`).numFmt = "0.000";
    ws1.getCell(`E${r}`).numFmt = "0.00";
    ws1.getCell(`F${r}`).numFmt = "0.00";
    ws1.getCell(`G${r}`).numFmt = "0.0000";
    ws1.getCell(`H${r}`).numFmt = "0.00%";
  }

  // -----------------------------------------------------------------
  // Wire the Allocation % column to live formulas.
  // -----------------------------------------------------------------
  const cashRow = rowIndex["Cash|CHF"];
  const goldRow = rowIndex["Commodities|Gold"];
  const bondsRow = rowIndex["Fixed Income|Global"];
  if (cashRow) {
    ws1.getCell(`C${cashRow}`).value = {
      formula: `MAX(0.02,MIN(0.20,(10-10)*0.015+0))`,
      result: 0.02,
    };
  }
  if (goldRow && cashRow) {
    ws1.getCell(`C${goldRow}`).value = {
      formula: `MIN(0.05,(1-${ecEquityShare}-C${cashRow})*0.15)`,
      result: 0.05,
    };
  }
  if (bondsRow && cashRow && goldRow) {
    ws1.getCell(`C${bondsRow}`).value = {
      formula: `1-${ecEquityShare}-C${cashRow}-C${goldRow}`,
      result: 0.33,
    };
  }
  EC_REGIONS.forEach((rg, i) => {
    const allocRow = rowIndex[`Equity|${rg.name}`];
    if (!allocRow) return;
    const ecRow = ecDataStart + i;
    const c = CMA[REGION_TO_CMA[rg.name]];
    const sharpeVal = c.sigma > 0 ? (c.mu - RF_CHF) / c.sigma : 0;
    const overlayVal = Math.pow(Math.max(sharpeVal, 0.05) / 0.25, 0.4);
    const normVal = (rg.anchor * overlayVal * rg.home * rg.emTilt) / sumRaw * ecEquityShare;
    ws1.getCell(`C${allocRow}`).value = {
      formula: `H${ecRow}`,
      result: normVal,
    };
  });

  // ---------------- Sheet 2: CMA Assumptions ----------------
  const ws2 = wb.addWorksheet("CMA Assumptions");
  ws2.columns = [
    { header: "Asset Key",            key: "k",   width: 18 },
    { header: "Label",                key: "lbl", width: 22 },
    { header: "Expected Return μ",    key: "mu",  width: 18 },
    { header: "Volatility σ",         key: "sig", width: 16 },
    { header: "Sharpe ((μ−Rf)/σ)",    key: "sh",  width: 18 },
    { header: "Risk-Free Rate (CHF)", key: "rf",  width: 18 },
  ];
  styleHeader(ws2.getRow(1));
  for (let i = 0; i < ASSET_ORDER.length; i++) {
    const k = ASSET_ORDER[i];
    const c = CMA[k];
    const r = i + 2;
    ws2.addRow({ k, lbl: c.label, mu: c.mu, sig: c.sigma, sh: null, rf: RF_CHF });
    // Sharpe as live formula.
    ws2.getCell(`E${r}`).value = {
      formula: `IF(D${r}>0,(C${r}-F${r})/D${r},0)`,
      result: c.sigma > 0 ? (c.mu - RF_CHF) / c.sigma : 0,
    };
  }
  ws2.getColumn("mu").numFmt = "0.00%";
  ws2.getColumn("sig").numFmt = "0.00%";
  ws2.getColumn("sh").numFmt = "0.000";
  ws2.getColumn("rf").numFmt = "0.00%";

  // ---------------- Sheet 3: Correlations ----------------
  const ws3 = wb.addWorksheet("Correlations");
  ws3.getColumn(1).width = 18;
  ws3.addRow(["Asset", ...ASSET_ORDER]);
  styleHeader(ws3.getRow(1));
  for (const a of ASSET_ORDER) {
    const row: (string | number)[] = [a];
    for (const b of ASSET_ORDER) row.push(corr(a, b));
    ws3.addRow(row);
  }
  for (let c = 2; c <= ASSET_ORDER.length + 1; c++) {
    ws3.getColumn(c).width = 12;
    ws3.getColumn(c).numFmt = "0.00";
  }
  for (let i = 0; i < ASSET_ORDER.length; i++) {
    const cell = ws3.getCell(i + 2, i + 2);
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF2F2F2" } };
    cell.font = { bold: true };
  }
  for (let i = 2; i <= ASSET_ORDER.length + 1; i++) {
    ws3.getCell(i, 1).font = { bold: true };
  }

  // ---------------- Sheet 4: Look-through Exposures ----------------
  const ws4 = wb.addWorksheet("Look-through Exposures");
  ws4.columns = [
    { header: "Asset Key",     key: "k",     width: 18 },
    { header: "Label",         key: "lbl",   width: 22 },
    { header: "Weight",        key: "w",     width: 12 },
    { header: "WHT Drag",      key: "wht",   width: 12 },
    { header: "μ effective",   key: "mu",    width: 14 },
    { header: "Benchmark Wt",  key: "bw",    width: 14 },
    { header: "Derivation",    key: "der",   width: 90 },
  ];
  styleHeader(ws4.getRow(1));

  const exposures = lookthroughExposures(allocation);
  for (let i = 0; i < ASSET_ORDER.length; i++) {
    const k = ASSET_ORDER[i];
    const e = exposures[i];
    const wht = whtForCHF(k);
    const r = i + 2;
    ws4.addRow({
      k, lbl: CMA[k].label, w: e.weight, wht, mu: null,
      bw: BENCHMARK_W[k] ?? 0, der: e.derivation,
    });
    // μ_effective: cash sleeve uses Rf instead of CMA cash μ; non-cash uses CMA μ − WHT.
    if (k === "cash") {
      ws4.getCell(`E${r}`).value = {
        formula: `'CMA Assumptions'!F${r}-D${r}`,
        result: RF_CHF - wht,
      };
    } else {
      ws4.getCell(`E${r}`).value = {
        formula: `'CMA Assumptions'!C${r}-D${r}`,
        result: CMA[k].mu - wht,
      };
    }
  }
  // Total weight check.
  const expTotalRow = ws4.addRow({ k: "Total" });
  expTotalRow.getCell("w").value = { formula: `SUM(C2:C${ASSET_ORDER.length + 1})`, result: 1 };
  expTotalRow.getCell("bw").value = { formula: `SUM(F2:F${ASSET_ORDER.length + 1})`, result: 1 };
  expTotalRow.font = { bold: true };
  expTotalRow.fill = HEADER_FILL;

  ws4.getColumn("w").numFmt = "0.0000%";
  ws4.getColumn("wht").numFmt = "0.00%";
  ws4.getColumn("mu").numFmt = "0.00%";
  ws4.getColumn("bw").numFmt = "0.00%";
  ws4.getColumn("der").alignment = { wrapText: true, vertical: "top" };

  // ---------------- Sheet 5: _Covariance ----------------
  const ws5 = wb.addWorksheet("_Covariance");
  ws5.getColumn(1).width = 18;
  ws5.addRow(["Σ_ij = σi·σj·ρij", ...ASSET_ORDER]);
  styleHeader(ws5.getRow(1));
  for (let i = 0; i < ASSET_ORDER.length; i++) {
    const r = i + 2;
    const rowVals: (string | { formula: string; result: number })[] = [ASSET_ORDER[i]];
    for (let j = 0; j < ASSET_ORDER.length; j++) {
      const ri = i + 2;
      const rj = j + 2;
      const corrCell = `${col(j + 2)}${ri}`; // Correlations row r=i+2, col=j+2 (zero-based j+1+1)
      const formula = `'CMA Assumptions'!$D${ri}*'CMA Assumptions'!$D${rj}*Correlations!${corrCell}`;
      const result = CMA[ASSET_ORDER[i]].sigma * CMA[ASSET_ORDER[j]].sigma * corr(ASSET_ORDER[i], ASSET_ORDER[j]);
      rowVals.push({ formula, result });
    }
    const added = ws5.addRow(rowVals);
    added.getCell(1).font = { bold: true };
  }
  for (let c = 2; c <= ASSET_ORDER.length + 1; c++) {
    ws5.getColumn(c).width = 12;
    ws5.getColumn(c).numFmt = "0.00000";
  }

  // ---------------- Sheet 6: Risk & Performance ----------------
  // All eight metrics computed via Excel formulas referencing the sheets
  // above. Approach mirrors metrics.ts:computeMetrics — see PortfolioMetricsResult.
  const ws6 = wb.addWorksheet("Risk & Performance");
  ws6.getColumn(1).width = 28;
  ws6.getColumn(2).width = 16;
  ws6.getColumn(3).width = 80;

  const N = ASSET_ORDER.length; // 13
  const lastRow = N + 1; // row 14 in the upstream sheets
  const W_RANGE = `'Look-through Exposures'!C2:C${lastRow}`;
  const MU_RANGE = `'Look-through Exposures'!E2:E${lastRow}`;
  const BW_RANGE = `'Look-through Exposures'!F2:F${lastRow}`;
  const COV_RANGE = `_Covariance!B2:${col(N + 1)}${lastRow}`;
  const RF_REF = `'CMA Assumptions'!F2`;
  // Equity-share: rows 2..9 are equity_*; row 13 is reits; row 14 is crypto
  // (within Look-through Exposures, ASSET_ORDER index → row).
  const equityShareFormula =
    `SUM('Look-through Exposures'!C2:C9)+'Look-through Exposures'!C13+'Look-through Exposures'!C14`;

  // Pre-compute reference values (must mirror the formulas below) so the
  // workbook displays correctly even before Excel/LibreOffice recalcs.
  const wVec = exposures.map(e => e.weight);
  const muVec = ASSET_ORDER.map(k => (k === "cash" ? RF_CHF : CMA[k].mu) - whtForCHF(k));
  const bwVec = ASSET_ORDER.map(k => BENCHMARK_W[k] ?? 0);
  const cov = (i: number, j: number) =>
    CMA[ASSET_ORDER[i]].sigma * CMA[ASSET_ORDER[j]].sigma * corr(ASSET_ORDER[i], ASSET_ORDER[j]);
  const dot = (a: number[], b: number[]) => a.reduce((s, v, i) => s + v * b[i], 0);
  const matVec = (v: number[]) => v.map((_, i) => v.reduce((s, _vj, j) => s + cov(i, j) * v[j], 0));
  // covariance(p, B):
  const covPB = wVec.reduce((s, wi, i) => s + wi * bwVec.reduce((t, bj, j) => t + cov(i, j) * bj, 0), 0);
  const r_p = dot(wVec, muVec);
  const var_p = dot(wVec, matVec(wVec));
  const vol_p = Math.sqrt(Math.max(var_p, 0));
  const r_b = dot(bwVec, muVec);
  const var_b = dot(bwVec, matVec(bwVec));
  const vol_b = Math.sqrt(Math.max(var_b, 0));
  const beta = var_b > 0 ? covPB / var_b : 0;
  const alpha = r_p - (RF_CHF + beta * (r_b - RF_CHF));
  const teVar = var_p + var_b - 2 * covPB;
  const te = Math.sqrt(Math.max(teVar, 0));
  const sharpe = vol_p > 0 ? (r_p - RF_CHF) / vol_p : 0;
  const equityShare = wVec.slice(0, 8).reduce((s, v) => s + v, 0) + wVec[11] + wVec[12];
  const mdd = -Math.min(0.85, (1.8 + 1.4 * equityShare) * vol_p);
  const outperf = r_p - r_b;

  // Helper to add a metric row.
  let mrow = 1;
  const addSection = (title: string) => {
    mrow += 1;
    const r = ws6.addRow([title]);
    r.font = { bold: true };
    r.fill = HEADER_FILL;
  };
  const addMetric = (label: string, formula: string, result: number, fmt: string, note: string) => {
    mrow += 1;
    const r = ws6.addRow([label, null, note]);
    r.getCell(2).value = { formula, result };
    r.getCell(2).numFmt = fmt;
    r.getCell(2).font = { bold: true };
    r.getCell(3).alignment = { wrapText: true, vertical: "top" };
  };
  const addInfo = (label: string, value: string | number, fmt?: string) => {
    mrow += 1;
    const r = ws6.addRow([label, value]);
    if (fmt) r.getCell(2).numFmt = fmt;
  };

  // Header row.
  ws6.addRow(["Metric", "Value", "Formula / Note"]);
  styleHeader(ws6.getRow(1));

  addSection("Building blocks (live formulas)");
  addMetric(
    "Portfolio gross variance (σ_p²)",
    `SUMPRODUCT(${W_RANGE},MMULT(${COV_RANGE},${W_RANGE}))`,
    var_p, "0.00000",
    "wᵖ' Σ wᵖ — quadratic form using the covariance sheet.",
  );
  addMetric(
    "Benchmark gross variance (σ_B²)",
    `SUMPRODUCT(${BW_RANGE},MMULT(${COV_RANGE},${BW_RANGE}))`,
    var_b, "0.00000",
    "wᴮ' Σ wᴮ — ACWI proxy benchmark from BENCHMARK in metrics.ts.",
  );
  addMetric(
    "Cov(portfolio, benchmark)",
    `SUMPRODUCT(${W_RANGE},MMULT(${COV_RANGE},${BW_RANGE}))`,
    covPB, "0.00000",
    "wᵖ' Σ wᴮ — needed for β and tracking error.",
  );
  addMetric(
    "Equity share (incl. REITs + Crypto)",
    equityShareFormula, equityShare, "0.00%",
    "Used by the heuristic max-drawdown formula.",
  );
  addInfo("Risk-free rate (CHF, decimal)", { formula: RF_REF, result: RF_CHF } as unknown as string, "0.00%");

  addSection("Risk & Performance Metrics (live formulas)");
  addMetric(
    "Expected Return (net of WHT)",
    `SUMPRODUCT(${W_RANGE},${MU_RANGE})`,
    r_p, "0.00%",
    "Σ wᵢ · μᵢ_effective. Cash sleeve uses Rf_CHF for μ; equity rows are CMA μ minus WHT drag (CHF resident: equity_ch WHT = 0).",
  );
  addMetric(
    "Volatility (σ_p)",
    `SQRT(MAX(SUMPRODUCT(${W_RANGE},MMULT(${COV_RANGE},${W_RANGE})),0))`,
    vol_p, "0.00%",
    "√(wᵖ' Σ wᵖ). Normal-regime correlations.",
  );
  addMetric(
    "Sharpe Ratio",
    `IF(SQRT(MAX(SUMPRODUCT(${W_RANGE},MMULT(${COV_RANGE},${W_RANGE})),0))>0,` +
      `(SUMPRODUCT(${W_RANGE},${MU_RANGE})-${RF_REF})/` +
      `SQRT(MAX(SUMPRODUCT(${W_RANGE},MMULT(${COV_RANGE},${W_RANGE})),0)),0)`,
    sharpe, "0.000",
    "(μ_p − Rf) / σ_p with Rf = CHF risk-free rate.",
  );
  addMetric(
    "Max Drawdown (heuristic)",
    `-MIN(0.85,(1.8+1.4*(${equityShareFormula}))*` +
      `SQRT(MAX(SUMPRODUCT(${W_RANGE},MMULT(${COV_RANGE},${W_RANGE})),0)))`,
    mdd, "0.0%",
    "− min(0.85, (1.8 + 1.4·equityShare)·σ_p). For path-based MDD see the MC tab in the live app.",
  );
  addMetric(
    "Beta (vs ACWI)",
    `IF(SUMPRODUCT(${BW_RANGE},MMULT(${COV_RANGE},${BW_RANGE}))>0,` +
      `SUMPRODUCT(${W_RANGE},MMULT(${COV_RANGE},${BW_RANGE}))/` +
      `SUMPRODUCT(${BW_RANGE},MMULT(${COV_RANGE},${BW_RANGE})),0)`,
    beta, "0.00",
    "Cov(p,B) / Var(B). ACWI proxy = 60/14/4/4/4/14 across US/EU/UK/CH/JP/EM.",
  );
  addMetric(
    "Alpha (p.a. vs ACWI)",
    `(SUMPRODUCT(${W_RANGE},${MU_RANGE}))-(${RF_REF}+` +
      `(IF(SUMPRODUCT(${BW_RANGE},MMULT(${COV_RANGE},${BW_RANGE}))>0,` +
        `SUMPRODUCT(${W_RANGE},MMULT(${COV_RANGE},${BW_RANGE}))/` +
        `SUMPRODUCT(${BW_RANGE},MMULT(${COV_RANGE},${BW_RANGE})),0))*` +
      `(SUMPRODUCT(${BW_RANGE},${MU_RANGE})-${RF_REF}))`,
    alpha, "0.00%",
    "μ_p − [Rf + β · (μ_B − Rf)]. Uses net (post-WHT) returns on both sides.",
  );
  addMetric(
    "Tracking Error (p.a.)",
    `SQRT(MAX(SUMPRODUCT(${W_RANGE},MMULT(${COV_RANGE},${W_RANGE}))+` +
      `SUMPRODUCT(${BW_RANGE},MMULT(${COV_RANGE},${BW_RANGE}))-` +
      `2*SUMPRODUCT(${W_RANGE},MMULT(${COV_RANGE},${BW_RANGE})),0))`,
    te, "0.0%",
    "√(Var_p + Var_B − 2·Cov(p,B)) — stdev of the active return.",
  );
  addMetric(
    "Outperformance (vs ACWI p.a.)",
    `SUMPRODUCT(${W_RANGE},${MU_RANGE})-SUMPRODUCT(${BW_RANGE},${MU_RANGE})`,
    outperf, "0.00%",
    "μ_p − μ_B (both net of WHT).",
  );

  // ---------------- Sheet 7: Parameters ----------------
  const ws7 = wb.addWorksheet("Parameters");
  ws7.getColumn(1).width = 36;
  ws7.getColumn(2).width = 28;
  ws7.getColumn(3).width = 60;

  const section = (title: string) => {
    const r = ws7.addRow([title]);
    r.font = { bold: true };
    r.fill = HEADER_FILL;
  };
  const kv = (label: string, value: string | number, note = "") => {
    ws7.addRow([label, value, note]);
  };

  section("Snapshot");
  kv("Generated on", SNAPSHOT_DATE);
  kv("Source app", "Investment Decision Lab (artifacts/investment-lab)");
  ws7.addRow([]);

  section("Default form values");
  kv("Base currency", "CHF");
  kv("Risk appetite", "High");
  kv("Horizon (years)", 10);
  kv("Target equity %", "60%");
  kv("Number of ETFs", 10);
  kv("Preferred exchange", "SIX");
  kv("Thematic preference", "None");
  kv("Currency hedging", "off");
  kv("Synthetic ETFs", "off");
  kv("Look-through view", "on");
  kv("Crypto", "off");
  kv("Listed real estate", "off");
  kv("Commodities (Gold)", "on");
  ws7.addRow([]);

  section("Risk-free rates (active = built-in ⊕ app-defaults.json)");
  for (const ccy of ["USD", "EUR", "GBP", "CHF"] as const) {
    ws7.addRow([`Rf ${ccy}`, RF[ccy], ccy === "USD" ? "built-in only" : "from app-defaults.json"]);
  }
  const rfStartRow = ws7.lastRow!.number - 3;
  for (let r = rfStartRow; r <= rfStartRow + 3; r++) ws7.getCell(r, 2).numFmt = "0.00%";
  ws7.addRow([]);

  section("Home-bias factors");
  for (const ccy of ["USD", "EUR", "GBP", "CHF"] as const) {
    ws7.addRow([`Home bias ${ccy}`, HOME_BIAS[ccy], `multiplier on home-region anchor`]);
  }
  ws7.addRow([]);

  section("Equity-region cap constants");
  kv("Per-region cap", "65%", "EQUITY_REGION_CAP");
  kv("MCAP anchor (CHF) — USA", "60%");
  kv("MCAP anchor (CHF) — Europe", "10%");
  kv("MCAP anchor (CHF) — Switzerland", "4%");
  kv("MCAP anchor (CHF) — Japan", "5%");
  kv("MCAP anchor (CHF) — EM", "11%");
  ws7.addRow([]);

  section("Benchmark (MSCI ACWI proxy used for α / β)");
  for (const k of ASSET_ORDER) {
    if (BENCHMARK_W[k]) ws7.addRow([CMA[k].label, BENCHMARK_W[k]!, k]);
  }
  const bStart = ws7.lastRow!.number - 5;
  for (let r = bStart; r <= bStart + 5; r++) ws7.getCell(r, 2).numFmt = "0.00%";

  await wb.xlsx.writeFile(outPath);
  await wb.xlsx.writeFile(publicPath);
  console.log(`Wrote ${outPath}`);
  console.log(`Wrote ${publicPath}`);
  console.log(`Engine-replicated metrics for the documented default profile:`);
  console.log(`  Expected Return: ${(r_p * 100).toFixed(2)}%`);
  console.log(`  Volatility:      ${(vol_p * 100).toFixed(2)}%`);
  console.log(`  Sharpe:          ${sharpe.toFixed(3)}`);
  console.log(`  Max Drawdown:    ${(mdd * 100).toFixed(2)}%`);
  console.log(`  Beta:            ${beta.toFixed(3)}`);
  console.log(`  Alpha:           ${(alpha * 100).toFixed(3)}%`);
  console.log(`  Tracking Error:  ${(te * 100).toFixed(2)}%`);
  console.log(`  Outperformance:  ${(outperf * 100).toFixed(3)}%`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
