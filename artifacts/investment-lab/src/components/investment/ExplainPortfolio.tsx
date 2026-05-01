// Explain My Portfolio — bring-your-own-ETFs workspace.
// User picks ISINs + weights; the synthesizer feeds the standard analysis cards.
// State persists to localStorage["investment-lab.explainPortfolio.v1"].

import { useEffect, useMemo, useState } from "react";
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
} from "@/lib/etfs";
import {
  PersonalPosition,
  normalizeWeights,
  runExplainValidation,
  synthesizePersonalPortfolio,
} from "@/lib/personalPortfolio";
import { parseDecimalInput } from "@/lib/manualWeights";
import type { RiskRegime } from "@/lib/metrics";
import { useT } from "@/lib/i18n";

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
  type CompareSlotName,
} from "@/lib/explainCompare";
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
              if (
                p.manualMeta &&
                typeof p.manualMeta === "object" &&
                typeof p.manualMeta.assetClass === "string" &&
                typeof p.manualMeta.region === "string"
              ) {
                out.manualMeta = {
                  assetClass: p.manualMeta.assetClass,
                  region: p.manualMeta.region,
                  ...(typeof p.manualMeta.name === "string" ? { name: p.manualMeta.name } : {}),
                  ...(typeof p.manualMeta.currency === "string" ? { currency: p.manualMeta.currency } : {}),
                  ...(typeof p.manualMeta.terBps === "number" ? { terBps: p.manualMeta.terBps } : {}),
                };
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
                        ? " (gehedgt)"
                        : " (hedged)"
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
                      <div className="flex flex-col gap-0.5 min-w-0">
                        <span className="text-xs font-medium truncate">{r.name}</span>
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
  rowIndex: number;
}

const MANUAL_ASSET_CLASSES = [
  "Equity",
  "Fixed Income",
  "Real Estate",
  "Commodities",
  "Digital Assets",
  "Cash",
];
const MANUAL_REGIONS = [
  "Global",
  "USA",
  "Europe",
  "Switzerland",
  "Emerging Markets",
  "Japan",
  "Asia Pacific ex-Japan",
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
  rowIndex,
}: PositionRowProps) {
  const isManual = !!position.manualMeta;
  return (
    <div
      className="space-y-2"
      data-testid={`explain-row-${rowIndex}`}
    >
      <div className="grid grid-cols-[1fr_5.5rem_2rem] gap-2 items-center">
        {isManual ? (
          <Input
            type="text"
            placeholder="ISIN (e.g. IE00B5BMR087)"
            className="h-9 text-sm font-mono"
            value={position.isin}
            onChange={(e) => onManualIsinChange(e.target.value.trim().toUpperCase())}
            aria-label="manual ISIN"
            data-testid={`explain-manual-isin-${rowIndex}`}
          />
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
      {isManual && position.manualMeta && (
        <div className="grid grid-cols-2 gap-2 pl-1">
          <Select
            value={position.manualMeta.assetClass}
            onValueChange={(v) => onManualMetaChange("assetClass", v)}
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
        </div>
      )}
    </div>
  );
}

export function ExplainPortfolio() {
  const { t, lang } = useT();

  const [state, setState] = useState<PersistedState>(() => loadState());



  const [weightDrafts, setWeightDrafts] = useState<string[]>(() =>
    state.positions.map((p) => String(p.weight)),
  );

  const [riskRegime, setRiskRegime] = useState<RiskRegime>("normal");

  // Per-asset-class expand override. `undefined` for an asset class means
  // "use the smart default" (open iff any bucket inside it has a position).
  // Once the user clicks the chevron the explicit boolean sticks for the
  // session, so adding/removing a position later doesn't reflow the tree
  // out from under them.
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});

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

  function setManualIsin(index: number, isin: string) {
    setState((s) => ({
      ...s,
      positions: s.positions.map((p, i) => (i === index ? { ...p, isin } : p)),
    }));
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
        return { ...p, manualMeta: { ...cur, [field]: value } };
      }),
    }));
  }

  function resetAll() {
    setState({ ...DEFAULT_STATE });
    setWeightDrafts([]);
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

  const portfolio = useMemo(
    () =>
      synthesizePersonalPortfolio(
        state.positions.filter((p) => !!p.isin && p.weight > 0),
        state.baseCurrency,
        lang,
      ),
    [state.positions, state.baseCurrency, lang],
  );

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

  // Unassigned tail-group: non-manual rows whose `bucketKey` is empty OR
  // points at a bucket the catalog has since dropped/renamed. Both must
  // surface so the user can re-bucket or delete them; otherwise persisted
  // workspaces silently lose visibility on those positions across catalog
  // updates.
  const unassignedRowIndices = useMemo(
    () =>
      state.positions
        .map((p, i) =>
          !p.manualMeta && (!p.bucketKey || !validBucketKeys.has(p.bucketKey))
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
    const flags = `${
      meta.hedged ? (lang === "de" ? " (gehedgt)" : " (hedged)") : ""
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

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] gap-6">

        <div className="space-y-6">
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
                <div className="flex gap-2 flex-wrap justify-end">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={resetAll}
                    className="h-8 text-xs"
                    data-testid="explain-reset"
                  >
                    <RotateCcw className="mr-1.5 h-3 w-3" />
                    {t("explain.btn.reset")}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={addManualPosition}
                    className="h-8 text-xs"
                    data-testid="explain-add-manual"
                  >
                    <Plus className="mr-1.5 h-3 w-3" />
                    {t("explain.btn.addManual")}
                  </Button>
                </div>
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
                      variant="outline"
                      size="sm"
                      className="h-8 text-xs w-full sm:w-auto"
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
                      />
                    ))}
                  </div>
                </div>
              )}

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


        <div className="space-y-6">
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
        </div>
      </div>

      {showAnalysis && (
        <div className="space-y-6" data-testid="explain-analysis">
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

          <FeeEstimator
            allocation={portfolio.allocation}
            horizonYears={state.horizon}
            baseCurrency={state.baseCurrency}
            hedged={state.hedged}
            etfImplementations={portfolio.etfImplementation}
          />

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

          {/* Scenario Stress Test (deterministic historical-style shocks +
           *  reverse stress test). Mirrors Build's placement after the
           *  forward-looking Monte Carlo distribution so the user sees their
           *  actual ETF mix tested against past crises. */}
          <StressTest
            allocation={portfolio.allocation}
            baseCurrency={state.baseCurrency}
          />

          {/* Home Bias (non-USD bases only — same gating as Build, since the
           *  framing of "home" only makes sense outside the global default). */}
          {state.baseCurrency !== "USD" && (
            <HomeBiasAnalysis
              etfs={portfolio.etfImplementation}
              baseCurrency={state.baseCurrency}
            />
          )}
        </div>
      )}
    </div>
  );
}
