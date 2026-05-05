// DataUpdates — freshness, recent changes, and recent-runs cards.

import { useEffect, useMemo, useState } from "react";
import {
    adminApi,
  type ChangeEntry,
  type FreshnessResponse,
  type RunLogRow,
} from "@/lib/admin-api";
import { useAdminT } from "@/lib/admin-i18n";
import {
  formatCron,
  formatTimestamp,
  isIsoTimestamp,
  type AdminLang,
} from "@/lib/admin-date";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { RefreshCw } from "lucide-react";
import { Row, fmt } from "./shared";
import { useAdminContext } from "./AdminContext";

// Inline timestamp display: localised date+time on top, "vor 9 Tagen ·
// 08:47 UTC" underneath, with the raw ISO string as a tooltip so the
// operator can copy it for grepping logs. Used by the freshness card,
// the recent-changes card and (indirectly via RunCell) the run-log
// table — keeping every admin timestamp visually identical.
function TimestampInline({
  iso,
  lang,
  suffix,
}: {
  iso: string;
  lang: AdminLang;
  suffix?: string;
}) {
  const f = formatTimestamp(iso, lang);
  if (!f) return <span title={iso}>{iso}</span>;
  return (
    <span
      className="leading-tight inline-block text-right tabular-nums"
      title={iso}
    >
      <span className="block">
        {f.local}
        {suffix ? ` (${suffix})` : ""}
      </span>
      <span className="block text-[10px] text-muted-foreground">
        {f.relative} · {f.utc}
      </span>
    </span>
  );
}

