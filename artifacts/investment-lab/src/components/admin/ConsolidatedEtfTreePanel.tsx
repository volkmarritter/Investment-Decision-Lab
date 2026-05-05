// ConsolidatedEtfTreePanel — single tree view replacing three legacy panels

import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import {
    adminApi,
  type CatalogSummary,
  type LookthroughPoolEntry,
} from "@/lib/admin-api";
import {
  MAX_ALTERNATIVES_PER_BUCKET,
  MAX_POOL_PER_BUCKET,
  validateCatalog,
} from "@/lib/etfs";
import { useAdminT } from "@/lib/admin-i18n";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertTriangle, ChevronDown, ChevronRight, ExternalLink, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { PendingPrsCard } from "./PendingPrsCard";
import { AddAlternativeForm } from "./AddAlternativeForm";
import { BucketRowsTable } from "./BucketRowsTable";
import { InstrumentPicker } from "./InstrumentPicker";
import { UnclassifiedRow } from "./UnclassifiedRow";

export function ConsolidatedEtfTreePanel({
  catalog: _topCatalog,
  catalogError: topCatalogError,
  githubConfigured,
}: {
  catalog: CatalogSummary | null;
  catalogError: string | null;
  githubConfigured: boolean;
}) {
  const { t, lang } = useAdminT();

  const [catalog, setCatalog] = useState<CatalogSummary | null>(null);
  const [catalogLoadError, setCatalogLoadError] = useState<string | null>(null);
  const [pool, setPool] = useState<LookthroughPoolEntry[] | null>(null);
  const [poolLoadError, setPoolLoadError] = useState<string | null>(null);
  const [prsRefreshKey, setPrsRefreshKey] = useState(0);

  const [headerErrMsg, setHeaderErrMsg] = useState<string | null>(null);
  const [backfilling, setBackfilling] = useState(false);
  const [backfillResult, setBackfillResult] = useState<{
    scanned: number;
    missing: number;
    added: string[];
    scrapeFailures: Array<{ isin: string; reason: string }>;
    skippedAlreadyPresent: string[];
    prUrl?: string;
    prNumber?: number;
  } | null>(null);

  const [expandedClasses, setExpandedClasses] = useState<Set<string>>(() => {
    try {
      const raw = sessionStorage.getItem("admin.etfTree.expanded");
      return raw ? new Set(JSON.parse(raw) as string[]) : new Set();
    } catch {
      return new Set();
    }
  });
  const [unclassifiedOpen, setUnclassifiedOpen] = useState<boolean>(() => {
    try {
      return sessionStorage.getItem("admin.etfTree.unclassifiedOpen") === "1";
    } catch {
      return true;
    }
  });
  useEffect(() => {
    try {
      sessionStorage.setItem(
        "admin.etfTree.expanded",
        JSON.stringify([...expandedClasses]),
      );
    } catch {
      /* sessionStorage may be unavailable — graceful no-op */
    }
  }, [expandedClasses]);
  useEffect(() => {
    try {
      sessionStorage.setItem(
        "admin.etfTree.unclassifiedOpen",
        unclassifiedOpen ? "1" : "0",
      );
    } catch {
      /* sessionStorage may be unavailable — graceful no-op */
    }
  }, [unclassifiedOpen]);

  const [attaching, setAttaching] = useState<{
    isin: string;
    presetName?: string;
  } | null>(null);
  const [addingAltKey, setAddingAltKey] = useState<string | null>(null);
  // Tree-row pickers (Task #111). Mutually exclusive across the whole tree
  // — opening one closes the other to keep the page tidy.
  const [pickerOpen, setPickerOpen] = useState<{
    parentKey: string;
    mode: "default" | "alternative" | "pool";
  } | null>(null);

  // ─── Task #122 (T006/T007): referential-integrity surface ─────────────
  // validateCatalog() runs the same look-through ⊆ INSTRUMENTS check the
  // build-time CI test runs (catalog-validate-lookthrough-orphans). If
  // an orphan slips through (e.g. someone hand-edited the JSON without
  // registering the ISIN, or the migration left a stale row), surface
  // it inline with a one-click jump into the Instruments tab pre-filled
  // with the missing ISIN so the operator can fix it without leaving
  // the admin. The list is recomputed on every render — cheap because
  // CATALOG / INSTRUMENTS / look-through getters are all in-memory.
  const integrityIssues = useMemo(() => {
    const all = validateCatalog();
    return all
      .filter(
        (i) =>
          i.bucket === "lookthrough.pool" || i.bucket === "lookthrough.overrides",
      )
      .map((i) => {
        // Pull the ISIN out of the message for the prefill link. Both
        // messages start with "<Pool|Override> ISIN <ISIN> is …".
        const m = /\b([A-Z]{2}[A-Z0-9]{9}\d)\b/.exec(i.message);
        return {
          severity: i.severity,
          bucket: i.bucket as "lookthrough.pool" | "lookthrough.overrides",
          message: i.message,
          isin: m?.[1] ?? null,
        };
      });
  }, []);

  // Load both data sources in parallel. Re-runs whenever a Pull Request succeeds
  // (prsRefreshKey bump) so the post-merge state surfaces quickly.
  useEffect(() => {
    let cancelled = false;
    setCatalogLoadError(null);
    setPoolLoadError(null);
    void Promise.all([
      adminApi.bucketAlternatives().then(
        (r) => !cancelled && setCatalog(r.entries),
        (e: unknown) =>
          !cancelled &&
          setCatalogLoadError(e instanceof Error ? e.message : String(e)),
      ),
      adminApi.lookthroughPool().then(
        (r) => !cancelled && setPool(r.entries),
        (e: unknown) =>
          !cancelled &&
          setPoolLoadError(e instanceof Error ? e.message : String(e)),
      ),
    ]);
    return () => {
      cancelled = true;
    };
  }, [prsRefreshKey]);

  const poolByIsin = useMemo(() => {
    const m = new Map<string, LookthroughPoolEntry>();
    for (const p of pool ?? []) m.set(p.isin.toUpperCase(), p);
    return m;
  }, [pool]);

  const attachedIsins = useMemo(() => {
    const s = new Set<string>();
    if (catalog) {
      for (const entry of Object.values(catalog)) {
        if (entry.isin) s.add(entry.isin.toUpperCase());
        for (const alt of entry.alternatives ?? [])
          if (alt.isin) s.add(alt.isin.toUpperCase());
      }
    }
    return s;
  }, [catalog]);

  const unclassifiedPool = useMemo(() => {
    if (!pool) return [];
    return pool
      .filter((p) => !attachedIsins.has(p.isin.toUpperCase()))
      .sort((a, b) => a.isin.localeCompare(b.isin));
  }, [pool, attachedIsins]);

  const groups = useMemo(() => {
    if (!catalog) return [];
    const byClass = new Map<string, Array<{ key: string; name: string }>>();
    for (const [key, entry] of Object.entries(catalog)) {
      const assetClass = key.split("-")[0] || "Other";
      const list = byClass.get(assetClass) ?? [];
      list.push({ key, name: entry.name });
      byClass.set(assetClass, list);
    }
    const out: Array<{
      assetClass: string;
      label: string;
      entries: Array<{ key: string; name: string }>;
    }> = [];
    for (const [assetClass, entries] of byClass) {
      entries.sort((a, b) => a.key.localeCompare(b.key));
      out.push({
        assetClass,
        label: assetClass.replace(/([a-z])([A-Z])/g, "$1 $2"),
        entries,
      });
    }
    out.sort((a, b) => a.label.localeCompare(b.label));
    return out;
  }, [catalog]);

  function toggleClass(assetClass: string) {
    setExpandedClasses((prev) => {
      const next = new Set(prev);
      if (next.has(assetClass)) next.delete(assetClass);
      else next.add(assetClass);
      return next;
    });
  }
  function expandAll() {
    setExpandedClasses(new Set(groups.map((g) => g.assetClass)));
    setUnclassifiedOpen(true);
  }
  function collapseAll() {
    setExpandedClasses(new Set());
    setUnclassifiedOpen(false);
  }

  // Bulk backfill (header bar). Same endpoint introduced 2026-04-28.
  async function runBackfill() {
    setBackfilling(true);
    setHeaderErrMsg(null);
    setBackfillResult(null);
    try {
      const r = await adminApi.backfillLookthroughPool();
      setBackfillResult({
        scanned: r.scanned,
        missing: r.missing,
        added: r.added,
        scrapeFailures: r.scrapeFailures,
        skippedAlreadyPresent: r.skippedAlreadyPresent,
        prUrl: r.prUrl,
        prNumber: r.prNumber,
      });
      if (r.prNumber && r.prUrl) {
        toast.success(
          lang === "de"
            ? `Bulk-Pull Request #${r.prNumber} mit ${r.added.length} ISIN${r.added.length === 1 ? "" : "s"} geöffnet`
            : `Bulk Pull Request #${r.prNumber} opened with ${r.added.length} ISIN${r.added.length === 1 ? "" : "s"}`,
          {
            action: {
              label: t({ de: "Öffnen", en: "Open" }),
              onClick: () => window.open(r.prUrl, "_blank"),
            },
          },
        );
        setPrsRefreshKey((k) => k + 1);
      } else if (r.missing === 0) {
        toast.success(
          lang === "de"
            ? "Keine fehlenden Look-through-Daten — alle Katalog-ISINs sind abgedeckt."
            : "No missing look-through data — every catalog ISIN is covered.",
        );
      }
    } catch (e: unknown) {
      setHeaderErrMsg(e instanceof Error ? e.message : String(e));
      setPrsRefreshKey((k) => k + 1);
    } finally {
      setBackfilling(false);
    }
  }

  async function removePool(parentKey: string, isin: string, name: string) {
    const confirmed = window.confirm(
      lang === "de"
        ? `Pull-Request öffnen, die "${name}" (${isin}) aus dem Pool von "${parentKey}" entfernt?\n\nDas Instrument bleibt in INSTRUMENTS registriert und kann später in einen anderen Slot oder Bucket gehängt werden.`
        : `Open a pull request removing "${name}" (${isin}) from the "${parentKey}" pool?\n\nThe instrument stays registered in INSTRUMENTS and can be re-attached to another slot or bucket later.`,
    );
    if (!confirmed) return;
    try {
      const r = await adminApi.removeBucketPool(parentKey, isin);
      // Direct-write mode (2026-05): server returns prNumber: 0 / prUrl: "".
      const directWrite = !r.prUrl || r.prNumber === 0;
      toast.success(
        directWrite
          ? lang === "de" ? "Aus Pool entfernt" : "Removed from pool"
          : lang === "de"
            ? `Remove-Pull Request #${r.prNumber} geöffnet`
            : `Remove Pull Request #${r.prNumber} opened`,
        directWrite
          ? undefined
          : {
              action: {
                label: t({ de: "Öffnen", en: "Open" }),
                onClick: () => window.open(r.prUrl, "_blank"),
              },
            },
      );
      setPrsRefreshKey((k) => k + 1);
    } catch (e: unknown) {
      toast.error(
        lang === "de"
          ? `Pool-Entfernen fehlgeschlagen: ${e instanceof Error ? e.message : String(e)}`
          : `Pool remove failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  async function removeAlt(parentKey: string, isin: string, name: string) {
    const confirmed = window.confirm(
      lang === "de"
        ? `Pull-Request öffnen, die "${name}" (${isin}) als Alternative aus "${parentKey}" entfernt?\n\nDer Look-through-Datenpool wird NICHT angetastet — die Holdings/Geo/Sektor-Daten bleiben erhalten.`
        : `Open a pull request removing "${name}" (${isin}) from "${parentKey}"?\n\nThe look-through data pool is NOT touched — holdings/geo/sector data stay available.`,
    );
    if (!confirmed) return;
    try {
      const r = await adminApi.removeBucketAlternative(parentKey, isin);
      // Direct-write mode (2026-05): server returns prNumber: 0 / prUrl: "".
      const directWrite = !r.prUrl || r.prNumber === 0;
      toast.success(
        directWrite
          ? lang === "de" ? "Alternative entfernt" : "Alternative removed"
          : lang === "de"
            ? `Remove-Pull Request #${r.prNumber} geöffnet`
            : `Remove Pull Request #${r.prNumber} opened`,
        directWrite
          ? undefined
          : {
              action: {
                label: t({ de: "Öffnen", en: "Open" }),
                onClick: () => window.open(r.prUrl, "_blank"),
              },
            },
      );
      setPrsRefreshKey((k) => k + 1);
    } catch (e: unknown) {
      toast.error(
        lang === "de"
          ? `Entfernen fehlgeschlagen: ${e instanceof Error ? e.message : String(e)}`
          : `Remove failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  function handlePrCreated() {
    setAddingAltKey(null);
    setAttaching(null);
    setPickerOpen(null);
    setPrsRefreshKey((k) => k + 1);
  }

  return (
    <Card data-testid="card-consolidated-etf-tree">
      <CardHeader>
        <CardTitle className="text-base flex items-center justify-between gap-2">
          <span>
            {t({
              de: "ETF-Übersicht (Buckets + Look-through-Daten)",
              en: "ETF overview (buckets + look-through data)",
            })}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={expandAll}
              className="text-xs text-primary hover:underline"
              data-testid="button-tree-expand-all"
            >
              {t({ de: "Alle ausklappen", en: "Expand all" })}
            </button>
            <span className="text-xs text-muted-foreground">·</span>
            <button
              type="button"
              onClick={collapseAll}
              className="text-xs text-primary hover:underline"
              data-testid="button-tree-collapse-all"
            >
              {t({ de: "Alle einklappen", en: "Collapse all" })}
            </button>
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Header bar: pool-level bulk backfill. The legacy "Add to
            look-through pool only" form was retired with Task #122 — every
            pool ISIN must now also exist in INSTRUMENTS. Three routes for
            getting a new ISIN into the system, all reachable from this page:
              • as a bucket DEFAULT → "Add ISIN" tab (one PR: INSTRUMENTS +
                BUCKETS + look-through);
              • as a bucket ALTERNATIVE → per-row "New instrument …" below
                (one PR: INSTRUMENTS + BUCKETS), OR per-row "+ Alternative"
                if the ISIN is already on the pool shelf (one PR: BUCKETS
                only — promotes the pool entry into a bucket attachment);
              • WITHOUT a bucket assignment → "Instruments" tab → "New
                instrument" (one PR: INSTRUMENTS only — sits on the pool
                shelf until later promoted via "+ Alternative").
            Server-side global-uniqueness invariant: each ISIN can be in at
            most one bucket (default OR one alternative) — the picker
            therefore filters to usage.length === 0 candidates only.
            "Fetch missing data" still belongs here because it only
            scrapes look-through data for ISINs already in INSTRUMENTS. */}
        <div className="rounded-md border bg-muted/30 p-3 space-y-3">
          <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
            <div className="text-xs text-muted-foreground sm:flex-1">
              {lang === "de" ? (
                <>
                  Look-through-Daten für bereits registrierte Katalog-ISINs
                  nachziehen. Eine neue ISIN ins System bringen:{" "}
                  <strong>als Bucket-Default</strong> über den Tab „ISIN
                  hinzufügen“;{" "}
                  <strong>als Bucket-Alternative</strong> über die
                  Zeilen-Buttons unten („Neues Instrument …“, oder
                  „+ Alternative“, wenn die ISIN bereits im Pool liegt);{" "}
                  <strong>ohne Bucket-Zuordnung</strong> (Pool-only, später
                  per „+ Alternative“ promotbar) über den Tab „Instrumente“.
                </>
              ) : (
                <>
                  Refresh look-through data for ISINs already registered in
                  the catalog. To bring a new ISIN into the system:{" "}
                  <strong>as a bucket default</strong> via the “Add ISIN”
                  tab;{" "}
                  <strong>as a bucket alternative</strong> via the per-row
                  buttons below (“New instrument …”, or “+ Alternative” if
                  the ISIN is already on the pool shelf);{" "}
                  <strong>without a bucket assignment</strong> (pool-only,
                  later promotable via “+ Alternative”) via the
                  “Instruments” tab.
                </>
              )}
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => void runBackfill()}
                disabled={backfilling || !githubConfigured}
                data-testid="button-tree-backfill"
                title={t({
                  de: "Scannt Katalog-ISINs ohne Look-through-Daten und öffnet einen gemeinsamen Pull Request (1-2 min).",
                  en: "Scans catalog ISINs without look-through data and opens one combined Pull Request (1-2 min).",
                })}
              >
                {backfilling ? (
                  <>
                    <RefreshCw className="h-4 w-4 animate-spin mr-2" />
                    {t({ de: "Läuft …", en: "Running …" })}
                  </>
                ) : (
                  t({
                    de: "Fehlende Daten holen",
                    en: "Fetch missing data",
                  })
                )}
              </Button>
            </div>
          </div>
          {headerErrMsg && (
            <Alert variant="destructive">
              <AlertTitle>{t({ de: "Fehler", en: "Error" })}</AlertTitle>
              <AlertDescription className="text-xs">
                {headerErrMsg}
              </AlertDescription>
            </Alert>
          )}
          {backfillResult && (
            <Alert
              className={
                backfillResult.prUrl
                  ? "border-emerald-600/40"
                  : "border-amber-600/40"
              }
            >
              <AlertTitle className="text-xs">
                {backfillResult.prUrl
                  ? lang === "de"
                    ? `Bulk-Pull Request #${backfillResult.prNumber} mit ${backfillResult.added.length} ISIN${backfillResult.added.length === 1 ? "" : "s"} geöffnet`
                    : `Bulk Pull Request #${backfillResult.prNumber} opened with ${backfillResult.added.length} ISIN${backfillResult.added.length === 1 ? "" : "s"}`
                  : backfillResult.missing === 0
                    ? t({
                        de: "Alle Katalog-ISINs sind abgedeckt",
                        en: "All catalog ISINs are covered",
                      })
                    : t({
                        de: "Backfill abgeschlossen — kein Pull Request",
                        en: "Backfill done — no Pull Request",
                      })}
              </AlertTitle>
              <AlertDescription className="text-xs space-y-1">
                <div>
                  {lang === "de"
                    ? `${backfillResult.scanned} ISINs gescannt · ${backfillResult.missing} ohne Daten · ${backfillResult.added.length} gescraped · ${backfillResult.scrapeFailures.length} fehlgeschlagen.`
                    : `${backfillResult.scanned} ISINs scanned · ${backfillResult.missing} missing · ${backfillResult.added.length} scraped · ${backfillResult.scrapeFailures.length} failed.`}
                </div>
                {backfillResult.scrapeFailures.length > 0 && (
                  <details>
                    <summary className="cursor-pointer">
                      {t({
                        de: "Fehlgeschlagene ISINs anzeigen",
                        en: "Show failed ISINs",
                      })}
                    </summary>
                    <ul className="list-disc list-inside ml-2 mt-1">
                      {backfillResult.scrapeFailures.map((f) => (
                        <li key={f.isin}>
                          <code>{f.isin}</code> — {f.reason}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
                {backfillResult.prUrl && (
                  <a
                    href={backfillResult.prUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="underline font-medium block mt-1"
                  >
                    {t({ de: "Bulk-Pull Request auf GitHub →", en: "Bulk Pull Request on GitHub →" })}
                  </a>
                )}
              </AlertDescription>
            </Alert>
          )}
        </div>

        {/* Surface catalog + pool load errors separately so neither hides the
            other (the architect-review caught that the previous first-non-null
            precedence could mask a real failure). topCatalogError is only
            mirrored when the panel's own /admin/bucket-alternatives load also
            failed — otherwise the page-level /admin/catalog error would
            confuse the operator while the panel's data renders fine. */}
        {(catalogLoadError ||
          (topCatalogError && !catalog) ||
          poolLoadError) && (
          <Alert variant="destructive">
            <AlertTitle>
              {t({
                de: "Daten konnten nicht geladen werden",
                en: "Data could not be loaded",
              })}
            </AlertTitle>
            <AlertDescription className="text-xs space-y-1">
              {catalogLoadError && (
                <div>
                  <span className="font-medium">
                    {t({ de: "Bucket-Daten:", en: "Bucket data:" })}
                  </span>{" "}
                  {catalogLoadError}
                </div>
              )}
              {!catalogLoadError && topCatalogError && !catalog && (
                <div>
                  <span className="font-medium">
                    {t({ de: "Katalog:", en: "Catalog:" })}
                  </span>{" "}
                  {topCatalogError}
                </div>
              )}
              {poolLoadError && (
                <div>
                  <span className="font-medium">
                    {t({
                      de: "Look-through-Pool:",
                      en: "Look-through pool:",
                    })}
                  </span>{" "}
                  {poolLoadError}
                </div>
              )}
            </AlertDescription>
          </Alert>
        )}

        {/* Task #122 (T006/T007): referential-integrity warning row.
            Surfaces look-through orphans (ISINs in lookthrough.overrides.json
            that have no matching INSTRUMENTS entry) inline in the Browse
            tab so the operator can fix them without leaving the admin.
            Each issue gets a one-click jump into the Instruments tab
            with the missing ISIN pre-filled in the create form. The
            companion build-time test (catalog-validate-lookthrough-orphans)
            also blocks CI on the same condition. */}
        {integrityIssues.length > 0 && (
          <Alert
            variant="destructive"
            data-testid="alert-catalog-integrity-issues"
          >
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>
              {t({
                de: `Referenzintegrität: ${integrityIssues.length} Look-through-Eintrag${integrityIssues.length === 1 ? "" : "e"} ohne INSTRUMENTS-Zeile`,
                en: `Referential integrity: ${integrityIssues.length} look-through entr${integrityIssues.length === 1 ? "y" : "ies"} without an INSTRUMENTS row`,
              })}
            </AlertTitle>
            <AlertDescription className="text-xs space-y-2">
              <p>
                {t({
                  de: "Diese ISINs sind in src/data/lookthrough.overrides.json eingetragen, aber nicht in INSTRUMENTS registriert. Lege sie im Tab „Instrumente“ an, danach verschwindet die Warnung automatisch.",
                  en: "These ISINs are listed in src/data/lookthrough.overrides.json but are not registered in INSTRUMENTS. Register each one in the “Instruments” tab and the warning will clear automatically.",
                })}
              </p>
              <ul className="space-y-1.5">
                {integrityIssues.map((iss, idx) => (
                  <li
                    key={`${iss.bucket}-${iss.isin ?? idx}`}
                    className="flex flex-wrap items-start gap-2"
                    data-testid={`row-integrity-${iss.bucket}-${iss.isin ?? idx}`}
                  >
                    <code className="font-mono text-[11px] px-1 rounded bg-background/50">
                      {iss.bucket === "lookthrough.pool"
                        ? t({ de: "Pool", en: "Pool" })
                        : t({ de: "Override", en: "Override" })}
                    </code>
                    <span className="flex-1 min-w-[12rem]">{iss.message}</span>
                    {iss.isin && (
                      <Link
                        href={`/admin/catalog/instruments?prefillIsin=${encodeURIComponent(iss.isin)}`}
                        data-testid={`link-fix-integrity-${iss.isin}`}
                      >
                        <Button type="button" size="sm" variant="outline">
                          <ExternalLink className="h-3 w-3 mr-1" />
                          {t({
                            de: `Im Tab „Instrumente“ anlegen`,
                            en: `Register in “Instruments”`,
                          })}
                        </Button>
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        )}

        {/* Combined open-Pull Requests strip — alt-add/rm, pool-add/rm and the
            look-through-pool flows all feed into the same tree, so the operator
            should see every pending Pull Request in one place. One card per
            branch prefix because the listOpenPrs filter is per-call. */}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-3">
          <PendingPrsCard
            prefix="add-pool/"
            refreshKey={prsRefreshKey}
            title={t({
              de: "Pool hinzufügen — offene Pull Requests",
              en: "Add pool — open Pull Requests",
            })}
            emptyHint={t({
              de: "Keine offenen Pool-Add-Pull Requests.",
              en: "No open pool-add Pull Requests.",
            })}
          />
          <PendingPrsCard
            prefix="rm-pool/"
            refreshKey={prsRefreshKey}
            title={t({
              de: "Pool entfernen — offene Pull Requests",
              en: "Remove pool — open Pull Requests",
            })}
            emptyHint={t({
              de: "Keine offenen Pool-Remove-Pull Requests.",
              en: "No open pool-remove Pull Requests.",
            })}
          />
          <PendingPrsCard
            prefix="add-alt/"
            refreshKey={prsRefreshKey}
            title={t({
              de: "Alternativen hinzufügen — offene Pull Requests",
              en: "Add alternatives — open Pull Requests",
            })}
            emptyHint={t({
              de: "Keine offenen Alt-Add-Pull Requests.",
              en: "No open alt-add Pull Requests.",
            })}
          />
          <PendingPrsCard
            prefix="rm-alt/"
            refreshKey={prsRefreshKey}
            title={t({
              de: "Alternativen entfernen — offene Pull Requests",
              en: "Remove alternatives — open Pull Requests",
            })}
            emptyHint={t({
              de: "Keine offenen Alt-Remove-Pull Requests.",
              en: "No open alt-remove Pull Requests.",
            })}
          />
          <PendingPrsCard
            prefix="add-lookthrough-pool/"
            refreshKey={prsRefreshKey}
            title={t({
              de: "Look-through-Pool — offene Pull Requests",
              en: "Look-through pool — open Pull Requests",
            })}
            emptyHint={t({
              de: "Keine offenen Pool-Pull Requests.",
              en: "No open pool Pull Requests.",
            })}
          />
        </div>

        {/* Catalog tree */}
        {!catalog && !catalogLoadError && (
          <p className="text-sm text-muted-foreground">
            {t({ de: "Lade …", en: "Loading …" })}
          </p>
        )}
        {catalog && groups.length > 0 && (
          <div className="rounded-md border" data-testid="etf-tree-root">
            {groups.map((g) => {
              const isOpen = expandedClasses.has(g.assetClass);
              return (
                <div key={g.assetClass} className="border-b last:border-b-0">
                  <button
                    type="button"
                    onClick={() => toggleClass(g.assetClass)}
                    aria-expanded={isOpen}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-muted/40"
                    data-testid={`tree-class-${g.assetClass}`}
                  >
                    {isOpen ? (
                      <ChevronDown className="h-4 w-4 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    )}
                    <span className="font-medium">{g.label}</span>
                    <span className="text-xs text-muted-foreground">
                      {g.entries.length}{" "}
                      {lang === "de" ? "Bucket" : "bucket"}
                      {g.entries.length === 1 ? "" : "s"}
                    </span>
                  </button>
                  {isOpen && (
                    <div className="bg-muted/10">
                      {g.entries.map((leaf) => {
                        const entry = catalog[leaf.key];
                        if (!entry) return null;
                        const alts = entry.alternatives ?? [];
                        const bucketPoolEntries = entry.pool ?? [];
                        const altsAtCap =
                          alts.length >= MAX_ALTERNATIVES_PER_BUCKET;
                        const poolAtCap =
                          bucketPoolEntries.length >= MAX_POOL_PER_BUCKET;
                        return (
                          <div
                            key={leaf.key}
                            className="border-t pl-6 pr-3 py-2"
                            data-testid={`tree-bucket-${leaf.key}`}
                          >
                            <div className="flex items-center justify-between gap-2 mb-1">
                              <div className="text-sm">
                                <span className="font-mono text-xs text-primary">
                                  {leaf.key}
                                </span>
                                <span className="text-muted-foreground">
                                  {" "}
                                  ·{" "}
                                </span>
                                <span className="font-medium">{leaf.name}</span>
                              </div>
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-xs text-muted-foreground">
                                  {alts.length}/{MAX_ALTERNATIVES_PER_BUCKET}{" "}
                                  {t({ de: "Alt.", en: "alt." })}
                                </span>
                                <span className="text-xs text-muted-foreground">
                                  {bucketPoolEntries.length}/
                                  {MAX_POOL_PER_BUCKET}{" "}
                                  {t({ de: "Pool", en: "pool" })}
                                </span>
                                {githubConfigured && (
                                  <>
                                    <Button
                                      type="button"
                                      size="sm"
                                      variant={
                                        pickerOpen?.parentKey === leaf.key &&
                                        pickerOpen.mode === "default"
                                          ? "secondary"
                                          : "outline"
                                      }
                                      onClick={() =>
                                        setPickerOpen((cur) =>
                                          cur?.parentKey === leaf.key &&
                                          cur.mode === "default"
                                            ? null
                                            : {
                                                parentKey: leaf.key,
                                                mode: "default",
                                              },
                                        )
                                      }
                                      data-testid={`button-tree-set-default-${leaf.key}`}
                                      title={t({
                                        de: "Default-ISIN dieses Buckets durch ein anderes Instrument aus der Registry ersetzen.",
                                        en: "Replace this bucket's default ISIN with another instrument from the registry.",
                                      })}
                                    >
                                      {pickerOpen?.parentKey === leaf.key &&
                                      pickerOpen.mode === "default"
                                        ? t({ de: "Schließen", en: "Close" })
                                        : t({
                                            de: "Default ändern",
                                            en: "Change default",
                                          })}
                                    </Button>
                                    <Button
                                      type="button"
                                      size="sm"
                                      variant={
                                        pickerOpen?.parentKey === leaf.key &&
                                        pickerOpen.mode === "alternative"
                                          ? "secondary"
                                          : "outline"
                                      }
                                      onClick={() =>
                                        setPickerOpen((cur) =>
                                          cur?.parentKey === leaf.key &&
                                          cur.mode === "alternative"
                                            ? null
                                            : {
                                                parentKey: leaf.key,
                                                mode: "alternative",
                                              },
                                        )
                                      }
                                      disabled={altsAtCap}
                                      title={
                                        altsAtCap
                                          ? t({
                                              de: `Maximal ${MAX_ALTERNATIVES_PER_BUCKET} Alternativen pro Bucket erreicht`,
                                              en: `Maximum ${MAX_ALTERNATIVES_PER_BUCKET} alternatives per bucket reached`,
                                            })
                                          : t({
                                              de: "Bestehendes Instrument als Alternative diesem Bucket hinzufügen.",
                                              en: "Add an existing instrument from the registry as an alternative.",
                                            })
                                      }
                                      data-testid={`button-tree-pick-alt-${leaf.key}`}
                                    >
                                      {pickerOpen?.parentKey === leaf.key &&
                                      pickerOpen.mode === "alternative"
                                        ? t({ de: "Schließen", en: "Close" })
                                        : t({
                                            de: "+ Alternative",
                                            en: "+ Alternative",
                                          })}
                                    </Button>
                                    <Button
                                      type="button"
                                      size="sm"
                                      variant={
                                        pickerOpen?.parentKey === leaf.key &&
                                        pickerOpen.mode === "pool"
                                          ? "secondary"
                                          : "outline"
                                      }
                                      onClick={() =>
                                        setPickerOpen((cur) =>
                                          cur?.parentKey === leaf.key &&
                                          cur.mode === "pool"
                                            ? null
                                            : {
                                                parentKey: leaf.key,
                                                mode: "pool",
                                              },
                                        )
                                      }
                                      disabled={poolAtCap}
                                      title={
                                        poolAtCap
                                          ? t({
                                              de: `Maximal ${MAX_POOL_PER_BUCKET} Pool-Einträge pro Bucket erreicht`,
                                              en: `Maximum ${MAX_POOL_PER_BUCKET} pool entries per bucket reached`,
                                            })
                                          : t({
                                              de: "Bestehendes Instrument zum erweiterten Pool dieses Buckets hinzufügen (in Build und Explain wählbar, ohne Empfehlungs-Status).",
                                              en: "Add an existing instrument to this bucket's extended pool (selectable in Build and Explain, without recommendation status).",
                                            })
                                      }
                                      data-testid={`button-tree-pick-pool-${leaf.key}`}
                                    >
                                      {pickerOpen?.parentKey === leaf.key &&
                                      pickerOpen.mode === "pool"
                                        ? t({ de: "Schließen", en: "Close" })
                                        : t({
                                            de: "+ Pool",
                                            en: "+ Pool",
                                          })}
                                    </Button>
                                    <Button
                                      type="button"
                                      size="sm"
                                      variant={
                                        addingAltKey === leaf.key
                                          ? "secondary"
                                          : "ghost"
                                      }
                                      onClick={() =>
                                        setAddingAltKey((cur) =>
                                          cur === leaf.key ? null : leaf.key,
                                        )
                                      }
                                      disabled={altsAtCap}
                                      data-testid={`button-tree-add-alt-${leaf.key}`}
                                      title={t({
                                        de: "Neues Instrument im selben Schritt anlegen + als Alternative diesem Bucket hinzufügen (justETF-Vorab-Daten).",
                                        en: "Create a new instrument and attach it as an alternative in one step (with justETF defaults).",
                                      })}
                                    >
                                      {addingAltKey === leaf.key
                                        ? t({ de: "Schließen", en: "Close" })
                                        : t({
                                            de: "Neues Instrument …",
                                            en: "New instrument …",
                                          })}
                                    </Button>
                                  </>
                                )}
                              </div>
                            </div>
                            <BucketRowsTable
                              parentKey={leaf.key}
                              defaultEntry={entry}
                              alternatives={alts}
                              bucketPool={bucketPoolEntries}
                              poolByIsin={poolByIsin}
                              onRemoveAlt={removeAlt}
                              onRemovePool={removePool}
                              githubConfigured={githubConfigured}
                            />
                            {pickerOpen?.parentKey === leaf.key && (
                              <div className="mt-2">
                                <InstrumentPicker
                                  parentKey={leaf.key}
                                  mode={pickerOpen.mode}
                                  onSubmitted={handlePrCreated}
                                  onCancel={() => setPickerOpen(null)}
                                />
                              </div>
                            )}
                            {addingAltKey === leaf.key && (
                              <div className="mt-2">
                                <AddAlternativeForm
                                  parentKey={leaf.key}
                                  githubConfigured={githubConfigured}
                                  onCreated={handlePrCreated}
                                />
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* "Nicht zugeordnet" group — pool ISINs with no bucket attachment.
            Each row gets a "Bucket zuordnen" action that pre-fills the
            standard AddAlternativeForm with the ISIN. Operator picks the
            target bucket via the inline form (justETF preview still runs
            so non-pool fields like name/TER/AUM get autofilled). */}
        {pool && (
          <div className="rounded-md border" data-testid="etf-tree-unclassified">
            <button
              type="button"
              onClick={() => setUnclassifiedOpen((v) => !v)}
              className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-muted/40"
              data-testid="tree-unclassified-toggle"
            >
              {unclassifiedOpen ? (
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              ) : (
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              )}
              <span className="font-medium">
                {t({
                  de: "Noch nicht zugeordnet",
                  en: "Not classified yet",
                })}
              </span>
              <span className="text-xs text-muted-foreground">
                {unclassifiedPool.length}{" "}
                {lang === "de"
                  ? `Pool-Eintr${unclassifiedPool.length === 1 ? "ag" : "äge"} ohne Bucket`
                  : `pool entr${unclassifiedPool.length === 1 ? "y" : "ies"} without bucket`}
              </span>
            </button>
            {unclassifiedOpen && (
              <div className="bg-muted/10 px-3 py-2 space-y-2">
                {unclassifiedPool.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    {t({
                      de: "Alle Pool-Einträge sind mindestens einem Bucket zugeordnet.",
                      en: "Every pool entry is attached to at least one bucket.",
                    })}
                  </p>
                ) : (
                  unclassifiedPool.map((p) => (
                    <UnclassifiedRow
                      key={p.isin}
                      poolEntry={p}
                      attaching={attaching}
                      onAttachOpen={() =>
                        setAttaching((cur) =>
                          cur?.isin === p.isin
                            ? null
                            : { isin: p.isin, presetName: p.name ?? undefined },
                        )
                      }
                      onCreated={handlePrCreated}
                      catalogKeys={Object.keys(catalog ?? {})}
                      githubConfigured={githubConfigured}
                    />
                  ))
                )}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
