// Explain My Portfolio — bring-your-own-ETFs workspace.
// User picks ISINs + weights; the synthesizer feeds the standard analysis cards.
// State persists to localStorage["investment-lab.explainPortfolio.v1"].

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Plus,
  Trash2,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Search,
  RotateCcw,
  Scale,
  ChevronRight,
  Upload,
  ClipboardCopy,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";

import { BaseCurrency, RiskAppetite } from "@/lib/types";
import {
  ALL_BUCKET_KEYS,
  type BucketMeta,
  getBucketKeyForIsin,
  getBucketMeta,
  getInstrumentByIsin,
  listInstruments,
  getInstrumentRole,
  getInstrumentAltIndex,
  getInstrumentPoolIndex,
  inferAssetClassRegionFromInstrument,
  pickDefaultListing,
} from "@/lib/etfs";
import {
  type SlotKind,
} from "./etfSlotBadge";
import { SlotTagBadge } from "./SlotTagBadge";
import {
  PersonalPosition,
  EXPLAIN_CASH_BUCKET_SENTINEL,
  assetClassNeedsRegion,
  normalizeManualRegion,
  normalizeWeights,
  runExplainValidation,
  synthesizePersonalPortfolio,
} from "@/lib/personalPortfolio";
import { parseDecimalInput } from "@/lib/manualWeights";
import { EtfInfoPreview, type QuickFillValues } from "@/components/explain/EtfInfoPreview";
import { getCachedScrapeTerBps } from "@/lib/useEtfInfo";
import { UnassignedInstrumentPicker } from "@/components/explain/UnassignedInstrumentPicker";
import type { InstrumentRecord } from "@/lib/etfs";
import type { RiskRegime } from "@/lib/metrics";
import { effectiveCashExpReturn } from "@/lib/metrics";
import { useT } from "@/lib/i18n";
import {
  scrapeLookthroughForIsin,
  type ScrapeLookthroughResult,
} from "@/lib/etf-api";
import {
  shouldSuppressScrapeFailureToast,
  triggerImportLookthroughScrapes,
} from "@/lib/importLookthroughScrape";
import {
  profileFor as lookthroughProfileFor,
  registerRuntimeLookthroughProfile,
} from "@/lib/lookthrough";

import { ETFDetailsDialog } from "./ETFDetailsDialog";
import {
  ImportPortfolioDialog,
  type ImportSummary,
} from "./ImportPortfolioDialog";
import type { ETFImplementation } from "@/lib/types";
import { CurrentAllocationCard } from "./CurrentAllocationCard";
import { PortfolioMetrics } from "./PortfolioMetrics";
import { MonteCarloSimulation } from "./MonteCarloSimulation";
import { FeeEstimator } from "./FeeEstimator";
import { LookThroughAnalysis } from "./LookThroughAnalysis";
import { CurrencyOverview } from "./CurrencyOverview";
import { TopHoldings } from "./TopHoldings";
import { GeoExposureMap } from "./GeoExposureMap";
import { StressTest } from "./StressTest";
import { HomeBiasAnalysis } from "./HomeBiasAnalysis";
import { SavedExplainPortfoliosUI } from "./SavedExplainPortfoliosUI";
import type { ExplainWorkspace } from "@/lib/savedExplainPortfolios";
import {
  explainWorkspaceHasContent,
  navigateToTab,
  requestCompareLoadFromExplain,
  setLastExplainWorkspace,
  subscribeExplainLoadRequests,
  takePendingExplainLoadRequest,
  type CompareSlotName,
} from "@/lib/explainCompare";
import { setLastBaseCurrency } from "@/lib/settings";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const STORAGE_KEY = "investment-lab.explainPortfolio.v1";

type PersistedState = ExplainWorkspace;

const DEFAULT_STATE: PersistedState = {
  v: 1,
  baseCurrency: "CHF",
  riskAppetite: "High",
  horizon: 10,
  hedged: false,
  lookThroughView: true,
  positions: [],
};

function loadState(): PersistedState {
  if (typeof window === "undefined") return DEFAULT_STATE;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_STATE;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || parsed.v !== 1) return DEFAULT_STATE;
    return {
      v: 1,
      baseCurrency: (["USD", "EUR", "CHF", "GBP"] as BaseCurrency[]).includes(parsed.baseCurrency)
        ? parsed.baseCurrency
        : DEFAULT_STATE.baseCurrency,
      riskAppetite: (["Low", "Moderate", "High", "Very High"] as RiskAppetite[]).includes(
        parsed.riskAppetite,
      )
        ? parsed.riskAppetite
        : DEFAULT_STATE.riskAppetite,
      horizon: Number.isFinite(parsed.horizon) ? Math.max(1, Math.min(40, Math.floor(parsed.horizon))) : DEFAULT_STATE.horizon,
      hedged: !!parsed.hedged,
      lookThroughView: parsed.lookThroughView !== false,
      positions: Array.isArray(parsed.positions)
        ? parsed.positions
            .filter((p: unknown): p is PersonalPosition => {
              if (!p || typeof p !== "object") return false;
              const pp = p as Record<string, unknown>;
              return (
                typeof pp.isin === "string" &&
                typeof pp.bucketKey === "string" &&
                typeof pp.weight === "number"
              );
            })
            .map((p: PersonalPosition) => {
              const out: PersonalPosition = {
                isin: p.isin,
                bucketKey: p.bucketKey,
                weight: p.weight,
              };
              const validBaseCurrency = (v: unknown): v is BaseCurrency =>
                v === "USD" || v === "EUR" || v === "CHF" || v === "GBP";
              if (validBaseCurrency(p.cashCurrency)) {
                out.cashCurrency = p.cashCurrency;
              }
              if (
                p.manualMeta &&
                typeof p.manualMeta === "object" &&
                typeof p.manualMeta.assetClass === "string" &&
                typeof p.manualMeta.region === "string"
              ) {
                out.manualMeta = {
                  assetClass: p.manualMeta.assetClass,
                  // Task #286 — silently upgrade legacy region labels
                  // ("Emerging Markets" → "EM", "United Kingdom" → "UK")
                  // so the dropdown shows the new canonical value.
                  region: normalizeManualRegion(p.manualMeta.region),
                  ...(typeof p.manualMeta.name === "string" ? { name: p.manualMeta.name } : {}),
                  ...(typeof p.manualMeta.currency === "string" ? { currency: p.manualMeta.currency } : {}),
                  ...(typeof p.manualMeta.terBps === "number" ? { terBps: p.manualMeta.terBps } : {}),
                  ...(p.manualMeta.autoClassified === true ? { autoClassified: true } : {}),
                };
              }
              // Task #174 — migrate legacy Cash positions that were entered
              // through the manual-entry path (`manualMeta.assetClass ===
              // "Cash"`) into the new first-class Cash sentinel form. The
              // sentinel rows have `bucketKey === "Cash"`, no manualMeta,
              // and an optional `cashCurrency` derived from the legacy
              // `manualMeta.currency` (or left undefined to fall back to
              // the workspace's baseCurrency at render time). This keeps
              // every saved workspace re-opening cleanly without forcing
              // the user to re-enter their cash slice.
              if (out.manualMeta?.assetClass === "Cash") {
                if (!out.cashCurrency && validBaseCurrency(out.manualMeta.currency)) {
                  out.cashCurrency = out.manualMeta.currency;
                }
                out.bucketKey = EXPLAIN_CASH_BUCKET_SENTINEL;
                out.isin = "";
                delete out.manualMeta;
              }
              return out;
            })
        : [],
    };
  } catch {
    return DEFAULT_STATE;
  }
}

function saveState(state: PersistedState) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // localStorage unavailable (e.g. privacy mode); silently skip persistence.
  }
}

// Picker row shape: only the fields the comparator actually reads.
// Decoupled from `listInstruments()`'s full row type so this helper is
// trivially reusable in tests without dragging in BucketMeta/listings.
export interface PickerRowForSort {
  isin: string;
  name: string;
}

const PICKER_ROLE_RANK: Record<string, number> = {
  default: 0,
  alternative: 1,
  pool: 2,
  unassigned: 3,
};

// Within-bucket comparator used by the Explain ISIN picker.
// Default → Alt 1..N (catalog slot order) → Pool (catalog insertion
// order via getInstrumentPoolIndex — independent of the upstream
// listInstruments() name-sort) → Unassigned. Name is the final
// tiebreak for default/unassigned rows.
export function comparePickerRows(
  a: PickerRowForSort,
  b: PickerRowForSort,
): number {
  const roleA = getInstrumentRole(a.isin);
  const roleB = getInstrumentRole(b.isin);
  const ra = PICKER_ROLE_RANK[roleA] ?? 4;
  const rb = PICKER_ROLE_RANK[roleB] ?? 4;
  if (ra !== rb) return ra - rb;
  if (roleA === "alternative" && roleB === "alternative") {
    const ia = getInstrumentAltIndex(a.isin) ?? Number.MAX_SAFE_INTEGER;
    const ib = getInstrumentAltIndex(b.isin) ?? Number.MAX_SAFE_INTEGER;
    if (ia !== ib) return ia - ib;
    return a.name.localeCompare(b.name);
  }
  if (roleA === "pool" && roleB === "pool") {
    const ia = getInstrumentPoolIndex(a.isin) ?? Number.MAX_SAFE_INTEGER;
    const ib = getInstrumentPoolIndex(b.isin) ?? Number.MAX_SAFE_INTEGER;
    if (ia !== ib) return ia - ib;
    return a.name.localeCompare(b.name);
  }
  return a.name.localeCompare(b.name);
}

interface IsinPickerProps {
  value: string | null;
  onPick: (isin: string) => void;
  excludeIsins: ReadonlySet<string>;
  testId?: string;
  restrictToBucketKey?: string;
}

