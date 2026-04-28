// ----------------------------------------------------------------------------
// Admin.tsx — /admin route
// ----------------------------------------------------------------------------
// Single-operator admin pane. Two-pane layout once authed:
//   Left  — paste an ISIN, preview scraped fields, edit, click Add to open a PR.
//   Right — recent data changes, recent runs, freshness summary.
//
// Auth: shared-secret bearer token entered once per browser tab. We do NOT
// persist it across tabs (sessionStorage, not localStorage) because the
// token unlocks PR creation against the user's GitHub repo.
// ----------------------------------------------------------------------------

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  adminApi,
  clearToken,
  getToken,
  setToken,
  type AddEtfRequest,
  type AppDefaultsAssetKey,
  type AppDefaultsHbCurrency,
  type AppDefaultsPayload,
  type AppDefaultsRfCurrency,
  type CatalogSummary,
  type CatalogEntrySummary,
  type AddBucketAlternativeRequest,
  type AlternativeEntrySummary,
  type BulkAltLookthroughStatus,
  type BulkAltRowOutcome,
  type BulkAltRowStatus,
  type BulkBucketAlternativesResponse,
  type ChangeEntry,
  type FreshnessResponse,
  type LookthroughPoolEntry,
  type OpenPrInfo,
  type PreviewResponse,
  type RunLogRow,
  type WorkspaceSyncPullResponse,
  type WorkspaceSyncStatus,
} from "@/lib/admin-api";
import { classifyDraft, type ClassifyResult } from "@/lib/catalog-classify";
import {
  APP_DEFAULTS_PRESETS,
  applyPresetToFields,
  findPresetById,
} from "@/lib/appDefaultsPresets";
import { BUILT_IN_RF, BUILT_IN_HB } from "@/lib/settings";
import { MAX_ALTERNATIVES_PER_BUCKET } from "@/lib/etfs";
import { BASE_SEED } from "@/lib/metrics";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ThemeToggle } from "@/components/theme-toggle";
import { LangToggle } from "@/components/lang-toggle";
import { DocsPanel } from "@/components/admin/DocsPanel";
import { EtfLookthroughDialog } from "@/components/investment/EtfLookthroughDialog";
import { useAdminT } from "@/lib/admin-i18n";
import {
  ChevronDown,
  ChevronRight,
  ExternalLink,
  GitBranch,
  GitPullRequest,
  Layers,
  LogOut,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import {
  BucketTree,
  BucketTreeBulkToggle,
  groupCatalogByAssetClass,
} from "@/components/BucketTree";

type Replication = AddEtfRequest["replication"];
type Distribution = AddEtfRequest["distribution"];
type Exchange = AddEtfRequest["defaultExchange"];

const REPLICATIONS: Replication[] = [
  "Physical",
  "Physical (sampled)",
  "Synthetic",
];
const DISTRIBUTIONS: Distribution[] = ["Accumulating", "Distributing"];
const EXCHANGES: Exchange[] = ["LSE", "XETRA", "SIX", "Euronext"];

export default function Admin() {
  const { t } = useAdminT();
  const [token, setLocalToken] = useState<string | null>(getToken());
  const [authError, setAuthError] = useState<string | null>(null);
  const [githubConfigured, setGithubConfigured] = useState(false);
  const [githubInfo, setGithubInfo] = useState<{
    owner: string | null;
    repo: string | null;
    baseBranch: string;
  }>({ owner: null, repo: null, baseBranch: "main" });
  // Catalog is loaded once at the page level and shared with both the
  // "Browse existing buckets" overview and the SuggestIsinPanel's
  // replace-vs-add classifier — avoids two parallel fetches on mount.
  const [catalog, setCatalog] = useState<CatalogSummary | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);

  // Re-validate the stored token on mount.
  useEffect(() => {
    if (!token) return;
    adminApi
      .whoami(token)
      .then((r) => {
        setGithubConfigured(r.githubConfigured);
        setGithubInfo({
          owner: r.githubOwner,
          repo: r.githubRepo,
          baseBranch: r.githubBaseBranch,
        });
      })
      .catch((e: Error) => {
        setAuthError(e.message);
        setLocalToken(null);
        clearToken();
      });
  }, [token]);

  // Load the catalog once (after auth succeeds) so both panels can read it.
  useEffect(() => {
    if (!token) return;
    adminApi
      .catalog()
      .then((r) => {
        setCatalog(r.entries);
        setCatalogError(null);
      })
      .catch((e: Error) => setCatalogError(e.message));
  }, [token]);

  if (!token) {
    return (
      <TokenPrompt
        error={authError}
        onSubmit={(t) => {
          setToken(t);
          setLocalToken(t);
          setAuthError(null);
        }}
      />
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-40 w-full border-b border-border bg-background/95 backdrop-blur">
        <div className="container mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="bg-primary/10 p-2 rounded-lg text-primary">
              <Layers className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-lg font-bold leading-none tracking-tight">
                {t({ de: "Admin", en: "Admin" })}
              </h1>
              <p className="text-xs text-muted-foreground">
                {t({
                  de: "Investment Decision Lab — Operator-Bereich",
                  en: "Investment Decision Lab — Operator console",
                })}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <LangToggle />
            <ThemeToggle />
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                clearToken();
                setLocalToken(null);
              }}
            >
              <LogOut className="h-4 w-4 mr-1" />{" "}
              {t({ de: "Abmelden", en: "Sign out" })}
            </Button>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8 space-y-6">
        <DocsPanel github={githubInfo} />
        {/* Workspace sync (Task #51, 2026-04-28). Sits at the top so
            operators see the local-vs-origin gap BEFORE queueing any
            add-alternative work — the per-row preflight reads the
            catalog from disk and a stale checkout produces ghost
            "parent_missing" / "duplicate_isin" outcomes. */}
        <WorkspaceSyncPanel />
        {/* Consolidated tree (2026-04-28): replaces the former trio
            BrowseBucketsPanel + LookthroughPoolPanel + BucketAlternativesPanel.
            All bucket / alternative / pool data is now rendered in one
            bucket-first tree with look-through columns inline; pool
            ISINs without a bucket attachment land in the "Nicht
            zugeordnet" group at the bottom. */}
        <ConsolidatedEtfTreePanel
          catalog={catalog}
          catalogError={catalogError}
          githubConfigured={githubConfigured}
        />
        {/* Batch-add (Task #51, 2026-04-28). Sits next to the per-bucket
            single-add form (which lives inside the consolidated tree
            above). The single-add path stays for ad-hoc one-offs;
            batch is the path when the operator has a list. */}
        <BatchAddAlternativesPanel githubConfigured={githubConfigured} />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <SuggestIsinPanel
            githubConfigured={githubConfigured}
            catalog={catalog}
            catalogError={catalogError}
          />
          <DataUpdatesColumn />
        </div>
        <AppDefaultsPanel githubConfigured={githubConfigured} />
      </main>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Token prompt
// ---------------------------------------------------------------------------
function TokenPrompt({
  error,
  onSubmit,
}: {
  error: string | null;
  onSubmit: (token: string) => void;
}) {
  const { t, lang, setLang } = useAdminT();
  const [value, setValue] = useState("");
  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>
              {t({ de: "Admin-Anmeldung", en: "Admin sign-in" })}
            </CardTitle>
            <button
              type="button"
              onClick={() => setLang(lang === "de" ? "en" : "de")}
              className="text-xs text-muted-foreground underline"
              data-testid="button-token-lang-toggle"
            >
              {lang === "de" ? "EN" : "DE"}
            </button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            {lang === "de" ? (
              <>
                Bitte das Admin-Token eingeben (auf dem api-server als{" "}
                <code>ADMIN_TOKEN</code> hinterlegt). Das Token wird nur für
                diesen Browser-Tab gespeichert.
              </>
            ) : (
              <>
                Enter the admin token (configured on the api-server as{" "}
                <code>ADMIN_TOKEN</code>). The token is stored for this browser
                tab only.
              </>
            )}
          </p>
          <Input
            type="password"
            placeholder={t({ de: "Admin-Token", en: "Admin token" })}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && value.trim()) onSubmit(value.trim());
            }}
            data-testid="input-admin-token"
          />
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <Button
            className="w-full"
            disabled={!value.trim()}
            onClick={() => onSubmit(value.trim())}
            data-testid="button-admin-signin"
          >
            {t({ de: "Anmelden", en: "Sign in" })}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Top — Browse existing buckets (collapsible quick-reference)
// ---------------------------------------------------------------------------
// Reads the same /admin/catalog response everyone else uses, groups entries
// by their leading "<AssetClass>-…" prefix, and renders one column per
// asset class so the operator can scan all 21 buckets without leaving the
// page. Collapsed by default to keep the form above the fold; expanded
// state is remembered for the browser tab.
function BrowseBucketsPanel({
  catalog,
  catalogError,
}: {
  catalog: CatalogSummary | null;
  catalogError: string | null;
}) {
  const { t, lang } = useAdminT();
  const [open, setOpen] = useState<boolean>(() => {
    try {
      return sessionStorage.getItem("admin.browseBuckets.open") === "1";
    } catch {
      return false;
    }
  });

  function toggle() {
    setOpen((prev) => {
      const next = !prev;
      try {
        sessionStorage.setItem(
          "admin.browseBuckets.open",
          next ? "1" : "0",
        );
      } catch {
        // sessionStorage may be unavailable (private mode, sandbox); the
        // panel still works, the preference just doesn't persist.
      }
      return next;
    });
  }

  // Per-asset-class expansion state for the tree. Persisted in
  // sessionStorage as a JSON array of class names so the operator's
  // drilled-in view survives page reloads within the same tab.
  const [expandedClasses, setExpandedClasses] = useState<Set<string>>(() => {
    try {
      const raw = sessionStorage.getItem("admin.browseBuckets.expanded");
      if (!raw) return new Set();
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? new Set(parsed.map(String)) : new Set();
    } catch {
      return new Set();
    }
  });

  useEffect(() => {
    try {
      sessionStorage.setItem(
        "admin.browseBuckets.expanded",
        JSON.stringify(Array.from(expandedClasses)),
      );
    } catch {
      // see comment above on sessionStorage availability
    }
  }, [expandedClasses]);

  function toggleClass(assetClass: string) {
    setExpandedClasses((prev) => {
      const next = new Set(prev);
      if (next.has(assetClass)) next.delete(assetClass);
      else next.add(assetClass);
      return next;
    });
  }

  const groups = useMemo(() => groupCatalogByAssetClass(catalog), [catalog]);
  const total = catalog ? Object.keys(catalog).length : 0;

  return (
    <Card>
      <CardHeader className="py-3">
        <button
          type="button"
          onClick={toggle}
          aria-expanded={open}
          className="flex w-full items-center justify-between gap-2 text-left"
          data-testid="button-toggle-buckets"
        >
          <CardTitle className="text-base flex items-center gap-2">
            {open ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
            {t({
              de: "Bestehende Buckets durchsuchen",
              en: "Browse existing buckets",
            })}
            {total > 0 && (
              <span className="text-xs font-normal text-muted-foreground">
                {lang === "de"
                  ? `${total} Bucket${total === 1 ? "" : "s"} in ${groups.length} Asset-Klasse${groups.length === 1 ? "" : "n"}`
                  : `${total} bucket${total === 1 ? "" : "s"} across ${groups.length} asset class${groups.length === 1 ? "" : "es"}`}
              </span>
            )}
          </CardTitle>
          <span className="text-xs text-muted-foreground">
            {open
              ? t({ de: "Verbergen", en: "Hide" })
              : t({ de: "Anzeigen", en: "Show" })}
          </span>
        </button>
      </CardHeader>
      {open && (
        <CardContent className="pt-0">
          {catalogError && (
            <Alert variant="destructive" className="mb-4">
              <AlertTitle>
                {t({
                  de: "Katalog konnte nicht geladen werden",
                  en: "Catalog could not be loaded",
                })}
              </AlertTitle>
              <AlertDescription>{catalogError}</AlertDescription>
            </Alert>
          )}
          {!catalog && !catalogError && (
            <p className="text-sm text-muted-foreground">
              {t({ de: "Lade …", en: "Loading …" })}
            </p>
          )}
          {catalog && groups.length > 0 && (
            <>
              <div className="flex items-center justify-between mb-3 gap-3">
                <p className="text-xs text-muted-foreground">
                  {lang === "de" ? (
                    <>
                      Namens­konvention:{" "}
                      <code>&lt;AssetClass&gt;-&lt;Region oder Thema&gt;[-&lt;Hedge oder Variante&gt;]</code>
                      . Auf einen Key klicken, um ihn ins Katalog-Key-Feld
                      unten zu kopieren.
                    </>
                  ) : (
                    <>
                      Naming convention:{" "}
                      <code>&lt;AssetClass&gt;-&lt;Region or theme&gt;[-&lt;Hedge or variant&gt;]</code>
                      . Click a key to copy it into the catalog-key field
                      below.
                    </>
                  )}
                </p>
                <BucketTreeBulkToggle
                  groups={groups}
                  expanded={expandedClasses}
                  onChange={setExpandedClasses}
                />
              </div>
              <BucketTree
                groups={groups}
                expanded={expandedClasses}
                onToggleClass={toggleClass}
                onLeafClick={(leaf) => copyBucketKey(leaf.key)}
              />
            </>
          )}
        </CardContent>
      )}
    </Card>
  );
}

function copyBucketKey(key: string) {
  // Best-effort: copy to clipboard AND mirror the value into the catalog-key
  // input if it's currently mounted. Either path is enough for the operator
  // to feed the form without retyping.
  try {
    void navigator.clipboard?.writeText(key);
  } catch {
    // Older browsers / insecure contexts — silently ignore; the input mirror
    // below still works.
  }
  const input = document.querySelector<HTMLInputElement>(
    'input[data-testid="input-key"]',
  );
  if (input) {
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    )?.set;
    setter?.call(input, key);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.focus();
  }
  // The toast lives outside any React component so it has no access to
  // useAdminT(). Use a single string that works in both languages.
  toast.success(`${key} → copied / kopiert`);
}

