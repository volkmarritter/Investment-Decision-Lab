// ----------------------------------------------------------------------------
// FastTrackAddEtfPanel — Task #165
// ----------------------------------------------------------------------------
// One-step add-ETF flow that lives at the top of /admin/catalog. Paste an
// ISIN → justETF prefills every field (including a generated Comment from
// the "Investment objective" block) → pick one of four destinations →
// Save. Optionally chains a look-through scrape in the same submit.
//
// Why a separate panel rather than extending one of the existing three?
//   - InstrumentsPanel covers register-only.
//   - SuggestIsinPanel registers-and-creates-a-new-bucket (the legacy
//     `add-isin` flow).
//   - AddAlternativeForm is per-bucket "+ Alternative" attach.
// None of them combines the four destinations behind a single submit, and
// the spec explicitly wants the existing panels to keep working
// unchanged. So this panel is additive — it composes the existing API
// methods and the existing draft-builder helpers in `shared.tsx`.
// ----------------------------------------------------------------------------

import { useMemo, useState } from "react";
import { Plus, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import {
  adminApi,
  type AddBucketAlternativeRequest,
  type CatalogSummary,
  type PreviewResponse,
} from "@/lib/admin-api";
import { Badge } from "@/components/ui/badge";
import { useAdminT } from "@/lib/admin-i18n";
import {
  MAX_ALTERNATIVES_PER_BUCKET,
  MAX_POOL_PER_BUCKET,
} from "@/lib/etfs";
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
import { Checkbox } from "@/components/ui/checkbox";
import { useAdminContext } from "./AdminContext";
import {
  DISTRIBUTIONS,
  EXCHANGES,
  Field,
  REPLICATIONS,
  blankAlternativeDraft,
  buildDraftFromPreview,
  mergePreviewIntoAlternativeDraft,
  type Distribution,
  type Exchange,
  type Replication,
} from "./shared";

const ISIN_RE = /^[A-Z]{2}[A-Z0-9]{9}\d$/;

type Destination =
  | { kind: "register" }
  | { kind: "default"; bucketKey: string }
  | { kind: "alternative"; bucketKey: string }
  | { kind: "pool"; bucketKey: string };

type DestinationKind = Destination["kind"];

interface BucketUsage {
  // every ISIN currently present anywhere in this bucket
  all: Set<string>;
  defaultIsin: string;
  alternatives: Set<string>;
  pool: Set<string>;
  altCount: number;
  poolCount: number;
}

function buildUsage(catalog: CatalogSummary | null) {
  // Per-bucket usage + a global "ISIN already taken" set so we can
  // surface the same eligibility rules the server enforces (strict
  // global ISIN uniqueness across default/alt/pool slots).
  const perBucket = new Map<string, BucketUsage>();
  const globalUsed = new Map<string, string>(); // ISIN → bucket key
  if (!catalog) return { perBucket, globalUsed };
  for (const [key, entry] of Object.entries(catalog)) {
    const alts = (entry.alternatives ?? []).map((a) => a.isin);
    const pool = (entry.pool ?? []).map((a) => a.isin);
    const all = new Set<string>([entry.isin, ...alts, ...pool]);
    perBucket.set(key, {
      all,
      defaultIsin: entry.isin,
      alternatives: new Set(alts),
      pool: new Set(pool),
      altCount: alts.length,
      poolCount: pool.length,
    });
    for (const isin of all) {
      if (!globalUsed.has(isin)) globalUsed.set(isin, key);
    }
  }
  return { perBucket, globalUsed };
}

interface BucketOption {
  key: string;
  disabled: boolean;
  reason?: string;
}

export function FastTrackAddEtfPanel({
  catalog,
  githubConfigured,
}: {
  catalog: CatalogSummary | null;
  githubConfigured: boolean;
}) {
  const { t, lang } = useAdminT();
  const { directWrite } = useAdminContext();

  const [isinInput, setIsinInput] = useState("");
  const [draft, setDraft] = useState<AddBucketAlternativeRequest | null>(null);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [prefilling, setPrefilling] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const [destKind, setDestKind] = useState<DestinationKind>("register");
  const [destBucket, setDestBucket] = useState<string>("");
  const [alsoLookthrough, setAlsoLookthrough] = useState<boolean>(true);

  const { perBucket, globalUsed } = useMemo(
    () => buildUsage(catalog),
    [catalog],
  );

  const targetIsin = (draft?.isin ?? isinInput).trim().toUpperCase();
  const targetIsValid = ISIN_RE.test(targetIsin);
  const isinTakenInBucket = targetIsValid
    ? globalUsed.get(targetIsin)
    : undefined;

  // Eligibility — computed per destination kind. We mirror the
  // server-side rules so disabled options have a tooltip explaining
  // why. Register-only's validity is checked server-side (we don't
  // have the full INSTRUMENTS list here).
  const bucketOptions = useMemo((): Record<
    Exclude<DestinationKind, "register">,
    BucketOption[]
  > => {
    const out: Record<
      Exclude<DestinationKind, "register">,
      BucketOption[]
    > = { default: [], alternative: [], pool: [] };
    if (!catalog) return out;
    const allKeys = Object.keys(catalog).sort();
    for (const key of allKeys) {
      const u = perBucket.get(key);
      if (!u) continue;
      // Default
      {
        let disabled = false;
        let reason: string | undefined;
        if (u.defaultIsin === targetIsin) {
          disabled = true;
          reason = lang === "de"
            ? "Bereits Standard dieses Buckets."
            : "Already the default of this bucket.";
        } else if (u.alternatives.has(targetIsin) || u.pool.has(targetIsin)) {
          disabled = true;
          reason = lang === "de"
            ? "ISIN ist bereits in diesem Bucket (Alternative/Pool)."
            : "ISIN already lives in this bucket (alternative/pool).";
        } else if (
          isinTakenInBucket &&
          isinTakenInBucket !== key
        ) {
          disabled = true;
          reason = lang === "de"
            ? `ISIN ist bereits in Bucket „${isinTakenInBucket}".`
            : `ISIN is already used in bucket "${isinTakenInBucket}".`;
        }
        out.default.push({ key, disabled, reason });
      }
      // Alternative
      {
        let disabled = false;
        let reason: string | undefined;
        if (u.all.has(targetIsin)) {
          disabled = true;
          reason = lang === "de"
            ? "ISIN ist bereits in diesem Bucket."
            : "ISIN already lives in this bucket.";
        } else if (
          isinTakenInBucket &&
          isinTakenInBucket !== key
        ) {
          disabled = true;
          reason = lang === "de"
            ? `ISIN ist bereits in Bucket „${isinTakenInBucket}".`
            : `ISIN is already used in bucket "${isinTakenInBucket}".`;
        } else if (u.altCount >= MAX_ALTERNATIVES_PER_BUCKET) {
          disabled = true;
          reason = lang === "de"
            ? `Bucket hat bereits ${MAX_ALTERNATIVES_PER_BUCKET} Alternativen.`
            : `Bucket already has ${MAX_ALTERNATIVES_PER_BUCKET} alternatives.`;
        }
        out.alternative.push({ key, disabled, reason });
      }
      // Pool
      {
        let disabled = false;
        let reason: string | undefined;
        if (u.all.has(targetIsin)) {
          disabled = true;
          reason = lang === "de"
            ? "ISIN ist bereits in diesem Bucket."
            : "ISIN already lives in this bucket.";
        } else if (
          isinTakenInBucket &&
          isinTakenInBucket !== key
        ) {
          disabled = true;
          reason = lang === "de"
            ? `ISIN ist bereits in Bucket „${isinTakenInBucket}".`
            : `ISIN is already used in bucket "${isinTakenInBucket}".`;
        } else if (u.poolCount >= MAX_POOL_PER_BUCKET) {
          disabled = true;
          reason = lang === "de"
            ? `Pool ist voll (${MAX_POOL_PER_BUCKET}).`
            : `Pool is full (${MAX_POOL_PER_BUCKET}).`;
        }
        out.pool.push({ key, disabled, reason });
      }
    }
    return out;
  }, [catalog, perBucket, targetIsin, isinTakenInBucket, lang]);

  function resetAll() {
    setIsinInput("");
    setDraft(null);
    setPreview(null);
    setDestKind("register");
    setDestBucket("");
    setAlsoLookthrough(true);
    setErrMsg(null);
  }

  async function handlePrefill() {
    setErrMsg(null);
    const isin = isinInput.trim().toUpperCase();
    if (!ISIN_RE.test(isin)) {
      setErrMsg(
        lang === "de" ? "Ungültiges ISIN-Format." : "Invalid ISIN format.",
      );
      return;
    }
    setPrefilling(true);
    try {
      const p = await adminApi.preview(isin);
      // Reuse the shared draft builder so the Comment seed (Task
      // #165) flows in via the same path as the existing panels.
      setDraft(buildDraftFromPreview(p));
      setPreview(p);
      toast.success(
        lang === "de"
          ? "Felder aus ISIN befüllt"
          : "Fields prefilled from ISIN",
      );
    } catch (e: unknown) {
      setErrMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setPrefilling(false);
    }
  }

  async function handleRePrefill() {
    if (!draft) return;
    setErrMsg(null);
    setPrefilling(true);
    try {
      const p = await adminApi.preview(draft.isin);
      setDraft((d) => (d ? mergePreviewIntoAlternativeDraft(d, p) : d));
      setPreview(p);
    } catch (e: unknown) {
      setErrMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setPrefilling(false);
    }
  }

  function patch<K extends keyof AddBucketAlternativeRequest>(
    k: K,
    v: AddBucketAlternativeRequest[K],
  ) {
    setDraft((d) => (d ? { ...d, [k]: v } : d));
  }

  function clientValidate(): string | null {
    if (!draft) return lang === "de" ? "Felder fehlen." : "Fields missing.";
    if (!ISIN_RE.test(draft.isin))
      return lang === "de" ? "ISIN ungültig." : "ISIN invalid.";
    if (!draft.name.trim())
      return lang === "de" ? "Name erforderlich." : "Name required.";
    if (!Number.isFinite(draft.terBps) || draft.terBps < 0 || draft.terBps > 500)
      return lang === "de"
        ? "TER muss in [0, 500] bps liegen."
        : "TER must be in [0, 500] bps.";
    if (!draft.domicile.trim())
      return lang === "de" ? "Domizil erforderlich." : "Domicile required.";
    if (!/^[A-Z]{3}$/.test(draft.currency))
      return lang === "de"
        ? "Währung muss 3-Buchstaben-Code sein."
        : "Currency must be a 3-letter code.";
    if (Object.keys(draft.listings).length === 0)
      return lang === "de"
        ? "Mindestens ein Listing erforderlich."
        : "At least one listing required.";
    if (!draft.listings[draft.defaultExchange])
      return lang === "de"
        ? "Standard-Börse muss ein Listing haben."
        : "Default exchange must have a listing.";
    if (destKind !== "register" && !destBucket)
      return lang === "de"
        ? "Bitte einen Bucket wählen."
        : "Pick a bucket.";
    return null;
  }

  function destOk(): boolean {
    if (destKind === "register") return true;
    const opts = bucketOptions[destKind];
    const match = opts.find((o) => o.key === destBucket);
    return !!match && !match.disabled;
  }

  async function handleSave() {
    setErrMsg(null);
    if (!draft) return;
    const v = clientValidate();
    if (v) {
      setErrMsg(v);
      return;
    }
    if (!destOk()) {
      setErrMsg(
        lang === "de"
          ? "Diese Zielauswahl ist nicht erlaubt (siehe Tooltip)."
          : "This destination is not allowed (see tooltip).",
      );
      return;
    }
    setSubmitting(true);
    try {
      // Track results for the combined toast.
      let savedLine = "";
      let prUrl = "";
      let prNumber = 0;
      let lookthroughLine: string | null = null;
      let lookthroughBundled = false;
      let lookthroughAlreadyPresent = false;

      const instrumentEntry = draft;
      if (destKind === "register") {
        const r = await adminApi.addInstrument(instrumentEntry);
        prUrl = r.prUrl;
        prNumber = r.prNumber;
        savedLine = lang === "de" ? "Instrument registriert" : "Instrument registered";
      } else if (destKind === "alternative") {
        // Spec'd flow: register the instrument first, then attach the
        // ISIN to the bucket via the picker route
        // (POST /admin/buckets/:key/alternatives). The attach route
        // also bundles a look-through scrape when the JSON sidecar
        // doesn't yet have data for the ISIN, so the user gets a
        // usable alternative on day 1 even if the look-through
        // checkbox is off.
        const reg = await adminApi.addInstrument(instrumentEntry);
        prUrl = reg.prUrl;
        prNumber = reg.prNumber;
        const r = await adminApi.attachAlternativeIsin(
          destBucket,
          instrumentEntry.isin,
        );
        if (r.prUrl) prUrl = r.prUrl;
        if (r.prNumber) prNumber = r.prNumber;
        lookthroughBundled = !!r.lookthroughIncluded;
        lookthroughAlreadyPresent = !!r.lookthroughAlreadyPresent;
        savedLine =
          lang === "de"
            ? `Als Alternative in ${destBucket} hinzugefügt`
            : `Added as alternative of ${destBucket}`;
      } else {
        // default / pool: register the instrument first, then run
        // the picker route. In direct-write mode both writes commit
        // to disk sequentially. In PR mode this produces two PRs —
        // accepted per task spec ("match what existing panels do").
        const reg = await adminApi.addInstrument(instrumentEntry);
        prUrl = reg.prUrl;
        prNumber = reg.prNumber;
        if (destKind === "default") {
          const r2 = await adminApi.setBucketDefaultIsin(
            destBucket,
            instrumentEntry.isin,
          );
          if (r2.prUrl) prUrl = r2.prUrl;
          if (r2.prNumber) prNumber = r2.prNumber;
          savedLine =
            lang === "de"
              ? `Als Standard von ${destBucket} gesetzt`
              : `Set as default of ${destBucket}`;
        } else {
          const r2 = await adminApi.attachPoolIsin(
            destBucket,
            instrumentEntry.isin,
          );
          if (r2.prUrl) prUrl = r2.prUrl;
          if (r2.prNumber) prNumber = r2.prNumber;
          savedLine =
            lang === "de"
              ? `In Pool von ${destBucket} hinzugefügt`
              : `Added to pool of ${destBucket}`;
        }
      }

      // Look-through chain — best-effort. Skip if the alternative
      // path already bundled it (or if it was already present).
      if (alsoLookthrough && !lookthroughBundled && !lookthroughAlreadyPresent) {
        try {
          const lr = await adminApi.addLookthroughPoolIsin(instrumentEntry.isin);
          lookthroughLine =
            lang === "de"
              ? `Look-through befüllt (${lr.topHoldingCount} Positionen, ${lr.geoCount} Länder, ${lr.sectorCount} Sektoren)`
              : `Look-through filled (${lr.topHoldingCount} holdings, ${lr.geoCount} countries, ${lr.sectorCount} sectors)`;
        } catch (e: unknown) {
          lookthroughLine =
            (lang === "de"
              ? "Look-through fehlgeschlagen: "
              : "Look-through failed: ") +
            (e instanceof Error ? e.message : String(e));
        }
      } else if (lookthroughBundled) {
        lookthroughLine =
          lang === "de"
            ? "Look-through im selben PR enthalten"
            : "Look-through bundled in the same PR";
      } else if (lookthroughAlreadyPresent) {
        lookthroughLine =
          lang === "de"
            ? "Look-through war bereits vorhanden"
            : "Look-through was already present";
      }

      const isDirect = !prUrl || prNumber === 0;
      const title = isDirect
        ? lang === "de"
          ? "Gespeichert"
          : "Saved"
        : lang === "de"
          ? `Pull Request #${prNumber} geöffnet`
          : `Pull Request #${prNumber} opened`;
      toast.success(title, {
        description:
          [savedLine, lookthroughLine].filter(Boolean).join(" · ") ||
          undefined,
        action:
          !isDirect && prUrl
            ? {
                label: t({ de: "Öffnen", en: "Open" }),
                onClick: () => window.open(prUrl, "_blank"),
              }
            : undefined,
      });
      resetAll();
    } catch (e: unknown) {
      setErrMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card data-testid="card-fast-track-add-etf">
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Plus className="h-4 w-4" />
          {t({ de: "ETF hinzufügen (Schnellweg)", en: "Add ETF (fast-track)" })}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          {t({
            de: "ISIN eingeben → alle Felder (inkl. Kommentar aus dem Anlageziel) werden von justETF vorbefüllt → Ziel wählen → speichern.",
            en: 'Paste an ISIN → every field (including a Comment from the "Investment objective" block) is prefilled from justETF → pick a destination → save.',
          })}
        </p>

        <div className="flex gap-2 items-end">
          <Field label="ISIN">
            <Input
              value={draft ? draft.isin : isinInput}
              onChange={(e) => {
                const v = e.target.value.toUpperCase();
                if (draft) patch("isin", v);
                else setIsinInput(v);
              }}
              placeholder="IE00B5BMR087"
              data-testid="input-fast-track-isin"
              onKeyDown={(e) => {
                if (e.key === "Enter" && !draft && !prefilling && ISIN_RE.test(isinInput.trim().toUpperCase())) {
                  e.preventDefault();
                  void handlePrefill();
                }
              }}
            />
          </Field>
          {!draft && (
            <Button
              onClick={() => void handlePrefill()}
              disabled={prefilling || !ISIN_RE.test(isinInput.trim().toUpperCase())}
              data-testid="button-fast-track-prefill"
            >
              {prefilling ? (
                <RefreshCw className="h-4 w-4 animate-spin" />
              ) : (
                t({ de: "Vorbelegen", en: "Prefill" })
              )}
            </Button>
          )}
          {draft && (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void handleRePrefill()}
                disabled={prefilling}
                data-testid="button-fast-track-reprefill"
                title={t({
                  de: "Felder erneut von justETF holen (manuelle Änderungen am Kommentar bleiben erhalten).",
                  en: "Re-fetch fields from justETF (manual Comment edits are kept).",
                })}
              >
                {prefilling ? <RefreshCw className="h-4 w-4 animate-spin" /> : t({ de: "Erneut holen", en: "Re-prefill" })}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={resetAll}
                data-testid="button-fast-track-reset"
              >
                {t({ de: "Zurücksetzen", en: "Reset" })}
              </Button>
            </>
          )}
        </div>

        {isinTakenInBucket && (
          <Alert>
            <AlertTitle className="text-xs">
              {t({ de: "Hinweis", en: "Heads up" })}
            </AlertTitle>
            <AlertDescription className="text-xs">
              {lang === "de"
                ? `Diese ISIN ist bereits in Bucket „${isinTakenInBucket}" zugeordnet. Doppelte Bucket-Zuordnungen werden serverseitig abgelehnt.`
                : `This ISIN is already assigned to bucket "${isinTakenInBucket}". Duplicate bucket assignments are rejected server-side.`}
            </AlertDescription>
          </Alert>
        )}

        {draft && preview && (
          <div
            className="flex flex-wrap items-center gap-2"
            data-testid="fast-track-policy-fit"
          >
            <Badge
              variant={preview.policyFit.aumOk ? "default" : "destructive"}
              data-testid="fast-track-policy-fit-aum"
            >
              AUM{" "}
              {preview.policyFit.aumOk
                ? "OK"
                : t({ de: "ungenügend", en: "insufficient" })}
            </Badge>
            <Badge
              variant={preview.policyFit.terOk ? "default" : "destructive"}
              data-testid="fast-track-policy-fit-ter"
            >
              TER{" "}
              {preview.policyFit.terOk
                ? "OK"
                : t({ de: "ungenügend", en: "insufficient" })}
            </Badge>
            {preview.policyFit.notes.length > 0 && (
              <span className="text-xs text-muted-foreground">
                {preview.policyFit.notes.join(" · ")}
              </span>
            )}
            <a
              href={preview.sourceUrl}
              target="_blank"
              rel="noreferrer"
              className="text-xs text-primary underline ml-auto"
            >
              {t({ de: "Auf justETF ansehen →", en: "View on justETF →" })}
            </a>
          </div>
        )}

        {draft && (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Field label={t({ de: "Name", en: "Name" })}>
                <Input
                  value={draft.name}
                  onChange={(e) => patch("name", e.target.value)}
                  data-testid="input-fast-track-name"
                />
              </Field>
              <Field label={t({ de: "TER (bps)", en: "TER (bps)" })}>
                <Input
                  type="number"
                  value={draft.terBps}
                  onChange={(e) => patch("terBps", Number(e.target.value))}
                  data-testid="input-fast-track-ter"
                />
              </Field>
              <Field label={t({ de: "AUM (Mio. EUR)", en: "AUM (EUR mn)" })}>
                <Input
                  type="number"
                  value={draft.aumMillionsEUR ?? ""}
                  onChange={(e) =>
                    patch(
                      "aumMillionsEUR",
                      e.target.value === "" ? undefined : Number(e.target.value),
                    )
                  }
                />
              </Field>
              <Field label={t({ de: "Domizil", en: "Domicile" })}>
                <Input
                  value={draft.domicile}
                  onChange={(e) => patch("domicile", e.target.value)}
                />
              </Field>
              <Field label={t({ de: "Währung", en: "Currency" })}>
                <Input
                  value={draft.currency}
                  onChange={(e) => patch("currency", e.target.value.toUpperCase())}
                />
              </Field>
              <Field label={t({ de: "Replikation", en: "Replication" })}>
                <Select
                  value={draft.replication}
                  onValueChange={(v) => patch("replication", v as Replication)}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {REPLICATIONS.map((r) => (
                      <SelectItem key={r} value={r}>{r}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label={t({ de: "Ausschüttung", en: "Distribution" })}>
                <Select
                  value={draft.distribution}
                  onValueChange={(v) => patch("distribution", v as Distribution)}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {DISTRIBUTIONS.map((d) => (
                      <SelectItem key={d} value={d}>{d}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label={t({ de: "Auflagedatum", en: "Inception date" })}>
                <Input
                  placeholder={t({ de: "JJJJ-MM-TT", en: "YYYY-MM-DD" })}
                  value={draft.inceptionDate ?? ""}
                  onChange={(e) =>
                    patch("inceptionDate", e.target.value || undefined)
                  }
                />
              </Field>
              <Field label={t({ de: "Standard-Börse", en: "Default exchange" })}>
                <Select
                  value={draft.defaultExchange}
                  onValueChange={(v) => patch("defaultExchange", v as Exchange)}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {EXCHANGES.map((x) => (
                      <SelectItem key={x} value={x}>{x}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>

            <Field label={t({ de: "Kommentar", en: "Comment" })}>
              <Textarea
                rows={3}
                value={draft.comment}
                onChange={(e) => patch("comment", e.target.value)}
                data-testid="input-fast-track-comment"
                placeholder={t({
                  de: "Wird automatisch aus dem Anlageziel befüllt — du kannst es überschreiben.",
                  en: 'Auto-filled from "Investment objective" — you can overwrite it.',
                })}
              />
            </Field>

            <div>
              <Label className="text-xs">
                {t({ de: "Listings (Ticker je Börse)", en: "Listings (ticker per exchange)" })}
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
                        setDraft((d) => (d ? { ...d, listings: next } : d));
                      }}
                    />
                  </div>
                ))}
              </div>
            </div>

            {/* Destination selector */}
            <div className="rounded-md border p-3 space-y-3 bg-muted/10">
              <div className="text-sm font-medium">
                {t({ de: "Ziel", en: "Destination" })}
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <DestRow
                  testid="dest-register"
                  selected={destKind === "register"}
                  onSelect={() => setDestKind("register")}
                  label={t({ de: "Nur registrieren", en: "Register only" })}
                  hint={t({
                    de: "Instrument anlegen, keine Bucket-Zuordnung.",
                    en: "Create instrument, no bucket assignment.",
                  })}
                />
                <DestRow
                  testid="dest-default"
                  selected={destKind === "default"}
                  onSelect={() => setDestKind("default")}
                  label={t({ de: "Standard von …", en: "Set as default of …" })}
                  hint={t({
                    de: "Aktuellen Standard des Buckets ersetzen.",
                    en: "Replace the bucket's current default.",
                  })}
                  picker={
                    destKind === "default" ? (
                      <BucketPicker
                        testid="dest-default-bucket"
                        options={bucketOptions.default}
                        value={destBucket}
                        onChange={setDestBucket}
                        emptyHint={t({ de: "Bucket wählen …", en: "Pick a bucket …" })}
                      />
                    ) : null
                  }
                />
                <DestRow
                  testid="dest-alternative"
                  selected={destKind === "alternative"}
                  onSelect={() => setDestKind("alternative")}
                  label={t({ de: "Alternative von …", en: "Add as alternative of …" })}
                  hint={t({
                    de: `Bis zu ${MAX_ALTERNATIVES_PER_BUCKET} pro Bucket.`,
                    en: `Up to ${MAX_ALTERNATIVES_PER_BUCKET} per bucket.`,
                  })}
                  picker={
                    destKind === "alternative" ? (
                      <BucketPicker
                        testid="dest-alternative-bucket"
                        options={bucketOptions.alternative}
                        value={destBucket}
                        onChange={setDestBucket}
                        emptyHint={t({ de: "Bucket wählen …", en: "Pick a bucket …" })}
                      />
                    ) : null
                  }
                />
                <DestRow
                  testid="dest-pool"
                  selected={destKind === "pool"}
                  onSelect={() => setDestKind("pool")}
                  label={t({ de: "Pool von …", en: "Add to pool of …" })}
                  hint={t({
                    de: `Erweiterte Universum-Liste (max ${MAX_POOL_PER_BUCKET}).`,
                    en: `Extended-universe list (cap ${MAX_POOL_PER_BUCKET}).`,
                  })}
                  picker={
                    destKind === "pool" ? (
                      <BucketPicker
                        testid="dest-pool-bucket"
                        options={bucketOptions.pool}
                        value={destBucket}
                        onChange={setDestBucket}
                        emptyHint={t({ de: "Bucket wählen …", en: "Pick a bucket …" })}
                      />
                    ) : null
                  }
                />
              </div>

              <div className="flex items-center gap-2 pt-1">
                <Checkbox
                  id="fast-track-lookthrough"
                  checked={alsoLookthrough}
                  onCheckedChange={(v) => setAlsoLookthrough(v === true)}
                  data-testid="checkbox-fast-track-lookthrough"
                />
                <Label htmlFor="fast-track-lookthrough" className="text-xs cursor-pointer">
                  {t({
                    de: "Look-through-Daten gleich mit befüllen (justETF Top-Holdings, Geo, Sektor).",
                    en: "Also fetch look-through data (justETF top holdings, geo, sector).",
                  })}
                </Label>
              </div>
            </div>

            {errMsg && (
              <Alert variant="destructive">
                <AlertTitle className="text-xs">{t({ de: "Fehler", en: "Error" })}</AlertTitle>
                <AlertDescription className="text-xs break-words">{errMsg}</AlertDescription>
              </Alert>
            )}

            <Button
              className="w-full"
              onClick={() => void handleSave()}
              disabled={submitting || !githubConfigured}
              data-testid="button-fast-track-save"
            >
              {submitting
                ? lang === "de" ? "Speichere …" : "Saving …"
                : directWrite
                  ? lang === "de" ? "Speichern" : "Save"
                  : lang === "de" ? "Speichern (PR öffnen)" : "Save (open PR)"}
            </Button>
            {!githubConfigured && (
              <p className="text-xs text-muted-foreground">
                {t({
                  de: "GitHub-Schreibzugriff nicht konfiguriert — Speichern ist deaktiviert.",
                  en: "GitHub write access not configured — Save is disabled.",
                })}
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function DestRow({
  testid,
  selected,
  onSelect,
  label,
  hint,
  picker,
}: {
  testid: string;
  selected: boolean;
  onSelect: () => void;
  label: string;
  hint: string;
  picker?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      data-testid={`button-${testid}`}
      className={`text-left rounded-md border p-2 transition ${
        selected ? "border-primary bg-primary/5" : "border-border hover:bg-muted/40"
      }`}
    >
      <div className="flex items-center gap-2">
        <span
          className={`inline-block h-3 w-3 rounded-full border ${
            selected ? "bg-primary border-primary" : "border-muted-foreground"
          }`}
        />
        <span className="text-sm font-medium">{label}</span>
      </div>
      <div className="text-xs text-muted-foreground mt-1 ml-5">{hint}</div>
      {picker && <div className="mt-2 ml-5" onClick={(e) => e.stopPropagation()}>{picker}</div>}
    </button>
  );
}

function BucketPicker({
  testid,
  options,
  value,
  onChange,
  emptyHint,
}: {
  testid: string;
  options: BucketOption[];
  value: string;
  onChange: (v: string) => void;
  emptyHint: string;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger data-testid={`select-${testid}`}>
        <SelectValue placeholder={emptyHint} />
      </SelectTrigger>
      <SelectContent>
        {options.length === 0 && (
          <div className="px-2 py-1 text-xs text-muted-foreground italic">
            {emptyHint}
          </div>
        )}
        {options.map((o) => (
          <SelectItem
            key={o.key}
            value={o.key}
            disabled={o.disabled}
            title={o.reason}
          >
            <span className={o.disabled ? "text-muted-foreground" : ""}>
              {o.key}
              {o.disabled && o.reason ? ` — ${o.reason}` : ""}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
