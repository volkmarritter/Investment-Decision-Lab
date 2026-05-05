// Overview — read-only dashboard at /admin with five summary cards.

import { useEffect, useState } from "react";
import { Link } from "wouter";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ChevronRight,
  ExternalLink,
  GitBranch,
  GitPullRequest,
  History,
  RefreshCw,
} from "lucide-react";
import {
  adminApi,
  type ChangeEntry,
  type FreshnessResponse,
  type OpenPrInfo,
  type RunLogRow,
  type WorkspaceSyncStatus,
} from "@/lib/admin-api";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useAdminT } from "@/lib/admin-i18n";
import { formatTimestamp, isIsoTimestamp } from "@/lib/admin-date";
import { SectionHeader } from "@/components/admin/SectionHeader";
import { useAdminContext } from "@/components/admin/AdminContext";

const PR_BRANCH_PREFIXES = [
  "add-etf/",
  "add-alt/",
  "rm-alt/",
  "add-lookthrough-pool/",
  "backfill-",
  "update-app-defaults/",
  "instr-add/",
  "instr-edit/",
  "instr-rm/",
] as const;

type DashState = {
  loading: boolean;
  error: string | null;
  sync: WorkspaceSyncStatus | null;
  prCount: number | null;
  prList: OpenPrInfo[];
  fresh: FreshnessResponse | null;
  changes: ChangeEntry[];
  runs: RunLogRow[];
};

const initial: DashState = {
  loading: true,
  error: null,
  sync: null,
  prCount: null,
  prList: [],
  fresh: null,
  changes: [],
  runs: [],
};

export default function Overview() {
  const { t } = useAdminT();
  const { githubConfigured, githubInfo, directWrite } = useAdminContext();
  const [state, setState] = useState<DashState>(initial);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setState((s) => ({ ...s, loading: true, error: null }));
      try {
        // Direct-write mode: skip workspace-sync + PR fetches entirely —
        // those surfaces are hidden and don't need the data.
        const [sync, fresh, changes, runs, ...prResponses] = await Promise.all([
          directWrite
            ? Promise.resolve(null as WorkspaceSyncStatus | null)
            : adminApi.workspaceSyncStatus(),
          adminApi.freshness(),
          adminApi.changes(5),
          adminApi.runLog(5),
          ...(directWrite
            ? []
            : PR_BRANCH_PREFIXES.map((p) => adminApi.listOpenPrs(p))),
        ]);
        if (cancelled) return;
        // Flatten + de-dup by PR number — overlapping prefixes are not used,
        // but be defensive in case a future flow's prefix is a substring.
        const seen = new Set<number>();
        const allPrs: OpenPrInfo[] = [];
        for (const r of prResponses) {
          if (!r.configured) continue;
          for (const pr of r.prs) {
            if (seen.has(pr.number)) continue;
            seen.add(pr.number);
            allPrs.push(pr);
          }
        }
        allPrs.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        setState({
          loading: false,
          error: null,
          sync,
          prCount: allPrs.length,
          prList: allPrs,
          fresh,
          changes: changes.entries,
          runs: runs.rows,
        });
      } catch (e: unknown) {
        if (cancelled) return;
        setState((s) => ({
          ...s,
          loading: false,
          error: e instanceof Error ? e.message : String(e),
        }));
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [directWrite]);

  return (
    <section className="space-y-5" data-testid="page-admin-overview">
      <SectionHeader
        title={t({ de: "Übersicht", en: "Overview" })}
        description={t(
          directWrite
            ? {
                de: "Operativer Status auf einen Blick — Datenfrische, jüngste Änderungen und Läufe.",
                en: "Operational status at a glance — data freshness, recent changes, and runs.",
              }
            : {
                de: "Operativer Status auf einen Blick — Workspace, offene Pull Requests, Datenfrische, jüngste Änderungen und Läufe.",
                en: "Operational status at a glance — workspace, open Pull Requests, data freshness, recent changes, and runs.",
              },
        )}
        testid="header-admin-overview"
      />

      {directWrite && <PublishingWorkflowCard />}

      {!directWrite && !githubConfigured && (
        <Alert variant="destructive" data-testid="overview-github-missing">
          <AlertDescription>
            {t({
              de: "GitHub ist nicht konfiguriert (GITHUB_TOKEN, GITHUB_OWNER, GITHUB_REPO am api-server). Pull-Request-Aktionen sind deaktiviert.",
              en: "GitHub is not configured (GITHUB_TOKEN, GITHUB_OWNER, GITHUB_REPO on the api-server). Pull request actions are disabled.",
            })}
          </AlertDescription>
        </Alert>
      )}

      {!directWrite && githubConfigured && githubInfo.owner && githubInfo.repo && (
        <p className="text-xs text-muted-foreground" data-testid="overview-github-info">
          {t({ de: "Verknüpft mit", en: "Linked to" })}{" "}
          <code className="font-mono">
            {githubInfo.owner}/{githubInfo.repo}
          </code>{" "}
          ({t({ de: "Basis-Branch", en: "base branch" })}{" "}
          <code className="font-mono">{githubInfo.baseBranch}</code>)
        </p>
      )}

      {state.error && (
        <Alert variant="destructive" data-testid="overview-load-error">
          <AlertDescription>
            {t({
              de: `Konnte Übersicht nicht vollständig laden: ${state.error}`,
              en: `Could not fully load the overview: ${state.error}`,
            })}
          </AlertDescription>
        </Alert>
      )}

      {!directWrite && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <SyncCard sync={state.sync} loading={state.loading} />
          <PrsCard
            count={state.prCount}
            list={state.prList}
            loading={state.loading}
            githubConfigured={githubConfigured}
          />
        </div>
      )}

      <FreshnessSummaryCard fresh={state.fresh} loading={state.loading} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <RecentChangesSummaryCard changes={state.changes} loading={state.loading} />
        <RecentRunsSummaryCard runs={state.runs} loading={state.loading} />
      </div>
    </section>
  );
}

