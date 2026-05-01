// FileCompareViewer — per-file Replit (workspace) vs GitHub-main diff.
//
// Operator use case: the WorkspaceSyncPanel above (same /admin/operations/sync
// route) reports HOW MANY commits the local workspace is behind/ahead of
// origin/main, but not WHICH FIELDS changed in the cron-managed override
// files. This component fills that gap by fetching, per file, both sides
// of the comparison plus a server-computed structured patch, and rendering
// it as a true two-column side-by-side view (no client-side diff library).
//
// Allow-list (3 files): kept in sync with FILE_COMPARE_TARGETS in
// artifacts/api-server/src/routes/admin.ts. Adding a fourth file requires
// touching both ends.

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  adminApi,
  type FileCompareFileId,
  type FileCompareHunk,
  type FileCompareResponse,
} from "@/lib/admin-api";
import { useAdminT } from "@/lib/admin-i18n";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ExternalLink, GitCompare, RefreshCw } from "lucide-react";

const FILE_OPTIONS: ReadonlyArray<{
  id: FileCompareFileId;
  label: string;
  hint: { de: string; en: string };
}> = [
  {
    id: "etfs-overrides",
    label: "etfs.overrides.json",
    hint: {
      de: "Cron-gepflegte ETF-Stammdaten-Overrides (TER, AUM, Inception, …).",
      en: "Cron-managed ETF master-data overrides (TER, AUM, inception, …).",
    },
  },
  {
    id: "lookthrough-overrides",
    label: "lookthrough.overrides.json",
    hint: {
      de: "Cron-gepflegter Look-Through-Datenpool (Top-Holdings, Geo, Sektor).",
      en: "Cron-managed look-through data pool (top holdings, geo, sector).",
    },
  },
  {
    id: "etfs-ts",
    label: "etfs.ts",
    hint: {
      de: "Hand-kuratierter ETF-Katalog (Buckets, Default-Tickers, Listings).",
      en: "Hand-curated ETF catalog (buckets, default tickers, listings).",
    },
  },
];

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

// Pair a hunk's "-" lines with its "+" lines so the side-by-side renderer
// can place removals on the left next to their corresponding additions on
// the right. Algorithm: walk the hunk lines in order, accumulating "-"
// runs and "+" runs; when the run breaks (context " " or end-of-hunk),
// flush the buffers — pair index-by-index, pad the shorter side with
// blanks. Context lines pass through paired with themselves.
type SbsRow =
  | {
      kind: "context";
      oldLineNo: number;
      newLineNo: number;
      text: string;
    }
  | {
      kind: "change";
      oldLineNo: number | null;
      oldText: string | null; // null = pad/blank
      newLineNo: number | null;
      newText: string | null; // null = pad/blank
    };

function hunkToSbsRows(hunk: FileCompareHunk): SbsRow[] {
  const rows: SbsRow[] = [];
  let oldNo = hunk.oldStart;
  let newNo = hunk.newStart;
  let removed: { lineNo: number; text: string }[] = [];
  let added: { lineNo: number; text: string }[] = [];

  const flush = () => {
    const max = Math.max(removed.length, added.length);
    for (let i = 0; i < max; i++) {
      const r = removed[i];
      const a = added[i];
      rows.push({
        kind: "change",
        oldLineNo: r ? r.lineNo : null,
        oldText: r ? r.text : null,
        newLineNo: a ? a.lineNo : null,
        newText: a ? a.text : null,
      });
    }
    removed = [];
    added = [];
  };

  for (const raw of hunk.lines) {
    const sigil = raw.charAt(0);
    const text = raw.slice(1);
    if (sigil === "\\") {
      // "\ No newline at end of file" — purely informational, skip the
      // visual row to avoid noise. The byte-size badge on the header
      // already conveys the byte-level difference.
      continue;
    }
    if (sigil === "-") {
      removed.push({ lineNo: oldNo++, text });
    } else if (sigil === "+") {
      added.push({ lineNo: newNo++, text });
    } else {
      // Context line — flush any pending change buffers first so the
      // side-by-side ordering stays faithful to the patch.
      flush();
      rows.push({
        kind: "context",
        oldLineNo: oldNo++,
        newLineNo: newNo++,
        text,
      });
    }
  }
  flush();
  return rows;
}

