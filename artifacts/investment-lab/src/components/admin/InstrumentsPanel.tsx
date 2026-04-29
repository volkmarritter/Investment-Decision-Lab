// ----------------------------------------------------------------------------
// InstrumentsPanel — sub-tab managing the per-ISIN INSTRUMENTS registry.
// ----------------------------------------------------------------------------
// Phase 2 of Task #111 split the master fund metadata (INSTRUMENTS, keyed
// by ISIN) from bucket assignment (BUCKETS, keyed by bucket key). This
// panel is the operator surface for the INSTRUMENTS side: register,
// edit, retire — bucket assignment lives in the Browse tab tree-row
// pickers, NOT here.
//
// Each row shows the ISIN + name + key per-fund metadata + a "used in"
// column that lists every bucket slot referencing this ISIN. Delete is
// refused server-side when that column is non-empty (the operator must
// detach from every bucket first).
// ----------------------------------------------------------------------------

import { useEffect, useMemo, useState } from "react";
import {
  adminApi,
  type AddInstrumentRequest,
  type InstrumentRow,
} from "@/lib/admin-api";
import { useAdminT } from "@/lib/admin-i18n";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { Plus, RefreshCw, Trash2, Pencil } from "lucide-react";
import { toast } from "sonner";
import {
  DISTRIBUTIONS,
  EXCHANGES,
  Field,
  REPLICATIONS,
  blankAlternativeDraft,
  type Distribution,
  type Exchange,
  type Replication,
} from "./shared";

type Mode =
  | { kind: "list" }
  | { kind: "create" }
  | { kind: "edit"; isin: string };

