import { useEffect, useMemo, useState } from "react";
import {
adminApi,
type BulkBucketAlternativesResponse,
type CatalogSummary,
} from "@/lib/admin-api";
import { MAX_ALTERNATIVES_PER_BUCKET } from "@/lib/etfs";
import { useAdminT } from "@/lib/admin-i18n";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import {
Select,
SelectContent,
SelectItem,
SelectTrigger,
SelectValue,
} from "@/components/ui/select";
import { Layers, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { batchRowBadgeClass, batchRowLabel } from "./BatchHelpers";
import { BatchPreviewDisplay, BatchSubmitDisplay } from "./BatchDisplays";
import { PendingPrsCard } from "./PendingPrsCard";

type BatchRow = {
  // Local-only id so React keys stay stable when the operator removes
  // a row above another. Deliberately not sent to the server.
  uid: string;
  parentKey: string;
  isin: string;
  defaultExchange: "" | "LSE" | "XETRA" | "SIX" | "Euronext";
  comment: string;
};

function newBatchRow(): BatchRow {
  return {
    uid: Math.random().toString(36).slice(2, 10),
    parentKey: "",
    isin: "",
    defaultExchange: "",
    comment: "",
  };
}

type BatchLocalDiagnostic =
  | { kind: "incomplete" } // parentKey or ISIN not entered yet
  | { kind: "loading" } // catalog still fetching
  | { kind: "ok" }
  | {
      kind: "problem";
      status:
        | "invalid_parent_key"
        | "invalid_isin"
        | "parent_missing"
        | "duplicate_isin"
        | "cap_exceeded";
      message: string;
      conflict?: string;
    };

function diagnoseBatchRows(
  rows: BatchRow[],
  catalog: CatalogSummary | null,
): Map<string, BatchLocalDiagnostic> {
  const out = new Map<string, BatchLocalDiagnostic>();
  if (!catalog) {
    for (const r of rows) {
      const parentKey = r.parentKey.trim();
      const isin = r.isin.trim();
      out.set(
        r.uid,
        !parentKey || !isin ? { kind: "incomplete" } : { kind: "loading" },
      );
    }
    return out;
  }
  // Seed with everything currently in the catalog: every default ISIN +
  // every existing alternative.
  const usedIsins = new Map<string, string>(); // ISIN → "<parentKey>" or "<parentKey> alt N"
  const bucketAltCount = new Map<string, number>();
  for (const [k, e] of Object.entries(catalog)) {
    if (e.isin) usedIsins.set(e.isin.toUpperCase(), k);
    const alts = e.alternatives ?? [];
    for (let i = 0; i < alts.length; i++) {
      if (alts[i].isin)
        usedIsins.set(alts[i].isin.toUpperCase(), `${k} alt ${i + 1}`);
    }
    bucketAltCount.set(k, alts.length);
  }
  for (const r of rows) {
    const parentKey = r.parentKey.trim();
    const isinRaw = r.isin.trim();
    const isin = isinRaw.toUpperCase();
    if (!parentKey || !isin) {
      out.set(r.uid, { kind: "incomplete" });
      continue;
    }
    if (!/^[A-Z][A-Za-z0-9-]{2,40}$/.test(parentKey)) {
      out.set(r.uid, {
        kind: "problem",
        status: "invalid_parent_key",
        message: `parentKey "${parentKey}" doesn't match the catalog key format.`,
      });
      continue;
    }
    if (!/^[A-Z]{2}[A-Z0-9]{9}\d$/.test(isin)) {
      out.set(r.uid, {
        kind: "problem",
        status: "invalid_isin",
        message: `ISIN "${isinRaw}" is not a valid ISO 6166 code.`,
      });
      continue;
    }
    if (!catalog[parentKey]) {
      out.set(r.uid, {
        kind: "problem",
        status: "parent_missing",
        message: `Parent bucket "${parentKey}" does not exist in the catalog.`,
      });
      continue;
    }
    const conflict = usedIsins.get(isin);
    if (conflict) {
      out.set(r.uid, {
        kind: "problem",
        status: "duplicate_isin",
        message: `ISIN ${isin} is already used by "${conflict}".`,
        conflict,
      });
      continue;
    }
    if ((bucketAltCount.get(parentKey) ?? 0) >= MAX_ALTERNATIVES_PER_BUCKET) {
      out.set(r.uid, {
        kind: "problem",
        status: "cap_exceeded",
        message: `"${parentKey}" already has ${MAX_ALTERNATIVES_PER_BUCKET} alternatives (counting earlier rows in this batch).`,
      });
      continue;
    }
    usedIsins.set(isin, `${parentKey} (this batch)`);
    bucketAltCount.set(parentKey, (bucketAltCount.get(parentKey) ?? 0) + 1);
    out.set(r.uid, { kind: "ok" });
  }
  return out;
}

export function BatchAddAlternativesPanel({
  githubConfigured,
}: {
  githubConfigured: boolean;
}) {
  const { t, lang } = useAdminT();
  const [rows, setRows] = useState<BatchRow[]>(() => [
    newBatchRow(),
    newBatchRow(),
  ]);
  const [previewing, setPreviewing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [preview, setPreview] = useState<BulkBucketAlternativesResponse | null>(
    null,
  );
  const [submitResult, setSubmitResult] =
    useState<BulkBucketAlternativesResponse | null>(null);
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const [catalog, setCatalog] = useState<CatalogSummary | null>(null);
  const [catalogUnavailable, setCatalogUnavailable] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setCatalogUnavailable(false);
    void adminApi.bucketAlternatives().then(
      (r) => {
        if (cancelled) return;
        setCatalog(r.entries);
      },
      () => {
        if (cancelled) return;
        setCatalogUnavailable(true);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  function update(uid: string, patch: Partial<BatchRow>) {
    setRows((rs) => rs.map((r) => (r.uid === uid ? { ...r, ...patch } : r)));
  }
  function remove(uid: string) {
    setRows((rs) => (rs.length > 1 ? rs.filter((r) => r.uid !== uid) : rs));
  }
  function add() {
    setRows((rs) => [...rs, newBatchRow()]);
  }

  function buildPayload(): Array<{
    parentKey: string;
    isin: string;
    defaultExchange?: "LSE" | "XETRA" | "SIX" | "Euronext";
    comment?: string;
  }> {
    return rows
      .filter((r) => r.parentKey.trim() || r.isin.trim())
      .map((r) => ({
        parentKey: r.parentKey.trim(),
        isin: r.isin.trim().toUpperCase(),
        ...(r.defaultExchange ? { defaultExchange: r.defaultExchange } : {}),
        ...(r.comment.trim() ? { comment: r.comment.trim() } : {}),
      }));
  }

  async function runPreview() {
    const payload = buildPayload();
    if (payload.length === 0) {
      setErrMsg(
        t({
          de: "Keine Zeilen zum Vorschauen — fülle mindestens parentKey + ISIN aus.",
          en: "No rows to preview — fill at least one parentKey + ISIN.",
        }),
      );
      return;
    }
    setErrMsg(null);
    setPreviewing(true);
    setPreview(null);
    setSubmitResult(null);
    try {
      const r = await adminApi.bulkBucketAlternatives(payload, true);
      setPreview(r);
    } catch (e: unknown) {
      setErrMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setPreviewing(false);
    }
  }

  async function runSubmit() {
    const payload = buildPayload();
    if (payload.length === 0) {
      setErrMsg(
        t({
          de: "Keine Zeilen zum Absenden.",
          en: "No rows to submit.",
        }),
      );
      return;
    }
    setErrMsg(null);
    setSubmitting(true);
    setSubmitResult(null);
    try {
      const r = await adminApi.bulkBucketAlternatives(payload, false);
      setSubmitResult(r);
      setPreview(null);
      setRefreshKey((k) => k + 1);
      toast.success(
        t({
          de: `Batch-Pull-Request geöffnet: #${r.prNumber}`,
          en: `Batch pull request opened: #${r.prNumber}`,
        }),
      );
    } catch (e: unknown) {
      setErrMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  }

  const filledCount = rows.filter(
    (r) => r.parentKey.trim() && r.isin.trim(),
  ).length;

  const diagnostics = useMemo(
    () => diagnoseBatchRows(rows, catalog),
    [rows, catalog],
  );
  const problemCount = useMemo(() => {
    let n = 0;
    for (const d of diagnostics.values()) if (d.kind === "problem") n++;
    return n;
  }, [diagnostics]);
  const hasLocalProblem = problemCount > 0;

  return (
    <Card>
      <CardHeader className="space-y-1 pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Layers className="h-4 w-4" />
          {t({
            de: "Batch: Alternativen hinzufügen",
            en: "Batch-add alternatives",
          })}
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          {t({
            de: "Mehrere Alternativen in EINEM Pull Request. Dedup, Cap (≤2 pro Bucket) und Parent-Existenz werden über die ganze Liste geprüft. Look-through-Daten werden für jede neue Alternative best-effort gescraped und – sofern vorhanden – im selben Pull Request mitgeliefert (eine gemeinsame Änderung an etfs.ts und lookthrough.overrides.json).",
            en: "Queue N alternatives into ONE pull request. Dedup, per-bucket cap (≤2) and parent existence are checked across the whole list. Look-through data is best-effort scraped per row and — when available — bundled into the SAME pull request (a single commit touching both etfs.ts and lookthrough.overrides.json).",
          })}
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {!githubConfigured && (
          <Alert variant="destructive">
            <AlertTitle>
              {t({
                de: "GitHub nicht konfiguriert",
                en: "GitHub not configured",
              })}
            </AlertTitle>
            <AlertDescription className="text-xs">
              {t({
                de: "Setze GITHUB_PAT, GITHUB_OWNER und GITHUB_REPO am API-Server, um Batch-Submits zu erlauben. Vorschau funktioniert ohne GitHub.",
                en: "Set GITHUB_PAT, GITHUB_OWNER, GITHUB_REPO on the api-server to enable batch submit. Preview works without GitHub.",
              })}
            </AlertDescription>
          </Alert>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="text-left text-muted-foreground border-b">
                <th className="py-1.5 pr-2 font-medium w-[28%]">
                  {t({ de: "parentKey", en: "parentKey" })}
                </th>
                <th className="py-1.5 pr-2 font-medium w-[20%]">ISIN</th>
                <th className="py-1.5 pr-2 font-medium w-[14%]">
                  {t({ de: "Standard-Börse", en: "Default exchange" })}
                </th>
                <th className="py-1.5 pr-2 font-medium">
                  {t({ de: "Kommentar (optional)", en: "Comment (optional)" })}
                </th>
                <th className="py-1.5 w-8"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.uid} className="border-b last:border-b-0 align-top">
                  <td className="py-1.5 pr-2">
                    <Input
                      value={r.parentKey}
                      onChange={(e) =>
                        update(r.uid, { parentKey: e.target.value })
                      }
                      placeholder="Equity-USA"
                      className="h-8"
                    />
                  </td>
                  <td className="py-1.5 pr-2">
                    <Input
                      value={r.isin}
                      onChange={(e) =>
                        update(r.uid, {
                          isin: e.target.value.toUpperCase(),
                        })
                      }
                      placeholder="IE00B5BMR087"
                      className="h-8 font-mono"
                    />
                    {(() => {
                      const d = diagnostics.get(r.uid);
                      if (!d || d.kind === "incomplete") return null;
                      if (d.kind === "loading") {
                        return (
                          <div className="mt-1 text-[10px] text-muted-foreground">
                            {catalogUnavailable
                              ? t({
                                  de: "Katalog nicht verfügbar — Vorschau prüft serverseitig.",
                                  en: "Catalog unavailable — server-side preview will validate.",
                                })
                              : t({
                                  de: "Prüfe Katalog…",
                                  en: "Checking catalog…",
                                })}
                          </div>
                        );
                      }
                      if (d.kind === "ok") {
                        return (
                          <Badge
                            variant="outline"
                            className="mt-1 text-[10px] border-emerald-600 text-emerald-700 dark:text-emerald-400"
                            data-testid={`badge-batch-row-${r.uid}-ok`}
                          >
                            {t({
                              de: "Bereit für Vorschau",
                              en: "Ready for preview",
                            })}
                          </Badge>
                        );
                      }
                      return (
                        <div className="mt-1 space-y-0.5">
                          <Badge
                            variant="outline"
                            className={`text-[10px] ${batchRowBadgeClass(d.status)}`}
                            data-testid={`badge-batch-row-${r.uid}-${d.status}`}
                          >
                            {batchRowLabel(d.status, lang)}
                          </Badge>
                          <div className="text-[10px] text-muted-foreground leading-tight">
                            {d.conflict
                              ? t({
                                  de: `Konflikt mit ${d.conflict}`,
                                  en: `Conflicts with ${d.conflict}`,
                                })
                              : d.message}
                          </div>
                        </div>
                      );
                    })()}
                  </td>
                  <td className="py-1.5 pr-2">
                    <Select
                      value={r.defaultExchange || "_auto"}
                      onValueChange={(v) =>
                        update(r.uid, {
                          defaultExchange:
                            v === "_auto"
                              ? ""
                              : (v as BatchRow["defaultExchange"]),
                        })
                      }
                    >
                      <SelectTrigger className="h-8">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="_auto">
                          {t({ de: "Automatisch", en: "Automatic" })}
                        </SelectItem>
                        <SelectItem value="LSE">LSE</SelectItem>
                        <SelectItem value="XETRA">XETRA</SelectItem>
                        <SelectItem value="SIX">SIX</SelectItem>
                        <SelectItem value="Euronext">Euronext</SelectItem>
                      </SelectContent>
                    </Select>
                  </td>
                  <td className="py-1.5 pr-2">
                    <Input
                      value={r.comment}
                      onChange={(e) =>
                        update(r.uid, { comment: e.target.value })
                      }
                      placeholder={t({
                        de: "z. B. Tracking-Differenz, AUM-Hinweis",
                        en: "e.g. tracking-diff or AUM note",
                      })}
                      className="h-8"
                    />
                  </td>
                  <td className="py-1.5 align-middle">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => remove(r.uid)}
                      disabled={rows.length <= 1}
                      aria-label={t({ de: "Zeile entfernen", en: "Remove row" })}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={add}>
            <Plus className="h-3.5 w-3.5 mr-1.5" />
            {t({ de: "Zeile hinzufügen", en: "Add row" })}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void runPreview()}
            disabled={
              previewing ||
              submitting ||
              filledCount === 0 ||
              hasLocalProblem
            }
            data-testid="button-batch-preview"
          >
            {previewing
              ? t({ de: "Berechne Vorschau…", en: "Computing preview…" })
              : t({ de: "Vorschau", en: "Preview batch" })}
          </Button>
          <Button
            size="sm"
            onClick={() => void runSubmit()}
            disabled={
              submitting ||
              previewing ||
              filledCount === 0 ||
              !githubConfigured ||
              hasLocalProblem
            }
            data-testid="button-batch-submit"
          >
            {submitting
              ? t({ de: "Sende…", en: "Submitting…" })
              : t({ de: "Batch absenden", en: "Submit batch" })}
          </Button>
          <span className="text-xs text-muted-foreground">
            {t({
              de: `${filledCount} Zeilen mit parentKey + ISIN`,
              en: `${filledCount} rows with parentKey + ISIN`,
            })}
          </span>
          {hasLocalProblem && (
            <span
              className="text-xs text-amber-700 dark:text-amber-400"
              data-testid="text-batch-local-problem-hint"
            >
              {t({
                de: `${problemCount} Zeile${problemCount === 1 ? "" : "n"} mit Katalog-Konflikt — bitte vor der Vorschau korrigieren.`,
                en: `${problemCount} row${problemCount === 1 ? "" : "s"} blocked by the catalog — fix before previewing.`,
              })}
            </span>
          )}
        </div>

        {errMsg && (
          <Alert variant="destructive">
            <AlertDescription className="text-xs whitespace-pre-line">
              {errMsg}
            </AlertDescription>
          </Alert>
        )}

        {preview && (
          <BatchPreviewDisplay preview={preview} lang={lang} t={t} />
        )}
        {submitResult && (
          <BatchSubmitDisplay result={submitResult} lang={lang} t={t} />
        )}
        <Separator />
        <PendingPrsCard
          prefix="add-alt/bulk-"
          refreshKey={refreshKey}
          emptyHint={
            <span>
              {t({
                de: "Noch keine offenen Batch-Pull-Requests.",
                en: "No open batch pull requests.",
              })}
            </span>
          }
        />
      </CardContent>
    </Card>
  );
}
