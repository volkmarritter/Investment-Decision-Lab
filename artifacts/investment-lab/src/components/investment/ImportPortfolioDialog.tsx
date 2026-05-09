import { useMemo, useState } from "react";
import { Upload } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";

import {
  getBucketKeyForIsin,
  getInstrumentByIsin,
  inferAssetClassRegionFromInstrument,
} from "@/lib/etfs";
import { isValidIsin } from "@/lib/useEtfInfo";
import { parseDecimalInput } from "@/lib/manualWeights";
import type { PersonalPosition } from "@/lib/personalPortfolio";
import { useT } from "@/lib/i18n";

// One parsed text line. `error` is set when the line couldn't be turned
// into a (isin, weight) pair. Empty / comment lines are filtered out
// before this stage.
export interface ParsedImportLine {
  lineNo: number;
  raw: string;
  isin: string; // uppercased + trimmed; "" when invalid
  weight: number; // parsed weight in %; 0 when missing/invalid
  error?: "invalid-isin" | "invalid-weight";
}

export interface ImportLineMapping extends ParsedImportLine {
  // "catalog"          — ISIN is in the curated catalog AND assigned to
  //                      a bucket → row goes into that bucket.
  // "found-unassigned" — ISIN is in INSTRUMENTS but not slotted into any
  //                      bucket → manual row, seeded with name/currency
  //                      and a guessed assetClass/region.
  // "off-universe"     — ISIN parses as a valid ISIN but is not in the
  //                      catalog at all → manual row with default
  //                      Equity/Global meta.
  // "error"            — line had a parse error (invalid ISIN/weight).
  kind: "catalog" | "found-unassigned" | "off-universe" | "error";
  bucketKey?: string;
}

// Pure parser: split on first "/", trim, validate, parse weight via
// the same comma-decimal-aware helper the per-row weight inputs use.
// Empty lines and lines starting with `#` are skipped silently.
export function parseImportText(text: string): ParsedImportLine[] {
  const out: ParsedImportLine[] = [];
  const rawLines = text.split(/\r?\n/);
  for (let i = 0; i < rawLines.length; i++) {
    const raw = rawLines[i];
    const trimmed = raw.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    const lineNo = i + 1;
    const slashIdx = trimmed.indexOf("/");
    const isinPart =
      slashIdx === -1 ? trimmed : trimmed.slice(0, slashIdx);
    const weightPart =
      slashIdx === -1 ? "" : trimmed.slice(slashIdx + 1);
    const isin = isinPart.trim().toUpperCase();
    const isinOk = isValidIsin(isin);
    const weightTrim = weightPart.trim();
    let weight = 0;
    // Per task spec the input contract is strictly "ISIN / weight" per
    // line. A missing "/" or an empty weight side is therefore an
    // unparseable line, not a silent 0% row.
    let weightError = slashIdx === -1 || weightTrim === "";
    if (!weightError) {
      // Note: we deliberately do NOT use `parseDecimalInput(... min/max)`
      // here because it CLAMPS out-of-range values (e.g. 150 → 100).
      // For a paste-import we want strict validation: anything outside
      // [0..100] (or anything non-numeric) should be reported as a
      // per-line error, not silently coerced. We still round to 2dp
      // exactly like `parseDecimalInput` does.
      const normalised = weightTrim.replace(",", ".");
      const parsed = Number(normalised);
      if (
        !Number.isFinite(parsed) ||
        parsed < 0 ||
        parsed > 100 ||
        // Reject things like "1e2" / "+5" / trailing junk that
        // Number() would otherwise happily coerce/accept.
        !/^[+-]?\d+(\.\d+)?$/.test(normalised)
      ) {
        weightError = true;
      } else {
        weight = Math.round(parsed * 100) / 100;
      }
    }
    out.push({
      lineNo,
      raw: trimmed,
      isin: isinOk ? isin : "",
      weight,
      error: !isinOk
        ? "invalid-isin"
        : weightError
          ? "invalid-weight"
          : undefined,
    });
  }
  return out;
}