// PublishingWorkflowCard — direct-write mode "how to ship to live" recipe.
// Shown right under the page header in workspace builds so the operator
// always has the 3-step sync→push→republish procedure at hand.
function PublishingWorkflowCard() {
  const { lang, t } = useAdminT();
  return (
    <Card
      className="border-emerald-300 bg-emerald-50 dark:border-emerald-700 dark:bg-emerald-950/30"
      data-testid="overview-direct-write-info"
    >
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2 text-emerald-900 dark:text-emerald-100">
          <CheckCircle2 className="h-4 w-4" />
          {t({
            de: "Direkt-Schreib-Modus aktiv",
            en: "Direct-write mode active",
          })}
        </CardTitle>
      </CardHeader>
      <CardContent className="text-sm text-emerald-900 dark:text-emerald-100 space-y-2">
        <p className="text-xs">
          {t({
            de: "Katalog-Aktionen schreiben sofort in die Workspace-Dateien — kein Pull Request, kein Merge. Endnutzer sehen die Änderung erst nach Republish:",
            en: "Catalog actions write straight to the workspace files — no pull request, no merge. End users only see the change after Republish:",
          })}
        </p>
        <ol className="list-decimal list-inside text-xs space-y-1 ml-1">
          <li>
            {lang === "de" ? (
              <>
                Im <strong>Shell</strong> ausführen, falls Remote Updates
                anliegen (Git-Pane zeigt <code>↓ N</code>):{" "}
                <code className="font-mono">bash bin/sync-with-main.sh</code>
              </>
            ) : (
              <>
                Run in the <strong>Shell</strong> if remote updates exist
                (Git pane shows <code>↓ N</code>):{" "}
                <code className="font-mono">bash bin/sync-with-main.sh</code>
              </>
            )}
          </li>
          <li>
            {t({
              de: "Im Git-Pane „Push“ klicken (oder git push in der Shell).",
              en: "Click \"Push\" in the Git pane (or git push in the shell).",
            })}
          </li>
          <li>
            {t({
              de: "Oben rechts „Republish“ — live nach 1–3 Min.",
              en: "Click \"Republish\" top-right — live in 1–3 min.",
            })}
          </li>
        </ol>
        <p className="text-[11px] text-emerald-800/80 dark:text-emerald-200/70">
          {t({
            de: "Häufiger Fehler: Republish ohne vorher zu syncen + zu pushen — landet beim nächsten Sync im Konflikt-Pane. Volle Anleitung unter Dokumentation.",
            en: "Common mistake: Republish without syncing + pushing first — lands you in the conflict pane on the next sync. Full guide under Documentation.",
          })}
        </p>
      </CardContent>
    </Card>
  );
}

