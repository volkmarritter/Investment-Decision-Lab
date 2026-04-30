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
// The picker NEVER opens a PR by itself in step 1. After the operator
// picks an instrument, a step-2 REPLACE-style confirmation panel renders
// the side-by-side instrument metadata (current default vs. picked, OR
// just the picked instrument for the alternative mode) so the operator
// reviews the change BEFORE the PR is created — same UX guarantee as
// the SuggestIsinPanel DiffPanel REPLACE flow. Only the "Bestätigen und
// Pull Request öffnen" button on the confirmation panel actually fires
// `adminApi.setBucketDefaultIsin` / `adminApi.attachAlternativeIsin`.
// ----------------------------------------------------------------------------

import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { adminApi, type InstrumentRow } from "@/lib/admin-api";
import { useAdminT } from "@/lib/admin-i18n";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ChevronLeft, ExternalLink, RefreshCw } from "lucide-react";
import { toast } from "sonner";
// Task #122 (T006) — defence-in-depth: when the picker's empty state
// is reached because the operator typed an ISIN that is "known to
// look-through" (i.e. has a row in lookthrough.overrides.json) but has
// no INSTRUMENTS row, surface a self-explanatory hint that points the
// operator at the Instruments tab. Pulled from the same getters
// validateCatalog() uses, so the picker and the build-time validator
// share one set of look-through keys.
import {
  getLookthroughPoolIsins,
  getLookthroughOverrideIsins,
} from "@/lib/lookthrough";

// Lightweight ISIN-shape regex — same as the one the catalog parsers
// use. Matched only as a precondition for the look-through hint, not as
// a hard validator (the picker's text input accepts any free-text query).
const ISIN_RE = /^[A-Z]{2}[A-Z0-9]{9}\d$/;
const LOOKTHROUGH_KNOWN_ISINS: ReadonlySet<string> = new Set([
  ...getLookthroughPoolIsins(),
  ...getLookthroughOverrideIsins(),
]);

export type InstrumentPickerMode = "default" | "alternative";