function IsinPicker({ value, onPick, excludeIsins, testId, restrictToBucketKey }: IsinPickerProps) {
  const { t, lang } = useT();
  const [open, setOpen] = useState(false);
  const all = useMemo(() => listInstruments(), []);

  const candidates = useMemo(() => {
    return all.filter(
      (i) =>
        (!excludeIsins.has(i.isin) || i.isin === value) &&
        (!restrictToBucketKey || i.bucketKey === restrictToBucketKey),
    );
  }, [all, excludeIsins, value, restrictToBucketKey]);

  const selected = value ? all.find((i) => i.isin === value) : null;

  const grouped = useMemo(() => {
    const m = new Map<string, typeof candidates>();
    for (const c of candidates) {
      const list = m.get(c.bucketKey) ?? [];
      list.push(c);
      m.set(c.bucketKey, list);
    }
    // Within each bucket: order rows by role (default → alternative →
    // pool → unassigned). Within the same role, preserve the curated
    // catalog ordering — alternatives sort by `getInstrumentAltIndex`
    // (Alt 1 → Alt N) and pool entries by `getInstrumentPoolIndex`
    // (catalog insertion order, independent of the upstream
    // name-sorted `listInstruments()` baseline). Comparator
    // extracted as a top-level export so `tests/` can regression-test
    // the order without rendering the picker.
    for (const [, rows] of m) {
      rows.sort(comparePickerRows);
    }
    return Array.from(m.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [candidates]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between h-9 text-left font-normal"
          data-testid={testId}
        >
          <span className="truncate text-sm">
            {selected ? selected.name : t("explain.picker.placeholder")}
          </span>
          <Search className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[480px] max-w-[calc(100vw-2rem)] p-0" align="start">
        <Command
          filter={(itemValue, search) =>
            itemValue.toLowerCase().includes(search.toLowerCase()) ? 1 : 0
          }
        >
          <CommandInput
            placeholder={t("explain.picker.search")}
            data-testid={testId ? `${testId}-search` : undefined}
          />
          <CommandList className="max-h-[320px]">
            <CommandEmpty>{t("explain.picker.empty")}</CommandEmpty>
            {grouped.map(([bucketKey, rows]) => {
              const meta = getBucketMeta(bucketKey);
              const heading = meta
                ? `${meta.assetClass} — ${meta.region}${
                    meta.hedged
                      ? lang === "de"
                        ? ` (${meta.hedgeCurrency ?? ""}${meta.hedgeCurrency ? "-" : ""}gehedgt)`
                        : ` (${meta.hedgeCurrency ?? ""}${meta.hedgeCurrency ? "-" : ""}hedged)`
                      : ""
                  }${
                    meta.synthetic
                      ? lang === "de"
                        ? " · synthetisch"
                        : " · synthetic"
                      : ""
                  }`
                : bucketKey;
              return (
                <CommandGroup key={bucketKey} heading={heading}>
                  {rows.map((r) => {
                    const tickers = Object.values(r.listings)
                      .map((l) => l?.ticker ?? "")
                      .filter(Boolean)
                      .join("|");
                    return (
                    <CommandItem
                      key={r.isin}
                      value={`${r.isin}|${r.name}|${tickers}|${r.currency}|${r.domicile}|${bucketKey}`}
                      onSelect={() => {
                        onPick(r.isin);
                        setOpen(false);
                      }}
                      data-testid={`isin-option-${r.isin}`}
                    >
                      <div className="flex flex-col gap-0.5 min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs font-medium truncate">{r.name}</span>
                          {/* Task #160 — full Default / Alt N / Pool role
                              badge, sharing the same color helpers as
                              Build's picker (alt = green, pool = orange,
                              default = neutral). Numbering for "Alt N"
                              matches the bucket's alternatives slot
                              order (1..altCount). */}
                          {(() => {
                            const role = getInstrumentRole(r.isin);
                            if (role !== "default" && role !== "alternative" && role !== "pool") {
                              return null;
                            }
                            const kind: SlotKind =
                              role === "default"
                                ? "default"
                                : role === "pool"
                                  ? "pool"
                                  : "alternative";
                            const altIdx = role === "alternative" ? getInstrumentAltIndex(r.isin) : null;
                            const label =
                              role === "default"
                                ? t("explain.picker.default")
                                : role === "pool"
                                  ? t("explain.picker.pool")
                                  : `${t("explain.picker.alt")} ${altIdx ?? ""}`.trim();
                            const testId =
                              role === "default"
                                ? `isin-option-default-badge-${r.isin}`
                                : role === "pool"
                                  ? `isin-option-pool-badge-${r.isin}`
                                  : `isin-option-alt-badge-${r.isin}`;
                            return (
                              <SlotTagBadge
                                kind={kind}
                                label={label}
                                testId={testId}
                              />
                            );
                          })()}
                        </div>
                        <span className="text-[11px] text-muted-foreground font-mono">
                          {r.isin} · {r.currency} · {(r.terBps / 100).toFixed(2)}% TER
                        </span>
                      </div>
                    </CommandItem>
                    );
                  })}
                </CommandGroup>
              );
            })}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

interface PositionRowProps {
  position: PersonalPosition;
  weightDraft: string;
  excludeIsins: ReadonlySet<string>;
  onPickIsin: (isin: string) => void;
  onWeightChange: (draft: string) => void;
  onRemove: () => void;
  onManualIsinChange: (isin: string) => void;
  onManualMetaChange: (field: "assetClass" | "region", value: string) => void;
  // Atomic multi-field setter used by the EtfInfoPreview's "use these
  // values" quick-fill button. Kept separate from `onManualMetaChange`
  // so the existing field-setter contract stays narrow (the preview
  // never overwrites operator input — see EtfInfoPreview for the gating
  // logic).
  onManualMetaQuickFill: (values: QuickFillValues) => void;
  // Task #251 — auto-classify writer fired by EtfInfoPreview when the
  // ETF-preview Stammdaten arrive for an off-catalog manual row that
  // still carries the fresh `{Equity, Global}` defaults. Kept narrow
  // (only assetClass + region; quick-fill stays separate for name /
  // currency / TER) so the precedence rule is easy to audit.
  onAutoClassify: (values: { assetClass: string; region: string }) => void;
  // Task #156 — fill an off-catalog row from an unassigned INSTRUMENTS
  // entry (registered but not slotted into any bucket). Atomic: sets
  // isin AND seeds manualMeta with name/currency/terBps in one shot so
  // the operator only has to set the weight.
  onPickUnassignedInstrument: (record: Readonly<InstrumentRecord>) => void;
  // Task #161 — when the row's ISIN resolves to a known catalog
  // instrument, the synthesizer publishes a full ETFImplementation row
  // for it. Pass it down so the ISIN can be rendered as a clickable
  // affordance that opens the same ETFDetailsDialog Build uses. `null`
  // for unresolved/empty rows — the button is suppressed in that case
  // and the existing manual-entry preview behaviour is preserved.
  detailsEtf: ETFImplementation | null;
  onOpenDetails: (etf: ETFImplementation) => void;
  rowIndex: number;
  // Task #262 — true while an import-triggered look-through scrape for
  // this off-catalog row's ISIN is still in flight. Shows an inline
  // spinner near the manualMeta block so the user has a visible cue
  // that Geo / Sector / Top-Holdings will populate shortly.
  isLookthroughScrapePending?: boolean;
}

// Task #174 — Cash is no longer a manual-entry asset class option:
// it has its own first-class pseudo-group at the top of the tree
// (see `addCashPosition` and the Cash render block in the editor).
// Picking "Cash" here would create a row that gets migrated into the
// sentinel form on the next reload anyway, which is a confusing UX.
const MANUAL_ASSET_CLASSES = [
  "Equity",
  "Fixed Income",
  "Real Estate",
  "Commodities",
  "Digital Assets",
];
// Aligned with the catalog's bucket regions (Task #286). Strings here
// must match the region labels that `lookupKey` in `etfs.ts` resolves
// to actual `Equity-*` bucket keys via its `.includes()` guards
// (e.g. "UK" → Equity-UK, "EM" → Equity-EM). "Asia Pacific ex-Japan"
// and "Thematic" don't have dedicated catalog buckets but remain
// valid operator choices and fall through to the manual-only sleeve.
// "Other" is a catch-all for off-catalog fund types. Legacy saved
// portfolios that stored "Emerging Markets" / "United Kingdom" are
// silently upgraded by `normalizeManualRegion` in `personalPortfolio.ts`
// at load time.
const MANUAL_REGIONS = [
  "Global",
  "USA",
  "Europe",
  "Switzerland",
  "UK",
  "Japan",
  "EM",
  "Asia Pacific ex-Japan",
  "Technology",
  "Healthcare",
  "Sustainability",
  "Cybersecurity",
  "Thematic",
  "Other",
];

function PositionRow({
  position,
  weightDraft,
  excludeIsins,
  onPickIsin,
  onWeightChange,
  onRemove,
  onManualIsinChange,
  onManualMetaChange,
  onManualMetaQuickFill,
  onAutoClassify,
  onPickUnassignedInstrument,
  detailsEtf,
  onOpenDetails,
  rowIndex,
  isLookthroughScrapePending = false,
}: PositionRowProps) {
  const { t } = useT();
  const isManual = !!position.manualMeta;
  // Task #161 — testid scope: catalog rows use the bucket key (matches
  // Build's `etf-isin-button-${bucket}` convention scoped under Explain);
  // manual rows fall back to the row index since they have no bucket.
  const isinButtonTestId = position.bucketKey
    ? `explain-etf-isin-button-${position.bucketKey}`
    : `explain-etf-isin-button-manual-${rowIndex}`;
  return (
    <div
      className="space-y-2"
      data-testid={`explain-row-${rowIndex}`}
    >
      <div className="grid grid-cols-[minmax(0,22rem)_5.5rem_2rem] gap-2 items-center">
        {isManual ? (
          // Task #156 — picker over unassigned INSTRUMENTS sits next to
          // the free-form ISIN input. Picking pre-fills isin + meta in
          // one shot; typing still works for true off-catalog ISINs.
          <div className="flex items-center gap-1.5 min-w-0">
            <UnassignedInstrumentPicker
              excludeIsins={excludeIsins}
              currentIsin={position.isin}
              onPick={onPickUnassignedInstrument}
              testId={`explain-unassigned-picker-${rowIndex}`}
            />
            <Input
              type="text"
              placeholder="ISIN (e.g. IE00B5BMR087)"
              className="h-9 text-sm font-mono min-w-0 flex-1"
              value={position.isin}
              onChange={(e) => onManualIsinChange(e.target.value.trim().toUpperCase())}
              aria-label="manual ISIN"
              data-testid={`explain-manual-isin-${rowIndex}`}
            />
          </div>
        ) : (
          <IsinPicker
            value={position.isin}
            onPick={onPickIsin}
            excludeIsins={excludeIsins}
            testId={`explain-picker-${rowIndex}`}
            restrictToBucketKey={position.bucketKey || undefined}
          />
        )}
        <Input
          type="text"
          inputMode="decimal"
          enterKeyHint="next"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          className="h-9 text-sm font-mono text-right"
          placeholder="0"
          value={weightDraft}
          onChange={(e) => onWeightChange(e.target.value)}
          aria-label="weight"
          data-testid={`explain-weight-${rowIndex}`}
        />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={onRemove}
          className="h-9 w-9 text-muted-foreground hover:text-destructive"
          aria-label="remove"
          data-testid={`explain-remove-${rowIndex}`}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
      {/* Task #161 — clickable ISIN affordance, mirroring Build's
          `etf-isin-button-*`. Only rendered when the row's ISIN
          resolves to an ETFImplementation row (catalog instruments
          always; manual entries only when the typed ISIN matches a
          registered instrument). For unresolved manual ISINs we keep
          the existing inline EtfInfoPreview behaviour below. */}
      {detailsEtf && (
        <div className="pl-1">
          <button
            type="button"
            onClick={() => onOpenDetails(detailsEtf)}
            className="inline-flex items-center gap-1 px-1.5 py-0.5 -mx-1.5 rounded text-[11px] font-mono text-muted-foreground hover:bg-muted/60 hover:text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-colors"
            data-testid={isinButtonTestId}
            title={t("build.impl.isin.openDetails")}
            aria-label={`${t("build.impl.isin.openDetails")} — ${detailsEtf.isin}`}
          >
            <span>{detailsEtf.isin}</span>
            <Search className="h-3 w-3 opacity-60 shrink-0" />
          </button>
        </div>
      )}
      {isManual && position.manualMeta && (() => {
        // The Region selector is only meaningful for asset classes
        // whose geographic exposure carries analytical signal — Equity
        // and Real Estate. For Fixed Income, Commodities, Cash and
        // Digital Assets the field is hidden (and the stored region is
        // auto-snapped to "Global" both here on the assetClass change
        // and again as a safety net inside resolveSleeve in
        // personalPortfolio.ts). See NO_REGION_ASSET_CLASSES there for
        // the rationale (Fixed Income was added to the set in Task #247
        // because monteCarlo.ts collapses every FI region to the single
        // `bonds` CMA bucket — the picker would mislead users).
        const showRegion = assetClassNeedsRegion(position.manualMeta.assetClass);
        return (
          <div className={showRegion ? "grid grid-cols-2 gap-2 pl-1" : "pl-1"}>
            <Select
              value={position.manualMeta.assetClass}
              onValueChange={(v) => {
                onManualMetaChange("assetClass", v);
                // Auto-collapse to "Global" when switching to a
                // region-less asset class so the hidden field doesn't
                // silently retain a stale value (e.g. switching an
                // existing "Equity / USA" row to Commodities).
                if (!assetClassNeedsRegion(v)) {
                  onManualMetaChange("region", "Global");
                }
              }}
            >
              <SelectTrigger
                className="h-8 text-xs"
                data-testid={`explain-manual-asset-${rowIndex}`}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MANUAL_ASSET_CLASSES.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {showRegion && (
              <Select
                value={position.manualMeta.region}
                onValueChange={(v) => onManualMetaChange("region", v)}
              >
                <SelectTrigger
                  className="h-8 text-xs"
                  data-testid={`explain-manual-region-${rowIndex}`}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MANUAL_REGIONS.map((r) => (
                    <SelectItem key={r} value={r}>
                      {r}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
        );
      })()}
      {/* Task #227 — origin badge for manual rows. Derived from the
          live catalog, so it accurately reflects "where did this ISIN
          end up landing" regardless of whether the row was added via
          paste-import or by hand. Empty-ISIN manual rows show nothing. */}
      {isManual && position.isin && (() => {
        const inst = getInstrumentByIsin(position.isin);
        const bk = inst ? getBucketKeyForIsin(position.isin) : "";
        if (!inst) {
          return (
            <div className="pl-1">
              <Badge
                variant="outline"
                className="text-[10px] font-normal text-muted-foreground"
                data-testid={`explain-row-badge-off-universe-${rowIndex}`}
              >
                {t("explain.row.badge.offUniverse")}
              </Badge>
            </div>
          );
        }
        if (!bk) {
          return (
            <div className="pl-1">
              <Badge
                variant="outline"
                className="text-[10px] font-normal text-muted-foreground"
                data-testid={`explain-row-badge-found-unassigned-${rowIndex}`}
              >
                {t("explain.row.badge.foundUnassigned")}
              </Badge>
            </div>
          );
        }
        return null;
      })()}
      {isManual && isLookthroughScrapePending && (
        <div
          className="flex items-center gap-1.5 pl-1 text-[11px] text-muted-foreground"
          data-testid={`explain-row-lookthrough-pending-${rowIndex}`}
          role="status"
          aria-live="polite"
        >
          <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
          <span>{t("explain.row.lookthroughPending")}</span>
        </div>
      )}
      {isManual && position.manualMeta && (
        <EtfInfoPreview
          isin={position.isin}
          rowIndex={rowIndex}
          currentName={position.manualMeta.name}
          currentCurrency={position.manualMeta.currency}
          currentTerBps={position.manualMeta.terBps}
          currentAssetClass={position.manualMeta.assetClass}
          currentRegion={position.manualMeta.region}
          currentAutoClassified={position.manualMeta.autoClassified}
          onAutoClassify={onAutoClassify}
          onQuickFill={onManualMetaQuickFill}
        />
      )}
    </div>
  );
}

export function ExplainPortfolio() {
  const { t, lang } = useT();

  const [state, setState] = useState<PersistedState>(() => loadState());
  const [importOpen, setImportOpen] = useState(false);



  const [weightDrafts, setWeightDrafts] = useState<string[]>(() =>
    state.positions.map((p) => String(p.weight)),
  );

  const [riskRegime, setRiskRegime] = useState<RiskRegime>("normal");

  // Task #161 — single ETFDetailsDialog mount controlled by this state,
  // mirroring Build's pattern. Set from PositionRow's ISIN button click.
  const [detailsEtf, setDetailsEtf] = useState<ETFImplementation | null>(null);

  // Per-asset-class expand override. `undefined` for an asset class means
  // "use the smart default" (open iff any bucket inside it has a position).
  // Once the user clicks the chevron the explicit boolean sticks for the
  // session, so adding/removing a position later doesn't reflow the tree
  // out from under them.
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  // Task #238 — bumped when an on-demand look-through scrape registers a
  // new runtime profile, so the `portfolio` useMemo recomputes and the
  // destructive "unmapped ETFs" alert clears for the row.
  const [runtimeProfileVersion, setRuntimeProfileVersion] = useState(0);
  // Task #251 — set of off-catalog ISINs that the EtfInfoPreview's
  // Stammdaten arrival has already auto-classified into a non-default
  // assetClass/region. Used by `setManualIsin`'s deferred toast block
  // to suppress the destructive "look-through unavailable" toast when
  // the row is NOT silently mis-routed (the in-row amber 0 % banner
  // is enough). Cleared when the operator manually overrides the
  // auto-fill via `setManualMetaField`.
  const autoClassifiedIsinsRef = useRef<Set<string>>(new Set());
  // Task #262 — set of off-catalog ISINs whose import-triggered
  // look-through scrape is still in flight. Seeded by
  // `replaceWithImportedRows` from the list returned by
  // `triggerImportLookthroughScrapes`; entries are removed once each
  // scrape resolves (success OR failure) so the inline spinner on the
  // matching PositionRow disappears either way.
  const [pendingScrapeIsins, setPendingScrapeIsins] = useState<ReadonlySet<string>>(
    () => new Set(),
  );

  function toggleGroup(assetClass: string, smartDefault: boolean) {
    setExpandedGroups((prev) => {
      const current = prev[assetClass] ?? smartDefault;
      return { ...prev, [assetClass]: !current };
    });
  }

  useEffect(() => {
    saveState(state);
  }, [state]);

  // Publish the current Explain workspace on a tiny in-memory channel so
  // the Compare tab can offer a "Load from Explain" affordance per slot
  // and gate it on whether there is anything to load. Mirrors the same
  // pattern Build uses via `setLastBuildInput`. Fresh on full reload.
  useEffect(() => {
    setLastExplainWorkspace(state);
  }, [state]);
  useEffect(() => {
    // Clear on true unmount only — running this in the [state] effect's
    // cleanup would publish null on every keystroke before republishing
    // the new state, briefly flickering availability-gated controls
    // (e.g. Compare's "Load from Explain" buttons).
    return () => {
      setLastExplainWorkspace(null);
    };
  }, []);

  // Receive "Send to Explain" requests from the Build tab (Task #175).
  // Mirrors the request/take/subscribe pattern Compare uses for the
  // Explain → Compare direction. We drain any pending request that
  // arrived before this component mounted, then keep the subscription
  // alive for in-session sends. Replacing state goes through the same
  // [state]-watching saveState effect above so the new workspace is
  // persisted to localStorage and republished to other tabs.
  useEffect(() => {
    const apply = (workspace: ExplainWorkspace) => {
      const next: PersistedState = {
        ...workspace,
        positions: workspace.positions.map((p) => ({
          ...p,
          ...(p.manualMeta ? { manualMeta: { ...p.manualMeta } } : {}),
        })),
      };
      setState(next);
      syncDraftsFromPositions(next.positions);
      // Sender (BuildPortfolio) emits the single localized success toast
      // with the position count — no receiver-side toast here, otherwise
      // users would see two stacked notifications for the same hand-off.
    };
    const pending = takePendingExplainLoadRequest();
    if (pending) apply(pending.workspace);
    return subscribeExplainLoadRequests((req) => apply(req.workspace));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function parseDraft(s: string): number {
    if (!s.trim()) return 0;
    const parsed = parseDecimalInput(s, { min: 0, max: 100, decimals: 2 });
    return parsed ?? 0;
  }

  function setWeightDraft(index: number, draft: string) {
    setWeightDrafts((d) => d.map((v, i) => (i === index ? draft : v)));


    const next = parseDraft(draft);
    setState((s) => ({
      ...s,
      positions: s.positions.map((p, i) => (i === index ? { ...p, weight: next } : p)),
    }));
  }

  function syncDraftsFromPositions(positions: PersonalPosition[]) {
    setWeightDrafts(positions.map((p) => (p.weight > 0 ? String(p.weight) : "")));
  }

  function normalizeAll() {
    const normalized = normalizeWeights(state.positions);
    setState((s) => ({ ...s, positions: normalized }));
    syncDraftsFromPositions(normalized);
  }

  function addPositionInBucket(bucketKey: string) {
    setState((s) => ({ ...s, positions: [...s.positions, { isin: "", bucketKey, weight: 0 }] }));
    setWeightDrafts((d) => [...d, ""]);
  }

  // Task #174 — first-class Cash row. Pure non-ETF asset class with
  // weight + currency, no ISIN, no catalog bucket, no IsinPicker. The
  // sentinel `bucketKey === "Cash"` (see `EXPLAIN_CASH_BUCKET_SENTINEL`)
  // is recognised by `resolveSleeve` in personalPortfolio.ts and is
  // explicitly NOT registered in BUCKETS / ALL_BUCKET_KEYS in etfs.ts.
  // `cashCurrency` defaults to the workspace base currency, mirroring
  // how Build derives the Cash sleeve region from `input.baseCurrency`
  // in portfolio.ts:337.
  function addCashPosition() {
    setState((s) => ({
      ...s,
      positions: [
        ...s.positions,
        {
          isin: "",
          bucketKey: EXPLAIN_CASH_BUCKET_SENTINEL,
          weight: 0,
          cashCurrency: s.baseCurrency,
        },
      ],
    }));
    setWeightDrafts((d) => [...d, ""]);
  }

  function setCashCurrency(index: number, currency: BaseCurrency) {
    setState((s) => ({
      ...s,
      positions: s.positions.map((p, i) =>
        i === index ? { ...p, cashCurrency: currency } : p,
      ),
    }));
  }

  function addManualPosition() {
    setState((s) => ({
      ...s,
      positions: [
        ...s.positions,
        {
          isin: "",
          bucketKey: "",
          weight: 0,
          manualMeta: { assetClass: "Equity", region: "Global" },
        },
      ],
    }));
    setWeightDrafts((d) => [...d, ""]);
  }

  function removePosition(index: number) {
    setState((s) => ({ ...s, positions: s.positions.filter((_, i) => i !== index) }));
    setWeightDrafts((d) => d.filter((_, i) => i !== index));
  }

  function pickIsinForRow(index: number, isin: string) {
    const inst = getInstrumentByIsin(isin);
    if (!inst) return;
    const bk = getBucketKeyForIsin(isin);
    if (!bk) return;
    setState((s) => ({
      ...s,
      positions: s.positions.map((p, i) =>
        i === index ? { ...p, isin, bucketKey: bk, manualMeta: undefined } : p,
      ),
    }));
  }

  // Task #156 — atomic fill of an off-catalog row from an unassigned
  // INSTRUMENTS entry. Sets isin AND seeds manualMeta in one setState
  // so the row never flickers through an inconsistent half-filled
  // state. assetClass/region are guessed from the instrument's name +
  // comment (see inferAssetClassRegionFromInstrument); if the user
  // had already chosen a non-default class/region for this row, that
  // explicit choice wins over the guess. The dropdowns under the row
  // let the user override either field afterward.
  function pickUnassignedInstrumentForRow(
    index: number,
    rec: Readonly<InstrumentRecord>,
  ) {
    setState((s) => ({
      ...s,
      positions: s.positions.map((p, i) => {
        if (i !== index) return p;
        const guess = inferAssetClassRegionFromInstrument(rec);
        const cur = p.manualMeta;
        // Preserve a user-picked class/region only if it isn't the
        // generic Equity/Global default — otherwise prefer the guess.
        const userPickedClass =
          cur && !(cur.assetClass === "Equity" && cur.region === "Global");
        return {
          ...p,
          isin: rec.isin,
          bucketKey: "",
          manualMeta: {
            assetClass: userPickedClass ? cur!.assetClass : guess.assetClass,
            region: userPickedClass ? cur!.region : guess.region,
            name: rec.name,
            currency: rec.currency,
            terBps: rec.terBps,
          },
        };
      }),
    }));
  }

  // Task #259 — handle a look-through scrape result for an off-catalog
  // manual ISIN. Extracted out of setManualIsin so the import path can
  // share the success-path (registerRuntimeLookthroughProfile + version
  // bump + success toast) and failure-path (destructive toast) handling
  // with the row-level editor. `deferToast` controls whether the failure
  // toast is fired immediately (import path — the row is already
  // operator-classified via the import dialog's manualMeta seed) or
  // delayed by 1500 ms (setManualIsin path — the parallel
  // EtfInfoPreview Stammdaten scrape may auto-classify the row before
  // the toast fires). `allowMute` controls whether a previously
  // auto-classified ISIN suppresses the redundant red toast — only the
  // setManualIsin path opts in; the import path always shows the toast
  // because the row's classification came from the import dialog and
  // not from the parallel Stammdaten scrape.
  function handleManualScrapeResult(
    trimmed: string,
    result: ScrapeLookthroughResult,
    opts: { deferToast: boolean; allowMute?: boolean },
  ) {
    if (!result.ok) {
      const reasonDe: Record<typeof result.reason, string> = {
        invalid_isin: "Ungültige ISIN",
        network_error: "Netzwerkfehler beim Abrufen",
        rate_limited: "Zu viele Anfragen — bitte gleich erneut versuchen",
        lookthrough_incomplete:
          "justETF lieferte keine Geo-/Sektor-Daten — Position kann nicht analysiert werden",
        scrape_failed: "Look-through-Abruf fehlgeschlagen",
      };
      const reasonEn: Record<typeof result.reason, string> = {
        invalid_isin: "Invalid ISIN",
        network_error: "Network error while fetching",
        rate_limited: "Too many requests — try again shortly",
        lookthrough_incomplete:
          "justETF returned no geo/sector data — position cannot be analyzed",
        scrape_failed: "Look-through scrape failed",
      };
      const allowMute = opts.allowMute ?? true;
      const fireToast = () => {
        if (
          shouldSuppressScrapeFailureToast({
            trimmed,
            autoClassifiedIsins: autoClassifiedIsinsRef.current,
            allowMute,
          })
        ) {
          return;
        }
        toast.error(
          lang === "de"
            ? `${trimmed}: ${reasonDe[result.reason]}`
            : `${trimmed}: ${reasonEn[result.reason]}`,
        );
      };
      if (opts.deferToast && typeof window !== "undefined") {
        window.setTimeout(fireToast, 1500);
      } else {
        fireToast();
      }
      return;
    }
    const scraped = result.profile;
    const scrapedName = scraped.name ?? "";
    const RT_BOND_RE =
      /\b(bond|aggregate|treasury|gilts?|bund|btp|oat|govie|corporate\s+credit|high\s+yield|inflation[- ]?linked|tips|money\s+market|t-?bill)\b/i;
    const RT_COMMODITY_RE =
      /\b(gold|silver|platinum|palladium|oil|brent|wti|natural\s+gas|copper|commodit|wheat|corn)\b/i;
    const REAL_EQUITY_SECTORS = new Set([
      "Technology",
      "Financials",
      "Healthcare",
      "Consumer Discretionary",
      "Consumer Staples",
      "Industrials",
      "Communication Services",
      "Energy",
      "Materials",
      "Utilities",
      "Real Estate",
    ]);
    const sectorKeys = Object.keys(scraped.sector ?? {});
    const hasRealEquitySector = sectorKeys.some((k) =>
      REAL_EQUITY_SECTORS.has(k),
    );
    const nameLooksFixedIncome =
      RT_BOND_RE.test(scrapedName) || RT_COMMODITY_RE.test(scrapedName);
    const inferredIsEquity = nameLooksFixedIncome
      ? false
      : hasRealEquitySector;
    registerRuntimeLookthroughProfile(trimmed, {
      isEquity: inferredIsEquity,
      geo: scraped.geo!,
      sector: scraped.sector!,
      currency: scraped.currency ?? {},
      ...(scraped.topHoldings && scraped.topHoldings.length > 0
        ? { topHoldings: scraped.topHoldings }
        : {}),
    });
    setRuntimeProfileVersion((v) => v + 1);
    toast.success(
      lang === "de"
        ? `Look-through-Profil geladen für ${trimmed}`
        : `Look-through profile loaded for ${trimmed}`,
    );
  }

  function setManualIsin(index: number, isin: string) {
    setState((s) => ({
      ...s,
      positions: s.positions.map((p, i) => (i === index ? { ...p, isin } : p)),
    }));
    // Task #238 — fire an on-demand look-through scrape for off-catalog
    // ISINs. The catalog/pool already covers anything with a curated
    // profile, so we only ping the server when `profileFor` returns
    // null. On success the result is registered into the runtime
    // profile registry and `runtimeProfileVersion` bumps so the
    // `portfolio` useMemo recomputes. On failure we surface a
    // destructive toast that names the failure mode — we do NOT
    // silently leave the row in the unmapped-ETFs alert, per the
    // task contract.
    const trimmed = isin.trim().toUpperCase();
    if (!/^[A-Z]{2}[A-Z0-9]{9}\d$/.test(trimmed)) return;
    if (lookthroughProfileFor(trimmed)) return;
    void scrapeLookthroughForIsin(trimmed).then((result) => {
      // Task #251 — defer the destructive toast 1500 ms so the parallel
      // Stammdaten auto-classify can mute it (see
      // `handleManualScrapeResult`). Task #259 — the success-path
      // (registerRuntimeLookthroughProfile + version bump + success
      // toast) and the failure-toast wording / equity classification
      // logic live in the shared helper so the import path can reuse
      // them without drift.
      handleManualScrapeResult(trimmed, result, { deferToast: true });
    });
  }

  function setManualMetaField(
    index: number,
    field: "assetClass" | "region",
    value: string,
  ) {
    setState((s) => ({
      ...s,
      positions: s.positions.map((p, i) => {
        if (i !== index) return p;
        const cur = p.manualMeta ?? { assetClass: "Equity", region: "Global" };
        // Task #251 — operator touched a dropdown, so the row is now
        // operator-curated. Drop the autoClassified flag (the hint
        // disappears) and unmark the ISIN so the autoClassify effect
        // won't re-fire later in the same session.
        const next = { ...cur, [field]: value };
        delete next.autoClassified;
        if (p.isin) {
          autoClassifiedIsinsRef.current.delete(p.isin.trim().toUpperCase());
        }
        return { ...p, manualMeta: next };
      }),
    }));
  }

  // Task #251 — atomic auto-classify writer. Fired by EtfInfoPreview
  // when the ETF-preview Stammdaten arrive for an off-catalog ISIN AND
  // the row still carries the fresh `{Equity, Global}` defaults. We
  // re-check the precedence rule here as a server-side-style safety
  // net (the preview already gates this client-side, but races with a
  // concurrent operator pick should never overwrite their input).
  // Also flips the ISIN into `autoClassifiedIsinsRef` so the
  // look-through toast suppression in `setManualIsin` knows we
  // already classified the row from Stammdaten — see the deferred
  // toast block there.
  function autoClassifyManualMeta(
    index: number,
    values: { assetClass: string; region: string },
  ) {
    setState((s) => ({
      ...s,
      positions: s.positions.map((p, i) => {
        if (i !== index) return p;
        const cur = p.manualMeta ?? { assetClass: "Equity", region: "Global" };
        if (cur.autoClassified) return p;
        const isFreshDefault =
          cur.assetClass === "Equity" && cur.region === "Global";
        if (!isFreshDefault) return p;
        if (p.isin) {
          autoClassifiedIsinsRef.current.add(p.isin.trim().toUpperCase());
        }
        return {
          ...p,
          manualMeta: {
            ...cur,
            assetClass: values.assetClass,
            region: values.region,
            autoClassified: true,
          },
        };
      }),
    }));
  }

  // Atomic merge of metadata fields supplied by the EtfInfoPreview's
  // quick-fill button. Only fills empty fields — the preview already
  // gates this client-side (it only emits the keys that are still
  // undefined on the row), but we re-check here so a race with concurrent
  // edits can't clobber operator input.
  function quickFillManualMeta(index: number, values: QuickFillValues) {
    setState((s) => ({
      ...s,
      positions: s.positions.map((p, i) => {
        if (i !== index) return p;
        const cur = p.manualMeta ?? { assetClass: "Equity", region: "Global" };
        const next = { ...cur };
        if (values.name && !cur.name) next.name = values.name;
        if (values.currency && !cur.currency) next.currency = values.currency;
        if (typeof values.terBps === "number" && cur.terBps === undefined) {
          next.terBps = values.terBps;
        }
        return { ...p, manualMeta: next };
      }),
    }));
  }

  function resetAll() {
    setState({ ...DEFAULT_STATE });
    setWeightDrafts([]);
  }

  // Task #232 — replace the editor's positions with the imported rows
  // in one shot. The dialog represents "this is my portfolio", so
  // appending on top of whatever was already in the editor (left over
  // from a previous session restored from localStorage, or from earlier
  // editing) produced doubled weights and stale derived metrics
  // (allocation, home-bias, look-through) that only "self-corrected"
  // once the user re-picked an ETF. Replacing fixes the root cause.
  // The dialog itself prompts for confirmation when the editor is
  // non-empty so users aren't surprised.
  function replaceWithImportedRows(
    rows: PersonalPosition[],
    summary: ImportSummary,
  ) {
    if (rows.length === 0) return;
    setState((s) => ({ ...s, positions: rows }));
    setWeightDrafts(rows.map((p) => (p.weight > 0 ? String(p.weight) : "")));
    // Task #259 — fire on-demand look-through scrapes for the off-catalog
    // imported rows. Without this, the Geo / Sector / Top-Holdings charts
    // stayed empty for `found-unassigned` and `off-universe` ISINs until
    // the user re-pasted the same ISIN into the row editor (the only
    // other code path that triggers `scrapeLookthroughForIsin`).
    // `lookthroughProfileFor` skips ISINs already covered by the bundled
    // overrides or the runtime registry, so duplicate imports don't
    // re-fan-out. The error toast fires immediately (deferToast=false)
    // because the import dialog has already operator-classified each
    // manual row's `manualMeta`, so the 1500 ms Stammdaten-mute gate
    // used by `setManualIsin` is not needed here. `allowMute=false`
    // also bypasses the `autoClassifiedIsinsRef` suppression — the
    // import path's classification did not come from the parallel
    // Stammdaten auto-classifier, so the operator must always see the
    // failure feedback, even for an ISIN that happened to be auto-
    // classified earlier in the same session.
    // Task #262 — seed the per-row pending-spinner set with the ISINs
    // we just fanned out scrapes for, and clear each entry as its
    // result lands (success OR failure) so the inline spinner on the
    // matching off-catalog row disappears either way.
    const triggered = triggerImportLookthroughScrapes(rows, {
      profileFor: lookthroughProfileFor,
      onResult: (isin, result) => {
        setPendingScrapeIsins((prev) => {
          if (!prev.has(isin)) return prev;
          const next = new Set(prev);
          next.delete(isin);
          return next;
        });
        handleManualScrapeResult(isin, result, {
          deferToast: false,
          allowMute: false,
        });
      },
    });
    if (triggered.length > 0) {
      setPendingScrapeIsins((prev) => {
        const next = new Set(prev);
        for (const isin of triggered) next.add(isin);
        return next;
      });
    }
    toast.success(
      t("explain.import.toast.summary", {
        total: rows.length,
        catalog: summary.catalog,
        unassigned: summary.unassigned,
        offUniverse: summary.offUniverse,
      }),
    );
    if (Math.abs(summary.totalWeight - 100) > 0.01) {
      toast.warning(
        t("explain.import.toast.sumWarning", {
          sum: summary.totalWeight.toFixed(1),
        }),
      );
    }
  }

  // Task #229 — symmetric export to the paste-import format. Walks the
  // positions in the same order the editor renders them (catalog
  // asset-class groups in catalog order → manual entries → unassigned
  // tail), emits one `ISIN / weight` line per row, and skips rows
  // without an ISIN (Cash sentinel rows, half-filled manual rows) since
  // the import format requires an ISIN per line.
  function buildExportText(): string {
    const lines: string[] = [];
    const seen = new Set<number>();
    const pushRow = (i: number) => {
      if (seen.has(i)) return;
      seen.add(i);
      const p = state.positions[i];
      if (!p || !p.isin) return;
      lines.push(`${p.isin} / ${p.weight}`);
    };
    for (const [, buckets] of bucketsByAssetClass) {
      for (const b of buckets) {
        const idx = positionsByBucket.get(b.key) ?? [];
        for (const i of idx) pushRow(i);
      }
    }
    for (const i of manualRowIndices) pushRow(i);
    for (const i of unassignedRowIndices) pushRow(i);
    return lines.join("\n");
  }

  async function copyAsText() {
    const text = buildExportText();
    const count = text === "" ? 0 : text.split("\n").length;
    if (count === 0) {
      toast.error(t("explain.copyAsText.toast.empty"));
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      toast.success(t("explain.copyAsText.toast.success", { n: count }));
    } catch {
      toast.error(t("explain.copyAsText.toast.error"));
    }
  }

  function loadWorkspace(workspace: ExplainWorkspace) {
    // Replace the current Explain workspace with a saved one. The state
    // sanitizer in savedExplainPortfolios already enforces the shape, so
    // this is a clean atomic swap. Drafts are re-derived so the input
    // strings line up with the restored numeric weights.
    setState({ ...workspace, positions: workspace.positions.map((p) => ({ ...p })) });
    syncDraftsFromPositions(workspace.positions);
  }



  const validation = useMemo(
    () => runExplainValidation(state.positions, state.riskAppetite, state.baseCurrency, lang),
    [state.positions, state.riskAppetite, state.baseCurrency, lang],
  );

  // Publish baseCurrency to the cross-tab channel so Methodology's CMA Cash
  // row + building-blocks accordion can show the matching per-currency RF
  // rate as the active μ (Task #192).
  useEffect(() => {
    setLastBaseCurrency(state.baseCurrency);
  }, [state.baseCurrency]);

  const portfolio = useMemo(
    () =>
      synthesizePersonalPortfolio(
        // Task #174 — Cash sentinel rows have no ISIN by design but
        // still contribute their weight to the allocation via
        // `resolveSleeve` (mapped to {Cash | <currency>}). Keep them
        // in the synthesizer input alongside ISIN-bearing rows so the
        // analysis reflects the cash slice; the synthesizer itself
        // only emits an etfImplementation row when there's a real
        // catalog hit or manualMeta, so Cash rows naturally don't
        // pollute the ETF table.
        state.positions.filter(
          (p) =>
            p.weight > 0 &&
            (!!p.isin || p.bucketKey === EXPLAIN_CASH_BUCKET_SENTINEL),
        ),
        state.baseCurrency,
        lang,
        // Task #270 — read-through into the in-tab justETF scrape cache
        // so the Fee Estimator's per-bucket row shows the live TER for
        // off-catalog manual rows even when the operator hasn't pressed
        // the "Quick fill" button on the EtfInfoPreview card. Catalog
        // rows are unaffected (they use `inst.terBps` directly).
        getCachedScrapeTerBps,
      ),
    [state.positions, state.baseCurrency, lang, runtimeProfileVersion],
  );

  // Task #161 — index ETFImplementation rows by ISIN so PositionRow can
  // render a clickable ISIN button matching Build's affordance. The
  // affordance must be available for ANY row whose ISIN resolves to a
  // registered catalog instrument, regardless of weight (the synthesizer
  // skips weight===0 rows, so we can't rely on it as the sole source).
  // Strategy: start from the synthesizer's full rows (these carry the
  // best-quality metadata + ticker/exchange picked from listings) and
  // then top up with synthetic minimal rows for any other catalog ISIN
  // present in state.positions (covers zero-weight catalog rows AND
  // manual rows whose ISIN happens to match a registered instrument).
  // For unresolved off-catalog manual ISINs there's no entry here — the
  // button is suppressed and the existing inline preview path is
  // preserved.
  const etfByIsin = useMemo(() => {
    const m = new Map<string, ETFImplementation>();
    for (const e of portfolio.etfImplementation) {
      if (e.isin && getInstrumentByIsin(e.isin)) m.set(e.isin, e);
    }
    for (const p of state.positions) {
      if (!p.isin || m.has(p.isin)) continue;
      const inst = getInstrumentByIsin(p.isin);
      if (!inst) continue;
      const { ticker, exchange } = pickDefaultListing(inst);
      m.set(p.isin, {
        bucket: "",
        assetClass: "",
        weight: Number.isFinite(p.weight) ? p.weight : 0,
        intent: "",
        exampleETF: inst.name,
        rationale: "",
        isin: inst.isin,
        ticker,
        exchange,
        terBps: inst.terBps,
        domicile: inst.domicile,
        replication: inst.replication,
        distribution: inst.distribution,
        currency: inst.currency,
        comment: inst.comment,
        catalogKey: p.bucketKey ?? null,
        selectedSlot: 0,
        selectableOptions: [],
      });
    }
    return m;
  }, [portfolio.etfImplementation, state.positions]);

  const totalSum = useMemo(() => {
    let s = 0;
    for (const p of state.positions) {
      if (Number.isFinite(p.weight) && p.weight > 0) s += p.weight;
    }
    return Math.round(s * 10) / 10;
  }, [state.positions]);
  const usedIsins = useMemo(
    () => new Set(state.positions.map((p) => p.isin).filter(Boolean)),
    [state.positions],
  );

  const showAnalysis = validation.isValid && portfolio.allocation.length > 0;

  // Gate the "Send to Compare" button on the workspace actually carrying
  // at least one fully-specified position. Validation may flag warnings
  // (e.g. weights not summing to 100%) but Compare can still render the
  // synthesized portfolio in that state — the user wants to see the
  // delta exactly as their workspace stands.
  const canSendToCompare = explainWorkspaceHasContent(state);

  function sendToCompare(slot: CompareSlotName) {
    if (!canSendToCompare) return;
    requestCompareLoadFromExplain(slot, state);
    navigateToTab("compare");
    toast.success(
      lang === "de"
        ? `In Portfolio ${slot} (Vergleichen) geladen`
        : `Loaded into Portfolio ${slot} on Compare`,
    );
  }



  // Tree-of-buckets data. The editor renders every catalog asset class as
  // a collapsible group, and every bucket inside it as an always-visible
  // sub-row with its own scoped picker — no toolbar shortcut needed.
  // Manual positions and any legacy unbucketed rows tail the tree as
  // pseudo-groups so the user can still see them.
  const bucketsByAssetClass = useMemo(() => {
    const m = new Map<string, BucketMeta[]>();
    for (const k of ALL_BUCKET_KEYS) {
      const meta = getBucketMeta(k);
      if (!meta) continue;
      const list = m.get(meta.assetClass) ?? [];
      list.push(meta);
      m.set(meta.assetClass, list);
    }
    return Array.from(m.entries());
  }, []);

  // Catalog buckets currently in the master list. Used to route any
  // legacy/stale row whose `bucketKey` no longer matches a real catalog
  // bucket into the tail "Unassigned" pseudo-group, so the user can still
  // see and remove it instead of having it silently disappear from the
  // editor when the catalog evolves.
  const validBucketKeys = useMemo(
    () => new Set<string>(ALL_BUCKET_KEYS),
    [],
  );

  const positionsByBucket = useMemo(() => {
    const m = new Map<string, number[]>();
    state.positions.forEach((p, i) => {
      if (p.manualMeta) return;
      if (!p.bucketKey || !validBucketKeys.has(p.bucketKey)) return;
      const arr = m.get(p.bucketKey) ?? [];
      arr.push(i);
      m.set(p.bucketKey, arr);
    });
    return m;
  }, [state.positions, validBucketKeys]);

  const manualRowIndices = useMemo(
    () =>
      state.positions
        .map((p, i) => (p.manualMeta ? i : -1))
        .filter((i) => i >= 0),
    [state.positions],
  );

  // Task #174 — first-class Cash rows live in their own pseudo-group at
  // the top of the tree. Identified purely by the sentinel bucketKey so
  // they're cleanly excluded from both `positionsByBucket` (catalog
  // groups) and `unassignedRowIndices` (legacy tail) below.
  const cashRowIndices = useMemo(
    () =>
      state.positions
        .map((p, i) =>
          p.bucketKey === EXPLAIN_CASH_BUCKET_SENTINEL && !p.manualMeta ? i : -1,
        )
        .filter((i) => i >= 0),
    [state.positions],
  );

  // Unassigned tail-group: non-manual rows whose `bucketKey` is empty OR
  // points at a bucket the catalog has since dropped/renamed. Both must
  // surface so the user can re-bucket or delete them; otherwise persisted
  // workspaces silently lose visibility on those positions across catalog
  // updates. Cash sentinel rows are intentionally excluded — they have
  // their own dedicated group at the top of the tree.
  const unassignedRowIndices = useMemo(
    () =>
      state.positions
        .map((p, i) =>
          !p.manualMeta &&
          p.bucketKey !== EXPLAIN_CASH_BUCKET_SENTINEL &&
          (!p.bucketKey || !validBucketKeys.has(p.bucketKey))
            ? i
            : -1,
        )
        .filter((i) => i >= 0),
    [state.positions, validBucketKeys],
  );

  // Sum of weights inside one bucket, rounded to 1dp for display only.
  function bucketWeight(bucketKey: string): number {
    const idx = positionsByBucket.get(bucketKey);
    if (!idx) return 0;
    let s = 0;
    for (const i of idx) s += state.positions[i].weight;
    return Math.round(s * 10) / 10;
  }

  // Sum of weights across every bucket inside an asset class, the count
  // of fully-populated ETFs (for the "n ETFs" pill), and a flag for the
  // smart-default expand rule. The flag is broader than `etfCount`: ANY
  // row attached to a bucket — even one the user just added with no ISIN
  // picked yet, or whose weight is still 0 — counts as "this group has a
  // position" and forces the chevron open. That matches the user-facing
  // requirement that adding a row to a bucket auto-reveals the surrounding
  // group on first render.
  function assetClassSummary(buckets: readonly BucketMeta[]): {
    weight: number;
    etfCount: number;
    hasAnyRow: boolean;
  } {
    let w = 0;
    let n = 0;
    let hasAnyRow = false;
    for (const b of buckets) {
      const idx = positionsByBucket.get(b.key);
      if (!idx || idx.length === 0) continue;
      hasAnyRow = true;
      for (const i of idx) {
        const p = state.positions[i];
        if (p.isin && p.weight > 0) n += 1;
        w += p.weight;
      }
    }
    return { weight: Math.round(w * 10) / 10, etfCount: n, hasAnyRow };
  }

  // Sum of weights in a free-form list of indices (manual / unassigned).
  function rowsWeightSum(indices: readonly number[]): number {
    let s = 0;
    for (const i of indices) s += state.positions[i].weight;
    return Math.round(s * 10) / 10;
  }

  // Localised label for the asset-class chevron headers. Falls back to the
  // raw English asset class name (the same string the catalog uses inside
  // bucket section headings) so a missing translation never blanks the row.
  function assetClassLabel(assetClass: string): string {
    const key = `explain.assetClass.${assetClass}`;
    const translated = t(key);
    return translated === key ? assetClass : translated;
  }

  // Slug used inside test ids for the asset-class chevron toggle. Keeps the
  // ids stable + URL-safe ("Fixed Income" → "fixed-income") regardless of
  // translation or whitespace tweaks in the catalog.
  function assetClassSlug(assetClass: string): string {
    return assetClass.toLowerCase().replace(/\s+/g, "-");
  }

  // Localised "N ETFs" badge inside each chevron header. Pluralisation is
  // handled inline since the `useT` hook here doesn't ship an ICU plural
  // helper — count buckets are tiny (0..N) so the cost of two branches is
  // negligible.
  function etfCountLabel(n: number): string {
    if (n === 0) return t("explain.tree.etfCount.zero");
    if (n === 1) return t("explain.tree.etfCount.one");
    return t("explain.tree.etfCount.other").replace("{n}", String(n));
  }

  // Pretty bucket sub-header: region + hedged/synthetic flags. Mirrors the
  // formatting used inside the IsinPicker grouping headers so the same
  // bucket reads identically in both places.
  function bucketHeader(meta: BucketMeta): string {
    const ccyPrefix = meta.hedgeCurrency ? `${meta.hedgeCurrency}-` : "";
    const flags = `${
      meta.hedged
        ? lang === "de"
          ? ` (${ccyPrefix}gehedgt)`
          : ` (${ccyPrefix}hedged)`
        : ""
    }${meta.synthetic ? (lang === "de" ? " · synthetisch" : " · synthetic") : ""}`;
    return `${meta.region}${flags}`;
  }

  return (
    <div className="space-y-6">
      <Alert>
        <AlertTriangle className="h-4 w-4" />
        <AlertTitle>{t("explain.intro.title")}</AlertTitle>
        <AlertDescription>{t("explain.intro.desc")}</AlertDescription>
      </Alert>

      <div
        className={`grid grid-cols-1 gap-6 ${
          showAnalysis ? "lg:grid-cols-12" : ""
        }`}
      >

        <div
          className={`space-y-6 ${showAnalysis ? "lg:col-span-5" : ""}`}
        >
          <Card>
            <CardHeader>
              <CardTitle>{t("explain.settings.title")}</CardTitle>
              <CardDescription>{t("explain.settings.desc")}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">{t("build.baseCurrency.label")}</Label>
                  <Select
                    value={state.baseCurrency}
                    onValueChange={(v) =>
                      setState((s) => ({ ...s, baseCurrency: v as BaseCurrency }))
                    }
                  >
                    <SelectTrigger className="h-9" data-testid="explain-base-currency">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="USD">USD</SelectItem>
                      <SelectItem value="EUR">EUR</SelectItem>
                      <SelectItem value="CHF">CHF</SelectItem>
                      <SelectItem value="GBP">GBP</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground" data-testid="explain-cash-rate-hint">
                    {t("build.baseCurrency.cashRate", {
                      pct: (effectiveCashExpReturn(state.baseCurrency) * 100).toFixed(2),
                      ccy: state.baseCurrency,
                    })}
                  </p>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">{t("explain.riskProfile.label")}</Label>
                  <Select
                    value={state.riskAppetite}
                    onValueChange={(v) =>
                      setState((s) => ({ ...s, riskAppetite: v as RiskAppetite }))
                    }
                  >
                    <SelectTrigger className="h-9" data-testid="explain-risk">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Low">Low</SelectItem>
                      <SelectItem value="Moderate">Moderate</SelectItem>
                      <SelectItem value="High">High</SelectItem>
                      <SelectItem value="Very High">Very High</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">{t("explain.horizon.label")}</Label>
                  <Input
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={40}
                    className="h-9 text-sm"
                    value={state.horizon}
                    onChange={(e) => {
                      const n = Math.max(1, Math.min(40, Math.floor(Number(e.target.value) || 1)));
                      setState((s) => ({ ...s, horizon: n }));
                    }}
                    data-testid="explain-horizon"
                  />
                </div>
                <div className="space-y-1.5 flex flex-col">
                  <Label className="text-xs">{t("explain.toggles.label")}</Label>
                  <div className="flex items-center gap-3 h-9">
                    <label className="flex items-center gap-2 text-xs cursor-pointer">
                      <Switch
                        checked={state.hedged}
                        onCheckedChange={(c) => setState((s) => ({ ...s, hedged: c }))}
                        data-testid="explain-hedged"
                      />
                      <span>{t("explain.hedged.label")}</span>
                    </label>
                    <label className="flex items-center gap-2 text-xs cursor-pointer">
                      <Switch
                        checked={state.lookThroughView}
                        onCheckedChange={(c) =>
                          setState((s) => ({ ...s, lookThroughView: c }))
                        }
                        data-testid="explain-lookthrough"
                      />
                      <span>{t("explain.lookthrough.label")}</span>
                    </label>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <CardTitle>{t("explain.positions.title")}</CardTitle>
                  <CardDescription>{t("explain.positions.desc")}</CardDescription>
                </div>
                <div className="flex gap-2 flex-wrap justify-end items-center">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={resetAll}
                    className="h-8 text-xs text-muted-foreground"
                    data-testid="explain-reset"
                  >
                    <RotateCcw className="mr-1.5 h-3 w-3" />
                    {t("explain.btn.reset")}
                  </Button>
                </div>
              </div>
              {/* Import / Copy-as-text live directly above the Save/Load
               *  slot UI so the prominent Import call-to-action sits next
               *  to the persistence affordances rather than competing
               *  with the quiet Reset action in the header. */}
              <div className="pt-2 flex gap-2 flex-wrap items-center">
                <Button
                  type="button"
                  variant="default"
                  size="sm"
                  onClick={() => setImportOpen(true)}
                  data-testid="explain-import-open"
                >
                  <Upload className="mr-1.5 h-4 w-4" />
                  {t("explain.btn.import")}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={copyAsText}
                  disabled={!state.positions.some((p) => !!p.isin)}
                  data-testid="explain-copy-as-text"
                >
                  <ClipboardCopy className="mr-1.5 h-4 w-4" />
                  {t("explain.btn.copyAsText")}
                </Button>
              </div>
              {/* Save/Load slot UI — independent localStorage namespace from
               *  Build's scenario store so personal-portfolio sessions can be
               *  kept in parallel without colliding with strategy scenarios. */}
              <div className="pt-2">
                <SavedExplainPortfoliosUI
                  canSave={state.positions.length > 0}
                  getCurrentWorkspace={() => state}
                  onLoadPortfolio={(p) => loadWorkspace(p.workspace)}
                />
              </div>
              {/* "Send to Compare" — drops the current Explain workspace
               *  into one of the Compare-tab slots and switches the tab.
               *  Disabled until at least one fully-specified position
               *  carries weight (otherwise there's nothing to compare). */}
              <div className="pt-2">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      type="button"
                      variant="secondary"
                      className="w-full"
                      disabled={!canSendToCompare}
                      data-testid="explain-send-to-compare"
                    >
                      <Scale className="mr-1.5 h-3 w-3" />
                      {t("explain.btn.sendToCompare")}
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    <DropdownMenuItem
                      onSelect={() => sendToCompare("A")}
                      data-testid="explain-send-to-compare-a"
                    >
                      {t("explain.btn.sendToCompare.slotA")}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onSelect={() => sendToCompare("B")}
                      data-testid="explain-send-to-compare-b"
                    >
                      {t("explain.btn.sendToCompare.slotB")}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {state.positions.length === 0 && (
                <div className="rounded border border-dashed p-4 text-center text-xs text-muted-foreground">
                  {t("explain.empty.positions")}
                </div>
              )}

              {/* Bucket tree. Every catalog asset class is rendered as a
                  collapsible chevron header; expanded groups list every
                  bucket inside (populated or empty) with its own scoped
                  picker via the per-bucket [+] button. */}
              <div className="space-y-1.5" data-testid="explain-bucket-tree">
                {/* Task #174 — first-class Cash pseudo-group. Sits at the
                    top of the tree to mirror Build's canonical asset-class
                    order (Cash → Fixed Income → Equity → …, see
                    `ASSET_CLASS_ORDER` in personalPortfolio.ts:39). Cash
                    is NOT a catalog bucket — its sentinel `bucketKey ===
                    "Cash"` is recognised by `resolveSleeve` but is not in
                    `BUCKETS` / `ALL_BUCKET_KEYS`. The [+] button adds rows
                    directly without opening any picker (no ISIN, no role
                    badge, no look-through controls — see CashPositionRow
                    below). Smart-default expand mirrors the catalog
                    groups: open iff at least one cash row already exists.
                */}
                {(() => {
                  const cashSummaryWeight = rowsWeightSum(cashRowIndices);
                  const cashSmartDefault = cashRowIndices.length > 0;
                  const cashExpanded =
                    expandedGroups[EXPLAIN_CASH_BUCKET_SENTINEL] ?? cashSmartDefault;
                  return (
                    <div
                      key={EXPLAIN_CASH_BUCKET_SENTINEL}
                      className="rounded border bg-card/40"
                    >
                      <button
                        type="button"
                        onClick={() =>
                          toggleGroup(EXPLAIN_CASH_BUCKET_SENTINEL, cashSmartDefault)
                        }
                        className="w-full flex items-center justify-between gap-2 px-2.5 py-2 text-left hover:bg-muted/40 rounded"
                        aria-expanded={cashExpanded}
                        data-state={cashExpanded ? "open" : "closed"}
                        data-testid="explain-group-cash"
                      >
                        <span className="flex items-center gap-1.5 min-w-0">
                          <ChevronRight
                            className={`h-3.5 w-3.5 shrink-0 transition-transform ${
                              cashExpanded ? "rotate-90" : ""
                            }`}
                          />
                          <span className="text-xs font-semibold uppercase tracking-wide truncate">
                            {assetClassLabel("Cash")}
                          </span>
                        </span>
                        <span className="flex items-center gap-2 text-xs text-muted-foreground shrink-0">
                          <span className="font-mono">
                            {cashSummaryWeight.toFixed(1)}%
                          </span>
                        </span>
                      </button>
                      {cashExpanded && (
                        <div className="px-2.5 pb-2 pt-0.5 space-y-2.5">
                          <div
                            className="space-y-1.5"
                            data-testid="explain-bucket-Cash"
                          >
                            <div className="flex items-center justify-between gap-2 text-xs pl-4">
                              <span className="text-muted-foreground truncate">
                                {t("explain.tree.cash.desc")}
                              </span>
                              <div className="flex items-center gap-1.5 shrink-0">
                                <span
                                  className={`font-mono text-[11px] ${
                                    cashSummaryWeight > 0 ? "" : "opacity-50"
                                  }`}
                                >
                                  {cashSummaryWeight.toFixed(1)}%
                                </span>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  className="h-6 w-6 text-muted-foreground hover:text-primary"
                                  onClick={addCashPosition}
                                  aria-label={t("explain.btn.addCashPosition")}
                                  title={t("explain.btn.addCashPosition")}
                                  data-testid={`explain-add-in-bucket-${EXPLAIN_CASH_BUCKET_SENTINEL}`}
                                >
                                  <Plus className="h-3.5 w-3.5" />
                                </Button>
                              </div>
                            </div>
                            {cashRowIndices.length > 0 && (
                              <div className="space-y-2 pl-4">
                                {cashRowIndices.map((i) => {
                                  const p = state.positions[i];
                                  return (
                                    <div
                                      key={i}
                                      className="space-y-2"
                                      data-testid={`explain-row-${i}`}
                                    >
                                      <div className="grid grid-cols-[minmax(0,22rem)_5.5rem_2rem] gap-2 items-center">
                                        <Select
                                          value={p.cashCurrency ?? state.baseCurrency}
                                          onValueChange={(v) =>
                                            setCashCurrency(i, v as BaseCurrency)
                                          }
                                        >
                                          <SelectTrigger
                                            className="h-9 text-sm"
                                            data-testid={`explain-cash-currency-${i}`}
                                            aria-label={t("explain.cash.currency.label")}
                                          >
                                            <SelectValue />
                                          </SelectTrigger>
                                          <SelectContent>
                                            <SelectItem value="USD">USD</SelectItem>
                                            <SelectItem value="EUR">EUR</SelectItem>
                                            <SelectItem value="CHF">CHF</SelectItem>
                                            <SelectItem value="GBP">GBP</SelectItem>
                                          </SelectContent>
                                        </Select>
                                        <Input
                                          type="text"
                                          inputMode="decimal"
                                          enterKeyHint="next"
                                          autoComplete="off"
                                          autoCorrect="off"
                                          spellCheck={false}
                                          className="h-9 text-sm font-mono text-right"
                                          placeholder="0"
                                          value={weightDrafts[i] ?? ""}
                                          onChange={(e) => setWeightDraft(i, e.target.value)}
                                          aria-label="weight"
                                          data-testid={`explain-weight-${i}`}
                                        />
                                        <Button
                                          type="button"
                                          variant="ghost"
                                          size="icon"
                                          onClick={() => removePosition(i)}
                                          className="h-9 w-9 text-muted-foreground hover:text-destructive"
                                          aria-label="remove"
                                          data-testid={`explain-remove-${i}`}
                                        >
                                          <Trash2 className="h-4 w-4" />
                                        </Button>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })()}
                {bucketsByAssetClass.map(([assetClass, buckets]) => {
                  const summary = assetClassSummary(buckets);
                  // Smart-default: a group expands automatically iff at
                  // least one of its catalog buckets has a row — see the
                  // `hasAnyRow` doc comment on `assetClassSummary`. The
                  // user's explicit chevron toggle (stored in
                  // `expandedGroups`) wins for the rest of the session.
                  const smartDefault = summary.hasAnyRow;
                  const isExpanded = expandedGroups[assetClass] ?? smartDefault;
                  const slug = assetClassSlug(assetClass);
                  return (
                    <div key={assetClass} className="rounded border bg-card/40">
                      <button
                        type="button"
                        onClick={() => toggleGroup(assetClass, smartDefault)}
                        className="w-full flex items-center justify-between gap-2 px-2.5 py-2 text-left hover:bg-muted/40 rounded"
                        aria-expanded={isExpanded}
                        data-state={isExpanded ? "open" : "closed"}
                        data-testid={`explain-group-${slug}`}
                      >
                        <span className="flex items-center gap-1.5 min-w-0">
                          <ChevronRight
                            className={`h-3.5 w-3.5 shrink-0 transition-transform ${
                              isExpanded ? "rotate-90" : ""
                            }`}
                          />
                          <span className="text-xs font-semibold uppercase tracking-wide truncate">
                            {assetClassLabel(assetClass)}
                          </span>
                        </span>
                        <span className="flex items-center gap-2 text-xs text-muted-foreground shrink-0">
                          <span className="font-mono">
                            {summary.weight.toFixed(1)}%
                          </span>
                          <span className="hidden sm:inline">
                            {etfCountLabel(summary.etfCount)}
                          </span>
                        </span>
                      </button>
                      {isExpanded && (
                        <div className="px-2.5 pb-2 pt-0.5 space-y-2.5">
                          {buckets.map((b) => {
                            const idx = positionsByBucket.get(b.key) ?? [];
                            const sum = bucketWeight(b.key);
                            return (
                              <div
                                key={b.key}
                                className="space-y-1.5"
                                data-testid={`explain-bucket-${b.key}`}
                              >
                                <div className="flex items-center justify-between gap-2 text-xs pl-4">
                                  <span className="text-muted-foreground truncate">
                                    {bucketHeader(b)}
                                  </span>
                                  <div className="flex items-center gap-1.5 shrink-0">
                                    <span
                                      className={`font-mono text-[11px] ${
                                        sum > 0 ? "" : "opacity-50"
                                      }`}
                                    >
                                      {sum.toFixed(1)}%
                                    </span>
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="icon"
                                      className="h-6 w-6 text-muted-foreground hover:text-primary"
                                      onClick={() => addPositionInBucket(b.key)}
                                      aria-label={t("explain.btn.addInThisBucket")}
                                      title={t("explain.btn.addInThisBucket")}
                                      data-testid={`explain-add-in-bucket-${b.key}`}
                                    >
                                      <Plus className="h-3.5 w-3.5" />
                                    </Button>
                                  </div>
                                </div>
                                {idx.length > 0 && (
                                  <div className="space-y-2 pl-4">
                                    {idx.map((i) => (
                                      <PositionRow
                                        key={i}
                                        rowIndex={i}
                                        position={state.positions[i]}
                                        weightDraft={weightDrafts[i] ?? ""}
                                        excludeIsins={usedIsins}
                                        onPickIsin={(isin) => pickIsinForRow(i, isin)}
                                        onWeightChange={(d) => setWeightDraft(i, d)}
                                        onRemove={() => removePosition(i)}
                                        onManualIsinChange={(isin) =>
                                          setManualIsin(i, isin)
                                        }
                                        onManualMetaChange={(field, value) =>
                                          setManualMetaField(i, field, value)
                                        }
                                        onManualMetaQuickFill={(values) =>
                                          quickFillManualMeta(i, values)
                                        }
                                        onAutoClassify={(values) =>
                                          autoClassifyManualMeta(i, values)
                                        }
                                        onPickUnassignedInstrument={(rec) =>
                                          pickUnassignedInstrumentForRow(i, rec)
                                        }
                                        detailsEtf={
                                          state.positions[i].isin
                                            ? etfByIsin.get(state.positions[i].isin) ?? null
                                            : null
                                        }
                                        onOpenDetails={setDetailsEtf}
                                        isLookthroughScrapePending={
                                          state.positions[i].isin
                                            ? pendingScrapeIsins.has(
                                                state.positions[i].isin,
                                              )
                                            : false
                                        }
                                      />
                                    ))}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Manual positions live in their own pseudo-group at the
                  tail of the tree. Off-catalog ISINs can't slot into a
                  catalog bucket, so they get a fixed home with the same
                  visual rhythm as the catalog groups. */}
              {manualRowIndices.length > 0 && (
                <div className="rounded border bg-card/40">
                  <div className="flex items-center justify-between gap-2 px-2.5 py-2">
                    <span className="text-xs font-semibold uppercase tracking-wide">
                      {t("explain.tree.manual")}
                    </span>
                    <span className="font-mono text-xs text-muted-foreground">
                      {rowsWeightSum(manualRowIndices).toFixed(1)}%
                    </span>
                  </div>
                  <div className="px-2.5 pb-2 space-y-2 pl-4">
                    {manualRowIndices.map((i) => (
                      <PositionRow
                        key={i}
                        rowIndex={i}
                        position={state.positions[i]}
                        weightDraft={weightDrafts[i] ?? ""}
                        excludeIsins={usedIsins}
                        onPickIsin={(isin) => pickIsinForRow(i, isin)}
                        onWeightChange={(d) => setWeightDraft(i, d)}
                        onRemove={() => removePosition(i)}
                        onManualIsinChange={(isin) => setManualIsin(i, isin)}
                        onManualMetaChange={(field, value) =>
                          setManualMetaField(i, field, value)
                        }
                        onManualMetaQuickFill={(values) =>
                          quickFillManualMeta(i, values)
                        }
                        onAutoClassify={(values) =>
                          autoClassifyManualMeta(i, values)
                        }
                        onPickUnassignedInstrument={(rec) =>
                          pickUnassignedInstrumentForRow(i, rec)
                        }
                        detailsEtf={
                          state.positions[i].isin
                            ? etfByIsin.get(state.positions[i].isin) ?? null
                            : null
                        }
                        onOpenDetails={setDetailsEtf}
                        isLookthroughScrapePending={
                          state.positions[i].isin
                            ? pendingScrapeIsins.has(state.positions[i].isin)
                            : false
                        }
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* Legacy unbucketed rows. The current editor never produces
                  one (every entry path now sets either a bucketKey or a
                  manualMeta), but older persisted localStorage state may
                  still carry them — render them so the user can fix or
                  remove them instead of losing data silently. */}
              {unassignedRowIndices.length > 0 && (
                <div className="rounded border bg-card/40">
                  <div className="flex items-center justify-between gap-2 px-2.5 py-2">
                    <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      {t("explain.positions.unassigned")}
                    </span>
                    <span className="font-mono text-xs text-muted-foreground">
                      {rowsWeightSum(unassignedRowIndices).toFixed(1)}%
                    </span>
                  </div>
                  <div className="px-2.5 pb-2 space-y-2 pl-4">
                    {unassignedRowIndices.map((i) => (
                      <PositionRow
                        key={i}
                        rowIndex={i}
                        position={state.positions[i]}
                        weightDraft={weightDrafts[i] ?? ""}
                        excludeIsins={usedIsins}
                        onPickIsin={(isin) => pickIsinForRow(i, isin)}
                        onWeightChange={(d) => setWeightDraft(i, d)}
                        onRemove={() => removePosition(i)}
                        onManualIsinChange={(isin) => setManualIsin(i, isin)}
                        onManualMetaChange={(field, value) =>
                          setManualMetaField(i, field, value)
                        }
                        onManualMetaQuickFill={(values) =>
                          quickFillManualMeta(i, values)
                        }
                        onAutoClassify={(values) =>
                          autoClassifyManualMeta(i, values)
                        }
                        onPickUnassignedInstrument={(rec) =>
                          pickUnassignedInstrumentForRow(i, rec)
                        }
                        detailsEtf={
                          state.positions[i].isin
                            ? etfByIsin.get(state.positions[i].isin) ?? null
                            : null
                        }
                        onOpenDetails={setDetailsEtf}
                        isLookthroughScrapePending={
                          state.positions[i].isin
                            ? pendingScrapeIsins.has(state.positions[i].isin)
                            : false
                        }
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* "Add manual ISIN" lives directly under the bucket tree so
                  the affordance sits next to where new manual rows land
                  (the Manual entries pseudo-group at the tail of the
                  tree). Promoted to filled primary so the manual-entry
                  path is visually peer to the catalog-pick flow. */}
              <div className="pt-1">
                <Button
                  type="button"
                  size="sm"
                  onClick={addManualPosition}
                  className="h-9 text-sm font-medium shadow-sm"
                  data-testid="explain-add-manual"
                >
                  <Plus className="mr-1.5 h-4 w-4" />
                  {t("explain.btn.addManual")}
                </Button>
              </div>

              {state.positions.length > 0 && (
                <>
                  <Separator />
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">
                      {t("explain.totalAllocation")}
                    </span>
                    <div className="flex items-center gap-2">
                      <span
                        className={`font-mono text-base ${
                          Math.abs(totalSum - 100) > 0.5 ? "text-destructive font-bold" : ""
                        }`}
                        data-testid="explain-total"
                      >
                        {totalSum.toFixed(1)}%
                      </span>
                      {Math.abs(totalSum - 100) <= 0.5 && (
                        <Badge variant="outline" className="text-primary border-primary/20">
                          {t("explain.badge.valid")}
                        </Badge>
                      )}
                    </div>
                  </div>
                  <Button
                    type="button"
                    variant={Math.abs(totalSum - 100) > 0.5 ? "default" : "outline"}
                    className="w-full"
                    onClick={normalizeAll}
                    disabled={state.positions.every((p) => p.weight <= 0)}
                    data-testid="explain-normalize"
                  >
                    {t("explain.btn.normalize")}
                  </Button>
                </>
              )}
            </CardContent>
          </Card>
        </div>


        <div
          className={`space-y-6 ${showAnalysis ? "lg:col-span-7" : ""}`}
        >
          <Card className="overflow-hidden border-2">
            <div
              className={`h-2 w-full ${
                validation.errors.length > 0
                  ? "bg-destructive"
                  : validation.warnings.length > 0
                  ? "bg-warning"
                  : "bg-primary"
              }`}
            />
            <CardHeader>
              <div className="flex items-start justify-between">
                <div>
                  <CardTitle>
                    {t("explain.diagnosis.title")}{" "}
                    {validation.errors.length > 0
                      ? t("explain.verdict.inconsistent")
                      : validation.warnings.length > 0
                      ? t("explain.verdict.attention")
                      : t("explain.verdict.coherent")}
                  </CardTitle>
                  <CardDescription>{t("explain.diagnosis.desc")}</CardDescription>
                </div>
                {validation.errors.length === 0 && validation.warnings.length === 0 && (
                  <CheckCircle className="h-8 w-8 text-primary" />
                )}
                {validation.errors.length === 0 && validation.warnings.length > 0 && (
                  <AlertTriangle className="h-8 w-8 text-warning" />
                )}
                {validation.errors.length > 0 && (
                  <XCircle className="h-8 w-8 text-destructive" />
                )}
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {validation.errors.length === 0 && validation.warnings.length === 0 && (
                <p className="text-sm text-muted-foreground">{t("explain.sound")}</p>
              )}
              {validation.errors.length > 0 && (
                <div className="space-y-2">
                  <h4 className="text-sm font-semibold flex items-center gap-2 text-destructive">
                    <XCircle className="h-4 w-4" /> {t("explain.issues.critical")}
                  </h4>
                  <ul className="space-y-2" data-testid="explain-errors">
                    {validation.errors.map((err, i) => (
                      <li
                        key={i}
                        className="text-sm bg-destructive/10 px-3 py-2 rounded-md border border-destructive/20"
                      >
                        <div className="font-medium">{err.message}</div>
                        <div className="text-xs text-muted-foreground mt-0.5">
                          {err.suggestion}
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {validation.warnings.length > 0 && (
                <div className="space-y-2">
                  <h4 className="text-sm font-semibold flex items-center gap-2 text-warning">
                    <AlertTriangle className="h-4 w-4" /> {t("explain.issues.findings")}
                  </h4>
                  <ul className="space-y-2" data-testid="explain-warnings">
                    {validation.warnings.map((w, i) => (
                      <li
                        key={i}
                        className="text-sm bg-warning/10 px-3 py-2 rounded-md border border-warning/20"
                      >
                        <div className="font-medium">{w.message}</div>
                        <div className="text-xs text-muted-foreground mt-0.5">
                          {w.suggestion}
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </CardContent>
          </Card>

      {showAnalysis && (
        // Analysis-block order mirrors BuildPortfolio.tsx (L1559-L1643) so the
        // user sees the same narrative flow whether they're picking buckets in
        // Build or describing their existing portfolio in Explain:
        //   Currency → (Look-Through block) → MonteCarlo → Metrics → Stress
        //     → HomeBias → Fees.
        // The two Build-only cards (ETF Implementation chooser, Learning
        // Insights) are intentionally absent — Explain doesn't pick ETFs and
        // doesn't synthesize learning copy.
        <div className="space-y-6" data-testid="explain-analysis">
          {/* Task #162 — "Current Allocation" mirrors Build's Target
           *  Asset Allocation card (donut + group summary + stacked bar
           *  + per-bucket table). Renders as the first analysis card so
           *  users see the structural composition before drilling into
           *  the risk/return story below. Honors the existing Look-
           *  Through toggle (decomposes pie + bar via the ETF holdings
           *  when ON; the table always shows the user's row buckets). */}
          <CurrentAllocationCard
            allocation={portfolio.allocation}
            etfImplementation={portfolio.etfImplementation}
            baseCurrency={state.baseCurrency}
            lookThroughView={state.lookThroughView}
          />

          <CurrencyOverview
            etfs={portfolio.etfImplementation}
            baseCurrency={state.baseCurrency}
            lookThroughView={state.lookThroughView}
          />

          {state.lookThroughView && portfolio.etfImplementation.length > 0 && (
            <>
              <GeoExposureMap
                etfs={portfolio.etfImplementation}
                baseCurrency={state.baseCurrency}
              />
              {/* Home Bias sits directly under the geo map so the qualitative
               *  verdict ("over/modest/under") reads as a natural follow-on
               *  to the visual regional breakdown. Same gating as Build:
               *  non-USD bases only, and the card itself returns null when
               *  look-through is OFF (which is already enforced by the
               *  enclosing block here). */}
              {state.baseCurrency !== "USD" && (
                <HomeBiasAnalysis
                  etfs={portfolio.etfImplementation}
                  baseCurrency={state.baseCurrency}
                  lookThroughView={state.lookThroughView}
                />
              )}
              <LookThroughAnalysis
                etfs={portfolio.etfImplementation}
                baseCurrency={state.baseCurrency}
              />
              <TopHoldings
                etfs={portfolio.etfImplementation}
                baseCurrency={state.baseCurrency}
              />
            </>
          )}

          {/* Monte Carlo Simulation (placed before Risk Metrics so the
           *  forward-looking distribution frames the backward-looking
           *  risk/return statistics that follow — same rationale as Build). */}
          <MonteCarloSimulation
            allocation={portfolio.allocation}
            horizonYears={state.horizon}
            baseCurrency={state.baseCurrency}
            hedged={state.hedged}
            etfImplementation={
              state.lookThroughView ? portfolio.etfImplementation : undefined
            }
            riskRegime={riskRegime}
            onRiskRegimeChange={setRiskRegime}
          />

          {/* Risk & Performance Metrics (Sharpe, Beta, Alpha, TE, Max DD,
           *  Frontier, Correlation). */}
          <PortfolioMetrics
            allocation={portfolio.allocation}
            baseCurrency={state.baseCurrency}
            etfImplementation={
              state.lookThroughView ? portfolio.etfImplementation : undefined
            }
            hedged={state.hedged}
            riskRegime={riskRegime}
            onRiskRegimeChange={setRiskRegime}
          />

          {/* Scenario Stress Test (deterministic historical-style shocks +
           *  reverse stress test). Mirrors Build's placement after the
           *  forward-looking Monte Carlo distribution so the user sees their
           *  actual ETF mix tested against past crises. */}
          <StressTest
            allocation={portfolio.allocation}
            baseCurrency={state.baseCurrency}
          />

          {/* Fee Estimator — last block, mirroring Build's placement after the
           *  risk/return story so total cost is the closing line. */}
          <FeeEstimator
            allocation={portfolio.allocation}
            horizonYears={state.horizon}
            baseCurrency={state.baseCurrency}
            hedged={state.hedged}
            etfImplementations={portfolio.etfImplementation}
          />

          {/* Task #183 — inline bottom-of-report CTA promoting the
           *  Explain → Compare handoff. Reuses the existing
           *  sendToCompare(slot) handler (same one wired to the
           *  editor-header dropdown) so the slot persistence /
           *  navigation contract is identical. Disabled mirrors
           *  `canSendToCompare` from the header button. */}
          <Card
            className="border-primary/30 bg-primary/5"
            data-testid="explain-next-cta"
          >
            <CardContent className="p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div className="space-y-1 min-w-0">
                <div className="text-sm font-semibold text-primary">
                  {t("explain.nextCta.title")}
                </div>
                <div className="text-xs text-muted-foreground">
                  {t("explain.nextCta.body")}
                </div>
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    size="sm"
                    className="shrink-0"
                    disabled={!canSendToCompare}
                    data-testid="explain-next-cta-button"
                  >
                    <Scale className="mr-1.5 h-3 w-3" />
                    {t("explain.btn.sendToCompare")}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    onSelect={() => sendToCompare("A")}
                    data-testid="explain-next-cta-slot-a"
                  >
                    {t("explain.btn.sendToCompare.slotA")}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={() => sendToCompare("B")}
                    data-testid="explain-next-cta-slot-b"
                  >
                    {t("explain.btn.sendToCompare.slotB")}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </CardContent>
          </Card>
        </div>
      )}
        </div>
      </div>

      {/* Task #161 — single ETFDetailsDialog mount controlled by
          `detailsEtf`, mirroring BuildPortfolio.tsx. Closing returns to
          Explain with no state loss (selections, weights, expanded
          groups all unchanged) since the dialog is purely presentational
          and lives outside the editor's tree. */}
      <ETFDetailsDialog
        etf={detailsEtf}
        open={!!detailsEtf}
        onOpenChange={(o) => {
          if (!o) setDetailsEtf(null);
        }}
      />
      {/* Task #227 — paste-to-import dialog. Mounted at the root so the
          Radix portal layers cleanly above the editor's bucket tree. */}
      <ImportPortfolioDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        onImport={replaceWithImportedRows}
        hasExistingPositions={state.positions.length > 0}
      />
    </div>
  );
}
