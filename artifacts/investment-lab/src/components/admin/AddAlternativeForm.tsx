// AddAlternativeForm — inline form for adding a curated bucket alternative.

import { useEffect, useState, type ReactNode } from "react";
import {
    adminApi,
  type AddBucketAlternativeRequest,
} from "@/lib/admin-api";
import { useAdminT } from "@/lib/admin-i18n";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import {
  DISTRIBUTIONS,
  EXCHANGES,
  Field,
  REPLICATIONS,
    blankAlternativeDraft,
    mergePreviewIntoAlternativeDraft,
  type Distribution,
  type Exchange,
  type Replication,
} from "./shared";

export function AddAlternativeForm({
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
  presetIsin?: string;
  presetName?: string;
  presetInfo?: ReactNode;
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
  const [didAutoFetch, setDidAutoFetch] = useState(false);

  useEffect(() => {
    if (!presetIsin || didAutoFetch) return;
    setDidAutoFetch(true);
    void runAutofill();
  }, [presetIsin, didAutoFetch]);

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
      // Task #122 (T004): one PR carries both files. The toast line
      // explains exactly what's in it so the operator knows whether to
      // expect the look-through data on day 1 or wait for the monthly
      // refresh job.
      const lookthroughLine = r.lookthroughIncluded
        ? t({
            de: "Look-through-Daten sind im selben Pull Request enthalten.",
            en: "Look-through data is bundled in the same Pull Request.",
          })
        : r.lookthroughAlreadyPresent
          ? t({
              de: "Look-through-Daten waren bereits vorhanden — kein Update nötig.",
              en: "Look-through data was already available — no update needed.",
            })
          : r.lookthroughError
            ? t({
                de: `Look-through-Daten werden später per Refresh-Job nachgereicht: ${r.lookthroughError}`,
                en: `Look-through data will be filled in later by the refresh job: ${r.lookthroughError}`,
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
      toast.error(
        t({
          de: "Pull Request konnte nicht geöffnet werden",
          en: "Could not open pull request",
        }),
        { description: msg },
      );
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
                  de: "Speichern (Pull Request öffnen)",
                  en: "Save (open Pull Request)",
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
            ? t({ de: "Pull Request wird geöffnet …", en: "Opening Pull Request …" })
            : t({
                de: "Pull Request öffnen: Alternative hinzufügen",
                en: "Open Pull Request: add alternative",
              })}
        </Button>
      </div>
    </div>
  );
}
