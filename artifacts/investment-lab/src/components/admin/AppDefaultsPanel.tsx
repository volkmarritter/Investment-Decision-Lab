import { useEffect, useState } from "react";
import {
    adminApi,
  type AppDefaultsAssetKey,
  type AppDefaultsHbCurrency,
  type AppDefaultsPayload,
  type AppDefaultsRfCurrency,
} from "@/lib/admin-api";
import {
  APP_DEFAULTS_PRESETS,
    applyPresetToFields,
    findPresetById,
} from "@/lib/appDefaultsPresets";
import { BUILT_IN_RF, BUILT_IN_HB } from "@/lib/settings";
import { BASE_SEED } from "@/lib/metrics";
import { useAdminT } from "@/lib/admin-i18n";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { PendingPrsCard } from "./PendingPrsCard";

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

export function AppDefaultsPanel({ githubConfigured }: { githubConfigured: boolean }) {
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
  const [prsRefreshKey, setPrsRefreshKey] = useState(0);

  async function loadFromServer(): Promise<boolean> {
    setLoading(true);
    try {
      const res = await adminApi.getAppDefaults();
      const v = res.value ?? {};
      setMeta(v._meta ? { lastUpdated: v._meta.lastUpdated ?? null, lastUpdatedBy: v._meta.lastUpdatedBy ?? null } : null);
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
        ? `Vorlage angewendet: ${preset.label}. Bitte vor dem Pull Request pruefen.`
        : `Preset applied: ${preset.label}. Please review before opening the Pull Request.`,
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
          de: "Kurze Beschreibung erforderlich (für Pull Request-Titel).",
          en: "Short description required (used as the Pull Request title).",
        }),
      );
      return;
    }
    const { value, touched, invalidFields } = buildPayload();
    if (invalidFields.length > 0) {
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
      const ok = window.confirm(
        t({
          de: "Kein Feld hat einen Wert. Wenn du jetzt fortsetzt, wird ein Pull Request erzeugt, der ALLE globalen Defaults entfernt und auf die eingebauten Built-in-Werte zurücksetzt. Wirklich fortfahren?",
          en: "No field has a value. If you continue, a Pull Request will be opened that removes ALL global defaults and falls back to the built-in values. Really proceed?",
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
            ? `Pull Request #${res.prNumber} geöffnet (alle Overrides entfernt).`
            : `Pull Request #${res.prNumber} opened (all overrides removed).`
          : lang === "de"
            ? `Pull Request #${res.prNumber} geöffnet (${touched} Feld${touched === 1 ? "" : "er"} übermittelt).`
            : `Pull Request #${res.prNumber} opened (${touched} field${touched === 1 ? "" : "s"} submitted).`,
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
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
              Werte hier werden über einen GitHub-Pull Request in{" "}
              <code>artifacts/investment-lab/src/data/app-defaults.json</code>{" "}
              geschrieben. Nach Merge + Redeploy gelten sie als Default für
              alle Nutzer. Felder leer lassen = bisheriger Built-in-Default
              greift. Per-User-Overrides aus dem Methodology-Tab
              (localStorage) bleiben unverändert oben drauf wirksam.
            </>
          ) : (
            <>
              Values here are written via a GitHub Pull Request to{" "}
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
                  de: "Kurze Beschreibung der Änderung (für Pull Request-Titel)",
                  en: "Short description of the change (used as Pull Request title)",
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
                      <code>GITHUB_REPO</code> auf dem api-server, um Pull Requests
                      öffnen zu können.
                    </>
                  ) : (
                    <>
                      Set <code>GITHUB_PAT</code>, <code>GITHUB_OWNER</code>,{" "}
                      <code>GITHUB_REPO</code> on the api-server to enable
                      opening Pull Requests.
                    </>
                  )}
                </AlertDescription>
              </Alert>
            )}

            <div className="flex items-center justify-between gap-3">
              <p className="text-xs text-muted-foreground">
                {t({
                  de: "Hinweis: Werte werden vor dem Commit serverseitig validiert (Bereiche wie Methodology). Ungültige Eingaben werden als Fehler gemeldet und es entsteht kein Pull Request.",
                  en: "Note: values are validated server-side before commit (same bounds as Methodology). Invalid input is reported as an error and no Pull Request is created.",
                })}
              </p>
              <Button
                data-testid="button-app-defaults-submit"
                onClick={onSubmit}
                disabled={submitting || !githubConfigured}
              >
                {submitting
                  ? t({ de: "Pull Request wird geöffnet…", en: "Opening Pull Request…" })
                  : t({ de: "Pull Request öffnen", en: "Open Pull Request" })}
              </Button>
            </div>

            {lastPr && (
              <Alert>
                <AlertTitle>
                  {t({ de: "Pull Request geöffnet", en: "Pull Request opened" })}
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
                      ? `Pull Request #${lastPr.number} auf GitHub öffnen`
                      : `Open Pull Request #${lastPr.number} on GitHub`}
                  </a>
                </AlertDescription>
              </Alert>
            )}

            <PendingPrsCard
              prefix="update-app-defaults/"
              refreshKey={prsRefreshKey}
              emptyHint={t({
                de: "Keine offenen Defaults-Pull Requests — alle Änderungen sind gemerged.",
                en: "No open defaults Pull Requests — all changes are merged.",
              })}
            />
          </>
        )}
      </CardContent>
    </Card>
  );
}
