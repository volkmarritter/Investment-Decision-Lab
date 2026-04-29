// ----------------------------------------------------------------------------
// BatchDisplays — UnifiedDiffView + BatchPreviewDisplay + BatchSubmitDisplay
// + BatchOutcomeTable. Pure presentational helpers for the batch-add panel.
// ----------------------------------------------------------------------------

import type {
BulkAltRowOutcome,
BulkBucketAlternativesResponse,
} from "@/lib/admin-api";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { ExternalLink, GitPullRequest } from "lucide-react";
import {
batchRowBadgeClass,
batchRowLabel,
lookthroughStatusLabel,
} from "./BatchHelpers";

// Render a server-supplied unified-diff string with +/- line colouring.
// We deliberately render verbatim (one <span> per line) instead of pulling
// in a syntax-highlighting lib — the Pull Request view on GitHub is the canonical
// source; this is just a sanity-check before the operator commits.
export function UnifiedDiffView({
  diff,
  emptyLabel,
}: {
  diff: string;
  emptyLabel: string;
}) {
  if (!diff.trim()) {
    return (
      <pre className="max-h-64 overflow-auto rounded bg-background p-2 font-mono text-[10px] leading-tight border text-muted-foreground">
        {emptyLabel}
      </pre>
    );
  }
  const lines = diff.split("\n");
  return (
    <pre className="max-h-96 overflow-auto rounded bg-background p-2 font-mono text-[10px] leading-tight border">
      {lines.map((line, i) => {
        let cls = "";
        if (line.startsWith("@@")) {
          cls = "text-blue-700 dark:text-blue-400 font-semibold";
        } else if (line.startsWith("+++") || line.startsWith("---")) {
          cls = "text-muted-foreground font-semibold";
        } else if (line.startsWith("+")) {
          cls =
            "bg-emerald-100/60 dark:bg-emerald-950/40 text-emerald-900 dark:text-emerald-200";
        } else if (line.startsWith("-")) {
          cls =
            "bg-rose-100/60 dark:bg-rose-950/40 text-rose-900 dark:text-rose-200";
        }
        return (
          <span key={i} className={`block ${cls}`}>
            {line || "\u00A0"}
          </span>
        );
      })}
    </pre>
  );
}

export function BatchPreviewDisplay({
  preview,
  lang,
  t,
}: {
  preview: BulkBucketAlternativesResponse;
  lang: "de" | "en";
  t: (s: { de: string; en: string }) => string;
}) {
  const wouldAdd = preview.summary.wouldAdd ?? 0;
  const wouldSkip = preview.summary.wouldSkip ?? 0;
  const wouldScrape = preview.summary.wouldScrapeLookthrough ?? 0;
  return (
    <div className="rounded border bg-muted/30 p-3 space-y-3">
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        <Badge variant="outline">
          {t({ de: "Vorschau", en: "Preview" })}
        </Badge>
        <Badge
          variant="outline"
          className="border-emerald-600 text-emerald-700 dark:text-emerald-400"
        >
          {wouldAdd} {t({ de: "wird hinzugefügt", en: "will add" })}
        </Badge>
        {wouldSkip > 0 && (
          <Badge
            variant="outline"
            className="border-amber-600 text-amber-700 dark:text-amber-400"
          >
            {wouldSkip} {t({ de: "übersprungen", en: "skipped" })}
          </Badge>
        )}
        <Badge variant="outline">
          {wouldScrape}{" "}
          {t({
            de: "look-through-Scrapes durchgeführt",
            en: "look-through scrapes performed",
          })}
        </Badge>
      </div>
      <BatchOutcomeTable rows={preview.perRow} lang={lang} t={t} />
      {preview.etfs && (
        <details className="text-xs" open>
          <summary className="cursor-pointer text-muted-foreground font-semibold">
            {t({
              de: `Diff: ${preview.etfs.path}`,
              en: `Diff: ${preview.etfs.path}`,
            })}
          </summary>
          <div className="mt-2">
            <UnifiedDiffView
              diff={preview.etfs.diff}
              emptyLabel={t({
                de: "(Keine Änderungen — alle Zeilen würden übersprungen.)",
                en: "(No changes — every row would be skipped.)",
              })}
            />
          </div>
        </details>
      )}
      {preview.lookthrough && (
        <details className="text-xs" open={preview.lookthrough.changed}>
          <summary className="cursor-pointer text-muted-foreground font-semibold">
            {t({
              de: `Diff: ${preview.lookthrough.path}`,
              en: `Diff: ${preview.lookthrough.path}`,
            })}
          </summary>
          <div className="mt-2">
            <UnifiedDiffView
              diff={preview.lookthrough.diff}
              emptyLabel={
                preview.lookthrough.alreadyPresent.length > 0
                  ? t({
                      de: `(Keine Änderungen — Look-through-Daten für alle ${preview.lookthrough.alreadyPresent.length} ISINs bereits vorhanden.)`,
                      en: `(No changes — look-through data for all ${preview.lookthrough.alreadyPresent.length} ISINs already covered.)`,
                    })
                  : t({
                      de: "(Keine Änderungen.)",
                      en: "(No changes.)",
                    })
              }
            />
            {preview.lookthrough.wouldAddIsins.length > 0 && (
              <div className="mt-2 text-muted-foreground">
                {t({
                  de: `Hinzuzufügen (${preview.lookthrough.wouldAddIsins.length}):`,
                  en: `Will add (${preview.lookthrough.wouldAddIsins.length}):`,
                })}{" "}
                {preview.lookthrough.wouldAddIsins
                  .map((r) => `${r.isin}${r.name ? ` (${r.name})` : ""}`)
                  .join(", ")}
              </div>
            )}
          </div>
        </details>
      )}
    </div>
  );
}