// Resolve each parsed line against the live catalog. Keeps the parser
// pure and easily unit-testable; the catalog lookup is the
// side-effecting half.
export function classifyImportLines(
  parsed: ParsedImportLine[],
): ImportLineMapping[] {
  return parsed.map((p) => {
    if (p.error || !p.isin) {
      return { ...p, kind: "error" as const };
    }
    const inst = getInstrumentByIsin(p.isin);
    if (!inst) return { ...p, kind: "off-universe" as const };
    const bk = getBucketKeyForIsin(p.isin);
    if (bk) return { ...p, kind: "catalog" as const, bucketKey: bk };
    return { ...p, kind: "found-unassigned" as const };
  });
}

// Build PersonalPosition rows ready to append. Mirrors the existing
// helpers in ExplainPortfolio.tsx (`pickIsinForRow`,
// `pickUnassignedInstrumentForRow`, `addManualPosition`) so the
// resulting rows behave identically once they land in state — the
// engine, look-through, and PositionRow rendering can't tell them
// apart from rows added one-by-one through the normal flow.
export function buildPositionsFromMapping(
  mapping: ImportLineMapping[],
): PersonalPosition[] {
  // Per task spec, manual rows split into two subgroups whose ORDER
  // matters: "found-unassigned" first, "off-universe" last, each
  // preserving input order within its subgroup. Catalog rows append
  // ahead of the manual subgroups in their original input order.
  const catalog: PersonalPosition[] = [];
  const foundUnassigned: PersonalPosition[] = [];
  const offUniverse: PersonalPosition[] = [];
  for (const m of mapping) {
    if (m.kind === "error") continue;
    if (m.kind === "catalog") {
      catalog.push({
        isin: m.isin,
        bucketKey: m.bucketKey!,
        weight: m.weight,
      });
      continue;
    }
    if (m.kind === "found-unassigned") {
      const inst = getInstrumentByIsin(m.isin)!;
      const guess = inferAssetClassRegionFromInstrument(inst);
      foundUnassigned.push({
        isin: m.isin,
        bucketKey: "",
        weight: m.weight,
        manualMeta: {
          assetClass: guess.assetClass,
          region: guess.region,
          name: inst.name,
          currency: inst.currency,
          terBps: inst.terBps,
        },
      });
      continue;
    }
    // off-universe
    offUniverse.push({
      isin: m.isin,
      bucketKey: "",
      weight: m.weight,
      manualMeta: { assetClass: "Equity", region: "Global" },
    });
  }
  return [...catalog, ...foundUnassigned, ...offUniverse];
}

export interface ImportSummary {
  parsed: number;
  catalog: number;
  unassigned: number;
  offUniverse: number;
  errors: number;
  totalWeight: number;
}

function summarize(mapping: ImportLineMapping[]): ImportSummary {
  let catalog = 0;
  let unassigned = 0;
  let offUniverse = 0;
  let errors = 0;
  let totalWeight = 0;
  for (const m of mapping) {
    if (m.kind === "catalog") catalog++;
    else if (m.kind === "found-unassigned") unassigned++;
    else if (m.kind === "off-universe") offUniverse++;
    else errors++;
    if (m.kind !== "error") totalWeight += m.weight;
  }
  return {
    parsed: mapping.length,
    catalog,
    unassigned,
    offUniverse,
    errors,
    totalWeight,
  };
}

interface ImportPortfolioDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImport: (rows: PersonalPosition[], summary: ImportSummary) => void;
}