// Card primitives — shared skeleton / empty / link helpers.
function CardLink({ to, label }: { to: string; label: string }) {
  return (
    <Link
      href={to}
      className="text-xs text-primary hover:underline inline-flex items-center gap-0.5"
    >
      {label}
      <ArrowRight className="h-3 w-3" />
    </Link>
  );
}

function CardEmpty({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-sm text-muted-foreground italic">{children}</p>
  );
}

function LineSkeleton({ count }: { count: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton key={i} className="h-4 w-full" />
      ))}
    </div>
  );
}

// SyncCard — Workspace sync at a glance.
function SyncCard({
  sync,
  loading,
}: {
  sync: WorkspaceSyncStatus | null;
  loading: boolean;
}) {
  const { t } = useAdminT();
  const isClean = sync?.dirty
    ? sync.dirty.staged === 0 &&
      sync.dirty.modified === 0 &&
      sync.dirty.untracked === 0
    : true;
  const inSync = (sync?.behind ?? 0) === 0 && (sync?.ahead ?? 0) === 0;

  return (
    <Card data-testid="overview-sync-card">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <GitBranch className="h-4 w-4 text-primary" />
          {t({ de: "Workspace-Sync", en: "Workspace sync" })}
          <CardLink
            to="/admin/operations/sync"
            label={t({ de: "Details", en: "View all" })}
          />
        </CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <LineSkeleton count={3} />
        ) : !sync || sync.available === false ? (
          <CardEmpty>
            {sync?.reason ??
              t({
                de: "Workspace-Sync nicht verfügbar.",
                en: "Workspace sync unavailable.",
              })}
          </CardEmpty>
        ) : (
          <dl className="text-sm space-y-1.5">
            <div className="flex items-center gap-2">
              <dt className="text-muted-foreground w-24">
                {t({ de: "Branch", en: "Branch" })}
              </dt>
              <dd className="font-mono">{sync.branch ?? "—"}</dd>
            </div>
            <div className="flex items-center gap-2">
              <dt className="text-muted-foreground w-24">HEAD</dt>
              <dd className="font-mono">{sync.headShortSha ?? "—"}</dd>
            </div>
            <div className="flex items-center gap-2">
              <dt className="text-muted-foreground w-24">
                {t({ de: "Stand", en: "Status" })}
              </dt>
              <dd className="flex items-center gap-1.5">
                {inSync && isClean ? (
                  <Badge
                    variant="outline"
                    className="border-emerald-500 text-emerald-700 dark:text-emerald-400"
                  >
                    <CheckCircle2 className="h-3 w-3 mr-1" />
                    {t({ de: "Aktuell & sauber", en: "In sync & clean" })}
                  </Badge>
                ) : (
                  <Badge
                    variant="outline"
                    className="border-amber-500 text-amber-700 dark:text-amber-400"
                  >
                    <AlertTriangle className="h-3 w-3 mr-1" />
                    {!inSync
                      ? t({
                          de: `${sync.behind ?? 0} hinten / ${sync.ahead ?? 0} vorn`,
                          en: `${sync.behind ?? 0} behind / ${sync.ahead ?? 0} ahead`,
                        })
                      : t({ de: "Lokale Änderungen", en: "Dirty workspace" })}
                  </Badge>
                )}
              </dd>
            </div>
          </dl>
        )}
      </CardContent>
    </Card>
  );
}

