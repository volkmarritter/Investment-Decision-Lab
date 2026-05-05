import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { ExternalLink, RefreshCw } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  adminApi,
  type ChangeEntry,
  type FreshnessResponse,
  type RunLogRow,
} from "@/lib/admin-api";
import { useAdminT } from "@/lib/admin-i18n";
import { SectionHeader } from "@/components/admin/SectionHeader";
import { SubTabNav, type SubTab } from "@/components/admin/SubTabNav";
import { useAdminContext } from "@/components/admin/AdminContext";
import { WorkspaceSyncPanel } from "@/components/admin/WorkspaceSyncPanel";
import { FileCompareViewer } from "@/components/admin/FileCompareViewer";
import { PendingPrsCard } from "@/components/admin/PendingPrsCard";
import {
  FreshnessCard,
  RecentChangesCard,
  RecentRunsCard,
} from "@/components/admin/DataUpdates";

type SubKey = "sync" | "prs" | "changes" | "runs" | "freshness";

export default function Operations() {
  const { t } = useAdminT();
  const [location] = useLocation();
  const { githubInfo, directWrite } = useAdminContext();

  const tabs: SubTab[] = [
    // Direct-write mode hides Workspace-sync (no main→workspace roundtrip
    // exists when the server edits etfs.ts in place) and the Pull-requests
    // sub-tab (no PRs to track).
    ...(directWrite
      ? []
      : [
          {
            to: "/admin/operations/sync",
            label: t({ de: "Workspace-Sync", en: "Workspace sync" }),
            testid: "tab-operations-sync",
          },
          {
            to: "/admin/operations/prs",
            label: t({ de: "Pull Requests", en: "Pull requests" }),
            testid: "tab-operations-prs",
          },
        ]),
    {
      to: "/admin/operations/changes",
      label: t({ de: "Datenänderungen", en: "Data changes" }),
      testid: "tab-operations-changes",
    },
    {
      to: "/admin/operations/runs",
      label: t({ de: "Läufe", en: "Runs" }),
      testid: "tab-operations-runs",
    },
    {
      to: "/admin/operations/freshness",
      label: t({ de: "Datenfrische", en: "Data freshness" }),
      testid: "tab-operations-freshness",
    },
  ];

  const resolved: SubKey =
    location === "/admin/operations/prs"
      ? "prs"
      : location === "/admin/operations/changes"
        ? "changes"
        : location === "/admin/operations/runs"
          ? "runs"
          : location === "/admin/operations/freshness"
            ? "freshness"
            : location === "/admin/operations/sync"
              ? "sync"
              : // Default landing: in direct-write the sync tab is gone, so
                // land on "changes" (the most useful operator surface).
                directWrite
                ? "changes"
                : "sync";

  // In direct-write mode the sync/prs tabs are hidden from the nav. If the
  // user lands on those URLs via a stale bookmark, fall back to "changes" so
  // we never render a panel whose tab is invisible.
  const active: SubKey =
    directWrite && (resolved === "sync" || resolved === "prs")
      ? "changes"
      : resolved;

  const description: Record<SubKey, string> = {
    sync: t({
      de: "Workspace gegen origin/<base> synchronisieren — Voraussetzung für ein verlässliches Republish nach jedem Merge.",
      en: "Sync the workspace against origin/<base> — a prerequisite for a reliable republish after every merge.",
    }),
    prs: t({
      de: "Alle offenen Admin-Pull-Requests, gefiltert nach Branch-Präfix.",
      en: "Every open admin pull request, filtered by branch prefix.",
    }),
    changes: t({
      de: "Letzte Pool-Refresh-Änderungen pro ISIN, mit Werten vorher/nachher.",
      en: "Most recent pool-refresh changes per ISIN, showing before/after values.",
    }),
    runs: t({
      de: "Tabelle der letzten refresh-runs.log.md-Einträge mit Republish-Hinweis.",
      en: "Table of the most recent refresh-runs.log.md entries with a republish hint.",
    }),
    freshness: t({
      de: "Wie alt sind App-Defaults, Pool und ETF-Katalog?",
      en: "How old are the app defaults, the pool and the ETF catalog?",
    }),
  };

  const allPrsUrl = githubInfo.owner && githubInfo.repo
    ? `https://github.com/${githubInfo.owner}/${githubInfo.repo}/pulls`
    : null;

  const primaryAction = active === "prs" && allPrsUrl ? (
    <a
      href={allPrsUrl}
      target="_blank"
      rel="noopener noreferrer"
      data-testid="operations-primary-github-prs"
    >
      <Button size="sm" variant="outline">
        {t({ de: "Pull Requests auf GitHub", en: "Pull requests on GitHub" })}
        <ExternalLink className="h-3.5 w-3.5 ml-1" />
      </Button>
    </a>
  ) : null;

  return (
    <section className="space-y-5" data-testid="page-admin-operations">
      <SectionHeader
        title={t({ de: "Betrieb", en: "Operations" })}
        description={description[active]}
        primaryAction={primaryAction}
        testid="header-admin-operations"
      />
      <SubTabNav tabs={tabs} testid="subnav-operations" />
      <div data-testid={`subpage-operations-${active}`}>
        {active === "sync" && (
          <div className="space-y-4">
            <WorkspaceSyncPanel />
            <FileCompareViewer />
          </div>
        )}
        {active === "prs" && <OperationsPrsTab />}
        {active === "changes" && <ChangesTab />}
        {active === "runs" && <RunsTab />}
        {active === "freshness" && <FreshnessTab />}
      </div>
    </section>
  );
}

