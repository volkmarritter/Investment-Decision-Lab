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

import { useEffect, useMemo, useState } from "react";
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
  type ChangeEntry,
  type FreshnessResponse,
  type LookthroughPoolEntry,
  type PreviewResponse,
  type RunLogRow,
} from "@/lib/admin-api";
import { classifyDraft, type ClassifyResult } from "@/lib/catalog-classify";
import {
  APP_DEFAULTS_PRESETS,
  findPresetById,
  type AppDefaultsPreset,
} from "@/lib/appDefaultsPresets";
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
import { ChevronDown, ChevronRight, Layers, LogOut, RefreshCw } from "lucide-react";
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
  const [token, setLocalToken] = useState<string | null>(getToken());
  const [authError, setAuthError] = useState<string | null>(null);
  const [githubConfigured, setGithubConfigured] = useState(false);
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
      .then((r) => setGithubConfigured(r.githubConfigured))
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
                Admin
              </h1>
              <p className="text-xs text-muted-foreground">
                Investment Decision Lab — operator pane
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <ThemeToggle />
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                clearToken();
                setLocalToken(null);
              }}
            >
              <LogOut className="h-4 w-4 mr-1" /> Sign out
            </Button>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8 space-y-6">
        <BrowseBucketsPanel catalog={catalog} catalogError={catalogError} />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <SuggestIsinPanel
            githubConfigured={githubConfigured}
            catalog={catalog}
            catalogError={catalogError}
          />
          <DataUpdatesColumn />
        </div>
        <LookthroughPoolPanel />
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
  const [value, setValue] = useState("");
  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Admin sign-in</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Enter the admin token (set as <code>ADMIN_TOKEN</code> on the
            api-server). The token is stored only for this browser tab.
          </p>
          <Input
            type="password"
            placeholder="Admin token"
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
            Sign in
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
            Browse existing buckets
            {total > 0 && (
              <span className="text-xs font-normal text-muted-foreground">
                {total} bucket{total === 1 ? "" : "s"} across{" "}
                {groups.length} asset class
                {groups.length === 1 ? "" : "es"}
              </span>
            )}
          </CardTitle>
          <span className="text-xs text-muted-foreground">
            {open ? "Hide" : "Show"}
          </span>
        </button>
      </CardHeader>
      {open && (
        <CardContent className="pt-0">
          {catalogError && (
            <Alert variant="destructive" className="mb-4">
              <AlertTitle>Could not load catalog</AlertTitle>
              <AlertDescription>{catalogError}</AlertDescription>
            </Alert>
          )}
          {!catalog && !catalogError && (
            <p className="text-sm text-muted-foreground">Loading…</p>
          )}
          {catalog && groups.length > 0 && (
            <>
              <div className="flex items-center justify-between mb-3 gap-3">
                <p className="text-xs text-muted-foreground">
                  Naming convention:{" "}
                  <code>&lt;AssetClass&gt;-&lt;Region or Theme&gt;[-&lt;Currency hedge or Variant&gt;]</code>
                  . Click a key to copy it into the catalog-key field below.
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
  toast.success(`Copied ${key}`);
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
  const [isin, setIsin] = useState("");
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [draft, setDraft] = useState<AddEtfRequest | null>(null);
  const [errMsg, setErrMsg] = useState<string | null>(null);

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
      toast.success("Pull request opened", {
        description: r.prUrl,
        action: { label: "Open", onClick: () => window.open(r.prUrl, "_blank") },
      });
      setIsin("");
      setPreview(null);
      setDraft(null);
    } catch (e: unknown) {
      setErrMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Suggest an ISIN</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex gap-2">
          <Input
            placeholder="e.g. IE00B5BMR087"
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
              "Preview"
            )}
          </Button>
        </div>
        {errMsg && (
          <Alert variant="destructive">
            <AlertTitle>Error</AlertTitle>
            <AlertDescription>{errMsg}</AlertDescription>
          </Alert>
        )}
        {catalogError && (
          <Alert variant="destructive">
            <AlertTitle>Could not load catalog</AlertTitle>
            <AlertDescription>
              {catalogError} — replace-vs-add diff is unavailable until this
              clears.
            </AlertDescription>
          </Alert>
        )}
        {!githubConfigured && draft && (
          <Alert>
            <AlertTitle>GitHub not configured</AlertTitle>
            <AlertDescription>
              Set <code>GITHUB_PAT</code>, <code>GITHUB_OWNER</code>,{" "}
              <code>GITHUB_REPO</code> on the api-server to enable PR
              creation.
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
          <div className="font-medium">{draft.name || "(no name detected)"}</div>
          <div className="text-xs text-muted-foreground">{draft.isin}</div>
        </div>
        <div className="flex gap-2">
          <Badge variant={preview.policyFit.aumOk ? "default" : "destructive"}>
            AUM {preview.policyFit.aumOk ? "OK" : "fail"}
          </Badge>
          <Badge variant={preview.policyFit.terOk ? "default" : "destructive"}>
            TER {preview.policyFit.terOk ? "OK" : "fail"}
          </Badge>
        </div>
      </div>

      <a
        href={preview.sourceUrl}
        target="_blank"
        rel="noreferrer"
        className="text-xs text-primary underline"
      >
        View on justETF →
      </a>

      <Separator />

      <div className="grid grid-cols-2 gap-3">
        <Field label="Catalog key">
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
            Pick an existing key to <strong>replace</strong> a bucket, or
            type a new one (e.g. <code>Equity-AI</code>) to{" "}
            <strong>add</strong> a new bucket.
          </p>
        </Field>
        <Field label="Name">
          <Input
            value={draft.name}
            onChange={(e) => set("name", e.target.value)}
          />
        </Field>
        <Field label="TER (bps)">
          <Input
            type="number"
            value={draft.terBps}
            onChange={(e) => set("terBps", Number(e.target.value))}
          />
        </Field>
        <Field label="AUM (M EUR)">
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
        <Field label="Domicile">
          <Input
            value={draft.domicile}
            onChange={(e) => set("domicile", e.target.value)}
          />
        </Field>
        <Field label="Currency">
          <Input
            value={draft.currency}
            onChange={(e) => set("currency", e.target.value.toUpperCase())}
          />
        </Field>
        <Field label="Replication">
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
        <Field label="Distribution">
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
        <Field label="Inception date">
          <Input
            placeholder="YYYY-MM-DD"
            value={draft.inceptionDate ?? ""}
            onChange={(e) =>
              set("inceptionDate", e.target.value || undefined)
            }
          />
        </Field>
        <Field label="Default exchange">
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

      <Field label="Comment (shown in tooltips)">
        <Textarea
          rows={2}
          value={draft.comment}
          onChange={(e) => set("comment", e.target.value)}
        />
      </Field>

      <div>
        <Label className="text-xs">Listings (ticker per exchange)</Label>
        <div className="grid grid-cols-2 gap-2 mt-1">
          {EXCHANGES.map((ex) => (
            <div key={ex} className="flex items-center gap-2">
              <span className="text-xs w-16">{ex}</span>
              <Input
                placeholder="(none)"
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
          ? "Opening PR…"
          : blockedByDuplicate
            ? "Resolve the ISIN clash above to continue"
            : classification?.state === "REPLACE"
              ? "Open PR to replace the existing entry"
              : "Open PR to add to catalog"}
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
  if (!classification) {
    return (
      <div className="text-xs text-muted-foreground" data-testid="diff-panel-loading">
        Loading catalog…
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
          <Badge variant="destructive">Duplicate ISIN</Badge>
          <span className="text-sm">
            This ISIN is already used by{" "}
            <code className="font-mono text-xs">
              {classification.conflictKey}
            </code>
            .
          </span>
        </div>
        <p className="text-xs text-muted-foreground">
          Existing entry: <strong>{classification.conflict.name}</strong>{" "}
          ({classification.conflict.isin}). Change the ISIN — or change the
          catalog key to <code>{classification.conflictKey}</code> if you
          want to replace it — before opening a PR.
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
            New bucket
          </Badge>
          <span className="text-sm">
            <code className="font-mono text-xs">{draft.key || "(no key)"}</code>{" "}
            doesn't exist yet — this PR will add a new entry.
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
          Replaces existing entry
        </Badge>
        <span className="text-sm">
          <code className="font-mono text-xs">{draft.key}</code> already exists
          in the catalog. Review the diff before opening a PR.
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
  const rows = useMemo(() => buildDiffRows(existing, draft), [existing, draft]);
  return (
    <div className="overflow-x-auto" data-testid="diff-table">
      <table className="text-xs w-full border-collapse">
        <thead>
          <tr className="text-left border-b">
            <th className="py-1 pr-2 font-medium w-32">Field</th>
            <th className="py-1 pr-2 font-medium">Current (in catalog)</th>
            <th className="py-1 pr-2 font-medium">Proposed (this PR)</th>
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
        Note: <code>aumMillionsEUR</code> and <code>inceptionDate</code> live
        in the override layer (refreshed nightly), not the static catalog —
        the "current" column shows "—" if they weren't curated by hand.
      </p>
    </div>
  );
}

// "Show generated code" disclosure — calls the api-server's render-entry
// endpoint so the operator sees the exact TS block GitHub will receive.
// Lazy: we only fire the request when the disclosure is opened, then
// re-fetch (debounced) while it stays open and the draft changes.
function GeneratedCodeDisclosure({ draft }: { draft: AddEtfRequest }) {
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
        {open ? "Hide generated code" : "Show generated code"}
      </button>
      {open && (
        <div className="mt-2" data-testid="generated-code-block">
          {loading && !code && (
            <p className="text-xs text-muted-foreground">Rendering…</p>
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
function LookthroughPoolPanel() {
  const [isin, setIsin] = useState("");
  const [entries, setEntries] = useState<LookthroughPoolEntry[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errMsg, setErrMsg] = useState<string | null>(null);

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
    try {
      const r = await adminApi.addLookthroughPoolIsin(trimmed);
      toast.success(`${r.isin} aufgenommen`, {
        description: `${r.topHoldingCount} Holdings · ${r.geoCount} Länder · ${r.sectorCount} Sektoren — ${r.note}`,
      });
      setIsin("");
      await load();
    } catch (e: unknown) {
      setErrMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Look-through-Datenpool</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          ISINs hier sind <em>bucket-unabhängig</em> für Methodology-Overrides
          verfügbar. Beim Hinzufügen werden Top-Holdings sowie Länder- und
          Sektor-Aufteilung von justETF gescraped; der monatliche Refresh-Job
          aktualisiert die Daten automatisch mit. Ein App-Neustart ist nötig,
          damit das Frontend eine neu aufgenommene ISIN sieht.
        </p>
        <div className="flex gap-2">
          <Input
            placeholder="z. B. IE00B5BMR087"
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
              "Aufnehmen"
            )}
          </Button>
        </div>
        {errMsg && (
          <Alert variant="destructive">
            <AlertTitle>Fehler</AlertTitle>
            <AlertDescription>{errMsg}</AlertDescription>
          </Alert>
        )}
        <div data-testid="lookthrough-pool-list">
          {loading && (
            <p className="text-sm text-muted-foreground">Lade …</p>
          )}
          {!loading && entries && entries.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Noch keine ISINs im Datenpool.
            </p>
          )}
          {!loading && entries && entries.length > 0 && (
            <div className="overflow-auto max-h-80 border rounded">
              <table className="text-xs w-full">
                <thead className="bg-muted/40">
                  <tr className="text-left">
                    <th className="px-2 py-1 font-medium">ISIN</th>
                    <th className="px-2 py-1 font-medium">Holdings</th>
                    <th className="px-2 py-1 font-medium">Länder</th>
                    <th className="px-2 py-1 font-medium">Sektoren</th>
                    <th className="px-2 py-1 font-medium">As-of</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((e) => (
                    <tr key={e.isin} className="border-t">
                      <td className="px-2 py-1 font-mono">{e.isin}</td>
                      <td className="px-2 py-1">{e.topHoldingCount}</td>
                      <td className="px-2 py-1">{e.geoCount}</td>
                      <td className="px-2 py-1">{e.sectorCount}</td>
                      <td className="px-2 py-1 text-muted-foreground">
                        {e.topHoldingsAsOf?.slice(0, 10) ?? "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function DataUpdatesColumn() {
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
          Refresh
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
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Data freshness</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        {!fresh && <p className="text-muted-foreground">Loading…</p>}
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
          Recent data changes ({changes.length})
        </CardTitle>
      </CardHeader>
      <CardContent>
        {grouped.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No changes yet. The next scheduled scrape will populate this list
            when it detects field-level differences.
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

function RecentRunsCard({ runs }: { runs: RunLogRow[] }) {
  const cols = runs[0] ? Object.keys(runs[0]).slice(0, 6) : [];
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Recent runs ({runs.length})</CardTitle>
      </CardHeader>
      <CardContent>
        {runs.length === 0 && (
          <p className="text-sm text-muted-foreground">No runs logged yet.</p>
        )}
        {runs.length > 0 && (
          <div className="overflow-auto max-h-64">
            <table className="text-xs w-full">
              <thead>
                <tr className="text-left">
                  {cols.map((c) => (
                    <th key={c} className="pr-2 py-1 font-medium">
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {runs.map((r, i) => (
                  <tr key={i} className="border-t">
                    {cols.map((c) => (
                      <td key={c} className="pr-2 py-1 align-top">
                        {r[c]}
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

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    adminApi
      .getAppDefaults()
      .then((res) => {
        if (cancelled) return;
        const v = res.value ?? {};
        if (v._meta) setMeta({ lastUpdated: v._meta.lastUpdated ?? null, lastUpdatedBy: v._meta.lastUpdatedBy ?? null });
        if (v.riskFreeRates) {
          setRf((prev) => {
            const next = { ...prev };
            for (const k of RF_KEYS_UI) {
              const n = v.riskFreeRates?.[k];
              if (typeof n === "number") next[k] = (n * 100).toFixed(3);
            }
            return next;
          });
        }
        if (v.homeBias) {
          setHb((prev) => {
            const next = { ...prev };
            for (const k of HB_KEYS_UI) {
              const n = v.homeBias?.[k];
              if (typeof n === "number") next[k] = String(n);
            }
            return next;
          });
        }
        if (v.cma) {
          setCma((prev) => {
            const next = { ...prev };
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
        }
        setLoadError(null);
      })
      .catch((err: Error) => {
        if (cancelled) return;
        setLoadError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function parsePct(s: string): number | undefined {
    const t = s.trim();
    if (!t) return undefined;
    const n = Number(t);
    if (!Number.isFinite(n)) return undefined;
    return n / 100;
  }
  function parseNum(s: string): number | undefined {
    const t = s.trim();
    if (!t) return undefined;
    const n = Number(t);
    return Number.isFinite(n) ? n : undefined;
  }

  function buildPayload(): { value: AppDefaultsPayload; touched: number } {
    const value: AppDefaultsPayload = {};
    let touched = 0;
    const rfOut: Partial<Record<AppDefaultsRfCurrency, number>> = {};
    for (const k of RF_KEYS_UI) {
      const n = parsePct(rf[k]);
      if (n !== undefined) {
        rfOut[k] = n;
        touched++;
      }
    }
    if (Object.keys(rfOut).length > 0) value.riskFreeRates = rfOut;

    const hbOut: Partial<Record<AppDefaultsHbCurrency, number>> = {};
    for (const k of HB_KEYS_UI) {
      const n = parseNum(hb[k]);
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
      if (mu === undefined && sg === undefined) continue;
      const entry: { expReturn?: number; vol?: number } = {};
      if (mu !== undefined) {
        entry.expReturn = mu;
        touched++;
      }
      if (sg !== undefined) {
        entry.vol = sg;
        touched++;
      }
      cmaOut[c.key] = entry;
    }
    if (Object.keys(cmaOut).length > 0) value.cma = cmaOut;

    return { value, touched };
  }

  async function onSubmit() {
    setLastPr(null);
    const trimmed = summary.trim();
    if (!trimmed) {
      toast.error("Kurze Beschreibung erforderlich (für PR-Titel).");
      return;
    }
    const { value } = buildPayload();
    // Empty payload is intentionally allowed: it's how an operator wipes
    // all global overrides and reverts to the pure built-in defaults.
    setSubmitting(true);
    try {
      const res = await adminApi.proposeAppDefaultsPr(value, trimmed);
      setLastPr({ url: res.prUrl, number: res.prNumber });
      toast.success(`PR #${res.prNumber} geöffnet.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card data-testid="card-app-defaults">
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span>Globale Defaults (Risk-Free / Home-Bias / CMA)</span>
          {meta?.lastUpdated && (
            <span className="text-xs font-normal text-muted-foreground">
              zuletzt geändert: {meta.lastUpdated}
              {meta.lastUpdatedBy ? ` (${meta.lastUpdatedBy})` : ""}
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <p className="text-sm text-muted-foreground">
          Werte hier werden über einen GitHub-PR in{" "}
          <code>artifacts/investment-lab/src/data/app-defaults.json</code>{" "}
          geschrieben. Nach Merge + Redeploy gelten sie als Default für alle
          Nutzer. Felder leer lassen = bisheriger Built-in-Default greift.
          Per-User-Overrides aus dem Methodology-Tab (localStorage) bleiben
          unverändert oben drauf wirksam.
        </p>

        {loading && (
          <p className="text-sm text-muted-foreground">Lade aktuelle Werte…</p>
        )}
        {loadError && (
          <Alert variant="destructive">
            <AlertTitle>Fehler beim Laden</AlertTitle>
            <AlertDescription>{loadError}</AlertDescription>
          </Alert>
        )}

        {!loading && !loadError && (
          <>
            <section className="space-y-2">
              <h3 className="text-sm font-semibold">Risk-Free Rates (in %)</h3>
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
                      placeholder=""
                      value={rf[k]}
                      onChange={(e) => setRf({ ...rf, [k]: e.target.value })}
                    />
                  </div>
                ))}
              </div>
            </section>

            <Separator />

            <section className="space-y-2">
              <h3 className="text-sm font-semibold">
                Home-Bias-Multiplikator (0–5)
              </h3>
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
                      placeholder=""
                      value={hb[k]}
                      onChange={(e) => setHb({ ...hb, [k]: e.target.value })}
                    />
                  </div>
                ))}
              </div>
            </section>

            <Separator />

            <section className="space-y-2">
              <h3 className="text-sm font-semibold">
                CMA — erwartete Rendite & Volatilität (in %)
              </h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left">
                      <th className="pb-2 pr-3 font-medium">Asset</th>
                      <th className="pb-2 pr-3 font-medium">Exp. Return %</th>
                      <th className="pb-2 font-medium">Vol %</th>
                    </tr>
                  </thead>
                  <tbody>
                    {CMA_KEYS_UI.map((c) => (
                      <tr key={c.key} className="border-b border-border/50">
                        <td className="py-1.5 pr-3 text-muted-foreground">
                          {c.label}
                        </td>
                        <td className="py-1.5 pr-3">
                          <Input
                            data-testid={`input-cma-${c.key}-mu`}
                            type="number"
                            step="0.1"
                            placeholder=""
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
                            placeholder=""
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
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <Separator />

            <section className="space-y-2">
              <Label htmlFor="app-defaults-summary">
                Kurze Beschreibung der Änderung (für PR-Titel)
              </Label>
              <Input
                id="app-defaults-summary"
                data-testid="input-app-defaults-summary"
                placeholder="z. B. RF nach EZB-Sitzung 04/2026"
                value={summary}
                onChange={(e) => setSummary(e.target.value)}
              />
            </section>

            {!githubConfigured && (
              <Alert>
                <AlertTitle>GitHub nicht konfiguriert</AlertTitle>
                <AlertDescription>
                  Setze <code>GITHUB_PAT</code>, <code>GITHUB_OWNER</code>,{" "}
                  <code>GITHUB_REPO</code> auf dem api-server, um PRs öffnen
                  zu können.
                </AlertDescription>
              </Alert>
            )}

            <div className="flex items-center justify-between gap-3">
              <p className="text-xs text-muted-foreground">
                Hinweis: Werte werden vor dem Commit serverseitig validiert
                (Bereiche wie Methodology). Ungültige Eingaben werden als
                Fehler gemeldet und es entsteht kein PR.
              </p>
              <Button
                data-testid="button-app-defaults-submit"
                onClick={onSubmit}
                disabled={submitting || !githubConfigured}
              >
                {submitting ? "PR wird geöffnet…" : "PR öffnen"}
              </Button>
            </div>

            {lastPr && (
              <Alert>
                <AlertTitle>PR geöffnet</AlertTitle>
                <AlertDescription>
                  <a
                    href={lastPr.url}
                    target="_blank"
                    rel="noreferrer"
                    className="underline text-primary"
                    data-testid="link-app-defaults-pr"
                  >
                    PR #{lastPr.number} auf GitHub öffnen
                  </a>
                </AlertDescription>
              </Alert>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
