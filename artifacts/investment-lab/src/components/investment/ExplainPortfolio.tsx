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
} from "lucide-react";

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

const STORAGE_KEY = "investment-lab.explainPortfolio.v1";

interface PersistedState {
  v: 1;
  baseCurrency: BaseCurrency;
  riskAppetite: RiskAppetite;
  horizon: number;
  hedged: boolean;
  lookThroughView: boolean;
  positions: PersonalPosition[];
}

const DEFAULT_STATE: PersistedState = {
  v: 1,
  baseCurrency: "USD",
  riskAppetite: "Moderate",
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
}

function IsinPicker({ value, onPick, excludeIsins, testId }: IsinPickerProps) {
  const { t, lang } = useT();
  const [open, setOpen] = useState(false);
  const all = useMemo(() => listInstruments(), []);

  const candidates = useMemo(() => {
    return all.filter((i) => !excludeIsins.has(i.isin) || i.isin === value);
  }, [all, excludeIsins, value]);

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

  useEffect(() => {
    saveState(state);
  }, [state]);

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

  function addPosition() {
    setState((s) => ({ ...s, positions: [...s.positions, { isin: "", bucketKey: "", weight: 0 }] }));
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



  const groupedRowIndices = useMemo(() => {
    const m = new Map<string, number[]>();
    state.positions.forEach((p, i) => {
      let key: string;
      if (p.manualMeta) key = "(manual)";
      else if (p.isin && p.bucketKey) key = p.bucketKey;
      else key = "(unassigned)";
      const arr = m.get(key) ?? [];
      arr.push(i);
      m.set(key, arr);
    });
    const ordered: Array<[string, number[]]> = [];
    for (const k of ALL_BUCKET_KEYS) if (m.has(k)) ordered.push([k, m.get(k)!]);
    if (m.has("(manual)")) ordered.push(["(manual)", m.get("(manual)")!]);
    if (m.has("(unassigned)")) ordered.push(["(unassigned)", m.get("(unassigned)")!]);
    return ordered;
  }, [state.positions]);

  function bucketSum(indices: number[]): number {
    let s = 0;
    for (const i of indices) s += state.positions[i].weight;
    return Math.round(s * 10) / 10;
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
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={addPosition}
                    className="h-8 text-xs"
                    data-testid="explain-add-row"
                  >
                    <Plus className="mr-1.5 h-3 w-3" />
                    {t("explain.btn.addEtf")}
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-5">
              {state.positions.length === 0 && (
                <div className="rounded border border-dashed p-6 text-center text-sm text-muted-foreground">
                  {t("explain.empty.positions")}
                </div>
              )}

              {groupedRowIndices.map(([bucketKey, indices]) => {
                const meta = bucketKey === "(unassigned)" || bucketKey === "(manual)" ? null : getBucketMeta(bucketKey);
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
                  : bucketKey === "(manual)"
                  ? lang === "de"
                    ? "Manuell erfasste Positionen"
                    : "Manually entered positions"
                  : t("explain.positions.unassigned");
                const sum = bucketSum(indices);
                return (
                  <div key={bucketKey} className="space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-semibold uppercase tracking-wide text-muted-foreground">
                        {heading}
                      </span>
                      <span className="font-mono text-muted-foreground">
                        {sum.toFixed(1)}%
                      </span>
                    </div>
                    <div className="space-y-2">
                      {indices.map((i) => (
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
                );
              })}

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
        </div>
      )}
    </div>
  );
}