export function ImportPortfolioDialog({
  open,
  onOpenChange,
  onImport,
}: ImportPortfolioDialogProps) {
  const { t } = useT();
  const [text, setText] = useState("");
  // Two-step error gate: when the paste contains any unparseable line,
  // the first click on Import only validates and surfaces the errors.
  // The user must then either fix the input (which clears
  // `errorsAcknowledged` because the textarea changed) or click the
  // explicit "Import anyway" button to commit the valid subset.
  const [errorsAcknowledged, setErrorsAcknowledged] = useState(false);

  const parsed = useMemo(() => parseImportText(text), [text]);
  const mapping = useMemo(() => classifyImportLines(parsed), [parsed]);
  const summary = useMemo(() => summarize(mapping), [mapping]);

  const importable = mapping.filter((m) => m.kind !== "error");
  const canImport = importable.length > 0;
  const hasErrors = summary.errors > 0;
  // First click with errors → validate-only (just acknowledge); next
  // click commits. No errors → first click commits directly.
  const blockedByErrors = hasErrors && !errorsAcknowledged;

  function handleTextChange(next: string) {
    setText(next);
    // Any edit invalidates a previous "Import anyway" acknowledgement
    // so the user sees the fresh error list and must reconfirm.
    if (errorsAcknowledged) setErrorsAcknowledged(false);
  }

  function handleImport() {
    if (blockedByErrors) {
      // Validate-only step: don't commit yet, just surface errors and
      // arm the "Import anyway" button.
      setErrorsAcknowledged(true);
      return;
    }
    const rows = buildPositionsFromMapping(mapping);
    onImport(rows, summary);
    setText("");
    setErrorsAcknowledged(false);
    onOpenChange(false);
  }

  function handleOpenChange(next: boolean) {
    if (!next) {
      setText("");
      setErrorsAcknowledged(false);
    }
    onOpenChange(next);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="max-w-xl"
        closeLabel={t("explain.import.close")}
        data-testid="explain-import-dialog"
      >
        <DialogHeader>
          <DialogTitle>{t("explain.import.title")}</DialogTitle>
          <DialogDescription>
            {t("explain.import.desc")}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <Textarea
            value={text}
            onChange={(e) => handleTextChange(e.target.value)}
            placeholder={t("explain.import.placeholder")}
            rows={8}
            spellCheck={false}
            autoCorrect="off"
            className="font-mono text-sm"
            data-testid="explain-import-textarea"
          />
          <p className="text-xs text-muted-foreground">
            {t("explain.import.help")}
          </p>

          {parsed.length > 0 && (
            <div
              className="space-y-2"
              data-testid="explain-import-preview"
            >
              <div className="flex flex-wrap gap-1.5 text-xs">
                <Badge variant="outline">
                  {t("explain.import.summary.parsed", {
                    n: summary.parsed,
                  })}
                </Badge>
                {summary.catalog > 0 && (
                  <Badge variant="secondary">
                    {t("explain.import.summary.catalog", {
                      n: summary.catalog,
                    })}
                  </Badge>
                )}
                {summary.unassigned > 0 && (
                  <Badge variant="secondary">
                    {t("explain.import.summary.unassigned", {
                      n: summary.unassigned,
                    })}
                  </Badge>
                )}
                {summary.offUniverse > 0 && (
                  <Badge variant="secondary">
                    {t("explain.import.summary.offUniverse", {
                      n: summary.offUniverse,
                    })}
                  </Badge>
                )}
                {summary.errors > 0 && (
                  <Badge variant="destructive">
                    {t("explain.import.summary.errors", {
                      n: summary.errors,
                    })}
                  </Badge>
                )}
              </div>

              {summary.parsed > 0 &&
                Math.abs(summary.totalWeight - 100) > 0.01 && (
                  <Alert>
                    <AlertDescription className="text-xs">
                      {t("explain.import.warning.sumNot100", {
                        sum: summary.totalWeight.toFixed(1),
                      })}
                    </AlertDescription>
                  </Alert>
                )}

              {summary.errors > 0 && (
                <ul
                  className="text-xs text-destructive space-y-0.5 max-h-28 overflow-auto"
                  data-testid="explain-import-errors"
                >
                  {mapping
                    .filter((m) => m.kind === "error")
                    .map((m) => (
                      <li key={m.lineNo} className="font-mono">
                        {t("explain.import.lineErr", {
                          line: m.lineNo,
                          raw: m.raw,
                          reason:
                            m.error === "invalid-weight"
                              ? t("explain.import.err.invalidWeight")
                              : t("explain.import.err.invalidIsin"),
                        })}
                      </li>
                    ))}
                </ul>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => handleOpenChange(false)}
            data-testid="explain-import-cancel"
          >
            {t("explain.import.cancel")}
          </Button>
          <Button
            type="button"
            onClick={handleImport}
            disabled={!canImport && !hasErrors}
            data-testid="explain-import-submit"
            variant={blockedByErrors ? "secondary" : "default"}
          >
            <Upload className="mr-1.5 h-4 w-4" />
            {blockedByErrors
              ? t("explain.import.submit.validate")
              : hasErrors && errorsAcknowledged
                ? t("explain.import.submit.anyway", {
                    n: importable.length,
                  })
                : t("explain.import.submit", { n: importable.length })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
