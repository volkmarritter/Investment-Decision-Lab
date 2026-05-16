export type RiskAppetite = "Low" | "Moderate" | "High" | "Very High";
export type BaseCurrency = "USD" | "EUR" | "CHF" | "GBP";
export type PreferredExchange = "None" | "LSE" | "XETRA" | "SIX";
export type ThematicPreference = "None" | "Technology" | "Healthcare" | "Sustainability" | "Cybersecurity";

export interface PortfolioInput {
  baseCurrency: BaseCurrency;
  riskAppetite: RiskAppetite;
  horizon: number;
  targetEquityPct: number;
  numETFs: number;
  numETFsMin?: number;
  preferredExchange: PreferredExchange;
  thematicPreference: ThematicPreference;
  includeCurrencyHedging: boolean;
  /** Task #300 — bond-only FX hedging toggle. When true and `includeCurrencyHedging`
   *  is false (and base currency is non-USD), the engine routes Fixed Income
   *  buckets to their currency-hedged share class, applies the +15 bps fee
   *  surcharge only to FI, and applies the MC sigma cut only to FI buckets.
   *  When `includeCurrencyHedging` is true, the full hedge subsumes this — it
   *  hedges Equity + FI + Real Estate. USD base disables both. Defaults to true
   *  for new portfolios; older saved inputs without this field are treated as
   *  true by the file loader for backward compat. */
  hedgeForeignBonds?: boolean;
  includeSyntheticETFs: boolean;
  lookThroughView: boolean;
  includeCrypto: boolean;
  includeListedRealEstate: boolean;
  includeCommodities: boolean;
}

export interface ValidationSuggestion {
  message: string;
  suggestion: string;
}

export interface ValidationResult {
  errors: ValidationSuggestion[];
  warnings: ValidationSuggestion[];
  isValid: boolean;
}

export interface AssetAllocation {
  assetClass: string;
  region: string;
  weight: number;
  /** True when this row's weight was pinned by the user via the manual
   *  weight overrides UI on the Build tab. */
  isManualOverride?: boolean;
}

export interface ETFImplementation {
  bucket: string;
  assetClass: string;
  weight: number;
  intent: string;
  exampleETF: string;
  rationale: string;
  isin: string;
  ticker: string;
  exchange: string;
  terBps: number;
  domicile: string;
  replication: string;
  distribution: "Accumulating" | "Distributing";
  currency: string;
  comment: string;
  /** Task #207 — optional German translation of `comment` and provenance
   *  tag forwarded from the resolved ETFRecord. Surfaces use commentDe in
   *  DE locale and may branch on commentSource ∈ {justetf, auto, manual}
   *  for future presentation tweaks. */
  commentDe?: string;
  commentSource?: "manual" | "justetf" | "auto";
  /** Task #271 — provenance of the row's `terBps` value, used by the Fee
   *  Estimator to render a small "operator / justETF / default" badge so
   *  the operator can tell whether a manual-row TER reflects a real value
   *  (typed in or scraped) or the asset-class fallback. Only set for
   *  off-catalog manual rows synthesized by `synthesizePersonalPortfolio`
   *  (Explain → Fee Estimator pipeline). Catalog rows from
   *  `portfolio.ts` leave this undefined so Build/Compare keep rendering
   *  the table unchanged. */
  terSource?: "operator" | "justetf" | "default";
  /** Mirrors AssetAllocation.isManualOverride for the implementation row of
   *  the same bucket. Cash is excluded from the implementation table, so the
   *  flag is meaningful only for non-Cash rows. */
  isManualOverride?: boolean;
  // ----------------------------------------------------------------------
  // Per-bucket ETF picker plumbing. Surfaced from the engine so the
  // BuildPortfolio table can render a dropdown without reaching back
  // into getETFDetails(). Mirrors the same-named fields on ETFDetails;
  // see lib/etfs.ts for semantics.
  // ----------------------------------------------------------------------
  catalogKey: string | null;
  selectedSlot: number;
  selectableOptions: ReadonlyArray<{
    name: string;
    isin: string;
    terBps: number;
    // Task #149 — distinguishes the curated rows (default + alternatives,
    // shown in the inline Select) from the extended-universe pool rows
    // (shown in the "More ETFs" dialog). Optional for backward
    // compatibility with consumers that don't care about the distinction.
    kind?: "default" | "alternative" | "pool";
    distribution?: "Accumulating" | "Distributing";
  }>;
}

export interface PortfolioOutput {
  allocation: AssetAllocation[];
  etfImplementation: ETFImplementation[];
  rationale: string[];
  risks: string[];
  learning: string[];
}

export interface ExplainPosition {
  assetClass: string;
  region: string;
  weight: number;
}

export interface ExplainAnalysis {
  sum: number;
  verdict: "Coherent" | "Needs Attention" | "Inconsistent";
  warnings: string[];
  errors: string[];
}