// ---------------------------------------------------------------------------
// Left pane — Suggest an ISIN
// ---------------------------------------------------------------------------
function SuggestIsinPanel({
  githubConfigured,
  catalog,
  catalogError,
}: {
  githubConfigured: boolean;
  catalog: CatalogSummary | null;
  catalogError: string | null;
}) {
  const { t, lang } = useAdminT();
  const [isin, setIsin] = useState("");
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [draft, setDraft] = useState<AddEtfRequest | null>(null);
  const [errMsg, setErrMsg] = useState<string | null>(null);
  // Bumped after every successful or failed PR-creating action so the
  // embedded PendingPrsCard refetches and shows the new (or pre-existing,
  // in the 422-"branch already exists" case) PR without manual reload.
  const [prsRefreshKey, setPrsRefreshKey] = useState(0);

  async function runPreview() {
    setErrMsg(null);
    setLoading(true);
    setPreview(null);
    setDraft(null);
    try {
      const p = await adminApi.preview(isin.trim().toUpperCase());
      setPreview(p);
      setDraft(buildDraftFromPreview(p));
    } catch (e: unknown) {
      setErrMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  async function submitPr() {
    if (!draft) return;
    setSubmitting(true);
    setErrMsg(null);
    try {
      const r = await adminApi.addIsin(draft);
      toast.success(t({ de: "Pull-Request geöffnet", en: "Pull request opened" }), {
        description: r.prUrl,
        action: {
          label: t({ de: "Öffnen", en: "Open" }),
          onClick: () => window.open(r.prUrl, "_blank"),
        },
      });
      setIsin("");
      setPreview(null);
      setDraft(null);
      setPrsRefreshKey((k) => k + 1);
    } catch (e: unknown) {
      setErrMsg(e instanceof Error ? e.message : String(e));
      // Auch im Fehlerfall (z.B. "branch already exists") aktualisieren —
      // genau dann ist der bereits-existierende PR die Information, die
      // der Operator sehen muss.
      setPrsRefreshKey((k) => k + 1);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t({ de: "ISIN vorschlagen", en: "Suggest ISIN" })}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex gap-2">
          <Input
            placeholder={t({ de: "z. B. IE00B5BMR087", en: "e.g. IE00B5BMR087" })}
            value={isin}
            onChange={(e) => setIsin(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && isin.trim()) runPreview();
            }}
            data-testid="input-isin"
          />
          <Button
            onClick={runPreview}
            disabled={loading || !isin.trim()}
            data-testid="button-preview"
          >
            {loading ? (
              <RefreshCw className="h-4 w-4 animate-spin" />
            ) : (
              t({ de: "Vorschau", en: "Preview" })
            )}
          </Button>
        </div>
        {errMsg && (
          <Alert variant="destructive">
            <AlertTitle>{t({ de: "Fehler", en: "Error" })}</AlertTitle>
            <AlertDescription>{errMsg}</AlertDescription>
          </Alert>
        )}
        {catalogError && (
          <Alert variant="destructive">
            <AlertTitle>
              {t({
                de: "Katalog konnte nicht geladen werden",
                en: "Catalog could not be loaded",
              })}
            </AlertTitle>
            <AlertDescription>
              {lang === "de" ? (
                <>
                  {catalogError} — der Replace-vs-Add-Vergleich ist nicht
                  verfügbar, bis dies behoben ist.
                </>
              ) : (
                <>
                  {catalogError} — the replace-vs-add comparison is not
                  available until this is fixed.
                </>
              )}
            </AlertDescription>
          </Alert>
        )}
        {!githubConfigured && draft && (
          <Alert>
            <AlertTitle>
              {t({
                de: "GitHub nicht konfiguriert",
                en: "GitHub not configured",
              })}
            </AlertTitle>
            <AlertDescription>
              {lang === "de" ? (
                <>
                  Setze <code>GITHUB_PAT</code>, <code>GITHUB_OWNER</code> und{" "}
                  <code>GITHUB_REPO</code> auf dem api-server, um PRs erzeugen
                  zu können.
                </>
              ) : (
                <>
                  Set <code>GITHUB_PAT</code>, <code>GITHUB_OWNER</code> and{" "}
                  <code>GITHUB_REPO</code> on the api-server to enable opening
                  PRs.
                </>
              )}
            </AlertDescription>
          </Alert>
        )}
        {preview && draft && (
          <PreviewEditor
            preview={preview}
            draft={draft}
            onChange={setDraft}
            onSubmit={submitPr}
            submitting={submitting}
            githubConfigured={githubConfigured}
            catalog={catalog}
          />
        )}
        <PendingPrsCard
          prefix="add-etf/"
          refreshKey={prsRefreshKey}
          emptyHint={t({
            de: "Keine offenen ETF-PRs — alle Vorschläge sind gemerged.",
            en: "No open ETF PRs — all suggestions are merged.",
          })}
        />
      </CardContent>
    </Card>
  );
}

function PreviewEditor({
  preview,
  draft,
  onChange,
  onSubmit,
  submitting,
  githubConfigured,
  catalog,
}: {
  preview: PreviewResponse;
  draft: AddEtfRequest;
  onChange: (d: AddEtfRequest) => void;
  onSubmit: () => void;
  submitting: boolean;
  githubConfigured: boolean;
  catalog: CatalogSummary | null;
}) {
  const { t, lang } = useAdminT();
  const set = <K extends keyof AddEtfRequest>(k: K, v: AddEtfRequest[K]) =>
    onChange({ ...draft, [k]: v });

  const classification = useMemo<ClassifyResult | null>(() => {
    if (!catalog) return null;
    return classifyDraft(catalog, draft.key, draft.isin);
  }, [catalog, draft.key, draft.isin]);

  const blockedByDuplicate = classification?.state === "DUPLICATE_ISIN";

  return (
    <div className="space-y-4 border rounded-md p-4 bg-muted/30">
      <div className="flex items-center justify-between">
        <div>
          <div className="font-medium">
            {draft.name ||
              t({ de: "(kein Name erkannt)", en: "(no name detected)" })}
          </div>
          <div className="text-xs text-muted-foreground">{draft.isin}</div>
        </div>
        <div className="flex gap-2">
          <Badge variant={preview.policyFit.aumOk ? "default" : "destructive"}>
            AUM{" "}
            {preview.policyFit.aumOk
              ? "OK"
              : t({ de: "ungenügend", en: "insufficient" })}
          </Badge>
          <Badge variant={preview.policyFit.terOk ? "default" : "destructive"}>
            TER{" "}
            {preview.policyFit.terOk
              ? "OK"
              : t({ de: "ungenügend", en: "insufficient" })}
          </Badge>
        </div>
      </div>

      <a
        href={preview.sourceUrl}
        target="_blank"
        rel="noreferrer"
        className="text-xs text-primary underline"
      >
        {t({ de: "Auf justETF ansehen →", en: "View on justETF →" })}
      </a>

      <Separator />

      <div className="grid grid-cols-2 gap-3">
        <Field label={t({ de: "Katalog-Key", en: "Catalog key" })}>
          <Input
            value={draft.key}
            onChange={(e) => set("key", e.target.value)}
            list="catalog-key-suggestions"
            placeholder="Equity-USA, FixedIncome-Global, …"
            data-testid="input-key"
          />
          {/* Native HTML5 autocomplete: shows every existing catalog key
              as a suggestion when you focus the field, but you can still
              type a brand-new key (needed for the NEW BUCKET case). The
              datalist itself doesn't render group headings, so we sort
              alphabetically — that already groups by prefix
              (Commodities-…, DigitalAssets-…, Equity-…, FixedIncome-…,
              RealEstate-…) which is the most useful grouping in
              practice. */}
          <datalist id="catalog-key-suggestions">
            {catalog
              ? Object.keys(catalog)
                  .sort((a, b) => a.localeCompare(b))
                  .map((k) => <option key={k} value={k} />)
              : null}
          </datalist>
          <p className="text-[11px] text-muted-foreground mt-1">
            {lang === "de" ? (
              <>
                Existierenden Key wählen, um einen Bucket zu{" "}
                <strong>ersetzen</strong>, oder einen neuen tippen (z. B.{" "}
                <code>Equity-AI</code>), um einen neuen Bucket{" "}
                <strong>hinzuzufügen</strong>.
              </>
            ) : (
              <>
                Pick an existing key to <strong>replace</strong> a bucket, or
                type a new one (e.g. <code>Equity-AI</code>) to{" "}
                <strong>add</strong> a new bucket.
              </>
            )}
          </p>
        </Field>
        <Field label={t({ de: "Name", en: "Name" })}>
          <Input
            value={draft.name}
            onChange={(e) => set("name", e.target.value)}
          />
        </Field>
        <Field label={t({ de: "TER (bps)", en: "TER (bps)" })}>
          <Input
            type="number"
            value={draft.terBps}
            onChange={(e) => set("terBps", Number(e.target.value))}
          />
        </Field>
        <Field label={t({ de: "AUM (Mio. EUR)", en: "AUM (EUR mn)" })}>
          <Input
            type="number"
            value={draft.aumMillionsEUR ?? ""}
            onChange={(e) =>
              set(
                "aumMillionsEUR",
                e.target.value === "" ? undefined : Number(e.target.value),
              )
            }
          />
        </Field>
        <Field label={t({ de: "Domizil", en: "Domicile" })}>
          <Input
            value={draft.domicile}
            onChange={(e) => set("domicile", e.target.value)}
          />
        </Field>
        <Field label={t({ de: "Währung", en: "Currency" })}>
          <Input
            value={draft.currency}
            onChange={(e) => set("currency", e.target.value.toUpperCase())}
          />
        </Field>
        <Field label={t({ de: "Replikation", en: "Replication" })}>
          <Select
            value={draft.replication}
            onValueChange={(v) => set("replication", v as Replication)}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {REPLICATIONS.map((r) => (
                <SelectItem key={r} value={r}>
                  {r}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label={t({ de: "Ausschüttung", en: "Distribution" })}>
          <Select
            value={draft.distribution}
            onValueChange={(v) => set("distribution", v as Distribution)}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DISTRIBUTIONS.map((d) => (
                <SelectItem key={d} value={d}>
                  {d}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label={t({ de: "Auflagedatum", en: "Inception date" })}>
          <Input
            placeholder={t({ de: "JJJJ-MM-TT", en: "YYYY-MM-DD" })}
            value={draft.inceptionDate ?? ""}
            onChange={(e) =>
              set("inceptionDate", e.target.value || undefined)
            }
          />
        </Field>
        <Field label={t({ de: "Standard-Börse", en: "Default exchange" })}>
          <Select
            value={draft.defaultExchange}
            onValueChange={(v) => set("defaultExchange", v as Exchange)}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {EXCHANGES.map((x) => (
                <SelectItem key={x} value={x}>
                  {x}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </div>

      <Field
        label={t({
          de: "Kommentar (wird in Tooltips angezeigt)",
          en: "Comment (shown in tooltips)",
        })}
      >
        <Textarea
          rows={2}
          value={draft.comment}
          onChange={(e) => set("comment", e.target.value)}
        />
      </Field>

      <div>
        <Label className="text-xs">
          {t({
            de: "Listings (Ticker je Börse)",
            en: "Listings (ticker per exchange)",
          })}
        </Label>
        <div className="grid grid-cols-2 gap-2 mt-1">
          {EXCHANGES.map((ex) => (
            <div key={ex} className="flex items-center gap-2">
              <span className="text-xs w-16">{ex}</span>
              <Input
                placeholder={t({ de: "(keine)", en: "(none)" })}
                value={draft.listings[ex]?.ticker ?? ""}
                onChange={(e) => {
                  const next = { ...draft.listings };
                  if (e.target.value.trim()) {
                    next[ex] = { ticker: e.target.value.trim() };
                  } else {
                    delete next[ex];
                  }
                  onChange({ ...draft, listings: next });
                }}
              />
            </div>
          ))}
        </div>
      </div>

      <DiffPanel classification={classification} draft={draft} />

      <Button
        className="w-full"
        onClick={onSubmit}
        disabled={submitting || !githubConfigured || blockedByDuplicate}
        data-testid="button-submit-pr"
      >
        {submitting
          ? t({ de: "PR wird geöffnet …", en: "Opening PR …" })
          : blockedByDuplicate
            ? t({
                de: "ISIN-Konflikt oben beheben, um fortzufahren",
                en: "Resolve the ISIN conflict above to continue",
              })
            : classification?.state === "REPLACE"
              ? t({
                  de: "PR öffnen: bestehenden Eintrag ersetzen",
                  en: "Open PR: replace existing entry",
                })
              : t({
                  de: "PR öffnen: zum Katalog hinzufügen",
                  en: "Open PR: add to catalog",
                })}
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Replace-vs-add diff panel
// ---------------------------------------------------------------------------
function DiffPanel({
  classification,
  draft,
}: {
  classification: ClassifyResult | null;
  draft: AddEtfRequest;
}) {
  const { t, lang } = useAdminT();
  if (!classification) {
    return (
      <div className="text-xs text-muted-foreground" data-testid="diff-panel-loading">
        {t({ de: "Katalog wird geladen …", en: "Loading catalog …" })}
      </div>
    );
  }

  if (classification.state === "DUPLICATE_ISIN") {
    return (
      <div
        className="border border-destructive/40 rounded-md p-3 bg-destructive/10 space-y-2"
        data-testid="diff-panel-duplicate"
      >
        <div className="flex items-center gap-2">
          <Badge variant="destructive">
            {t({ de: "Doppelte ISIN", en: "Duplicate ISIN" })}
          </Badge>
          <span className="text-sm">
            {lang === "de" ? (
              <>
                Diese ISIN wird bereits von{" "}
                <code className="font-mono text-xs">
                  {classification.conflictKey}
                </code>{" "}
                verwendet.
              </>
            ) : (
              <>
                This ISIN is already used by{" "}
                <code className="font-mono text-xs">
                  {classification.conflictKey}
                </code>
                .
              </>
            )}
          </span>
        </div>
        <p className="text-xs text-muted-foreground">
          {lang === "de" ? (
            <>
              Bestehender Eintrag: <strong>{classification.conflict.name}</strong>{" "}
              ({classification.conflict.isin}). Vor dem PR die ISIN ändern —
              oder den Katalog-Key auf <code>{classification.conflictKey}</code>{" "}
              setzen, um den bestehenden Eintrag zu ersetzen.
            </>
          ) : (
            <>
              Existing entry: <strong>{classification.conflict.name}</strong>{" "}
              ({classification.conflict.isin}). Either change the ISIN before
              opening the PR, or set the catalog key to{" "}
              <code>{classification.conflictKey}</code> to replace the existing
              entry.
            </>
          )}
        </p>
        {/* Still expose the generated TS even while the PR is blocked,
            so the operator can sanity-check what would have been written
            (e.g. to compare against the existing entry shown above). */}
        <GeneratedCodeDisclosure draft={draft} />
      </div>
    );
  }

  if (classification.state === "NEW") {
    return (
      <div
        className="border border-emerald-500/40 rounded-md p-3 bg-emerald-500/10 space-y-3"
        data-testid="diff-panel-new"
      >
        <div className="flex items-center gap-2">
          <Badge className="bg-emerald-600 hover:bg-emerald-600">
            {t({ de: "Neuer Bucket", en: "New bucket" })}
          </Badge>
          <span className="text-sm">
            <code className="font-mono text-xs">
              {draft.key || t({ de: "(kein Key)", en: "(no key)" })}
            </code>{" "}
            {t({
              de: "existiert noch nicht — dieser PR legt einen neuen Eintrag an.",
              en: "does not exist yet — this PR adds a new entry.",
            })}
          </span>
        </div>
        <GeneratedCodeDisclosure draft={draft} />
      </div>
    );
  }

  // REPLACE
  return (
    <div
      className="border border-amber-500/50 rounded-md p-3 bg-amber-500/10 space-y-3"
      data-testid="diff-panel-replace"
    >
      <div className="flex items-center gap-2">
        <Badge className="bg-amber-600 hover:bg-amber-600">
          {t({
            de: "Ersetzt bestehenden Eintrag",
            en: "Replaces existing entry",
          })}
        </Badge>
        <span className="text-sm">
          <code className="font-mono text-xs">{draft.key}</code>{" "}
          {t({
            de: "existiert bereits im Katalog. Diff bitte vor dem Öffnen des PRs prüfen.",
            en: "already exists in the catalog. Please review the diff before opening the PR.",
          })}
        </span>
      </div>
      <SideBySideDiff existing={classification.existing} draft={draft} />
      <GeneratedCodeDisclosure draft={draft} />
    </div>
  );
}

// Fixed list of fields, in the same order the renderer emits them, so the
// table mirrors what the PR diff will look like.
type DiffRow = {
  label: string;
  current: string;
  proposed: string;
};

function buildDiffRows(
  existing: NonNullable<Extract<ClassifyResult, { state: "REPLACE" }>>["existing"],
  draft: AddEtfRequest,
): DiffRow[] {
  const fmtListings = (l: Record<string, { ticker: string }>) => {
    const parts = Object.entries(l).map(([ex, v]) => `${ex}:${v.ticker}`);
    return parts.length === 0 ? "—" : parts.join(", ");
  };
  const fmtNum = (n: number | undefined) =>
    n === undefined ? "—" : String(n);
  const fmtStr = (s: string | undefined) =>
    s === undefined || s === "" ? "—" : s;
  return [
    { label: "name", current: existing.name, proposed: draft.name },
    { label: "isin", current: existing.isin, proposed: draft.isin },
    {
      label: "terBps",
      current: fmtNum(existing.terBps),
      proposed: fmtNum(draft.terBps),
    },
    { label: "domicile", current: existing.domicile, proposed: draft.domicile },
    {
      label: "replication",
      current: existing.replication,
      proposed: draft.replication,
    },
    {
      label: "distribution",
      current: existing.distribution,
      proposed: draft.distribution,
    },
    { label: "currency", current: existing.currency, proposed: draft.currency },
    {
      label: "comment",
      current: fmtStr(existing.comment),
      proposed: fmtStr(draft.comment),
    },
    {
      label: "listings",
      current: fmtListings(existing.listings),
      proposed: fmtListings(
        Object.fromEntries(
          Object.entries(draft.listings).filter(([, v]) => v) as [
            string,
            { ticker: string },
          ][],
        ),
      ),
    },
    {
      label: "defaultExchange",
      current: existing.defaultExchange,
      proposed: draft.defaultExchange,
    },
    {
      label: "aumMillionsEUR",
      current: fmtNum(existing.aumMillionsEUR),
      proposed: fmtNum(draft.aumMillionsEUR),
    },
    {
      label: "inceptionDate",
      current: fmtStr(existing.inceptionDate),
      proposed: fmtStr(draft.inceptionDate),
    },
  ];
}

function SideBySideDiff({
  existing,
  draft,
}: {
  existing: Extract<ClassifyResult, { state: "REPLACE" }>["existing"];
  draft: AddEtfRequest;
}) {
  const { t } = useAdminT();
  const rows = useMemo(() => buildDiffRows(existing, draft), [existing, draft]);
  return (
    <div className="overflow-x-auto" data-testid="diff-table">
      <table className="text-xs w-full border-collapse">
        <thead>
          <tr className="text-left border-b">
            <th className="py-1 pr-2 font-medium w-32">
              {t({ de: "Feld", en: "Field" })}
            </th>
            <th className="py-1 pr-2 font-medium">
              {t({
                de: "Aktuell (im Katalog)",
                en: "Current (in catalog)",
              })}
            </th>
            <th className="py-1 pr-2 font-medium">
              {t({
                de: "Vorgeschlagen (dieser PR)",
                en: "Proposed (this PR)",
              })}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const changed = r.current !== r.proposed;
            return (
              <tr key={r.label} className="border-b align-top">
                <td className="py-1 pr-2 font-mono text-muted-foreground">
                  {r.label}
                </td>
                <td
                  className={`py-1 pr-2 break-words ${changed ? "bg-rose-500/10" : ""}`}
                  data-testid={`diff-current-${r.label}`}
                >
                  {r.current}
                </td>
                <td
                  className={`py-1 pr-2 break-words ${changed ? "bg-emerald-500/15" : ""}`}
                  data-testid={`diff-proposed-${r.label}`}
                >
                  {r.proposed}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="text-[10px] text-muted-foreground mt-1">
        {t({
          de: 'Hinweis: aumMillionsEUR und inceptionDate liegen in der Override-Schicht (nächtlicher Refresh), nicht im statischen Katalog — die Spalte „Aktuell" zeigt „—", wenn nicht manuell gepflegt.',
          en: "Note: aumMillionsEUR and inceptionDate live in the override layer (nightly refresh), not the static catalog — the 'Current' column shows '—' when not manually maintained.",
        })}
      </p>
    </div>
  );
}

// "Show generated code" disclosure — calls the api-server's render-entry
// endpoint so the operator sees the exact TS block GitHub will receive.
// Lazy: we only fire the request when the disclosure is opened, then
// re-fetch (debounced) while it stays open and the draft changes.
function GeneratedCodeDisclosure({ draft }: { draft: AddEtfRequest }) {
  const { t } = useAdminT();
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    const handle = setTimeout(() => {
      adminApi
        .renderEntry(draft)
        .then((r) => {
          if (!cancelled) setCode(r.code);
        })
        .catch((e: Error) => {
          if (!cancelled) setError(e.message);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [open, draft]);

  return (
    <div>
      <button
        type="button"
        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        onClick={() => setOpen((v) => !v)}
        data-testid="button-show-generated-code"
      >
        {open ? (
          <ChevronDown className="h-3 w-3" />
        ) : (
          <ChevronRight className="h-3 w-3" />
        )}
        {open
          ? t({
              de: "Generierten Code verbergen",
              en: "Hide generated code",
            })
          : t({
              de: "Generierten Code anzeigen",
              en: "Show generated code",
            })}
      </button>
      {open && (
        <div className="mt-2" data-testid="generated-code-block">
          {loading && !code && (
            <p className="text-xs text-muted-foreground">
              {t({ de: "Wird gerendert …", en: "Rendering …" })}
            </p>
          )}
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          {code && (
            <pre className="text-[11px] bg-background border rounded p-2 overflow-x-auto whitespace-pre">
              {code}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <Label className="text-xs">{label}</Label>
      <div className="mt-1">{children}</div>
    </div>
  );
}

function buildDraftFromPreview(p: PreviewResponse): AddEtfRequest {
  const f = p.fields;
  const listings: AddEtfRequest["listings"] = {};
  if (p.listings && typeof p.listings === "object") {
    for (const ex of EXCHANGES) {
      const v = p.listings[ex];
      if (v?.ticker) listings[ex] = { ticker: v.ticker };
    }
  }
  const defaultExchange = (Object.keys(listings)[0] as Exchange) ?? "LSE";
  return {
    key: "Equity-New",
    name: typeof f.name === "string" ? (f.name as string) : "",
    isin: p.isin,
    terBps: typeof f.terBps === "number" ? (f.terBps as number) : 0,
    domicile: typeof f.domicile === "string" ? (f.domicile as string) : "Ireland",
    replication: normalizeReplication(f.replication),
    distribution: normalizeDistribution(f.distribution),
    currency: typeof f.currency === "string" ? (f.currency as string) : "EUR",
    comment: "",
    listings,
    defaultExchange,
    aumMillionsEUR:
      typeof f.aumMillionsEUR === "number"
        ? (f.aumMillionsEUR as number)
        : undefined,
    inceptionDate:
      typeof f.inceptionDate === "string"
        ? (f.inceptionDate as string)
        : undefined,
  };
}

// Same projection as buildDraftFromPreview, but for the alternative
// shape (no `key` field — alts are positional inside their parent).
// Merges into an existing draft so a user-typed `comment` survives the
// autofill (justETF doesn't supply that field).
function mergePreviewIntoAlternativeDraft(
  current: AddBucketAlternativeRequest,
  p: PreviewResponse,
): AddBucketAlternativeRequest {
  const f = p.fields;
  const listings: AddBucketAlternativeRequest["listings"] = {};
  if (p.listings && typeof p.listings === "object") {
    for (const ex of EXCHANGES) {
      const v = p.listings[ex];
      if (v?.ticker) listings[ex] = { ticker: v.ticker };
    }
  }
  // Prefer scraped listings; fall back to whatever the user already set.
  const mergedListings =
    Object.keys(listings).length > 0 ? listings : current.listings;
  const defaultExchange =
    (Object.keys(mergedListings)[0] as Exchange | undefined) ??
    current.defaultExchange ??
    "LSE";
  return {
    ...current,
    name: typeof f.name === "string" ? (f.name as string) : current.name,
    isin: p.isin,
    terBps:
      typeof f.terBps === "number" ? (f.terBps as number) : current.terBps,
    domicile:
      typeof f.domicile === "string"
        ? (f.domicile as string)
        : current.domicile,
    replication: normalizeReplication(f.replication),
    distribution: normalizeDistribution(f.distribution),
    currency:
      typeof f.currency === "string"
        ? (f.currency as string)
        : current.currency,
    listings: mergedListings,
    defaultExchange,
  };
}

function normalizeReplication(v: unknown): Replication {
  const s = String(v ?? "").toLowerCase();
  if (s.includes("sampl")) return "Physical (sampled)";
  if (s.includes("synth") || s.includes("swap")) return "Synthetic";
  return "Physical";
}

function normalizeDistribution(v: unknown): Distribution {
  const s = String(v ?? "").toLowerCase();
  if (s.startsWith("dist")) return "Distributing";
  return "Accumulating";
}

// ---------------------------------------------------------------------------
// Right pane — recent changes / runs / freshness
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Look-through-Datenpool — bucket-agnostic ISIN allowlist
// ---------------------------------------------------------------------------
// Lets the operator add ISINs whose look-through data (top-10 holdings,
// country & sector breakdowns) should be available for Methodology
// overrides without binding the ISIN to any particular bucket. The amber
// "data missing" warning in the override dialog auto-clears for any ISIN
// added here once the app is rebuilt (the merge happens at module load).
//
// Add-only on purpose — see the chat: pool entries are picked up by the
// monthly refresh job, so there's no per-row "Refresh now" button. To
// remove an entry, edit lookthrough.overrides.json directly.
// Pool-Status-Heuristik: Eintrag gilt als "ok", wenn alle drei Quellen
// (Top-Holdings, Geo-Breakdown, Sektoren) gefüllt sind UND der letzte
// Scrape jünger als 60 Tage ist. Älter → "stale". Mindestens eine Quelle
// leer → "missing". Damit der Operator auf einen Blick sieht, welche
// Pool-Einträge nachgepflegt werden müssen.
type PoolStatusTone = "ok" | "stale" | "missing";
type PoolStatus = {
  tone: PoolStatusTone;
};
function computePoolStatus(e: LookthroughPoolEntry): PoolStatus {
  const hasAll = e.topHoldingCount > 0 && e.geoCount > 0 && e.sectorCount > 0;
  if (!hasAll) return { tone: "missing" };
  // OK setzt voraus, dass es einen *gültigen* Zeitstempel ≤ 60 Tage gibt.
  // Ein fehlender oder unparsbarer asOf-Wert wird absichtlich als "Veraltet"
  // klassifiziert — wir können die Frische sonst nicht garantieren.
  const asOf = e.topHoldingsAsOf || e.breakdownsAsOf;
  if (!asOf) return { tone: "stale" };
  const ts = Date.parse(asOf);
  if (Number.isNaN(ts)) return { tone: "stale" };
  const ageDays = (Date.now() - ts) / (1000 * 60 * 60 * 24);
  if (ageDays > 60) return { tone: "stale" };
  return { tone: "ok" };
}

// Lokalisiert das Tone-Label am Render-Zeitpunkt — die Logik bleibt rein,
// nur die UI weiß, welche Sprache aktiv ist.
function poolStatusLabel(tone: PoolStatusTone, lang: "de" | "en"): string {
  if (tone === "ok") return lang === "de" ? "Daten OK" : "Data OK";
  if (tone === "stale") return lang === "de" ? "Veraltet" : "Stale";
  return lang === "de" ? "Daten fehlen" : "Data missing";
}

// PendingPrsCard — reliable inline list of open GitHub PRs scoped to a single
// admin flow (passed via `prefix`). Replaces the operator's reliance on the
// public github.com/.../pulls page, which can show stale "0 open" counts due
// to GitHub's search-index lag (real bug 2026-04-27). Uses the REST list-pulls
// API server-side, so the count is always correct. Re-render the parent with
// a different `refreshKey` value to force a refetch (e.g. after opening a PR).
function PendingPrsCard({
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
                de: "Offene PRs (warten auf Merge)",
                en: "Open PRs (awaiting merge)",
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
              de: "Keine offenen PRs in diesem Flow.",
              en: "No open PRs in this flow.",
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

function LookthroughPoolPanel({ catalog }: { catalog: CatalogSummary | null }) {
  const { t, lang } = useAdminT();
  const [isin, setIsin] = useState("");
  const [entries, setEntries] = useState<LookthroughPoolEntry[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errMsg, setErrMsg] = useState<string | null>(null);
  // Bumped after every successful PR-creating action so the embedded
  // PendingPrsCard refetches and shows the new PR without manual reload.
  const [prsRefreshKey, setPrsRefreshKey] = useState(0);
  // Letzter erfolgreich geöffneter PR — wird inline unter dem Eingabefeld
  // angezeigt mit klickbarem Link, damit der Operator direkt review +
  // merge kann. Auf null gesetzt bei jedem neuen Submit-Versuch.
  const [lastPr, setLastPr] = useState<{ url: string; number: number; isin: string } | null>(null);
  // Backfill-State: läuft long-running (~1-2 min für ~20 ISINs), separates
  // Submitting-Flag damit der Add-Button nicht versehentlich blockiert wird.
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

  // ISIN -> Katalog-Eintrag-Lookup. Damit kann die Tabelle den jeweiligen
  // ETF-Namen + Bucket-Key neben der ISIN anzeigen, statt nur eine nackte
  // ISIN-Liste. Der Pool ist bucket-unabhängig — manche ISINs sind nicht
  // im Katalog, dann bleibt das Name-Feld einfach leer.
  const isinToCatalog = useMemo(() => {
    const m = new Map<string, { key: string; name: string }>();
    if (!catalog) return m;
    for (const [key, entry] of Object.entries(catalog)) {
      m.set(entry.isin.toUpperCase(), { key, name: entry.name });
    }
    return m;
  }, [catalog]);

  async function load() {
    setLoading(true);
    setErrMsg(null);
    try {
      const r = await adminApi.lookthroughPool();
      setEntries(r.entries);
    } catch (e: unknown) {
      setErrMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function add() {
    const trimmed = isin.trim().toUpperCase();
    if (!trimmed) return;
    setSubmitting(true);
    setErrMsg(null);
    setLastPr(null);
    try {
      const r = await adminApi.addLookthroughPoolIsin(trimmed);
      setLastPr({ url: r.prUrl, number: r.prNumber, isin: r.isin });
      toast.success(
        lang === "de"
          ? `PR #${r.prNumber} geöffnet für ${r.isin}`
          : `PR #${r.prNumber} opened for ${r.isin}`,
        {
          description:
            lang === "de"
              ? `${r.topHoldingCount} Holdings · ${r.geoCount} Länder · ${r.sectorCount} Sektoren — Review + merge erforderlich, dann redeploy.`
              : `${r.topHoldingCount} holdings · ${r.geoCount} countries · ${r.sectorCount} sectors — review + merge required, then redeploy.`,
          action: {
            label: t({ de: "Öffnen", en: "Open" }),
            onClick: () => window.open(r.prUrl, "_blank"),
          },
        },
      );
      setIsin("");
      setPrsRefreshKey((k) => k + 1);
      await load();
    } catch (e: unknown) {
      setErrMsg(e instanceof Error ? e.message : String(e));
      // Even on error (e.g. "branch already exists"), refresh the pending
      // PRs list so the operator sees the existing PR they had forgotten
      // about — that's exactly the scenario the new error message hints at.
      setPrsRefreshKey((k) => k + 1);
    } finally {
      setSubmitting(false);
    }
  }

  // Bulk-Backfill für alle Katalog-ISINs ohne Look-through-Daten. Öffnet
  // EINEN gemeinsamen PR — operativ viel angenehmer als 15-20 Einzel-PRs.
  // Long-running (~1-2 min); UI muss klar signalisieren dass das Backend
  // arbeitet und der Tab nicht versehentlich geschlossen werden sollte.
  async function backfill() {
    setBackfilling(true);
    setErrMsg(null);
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
            ? `PR #${r.prNumber} mit ${r.added.length} ISIN${r.added.length === 1 ? "" : "s"} geöffnet`
            : `PR #${r.prNumber} opened with ${r.added.length} ISIN${r.added.length === 1 ? "" : "s"}`,
          {
            description:
              lang === "de"
                ? `${r.added.length} von ${r.missing} fehlenden ISINs erfolgreich gescraped${r.scrapeFailures.length > 0 ? `, ${r.scrapeFailures.length} fehlgeschlagen` : ""}.`
                : `${r.added.length} of ${r.missing} missing ISINs scraped successfully${r.scrapeFailures.length > 0 ? `, ${r.scrapeFailures.length} failed` : ""}.`,
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
      await load();
    } catch (e: unknown) {
      setErrMsg(e instanceof Error ? e.message : String(e));
      setPrsRefreshKey((k) => k + 1);
    } finally {
      setBackfilling(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          {t({
            de: "Look-through-Datenpool",
            en: "Look-through data pool",
          })}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          {lang === "de" ? (
            <>
              ISINs hier sind <em>bucket-unabhängig</em> für
              Methodology-Overrides verfügbar. Beim Hinzufügen werden
              Top-Holdings sowie Länder- und Sektor-Aufteilung von justETF
              gescraped und ein <strong>GitHub-PR</strong> geöffnet, der den
              neuen Eintrag zur <code>pool</code>-Sektion von{" "}
              <code>lookthrough.overrides.json</code> hinzufügt. Erst nach
              Merge + Redeploy ist die ISIN sowohl in dieser Tabelle (Quelle
              „Auto-Refresh") als auch in der Methodology-Tausch-Ansicht
              (kein „No look-through data"-Hinweis mehr) sichtbar. Der
              monatliche Refresh-Job hält die Daten danach automatisch
              aktuell.
            </>
          ) : (
            <>
              ISINs added here are available <em>bucket-agnostically</em> for
              Methodology overrides. When you add one, top holdings as well
              as country and sector breakdowns are scraped from justETF and a{" "}
              <strong>GitHub PR</strong> is opened that adds the new entry to
              the <code>pool</code> section of{" "}
              <code>lookthrough.overrides.json</code>. Only after merge +
              redeploy does the ISIN show up in this table (source
              'Auto-refresh') and in the Methodology swap view (no more
              'No look-through data' warning). After that the monthly
              refresh job keeps the data fresh automatically.
            </>
          )}
        </p>
        <div className="flex gap-2">
          <Input
            placeholder={t({ de: "z. B. IE00B5BMR087", en: "e.g. IE00B5BMR087" })}
            value={isin}
            onChange={(e) => setIsin(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && isin.trim()) void add();
            }}
            disabled={submitting}
            data-testid="input-pool-isin"
          />
          <Button
            onClick={() => void add()}
            disabled={submitting || !isin.trim()}
            data-testid="button-pool-add"
          >
            {submitting ? (
              <RefreshCw className="h-4 w-4 animate-spin" />
            ) : (
              t({ de: "Aufnehmen", en: "Add" })
            )}
          </Button>
        </div>
        {/* Bulk-Backfill: zweiter Action-Block separat vom Single-Add, damit
            kein versehentliches Klicken bei einer ISIN-Eingabe passiert.
            Der Hint-Text erklärt was der Button macht (scannt Katalog,
            scrapet alle fehlenden ISINs, EIN gemeinsamer PR), warum es
            long-running ist und dass kein zweiter Klick nötig ist. */}
        <div className="rounded-md border border-dashed p-3 space-y-2">
          <div className="flex items-start justify-between gap-3">
            <div className="text-xs text-muted-foreground flex-1">
              {lang === "de" ? (
                <>
                  <strong>Bulk-Backfill:</strong> scannt alle Katalog-ISINs
                  (Defaults + Alternativen), scrapet jede ISIN ohne
                  Look-through-Daten von justETF und öffnet{" "}
                  <strong>EINEN gemeinsamen PR</strong> mit allen Treffern.
                  Dauert je nach Anzahl fehlender ISINs ~1-2 Minuten — bitte
                  Tab nicht schließen.
                </>
              ) : (
                <>
                  <strong>Bulk backfill:</strong> scans every catalog ISIN
                  (defaults + alternatives), scrapes any ISIN without
                  look-through data from justETF and opens{" "}
                  <strong>ONE combined PR</strong> with all hits. Takes
                  ~1-2 minutes depending on how many are missing — please
                  keep this tab open.
                </>
              )}
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void backfill()}
              disabled={backfilling || submitting}
              data-testid="button-pool-backfill"
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
        {backfillResult && (
          <Alert
            className={
              backfillResult.prUrl
                ? "border-emerald-600/40 text-emerald-900 dark:text-emerald-200"
                : "border-amber-600/40 text-amber-900 dark:text-amber-200"
            }
            data-testid="alert-pool-backfill-result"
          >
            <AlertTitle>
              {backfillResult.prUrl
                ? lang === "de"
                  ? `Bulk-PR #${backfillResult.prNumber} geöffnet`
                  : `Bulk PR #${backfillResult.prNumber} opened`
                : backfillResult.missing === 0
                ? t({
                    de: "Alle Katalog-ISINs sind bereits abgedeckt",
                    en: "All catalog ISINs are already covered",
                  })
                : t({
                    de: "Backfill abgeschlossen — kein PR geöffnet",
                    en: "Backfill finished — no PR opened",
                  })}
            </AlertTitle>
            <AlertDescription className="text-xs space-y-1">
              <div>
                {lang === "de"
                  ? `${backfillResult.scanned} Katalog-ISINs gescannt, ${backfillResult.missing} ohne Daten, ${backfillResult.added.length} erfolgreich gescraped${backfillResult.scrapeFailures.length > 0 ? `, ${backfillResult.scrapeFailures.length} fehlgeschlagen` : ""}.`
                  : `${backfillResult.scanned} catalog ISINs scanned, ${backfillResult.missing} without data, ${backfillResult.added.length} scraped successfully${backfillResult.scrapeFailures.length > 0 ? `, ${backfillResult.scrapeFailures.length} failed` : ""}.`}
              </div>
              {backfillResult.added.length > 0 && (
                <div>
                  <span className="font-medium">
                    {t({
                      de: "Hinzugefügt: ",
                      en: "Added: ",
                    })}
                  </span>
                  <code className="text-[11px]">
                    {backfillResult.added.join(", ")}
                  </code>
                </div>
              )}
              {backfillResult.skippedAlreadyPresent.length > 0 && (
                <div>
                  <span className="font-medium">
                    {t({
                      de: "Übersprungen (bereits vorhanden): ",
                      en: "Skipped (already present): ",
                    })}
                  </span>
                  <code className="text-[11px]">
                    {backfillResult.skippedAlreadyPresent.join(", ")}
                  </code>
                </div>
              )}
              {backfillResult.scrapeFailures.length > 0 && (
                <div>
                  <span className="font-medium">
                    {t({
                      de: "Fehlgeschlagen: ",
                      en: "Failed: ",
                    })}
                  </span>
                  <ul className="list-disc list-inside ml-2">
                    {backfillResult.scrapeFailures.map((f) => (
                      <li key={f.isin}>
                        <code className="text-[11px]">{f.isin}</code>{" "}
                        — {f.reason}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {backfillResult.prUrl && (
                <a
                  href={backfillResult.prUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="underline font-medium inline-block mt-1"
                  data-testid="link-pool-backfill-pr"
                >
                  {t({
                    de: "Bulk-PR auf GitHub öffnen →",
                    en: "Open bulk PR on GitHub →",
                  })}
                </a>
              )}
            </AlertDescription>
          </Alert>
        )}
        {errMsg && (
          <Alert variant="destructive">
            <AlertTitle>{t({ de: "Fehler", en: "Error" })}</AlertTitle>
            <AlertDescription>{errMsg}</AlertDescription>
          </Alert>
        )}
        {lastPr && (
          <Alert
            className="border-emerald-600/40 text-emerald-900 dark:text-emerald-200"
            data-testid="alert-pool-pr-success"
          >
            <AlertTitle>
              {lang === "de"
                ? `PR #${lastPr.number} geöffnet`
                : `PR #${lastPr.number} opened`}
            </AlertTitle>
            <AlertDescription className="text-xs">
              {lang === "de" ? (
                <>
                  {lastPr.isin} wartet auf Review &amp; Merge. Erst nach
                  Merge + Redeploy taucht die ISIN unten in der Tabelle
                  (Quelle „Auto-Refresh") und in der
                  Methodology-Tausch-Ansicht auf.{" "}
                </>
              ) : (
                <>
                  {lastPr.isin} is waiting for review &amp; merge. Only after
                  merge + redeploy will the ISIN appear in the table below
                  (source 'Auto-refresh') and in the Methodology swap view.{" "}
                </>
              )}
              <a
                href={lastPr.url}
                target="_blank"
                rel="noreferrer noopener"
                className="underline font-medium"
                data-testid={`link-pool-pr-${lastPr.isin}`}
              >
                {t({
                  de: "PR auf GitHub öffnen →",
                  en: "Open PR on GitHub →",
                })}
              </a>
            </AlertDescription>
          </Alert>
        )}
        <PendingPrsCard
          prefix="add-lookthrough-pool/"
          refreshKey={prsRefreshKey}
          emptyHint={t({
            de: "Keine offenen Pool-PRs — alle Adds sind gemerged.",
            en: "No open pool PRs — all adds are merged.",
          })}
        />
        <div data-testid="lookthrough-pool-list">
          {loading && (
            <p className="text-sm text-muted-foreground">
              {t({ de: "Lade …", en: "Loading …" })}
            </p>
          )}
          {!loading && entries && entries.length === 0 && (
            <p className="text-sm text-muted-foreground">
              {t({
                de: "Noch keine ISINs im Datenpool.",
                en: "No ISINs in the data pool yet.",
              })}
            </p>
          )}
          {!loading && entries && entries.length > 0 && (
            <>
              <p className="text-xs text-muted-foreground mb-1">
                {lang === "de" ? (
                  <>
                    {entries.length} ETF{entries.length === 1 ? "" : "s"} mit
                    Look-through-Daten. Status pro Eintrag:{" "}
                    <Badge variant="outline" className="border-emerald-600 text-emerald-700 dark:text-emerald-400">
                      Daten OK
                    </Badge>{" "}
                    = Holdings + Länder + Sektoren vorhanden,{" "}
                    <Badge variant="outline" className="border-amber-600 text-amber-700 dark:text-amber-400">
                      Veraltet
                    </Badge>{" "}
                    = letzter Scrape &gt; 60 Tage,{" "}
                    <Badge variant="outline" className="border-rose-600 text-rose-700 dark:text-rose-400">
                      Daten fehlen
                    </Badge>{" "}
                    = mindestens eine Quelle leer. Quelle: <em>Kuratiert</em>{" "}
                    = manuell im Repo gepflegt; <em>Auto-Refresh</em> = vom
                    monatlichen Scrape-Job geschrieben.
                  </>
                ) : (
                  <>
                    {entries.length} ETF{entries.length === 1 ? "" : "s"}{" "}
                    with look-through data. Per-entry status:{" "}
                    <Badge variant="outline" className="border-emerald-600 text-emerald-700 dark:text-emerald-400">
                      Data OK
                    </Badge>{" "}
                    = holdings + countries + sectors present,{" "}
                    <Badge variant="outline" className="border-amber-600 text-amber-700 dark:text-amber-400">
                      Stale
                    </Badge>{" "}
                    = last scrape &gt; 60 days,{" "}
                    <Badge variant="outline" className="border-rose-600 text-rose-700 dark:text-rose-400">
                      Data missing
                    </Badge>{" "}
                    = at least one source empty. Source: <em>Curated</em> =
                    maintained manually in the repo; <em>Auto-refresh</em> =
                    written by the monthly scrape job.
                  </>
                )}
              </p>
              <div className="overflow-auto max-h-96 border rounded">
                <table className="text-xs w-full">
                  <thead className="bg-muted/40 sticky top-0">
                    <tr className="text-left">
                      <th className="px-2 py-1 font-medium">
                        {t({ de: "Status", en: "Status" })}
                      </th>
                      <th className="px-2 py-1 font-medium">
                        {t({ de: "Quelle", en: "Source" })}
                      </th>
                      <th className="px-2 py-1 font-medium">ISIN</th>
                      <th className="px-2 py-1 font-medium">
                        {t({ de: "Name (Katalog)", en: "Name (catalog)" })}
                      </th>
                      <th className="px-2 py-1 font-medium">
                        {t({ de: "Positionen", en: "Holdings" })}
                      </th>
                      <th className="px-2 py-1 font-medium">
                        {t({ de: "Länder", en: "Countries" })}
                      </th>
                      <th className="px-2 py-1 font-medium">
                        {t({ de: "Sektoren", en: "Sectors" })}
                      </th>
                      <th className="px-2 py-1 font-medium">
                        {t({
                          de: "Letzter Scrape",
                          en: "Last scrape",
                        })}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {entries.map((e) => {
                      const cat = isinToCatalog.get(e.isin.toUpperCase());
                      const status = computePoolStatus(e);
                      return (
                        <tr key={e.isin} className="border-t" data-testid={`row-pool-${e.isin}`}>
                          <td className="px-2 py-1">
                            <Badge
                              variant="outline"
                              className={
                                status.tone === "ok"
                                  ? "border-emerald-600 text-emerald-700 dark:text-emerald-400"
                                  : status.tone === "stale"
                                    ? "border-amber-600 text-amber-700 dark:text-amber-400"
                                    : "border-rose-600 text-rose-700 dark:text-rose-400"
                              }
                              data-testid={`badge-pool-status-${e.isin}`}
                            >
                              {poolStatusLabel(status.tone, lang)}
                            </Badge>
                          </td>
                          <td className="px-2 py-1">
                            <Badge
                              variant="outline"
                              className={
                                e.source === "pool"
                                  ? "border-sky-600 text-sky-700 dark:text-sky-400"
                                  : e.source === "both"
                                    ? "border-violet-600 text-violet-700 dark:text-violet-400"
                                    : "border-slate-500 text-slate-700 dark:text-slate-400"
                              }
                              data-testid={`badge-pool-source-${e.isin}`}
                            >
                              {e.source === "pool"
                                ? t({
                                    de: "Auto-Refresh",
                                    en: "Auto-refresh",
                                  })
                                : e.source === "both"
                                  ? t({ de: "Beide", en: "Both" })
                                  : t({ de: "Kuratiert", en: "Curated" })}
                            </Badge>
                          </td>
                          <td className="px-2 py-1 font-mono">{e.isin}</td>
                          <td className="px-2 py-1">
                            {cat ? (
                              <>
                                <div className="truncate max-w-[28ch]" title={cat.name}>
                                  {cat.name}
                                </div>
                                <div className="text-[10px] text-muted-foreground font-mono">
                                  {cat.key}
                                </div>
                              </>
                            ) : e.name ? (
                              // Auto-Refresh-Eintrag, der nicht im Katalog
                              // (etfs.ts) steht: zeige den von justETF
                              // gescrapeten offiziellen ETF-Namen, damit
                              // der Operator die ISIN identifizieren kann
                              // ohne sie extern nachschlagen zu müssen.
                              // Italic + "(justETF)"-Hinweis grenzt visuell
                              // gegenüber kuratierten Katalog-Namen ab.
                              <>
                                <div
                                  className="truncate max-w-[28ch] italic"
                                  title={e.name}
                                  data-testid={`pool-name-${e.isin}`}
                                >
                                  {e.name}
                                </div>
                                <div className="text-[10px] text-muted-foreground">
                                  {t({
                                    de: "justETF · nicht im Katalog",
                                    en: "justETF · not in catalog",
                                  })}
                                </div>
                              </>
                            ) : (
                              <span className="text-muted-foreground italic">
                                {t({
                                  de: "— nicht im Katalog",
                                  en: "— not in catalog",
                                })}
                              </span>
                            )}
                          </td>
                          <td className="px-2 py-1">{e.topHoldingCount}</td>
                          <td className="px-2 py-1">{e.geoCount}</td>
                          <td className="px-2 py-1">{e.sectorCount}</td>
                          <td className="px-2 py-1 text-muted-foreground">
                            {e.topHoldingsAsOf?.slice(0, 10) ?? "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function DataUpdatesColumn() {
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

function FreshnessCard({ fresh }: { fresh: FreshnessResponse | null }) {
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

function RecentChangesCard({ changes }: { changes: ChangeEntry[] }) {
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

// Detect ISO-8601 UTC timestamps (e.g. "2026-04-28T05:37:10.006Z") so we can
// render them in a much more readable form than the raw value the scraper
// scripts append to refresh-runs.log.md. The scripts log UTC for unambiguity
// (CI / cron run anywhere) but the operator reads the table in their own
// timezone — so we present *both*: a primary local-time line, a tiny relative
// "vor X Min." hint, and a "UTC HH:MM" fallback so anyone correlating with the
// log file or a CI run URL can still see the original value at a glance.
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
  // floor-based unit derivation: e.g. 59m30s stays "vor 59 Min." instead of
  // jumping to "vor 1 Std.". Operator-friendly: we want the label to undershoot
  // the boundary, not overshoot it.
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

// GitHub freshness lookup. The deployed app ships a static snapshot of
// refresh-runs.log.md from build time — but the cron jobs continue to commit
// new rows to GitHub between deploys. To answer the operator's recurring
// question "is what I'm looking at actually current?" we hit the public
// GitHub commits API for that one file path and compare its latest commit
// timestamp against the bundle's freshest run row. If GitHub is meaningfully
// ahead, the card surfaces a "republish fällig" pill.
//
// Why public anonymous fetch and not a proxied server endpoint: 60 anon
// requests/hour/IP is plenty for a single-operator console (this is one
// request per page load), and going through the api-server would just add
// rate-limit + secret-handling complexity we don't need.
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

function RunCell({
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

// Threshold for the "republish fällig" warning. The cron commits the log row
// a few seconds AFTER the script started, so a small positive offset between
// GitHub's commit time and the bundle's newest "Started (UTC)" is normal even
// for an up-to-date deploy. 10 minutes is comfortably above that noise floor
// and well below a typical cron cadence (daily/weekly/monthly).
const REPUBLISH_LAG_THRESHOLD_MS = 10 * 60 * 1000;

function RecentRunsCard({ runs }: { runs: RunLogRow[] }) {
  const { t, lang } = useAdminT();
  const cols = runs[0] ? Object.keys(runs[0]).slice(0, 6) : [];
  const githubCommit = useGithubLastCommit(RUN_LOG_PATH);
  // The newest run row in the bundled log file. runs[0] is the freshest per
  // /admin/run-log's reverse-tail behaviour. Defensive: try both column-name
  // variants in case the log header ever shifts.
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
  // Both sides must parse cleanly before we can claim staleness in either
  // direction. If the bundle row is missing/malformed or GitHub is still
  // loading/errored, surface an "unbekannt" pill rather than a misleading
  // green "aktuell" — the operator should never see a confident OK state
  // that's based on an implicit zero on one side of the comparison.
  const canCompare = !!bundleNewestDate && !!githubDate;
  const lagMs = canCompare
    ? githubDate!.getTime() - bundleNewestDate!.getTime()
    : 0;
  const republishOverdue = canCompare && lagMs > REPUBLISH_LAG_THRESHOLD_MS;
  // Localised header label for the timestamp column — the raw "Started (UTC)"
  // is technically still accurate (the underlying value IS UTC) but it is no
  // longer the primary thing displayed in the cell, so we soften it.
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

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-muted-foreground">{k}</span>
      <span className="font-mono text-xs text-right">{v}</span>
    </div>
  );
}

function fmt(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "string") return v.length > 60 ? v.slice(0, 57) + "…" : v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  try {
    const s = JSON.stringify(v);
    return s.length > 60 ? s.slice(0, 57) + "…" : s;
  } catch {
    return "[unserializable]";
  }
}

// ---------------------------------------------------------------------------
// AppDefaultsPanel — globale Defaults (RF / Home-Bias / CMA), via PR.
// ---------------------------------------------------------------------------
// Liest die aktuell ausgelieferten Defaults aus app-defaults.json (über
// /admin/app-defaults), erlaubt Bearbeitung der drei Tabellen und öffnet
// per Klick einen GitHub-PR der die JSON-Datei ersetzt. Nach Merge +
// Redeploy gelten die Werte für ALLE Nutzer. Per-User-Overrides aus dem
// Methodology-Tab (localStorage) liegen weiterhin oben drauf.
//
// Drei Editoren ein einer Karte: bewusst kompakt gehalten, da der Operator
// in der Regel nur einzelne Werte anfasst (z. B. RF-Anpassung nach EZB-
// Sitzung). Eingabe als Prozent für RF/CMA-Return/Vol, als Multiplikator
// für Home-Bias — mirrors the Methodology-Editor, damit der Operator nicht
// zwischen Einheiten umrechnen muss.
// ---------------------------------------------------------------------------
const RF_KEYS_UI: AppDefaultsRfCurrency[] = ["USD", "EUR", "GBP", "CHF"];
const HB_KEYS_UI: AppDefaultsHbCurrency[] = ["USD", "EUR", "GBP", "CHF"];
const CMA_KEYS_UI: { key: AppDefaultsAssetKey; label: string }[] = [
  { key: "equity_us", label: "US Equity" },
  { key: "equity_eu", label: "Europe Equity" },
  { key: "equity_uk", label: "UK Equity" },
  { key: "equity_ch", label: "Swiss Equity" },
  { key: "equity_jp", label: "Japan Equity" },
  { key: "equity_em", label: "EM Equity" },
  { key: "equity_thematic", label: "Thematic Equity" },
  { key: "bonds", label: "Global Bonds" },
  { key: "cash", label: "Cash" },
  { key: "gold", label: "Gold" },
  { key: "reits", label: "Listed Real Estate" },
  { key: "crypto", label: "Crypto" },
];

// String-state per Feld, damit "leer = nicht gesetzt" und Tippvorgang ohne
// Reparsing möglich. parseOptionalPct/parseOptionalNum übersetzen am Submit.
type FieldState = string;
type CmaRow = { expReturn: FieldState; vol: FieldState };

function AppDefaultsPanel({ githubConfigured }: { githubConfigured: boolean }) {
  const { t, lang } = useAdminT();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [meta, setMeta] = useState<{ lastUpdated?: string | null; lastUpdatedBy?: string | null } | null>(null);
  const [rf, setRf] = useState<Record<AppDefaultsRfCurrency, FieldState>>({
    USD: "", EUR: "", GBP: "", CHF: "",
  });
  const [hb, setHb] = useState<Record<AppDefaultsHbCurrency, FieldState>>({
    USD: "", EUR: "", GBP: "", CHF: "",
  });
  const [cma, setCma] = useState<Record<AppDefaultsAssetKey, CmaRow>>(() =>
    Object.fromEntries(CMA_KEYS_UI.map((c) => [c.key, { expReturn: "", vol: "" }])) as Record<AppDefaultsAssetKey, CmaRow>,
  );
  const [summary, setSummary] = useState("");
  const [lastPr, setLastPr] = useState<{ url: string; number: number } | null>(null);
  const [presetId, setPresetId] = useState<string>("");
  // Bumped after every PR-creating action (success oder error) so der
  // PendingPrsCard sich automatisch neu lädt — auch im 422-Fall sieht der
  // Operator dann sofort den bereits-existierenden offenen PR.
  const [prsRefreshKey, setPrsRefreshKey] = useState(0);

  // Lade-Logik als benannte Funktion, damit der "Aktuelle Werte neu laden"-
  // Button sie auch nach manuellen Edits noch einmal triggern kann (Revert-
  // Pfad nach versehentlichem Preset-Klick).
  async function loadFromServer(): Promise<boolean> {
    setLoading(true);
    try {
      const res = await adminApi.getAppDefaults();
      const v = res.value ?? {};
      setMeta(v._meta ? { lastUpdated: v._meta.lastUpdated ?? null, lastUpdatedBy: v._meta.lastUpdatedBy ?? null } : null);
      // Editor immer auf einen sauberen "leer = built-in"-Stand zuruecksetzen,
      // dann die Server-Werte einsetzen — damit ein Revert auch Felder
      // leert, die der Operator zwischenzeitlich hineingeschrieben hat.
      setRf(() => {
        const next = { USD: "", EUR: "", GBP: "", CHF: "" } as Record<AppDefaultsRfCurrency, FieldState>;
        for (const k of RF_KEYS_UI) {
          const n = v.riskFreeRates?.[k];
          if (typeof n === "number") next[k] = (n * 100).toFixed(3);
        }
        return next;
      });
      setHb(() => {
        const next = { USD: "", EUR: "", GBP: "", CHF: "" } as Record<AppDefaultsHbCurrency, FieldState>;
        for (const k of HB_KEYS_UI) {
          const n = v.homeBias?.[k];
          if (typeof n === "number") next[k] = String(n);
        }
        return next;
      });
      setCma(() => {
        const next = Object.fromEntries(
          CMA_KEYS_UI.map((c) => [c.key, { expReturn: "", vol: "" }]),
        ) as Record<AppDefaultsAssetKey, CmaRow>;
        for (const c of CMA_KEYS_UI) {
          const entry = v.cma?.[c.key];
          if (!entry) continue;
          next[c.key] = {
            expReturn: typeof entry.expReturn === "number" ? (entry.expReturn * 100).toFixed(3) : "",
            vol: typeof entry.vol === "number" ? (entry.vol * 100).toFixed(3) : "",
          };
        }
        return next;
      });
      setLoadError(null);
      return true;
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
      return false;
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadFromServer();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Wendet das aktuell ausgewaehlte Preset an. Reine Logik liegt in
  // applyPresetToFields (testbar, ohne React zu mounten). Apply ist
  // bewusst NICHT auto-on-change: ein eigener Button macht den Effekt
  // sichtbar und vermeidet versehentliches Ueberschreiben.
  function onApplyPreset() {
    const preset = findPresetById(presetId);
    if (!preset) {
      toast.error(
        t({
          de: "Bitte zuerst eine Vorlage auswaehlen.",
          en: "Please pick a preset first.",
        }),
      );
      return;
    }
    const next = applyPresetToFields(preset, { rf, hb, cma });
    setRf(next.rf);
    setHb(next.hb);
    setCma(next.cma);
    toast.success(
      lang === "de"
        ? `Vorlage angewendet: ${preset.label}. Bitte vor dem PR pruefen.`
        : `Preset applied: ${preset.label}. Please review before opening the PR.`,
    );
  }

  async function onRevert() {
    setPresetId("");
    const ok = await loadFromServer();
    if (ok) {
      toast.success(
        t({
          de: "Editor auf aktuell ausgelieferte Werte zurueckgesetzt.",
          en: "Editor reverted to currently shipped values.",
        }),
      );
    } else {
      toast.error(
        t({
          de: "Konnte aktuelle Werte nicht laden — siehe Fehlermeldung im Panel.",
          en: "Could not load current values — see error message in the panel.",
        }),
      );
    }
  }

  // Dezimaleingabe — akzeptiert SOWOHL Punkt als auch Komma als
  // Trennzeichen. Vorher: `Number("7,5")` → `NaN` → das Feld wurde
  // stillschweigend als "leer" behandelt, der PR enthielt keinen Wert
  // und der Operator hatte keine Möglichkeit zu erkennen, was schiefging.
  // Jetzt: "7,5" → 7.5; ungültige Eingaben werden separat im Submit-Pfad
  // gesammelt und als Toast gemeldet. Akzeptierte Grammatik:
  //   - optionales Vorzeichen (+ / -)
  //   - eine Ziffernfolge
  //   - optional ein Trennzeichen (. ODER ,) und Nachkommastellen
  // Mehrfach-Separatoren wie "1.234,56" oder "1,234,567" werden explizit
  // abgelehnt — die Editor-Felder erwarten Prozentwerte (~1-30), keine
  // gruppierten Tausender; Ablehnung verhindert versehentliche
  // Fehlinterpretation.
  const DECIMAL_RE = /^[+-]?\d+([.,]\d+)?$/;
  function parseDecimal(s: string): number | "invalid" | undefined {
    const t = s.trim();
    if (!t) return undefined;
    if (!DECIMAL_RE.test(t)) return "invalid";
    const n = Number(t.replace(",", "."));
    return Number.isFinite(n) ? n : "invalid";
  }
  function parsePct(s: string): number | "invalid" | undefined {
    const r = parseDecimal(s);
    if (r === undefined || r === "invalid") return r;
    return r / 100;
  }

  function buildPayload(): {
    value: AppDefaultsPayload;
    touched: number;
    invalidFields: string[];
  } {
    const value: AppDefaultsPayload = {};
    let touched = 0;
    const invalidFields: string[] = [];

    const rfOut: Partial<Record<AppDefaultsRfCurrency, number>> = {};
    for (const k of RF_KEYS_UI) {
      const n = parsePct(rf[k]);
      if (n === "invalid") {
        invalidFields.push(
          (lang === "de" ? "Risikoloser Zins " : "Risk-free rate ") + k,
        );
        continue;
      }
      if (n !== undefined) {
        rfOut[k] = n;
        touched++;
      }
    }
    if (Object.keys(rfOut).length > 0) value.riskFreeRates = rfOut;

    const hbOut: Partial<Record<AppDefaultsHbCurrency, number>> = {};
    for (const k of HB_KEYS_UI) {
      const n = parseDecimal(hb[k]);
      if (n === "invalid") {
        invalidFields.push(
          (lang === "de" ? "Home-Bias " : "Home bias ") + k,
        );
        continue;
      }
      if (n !== undefined) {
        hbOut[k] = n;
        touched++;
      }
    }
    if (Object.keys(hbOut).length > 0) value.homeBias = hbOut;

    const cmaOut: Partial<Record<AppDefaultsAssetKey, { expReturn?: number; vol?: number }>> = {};
    for (const c of CMA_KEYS_UI) {
      const row = cma[c.key];
      const mu = parsePct(row.expReturn);
      const sg = parsePct(row.vol);
      if (mu === "invalid")
        invalidFields.push(
          lang === "de"
            ? `CMA ${c.label} → Erw. Rendite`
            : `CMA ${c.label} → Exp. return`,
        );
      if (sg === "invalid")
        invalidFields.push(
          lang === "de"
            ? `CMA ${c.label} → Volatilität`
            : `CMA ${c.label} → Volatility`,
        );
      const muVal = mu === "invalid" ? undefined : mu;
      const sgVal = sg === "invalid" ? undefined : sg;
      if (muVal === undefined && sgVal === undefined) continue;
      const entry: { expReturn?: number; vol?: number } = {};
      if (muVal !== undefined) {
        entry.expReturn = muVal;
        touched++;
      }
      if (sgVal !== undefined) {
        entry.vol = sgVal;
        touched++;
      }
      cmaOut[c.key] = entry;
    }
    if (Object.keys(cmaOut).length > 0) value.cma = cmaOut;

    return { value, touched, invalidFields };
  }

  async function onSubmit() {
    setLastPr(null);
    const trimmed = summary.trim();
    if (!trimmed) {
      toast.error(
        t({
          de: "Kurze Beschreibung erforderlich (für PR-Titel).",
          en: "Short description required (used as the PR title).",
        }),
      );
      return;
    }
    const { value, touched, invalidFields } = buildPayload();
    if (invalidFields.length > 0) {
      // Mindestens ein Feld enthält Text, der nicht als Zahl interpretiert
      // werden konnte. Dem Operator EXPLIZIT melden statt stillschweigend
      // ignorieren — sonst öffnet sich ein leerer PR ohne Hinweis.
      const head =
        lang === "de"
          ? `Ungültige Eingabe in ${invalidFields.length} Feld${invalidFields.length === 1 ? "" : "ern"}: `
          : `Invalid input in ${invalidFields.length} field${invalidFields.length === 1 ? "" : "s"}: `;
      const more =
        invalidFields.length > 5
          ? lang === "de"
            ? ` (+${invalidFields.length - 5} weitere)`
            : ` (+${invalidFields.length - 5} more)`
          : "";
      const tail =
        lang === "de"
          ? ". Erlaubt: Zahl mit optionalem Vorzeichen und einem Dezimaltrennzeichen (z.B. 7,5 oder 7.5 oder -2,3)."
          : ". Allowed: a number with optional sign and a single decimal separator (e.g. 7.5 or 7,5 or -2.3).";
      toast.error(head + invalidFields.slice(0, 5).join(", ") + more + tail);
      return;
    }
    if (touched === 0) {
      // Leerer Payload ist technisch erlaubt (= "alle Overrides löschen,
      // zurück zu Built-in"), aber das ist keine versehentliche Aktion.
      // Confirm-Dialog erzwingen, damit der Operator nicht aus Versehen
      // alle globalen Overrides wegspült, weil er dachte er hätte Werte
      // eingetragen (z.B. Komma-Bug aus früherer Build, oder vergessen
      // zu speichern nach Browser-Reload).
      const ok = window.confirm(
        t({
          de: "Kein Feld hat einen Wert. Wenn du jetzt fortsetzt, wird ein PR erzeugt, der ALLE globalen Defaults entfernt und auf die eingebauten Built-in-Werte zurücksetzt. Wirklich fortfahren?",
          en: "No field has a value. If you continue, a PR will be opened that removes ALL global defaults and falls back to the built-in values. Really proceed?",
        }),
      );
      if (!ok) return;
    }
    setSubmitting(true);
    try {
      const res = await adminApi.proposeAppDefaultsPr(value, trimmed);
      setLastPr({ url: res.prUrl, number: res.prNumber });
      setPrsRefreshKey((k) => k + 1);
      toast.success(
        touched === 0
          ? lang === "de"
            ? `PR #${res.prNumber} geöffnet (alle Overrides entfernt).`
            : `PR #${res.prNumber} opened (all overrides removed).`
          : lang === "de"
            ? `PR #${res.prNumber} geöffnet (${touched} Feld${touched === 1 ? "" : "er"} übermittelt).`
            : `PR #${res.prNumber} opened (${touched} field${touched === 1 ? "" : "s"} submitted).`,
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
      // Auch im Fehlerfall die offenen-PRs-Liste auffrischen — etwa bei
      // 422-"branch already exists" wäre der bereits offene PR genau die
      // Antwort auf "warum hat es nicht geklappt".
      setPrsRefreshKey((k) => k + 1);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card data-testid="card-app-defaults">
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span>
            {t({
              de: "Globale Defaults (Risikoloser Zins / Home-Bias / Kapitalmarkt­annahmen)",
              en: "Global defaults (Risk-free rate / Home bias / Capital market assumptions)",
            })}
          </span>
          {meta?.lastUpdated && (
            <span className="text-xs font-normal text-muted-foreground">
              {t({ de: "zuletzt geändert: ", en: "last changed: " })}
              {meta.lastUpdated}
              {meta.lastUpdatedBy ? ` (${meta.lastUpdatedBy})` : ""}
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <p className="text-sm text-muted-foreground">
          {lang === "de" ? (
            <>
              Werte hier werden über einen GitHub-PR in{" "}
              <code>artifacts/investment-lab/src/data/app-defaults.json</code>{" "}
              geschrieben. Nach Merge + Redeploy gelten sie als Default für
              alle Nutzer. Felder leer lassen = bisheriger Built-in-Default
              greift. Per-User-Overrides aus dem Methodology-Tab
              (localStorage) bleiben unverändert oben drauf wirksam.
            </>
          ) : (
            <>
              Values here are written via a GitHub PR to{" "}
              <code>artifacts/investment-lab/src/data/app-defaults.json</code>.
              After merge + redeploy they apply as the default for all users.
              Leave a field empty = the existing built-in default applies.
              Per-user overrides from the Methodology tab (localStorage)
              continue to apply on top, unchanged.
            </>
          )}
        </p>

        {loading && (
          <p className="text-sm text-muted-foreground">
            {t({
              de: "Lade aktuelle Werte…",
              en: "Loading current values…",
            })}
          </p>
        )}
        {loadError && (
          <Alert variant="destructive">
            <AlertTitle>
              {t({ de: "Fehler beim Laden", en: "Error while loading" })}
            </AlertTitle>
            <AlertDescription>{loadError}</AlertDescription>
          </Alert>
        )}

        {!loading && !loadError && (
          <>
            <section className="space-y-2">
              <Label htmlFor="app-defaults-preset">
                {t({
                  de: "Vorlage anwenden (optional)",
                  en: "Apply preset (optional)",
                })}
              </Label>
              <div className="flex flex-col sm:flex-row gap-3 sm:items-end">
                <div className="flex-1 min-w-0">
                  <Select
                    value={presetId || undefined}
                    onValueChange={(v) => setPresetId(v)}
                  >
                    <SelectTrigger
                      id="app-defaults-preset"
                      data-testid="select-app-defaults-preset"
                    >
                      <SelectValue
                        placeholder={t({
                          de: "— keine Vorlage —",
                          en: "— no preset —",
                        })}
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {APP_DEFAULTS_PRESETS.map((p) => (
                        <SelectItem
                          key={p.id}
                          value={p.id}
                          data-testid={`option-preset-${p.id}`}
                        >
                          {p.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="secondary"
                    onClick={onApplyPreset}
                    disabled={!presetId || loading}
                    data-testid="button-apply-preset"
                  >
                    {t({ de: "Vorlage anwenden", en: "Apply preset" })}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={onRevert}
                    disabled={loading}
                    data-testid="button-revert-defaults"
                  >
                    {t({
                      de: "Aktuelle Werte neu laden",
                      en: "Reload current values",
                    })}
                  </Button>
                </div>
              </div>
              {presetId && (
                <p className="text-xs text-muted-foreground">
                  {findPresetById(presetId)?.description}
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                {t({
                  de: 'Vorlagen erst auswählen, dann mit "Vorlage anwenden" in den Editor laden. Sektionen, die die Vorlage nicht berührt, bleiben unverändert; "Aktuelle Werte neu laden" verwirft manuelle Änderungen und holt den Stand vom Server.',
                  en: "Pick a preset first, then click 'Apply preset' to load it into the editor. Sections the preset doesn't touch stay unchanged; 'Reload current values' discards manual changes and refetches the server state.",
                })}
              </p>
            </section>

            <Separator />

            <section className="space-y-2">
              <h3 className="text-sm font-semibold">
                {t({
                  de: "Risikofreie Zinssätze (in %)",
                  en: "Risk-free rates (in %)",
                })}
              </h3>
              <p className="text-xs text-muted-foreground">
                {t({
                  de: "Leeres Feld = Built-in-Default greift.",
                  en: "Empty field = built-in default applies.",
                })}
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {RF_KEYS_UI.map((k) => (
                  <div key={k} className="space-y-1">
                    <Label htmlFor={`rf-${k}`}>{k}</Label>
                    <Input
                      id={`rf-${k}`}
                      data-testid={`input-rf-${k}`}
                      type="number"
                      step="0.01"
                      min={0}
                      max={20}
                      placeholder={(BUILT_IN_RF[k] * 100).toFixed(3)}
                      value={rf[k]}
                      onChange={(e) => setRf({ ...rf, [k]: e.target.value })}
                    />
                    <p
                      className="text-[10px] text-muted-foreground font-mono"
                      data-testid={`builtin-rf-${k}`}
                    >
                      {t({ de: "Built-in: ", en: "Built-in: " })}
                      {(BUILT_IN_RF[k] * 100).toFixed(3)} %
                    </p>
                  </div>
                ))}
              </div>
            </section>

            <Separator />

            <section className="space-y-2">
              <h3 className="text-sm font-semibold">
                {t({
                  de: "Home-Bias-Multiplikator (0–5)",
                  en: "Home bias multiplier (0–5)",
                })}
              </h3>
              <p className="text-xs text-muted-foreground">
                {t({
                  de: "Leeres Feld = Built-in-Default greift.",
                  en: "Empty field = built-in default applies.",
                })}
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {HB_KEYS_UI.map((k) => (
                  <div key={k} className="space-y-1">
                    <Label htmlFor={`hb-${k}`}>{k}</Label>
                    <Input
                      id={`hb-${k}`}
                      data-testid={`input-hb-${k}`}
                      type="number"
                      step="0.1"
                      min={0}
                      max={5}
                      placeholder={BUILT_IN_HB[k].toFixed(1)}
                      value={hb[k]}
                      onChange={(e) => setHb({ ...hb, [k]: e.target.value })}
                    />
                    <p
                      className="text-[10px] text-muted-foreground font-mono"
                      data-testid={`builtin-hb-${k}`}
                    >
                      {t({ de: "Built-in: ", en: "Built-in: " })}
                      {BUILT_IN_HB[k].toFixed(1)}×
                    </p>
                  </div>
                ))}
              </div>
            </section>

            <Separator />

            <section className="space-y-2">
              <h3 className="text-sm font-semibold">
                {t({
                  de: "CMA — erwartete Rendite & Volatilität (in %)",
                  en: "CMA — expected return & volatility (in %)",
                })}
              </h3>
              <p className="text-xs text-muted-foreground">
                {t({
                  de: 'Leere Felder erben den Built-in-Default (Spalte „Built-in").',
                  en: "Empty fields inherit the built-in default (column 'Built-in').",
                })}
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left">
                      <th className="pb-2 pr-3 font-medium">
                        {t({ de: "Anlageklasse", en: "Asset class" })}
                      </th>
                      <th className="pb-2 pr-3 font-medium">
                        {t({
                          de: "Built-in μ / σ",
                          en: "Built-in μ / σ",
                        })}
                      </th>
                      <th className="pb-2 pr-3 font-medium">
                        {t({
                          de: "Erw. Rendite %",
                          en: "Exp. return %",
                        })}
                      </th>
                      <th className="pb-2 font-medium">
                        {t({ de: "Volatilität %", en: "Volatility %" })}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {CMA_KEYS_UI.map((c) => {
                      const seed = BASE_SEED[c.key];
                      const muBuiltin = (seed.expReturn * 100).toFixed(1);
                      const volBuiltin = (seed.vol * 100).toFixed(1);
                      return (
                        <tr key={c.key} className="border-b border-border/50">
                          <td className="py-1.5 pr-3 text-muted-foreground">
                            {c.label}
                          </td>
                          <td
                            className="py-1.5 pr-3 text-[11px] text-muted-foreground font-mono whitespace-nowrap"
                            data-testid={`builtin-cma-${c.key}`}
                          >
                            μ {muBuiltin}% / σ {volBuiltin}%
                          </td>
                          <td className="py-1.5 pr-3">
                            <Input
                              data-testid={`input-cma-${c.key}-mu`}
                              type="number"
                              step="0.1"
                              placeholder={muBuiltin}
                              value={cma[c.key].expReturn}
                              onChange={(e) =>
                                setCma({
                                  ...cma,
                                  [c.key]: { ...cma[c.key], expReturn: e.target.value },
                                })
                              }
                            />
                          </td>
                          <td className="py-1.5">
                            <Input
                              data-testid={`input-cma-${c.key}-vol`}
                              type="number"
                              step="0.1"
                              min={0}
                              placeholder={volBuiltin}
                              value={cma[c.key].vol}
                              onChange={(e) =>
                                setCma({
                                  ...cma,
                                  [c.key]: { ...cma[c.key], vol: e.target.value },
                                })
                              }
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>

            <Separator />

            <section className="space-y-2">
              <Label htmlFor="app-defaults-summary">
                {t({
                  de: "Kurze Beschreibung der Änderung (für PR-Titel)",
                  en: "Short description of the change (used as PR title)",
                })}
              </Label>
              <Input
                id="app-defaults-summary"
                data-testid="input-app-defaults-summary"
                placeholder={t({
                  de: "z. B. RF nach EZB-Sitzung 04/2026",
                  en: "e.g. RF after ECB meeting 04/2026",
                })}
                value={summary}
                onChange={(e) => setSummary(e.target.value)}
              />
            </section>

            {!githubConfigured && (
              <Alert>
                <AlertTitle>
                  {t({
                    de: "GitHub nicht konfiguriert",
                    en: "GitHub not configured",
                  })}
                </AlertTitle>
                <AlertDescription>
                  {lang === "de" ? (
                    <>
                      Setze <code>GITHUB_PAT</code>, <code>GITHUB_OWNER</code>,{" "}
                      <code>GITHUB_REPO</code> auf dem api-server, um PRs
                      öffnen zu können.
                    </>
                  ) : (
                    <>
                      Set <code>GITHUB_PAT</code>, <code>GITHUB_OWNER</code>,{" "}
                      <code>GITHUB_REPO</code> on the api-server to enable
                      opening PRs.
                    </>
                  )}
                </AlertDescription>
              </Alert>
            )}

            <div className="flex items-center justify-between gap-3">
              <p className="text-xs text-muted-foreground">
                {t({
                  de: "Hinweis: Werte werden vor dem Commit serverseitig validiert (Bereiche wie Methodology). Ungültige Eingaben werden als Fehler gemeldet und es entsteht kein PR.",
                  en: "Note: values are validated server-side before commit (same bounds as Methodology). Invalid input is reported as an error and no PR is created.",
                })}
              </p>
              <Button
                data-testid="button-app-defaults-submit"
                onClick={onSubmit}
                disabled={submitting || !githubConfigured}
              >
                {submitting
                  ? t({ de: "PR wird geöffnet…", en: "Opening PR…" })
                  : t({ de: "PR öffnen", en: "Open PR" })}
              </Button>
            </div>

            {lastPr && (
              <Alert>
                <AlertTitle>
                  {t({ de: "PR geöffnet", en: "PR opened" })}
                </AlertTitle>
                <AlertDescription>
                  <a
                    href={lastPr.url}
                    target="_blank"
                    rel="noreferrer"
                    className="underline text-primary"
                    data-testid="link-app-defaults-pr"
                  >
                    {lang === "de"
                      ? `PR #${lastPr.number} auf GitHub öffnen`
                      : `Open PR #${lastPr.number} on GitHub`}
                  </a>
                </AlertDescription>
              </Alert>
            )}

            <PendingPrsCard
              prefix="update-app-defaults/"
              refreshKey={prsRefreshKey}
              emptyHint={t({
                de: "Keine offenen Defaults-PRs — alle Änderungen sind gemerged.",
                en: "No open defaults PRs — all changes are merged.",
              })}
            />
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// BucketAlternativesPanel — per-bucket curated-alternatives editor (2026-04-28)
// ---------------------------------------------------------------------------
// Lists every bucket showing its default ETF + its curated alternatives
// (the same alternatives surfaced by the Build tab's per-bucket ETF picker).
// Each bucket row exposes an inline-collapsible "Add alternative" form
// while the bucket sits below MAX_ALTERNATIVES_PER_BUCKET; submitting
// opens a GitHub PR appending the new alternative to that bucket's
// `alternatives:[…]` array via the /admin/bucket-alternatives route.
//
// Operator-Phrase: „Jeder ETF zur Auswahl benötigt eine eindeutige
// Bucket-Zuordnung." Each curated alternative is positional inside its
// parent bucket (no `key` of its own) and is capped at
// MAX_ALTERNATIVES_PER_BUCKET by validateCatalog. The cap is enforced
// both client-side (the form is
// hidden when at the cap) and server-side (the route returns 409
// cap_exceeded if the cap was reached after the form opened).
function BucketAlternativesPanel({
  githubConfigured,
}: {
  githubConfigured: boolean;
}) {
  const { t, lang } = useAdminT();
  const [catalog, setCatalog] = useState<CatalogSummary | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [prsRefreshKey, setPrsRefreshKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    adminApi
      .bucketAlternatives()
      .then((r) => {
        if (!cancelled) setCatalog(r.entries);
      })
      .catch((e) => {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
    // Reload on prsRefreshKey so the page reflects the post-merge state
    // (or at least the latest parser output) after the operator opens a
    // PR — critical because the alts cap is enforced against THIS
    // catalog, not the one that existed when the panel first mounted.
  }, [prsRefreshKey]);

  // Sort bucket keys alphabetically — same convention as datalist in
  // SuggestIsinPanel. Groups by prefix in practice (Commodities-…,
  // DigitalAssets-…, Equity-…, FixedIncome-…, RealEstate-…) which is
  // the most useful grouping for the operator scanning the list.
  const sortedKeys = useMemo(() => {
    if (!catalog) return [];
    return Object.keys(catalog).sort((a, b) => a.localeCompare(b));
  }, [catalog]);

  function handlePrCreated() {
    setOpenKey(null);
    setPrsRefreshKey((k) => k + 1);
  }

  // Removal flow: confirm with the operator (browser confirm — same
  // pattern used elsewhere in the admin pane), POST to the DELETE
  // endpoint, then refresh the panel. Server-side this opens an
  // `rm-alt/<isin>` PR that touches etfs.ts only — the look-through
  // pool entry stays put.
  async function handleRemoveAlt(
    parentKey: string,
    isin: string,
    name: string,
  ) {
    const confirmed = window.confirm(
      lang === "de"
        ? `Eine Pull-Request öffnen, die "${name}" (${isin}) als Alternative aus "${parentKey}" entfernt?\n\nDer Look-through-Datenpool wird NICHT angetastet — die Holdings/Geo/Sektor-Daten bleiben erhalten und können weiter genutzt werden.`
        : `Open a pull request removing "${name}" (${isin}) from "${parentKey}"?\n\nThe look-through data pool is NOT touched — the holdings/geo/sector data stay available and can keep being referenced.`,
    );
    if (!confirmed) return;
    try {
      const r = await adminApi.removeBucketAlternative(parentKey, isin);
      toast.success(
        t({
          de: "Pull-Request geöffnet (Entfernen)",
          en: "Pull request opened (remove)",
        }),
        {
          description: r.prUrl,
          action: {
            label: t({ de: "Öffnen", en: "Open" }),
            onClick: () => window.open(r.prUrl, "_blank"),
          },
        },
      );
      setPrsRefreshKey((k) => k + 1);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(
        t({
          de: "Entfernen fehlgeschlagen",
          en: "Remove failed",
        }),
        { description: msg },
      );
      setPrsRefreshKey((k) => k + 1);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {t({
            de: "Kuratierte Alternativen je Bucket",
            en: "Curated alternatives per bucket",
          })}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          {lang === "de" ? (
            <>
              Jeder Bucket zeigt im Build-Tab seinen Standard-ETF plus bis
              zu zwei kuratierte Alternativen. Hier kannst du eine neue
              Alternative hinzufügen — der Server öffnet einen GitHub-PR,
              der <code>etfs.ts</code> entsprechend ergänzt. Nach Merge +
              Redeploy ist die Alternative sofort im Build-Tab wählbar.
            </>
          ) : (
            <>
              Each bucket shows its default ETF plus up to two curated
              alternatives in the Build tab. Use this panel to add a new
              alternative — the server opens a GitHub PR that updates{" "}
              <code>etfs.ts</code>. After merge + redeploy the alternative
              becomes selectable in the Build tab.
            </>
          )}
        </p>

        {loadError && (
          <Alert variant="destructive">
            <AlertTitle>
              {t({
                de: "Katalog konnte nicht geladen werden",
                en: "Catalog could not be loaded",
              })}
            </AlertTitle>
            <AlertDescription>{loadError}</AlertDescription>
          </Alert>
        )}

        {!githubConfigured && (
          <Alert>
            <AlertTitle>
              {t({
                de: "GitHub nicht konfiguriert",
                en: "GitHub not configured",
              })}
            </AlertTitle>
            <AlertDescription>
              {lang === "de" ? (
                <>
                  Setze <code>GITHUB_PAT</code>, <code>GITHUB_OWNER</code> und{" "}
                  <code>GITHUB_REPO</code> auf dem api-server, um neue
                  Alternativen vorschlagen zu können.
                </>
              ) : (
                <>
                  Set <code>GITHUB_PAT</code>, <code>GITHUB_OWNER</code> and{" "}
                  <code>GITHUB_REPO</code> on the api-server to enable
                  proposing new alternatives.
                </>
              )}
            </AlertDescription>
          </Alert>
        )}

        {catalog === null && !loadError && (
          <div className="text-sm text-muted-foreground">
            {t({ de: "Lade Katalog …", en: "Loading catalog …" })}
          </div>
        )}

        {catalog && (
          <div className="space-y-2">
            {sortedKeys.map((key) => {
              const entry = catalog[key];
              const alts = entry.alternatives ?? [];
              const atCap = alts.length >= MAX_ALTERNATIVES_PER_BUCKET;
              const isOpen = openKey === key;
              return (
                <div
                  key={key}
                  className="border rounded-md p-3 bg-muted/20"
                  data-testid={`bucket-alts-row-${key}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <code className="text-xs font-semibold">{key}</code>
                        <Badge variant="secondary" className="text-[10px]">
                          {alts.length}/{MAX_ALTERNATIVES_PER_BUCKET}{" "}
                          {t({ de: "Alternativen", en: "alternatives" })}
                        </Badge>
                      </div>
                      <div className="text-sm font-medium truncate">
                        {entry.name}
                      </div>
                      <div className="text-[11px] text-muted-foreground">
                        {entry.isin} · {entry.terBps} bps · {entry.currency}
                      </div>
                      {alts.length > 0 && (
                        <ul className="mt-2 space-y-1">
                          {alts.map((alt, i) => (
                            <li
                              key={`${alt.isin}-${i}`}
                              className="text-xs pl-3 border-l-2 border-primary/40 flex items-start justify-between gap-2"
                              data-testid={`alt-row-${key}-${alt.isin}`}
                            >
                              <span className="min-w-0 flex-1">
                                <span className="font-medium">{alt.name}</span>
                                <span className="text-muted-foreground">
                                  {" "}
                                  · {alt.isin} · {alt.terBps} bps ·{" "}
                                  {alt.currency}
                                </span>
                              </span>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-6 px-2 text-[10px] text-destructive hover:bg-destructive/10"
                                disabled={!githubConfigured}
                                onClick={() =>
                                  handleRemoveAlt(key, alt.isin, alt.name)
                                }
                                data-testid={`button-remove-alt-${key}-${alt.isin}`}
                              >
                                {t({ de: "Entfernen", en: "Remove" })}
                              </Button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                    <Button
                      size="sm"
                      variant={isOpen ? "secondary" : "outline"}
                      disabled={atCap && !isOpen}
                      onClick={() => setOpenKey(isOpen ? null : key)}
                      data-testid={`button-add-alt-${key}`}
                    >
                      {atCap
                        ? t({ de: "Cap erreicht", en: "Cap reached" })
                        : isOpen
                          ? t({ de: "Schließen", en: "Close" })
                          : t({
                              de: "+ Alternative",
                              en: "+ Alternative",
                            })}
                    </Button>
                  </div>
                  {isOpen && !atCap && (
                    <AddAlternativeForm
                      parentKey={key}
                      githubConfigured={githubConfigured}
                      onCreated={handlePrCreated}
                    />
                  )}
                </div>
              );
            })}
          </div>
        )}

        <PendingPrsCard
          prefix="add-alt/"
          refreshKey={prsRefreshKey}
          emptyHint={t({
            de: "Keine offenen Alternativen-PRs — alle Vorschläge sind gemerged.",
            en: "No open alternatives PRs — all suggestions are merged.",
          })}
        />
      </CardContent>
    </Card>
  );
}

// Inline form for one bucket row. Mirrors the field set of PreviewEditor
// (which edits a top-level catalog entry) minus the `key` field — alts
// are positional inside their parent. Holds its own draft state so
// closing one row's form doesn't blow away another row's entered data.
function AddAlternativeForm({
  parentKey,
  githubConfigured,
  onCreated,
  presetIsin,
  presetName,
  presetInfo,
}: {
  parentKey: string;
  githubConfigured: boolean;
  onCreated: () => void;
  // Optional ISIN to pre-fill into the draft. Used by the consolidated
  // tree's "Bucket zuordnen" flow on unclassified pool entries — the
  // operator already knows the ISIN (it's the row they clicked), so we
  // skip a typing step. The form re-mounts when this changes (caller
  // sets a key) so the initial draft picks up the preset cleanly.
  presetIsin?: string;
  // Optional name pre-fill (we know it from the look-through pool when
  // attaching an existing pool entry). Saves another typing step and
  // means the form looks "ready to save" on open instead of blank.
  presetName?: string;
  // Optional small info card rendered above the form fields. The
  // attach-from-pool flow uses this to show what we already know about
  // the ISIN (source, last fetched, holding counts) so the operator
  // doesn't think the data is missing.
  presetInfo?: React.ReactNode;
}) {
  const { t, lang } = useAdminT();
  const [draft, setDraft] = useState<AddBucketAlternativeRequest>(() => {
    const base = blankAlternativeDraft();
    return {
      ...base,
      ...(presetIsin ? { isin: presetIsin.toUpperCase() } : {}),
      ...(presetName ? { name: presetName } : {}),
    };
  });
  const [submitting, setSubmitting] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [autofilling, setAutofilling] = useState(false);
  const [code, setCode] = useState<string | null>(null);
  const [errMsg, setErrMsg] = useState<string | null>(null);
  // Track whether we already fired the auto-justETF-fetch for this mount.
  // We only auto-fetch when `presetIsin` was supplied (i.e. the operator
  // came in through the "Bucket zuordnen" flow on an existing pool ISIN
  // — they already committed to attaching this ETF, so racing the
  // network for the metadata is the right default). For manually-typed
  // ISINs we keep the existing "user clicks Vorab-Daten" UX so we don't
  // spam justETF on every keystroke.
  const [didAutoFetch, setDidAutoFetch] = useState(false);

  // When the form mounts with a `presetIsin`, fetch justETF metadata
  // automatically so the operator sees a populated form (TER, domicile,
  // listings, …) instead of an empty one. Without this, "Bucket
  // zuordnen" feels like it lost data — the operator already saw the
  // pool entry on the row but the open form is blank until they click
  // Vorab-Daten themselves. Guarded by `didAutoFetch` so we only fire
  // once per mount even with React StrictMode double-invokes.
  useEffect(() => {
    if (!presetIsin || didAutoFetch) return;
    setDidAutoFetch(true);
    void runAutofill();
    // runAutofill is stable in this component scope (closure over draft
    // is fine because it only reads draft.isin which we pre-set in the
    // initial state above).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presetIsin, didAutoFetch]);

  // Auto-fill from justETF — same backend (`/admin/preview-isin`) as the
  // SuggestIsinPanel uses, just adapted to the alt-shape (no `key`
  // field). Saves the operator from typing 8 fields by hand for an ISIN
  // already on justETF. Listings/defaultExchange come from the scrape;
  // the operator can still tweak everything before submitting.
  async function runAutofill() {
    const isinTrim = draft.isin.trim().toUpperCase();
    if (!/^[A-Z]{2}[A-Z0-9]{9}\d$/.test(isinTrim)) {
      setErrMsg(
        t({
          de: "ISIN ungültig — gib eine gültige ISIN ein, bevor du Vorab-Daten holst.",
          en: "ISIN invalid — enter a valid ISIN before fetching defaults.",
        }),
      );
      return;
    }
    setErrMsg(null);
    setAutofilling(true);
    try {
      const p = await adminApi.preview(isinTrim);
      setDraft((d) => mergePreviewIntoAlternativeDraft(d, p));
    } catch (e: unknown) {
      setErrMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setAutofilling(false);
    }
  }

  const set = <K extends keyof AddBucketAlternativeRequest>(
    k: K,
    v: AddBucketAlternativeRequest[K],
  ) => setDraft((d) => ({ ...d, [k]: v }));

  // Defence-in-depth client-side validation — the server enforces the
  // same rules but failing fast in the UI saves a round-trip and gives
  // the operator a precise error.
  function clientValidate(): string | null {
    if (!/^[A-Z]{2}[A-Z0-9]{9}\d$/.test(draft.isin))
      return t({
        de: "ISIN ungültig (12 Zeichen, ISO-Format).",
        en: "ISIN invalid (12 chars, ISO format).",
      });
    if (!draft.name.trim())
      return t({ de: "Name ist erforderlich.", en: "Name is required." });
    if (!Number.isFinite(draft.terBps) || draft.terBps < 0 || draft.terBps > 500)
      return t({
        de: "TER muss in [0, 500] bps liegen.",
        en: "TER must be in [0, 500] bps.",
      });
    if (!draft.domicile.trim())
      return t({
        de: "Domizil ist erforderlich.",
        en: "Domicile is required.",
      });
    if (!/^[A-Z]{3}$/.test(draft.currency))
      return t({
        de: "Währung muss 3-Buchstaben-Code sein (z. B. USD).",
        en: "Currency must be a 3-letter code (e.g. USD).",
      });
    const listingKeys = Object.keys(draft.listings);
    if (listingKeys.length === 0)
      return t({
        de: "Mindestens ein Listing erforderlich.",
        en: "At least one listing required.",
      });
    if (!draft.listings[draft.defaultExchange])
      return t({
        de: "Standard-Börse muss ein Listing haben.",
        en: "Default exchange must have a listing.",
      });
    return null;
  }

  async function runPreview() {
    const v = clientValidate();
    if (v) {
      setErrMsg(v);
      return;
    }
    setErrMsg(null);
    setPreviewing(true);
    setCode(null);
    try {
      const r = await adminApi.renderBucketAlternative(parentKey, draft);
      setCode(r.code);
    } catch (e: unknown) {
      setErrMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setPreviewing(false);
    }
  }

  async function submitPr() {
    const v = clientValidate();
    if (v) {
      setErrMsg(v);
      return;
    }
    setErrMsg(null);
    setSubmitting(true);
    try {
      const r = await adminApi.addBucketAlternative(parentKey, draft);
      // Two PRs may have been opened: the etfs.ts one always (that's
      // `r.prUrl`), and the look-through pool one only if the justETF
      // scrape succeeded server-side AND the ISIN wasn't already
      // covered. Surface the right line in this priority order:
      //   1. PR opened → show its URL
      //   2. Already covered → green positive ack (no PR needed)
      //   3. Genuine error/incomplete → yellow skip line
      // Mixing (2) and (3) into one "übersprungen" message would read
      // like a problem to the operator, but case (2) is the happy path.
      const lookthroughLine = r.lookthroughPrUrl
        ? t({
            de: `Look-through-PR: ${r.lookthroughPrUrl}`,
            en: `Look-through PR: ${r.lookthroughPrUrl}`,
          })
        : r.lookthroughAlreadyPresent
          ? t({
              de: "Look-through-Daten bereits vorhanden — kein zweiter PR nötig.",
              en: "Look-through data already available — no second PR needed.",
            })
          : r.lookthroughError
            ? t({
                de: `Look-through-PR übersprungen: ${r.lookthroughError}`,
                en: `Look-through PR skipped: ${r.lookthroughError}`,
              })
            : null;
      toast.success(
        t({ de: "Pull-Request geöffnet", en: "Pull request opened" }),
        {
          description: lookthroughLine
            ? `${r.prUrl}\n${lookthroughLine}`
            : r.prUrl,
          action: {
            label: t({ de: "Öffnen", en: "Open" }),
            onClick: () => window.open(r.prUrl, "_blank"),
          },
        },
      );
      setDraft(blankAlternativeDraft());
      setCode(null);
      onCreated();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setErrMsg(msg);
      // Surface the error via a toast as well — `onCreated()` below
      // closes this form (so the operator can see the refreshed PR
      // list), which would unmount the inline <Alert> before they
      // notice it. Without the toast the click looked like nothing
      // happened. The toast persists through the form unmount.
      toast.error(
        t({
          de: "PR konnte nicht geöffnet werden",
          en: "Could not open pull request",
        }),
        { description: msg },
      );
      // Even on 409 ("branch already exists" / dup ISIN), refresh the
      // open-PRs list so the operator sees the existing PR that blocks
      // them — same UX contract as SuggestIsinPanel.
      onCreated();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mt-3 pt-3 border-t space-y-3">
      {presetInfo}
      {/* Sticky save bar — kept at the top of the form (not just at the
          bottom) so the operator on the attach-from-pool flow always
          knows where the action button is, even before they scroll past
          the 12+ field grid. The full-width primary button at the bottom
          is preserved for the manual-add flow's existing UX. */}
      {presetIsin && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-muted/40 px-3 py-2">
          <div className="text-xs text-muted-foreground">
            {autofilling
              ? t({
                  de: "Hole Stammdaten von justETF …",
                  en: "Fetching base data from justETF …",
                })
              : t({
                  de: "Felder geprüft? Speichern öffnet einen Pull-Request, der die ISIN dem Bucket als Alternative zuordnet.",
                  en: "Fields look right? Saving opens a pull request that attaches the ISIN to the bucket as an alternative.",
                })}
          </div>
          <Button
            size="sm"
            onClick={submitPr}
            disabled={submitting || autofilling || !githubConfigured}
            data-testid={`button-submit-alt-top-${parentKey}`}
          >
            {submitting
              ? t({ de: "Speichere …", en: "Saving …" })
              : t({
                  de: "Speichern (PR öffnen)",
                  en: "Save (open PR)",
                })}
          </Button>
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        <Field label="ISIN">
          <div className="flex gap-2">
            <Input
              value={draft.isin}
              onChange={(e) => set("isin", e.target.value.trim().toUpperCase())}
              placeholder="IE00B5BMR087"
              data-testid={`input-alt-isin-${parentKey}`}
            />
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={runAutofill}
              disabled={autofilling || !draft.isin.trim()}
              data-testid={`button-autofill-alt-${parentKey}`}
              title={t({
                de: "Felder aus justETF vorbefüllen (TER, Domizil, Replikation, Listings …). Kommentar bleibt erhalten.",
                en: "Pre-fill fields from justETF (TER, domicile, replication, listings …). Comment stays untouched.",
              })}
            >
              {autofilling
                ? t({ de: "Lädt …", en: "Loading…" })
                : t({ de: "Vorab-Daten", en: "Autofill" })}
            </Button>
          </div>
        </Field>
        <Field label={t({ de: "Name", en: "Name" })}>
          <Input
            value={draft.name}
            onChange={(e) => set("name", e.target.value)}
            data-testid={`input-alt-name-${parentKey}`}
          />
        </Field>
        <Field label={t({ de: "TER (bps)", en: "TER (bps)" })}>
          <Input
            type="number"
            value={draft.terBps}
            onChange={(e) => set("terBps", Number(e.target.value))}
          />
        </Field>
        <Field label={t({ de: "AUM (Mio. EUR)", en: "AUM (EUR mn)" })}>
          <Input
            type="number"
            value={draft.aumMillionsEUR ?? ""}
            onChange={(e) =>
              set(
                "aumMillionsEUR",
                e.target.value === "" ? undefined : Number(e.target.value),
              )
            }
          />
        </Field>
        <Field label={t({ de: "Domizil", en: "Domicile" })}>
          <Input
            value={draft.domicile}
            onChange={(e) => set("domicile", e.target.value)}
          />
        </Field>
        <Field label={t({ de: "Währung", en: "Currency" })}>
          <Input
            value={draft.currency}
            onChange={(e) => set("currency", e.target.value.toUpperCase())}
          />
        </Field>
        <Field label={t({ de: "Replikation", en: "Replication" })}>
          <Select
            value={draft.replication}
            onValueChange={(v) => set("replication", v as Replication)}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {REPLICATIONS.map((r) => (
                <SelectItem key={r} value={r}>
                  {r}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label={t({ de: "Ausschüttung", en: "Distribution" })}>
          <Select
            value={draft.distribution}
            onValueChange={(v) => set("distribution", v as Distribution)}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DISTRIBUTIONS.map((d) => (
                <SelectItem key={d} value={d}>
                  {d}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label={t({ de: "Auflagedatum", en: "Inception date" })}>
          <Input
            placeholder={t({ de: "JJJJ-MM-TT", en: "YYYY-MM-DD" })}
            value={draft.inceptionDate ?? ""}
            onChange={(e) =>
              set("inceptionDate", e.target.value || undefined)
            }
          />
        </Field>
        <Field label={t({ de: "Standard-Börse", en: "Default exchange" })}>
          <Select
            value={draft.defaultExchange}
            onValueChange={(v) => set("defaultExchange", v as Exchange)}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {EXCHANGES.map((x) => (
                <SelectItem key={x} value={x}>
                  {x}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </div>

      <Field
        label={t({
          de: "Kommentar (wird in Tooltips angezeigt)",
          en: "Comment (shown in tooltips)",
        })}
      >
        <Textarea
          rows={2}
          value={draft.comment}
          onChange={(e) => set("comment", e.target.value)}
        />
      </Field>

      <div>
        <Label className="text-xs">
          {t({
            de: "Listings (Ticker je Börse)",
            en: "Listings (ticker per exchange)",
          })}
        </Label>
        <div className="grid grid-cols-2 gap-2 mt-1">
          {EXCHANGES.map((ex) => (
            <div key={ex} className="flex items-center gap-2">
              <span className="text-xs w-16">{ex}</span>
              <Input
                placeholder={t({ de: "(keine)", en: "(none)" })}
                value={draft.listings[ex]?.ticker ?? ""}
                onChange={(e) => {
                  const next = { ...draft.listings };
                  if (e.target.value.trim()) {
                    next[ex] = { ticker: e.target.value.trim() };
                  } else {
                    delete next[ex];
                  }
                  setDraft((d) => ({ ...d, listings: next }));
                }}
              />
            </div>
          ))}
        </div>
      </div>

      {errMsg && (
        <Alert variant="destructive">
          <AlertTitle>{t({ de: "Fehler", en: "Error" })}</AlertTitle>
          <AlertDescription className="break-words">{errMsg}</AlertDescription>
        </Alert>
      )}

      {code && (
        <details className="text-xs">
          <summary className="cursor-pointer text-muted-foreground">
            {t({
              de: "Generiertes TS-Snippet anzeigen",
              en: "Show generated TS snippet",
            })}
          </summary>
          <pre className="mt-2 p-2 bg-muted rounded text-[11px] overflow-x-auto">
            {code}
          </pre>
        </details>
      )}

      <div className="flex gap-2">
        <Button
          variant="outline"
          onClick={runPreview}
          disabled={previewing || submitting}
          data-testid={`button-preview-alt-${parentKey}`}
        >
          {previewing ? (
            <RefreshCw className="h-4 w-4 animate-spin" />
          ) : (
            t({ de: "Vorschau", en: "Preview" })
          )}
        </Button>
        <Button
          className="flex-1"
          onClick={submitPr}
          disabled={submitting || !githubConfigured}
          data-testid={`button-submit-alt-${parentKey}`}
        >
          {submitting
            ? t({ de: "PR wird geöffnet …", en: "Opening PR …" })
            : t({
                de: "PR öffnen: Alternative hinzufügen",
                en: "Open PR: add alternative",
              })}
        </Button>
      </div>
    </div>
  );
}

function blankAlternativeDraft(): AddBucketAlternativeRequest {
  return {
    name: "",
    isin: "",
    terBps: 0,
    domicile: "Ireland",
    replication: "Physical",
    distribution: "Accumulating",
    currency: "USD",
    comment: "",
    defaultExchange: "LSE",
    listings: {},
  };
}

// Suppress unused-import warning when the page doesn't reference
// AlternativeEntrySummary directly elsewhere — the type is re-exported
// for external consumers via admin-api.
type _AltSummaryRef = AlternativeEntrySummary;

// ===========================================================================
// ConsolidatedEtfTreePanel — single tree view replacing three legacy panels
// ===========================================================================
// Replaces (2026-04-28):
//   - BrowseBucketsPanel        (read-only catalog browse)
//   - LookthroughPoolPanel      (flat table of pool entries)
//   - BucketAlternativesPanel   (per-bucket alternatives editor)
//
// Why: those three views overlapped heavily. Operators had to mentally
// cross-reference them to answer "which alternatives in this bucket
// actually have look-through data?". This panel folds everything into
// one bucket-first tree with look-through columns shown inline.
//
// Tree shape:
//   Asset class           (e.g. "Equity")
//     └─ Bucket           (e.g. "Equity-USA — iShares MSCI USA")
//         ├─ Default      (the catalog's primary ETF for that bucket)
//         ├─ Alternative  (zero or more curated swaps; cap = 2)
//         └─ Alternative
//   Nicht zugeordnet      (pool ISINs not used as default OR alternative
//     └─ Pool-only         anywhere — needs a bucket attachment)
//
// Each row shows: ISIN · Name · Type-Badge · Look-through-Status (with
// top/geo/sector counts + asOf) · Pool source (Kuratiert / Auto-Refresh /
// Beide / —) · Per-row action (Remove for alts, "Bucket zuordnen" for
// pool-only).
//
// Header bar carries the two pool-level operator levers preserved from
// LookthroughPoolPanel: single-ISIN pool add and the bulk backfill that
// scans the catalog for missing look-through data.
// ===========================================================================
function ConsolidatedEtfTreePanel({
  catalog: _topCatalog,
  catalogError: topCatalogError,
  githubConfigured,
}: {
  catalog: CatalogSummary | null;
  catalogError: string | null;
  githubConfigured: boolean;
}) {
  const { t, lang } = useAdminT();

  // Catalog WITH alternatives (separate endpoint from the regular catalog
  // load — only /admin/bucket-alternatives populates the alternatives
  // field reliably). We re-fetch on every PR-creating action via
  // prsRefreshKey so the tree reflects post-merge state quickly.
  const [catalog, setCatalog] = useState<CatalogSummary | null>(null);
  const [catalogLoadError, setCatalogLoadError] = useState<string | null>(null);
  const [pool, setPool] = useState<LookthroughPoolEntry[] | null>(null);
  const [poolLoadError, setPoolLoadError] = useState<string | null>(null);
  const [prsRefreshKey, setPrsRefreshKey] = useState(0);

  // Header-bar state — single-ISIN pool add and bulk backfill carry their
  // own submit/result state separate from the per-row attach/remove flows
  // below so spinners don't visually leak across unrelated operations.
  const [poolIsin, setPoolIsin] = useState("");
  const [submittingPoolAdd, setSubmittingPoolAdd] = useState(false);
  const [headerErrMsg, setHeaderErrMsg] = useState<string | null>(null);
  const [lastPoolPr, setLastPoolPr] = useState<{
    url: string;
    number: number;
    isin: string;
  } | null>(null);
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

  // Tree expansion state — persisted in sessionStorage so the operator's
  // drilled-in view survives page reloads. Mirrors BrowseBucketsPanel
  // pattern but stored under a distinct key so the two panels can coexist
  // during a soft rollout.
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

  // Per-row action state. `attaching` = which pool-only ISIN currently
  // has its "Bucket zuordnen" form expanded (only one at a time so the
  // UI doesn't sprout multiple inline forms). `addingAltKey` = which
  // bucket currently has its "+ Alternative" form expanded.
  const [attaching, setAttaching] = useState<{
    isin: string;
    presetName?: string;
  } | null>(null);
  const [addingAltKey, setAddingAltKey] = useState<string | null>(null);

  // Load both data sources in parallel. Re-runs whenever a PR succeeds
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

  // Build a fast lookup: ISIN → look-through pool entry. Used for the
  // per-row LT columns. Key is uppercase to defeat any source casing
  // inconsistency between catalog and pool.
  const poolByIsin = useMemo(() => {
    const m = new Map<string, LookthroughPoolEntry>();
    for (const p of pool ?? []) m.set(p.isin.toUpperCase(), p);
    return m;
  }, [pool]);

  // Set of ISINs currently used as default OR alternative in the catalog.
  // Drives the "Nicht zugeordnet" group: pool entries NOT in this set are
  // bucket-orphan and need attaching.
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

  // Group catalog buckets by asset class (Equity/FixedIncome/RealEstate/
  // Commodities/DigitalAssets) — same convention BrowseBucketsPanel uses.
  // We DON'T use BucketTree here because we need a wider row layout
  // (look-through columns + actions) than that component supports.
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

  // Single-ISIN pool add (header bar). Reuses the existing endpoint that
  // LookthroughPoolPanel called — same scrape + 422-incomplete + 409-already
  // handling, just rewired to refresh the consolidated tree's data after.
  async function addToPool() {
    const trimmed = poolIsin.trim().toUpperCase();
    if (!trimmed) return;
    setSubmittingPoolAdd(true);
    setHeaderErrMsg(null);
    setLastPoolPr(null);
    try {
      const r = await adminApi.addLookthroughPoolIsin(trimmed);
      setLastPoolPr({ url: r.prUrl, number: r.prNumber, isin: r.isin });
      toast.success(
        lang === "de"
          ? `PR #${r.prNumber} geöffnet für ${r.isin}`
          : `PR #${r.prNumber} opened for ${r.isin}`,
        {
          description:
            lang === "de"
              ? `${r.topHoldingCount} Holdings · ${r.geoCount} Länder · ${r.sectorCount} Sektoren — Review + merge erforderlich, dann redeploy.`
              : `${r.topHoldingCount} holdings · ${r.geoCount} countries · ${r.sectorCount} sectors — review + merge required, then redeploy.`,
          action: {
            label: t({ de: "Öffnen", en: "Open" }),
            onClick: () => window.open(r.prUrl, "_blank"),
          },
        },
      );
      setPoolIsin("");
      setPrsRefreshKey((k) => k + 1);
    } catch (e: unknown) {
      setHeaderErrMsg(e instanceof Error ? e.message : String(e));
      setPrsRefreshKey((k) => k + 1);
    } finally {
      setSubmittingPoolAdd(false);
    }
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
            ? `Bulk-PR #${r.prNumber} mit ${r.added.length} ISIN${r.added.length === 1 ? "" : "s"} geöffnet`
            : `Bulk PR #${r.prNumber} opened with ${r.added.length} ISIN${r.added.length === 1 ? "" : "s"}`,
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

  // Per-row Remove (alternatives only — defaults are part of the catalog
  // baseline and removing them needs a different flow). Browser confirm
  // mirrors the legacy BucketAlternativesPanel pattern.
  async function removeAlt(parentKey: string, isin: string, name: string) {
    const confirmed = window.confirm(
      lang === "de"
        ? `Pull-Request öffnen, die "${name}" (${isin}) als Alternative aus "${parentKey}" entfernt?\n\nDer Look-through-Datenpool wird NICHT angetastet — die Holdings/Geo/Sektor-Daten bleiben erhalten.`
        : `Open a pull request removing "${name}" (${isin}) from "${parentKey}"?\n\nThe look-through data pool is NOT touched — holdings/geo/sector data stay available.`,
    );
    if (!confirmed) return;
    try {
      const r = await adminApi.removeBucketAlternative(parentKey, isin);
      toast.success(
        lang === "de"
          ? `Remove-PR #${r.prNumber} geöffnet`
          : `Remove PR #${r.prNumber} opened`,
        {
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
        {/* Header bar: pool-level operator levers (single add + bulk backfill).
            Kept separate from the per-row tree actions so the two flows don't
            visually interfere. */}
        <div className="rounded-md border bg-muted/30 p-3 space-y-3">
          <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
            <div className="text-xs text-muted-foreground sm:flex-1">
              {lang === "de"
                ? "ISIN direkt in den Look-through-Datenpool aufnehmen (ohne Bucket-Zuordnung — z.B. als reines Lookup-Ziel)."
                : "Add an ISIN directly to the look-through data pool (no bucket attachment — e.g. as a lookup-only entry)."}
            </div>
            <div className="flex gap-2">
              <Input
                placeholder={t({
                  de: "z. B. IE00B5BMR087",
                  en: "e.g. IE00B5BMR087",
                })}
                value={poolIsin}
                onChange={(e) => setPoolIsin(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && poolIsin.trim()) void addToPool();
                }}
                disabled={submittingPoolAdd || !githubConfigured}
                className="w-48"
                data-testid="input-tree-pool-isin"
              />
              <Button
                onClick={() => void addToPool()}
                disabled={
                  submittingPoolAdd || !poolIsin.trim() || !githubConfigured
                }
                data-testid="button-tree-pool-add"
              >
                {submittingPoolAdd ? (
                  <RefreshCw className="h-4 w-4 animate-spin" />
                ) : (
                  t({ de: "Pool-Add", en: "Pool add" })
                )}
              </Button>
              <Button
                variant="outline"
                onClick={() => void runBackfill()}
                disabled={backfilling || !githubConfigured}
                data-testid="button-tree-backfill"
                title={t({
                  de: "Scannt Katalog-ISINs ohne Look-through-Daten und öffnet einen gemeinsamen PR (1-2 min).",
                  en: "Scans catalog ISINs without look-through data and opens one combined PR (1-2 min).",
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
          {lastPoolPr && (
            <Alert className="border-emerald-600/40 text-emerald-900 dark:text-emerald-200">
              <AlertTitle className="text-xs">
                {lang === "de"
                  ? `Pool-PR #${lastPoolPr.number} für ${lastPoolPr.isin} geöffnet`
                  : `Pool PR #${lastPoolPr.number} for ${lastPoolPr.isin} opened`}
              </AlertTitle>
              <AlertDescription className="text-xs">
                <a
                  href={lastPoolPr.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="underline"
                >
                  {t({ de: "PR auf GitHub →", en: "PR on GitHub →" })}
                </a>
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
                    ? `Bulk-PR #${backfillResult.prNumber} mit ${backfillResult.added.length} ISIN${backfillResult.added.length === 1 ? "" : "s"} geöffnet`
                    : `Bulk PR #${backfillResult.prNumber} opened with ${backfillResult.added.length} ISIN${backfillResult.added.length === 1 ? "" : "s"}`
                  : backfillResult.missing === 0
                    ? t({
                        de: "Alle Katalog-ISINs sind abgedeckt",
                        en: "All catalog ISINs are covered",
                      })
                    : t({
                        de: "Backfill abgeschlossen — kein PR",
                        en: "Backfill done — no PR",
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
                    {t({ de: "Bulk-PR auf GitHub →", en: "Bulk PR on GitHub →" })}
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

        {/* Combined open-PRs strip — both alt-add and pool-add flows feed
            into the same tree, so the operator should see all pending PRs
            in one place. Two cards because the prefix filter is per-call. */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <PendingPrsCard
            prefix="add-alt/"
            refreshKey={prsRefreshKey}
            title={t({
              de: "Alternativen hinzufügen — offene PRs",
              en: "Add alternatives — open PRs",
            })}
            emptyHint={t({
              de: "Keine offenen Alt-Add-PRs.",
              en: "No open alt-add PRs.",
            })}
          />
          <PendingPrsCard
            prefix="rm-alt/"
            refreshKey={prsRefreshKey}
            title={t({
              de: "Alternativen entfernen — offene PRs",
              en: "Remove alternatives — open PRs",
            })}
            emptyHint={t({
              de: "Keine offenen Alt-Remove-PRs.",
              en: "No open alt-remove PRs.",
            })}
          />
          <PendingPrsCard
            prefix="add-lookthrough-pool/"
            refreshKey={prsRefreshKey}
            title={t({
              de: "Look-through-Pool — offene PRs",
              en: "Look-through pool — open PRs",
            })}
            emptyHint={t({
              de: "Keine offenen Pool-PRs.",
              en: "No open pool PRs.",
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
                        const altsAtCap =
                          alts.length >= MAX_ALTERNATIVES_PER_BUCKET;
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
                              <div className="flex items-center gap-2">
                                <span className="text-xs text-muted-foreground">
                                  {alts.length}/{MAX_ALTERNATIVES_PER_BUCKET}{" "}
                                  {t({ de: "Alt.", en: "alt." })}
                                </span>
                                {githubConfigured && (
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant={
                                      addingAltKey === leaf.key
                                        ? "secondary"
                                        : "outline"
                                    }
                                    onClick={() =>
                                      setAddingAltKey((cur) =>
                                        cur === leaf.key ? null : leaf.key,
                                      )
                                    }
                                    disabled={altsAtCap}
                                    title={
                                      altsAtCap
                                        ? t({
                                            de: `Maximal ${MAX_ALTERNATIVES_PER_BUCKET} Alternativen pro Bucket erreicht`,
                                            en: `Maximum ${MAX_ALTERNATIVES_PER_BUCKET} alternatives per bucket reached`,
                                          })
                                        : undefined
                                    }
                                    data-testid={`button-tree-add-alt-${leaf.key}`}
                                  >
                                    {addingAltKey === leaf.key
                                      ? t({ de: "Schließen", en: "Close" })
                                      : t({
                                          de: "+ Alternative",
                                          en: "+ Alternative",
                                        })}
                                  </Button>
                                )}
                              </div>
                            </div>
                            <BucketRowsTable
                              parentKey={leaf.key}
                              defaultEntry={entry}
                              alternatives={alts}
                              poolByIsin={poolByIsin}
                              onRemoveAlt={removeAlt}
                              githubConfigured={githubConfigured}
                            />
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

// ---------------------------------------------------------------------------
// BucketRowsTable — the per-bucket table of [Default + Alternatives] with
// look-through columns. Pulled out as a sub-component so the main
// ConsolidatedEtfTreePanel render stays readable. Pure presentational.
// ---------------------------------------------------------------------------
function BucketRowsTable({
  parentKey,
  defaultEntry,
  alternatives,
  poolByIsin,
  onRemoveAlt,
  githubConfigured,
}: {
  parentKey: string;
  defaultEntry: CatalogEntrySummary;
  alternatives: AlternativeEntrySummary[];
  poolByIsin: Map<string, LookthroughPoolEntry>;
  onRemoveAlt: (parentKey: string, isin: string, name: string) => void;
  githubConfigured: boolean;
}) {
  const { t, lang } = useAdminT();
  const rows: Array<{
    role: "default" | "alt";
    name: string;
    isin: string;
  }> = [
    { role: "default", name: defaultEntry.name, isin: defaultEntry.isin },
    ...alternatives.map((a) => ({
      role: "alt" as const,
      name: a.name,
      isin: a.isin,
    })),
  ];
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs" data-testid={`tree-table-${parentKey}`}>
        <thead className="text-muted-foreground">
          <tr className="text-left">
            <th className="px-2 py-1 font-medium w-20">
              {t({ de: "Rolle", en: "Role" })}
            </th>
            <th className="px-2 py-1 font-medium">ISIN</th>
            <th className="px-2 py-1 font-medium">
              {t({ de: "Name", en: "Name" })}
            </th>
            <th className="px-2 py-1 font-medium">
              {t({ de: "LT-Status", en: "LT status" })}
            </th>
            <th className="px-2 py-1 font-medium" title="Top / Geo / Sektor">
              T/G/S
            </th>
            <th className="px-2 py-1 font-medium">
              {t({ de: "Quelle", en: "Source" })}
            </th>
            <th className="px-2 py-1 font-medium">
              {t({ de: "Stand", en: "As of" })}
            </th>
            <th className="px-2 py-1 font-medium w-24"></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const lt = poolByIsin.get(r.isin.toUpperCase());
            return (
              <tr
                key={`${r.role}-${r.isin}`}
                className="border-t"
                data-testid={`tree-row-${parentKey}-${r.isin}`}
              >
                <td className="px-2 py-1">
                  <Badge
                    variant="outline"
                    className={
                      r.role === "default"
                        ? "border-primary text-primary"
                        : "border-slate-500 text-slate-700 dark:text-slate-300"
                    }
                  >
                    {r.role === "default"
                      ? t({ de: "Default", en: "Default" })
                      : t({ de: "Alt", en: "Alt" })}
                  </Badge>
                </td>
                <td className="px-2 py-1 font-mono">{r.isin}</td>
                <td className="px-2 py-1">
                  <span className="truncate inline-block max-w-[36ch]" title={r.name}>
                    {r.name}
                  </span>
                </td>
                <td className="px-2 py-1">
                  <LookthroughStatusBadge entry={lt} />
                </td>
                <td className="px-2 py-1 font-mono">
                  {lt
                    ? `${lt.topHoldingCount}/${lt.geoCount}/${lt.sectorCount}`
                    : "—"}
                </td>
                <td className="px-2 py-1">
                  <PoolSourceBadge entry={lt} />
                </td>
                <td className="px-2 py-1 text-muted-foreground">
                  {lt?.topHoldingsAsOf || lt?.breakdownsAsOf || "—"}
                </td>
                <td className="px-2 py-1 text-right">
                  {r.role === "alt" && githubConfigured && (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => onRemoveAlt(parentKey, r.isin, r.name)}
                      className="h-7 px-2 text-xs text-rose-700 hover:text-rose-800 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-950"
                      data-testid={`button-tree-remove-alt-${parentKey}-${r.isin}`}
                    >
                      {t({ de: "Entfernen", en: "Remove" })}
                    </Button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// UnclassifiedRow — one pool entry with no bucket attachment. Renders as a
// compact summary row + an inline "attach" form (bucket picker + the
// existing AddAlternativeForm pre-keyed to the chosen bucket). The ISIN
// is pre-filled into the form via a hidden controlled input — operator
// just needs to click "Vorab-Daten holen" to autofill the rest.
// ---------------------------------------------------------------------------
function UnclassifiedRow({
  poolEntry,
  attaching,
  onAttachOpen,
  onCreated,
  catalogKeys,
  githubConfigured,
}: {
  poolEntry: LookthroughPoolEntry;
  attaching: { isin: string; presetName?: string } | null;
  onAttachOpen: () => void;
  onCreated: () => void;
  catalogKeys: string[];
  githubConfigured: boolean;
}) {
  const { t, lang } = useAdminT();
  const isOpen = attaching?.isin === poolEntry.isin;
  const [pickedBucket, setPickedBucket] = useState<string>("");
  // State for the look-through detail dialog (same content as the
  // ETFDetailsDialog used in the portfolio view) — operator opens it
  // before deciding whether to attach the ISIN to a bucket so they can
  // inspect the geo/sector/currency/top-holdings data we already have.
  const [lookthroughOpen, setLookthroughOpen] = useState(false);

  return (
    <div
      className="rounded border bg-background p-2"
      data-testid={`tree-unclassified-${poolEntry.isin}`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <Badge
            variant="outline"
            className="border-violet-600 text-violet-700 dark:text-violet-400 shrink-0"
          >
            {t({ de: "Pool-only", en: "Pool-only" })}
          </Badge>
          <span className="font-mono text-xs">{poolEntry.isin}</span>
          {poolEntry.name && (
            <span
              className="text-xs text-muted-foreground italic truncate"
              title={poolEntry.name}
            >
              · {poolEntry.name}
            </span>
          )}
          <LookthroughStatusBadge entry={poolEntry} />
          <span className="text-xs font-mono text-muted-foreground shrink-0">
            {poolEntry.topHoldingCount}/{poolEntry.geoCount}/
            {poolEntry.sectorCount}
          </span>
          <PoolSourceBadge entry={poolEntry} />
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => setLookthroughOpen(true)}
            data-testid={`button-tree-lookthrough-${poolEntry.isin}`}
            title={t({
              de: "Look-through-Daten ansehen",
              en: "View look-through data",
            })}
          >
            {t({ de: "Look-through", en: "Look-through" })}
          </Button>
          {githubConfigured && (
            <Button
              type="button"
              size="sm"
              variant={isOpen ? "secondary" : "outline"}
              onClick={onAttachOpen}
              data-testid={`button-tree-attach-${poolEntry.isin}`}
            >
              {isOpen
                ? t({ de: "Schließen", en: "Close" })
                : t({ de: "Bucket zuordnen", en: "Attach to bucket" })}
            </Button>
          )}
        </div>
      </div>
      <EtfLookthroughDialog
        isin={lookthroughOpen ? poolEntry.isin : null}
        name={poolEntry.name}
        open={lookthroughOpen}
        onOpenChange={setLookthroughOpen}
      />
      {isOpen && (
        <div className="mt-2 border-t pt-2 space-y-2">
          <div className="flex items-center gap-2 text-xs">
            <label className="font-medium">
              {t({ de: "Ziel-Bucket:", en: "Target bucket:" })}
            </label>
            <select
              value={pickedBucket}
              onChange={(e) => setPickedBucket(e.target.value)}
              className="border rounded px-2 py-1 text-xs bg-background"
              data-testid={`select-tree-attach-bucket-${poolEntry.isin}`}
            >
              <option value="">
                {t({ de: "— bitte wählen —", en: "— please pick —" })}
              </option>
              {catalogKeys
                .slice()
                .sort((a, b) => a.localeCompare(b))
                .map((k) => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ))}
            </select>
          </div>
          {pickedBucket ? (
            <AddAlternativeForm
              key={`${poolEntry.isin}-${pickedBucket}`}
              parentKey={pickedBucket}
              githubConfigured={githubConfigured}
              onCreated={onCreated}
              presetIsin={poolEntry.isin}
              presetName={poolEntry.name ?? undefined}
              presetInfo={
                <div
                  className="rounded-md border bg-sky-50 dark:bg-sky-950/40 p-3 text-xs space-y-1"
                  data-testid={`tree-attach-info-${poolEntry.isin}`}
                >
                  <div className="font-medium text-sky-900 dark:text-sky-200">
                    {t({
                      de: "Bereits im Look-through-Pool vorhanden:",
                      en: "Already on file in the look-through pool:",
                    })}
                  </div>
                  <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-sky-900 dark:text-sky-200">
                    <span className="text-muted-foreground">ISIN</span>
                    <span className="font-mono">{poolEntry.isin}</span>
                    {poolEntry.name && (
                      <>
                        <span className="text-muted-foreground">
                          {t({ de: "Name", en: "Name" })}
                        </span>
                        <span>{poolEntry.name}</span>
                      </>
                    )}
                    <span className="text-muted-foreground">
                      {t({ de: "Quelle", en: "Source" })}
                    </span>
                    <span>
                      {poolEntry.source === "pool"
                        ? t({ de: "Auto-Refresh", en: "Auto-refresh" })
                        : poolEntry.source === "both"
                          ? t({ de: "Beide", en: "Both" })
                          : t({ de: "Kuratiert", en: "Curated" })}
                    </span>
                    <span className="text-muted-foreground">
                      {t({ de: "Top/Geo/Sektor", en: "Top/Geo/Sector" })}
                    </span>
                    <span className="font-mono">
                      {poolEntry.topHoldingCount}/{poolEntry.geoCount}/
                      {poolEntry.sectorCount}
                    </span>
                    {(poolEntry.topHoldingsAsOf ||
                      poolEntry.breakdownsAsOf) && (
                      <>
                        <span className="text-muted-foreground">
                          {t({ de: "Stand", en: "As of" })}
                        </span>
                        <span>
                          {poolEntry.topHoldingsAsOf ||
                            poolEntry.breakdownsAsOf}
                        </span>
                      </>
                    )}
                  </div>
                  <div className="text-muted-foreground pt-1 border-t border-sky-200 dark:border-sky-900 mt-2">
                    {t({
                      de: "ISIN und Name wurden bereits eingetragen. Wir holen die übrigen Stammdaten (TER, Domizil, Listings …) automatisch von justETF — danach prüfen und oben speichern.",
                      en: "ISIN and name are already filled in. We fetch the remaining base data (TER, domicile, listings …) from justETF automatically — review them and save above.",
                    })}
                  </div>
                </div>
              }
            />
          ) : (
            <p className="text-xs text-muted-foreground">
              {t({
                de: "Bucket wählen, dann erscheint das Add-Formular mit der ISIN und den bekannten Pool-Daten vorausgefüllt.",
                en: "Pick a bucket — the add form will appear with the ISIN and the known pool data pre-filled.",
              })}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// LookthroughStatusBadge / PoolSourceBadge — tiny presentational helpers
// reused across both the per-bucket rows and the unclassified rows.
// ---------------------------------------------------------------------------
function LookthroughStatusBadge({
  entry,
}: {
  entry: LookthroughPoolEntry | undefined;
}) {
  const { t, lang } = useAdminT();
  if (!entry) {
    return (
      <Badge
        variant="outline"
        className="border-rose-600/40 text-rose-700 dark:text-rose-400"
      >
        {t({ de: "Keine LT-Daten", en: "No LT data" })}
      </Badge>
    );
  }
  const status = computePoolStatus(entry);
  return (
    <Badge
      variant="outline"
      className={
        status.tone === "ok"
          ? "border-emerald-600 text-emerald-700 dark:text-emerald-400"
          : status.tone === "stale"
            ? "border-amber-600 text-amber-700 dark:text-amber-400"
            : "border-rose-600 text-rose-700 dark:text-rose-400"
      }
    >
      {poolStatusLabel(status.tone, lang)}
    </Badge>
  );
}

function PoolSourceBadge({
  entry,
}: {
  entry: LookthroughPoolEntry | undefined;
}) {
  const { t } = useAdminT();
  if (!entry) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }
  return (
    <Badge
      variant="outline"
      className={
        entry.source === "pool"
          ? "border-sky-600 text-sky-700 dark:text-sky-400"
          : entry.source === "both"
            ? "border-violet-600 text-violet-700 dark:text-violet-400"
            : "border-slate-500 text-slate-700 dark:text-slate-400"
      }
    >
      {entry.source === "pool"
        ? t({ de: "Auto-Refresh", en: "Auto-refresh" })
        : entry.source === "both"
          ? t({ de: "Beide", en: "Both" })
          : t({ de: "Kuratiert", en: "Curated" })}
    </Badge>
  );
}

// ===========================================================================
// WorkspaceSyncPanel — local git workspace sync from origin/main (Task #51)
// ===========================================================================
// Why this panel exists: the admin add-alternative flow grew shaky in
// late April 2026 because operators were running batch-adds against an
// out-of-date local checkout — the per-row endpoint reads the catalog
// from disk for its preflight, so a missing-on-disk parent bucket would
// surface as `parent_missing` even though the bucket exists on
// origin/main. Sync FIRST, then queue alternatives.
//
// Visible state (GET — instant, no network call as of Task #54):
//   - Branch name + 7-char HEAD sha
//   - Commits behind / ahead of origin/main (badge) — derived from the
//     locally cached origin ref, i.e. the result of the last successful
//     fetch. Stay populated even when offline.
//   - Dirty workdir counts (staged / modified / untracked)
//   - "No origin remote configured" hint in checkouts (e.g. the default
//     Replit dev sandbox) where the fetch button is disabled.
//   - "Lock file present" hint when .git/index.lock exists
//   - "Workspace sync unavailable" message in production deploys
//     (no .git directory)
//
// Actions:
//   "Refresh from origin" (POST /workspace-sync/fetch, Task #54) — runs
//     `git fetch origin <base>` on demand. Sets `fetchAttempted: true`
//     on the response so the panel surfaces a "Could not refresh remote"
//     warning if (and only if) the fetch failed. Disabled when origin
//     is not configured.
//   "Sync workspace from main" (POST /workspace-sync) — runs git fetch
//     + git merge --ff-only. On success shows oldSha → newSha + the
//     changed files. On refusal surfaces the typed reason as a plain-
//     language message rendered verbatim (the server message ends with
//     the next step the operator should take).
// ===========================================================================
function WorkspaceSyncPanel() {
  const { t, lang } = useAdminT();
  const [status, setStatus] = useState<WorkspaceSyncStatus | null>(null);
  const [statusErr, setStatusErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // `fetching` (Task #54, 2026-04-28) is the dedicated "Refresh from
  // origin" spinner — separate from `loading` so the routine instant
  // status refresh doesn't flash the (slower) network-bound spinner.
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

  // Operator-initiated `git fetch origin <base>` (Task #54). Hits the
  // dedicated POST endpoint, which returns the same status payload with
  // `fetchAttempted: true` plus an updated behind/ahead derived from
  // the freshly-pulled remote ref.
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
      // Refusal cases (4xx) come through as Error.message — the server
      // already formatted them as plain-language strings ending with
      // the next-step suggestion.
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

// ===========================================================================
// BatchAddAlternativesPanel — queue N rows, one PR (Task #51)
// ===========================================================================
// Sits next to the per-bucket single-add form (which lives inside the
// consolidated tree). The single-add form remains for one-offs; this
// panel exists for the common "I want to add 4-5 alternatives across
// 3 buckets in one sitting" workflow.
//
// Per-row inputs (minimum):
//   - parentKey  (required, free-text — operator copies the catalog key
//                 from the consolidated tree above. Validation server-side.)
//   - isin       (required, ISO 6166)
//   - default exchange (optional — server picks the first scraped
//                 listing if blank)
//   - comment    (optional — server uses "" if blank)
//
// We deliberately do NOT scrape per row in the UI: the server scrapes
// during the dryRun/submit pass. This keeps the UI fast (no per-row
// network) and means the operator sees the FULL preview in one shot,
// which is the value-add over the per-row form.
//
// Buttons:
//   - "Vorschau" → POST dryRun=true, render per-row outcomes + a
//     diff summary (count of would-add lines + would-skip rows) +
//     the look-through scrape plan.
//   - "Batch absenden" → POST dryRun=false, render PR links + the
//     final per-row outcomes including look-through status.
//
// We don't try to render a true unified diff (the etfs.ts file is
// 4-5k lines; a client-side diff lib would bloat the bundle). The PR
// view on GitHub already does this perfectly — the preview here is
// about row-level preflight, not character-level diff.
// ===========================================================================
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

// Local-only diagnostic for a batch row. Mirrors the subset of
// BulkAltRowStatus the client can decide WITHOUT scraping (i.e. from
// the catalog already in memory). The server runs the same checks
// authoritatively on Preview/Submit; this is a UX shortcut so the
// operator doesn't burn a 10-second scrape pass to learn that some
// of their ISINs hit the per-bucket alternatives cap (Task #53).
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

// Mirrors the preflight inside artifacts/api-server/src/routes/admin.ts
// (bulk-bucket-alternatives handler). Run in source order so intra-batch
// dedup + cap-counting matches the server: an earlier row that grabs
// the last alternative slot in "Equity-USA" must cause the next row
// targeting the same bucket to flag cap_exceeded immediately, not on
// the round-trip.
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
    // Row passes all client-decidable gates — accumulate intra-batch
    // state so subsequent rows targeting the same bucket / ISIN see
    // it as taken.
    usedIsins.set(isin, `${parentKey} (this batch)`);
    bucketAltCount.set(parentKey, (bucketAltCount.get(parentKey) ?? 0) + 1);
    out.set(r.uid, { kind: "ok" });
  }
  return out;
}

function BatchAddAlternativesPanel({
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
  // refreshKey bumps when the submit returns a PR so the embedded
  // PendingPrsCard refetches and shows the new PR without the operator
  // hitting reload.
  const [refreshKey, setRefreshKey] = useState(0);

  // Catalog with curated alternatives populated — drives the live
  // per-row "duplicate" / "cap full" / "parent missing" badges below
  // (Task #53). We deliberately fetch our own copy rather than threading
  // it from ConsolidatedEtfTreePanel: that panel mutates its catalog
  // reference on every per-row attach/remove, and binding to it would
  // make the batch panel re-render constantly during unrelated work.
  // Re-fetched after a successful submit so any newly-merged PR shows
  // up in the next preflight pass.
  const [catalog, setCatalog] = useState<CatalogSummary | null>(null);
  // `unavailable` flips true when the fetch errors. We keep the panel
  // usable in that case (server still runs the authoritative preflight
  // on Preview/Submit) but swap the per-row "Checking catalog…" label
  // for an honest "Catalog unavailable" state so the operator doesn't
  // wait forever on a spinner that will never resolve.
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

  // Send only non-empty rows. An all-empty row is the operator's
  // "scratch" slot — silently dropping it lets them keep a blank
  // row at the bottom for typing without polluting the request.
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
          de: `Batch-PR geöffnet: #${r.prNumber}`,
          en: `Batch PR opened: #${r.prNumber}`,
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

  // Live per-row diagnostics (Task #53). Recomputed on every keystroke
  // so the operator gets instant feedback once parentKey + ISIN are
  // both entered. `problemCount` drives the Preview / Submit gating
  // below — we refuse to round-trip rows the catalog can already reject.
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
            de: "Mehrere Alternativen in EINEM PR. Dedup, Cap (≤2 pro Bucket) und Parent-Existenz werden über die ganze Liste geprüft. Look-through-Daten werden für jede neue Alternative best-effort gescraped und in einem zweiten PR gebündelt.",
            en: "Queue N alternatives into ONE etfs.ts PR. Dedup, per-bucket cap (≤2) and parent existence are checked across the whole list. Look-through data is best-effort scraped per row and bundled into one companion PR.",
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
                      // Live per-row badge driven by the in-memory
                      // catalog. We render the same colour palette
                      // batchRowBadgeClass uses for the post-Preview
                      // table so the operator sees a consistent
                      // signal before AND after the round-trip.
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
            // Surface why the buttons are disabled so the operator
            // doesn't sit there clicking a greyed-out Preview. The
            // per-row badges already explain WHICH rows are broken;
            // this is the panel-level summary.
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
                de: "Noch keine offenen Batch-PRs.",
                en: "No open batch PRs.",
              })}
            </span>
          }
        />
      </CardContent>
    </Card>
  );
}

// Per-row outcome badge — colour matches the operator's mental model:
// emerald for added, slate for benign skips (already-present), amber
// for input/preflight problems, red for hard failures.
function batchRowBadgeClass(status: BulkAltRowStatus): string {
  switch (status) {
    case "ok":
      return "border-emerald-600 text-emerald-700 dark:text-emerald-400";
    case "duplicate_isin":
    case "cap_exceeded":
      return "border-slate-500 text-slate-700 dark:text-slate-400";
    case "scrape_failed":
    case "parent_missing":
      return "border-red-600 text-red-700 dark:text-red-400";
    default:
      return "border-amber-600 text-amber-700 dark:text-amber-400";
  }
}

function batchRowLabel(
  status: BulkAltRowStatus,
  lang: "de" | "en",
): string {
  const map: Record<BulkAltRowStatus, { de: string; en: string }> = {
    ok: { de: "Wird hinzugefügt", en: "Will add" },
    invalid_input: { de: "Eingabe ungültig", en: "Invalid input" },
    invalid_parent_key: {
      de: "parentKey ungültig",
      en: "Invalid parentKey",
    },
    invalid_isin: { de: "ISIN ungültig", en: "Invalid ISIN" },
    invalid_exchange: {
      de: "Börse ungültig",
      en: "Invalid exchange",
    },
    invalid_entry: {
      de: "Eintrag-Validierung fehlgeschlagen",
      en: "Entry validation failed",
    },
    parent_missing: { de: "Bucket fehlt", en: "Bucket missing" },
    duplicate_isin: { de: "ISIN bereits vorhanden", en: "ISIN already used" },
    cap_exceeded: { de: "Bucket-Limit erreicht", en: "Bucket cap reached" },
    scrape_failed: { de: "Scrape fehlgeschlagen", en: "Scrape failed" },
  };
  return map[status][lang];
}

function lookthroughStatusLabel(
  status: BulkAltLookthroughStatus | undefined,
  plan: BulkAltRowOutcome["lookthroughPlan"] | undefined,
  lang: "de" | "en",
): string {
  if (status === "pr_added")
    return lang === "de" ? "Look-through PR" : "Look-through PR";
  if (status === "already_present")
    return lang === "de" ? "Bereits vorhanden" : "Already present";
  if (status === "incomplete")
    return lang === "de" ? "Unvollständig" : "Incomplete";
  if (status === "scrape_failed")
    return lang === "de" ? "Scrape fehler" : "Scrape failed";
  if (status === "would_add")
    return lang === "de" ? "Wird ergänzt" : "Will add";
  if (plan === "would_scrape")
    return lang === "de" ? "Wird gescraped" : "Will scrape";
  if (plan === "already_present")
    return lang === "de" ? "Bereits vorhanden" : "Already present";
  return "—";
}

// Render a server-supplied unified-diff string with +/- line colouring.
// We deliberately render verbatim (one <span> per line) instead of pulling
// in a syntax-highlighting lib — the PR view on GitHub is the canonical
// source; this is just a sanity-check before the operator commits.
function UnifiedDiffView({
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

function BatchPreviewDisplay({
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

function BatchSubmitDisplay({
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
            etfs.ts PR #{result.prNumber}
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
            look-through PR #{result.lookthroughPrNumber}
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
              de: "Look-through PR fehlgeschlagen",
              en: "Look-through PR failed",
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

function BatchOutcomeTable({
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