export function BatchSubmitDisplay({
  result,
  lang,
  t,
}: {
  result: BulkBucketAlternativesResponse;
  lang: "de" | "en";
  t: (s: { de: string; en: string }) => string;
}) {
  return (
    <div className="rounded border bg-emerald-50 dark:bg-emerald-950/30 p-3 space-y-3">
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        <Badge
          variant="outline"
          className="border-emerald-600 text-emerald-700 dark:text-emerald-400"
        >
          {t({ de: "Batch eingereicht", en: "Batch submitted" })}
        </Badge>
        {result.prUrl && (
          <a
            href={result.prUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400 hover:underline"
          >
            <GitPullRequest className="h-3.5 w-3.5" />
            etfs.ts pull request #{result.prNumber}
            <ExternalLink className="h-3 w-3" />
          </a>
        )}
        {result.lookthroughPrUrl && (
          <a
            href={result.lookthroughPrUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400 hover:underline"
          >
            <GitPullRequest className="h-3.5 w-3.5" />
            look-through pull request #{result.lookthroughPrNumber}
            <ExternalLink className="h-3 w-3" />
          </a>
        )}
      </div>
      <div className="flex flex-wrap gap-1.5 text-xs">
        <Badge variant="outline">
          {result.summary.added ?? 0} {t({ de: "hinzugefügt", en: "added" })}
        </Badge>
        {(result.summary.skipped ?? 0) > 0 && (
          <Badge variant="outline">
            {result.summary.skipped}{" "}
            {t({ de: "übersprungen", en: "skipped" })}
          </Badge>
        )}
        {(result.summary.lookthroughAdded ?? 0) > 0 && (
          <Badge variant="outline">
            {result.summary.lookthroughAdded}{" "}
            {t({
              de: "look-through hinzugefügt",
              en: "look-through added",
            })}
          </Badge>
        )}
        {(result.summary.lookthroughAlreadyPresent ?? 0) > 0 && (
          <Badge variant="outline">
            {result.summary.lookthroughAlreadyPresent}{" "}
            {t({
              de: "look-through schon vorhanden",
              en: "look-through already present",
            })}
          </Badge>
        )}
        {(result.summary.lookthroughSkipped ?? 0) > 0 && (
          <Badge variant="outline" className="border-amber-600">
            {result.summary.lookthroughSkipped}{" "}
            {t({
              de: "look-through übersprungen",
              en: "look-through skipped",
            })}
          </Badge>
        )}
      </div>
      {result.lookthroughError && (
        <Alert variant="destructive">
          <AlertTitle>
            {t({
              de: "Look-through Pull Request fehlgeschlagen",
              en: "Look-through pull request failed",
            })}
          </AlertTitle>
          <AlertDescription className="text-xs whitespace-pre-line break-words">
            {result.lookthroughError}
          </AlertDescription>
        </Alert>
      )}
      <BatchOutcomeTable rows={result.perRow} lang={lang} t={t} />
    </div>
  );
}

export function BatchOutcomeTable({
  rows,
  lang,
  t,
}: {
  rows: BulkAltRowOutcome[];
  lang: "de" | "en";
  t: (s: { de: string; en: string }) => string;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs border-collapse">
        <thead>
          <tr className="text-left text-muted-foreground border-b">
            <th className="py-1 pr-2 font-medium">parentKey</th>
            <th className="py-1 pr-2 font-medium">ISIN</th>
            <th className="py-1 pr-2 font-medium">
              {t({ de: "Name", en: "Name" })}
            </th>
            <th className="py-1 pr-2 font-medium">
              {t({ de: "Status", en: "Status" })}
            </th>
            <th className="py-1 pr-2 font-medium">Look-through</th>
            <th className="py-1 font-medium">
              {t({ de: "Detail", en: "Detail" })}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr
              key={`${r.parentKey}|${r.isin}|${i}`}
              className="border-b last:border-b-0 align-top"
            >
              <td className="py-1 pr-2 font-mono">{r.parentKey || "—"}</td>
              <td className="py-1 pr-2 font-mono">{r.isin || "—"}</td>
              <td className="py-1 pr-2">{r.name ?? "—"}</td>
              <td className="py-1 pr-2">
                <Badge
                  variant="outline"
                  className={batchRowBadgeClass(r.status)}
                >
                  {batchRowLabel(r.status, lang)}
                </Badge>
              </td>
              <td className="py-1 pr-2">
                <span className="text-muted-foreground">
                  {lookthroughStatusLabel(
                    r.lookthroughStatus,
                    r.lookthroughPlan,
                    lang,
                  )}
                </span>
              </td>
              <td className="py-1 text-muted-foreground break-words max-w-[24ch]">
                {r.message ?? r.lookthroughMessage ?? ""}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
