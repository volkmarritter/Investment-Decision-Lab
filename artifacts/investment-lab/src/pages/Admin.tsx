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
  applyPresetToFields,
  findPresetById,
} from "@/lib/appDefaultsPresets";
import { BUILT_IN_RF, BUILT_IN_HB } from "@/lib/settings";
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
                Investment Decision Lab — Operator-Bereich
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
              <LogOut className="h-4 w-4 mr-1" /> Abmelden
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
        <LookthroughPoolPanel catalog={catalog} />
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
          <CardTitle>Admin-Anmeldung</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Bitte das Admin-Token eingeben (auf dem api-server als{" "}
            <code>ADMIN_TOKEN</code> hinterlegt). Das Token wird nur für
            diesen Browser-Tab gespeichert.
          </p>
          <Input
            type="password"
            placeholder="Admin-Token"
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
            Anmelden
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
            Bestehende Buckets durchsuchen
            {total > 0 && (
              <span className="text-xs font-normal text-muted-foreground">
                {total} Bucket{total === 1 ? "" : "s"} in {groups.length}{" "}
                Asset-Klasse{groups.length === 1 ? "" : "n"}
              </span>
            )}
          </CardTitle>
          <span className="text-xs text-muted-foreground">
            {open ? "Verbergen" : "Anzeigen"}
          </span>
        </button>
      </CardHeader>
      {open && (
        <CardContent className="pt-0">
          {catalogError && (
            <Alert variant="destructive" className="mb-4">
              <AlertTitle>Katalog konnte nicht geladen werden</AlertTitle>
              <AlertDescription>{catalogError}</AlertDescription>
            </Alert>
          )}
          {!catalog && !catalogError && (
            <p className="text-sm text-muted-foreground">Lade …</p>
          )}
          {catalog && groups.length > 0 && (
            <>
              <div className="flex items-center justify-between mb-3 gap-3">
                <p className="text-xs text-muted-foreground">
                  Namens­konvention:{" "}
                  <code>&lt;AssetClass&gt;-&lt;Region oder Thema&gt;[-&lt;Hedge oder Variante&gt;]</code>
                  . Auf einen Key klicken, um ihn ins Katalog-Key-Feld unten
                  zu kopieren.
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
  toast.success(`${key} kopiert`);
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
      toast.success("Pull-Request geöffnet", {
        description: r.prUrl,
        action: { label: "Öffnen", onClick: () => window.open(r.prUrl, "_blank") },
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
        <CardTitle>ISIN vorschlagen</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex gap-2">
          <Input
            placeholder="z. B. IE00B5BMR087"
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
              "Vorschau"
            )}
          </Button>
        </div>
        {errMsg && (
          <Alert variant="destructive">
            <AlertTitle>Fehler</AlertTitle>
            <AlertDescription>{errMsg}</AlertDescription>
          </Alert>
        )}
        {catalogError && (
          <Alert variant="destructive">
            <AlertTitle>Katalog konnte nicht geladen werden</AlertTitle>
            <AlertDescription>
              {catalogError} — der Replace-vs-Add-Vergleich ist nicht
              verfügbar, bis dies behoben ist.
            </AlertDescription>
          </Alert>
        )}
        {!githubConfigured && draft && (
          <Alert>
            <AlertTitle>GitHub nicht konfiguriert</AlertTitle>
            <AlertDescription>
              Setze <code>GITHUB_PAT</code>, <code>GITHUB_OWNER</code> und{" "}
              <code>GITHUB_REPO</code> auf dem api-server, um PRs erzeugen
              zu können.
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
          <div className="font-medium">{draft.name || "(kein Name erkannt)"}</div>
          <div className="text-xs text-muted-foreground">{draft.isin}</div>
        </div>
        <div className="flex gap-2">
          <Badge variant={preview.policyFit.aumOk ? "default" : "destructive"}>
            AUM {preview.policyFit.aumOk ? "OK" : "ungenügend"}
          </Badge>
          <Badge variant={preview.policyFit.terOk ? "default" : "destructive"}>
            TER {preview.policyFit.terOk ? "OK" : "ungenügend"}
          </Badge>
        </div>
      </div>

      <a
        href={preview.sourceUrl}
        target="_blank"
        rel="noreferrer"
        className="text-xs text-primary underline"
      >
        Auf justETF ansehen →
      </a>

      <Separator />

      <div className="grid grid-cols-2 gap-3">
        <Field label="Katalog-Key">
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
            Existierenden Key wählen, um einen Bucket zu{" "}
            <strong>ersetzen</strong>, oder einen neuen tippen (z. B.{" "}
            <code>Equity-AI</code>), um einen neuen Bucket{" "}
            <strong>hinzuzufügen</strong>.
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
        <Field label="AUM (Mio. EUR)">
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
        <Field label="Domizil">
          <Input
            value={draft.domicile}
            onChange={(e) => set("domicile", e.target.value)}
          />
        </Field>
        <Field label="Währung">
          <Input
            value={draft.currency}
            onChange={(e) => set("currency", e.target.value.toUpperCase())}
          />
        </Field>
        <Field label="Replikation">
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
        <Field label="Ausschüttung">
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
        <Field label="Auflagedatum">
          <Input
            placeholder="JJJJ-MM-TT"
            value={draft.inceptionDate ?? ""}
            onChange={(e) =>
              set("inceptionDate", e.target.value || undefined)
            }
          />
        </Field>
        <Field label="Standard-Börse">
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

      <Field label="Kommentar (wird in Tooltips angezeigt)">
        <Textarea
          rows={2}
          value={draft.comment}
          onChange={(e) => set("comment", e.target.value)}
        />
      </Field>

      <div>
        <Label className="text-xs">Listings (Ticker je Börse)</Label>
        <div className="grid grid-cols-2 gap-2 mt-1">
          {EXCHANGES.map((ex) => (
            <div key={ex} className="flex items-center gap-2">
              <span className="text-xs w-16">{ex}</span>
              <Input
                placeholder="(keine)"
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
          ? "PR wird geöffnet …"
          : blockedByDuplicate
            ? "ISIN-Konflikt oben beheben, um fortzufahren"
            : classification?.state === "REPLACE"
              ? "PR öffnen: bestehenden Eintrag ersetzen"
              : "PR öffnen: zum Katalog hinzufügen"}
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
        Katalog wird geladen …
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
          <Badge variant="destructive">Doppelte ISIN</Badge>
          <span className="text-sm">
            Diese ISIN wird bereits von{" "}
            <code className="font-mono text-xs">
              {classification.conflictKey}
            </code>{" "}
            verwendet.
          </span>
        </div>
        <p className="text-xs text-muted-foreground">
          Bestehender Eintrag: <strong>{classification.conflict.name}</strong>{" "}
          ({classification.conflict.isin}). Vor dem PR die ISIN ändern — oder
          den Katalog-Key auf <code>{classification.conflictKey}</code>{" "}
          setzen, um den bestehenden Eintrag zu ersetzen.
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
            Neuer Bucket
          </Badge>
          <span className="text-sm">
            <code className="font-mono text-xs">{draft.key || "(kein Key)"}</code>{" "}
            existiert noch nicht — dieser PR legt einen neuen Eintrag an.
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
          Ersetzt bestehenden Eintrag
        </Badge>
        <span className="text-sm">
          <code className="font-mono text-xs">{draft.key}</code> existiert
          bereits im Katalog. Diff bitte vor dem Öffnen des PRs prüfen.
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
            <th className="py-1 pr-2 font-medium w-32">Feld</th>
            <th className="py-1 pr-2 font-medium">Aktuell (im Katalog)</th>
            <th className="py-1 pr-2 font-medium">Vorgeschlagen (dieser PR)</th>
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
        Hinweis: <code>aumMillionsEUR</code> und <code>inceptionDate</code>{" "}
        liegen in der Override-Schicht (nächtlicher Refresh), nicht im
        statischen Katalog — die Spalte „Aktuell" zeigt „—", wenn nicht
        manuell gepflegt.
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
        {open ? "Generierten Code verbergen" : "Generierten Code anzeigen"}
      </button>
      {open && (
        <div className="mt-2" data-testid="generated-code-block">
          {loading && !code && (
            <p className="text-xs text-muted-foreground">Wird gerendert …</p>
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
// Pool-Status-Heuristik: Eintrag gilt als "ok", wenn alle drei Quellen
// (Top-Holdings, Geo-Breakdown, Sektoren) gefüllt sind UND der letzte
// Scrape jünger als 60 Tage ist. Älter → "stale". Mindestens eine Quelle
// leer → "missing". Damit der Operator auf einen Blick sieht, welche
// Pool-Einträge nachgepflegt werden müssen.
type PoolStatus = {
  tone: "ok" | "stale" | "missing";
  label: string;
};
function computePoolStatus(e: LookthroughPoolEntry): PoolStatus {
  const hasAll = e.topHoldingCount > 0 && e.geoCount > 0 && e.sectorCount > 0;
  if (!hasAll) return { tone: "missing", label: "Daten fehlen" };
  // OK setzt voraus, dass es einen *gültigen* Zeitstempel ≤ 60 Tage gibt.
  // Ein fehlender oder unparsbarer asOf-Wert wird absichtlich als "Veraltet"
  // klassifiziert — wir können die Frische sonst nicht garantieren.
  const asOf = e.topHoldingsAsOf || e.breakdownsAsOf;
  if (!asOf) return { tone: "stale", label: "Veraltet" };
  const ts = Date.parse(asOf);
  if (Number.isNaN(ts)) return { tone: "stale", label: "Veraltet" };
  const ageDays = (Date.now() - ts) / (1000 * 60 * 60 * 24);
  if (ageDays > 60) return { tone: "stale", label: "Veraltet" };
  return { tone: "ok", label: "Daten OK" };
}

function LookthroughPoolPanel({ catalog }: { catalog: CatalogSummary | null }) {
  const [isin, setIsin] = useState("");
  const [entries, setEntries] = useState<LookthroughPoolEntry[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errMsg, setErrMsg] = useState<string | null>(null);

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
            <>
              <p className="text-xs text-muted-foreground mb-1">
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
                = mindestens eine Quelle leer. Quelle: <em>Kuratiert</em> =
                manuell im Repo gepflegt; <em>Auto-Refresh</em> = vom
                monatlichen Scrape-Job geschrieben.
              </p>
              <div className="overflow-auto max-h-96 border rounded">
                <table className="text-xs w-full">
                  <thead className="bg-muted/40 sticky top-0">
                    <tr className="text-left">
                      <th className="px-2 py-1 font-medium">Status</th>
                      <th className="px-2 py-1 font-medium">Quelle</th>
                      <th className="px-2 py-1 font-medium">ISIN</th>
                      <th className="px-2 py-1 font-medium">Name (Katalog)</th>
                      <th className="px-2 py-1 font-medium">Positionen</th>
                      <th className="px-2 py-1 font-medium">Länder</th>
                      <th className="px-2 py-1 font-medium">Sektoren</th>
                      <th className="px-2 py-1 font-medium">Letzter Scrape</th>
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
                              {status.label}
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
                                ? "Auto-Refresh"
                                : e.source === "both"
                                  ? "Beide"
                                  : "Kuratiert"}
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
                            ) : (
                              <span className="text-muted-foreground italic">
                                — nicht im Katalog
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
          Aktualisieren
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
        <CardTitle className="text-base">Datenaktualität</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        {!fresh && <p className="text-muted-foreground">Lade …</p>}
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
          Aktuelle Datenänderungen ({changes.length})
        </CardTitle>
      </CardHeader>
      <CardContent>
        {grouped.length === 0 && (
          <p className="text-sm text-muted-foreground">
            Noch keine Änderungen. Der nächste geplante Scrape füllt diese
            Liste, sobald er Feld-Unterschiede erkennt.
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
        <CardTitle className="text-base">Letzte Läufe ({runs.length})</CardTitle>
      </CardHeader>
      <CardContent>
        {runs.length === 0 && (
          <p className="text-sm text-muted-foreground">
            Noch keine Läufe protokolliert.
          </p>
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
  const [presetId, setPresetId] = useState<string>("");

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
      toast.error("Bitte zuerst eine Vorlage auswaehlen.");
      return;
    }
    const next = applyPresetToFields(preset, { rf, hb, cma });
    setRf(next.rf);
    setHb(next.hb);
    setCma(next.cma);
    toast.success(`Vorlage angewendet: ${preset.label}. Bitte vor dem PR pruefen.`);
  }

  async function onRevert() {
    setPresetId("");
    const ok = await loadFromServer();
    if (ok) {
      toast.success("Editor auf aktuell ausgelieferte Werte zurueckgesetzt.");
    } else {
      toast.error("Konnte aktuelle Werte nicht laden — siehe Fehlermeldung im Panel.");
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
        invalidFields.push(`Risikoloser Zins ${k}`);
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
        invalidFields.push(`Home-Bias ${k}`);
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
      if (mu === "invalid") invalidFields.push(`CMA ${c.label} → Erw. Rendite`);
      if (sg === "invalid") invalidFields.push(`CMA ${c.label} → Volatilität`);
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
      toast.error("Kurze Beschreibung erforderlich (für PR-Titel).");
      return;
    }
    const { value, touched, invalidFields } = buildPayload();
    if (invalidFields.length > 0) {
      // Mindestens ein Feld enthält Text, der nicht als Zahl interpretiert
      // werden konnte. Dem Operator EXPLIZIT melden statt stillschweigend
      // ignorieren — sonst öffnet sich ein leerer PR ohne Hinweis.
      toast.error(
        `Ungültige Eingabe in ${invalidFields.length} Feld${invalidFields.length === 1 ? "" : "ern"}: ` +
          invalidFields.slice(0, 5).join(", ") +
          (invalidFields.length > 5 ? ` (+${invalidFields.length - 5} weitere)` : "") +
          ". Erlaubt: Zahl mit optionalem Vorzeichen und einem Dezimaltrennzeichen (z.B. 7,5 oder 7.5 oder -2,3).",
      );
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
        "Kein Feld hat einen Wert. Wenn du jetzt fortsetzt, wird ein PR erzeugt, der ALLE globalen Defaults entfernt und auf die eingebauten Built-in-Werte zurücksetzt. Wirklich fortfahren?",
      );
      if (!ok) return;
    }
    setSubmitting(true);
    try {
      const res = await adminApi.proposeAppDefaultsPr(value, trimmed);
      setLastPr({ url: res.prUrl, number: res.prNumber });
      toast.success(
        touched === 0
          ? `PR #${res.prNumber} geöffnet (alle Overrides entfernt).`
          : `PR #${res.prNumber} geöffnet (${touched} Feld${touched === 1 ? "" : "er"} übermittelt).`,
      );
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
          <span>Globale Defaults (Risikoloser Zins / Home-Bias / Kapitalmarkt­annahmen)</span>
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
              <Label htmlFor="app-defaults-preset">Vorlage anwenden (optional)</Label>
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
                      <SelectValue placeholder="— keine Vorlage —" />
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
                    Vorlage anwenden
                  </Button>
                  <Button
                    variant="outline"
                    onClick={onRevert}
                    disabled={loading}
                    data-testid="button-revert-defaults"
                  >
                    Aktuelle Werte neu laden
                  </Button>
                </div>
              </div>
              {presetId && (
                <p className="text-xs text-muted-foreground">
                  {findPresetById(presetId)?.description}
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                Vorlagen erst auswählen, dann mit "Vorlage anwenden" in den
                Editor laden. Sektionen, die die Vorlage nicht berührt,
                bleiben unverändert; "Aktuelle Werte neu laden" verwirft
                manuelle Änderungen und holt den Stand vom Server.
              </p>
            </section>

            <Separator />

            <section className="space-y-2">
              <h3 className="text-sm font-semibold">Risikofreie Zinssätze (in %)</h3>
              <p className="text-xs text-muted-foreground">
                Leeres Feld = Built-in-Default greift.
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
                      Built-in: {(BUILT_IN_RF[k] * 100).toFixed(3)} %
                    </p>
                  </div>
                ))}
              </div>
            </section>

            <Separator />

            <section className="space-y-2">
              <h3 className="text-sm font-semibold">
                Home-Bias-Multiplikator (0–5)
              </h3>
              <p className="text-xs text-muted-foreground">
                Leeres Feld = Built-in-Default greift.
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
                      Built-in: {BUILT_IN_HB[k].toFixed(1)}×
                    </p>
                  </div>
                ))}
              </div>
            </section>

            <Separator />

            <section className="space-y-2">
              <h3 className="text-sm font-semibold">
                CMA — erwartete Rendite & Volatilität (in %)
              </h3>
              <p className="text-xs text-muted-foreground">
                Leere Felder erben den Built-in-Default (Spalte „Built-in").
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left">
                      <th className="pb-2 pr-3 font-medium">Anlageklasse</th>
                      <th className="pb-2 pr-3 font-medium">Built-in μ / σ</th>
                      <th className="pb-2 pr-3 font-medium">Erw. Rendite %</th>
                      <th className="pb-2 font-medium">Volatilität %</th>
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