// Render one row of the side-by-side preview. Kept inline to avoid
// pulling in the full SuggestIsinPanel DiffPanel just for a 6-field
// comparison.
function MetadataRow({
  label,
  before,
  after,
  changed,
}: {
  label: string;
  before?: string;
  after: string;
  changed: boolean;
}) {
  return (
    <div className="grid grid-cols-[120px_1fr_1fr] gap-2 text-xs">
      <div className="text-muted-foreground">{label}</div>
      <div
        className={`font-mono ${
          before === undefined
            ? "text-muted-foreground italic"
            : changed
              ? "line-through opacity-60"
              : ""
        }`}
      >
        {before ?? "—"}
      </div>
      <div className={`font-mono ${changed ? "text-amber-700 dark:text-amber-400 font-medium" : ""}`}>
        {after}
      </div>
    </div>
  );
}

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
  const [confirming, setConfirming] = useState(false);
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

  // For mode="default", surface the bucket's current default so the
  // confirmation panel can render an A→B side-by-side. The picker only
  // shows UNASSIGNED instruments, so the current default lives in a
  // SEPARATE row of the same instruments[] list (its `usage` includes
  // this `parentKey` with role "default").
  const currentDefault = useMemo<InstrumentRow | null>(() => {
    if (!instruments || mode !== "default") return null;
    return (
      instruments.find((i) =>
        i.usage.some(
          (u) => u.bucket === parentKey && u.role === "default",
        ),
      ) ?? null
    );
  }, [instruments, mode, parentKey]);

  const pickedInstrument = useMemo<InstrumentRow | null>(() => {
    if (!instruments || !pickedIsin) return null;
    return instruments.find((i) => i.isin === pickedIsin) ?? null;
  }, [instruments, pickedIsin]);

  async function handleConfirmedSubmit() {
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

  // ─── Step 2: REPLACE-style review ─────────────────────────────────────
  if (confirming && pickedInstrument) {
    const isReplace = mode === "default" && currentDefault !== null;
    return (
      <div
        className="rounded-md border border-amber-500/50 bg-amber-500/10 p-3 space-y-3"
        data-testid={`instrument-picker-${parentKey}-${mode}-confirm`}
      >
        <div className="flex items-center gap-2">
          <Badge className="bg-amber-600 hover:bg-amber-600">
            {mode === "default"
              ? isReplace
                ? t({
                    de: "Default ersetzen",
                    en: "Replace default",
                  })
                : t({
                    de: "Default festlegen",
                    en: "Set default",
                  })
              : t({
                  de: "Alternative anhängen",
                  en: "Attach alternative",
                })}
          </Badge>
          <span className="text-xs">
            {t({ de: "Bucket", en: "Bucket" })}:{" "}
            <code className="font-mono">{parentKey}</code>
          </span>
        </div>
        <div className="grid grid-cols-[120px_1fr_1fr] gap-2 text-[11px] text-muted-foreground uppercase tracking-wide">
          <div></div>
          <div>
            {isReplace
              ? t({ de: "Bisher (Default)", en: "Before (default)" })
              : mode === "alternative"
                ? t({ de: "—", en: "—" })
                : t({ de: "Bisher", en: "Before" })}
          </div>
          <div>
            {mode === "default"
              ? t({ de: "Neu (Default)", en: "After (default)" })
              : t({ de: "Neue Alternative", en: "New alternative" })}
          </div>
        </div>
        <div className="space-y-1.5 rounded border bg-background p-2">
          <MetadataRow
            label={t({ de: "Name", en: "Name" })}
            before={isReplace ? currentDefault!.name : undefined}
            after={pickedInstrument.name}
            changed={isReplace && currentDefault!.name !== pickedInstrument.name}
          />
          <MetadataRow
            label="ISIN"
            before={isReplace ? currentDefault!.isin : undefined}
            after={pickedInstrument.isin}
            changed={isReplace && currentDefault!.isin !== pickedInstrument.isin}
          />
          <MetadataRow
            label="TER"
            before={
              isReplace ? `${(currentDefault!.terBps / 100).toFixed(2)}%` : undefined
            }
            after={`${(pickedInstrument.terBps / 100).toFixed(2)}%`}
            changed={
              isReplace && currentDefault!.terBps !== pickedInstrument.terBps
            }
          />
          <MetadataRow
            label={t({ de: "Währung", en: "Currency" })}
            before={isReplace ? currentDefault!.currency : undefined}
            after={pickedInstrument.currency}
            changed={
              isReplace && currentDefault!.currency !== pickedInstrument.currency
            }
          />
          <MetadataRow
            label={t({ de: "Domizil", en: "Domicile" })}
            before={isReplace ? currentDefault!.domicile : undefined}
            after={pickedInstrument.domicile}
            changed={
              isReplace && currentDefault!.domicile !== pickedInstrument.domicile
            }
          />
          <MetadataRow
            label={t({ de: "Replikation", en: "Replication" })}
            before={isReplace ? currentDefault!.replication : undefined}
            after={pickedInstrument.replication}
            changed={
              isReplace &&
              currentDefault!.replication !== pickedInstrument.replication
            }
          />
        </div>
        {mode === "default" && !isReplace && (
          <p className="text-[11px] text-muted-foreground italic">
            {t({
              de: "Hinweis: Dieser Bucket hat aktuell keinen Default — die alte Spalte ist deshalb leer.",
              en: "Note: this bucket has no current default — the 'before' column is intentionally empty.",
            })}
          </p>
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
        <div className="flex items-center justify-between gap-2 pt-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              setConfirming(false);
              setSubmitErr(null);
            }}
            disabled={submitting}
            data-testid={`button-instrument-picker-back-${parentKey}`}
          >
            <ChevronLeft className="h-3 w-3 mr-1" />
            {t({ de: "Zurück zur Auswahl", en: "Back to selection" })}
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={() => void handleConfirmedSubmit()}
            disabled={submitting}
            data-testid={`button-instrument-picker-confirm-${parentKey}-${mode}`}
          >
            {submitting && <RefreshCw className="h-3 w-3 animate-spin mr-1" />}
            {t({
              de: "Bestätigen und Pull Request öffnen",
              en: "Confirm and open Pull Request",
            })}
          </Button>
        </div>
      </div>
    );
  }

  // ─── Step 1: pick an instrument ───────────────────────────────────────
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
      {instruments && candidates.length === 0 && (() => {
        const trimmedQuery = query.trim().toUpperCase();
        // Defence in depth (Task #122 T006): the empty-state hint
        // explicitly calls out the "look-through knows it, INSTRUMENTS
        // doesn't" case so a stale zombie injected outside the
        // refresh-job allow-list is self-explanatory rather than a
        // mystery "no match" — the build-time validator (T003) and
        // the refresh-job prune (T005) keep this from triggering in
        // the normal flow.
        const isLookthroughOnly =
          ISIN_RE.test(trimmedQuery) && LOOKTHROUGH_KNOWN_ISINS.has(trimmedQuery);
        if (isLookthroughOnly) {
          return (
            <Alert variant="default" data-testid={`alert-lookthrough-orphan-${parentKey}`}>
              <AlertTitle className="text-xs">
                {t({
                  de: "Look-through bekannt, aber nicht registriert",
                  en: "Known to look-through but not registered",
                })}
              </AlertTitle>
              <AlertDescription className="text-xs space-y-2">
                <p>
                  {t({
                    de: `Für die ISIN ${trimmedQuery} existieren bereits Look-through-Daten, aber sie ist nicht in INSTRUMENTS eingetragen. Lege sie zuerst im Tab „Instrumente“ an, dann steht sie hier zur Auswahl.`,
                    en: `Look-through data already exists for ISIN ${trimmedQuery}, but it is not registered in INSTRUMENTS. Register it first in the “Instruments” tab and it will appear here.`,
                  })}
                </p>
                {/* Task #122 (T006): one-click jump into the
                    Instruments tab with the ISIN pre-filled in the
                    create form. Catalog.tsx parses ?prefillIsin= and
                    forwards it to InstrumentsPanel which seeds the
                    ISIN field of the create form. */}
                <Link
                  href={`/admin/catalog/instruments?prefillIsin=${encodeURIComponent(trimmedQuery)}`}
                  data-testid={`link-register-orphan-${parentKey}-${trimmedQuery}`}
                >
                  <Button type="button" size="sm" variant="outline">
                    <ExternalLink className="h-3 w-3 mr-1" />
                    {t({
                      de: `Jetzt im Tab „Instrumente“ anlegen (${trimmedQuery})`,
                      en: `Register now in “Instruments” tab (${trimmedQuery})`,
                    })}
                  </Button>
                </Link>
              </AlertDescription>
            </Alert>
          );
        }
        return (
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
        );
      })()}
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
      <div className="flex items-center justify-end gap-2 pt-1">
        {onCancel && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onCancel}
            data-testid={`button-instrument-picker-cancel-${parentKey}`}
          >
            {t({ de: "Abbrechen", en: "Cancel" })}
          </Button>
        )}
        <Button
          type="button"
          size="sm"
          onClick={() => setConfirming(true)}
          disabled={!pickedIsin}
          data-testid={`button-instrument-picker-review-${parentKey}-${mode}`}
        >
          {t({ de: "Weiter zur Vorschau", en: "Continue to review" })}
        </Button>
      </div>
    </div>
  );
}
