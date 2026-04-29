// WorkspaceSyncPanel — fast-forward-only git pull against origin/<base>.

import { useCallback, useEffect, useState } from "react";
import {
    adminApi,
  type WorkspaceSyncPullResponse,
  type WorkspaceSyncStatus,
} from "@/lib/admin-api";
import { useAdminT } from "@/lib/admin-i18n";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { GitBranch, RefreshCw } from "lucide-react";

export function WorkspaceSyncPanel() {
  const { t, lang } = useAdminT();
  const [status, setStatus] = useState<WorkspaceSyncStatus | null>(null);
  const [statusErr, setStatusErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [result, setResult] = useState<WorkspaceSyncPullResponse | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setStatusErr(null);
    try {
      const s = await adminApi.workspaceSyncStatus();
      setStatus(s);
    } catch (e: unknown) {
      setStatusErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchFromOrigin = useCallback(async () => {
    setFetching(true);
    setStatusErr(null);
    try {
      const s = await adminApi.workspaceSyncFetch();
      setStatus(s);
    } catch (e: unknown) {
      setStatusErr(e instanceof Error ? e.message : String(e));
    } finally {
      setFetching(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function runSync() {
    setSyncing(true);
    setResult(null);
    setRefusal(null);
    try {
      const r = await adminApi.workspaceSyncPull();
      setResult(r);
      // Refresh status so behind/ahead/dirty counts reflect the new HEAD.
      void refresh();
    } catch (e: unknown) {
      setRefusal(e instanceof Error ? e.message : String(e));
    } finally {
      setSyncing(false);
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3 pb-3">
        <div className="space-y-1">
          <CardTitle className="flex items-center gap-2 text-base">
            <GitBranch className="h-4 w-4" />
            {t({
              de: "Workspace mit main synchronisieren",
              en: "Sync workspace from main",
            })}
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            {t({
              de: "Holt den aktuellen Stand von origin/main per Fast-Forward-Merge. Wird vor jedem Batch-Add empfohlen, damit der Server gegen denselben Katalog validiert wie GitHub.",
              en: "Fast-forward merges origin/main into the local checkout. Recommended before any batch-add so the server validates against the same catalog as GitHub.",
            })}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void fetchFromOrigin()}
            disabled={
              fetching ||
              syncing ||
              !status?.available ||
              status?.originConfigured === false
            }
            title={
              status?.originConfigured === false
                ? t({
                    de: "Kein origin-Remote konfiguriert — nichts zum Abrufen.",
                    en: "No origin remote configured — nothing to fetch.",
                  })
                : undefined
            }
            data-testid="button-workspace-sync-fetch"
          >
            <RefreshCw
              className={
                "h-3.5 w-3.5 mr-1.5" + (fetching ? " animate-spin" : "")
              }
            />
            {t({
              de: "Vom Remote abrufen",
              en: "Refresh from origin",
            })}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void refresh()}
            disabled={loading || syncing}
            data-testid="button-workspace-sync-refresh"
          >
            <RefreshCw
              className={
                "h-3.5 w-3.5 mr-1.5" + (loading ? " animate-spin" : "")
              }
            />
            {t({ de: "Status neu laden", en: "Reload status" })}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {statusErr && (
          <Alert variant="destructive">
            <AlertTitle>
              {t({ de: "Status nicht abrufbar", en: "Status unavailable" })}
            </AlertTitle>
            <AlertDescription className="text-xs break-words">
              {statusErr}
            </AlertDescription>
          </Alert>
        )}
        {status && !status.available && (
          <Alert>
            <AlertTitle>
              {t({
                de: "Workspace-Sync nicht verfügbar",
                en: "Workspace sync unavailable",
              })}
            </AlertTitle>
            <AlertDescription className="text-xs">
              {status.reason ??
                t({
                  de: "Dieser Workspace ist kein git-Checkout.",
                  en: "This workspace is not a git checkout.",
                })}
            </AlertDescription>
          </Alert>
        )}
        {status && status.available && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
            <div className="space-y-1">
              <div className="text-muted-foreground">
                {t({ de: "Lokaler Stand", en: "Local HEAD" })}
              </div>
              <div className="font-mono">
                <Badge variant="outline" className="mr-2">
                  {status.branch ?? "(detached)"}
                </Badge>
                {status.headShortSha ?? "—"}
              </div>
            </div>
            <div className="space-y-1">
              <div className="text-muted-foreground">
                {t({
                  de: `Gegenüber origin/${status.baseBranch}`,
                  en: `Against origin/${status.baseBranch}`,
                })}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {typeof status.behind === "number" ? (
                  <Badge
                    variant={status.behind > 0 ? "default" : "outline"}
                    className={
                      status.behind > 0
                        ? "bg-amber-500 hover:bg-amber-500/90"
                        : ""
                    }
                  >
                    {status.behind}{" "}
                    {t({ de: "Commits hinten", en: "commits behind" })}
                  </Badge>
                ) : (
                  <Badge variant="outline">
                    {t({ de: "behind unbekannt", en: "behind unknown" })}
                  </Badge>
                )}
                {typeof status.ahead === "number" && status.ahead > 0 && (
                  <Badge variant="outline">
                    {status.ahead}{" "}
                    {t({ de: "Commits vorn", en: "commits ahead" })}
                  </Badge>
                )}
              </div>
            </div>
            <div className="space-y-1">
              <div className="text-muted-foreground">
                {t({ de: "Arbeitsverzeichnis", en: "Working tree" })}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {status.dirty &&
                status.dirty.staged + status.dirty.modified === 0 ? (
                  <Badge
                    variant="outline"
                    className="border-emerald-600 text-emerald-700 dark:text-emerald-400"
                  >
                    {t({ de: "Sauber", en: "Clean" })}
                  </Badge>
                ) : (
                  <>
                    {status.dirty && status.dirty.staged > 0 && (
                      <Badge variant="outline">
                        {status.dirty.staged}{" "}
                        {t({ de: "staged", en: "staged" })}
                      </Badge>
                    )}
                    {status.dirty && status.dirty.modified > 0 && (
                      <Badge variant="outline">
                        {status.dirty.modified}{" "}
                        {t({ de: "geändert", en: "modified" })}
                      </Badge>
                    )}
                  </>
                )}
                {status.dirty && status.dirty.untracked > 0 && (
                  <Badge variant="outline" className="text-muted-foreground">
                    {status.dirty.untracked}{" "}
                    {t({ de: "untracked", en: "untracked" })}
                  </Badge>
                )}
              </div>
            </div>
            <div className="space-y-1">
              <div className="text-muted-foreground">
                {t({ de: "Hinweise", en: "Hints" })}
              </div>
              <div className="space-y-1">
                {/* "Could not refresh remote" only fires AFTER the
                    operator clicks "Refresh from origin" and the fetch
                    fails (Task #54, 2026-04-28) — the routine GET
                    never fetches, so we never spam this hint in the
                    default sandbox where origin is unconfigured. */}
                {status.fetchAttempted && status.fetchOk === false && (
                  <div className="text-amber-700 dark:text-amber-400">
                    {t({
                      de: "Konnte Remote nicht abrufen — Zähler basieren auf dem letzten Cache.",
                      en: "Could not refresh remote — counts use the last cached ref.",
                    })}
                    {status.fetchError && (
                      <span className="text-muted-foreground">
                        {" "}
                        ({status.fetchError})
                      </span>
                    )}
                  </div>
                )}
                {status.originConfigured === false && (
                  <div className="text-muted-foreground">
                    {t({
                      de: "Kein origin-Remote konfiguriert — Remote-Abruf nicht möglich.",
                      en: "No origin remote configured — fetching from origin is unavailable.",
                    })}
                  </div>
                )}
                {status.indexLockPresent && (
                  <div className="text-amber-700 dark:text-amber-400">
                    {t({
                      de: "git-Lock-Datei vorhanden (.git/index.lock) — anderer git-Prozess läuft oder ist abgestürzt.",
                      en: "git lock file present (.git/index.lock) — another git process is running or crashed.",
                    })}
                  </div>
                )}
                {status.fetchOk !== false &&
                  !status.indexLockPresent &&
                  status.dirty &&
                  status.dirty.staged + status.dirty.modified === 0 &&
                  status.behind === 0 && (
                    <div className="text-muted-foreground">
                      {t({
                        de: "Aktuell — nichts zu synchronisieren.",
                        en: "Up to date — nothing to sync.",
                      })}
                    </div>
                  )}
              </div>
            </div>
          </div>
        )}

        <div className="flex items-center gap-2 pt-1">
          <Button
            onClick={() => void runSync()}
            disabled={
              syncing ||
              !status?.available ||
              (status?.dirty &&
                status.dirty.staged + status.dirty.modified > 0) ||
              status?.indexLockPresent === true
            }
          >
            {syncing
              ? t({ de: "Synchronisiere…", en: "Syncing…" })
              : t({
                  de: "Workspace von main synchronisieren",
                  en: "Sync workspace from main",
                })}
          </Button>
          {result && (
            <span className="text-xs text-muted-foreground">
              {result.alreadyUpToDate
                ? t({ de: "Schon aktuell.", en: "Already up to date." })
                : t({
                    de: `${result.changedFiles.length} Dateien geändert.`,
                    en: `${result.changedFiles.length} files changed.`,
                  })}
            </span>
          )}
        </div>

        {refusal && (
          <Alert variant="destructive">
            <AlertTitle>
              {t({ de: "Sync abgelehnt", en: "Sync refused" })}
            </AlertTitle>
            <AlertDescription className="text-xs whitespace-pre-line break-words">
              {refusal}
            </AlertDescription>
          </Alert>
        )}

        {result && !result.alreadyUpToDate && (
          <div className="rounded border bg-muted/40 p-3 text-xs space-y-2">
            <div className="font-mono">
              {result.oldSha.slice(0, 7)} → {result.newSha.slice(0, 7)}
            </div>
            {result.changedFiles.length > 0 && (
              <details>
                <summary className="cursor-pointer text-muted-foreground">
                  {t({
                    de: `${result.changedFiles.length} geänderte Dateien`,
                    en: `${result.changedFiles.length} changed files`,
                  })}
                </summary>
                <ul className="mt-1.5 ml-4 list-disc space-y-0.5 font-mono">
                  {result.changedFiles.slice(0, 100).map((f) => (
                    <li key={f}>{f}</li>
                  ))}
                  {result.changedFiles.length > 100 && (
                    <li className="text-muted-foreground">
                      …{" "}
                      {t({
                        de: `${result.changedFiles.length - 100} weitere`,
                        en: `${result.changedFiles.length - 100} more`,
                      })}
                    </li>
                  )}
                </ul>
              </details>
            )}
          </div>
        )}
        <p className="text-[11px] text-muted-foreground">
          {lang === "de"
            ? "Sync nutzt --ff-only — niemals Force-Pull, niemals Merge-Commit. Lokale uncommitted-Änderungen blockieren den Sync mit einer klaren Fehlermeldung."
            : "Sync uses --ff-only — never a force pull, never a merge commit. Uncommitted local changes block the sync with a clear error."}
        </p>
      </CardContent>
    </Card>
  );
}
