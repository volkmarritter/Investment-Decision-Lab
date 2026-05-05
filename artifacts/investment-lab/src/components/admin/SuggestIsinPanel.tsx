// ----------------------------------------------------------------------------
// SuggestIsinPanel — left-pane "paste an ISIN, preview, edit, open Pull Request".
// ----------------------------------------------------------------------------

import { useState } from "react";
import {
    adminApi,
  type AddEtfRequest,
  type CatalogSummary,
  type PreviewResponse,
} from "@/lib/admin-api";
import { useAdminT } from "@/lib/admin-i18n";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { buildDraftFromPreview } from "./shared";
import { PreviewEditor } from "./PreviewEditor";
import { PendingPrsCard } from "./PendingPrsCard";

export function SuggestIsinPanel({
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
  // Bumped after every successful or failed Pull Request-creating action so the
  // embedded PendingPrsCard refetches and shows the new (or pre-existing,
  // in the 422-"branch already exists" case) Pull Request without manual reload.
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
      // Direct-write mode (2026-05): server returns "" prUrl + 0 prNumber.
      const directWrite = !r.prUrl || r.prNumber === 0;
      toast.success(
        directWrite
          ? t({ de: "Gespeichert", en: "Saved" })
          : t({ de: "Pull-Request geöffnet", en: "Pull request opened" }),
        {
          description: directWrite ? undefined : r.prUrl,
          action: directWrite
            ? undefined
            : {
                label: t({ de: "Öffnen", en: "Open" }),
                onClick: () => window.open(r.prUrl, "_blank"),
              },
        },
      );
      setIsin("");
      setPreview(null);
      setDraft(null);
      setPrsRefreshKey((k) => k + 1);
    } catch (e: unknown) {
      setErrMsg(e instanceof Error ? e.message : String(e));
      // Auch im Fehlerfall (z.B. "branch already exists") aktualisieren —
      // genau dann ist der bereits-existierende Pull Request die Information, die
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
                  <code>GITHUB_REPO</code> auf dem api-server, um Pull Requests erzeugen
                  zu können.
                </>
              ) : (
                <>
                  Set <code>GITHUB_PAT</code>, <code>GITHUB_OWNER</code> and{" "}
                  <code>GITHUB_REPO</code> on the api-server to enable opening
                  Pull Requests.
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
            de: "Keine offenen ETF-Pull-Requests — alle Vorschläge sind gemerged.",
            en: "No open ETF pull requests — all suggestions are merged.",
          })}
        />
      </CardContent>
    </Card>
  );
}