export function FileCompareViewer() {
  const { t, lang } = useAdminT();
  const [fileId, setFileId] = useState<FileCompareFileId>("etfs-overrides");
  const [data, setData] = useState<FileCompareResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (id: FileCompareFileId) => {
    setLoading(true);
    setError(null);
    setData(null);
    try {
      const res = await adminApi.fileCompare(id);
      setData(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(fileId);
  }, [fileId, load]);

  const activeOption = useMemo(
    () => FILE_OPTIONS.find((o) => o.id === fileId) ?? FILE_OPTIONS[0],
    [fileId],
  );

  const sbsHunks = useMemo(
    () =>
      data && !data.identical && !data.truncated
        ? data.hunks.map((h) => ({
            header: `@@ -${h.oldStart},${h.oldLines} +${h.newStart},${h.newLines} @@`,
            rows: hunkToSbsRows(h),
          }))
        : [],
    [data],
  );

  return (
    <Card data-testid="file-compare-card">
      <CardHeader className="flex flex-row items-start justify-between gap-3 pb-3">
        <div className="space-y-1">
          <CardTitle className="flex items-center gap-2 text-base">
            <GitCompare className="h-4 w-4" />
            {t({
              de: "Datei vergleichen: Replit ↔ GitHub main",
              en: "File compare: Replit ↔ GitHub main",
            })}
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            {t({
              de: "Zeigt für die drei vom Cron-Job gepflegten Override-Dateien (plus den Hand-Katalog) den Roh-Inhalt aus dem Workspace neben dem aktuellen Stand auf GitHub main — Zeile für Zeile.",
              en: "For the three cron-managed override files (plus the hand-curated catalog) shows the raw workspace bytes next to the current GitHub-main bytes — line by line.",
            })}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void load(fileId)}
          disabled={loading}
          data-testid="button-file-compare-refresh"
        >
          <RefreshCw
            className={"h-3.5 w-3.5 mr-1.5" + (loading ? " animate-spin" : "")}
          />
          {t({ de: "Neu laden", en: "Reload" })}
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        <div
          className="flex flex-wrap gap-1.5"
          data-testid="file-compare-selector"
        >
          {FILE_OPTIONS.map((opt) => {
            const active = opt.id === fileId;
            return (
              <Button
                key={opt.id}
                variant={active ? "default" : "outline"}
                size="sm"
                onClick={() => setFileId(opt.id)}
                disabled={loading && active}
                data-testid={`button-file-compare-pick-${opt.id}`}
                title={lang === "de" ? opt.hint.de : opt.hint.en}
              >
                {opt.label}
              </Button>
            );
          })}
        </div>

        {error && (
          <Alert variant="destructive">
            <AlertTitle>
              {t({
                de: "Vergleich nicht möglich",
                en: "Compare unavailable",
              })}
            </AlertTitle>
            <AlertDescription className="text-xs break-words">
              {error}
            </AlertDescription>
          </Alert>
        )}

        {loading && !data && (
          <p className="text-xs text-muted-foreground">
            {t({ de: "Lade Vergleich …", en: "Loading compare …" })}
          </p>
        )}

        {data && (
          <>
            <div
              className="rounded border bg-muted/30 p-3 text-xs space-y-2"
              data-testid="file-compare-header"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <code className="font-mono text-[11px]">{data.repoPath}</code>
                {data.identical ? (
                  <Badge
                    variant="outline"
                    className="border-emerald-600 text-emerald-700 dark:text-emerald-400"
                    data-testid="file-compare-status-pill"
                  >
                    {t({ de: "identisch", en: "identical" })}
                  </Badge>
                ) : data.truncated ? (
                  <Badge
                    variant="outline"
                    className="border-amber-600 text-amber-700 dark:text-amber-400"
                    data-testid="file-compare-status-pill"
                  >
                    {t({
                      de: "Datei zu groß",
                      en: "file too large",
                    })}
                  </Badge>
                ) : (
                  <Badge
                    variant="default"
                    className="bg-amber-500 hover:bg-amber-500/90"
                    data-testid="file-compare-status-pill"
                  >
                    {data.hunks.length}{" "}
                    {t({
                      de: data.hunks.length === 1 ? "Hunk" : "Hunks",
                      en: data.hunks.length === 1 ? "hunk" : "hunks",
                    })}
                  </Badge>
                )}
              </div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-muted-foreground">
                <div className="flex items-baseline gap-2">
                  <span className="font-medium text-foreground">Replit</span>
                  <span className="tabular-nums">
                    {formatBytes(data.workspace.sizeBytes)}
                  </span>
                </div>
                <div className="flex items-baseline gap-2">
                  <span className="font-medium text-foreground">
                    GitHub {data.baseBranch}
                  </span>
                  <span className="tabular-nums">
                    {formatBytes(data.github.sizeBytes)}
                  </span>
                  {data.github.htmlUrl && (
                    <a
                      href={data.github.htmlUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-0.5 text-[10px] hover:underline"
                      title={data.github.sha}
                      data-testid="link-file-compare-github"
                    >
                      <code className="font-mono">
                        {data.github.sha.slice(0, 7)}
                      </code>
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </div>
              </div>
              {data.message && (
                <p className="text-amber-700 dark:text-amber-400">
                  {data.message}
                </p>
              )}
            </div>

            {data.identical && (
              <p
                className="text-xs text-muted-foreground"
                data-testid="file-compare-identical-note"
              >
                {t({
                  de: "Workspace und GitHub main sind byte-identisch — keine Unterschiede.",
                  en: "Workspace and GitHub main are byte-identical — no differences.",
                })}
              </p>
            )}

            {!data.identical && !data.truncated && sbsHunks.length > 0 && (
              <div
                className="rounded border overflow-hidden"
                data-testid="file-compare-sbs"
              >
                <div className="grid grid-cols-2 bg-muted/40 text-[11px] font-medium border-b">
                  <div className="px-2 py-1 border-r">
                    {t({
                      de: "GitHub main (alt)",
                      en: "GitHub main (old)",
                    })}
                  </div>
                  <div className="px-2 py-1">
                    {t({
                      de: "Replit Workspace (neu)",
                      en: "Replit workspace (new)",
                    })}
                  </div>
                </div>
                <div className="max-h-[600px] overflow-auto font-mono text-[11px] leading-tight">
                  {sbsHunks.map((h, hi) => (
                    <div key={hi}>
                      <div
                        className="grid grid-cols-1 bg-sky-50 dark:bg-sky-950/40 text-sky-900 dark:text-sky-200 px-2 py-0.5 border-b border-t border-sky-200 dark:border-sky-900"
                        data-testid={`file-compare-hunk-header-${hi}`}
                      >
                        <code>{h.header}</code>
                      </div>
                      {h.rows.map((row, ri) =>
                        row.kind === "context" ? (
                          <div
                            key={ri}
                            className="grid grid-cols-2 hover:bg-muted/30"
                            data-testid="file-compare-row-context"
                          >
                            <SbsCell
                              lineNo={row.oldLineNo}
                              text={row.text}
                              tone="context"
                              border
                            />
                            <SbsCell
                              lineNo={row.newLineNo}
                              text={row.text}
                              tone="context"
                            />
                          </div>
                        ) : (
                          <div
                            key={ri}
                            className="grid grid-cols-2"
                            data-testid="file-compare-row-change"
                          >
                            <SbsCell
                              lineNo={row.oldLineNo}
                              text={row.oldText}
                              tone={row.oldText === null ? "blank" : "removed"}
                              border
                            />
                            <SbsCell
                              lineNo={row.newLineNo}
                              text={row.newText}
                              tone={row.newText === null ? "blank" : "added"}
                            />
                          </div>
                        ),
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {data.truncated && data.github.htmlUrl && (
              <p className="text-xs">
                <a
                  href={data.github.htmlUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 hover:underline"
                  data-testid="link-file-compare-github-fallback"
                >
                  {t({
                    de: "Auf GitHub öffnen",
                    en: "Open on GitHub",
                  })}
                  <ExternalLink className="h-3 w-3" />
                </a>
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function SbsCell({
  lineNo,
  text,
  tone,
  border,
}: {
  lineNo: number | null;
  text: string | null;
  tone: "context" | "removed" | "added" | "blank";
  border?: boolean;
}) {
  const toneClass =
    tone === "removed"
      ? "bg-rose-50 dark:bg-rose-950/40"
      : tone === "added"
        ? "bg-emerald-50 dark:bg-emerald-950/40"
        : tone === "blank"
          ? "bg-muted/40"
          : "";
  const sigil = tone === "removed" ? "-" : tone === "added" ? "+" : " ";
  return (
    <div
      className={`flex ${toneClass} ${border ? "border-r" : ""}`}
      data-testid={
        tone === "removed"
          ? `file-compare-cell-removed-${lineNo ?? "blank"}`
          : tone === "added"
            ? `file-compare-cell-added-${lineNo ?? "blank"}`
            : undefined
      }
    >
      <span className="select-none w-10 shrink-0 px-1 text-right text-muted-foreground tabular-nums border-r">
        {lineNo ?? ""}
      </span>
      <span className="select-none w-3 shrink-0 px-0.5 text-muted-foreground">
        {text === null ? "" : sigil}
      </span>
      <pre className="m-0 px-1 whitespace-pre-wrap break-all flex-1">
        {text ?? ""}
      </pre>
    </div>
  );
}