export function InstrumentsPanel({
  githubConfigured,
}: {
  githubConfigured: boolean;
}) {
  const { t, lang } = useAdminT();
  const [rows, setRows] = useState<InstrumentRow[] | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [mode, setMode] = useState<Mode>({ kind: "list" });
  const [query, setQuery] = useState("");

  useEffect(() => {
    let cancelled = false;
    setRows(null);
    setLoadErr(null);
    adminApi.instruments().then(
      (r) => !cancelled && setRows(r.instruments),
      (e: unknown) =>
        !cancelled && setLoadErr(e instanceof Error ? e.message : String(e)),
    );
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  const filtered = useMemo(() => {
    if (!rows) return [];
    const q = query.trim().toUpperCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        r.isin.toUpperCase().includes(q) ||
        r.name.toUpperCase().includes(q) ||
        r.currency.toUpperCase().includes(q) ||
        r.domicile.toUpperCase().includes(q),
    );
  }, [rows, query]);

  function handlePrCreated() {
    setMode({ kind: "list" });
    setReloadKey((k) => k + 1);
  }

  async function handleRemove(row: InstrumentRow) {
    const confirmed = window.confirm(
      lang === "de"
        ? `Pull Request öffnen, der ${row.name} (${row.isin}) aus der Instrument-Registry entfernt?`
        : `Open a pull request removing ${row.name} (${row.isin}) from the instrument registry?`,
    );
    if (!confirmed) return;
    try {
      const r = await adminApi.removeInstrument(row.isin);
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
      setReloadKey((k) => k + 1);
    } catch (e: unknown) {
      toast.error(
        lang === "de"
          ? `Entfernen fehlgeschlagen: ${e instanceof Error ? e.message : String(e)}`
          : `Remove failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  return (
    <Card data-testid="card-instruments-panel">
      <CardHeader>
        <CardTitle className="text-base flex items-center justify-between gap-2">
          <span>
            {t({
              de: "ETF-Instrumente (Registry)",
              en: "ETF instruments (registry)",
            })}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setReloadKey((k) => k + 1)}
              className="text-xs text-primary hover:underline"
              data-testid="button-instruments-reload"
            >
              {t({ de: "Neu laden", en: "Reload" })}
            </button>
            {mode.kind === "list" && githubConfigured && (
              <Button
                size="sm"
                onClick={() => setMode({ kind: "create" })}
                data-testid="button-instruments-new"
              >
                <Plus className="h-4 w-4 mr-1" />
                {t({ de: "Neues Instrument", en: "New instrument" })}
              </Button>
            )}
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {!githubConfigured && (
          <Alert>
            <AlertTitle className="text-xs">
              {t({
                de: "GitHub-Schreibzugriff nicht konfiguriert",
                en: "GitHub write access not configured",
              })}
            </AlertTitle>
            <AlertDescription className="text-xs">
              {t({
                de: "Setze GITHUB_PAT, GITHUB_OWNER und GITHUB_REPO auf dem api-server, damit Instrumente angelegt oder geändert werden können. Lesen funktioniert auch ohne.",
                en: "Set GITHUB_PAT, GITHUB_OWNER and GITHUB_REPO on the api-server to enable create / edit / delete. Read works without.",
              })}
            </AlertDescription>
          </Alert>
        )}
        {loadErr && (
          <Alert variant="destructive">
            <AlertTitle className="text-xs">
              {t({
                de: "Instrumente konnten nicht geladen werden",
                en: "Instruments could not be loaded",
              })}
            </AlertTitle>
            <AlertDescription className="text-xs">{loadErr}</AlertDescription>
          </Alert>
        )}
        {mode.kind === "create" && (
          <InstrumentForm
            initial={null}
            onCancel={() => setMode({ kind: "list" })}
            onCreated={handlePrCreated}
            githubConfigured={githubConfigured}
          />
        )}
        {mode.kind === "edit" && (
          <InstrumentForm
            initial={rows?.find((r) => r.isin === mode.isin) ?? null}
            onCancel={() => setMode({ kind: "list" })}
            onCreated={handlePrCreated}
            githubConfigured={githubConfigured}
          />
        )}
        {mode.kind === "list" && (
          <>
            <Input
              placeholder={t({
                de: "Suchen nach Name, ISIN, Währung …",
                en: "Search by name, ISIN, currency …",
              })}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              data-testid="input-instruments-search"
            />
            {!rows && !loadErr && (
              <p className="text-sm text-muted-foreground">
                {t({ de: "Lade …", en: "Loading …" })}
              </p>
            )}
            {rows && (
              <div className="overflow-x-auto rounded border">
                <table
                  className="w-full text-xs"
                  data-testid="table-instruments"
                >
                  <thead className="bg-muted/40 text-muted-foreground">
                    <tr className="text-left">
                      <th className="px-2 py-1 font-medium">ISIN</th>
                      <th className="px-2 py-1 font-medium">
                        {t({ de: "Name", en: "Name" })}
                      </th>
                      <th className="px-2 py-1 font-medium">TER</th>
                      <th className="px-2 py-1 font-medium">
                        {t({ de: "Währung", en: "Currency" })}
                      </th>
                      <th className="px-2 py-1 font-medium">
                        {t({ de: "Domizil", en: "Domicile" })}
                      </th>
                      <th className="px-2 py-1 font-medium">
                        {t({
                          de: "Verwendet in",
                          en: "Used in",
                        })}
                      </th>
                      <th className="px-2 py-1 font-medium text-right">
                        {t({ de: "Aktionen", en: "Actions" })}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.length === 0 && (
                      <tr>
                        <td
                          colSpan={7}
                          className="px-2 py-3 text-center text-muted-foreground italic"
                        >
                          {query.trim()
                            ? t({
                                de: "Kein Treffer.",
                                en: "No match.",
                              })
                            : t({
                                de: "Noch keine Instrumente registriert.",
                                en: "No instruments registered yet.",
                              })}
                        </td>
                      </tr>
                    )}
                    {filtered.map((row) => {
                      const usedIn = row.usage
                        .map((u) =>
                          u.role === "default"
                            ? `${u.bucket} (default)`
                            : `${u.bucket} alt ${u.index}`,
                        )
                        .join(", ");
                      return (
                        <tr
                          key={row.isin}
                          className="border-t hover:bg-muted/20"
                          data-testid={`row-instrument-${row.isin}`}
                        >
                          <td className="px-2 py-1 font-mono">{row.isin}</td>
                          <td className="px-2 py-1">{row.name}</td>
                          <td className="px-2 py-1">
                            {(row.terBps / 100).toFixed(2)}%
                          </td>
                          <td className="px-2 py-1">{row.currency}</td>
                          <td className="px-2 py-1">{row.domicile}</td>
                          <td className="px-2 py-1 text-muted-foreground">
                            {usedIn || (
                              <span className="italic">
                                {t({
                                  de: "nicht zugeordnet",
                                  en: "unassigned",
                                })}
                              </span>
                            )}
                          </td>
                          <td className="px-2 py-1 text-right">
                            <div className="inline-flex items-center gap-1">
                              <Button
                                size="sm"
                                variant="ghost"
                                disabled={!githubConfigured}
                                onClick={() =>
                                  setMode({ kind: "edit", isin: row.isin })
                                }
                                data-testid={`button-instrument-edit-${row.isin}`}
                                title={t({
                                  de: "Metadaten bearbeiten (öffnet PR).",
                                  en: "Edit metadata (opens a PR).",
                                })}
                              >
                                <Pencil className="h-3 w-3" />
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                disabled={
                                  !githubConfigured || row.usage.length > 0
                                }
                                onClick={() => void handleRemove(row)}
                                data-testid={`button-instrument-delete-${row.isin}`}
                                title={
                                  row.usage.length > 0
                                    ? t({
                                        de: "Bucket-Zuordnungen müssen zuerst entfernt werden.",
                                        en: "Detach bucket usages first.",
                                      })
                                    : t({
                                        de: "Instrument aus der Registry entfernen (öffnet PR).",
                                        en: "Remove instrument from registry (opens a PR).",
                                      })
                                }
                              >
                                <Trash2 className="h-3 w-3" />
                              </Button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ----------------------------------------------------------------------------
// InstrumentForm — create/edit form for a single INSTRUMENTS row.
// ----------------------------------------------------------------------------
// When `initial` is null we're creating; when populated we're editing
// the existing row by ISIN (the ISIN field becomes read-only — renames
// must go through delete + create so PR diffs stay easy to review).
// ----------------------------------------------------------------------------
function InstrumentForm({
  initial,
  onCancel,
  onCreated,
  githubConfigured,
}: {
  initial: InstrumentRow | null;
  onCancel: () => void;
  onCreated: () => void;
  githubConfigured: boolean;
}) {
  const { t, lang } = useAdminT();
  const [draft, setDraft] = useState<AddInstrumentRequest>(() => {
    if (initial) {
      return {
        name: initial.name,
        isin: initial.isin,
        terBps: initial.terBps,
        domicile: initial.domicile,
        replication: initial.replication as Replication,
        distribution: initial.distribution as Distribution,
        currency: initial.currency,
        comment: initial.comment,
        defaultExchange: initial.defaultExchange as Exchange,
        listings: initial.listings as AddInstrumentRequest["listings"],
        ...(initial.aumMillionsEUR !== undefined
          ? { aumMillionsEUR: initial.aumMillionsEUR }
          : {}),
        ...(initial.inceptionDate
          ? { inceptionDate: initial.inceptionDate }
          : {}),
      };
    }
    return blankAlternativeDraft();
  });
  const [submitting, setSubmitting] = useState(false);
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const isEdit = initial !== null;

  function setListing(ex: Exchange, ticker: string) {
    setDraft((d) => {
      const next = { ...d.listings };
      if (ticker.trim()) {
        next[ex] = { ticker: ticker.trim() };
      } else {
        delete next[ex];
      }
      return { ...d, listings: next };
    });
  }

  async function handleSubmit() {
    setSubmitting(true);
    setErrMsg(null);
    try {
      const r = isEdit
        ? await adminApi.updateInstrument(initial!.isin, draft)
        : await adminApi.addInstrument(draft);
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
      onCreated();
    } catch (e: unknown) {
      setErrMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="rounded-md border p-3 space-y-3 bg-muted/10"
      data-testid={`instrument-form-${isEdit ? "edit" : "create"}`}
    >
      <div className="text-sm font-medium">
        {isEdit
          ? t({
              de: `Instrument bearbeiten: ${initial!.isin}`,
              en: `Edit instrument: ${initial!.isin}`,
            })
          : t({
              de: "Neues Instrument anlegen",
              en: "Register new instrument",
            })}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Field label={t({ de: "Name", en: "Name" })}>
          <Input
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            data-testid="input-instrument-name"
          />
        </Field>
        <Field label="ISIN">
          <Input
            value={draft.isin}
            onChange={(e) =>
              setDraft({ ...draft, isin: e.target.value.toUpperCase() })
            }
            disabled={isEdit}
            data-testid="input-instrument-isin"
          />
        </Field>
        <Field label={t({ de: "TER (bps)", en: "TER (bps)" })}>
          <Input
            type="number"
            min={0}
            max={500}
            value={draft.terBps}
            onChange={(e) =>
              setDraft({ ...draft, terBps: Number(e.target.value) })
            }
            data-testid="input-instrument-ter"
          />
        </Field>
        <Field label={t({ de: "Domizil", en: "Domicile" })}>
          <Input
            value={draft.domicile}
            onChange={(e) => setDraft({ ...draft, domicile: e.target.value })}
            data-testid="input-instrument-domicile"
          />
        </Field>
        <Field label={t({ de: "Replikation", en: "Replication" })}>
          <Select
            value={draft.replication}
            onValueChange={(v) =>
              setDraft({ ...draft, replication: v as Replication })
            }
          >
            <SelectTrigger data-testid="select-instrument-replication">
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
            onValueChange={(v) =>
              setDraft({ ...draft, distribution: v as Distribution })
            }
          >
            <SelectTrigger data-testid="select-instrument-distribution">
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
        <Field label={t({ de: "Währung", en: "Currency" })}>
          <Input
            value={draft.currency}
            onChange={(e) => setDraft({ ...draft, currency: e.target.value })}
            data-testid="input-instrument-currency"
          />
        </Field>
        <Field label={t({ de: "Standard-Börse", en: "Default exchange" })}>
          <Select
            value={draft.defaultExchange}
            onValueChange={(v) =>
              setDraft({ ...draft, defaultExchange: v as Exchange })
            }
          >
            <SelectTrigger data-testid="select-instrument-exchange">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {EXCHANGES.map((ex) => (
                <SelectItem key={ex} value={ex}>
                  {ex}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </div>
      <div>
        <Label className="text-xs">
          {t({ de: "Listings (Ticker je Börse)", en: "Listings (ticker per exchange)" })}
        </Label>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-1">
          {EXCHANGES.map((ex) => (
            <Input
              key={ex}
              placeholder={ex}
              value={draft.listings[ex]?.ticker ?? ""}
              onChange={(e) => setListing(ex, e.target.value)}
              data-testid={`input-instrument-listing-${ex}`}
            />
          ))}
        </div>
      </div>
      <Field label={t({ de: "Kommentar", en: "Comment" })}>
        <Textarea
          rows={2}
          value={draft.comment}
          onChange={(e) => setDraft({ ...draft, comment: e.target.value })}
          data-testid="textarea-instrument-comment"
        />
      </Field>
      {errMsg && (
        <Alert variant="destructive">
          <AlertTitle className="text-xs">
            {t({
              de: "Pull Request konnte nicht geöffnet werden",
              en: "Could not open Pull Request",
            })}
          </AlertTitle>
          <AlertDescription className="text-xs">{errMsg}</AlertDescription>
        </Alert>
      )}
      <div className="flex items-center justify-end gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onCancel}
          disabled={submitting}
          data-testid="button-instrument-cancel"
        >
          {t({ de: "Abbrechen", en: "Cancel" })}
        </Button>
        <Button
          type="button"
          size="sm"
          onClick={() => void handleSubmit()}
          disabled={submitting || !githubConfigured}
          data-testid="button-instrument-submit"
        >
          {submitting && <RefreshCw className="h-3 w-3 animate-spin mr-1" />}
          {isEdit
            ? t({ de: "Änderung als PR vorschlagen", en: "Propose edit as PR" })
            : t({ de: "Anlegen als PR vorschlagen", en: "Propose create as PR" })}
        </Button>
      </div>
    </div>
  );
}
