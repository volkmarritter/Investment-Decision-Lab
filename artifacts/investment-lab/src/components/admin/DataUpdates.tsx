// DataUpdates — freshness, recent changes, and recent-runs cards.

import { useEffect, useMemo, useState } from "react";
import {
    adminApi,
  type ChangeEntry,
  type FreshnessResponse,
  type RunLogRow,
} from "@/lib/admin-api";
import { useAdminT } from "@/lib/admin-i18n";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { RefreshCw } from "lucide-react";
import { Row, fmt } from "./shared";

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
  const { t } = useAdminT();
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
                fresh.etfsOverrides?.lastRefreshedAt
                  ? `${fresh.etfsOverrides.lastRefreshedAt} (${
                      fresh.etfsOverrides.lastRefreshedMode ?? "?"
                    })`
                  : "—"
              }
            />
            <Row
              k="lookthrough.overrides.json"
              v={fresh.lookthroughOverrides?.lastRefreshedAt ?? "—"}
            />
            <Separator className="my-2" />
            {Object.entries(fresh.schedules).map(([name, cron]) => (
              <Row key={name} k={name} v={`cron: ${cron}`} />
            ))}
          </>
        )}
      </CardContent>
    </Card>
  );
}

export function RecentChangesCard({ changes }: { changes: ChangeEntry[] }) {
  const { t } = useAdminT();
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
                {entries[0].source} · {entries[0].ts}
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

const ISO_TIMESTAMP_RX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;
const TIMESTAMP_COL_NAMES = new Set([
  "Started (UTC)",
  "Started",
  "Finished (UTC)",
  "Finished",
  "Timestamp",
]);

function formatRelative(diffMs: number, lang: "de" | "en"): string {
  const past = diffMs >= 0;
  const abs = Math.abs(diffMs);
  const sec = Math.floor(abs / 1000);
  const min = Math.floor(sec / 60);
  const hr = Math.floor(min / 60);
  const day = Math.floor(hr / 24);
  const de = lang === "de";
  const ago = (n: number, unit: string) =>
    de ? `vor ${n} ${unit}` : `${n} ${unit} ago`;
  const fwd = (n: number, unit: string) =>
    de ? `in ${n} ${unit}` : `in ${n} ${unit}`;
  const wrap = past ? ago : fwd;
  if (sec < 60) return de ? (past ? "gerade eben" : "in Kürze") : past ? "just now" : "soon";
  if (min < 60) return wrap(min, de ? "Min." : min === 1 ? "min" : "mins");
  if (hr < 48) return wrap(hr, de ? (hr === 1 ? "Std." : "Std.") : hr === 1 ? "hour" : "hours");
  return wrap(day, de ? (day === 1 ? "Tag" : "Tagen") : day === 1 ? "day" : "days");
}

function formatRunTimestamp(iso: string, lang: "de" | "en"): {
  local: string;
  relative: string;
  utc: string;
} {
  const date = new Date(iso);
  if (isNaN(date.getTime())) return { local: iso, relative: "", utc: "" };
  const locale = lang === "de" ? "de-CH" : "en-GB";
  const local = date.toLocaleString(locale, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const utc =
    `${String(date.getUTCHours()).padStart(2, "0")}:${String(
      date.getUTCMinutes(),
    ).padStart(2, "0")} UTC`;
  const relative = formatRelative(Date.now() - date.getTime(), lang);
  return { local, relative, utc };
}

const GITHUB_REPO = "volkmarritter/Investment-Decision-Lab";
const RUN_LOG_PATH = "artifacts/investment-lab/src/data/refresh-runs.log.md";

interface GithubCommitState {
  status: "loading" | "ok" | "error";
  date?: string;
  sha?: string;
  htmlUrl?: string;
  error?: string;
}

function useGithubLastCommit(filePath: string): GithubCommitState {
  const [state, setState] = useState<GithubCommitState>({ status: "loading" });
  useEffect(() => {
    const ctrl = new AbortController();
    (async () => {
      try {
        const url = `https://api.github.com/repos/${GITHUB_REPO}/commits?path=${encodeURIComponent(filePath)}&per_page=1`;
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
  }, [filePath]);
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

  if (isTimestampCol && value && ISO_TIMESTAMP_RX.test(value)) {
    const { local, relative, utc } = formatRunTimestamp(value, lang);
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
    bundleNewestIso && ISO_TIMESTAMP_RX.test(bundleNewestIso)
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
                      const f = formatRunTimestamp(bundleNewestIso, lang);
                      return `${f.local} · ${f.relative}`;
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
                      const f = formatRunTimestamp(githubCommit.date!, lang);
                      return `${f.local} · ${f.relative}`;
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
