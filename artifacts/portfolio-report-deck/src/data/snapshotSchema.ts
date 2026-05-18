import { z } from "zod";

/**
 * Typed snapshot contract between the Investment Decision Lab and this deck.
 *
 * The Lab serialises a live portfolio + Monte-Carlo result into this shape,
 * stashes it in `localStorage` under SNAPSHOT_STORAGE_KEY, and opens the deck.
 * On boot the deck tries to load + parse it; on failure (missing, invalid, or
 * cross-version) it falls back to the curated default deck.
 */

export const SNAPSHOT_STORAGE_KEY = "investment-lab.report-snapshot.v1";
export const SNAPSHOT_SCHEMA_VERSION = 1;

const MetaSchema = z.object({
  reportTitle: z.string(),
  reportId: z.string(),
  generatedOn: z.string(),
  preparedFor: z.string(),
  jurisdiction: z.string(),
  profileOneLiner: z.string(),
  correlationRegime: z.string(),
});

const TogglesSchema = z.object({
  hedging: z.string(),
  bondHedging: z.string(),
  syntheticEtfs: z.string(),
  lookThrough: z.string(),
  thematic: z.string(),
});

const ProfileSchema = z.object({
  baseCurrency: z.string(),
  riskProfile: z.string(),
  horizonYears: z.number(),
  targetEquityPct: z.number(),
  numEtfs: z.number(),
  toggles: TogglesSchema,
});

const KeyMetricsSchema = z.object({
  expectedReturnPa: z.string(),
  volatilityPa: z.string(),
  sharpe: z.string(),
  sharpeInterpretation: z.string(),
  riskFreeRate: z.string(),
  maxDrawdownP5: z.string(),
  alphaVsAcwi: z.string(),
  equityDefensiveSplit: z.string(),
  weightedTER: z.string(),
});

const AllocationRowSchema = z.object({
  label: z.string(),
  weight: z.number(),
  group: z.enum(["equity", "bonds", "realestate", "cash", "commodities", "crypto"]),
});

const AllocationSchema = z.object({
  rows: z.array(AllocationRowSchema),
  groupTotals: z.object({
    equity: z.number(),
    realestate: z.number(),
    bonds: z.number(),
    cash: z.number(),
    commodities: z.number().optional(),
    crypto: z.number().optional(),
  }),
});

const EtfSchema = z.object({
  n: z.number(),
  bucket: z.string(),
  name: z.string(),
  isin: z.string(),
  ticker: z.string(),
  exchange: z.string(),
  currency: z.string(),
  distribution: z.string(),
  weight: z.string(),
  terBps: z.number(),
  ter: z.string(),
  comment: z.string(),
});

const HoldingSchema = z.object({
  n: z.number(),
  name: z.string(),
  source: z.string(),
  pctPortfolio: z.string(),
  pctEquity: z.string(),
});

const MonteCarloSchema = z.object({
  paths: z.string(),
  horizonYears: z.number(),
  finalP10: z.number(),
  finalP50: z.number(),
  finalP90: z.number(),
  finalP10CAGR: z.string(),
  finalP50CAGR: z.string(),
  finalP90CAGR: z.string(),
  expReturnGeom: z.string(),
  expVol: z.string(),
  pLoss15y: z.string(),
  pDouble15y: z.string(),
  cvar5: z.string(),
});

const FeeRowSchema = z.object({
  bucket: z.string(),
  weightPct: z.string(),
  terBps: z.number(),
  contributionBps: z.number(),
});

const FeesSchema = z.object({
  portfolioSize: z.string(),
  blendedTERPct: z.string(),
  blendedTERBps: z.number(),
  year1FeeCHF: z.string(),
  totalDrag15yCHF: z.string(),
  totalDragPctPa: z.string(),
  rows: z.array(FeeRowSchema),
});

const TocSectionSchema = z.object({
  n: z.number(),
  title: z.string(),
  slide: z.number(),
  page: z.string(),
});

export const ReportSnapshotSchema = z.object({
  schemaVersion: z.literal(SNAPSHOT_SCHEMA_VERSION),
  meta: MetaSchema,
  profile: ProfileSchema,
  keyMetrics: KeyMetricsSchema,
  allocation: AllocationSchema,
  etfs: z.array(EtfSchema),
  holdings: z.array(HoldingSchema),
  monteCarlo: MonteCarloSchema,
  fees: FeesSchema,
  tocSections: z.array(TocSectionSchema),
});

export type ReportSnapshot = z.infer<typeof ReportSnapshotSchema>;
export type AllocationRow = z.infer<typeof AllocationRowSchema>;
export type EtfRow = z.infer<typeof EtfSchema>;
export type HoldingRow = z.infer<typeof HoldingSchema>;
export type FeeRow = z.infer<typeof FeeRowSchema>;
export type TocSection = z.infer<typeof TocSectionSchema>;