export function DataUpdatesColumn() {
  const { t } = useAdminT();
  const [changes, setChanges] = useState<ChangeEntry[]>([]);
  const [runs, setRuns] = useState<RunLogRow[]>([]);
  const [fresh, setFresh] = useState<FreshnessResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  async function load() {
    setRefreshing(true);
    setError(null);
    try {
      const [c, r, f] = await Promise.all([
        adminApi.changes(50),
        adminApi.runLog(20),
        adminApi.freshness(),
      ]);
      setChanges(c.entries);
      setRuns(r.rows);
      setFresh(f);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRefreshing(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end">
        <Button
          variant="outline"
          size="sm"
          onClick={load}
          disabled={refreshing}
          data-testid="button-refresh-data"
        >
          <RefreshCw
            className={`h-4 w-4 mr-1 ${refreshing ? "animate-spin" : ""}`}
          />
          {t({ de: "Aktualisieren", en: "Refresh" })}
        </Button>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <FreshnessCard fresh={fresh} />
      <RecentChangesCard changes={changes} />
      <RecentRunsCard runs={runs} />
    </div>
  );
}

export function FreshnessCard({ fresh }: { fresh: FreshnessResponse | null }) {
  const { t, lang } = useAdminT();
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          {t({ de: "Datenaktualität", en: "Data freshness" })}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        {!fresh && (
          <p className="text-muted-foreground">
            {t({ de: "Lade …", en: "Loading …" })}
          </p>
        )}
        {fresh && (
          <>
            <Row
              k="etfs.overrides.json"
              v={
                fresh.etfsOverrides?.lastRefreshedAt ? (
                  <TimestampInline
                    iso={fresh.etfsOverrides.lastRefreshedAt}
                    lang={lang}
                    suffix={fresh.etfsOverrides.lastRefreshedMode ?? "?"}
                  />
                ) : (
                  "—"
                )
              }
            />
            <Row
              k="lookthrough.overrides.json"
              v={
                fresh.lookthroughOverrides?.lastRefreshedAt ? (
                  <TimestampInline
                    iso={fresh.lookthroughOverrides.lastRefreshedAt}
                    lang={lang}
                  />
                ) : (
                  "—"
                )
              }
            />
            <Separator className="my-2" />
            {Object.entries(fresh.schedules).map(([name, cron]) => (
              <Row
                key={name}
                k={name}
                v={
                  <span title={`cron: ${cron}`}>{formatCron(cron, lang)}</span>
                }
              />
            ))}
          </>
        )}
      </CardContent>
    </Card>
  );
}

export function RecentChangesCard({ changes }: { changes: ChangeEntry[] }) {
  const { t, lang } = useAdminT();
  const grouped = useMemo(() => {
    const byIsin = new Map<string, ChangeEntry[]>();
    for (const c of changes) {
      if (!byIsin.has(c.isin)) byIsin.set(c.isin, []);
      byIsin.get(c.isin)!.push(c);
    }
    return Array.from(byIsin.entries());
  }, [changes]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          {t({
            de: "Aktuelle Datenänderungen",
            en: "Recent data changes",
          })}{" "}
          ({changes.length})
        </CardTitle>
      </CardHeader>
      <CardContent>
        {grouped.length === 0 && (
          <p className="text-sm text-muted-foreground">
            {t({
              de: "Noch keine Änderungen. Der nächste geplante Scrape füllt diese Liste, sobald er Feld-Unterschiede erkennt.",
              en: "No changes yet. The next scheduled scrape fills this list as soon as it detects field differences.",
            })}
          </p>
        )}
        <div className="space-y-3 max-h-96 overflow-auto">
          {grouped.map(([isin, entries]) => (
            <div key={isin} className="border rounded p-2">
              <div className="font-mono text-xs font-medium">{isin}</div>
              <div className="text-[10px] text-muted-foreground mb-1">
                {entries[0].source} ·{" "}
                {isIsoTimestamp(entries[0].ts) ? (
                  <TimestampInline iso={entries[0].ts} lang={lang} />
                ) : (
                  <span title={entries[0].ts}>{entries[0].ts}</span>
                )}
              </div>
              <ul className="space-y-1">
                {entries.map((e, i) => (
                  <li key={i} className="text-xs">
                    <span className="font-medium">{e.field}</span>:{" "}
                    <code className="text-muted-foreground">
                      {fmt(e.before)}
                    </code>{" "}
                    → <code>{fmt(e.after)}</code>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

const TIMESTAMP_COL_NAMES = new Set([
  "Started (UTC)",
  "Started",
  "Finished (UTC)",
  "Finished",
  "Timestamp",
]);

const RUN_LOG_PATH = "artifacts/investment-lab/src/data/refresh-runs.log.md";

interface GithubCommitState {
  status: "loading" | "ok" | "error";
  date?: string;
  sha?: string;
  htmlUrl?: string;
  error?: string;
}

function useGithubLastCommit(filePath: string): GithubCommitState {
  const { githubInfo } = useAdminContext();
  const repoSlug =
    githubInfo.owner && githubInfo.repo
      ? `${githubInfo.owner}/${githubInfo.repo}`
      : null;
  const [state, setState] = useState<GithubCommitState>({ status: "loading" });
  useEffect(() => {
    if (!repoSlug) {
      setState({ status: "error", error: "GitHub repo not configured" });
      return;
    }
    const ctrl = new AbortController();
    (async () => {
      try {
        const url = `https://api.github.com/repos/${repoSlug}/commits?path=${encodeURIComponent(filePath)}&per_page=1`;
        const r = await fetch(url, {
          signal: ctrl.signal,
          headers: { Accept: "application/vnd.github+json" },
        });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const data = (await r.json()) as Array<{
          sha?: string;
          html_url?: string;
          commit?: { committer?: { date?: string }; author?: { date?: string } };
        }>;
        if (!Array.isArray(data) || data.length === 0)
          throw new Error("no commits");
        const c = data[0];
        const date = c?.commit?.committer?.date ?? c?.commit?.author?.date;
        if (!date) throw new Error("no commit date");
        setState({
          status: "ok",
          date,
          sha: c.sha,
          htmlUrl: c.html_url,
        });
      } catch (e) {
        if (ctrl.signal.aborted) return;
        setState({
          status: "error",
          error: e instanceof Error ? e.message : String(e),
        });
      }
    })();
    return () => ctrl.abort();
  }, [filePath, repoSlug]);
  return state;
}

export function RunCell({
  col,
  value,
  lang,
}: {
  col: string;
  value: string;
  lang: "de" | "en";
}) {
  const isTimestampCol =
    TIMESTAMP_COL_NAMES.has(col) ||
    col.toLowerCase().includes("started") ||
    col.toLowerCase().includes("finished");

  if (isTimestampCol && value && isIsoTimestamp(value)) {
    const f = formatTimestamp(value, lang);
    if (!f) return <span className="whitespace-nowrap">{value}</span>;
    const { local, relative, utc } = f;
    return (
      <div className="leading-tight whitespace-nowrap" title={value}>
        <div className="font-medium tabular-nums">{local}</div>
        <div className="text-[10px] text-muted-foreground tabular-nums">
          {relative}
          {utc && ` · ${utc}`}
        </div>
      </div>
    );
  }
  return <span className="whitespace-nowrap">{value}</span>;
}

const REPUBLISH_LAG_THRESHOLD_MS = 10 * 60 * 1000;

export function RecentRunsCard({ runs }: { runs: RunLogRow[] }) {
  const { t, lang } = useAdminT();
  const cols = runs[0] ? Object.keys(runs[0]).slice(0, 6) : [];
  const githubCommit = useGithubLastCommit(RUN_LOG_PATH);
  const bundleNewestIso =
    runs[0]?.["Started (UTC)"] ??
    runs[0]?.["Started"] ??
    "";
  const bundleNewestDate =
    bundleNewestIso && isIsoTimestamp(bundleNewestIso)
      ? new Date(bundleNewestIso)
      : null;
  const githubDate =
    githubCommit.status === "ok" && githubCommit.date
      ? new Date(githubCommit.date)
      : null;
  const canCompare = !!bundleNewestDate && !!githubDate;
  const lagMs = canCompare
    ? githubDate!.getTime() - bundleNewestDate!.getTime()
    : 0;
  const republishOverdue = canCompare && lagMs > REPUBLISH_LAG_THRESHOLD_MS;
  const headerFor = (c: string) => {
    if (c === "Started (UTC)" || c === "Started") {
      return t({ de: "Gestartet (lokal)", en: "Started (local)" });
    }
    if (c === "Finished (UTC)" || c === "Finished") {
      return t({ de: "Beendet (lokal)", en: "Finished (local)" });
    }
    if (c === "Timestamp") {
      return t({ de: "Zeitpunkt (lokal)", en: "Timestamp (local)" });
    }
    return c;
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          {t({ de: "Letzte Läufe", en: "Recent runs" })} ({runs.length})
        </CardTitle>
      </CardHeader>
      <CardContent>
        {runs.length > 0 && (
          <div
            className={`mb-3 rounded-md border px-3 py-2 text-[11px] ${
              republishOverdue
                ? "border-amber-300 bg-amber-50"
                : "border-muted bg-muted/30"
            }`}
            data-testid="run-log-freshness-banner"
          >
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-medium text-muted-foreground">
                {t({ de: "Live-Bundle", en: "Live bundle" })}
              </span>
              <span className="tabular-nums" title={bundleNewestIso}>
                {bundleNewestDate
                  ? (() => {
                      const f = formatTimestamp(bundleNewestIso, lang);
                      return f ? `${f.local} · ${f.relative}` : bundleNewestIso;
                    })()
                  : "—"}
              </span>
            </div>
            <div className="flex items-baseline justify-between gap-2 mt-0.5">
              <span className="font-medium text-muted-foreground">
                {t({ de: "GitHub", en: "GitHub" })}
              </span>
              <span className="tabular-nums">
                {githubCommit.status === "loading" && (
                  <span className="text-muted-foreground">
                    {t({ de: "lädt …", en: "loading …" })}
                  </span>
                )}
                {githubCommit.status === "error" && (
                  <span
                    className="text-muted-foreground"
                    title={githubCommit.error}
                  >
                    {t({
                      de: "nicht erreichbar",
                      en: "unavailable",
                    })}
                  </span>
                )}
                {githubCommit.status === "ok" && githubDate && (
                  <a
                    href={githubCommit.htmlUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:underline"
                    title={githubCommit.date}
                  >
                    {(() => {
                      const f = formatTimestamp(githubCommit.date!, lang);
                      return f
                        ? `${f.local} · ${f.relative}`
                        : githubCommit.date!;
                    })()}
                  </a>
                )}
              </span>
            </div>
            <div className="mt-1.5 flex items-center justify-between gap-2">
              <span className="text-[10px] text-muted-foreground">
                {t({
                  de: "Cron-Commits seit dem letzten Republish sind erst nach erneutem Deploy in der Live-App sichtbar.",
                  en: "Cron commits since the last republish only show up in the live app after a fresh deploy.",
                })}
              </span>
              {!canCompare ? (
                <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground whitespace-nowrap">
                  {t({ de: "Status unbekannt", en: "status unknown" })}
                </span>
              ) : republishOverdue ? (
                <span
                  className="inline-flex items-center rounded-full bg-amber-200 px-2 py-0.5 text-[10px] font-medium text-amber-900 whitespace-nowrap"
                  data-testid="run-log-republish-pill"
                >
                  {t({ de: "Republish fällig", en: "Republish due" })}
                </span>
              ) : (
                <span className="inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-800 whitespace-nowrap">
                  {t({ de: "aktuell", en: "up to date" })}
                </span>
              )}
            </div>
          </div>
        )}
        {runs.length === 0 && (
          <p className="text-sm text-muted-foreground">
            {t({
              de: "Noch keine Läufe protokolliert.",
              en: "No runs logged yet.",
            })}
          </p>
        )}
        {runs.length > 0 && (
          <div className="overflow-auto max-h-64">
            <table className="text-xs w-full">
              <thead>
                <tr className="text-left">
                  {cols.map((c) => (
                    <th key={c} className="pr-2 py-1 font-medium">
                      {headerFor(c)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {runs.map((r, i) => (
                  <tr key={i} className="border-t">
                    {cols.map((c) => (
                      <td key={c} className="pr-2 py-1 align-top">
                        <RunCell col={c} value={r[c]} lang={lang} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