function useRefresh<T>(
  loader: () => Promise<T>,
  initial: T,
): { value: T; error: string | null; refreshing: boolean; refresh: () => void } {
  const [value, setValue] = useState<T>(initial);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  async function load() {
    setRefreshing(true);
    setError(null);
    try {
      setValue(await loader());
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRefreshing(false);
    }
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return { value, error, refreshing, refresh: load };
}

function RefreshButton({
  onClick,
  refreshing,
  testid,
}: {
  onClick: () => void;
  refreshing: boolean;
  testid: string;
}) {
  const { t } = useAdminT();
  return (
    <div className="flex items-center justify-end">
      <Button
        variant="outline"
        size="sm"
        onClick={onClick}
        disabled={refreshing}
        data-testid={testid}
      >
        <RefreshCw
          className={`h-4 w-4 mr-1 ${refreshing ? "animate-spin" : ""}`}
        />
        {t({ de: "Aktualisieren", en: "Refresh" })}
      </Button>
    </div>
  );
}

function ChangesTab() {
  const { value, error, refreshing, refresh } = useRefresh<ChangeEntry[]>(
    async () => (await adminApi.changes(50)).entries,
    [],
  );
  return (
    <div className="space-y-3">
      <RefreshButton
        onClick={refresh}
        refreshing={refreshing}
        testid="button-refresh-changes"
      />
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <RecentChangesCard changes={value} />
    </div>
  );
}

function RunsTab() {
  const { value, error, refreshing, refresh } = useRefresh<RunLogRow[]>(
    async () => (await adminApi.runLog(20)).rows,
    [],
  );
  return (
    <div className="space-y-3">
      <RefreshButton
        onClick={refresh}
        refreshing={refreshing}
        testid="button-refresh-runs"
      />
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <RecentRunsCard runs={value} />
    </div>
  );
}

function FreshnessTab() {
  const { value, error, refreshing, refresh } = useRefresh<FreshnessResponse | null>(
    async () => await adminApi.freshness(),
    null,
  );
  return (
    <div className="space-y-3">
      <RefreshButton
        onClick={refresh}
        refreshing={refreshing}
        testid="button-refresh-freshness"
      />
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <FreshnessCard fresh={value} />
    </div>
  );
}

function OperationsPrsTab() {
  const { t } = useAdminT();
  const groups = [
    {
      prefix: "add-etf/",
      title: t({ de: "ETF-Katalog (add-etf/)", en: "ETF catalog (add-etf/)" }),
    },
    {
      prefix: "add-alt/",
      title: t({
        de: "Alternativen — hinzufügen (add-alt/)",
        en: "Alternatives — add (add-alt/)",
      }),
    },
    {
      prefix: "rm-alt/",
      title: t({
        de: "Alternativen — entfernen (rm-alt/)",
        en: "Alternatives — remove (rm-alt/)",
      }),
    },
    {
      prefix: "instr-add/",
      title: t({
        de: "Instrumente — neu (instr-add/)",
        en: "Instruments — new (instr-add/)",
      }),
    },
    {
      prefix: "instr-edit/",
      title: t({
        de: "Instrumente — bearbeiten (instr-edit/)",
        en: "Instruments — edit (instr-edit/)",
      }),
    },
    {
      prefix: "instr-rm/",
      title: t({
        de: "Instrumente — entfernen (instr-rm/)",
        en: "Instruments — remove (instr-rm/)",
      }),
    },
    {
      prefix: "add-lookthrough-pool/",
      title: t({
        de: "Look-through-Pool (add-lookthrough-pool/)",
        en: "Look-through pool (add-lookthrough-pool/)",
      }),
    },
    {
      prefix: "backfill-",
      title: t({
        de: "Look-through Backfill (backfill-)",
        en: "Look-through backfill (backfill-)",
      }),
    },
    {
      prefix: "update-app-defaults/",
      title: t({
        de: "Globale Defaults (update-app-defaults/)",
        en: "Global defaults (update-app-defaults/)",
      }),
    },
  ];
  return (
    <Card data-testid="operations-prs-summary">
      <CardHeader>
        <CardTitle className="text-base">
          {t({
            de: "Offene Pull Requests aller Admin-Flows",
            en: "Open pull requests across all admin flows",
          })}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {groups.map((g) => (
          <PendingPrsCard key={g.prefix} prefix={g.prefix} title={g.title} />
        ))}
      </CardContent>
    </Card>
  );
}