// PrsCard — Open Pull Requests across every admin flow.
function PrsCard({
  count,
  list,
  loading,
  githubConfigured,
}: {
  count: number | null;
  list: OpenPrInfo[];
  loading: boolean;
  githubConfigured: boolean;
}) {
  const { t } = useAdminT();
  const top = list.slice(0, 3);
  return (
    <Card data-testid="overview-prs-card">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <GitPullRequest className="h-4 w-4 text-primary" />
          {t({ de: "Offene Pull Requests", en: "Open Pull Requests" })}
          {count !== null && (
            <Badge variant="secondary" data-testid="overview-prs-count">
              {count}
            </Badge>
          )}
          <CardLink
            to="/admin/operations/prs"
            label={t({ de: "Alle ansehen", en: "View all" })}
          />
        </CardTitle>
      </CardHeader>
      <CardContent>
        {!githubConfigured ? (
          <CardEmpty>
            {t({
              de: "GitHub nicht konfiguriert.",
              en: "GitHub not configured.",
            })}
          </CardEmpty>
        ) : loading ? (
          <LineSkeleton count={3} />
        ) : top.length === 0 ? (
          <CardEmpty>
            {t({
              de: "Keine offenen Admin-Pull-Requests.",
              en: "No open admin Pull Requests.",
            })}
          </CardEmpty>
        ) : (
          <ul className="text-sm space-y-1" data-testid="overview-prs-list">
            {top.map((pr) => (
              <li key={pr.number}>
                <a
                  href={pr.url}
                  target="_blank"
                  rel="noreferrer"
                  className="hover:underline inline-flex items-center gap-1 truncate"
                >
                  <span className="font-mono text-xs text-muted-foreground">
                    #{pr.number}
                  </span>
                  <span className="truncate max-w-[24ch]">{pr.title}</span>
                  <ExternalLink className="h-3 w-3 flex-shrink-0" />
                </a>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

// FreshnessSummaryCard — three timestamps at a glance.
function FreshnessSummaryCard({
  fresh,
  loading,
}: {
  fresh: FreshnessResponse | null;
  loading: boolean;
}) {
  const { t } = useAdminT();
  return (
    <Card data-testid="overview-freshness-card">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <RefreshCw className="h-4 w-4 text-primary" />
          {t({ de: "Datenfrische", en: "Data freshness" })}
          <CardLink
            to="/admin/operations/freshness"
            label={t({ de: "Details", en: "View all" })}
          />
        </CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <LineSkeleton count={3} />
        ) : !fresh ? (
          <CardEmpty>
            {t({ de: "Keine Daten.", en: "No data." })}
          </CardEmpty>
        ) : (
          <dl className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
            <FreshTsRow
              label={t({ de: "ETF-Overrides", en: "ETF overrides" })}
              ts={fresh.etfsOverrides?.lastRefreshedAt ?? null}
            />
            <FreshTsRow
              label={t({ de: "Look-through-Overrides", en: "Look-through overrides" })}
              ts={fresh.lookthroughOverrides?.lastRefreshedAt ?? null}
            />
            <FreshCountRow
              label={t({ de: "Geplante Jobs", en: "Scheduled jobs" })}
              count={Object.keys(fresh.schedules ?? {}).length}
            />
          </dl>
        )}
      </CardContent>
    </Card>
  );
}

function FreshTsRow({ label, ts }: { label: string; ts: string | null }) {
  const { lang } = useAdminT();
  const f = ts ? formatTimestamp(ts, lang) : null;
  return (
    <div className="border border-border rounded-md px-3 py-2">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd
        className="text-sm font-medium font-mono break-all leading-tight tabular-nums"
        title={ts ?? undefined}
      >
        {f ? (
          <>
            <span className="block">{f.local}</span>
            <span className="block text-[10px] text-muted-foreground">
              {f.relative} · {f.utc}
            </span>
          </>
        ) : (
          "—"
        )}
      </dd>
    </div>
  );
}

function FreshCountRow({ label, count }: { label: string; count: number }) {
  return (
    <div className="border border-border rounded-md px-3 py-2">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm font-medium tabular-nums">{count}</dd>
    </div>
  );
}

// RecentChangesSummaryCard — top-5 ISIN edits.
function RecentChangesSummaryCard({
  changes,
  loading,
}: {
  changes: ChangeEntry[];
  loading: boolean;
}) {
  const { t, lang } = useAdminT();
  return (
    <Card data-testid="overview-changes-card">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <History className="h-4 w-4 text-primary" />
          {t({ de: "Letzte Datenänderungen", en: "Recent data changes" })}
          <CardLink
            to="/admin/operations/changes"
            label={t({ de: "Alle ansehen", en: "View all" })}
          />
        </CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <LineSkeleton count={5} />
        ) : changes.length === 0 ? (
          <CardEmpty>
            {t({
              de: "Noch keine Pool-Refresh-Änderungen geloggt.",
              en: "No pool-refresh changes logged yet.",
            })}
          </CardEmpty>
        ) : (
          <ul
            className="text-sm divide-y divide-border"
            data-testid="overview-changes-list"
          >
            {changes.slice(0, 5).map((c, i) => (
              <li
                key={`${c.isin}-${c.ts ?? i}`}
                className="py-1.5 flex items-start justify-between gap-2"
              >
                <div className="min-w-0">
                  <span className="font-mono text-xs">{c.isin}</span>
                  {c.field && (
                    <span className="text-muted-foreground ml-2">
                      {c.field}
                    </span>
                  )}
                </div>
                <span
                  className="text-xs text-muted-foreground flex-shrink-0 tabular-nums"
                  title={c.ts ?? undefined}
                >
                  {(() => {
                    if (!c.ts) return "—";
                    const f = formatTimestamp(c.ts, lang);
                    return f ? `${f.local} · ${f.relative}` : c.ts;
                  })()}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

// RecentRunsSummaryCard — top-5 refresh-runs entries.
function RecentRunsSummaryCard({
  runs,
  loading,
}: {
  runs: RunLogRow[];
  loading: boolean;
}) {
  const { t, lang } = useAdminT();
  // RunLogRow is a Record<string,string>; the first column is typically a
  // human label (script name) and a "Started (UTC)" column carries the time.
  const labelKey = (row: RunLogRow): string => {
    const keys = Object.keys(row);
    return keys[0] ?? "";
  };
  return (
    <Card data-testid="overview-runs-card">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <ChevronRight className="h-4 w-4 text-primary" />
          {t({ de: "Letzte Läufe", en: "Recent runs" })}
          <CardLink
            to="/admin/operations/runs"
            label={t({ de: "Alle ansehen", en: "View all" })}
          />
        </CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <LineSkeleton count={5} />
        ) : runs.length === 0 ? (
          <CardEmpty>
            {t({ de: "Noch keine Läufe geloggt.", en: "No runs logged yet." })}
          </CardEmpty>
        ) : (
          <ul
            className="text-sm divide-y divide-border"
            data-testid="overview-runs-list"
          >
            {runs.slice(0, 5).map((r, i) => {
              const k = labelKey(r);
              const started = r["Started (UTC)"] ?? r["Started"] ?? "";
              return (
                <li
                  key={`${started || i}-${i}`}
                  className="py-1.5 flex items-start justify-between gap-2"
                >
                  <div className="min-w-0 truncate">
                    <span className="text-xs">{k ? r[k] : "—"}</span>
                  </div>
                  <span
                    className="text-xs text-muted-foreground flex-shrink-0 font-mono tabular-nums"
                    title={started || undefined}
                  >
                    {(() => {
                      if (!started) return "—";
                      if (!isIsoTimestamp(started)) return started;
                      const f = formatTimestamp(started, lang);
                      return f ? `${f.local} · ${f.relative}` : started;
                    })()}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
