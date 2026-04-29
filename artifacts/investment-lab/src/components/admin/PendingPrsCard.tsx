// PendingPrsCard — list of open pull requests for one admin branch prefix.
// Pass a fresh `refreshKey` value to trigger a refetch after opening a PR.

import { useCallback, useEffect, useState } from "react";
import { adminApi, type OpenPrInfo } from "@/lib/admin-api";
import { useAdminT } from "@/lib/admin-i18n";
import { ExternalLink, GitPullRequest, RefreshCw } from "lucide-react";

export function PendingPrsCard({
  prefix,
  refreshKey = 0,
  emptyHint,
  title,
}: {
  prefix: string;
  refreshKey?: number;
  emptyHint?: React.ReactNode;
  title?: React.ReactNode;
}) {
  const { t, lang } = useAdminT();
  const [prs, setPrs] = useState<OpenPrInfo[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [errMsg, setErrMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErrMsg(null);
    try {
      const r = await adminApi.listOpenPrs(prefix);
      setPrs(r.prs);
      if (r.message) setErrMsg(r.message);
    } catch (e: unknown) {
      setErrMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [prefix]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const fmtAge = (iso: string) => {
    const ms = Date.now() - new Date(iso).getTime();
    if (ms < 60_000) return lang === "de" ? "gerade eben" : "just now";
    const m = Math.floor(ms / 60_000);
    if (m < 60) return lang === "de" ? `vor ${m} Min` : `${m} min ago`;
    const h = Math.floor(m / 60);
    if (h < 48) return lang === "de" ? `vor ${h} Std` : `${h} h ago`;
    const d = Math.floor(h / 24);
    return lang === "de" ? `vor ${d} Tagen` : `${d} d ago`;
  };

  return (
    <div
      className="rounded-md border border-border bg-muted/30 p-3 space-y-2"
      data-testid={`pending-prs-${prefix.replace(/[^a-z0-9]+/gi, "-")}`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <GitPullRequest className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">
            {title ??
              t({
                de: "Offene Pull Requests (warten auf Merge)",
                en: "Open pull requests (awaiting merge)",
              })}
          </span>
          {prs && (
            <span className="text-xs text-muted-foreground">
              {prs.length}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
          title={t({ de: "Aktualisieren", en: "Refresh" })}
          data-testid={`pending-prs-refresh-${prefix.replace(/[^a-z0-9]+/gi, "-")}`}
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>
      {errMsg && (
        <p className="text-xs text-destructive">{errMsg}</p>
      )}
      {!errMsg && prs && prs.length === 0 && (
        <p className="text-xs text-muted-foreground">
          {emptyHint ??
            t({
              de: "Keine offenen Pull Requests in diesem Flow.",
              en: "No open pull requests in this flow.",
            })}
        </p>
      )}
      {prs && prs.length > 0 && (
        <ul className="space-y-1.5">
          {prs.map((p) => (
            <li
              key={p.number}
              className="flex items-center justify-between gap-3 text-sm"
              data-testid={`pending-pr-${p.number}`}
            >
              <div className="min-w-0 flex-1">
                <span className="font-medium">#{p.number}</span>
                {p.draft && (
                  <span className="ml-1.5 text-xs text-muted-foreground">
                    {t({ de: "(Entwurf)", en: "(draft)" })}
                  </span>
                )}
                <span className="ml-2 truncate">{p.title}</span>
                <span className="ml-2 text-xs text-muted-foreground">
                  · {fmtAge(p.createdAt)}
                </span>
              </div>
              <a
                href={p.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs text-primary hover:underline shrink-0"
                data-testid={`pending-pr-link-${p.number}`}
              >
                {t({ de: "Öffnen", en: "Open" })}
                <ExternalLink className="h-3 w-3" />
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
