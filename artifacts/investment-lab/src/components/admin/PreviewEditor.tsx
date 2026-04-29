// ----------------------------------------------------------------------------
// PreviewEditor — editable form rendered after a successful preview in the
// SuggestIsinPanel. Wraps the DiffPanel and the submit button.
// ----------------------------------------------------------------------------

import { useMemo } from "react";
import type {
  AddEtfRequest,
  CatalogSummary,
  PreviewResponse,
} from "@/lib/admin-api";
import { classifyDraft, type ClassifyResult } from "@/lib/catalog-classify";
import { useAdminT } from "@/lib/admin-i18n";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DISTRIBUTIONS,
  EXCHANGES,
  Field,
  REPLICATIONS,
  type Distribution,
  type Exchange,
  type Replication,
} from "./shared";
import { DiffPanel } from "./DiffPanel";

export function PreviewEditor({
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
          ? t({ de: "Pull Request wird geöffnet …", en: "Opening pull request …" })
          : blockedByDuplicate
            ? t({
                de: "ISIN-Konflikt oben beheben, um fortzufahren",
                en: "Resolve the ISIN conflict above to continue",
              })
            : classification?.state === "REPLACE"
              ? t({
                  de: "Pull Request öffnen: bestehenden Eintrag ersetzen",
                  en: "Open pull request: replace existing entry",
                })
              : t({
                  de: "Pull Request öffnen: zum Katalog hinzufügen",
                  en: "Open pull request: add to catalog",
                })}
      </Button>
    </div>
  );
}
