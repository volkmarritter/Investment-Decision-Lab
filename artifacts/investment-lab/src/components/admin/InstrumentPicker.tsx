// ----------------------------------------------------------------------------
// InstrumentPicker — searchable dropdown over the INSTRUMENTS registry.
// ----------------------------------------------------------------------------
// Used by the bucket tree-row to attach an existing instrument either as
// the bucket's `default` or as one of its alternatives. Strict global
// uniqueness lives on the server; this picker just helps the operator
// avoid obvious mistakes by:
//
//   - filtering OUT instruments already in use somewhere (mode="alternative")
//   - filtering OUT instruments already in use somewhere (mode="default";
//     same rule because a default counts as a usage)
//
// The picker NEVER opens a PR by itself — the parent calls the relevant
// `adminApi.attachAlternativeIsin` / `setBucketDefaultIsin` and feeds the
// result back via `onSubmitted`.
// ----------------------------------------------------------------------------

import { useEffect, useMemo, useState } from "react";
import { adminApi, type InstrumentRow } from "@/lib/admin-api";
import { useAdminT } from "@/lib/admin-i18n";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";

export type InstrumentPickerMode = "default" | "alternative";

export function InstrumentPicker({
  parentKey,
  mode,
  onSubmitted,
  onCancel,
}: {
  parentKey: string;
  mode: InstrumentPickerMode;
  onSubmitted: () => void;
  onCancel?: () => void;
}) {
  const { t, lang } = useAdminT();
  const [instruments, setInstruments] = useState<InstrumentRow[] | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [query, setQuery] = useState("");
  const [pickedIsin, setPickedIsin] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitErr, setSubmitErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setInstruments(null);
    setLoadErr(null);
    adminApi.instruments().then(
      (r) => !cancelled && setInstruments(r.instruments),
      (e: unknown) =>
        !cancelled && setLoadErr(e instanceof Error ? e.message : String(e)),
    );
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  // Both modes show ONLY unassigned instruments. The server enforces
  // strict global uniqueness, so trying to pick an in-use ISIN would
  // 409 anyway — better to filter it out client-side than to surface a
  // confusing error.
  const candidates = useMemo(() => {
    if (!instruments) return [];
    const q = query.trim().toUpperCase();
    return instruments
      .filter((i) => i.usage.length === 0)
      .filter((i) => {
        if (!q) return true;
        return (
          i.isin.toUpperCase().includes(q) ||
          i.name.toUpperCase().includes(q) ||
          i.currency.toUpperCase().includes(q) ||
          i.domicile.toUpperCase().includes(q)
        );
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [instruments, query]);

  async function handleSubmit() {
    if (!pickedIsin) return;
    setSubmitting(true);
    setSubmitErr(null);
    try {
      const r =
        mode === "default"
          ? await adminApi.setBucketDefaultIsin(parentKey, pickedIsin)
          : await adminApi.attachAlternativeIsin(parentKey, pickedIsin);
      toast.success(
        lang === "de"
          ? `Pull Request #${r.prNumber} geöffnet`
          : `Pull Request #${r.prNumber} opened`,
        {
          action: {
            label: t({ de: "Öffnen", en: "Open" }),
            onClick: () => window.open(r.prUrl, "_blank"),
          },
        },
      );
      onSubmitted();
    } catch (e: unknown) {
      setSubmitErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="rounded-md border bg-background p-3 space-y-2"
      data-testid={`instrument-picker-${parentKey}-${mode}`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs font-medium">
          {mode === "default"
            ? t({
                de: "Default-ISIN aus Registry wählen",
                en: "Pick default ISIN from registry",
              })
            : t({
                de: "Alternative aus Registry wählen",
                en: "Pick alternative from registry",
              })}
        </div>
        <button
          type="button"
          className="text-xs text-primary hover:underline"
          onClick={() => setReloadKey((k) => k + 1)}
          data-testid={`button-instrument-picker-reload-${parentKey}`}
        >
          {t({ de: "Neu laden", en: "Reload" })}
        </button>
      </div>
      {loadErr && (
        <Alert variant="destructive">
          <AlertTitle className="text-xs">
            {t({
              de: "Instrument-Liste konnte nicht geladen werden",
              en: "Could not load instrument list",
            })}
          </AlertTitle>
          <AlertDescription className="text-xs">{loadErr}</AlertDescription>
        </Alert>
      )}
      <div className="text-xs text-muted-foreground">
        {lang === "de"
          ? "Es werden nur Instrumente angezeigt, die aktuell keinem Bucket zugeordnet sind. Neue Instrumente legst du im Tab „Instrumente“ an."
          : "Only instruments currently unassigned to any bucket are shown. Register new instruments in the “Instruments” tab first."}
      </div>
      <Input
        placeholder={t({
          de: "Suchen nach Name, ISIN, Währung …",
          en: "Search by name, ISIN, currency …",
        })}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        data-testid={`input-instrument-picker-search-${parentKey}`}
      />
      {!instruments && !loadErr && (
        <p className="text-xs text-muted-foreground">
          {t({ de: "Lade …", en: "Loading …" })}
        </p>
      )}
      {instruments && candidates.length === 0 && (
        <p className="text-xs text-muted-foreground italic">
          {query.trim()
            ? t({
                de: "Kein Treffer mit diesem Suchbegriff.",
                en: "No match for this search term.",
              })
            : t({
                de: "Keine ungebundenen Instrumente verfügbar — lege zuerst eines im Tab „Instrumente“ an.",
                en: "No unassigned instruments available — register one first in the “Instruments” tab.",
              })}
        </p>
      )}
      {candidates.length > 0 && (
        <div className="max-h-64 overflow-y-auto rounded border divide-y">
          {candidates.map((inst) => {
            const isPicked = pickedIsin === inst.isin;
            return (
              <button
                key={inst.isin}
                type="button"
                onClick={() => setPickedIsin(isPicked ? null : inst.isin)}
                className={`flex w-full items-start gap-2 px-2 py-1.5 text-left hover:bg-muted/40 ${
                  isPicked ? "bg-primary/10" : ""
                }`}
                data-testid={`instrument-picker-row-${inst.isin}`}
              >
                <input
                  type="radio"
                  checked={isPicked}
                  readOnly
                  className="mt-1"
                  aria-label={`select ${inst.isin}`}
                />
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-medium truncate">
                    {inst.name}
                  </div>
                  <div className="text-[11px] text-muted-foreground font-mono">
                    {inst.isin} · {inst.currency} · {inst.domicile} ·{" "}
                    {(inst.terBps / 100).toFixed(2)}% TER
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}
      {submitErr && (
        <Alert variant="destructive">
          <AlertTitle className="text-xs">
            {t({
              de: "Pull Request konnte nicht geöffnet werden",
              en: "Could not open Pull Request",
            })}
          </AlertTitle>
          <AlertDescription className="text-xs">{submitErr}</AlertDescription>
        </Alert>
      )}
      <div className="flex items-center justify-end gap-2 pt-1">
        {onCancel && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onCancel}
            disabled={submitting}
            data-testid={`button-instrument-picker-cancel-${parentKey}`}
          >
            {t({ de: "Abbrechen", en: "Cancel" })}
          </Button>
        )}
        <Button
          type="button"
          size="sm"
          onClick={() => void handleSubmit()}
          disabled={!pickedIsin || submitting}
          data-testid={`button-instrument-picker-submit-${parentKey}-${mode}`}
        >
          {submitting && <RefreshCw className="h-3 w-3 animate-spin mr-1" />}
          {mode === "default"
            ? t({
                de: "Als Default vorschlagen",
                en: "Propose as default",
              })
            : t({
                de: "Als Alternative vorschlagen",
                en: "Propose as alternative",
              })}
        </Button>
      </div>
    </div>
  );
}
