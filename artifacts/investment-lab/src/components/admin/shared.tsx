import { Label } from "@/components/ui/label";
import { formatAsOf, type AdminLang } from "@/lib/admin-date";
import { useAdminT } from "@/lib/admin-i18n";
import type {
AddBucketAlternativeRequest,
AddEtfRequest,
AddInstrumentRequest,
PreviewResponse,
} from "@/lib/admin-api";

export type Replication = AddEtfRequest["replication"];
export type Distribution = AddEtfRequest["distribution"];
export type Exchange = AddEtfRequest["defaultExchange"];

export const REPLICATIONS: Replication[] = [
  "Physical",
  "Physical (sampled)",
  "Synthetic",
];
export const DISTRIBUTIONS: Distribution[] = ["Accumulating", "Distributing"];
export const EXCHANGES: Exchange[] = ["LSE", "XETRA", "SIX", "Euronext"];

export function Field({
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

export function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 items-start">
      <span className="text-muted-foreground">{k}</span>
      <div className="font-mono text-xs text-right">{v}</div>
    </div>
  );
}

// AsOfInline / AsOfCell — render a YYYY-MM-DD "as of" date as a
// localised calendar date plus a relative-age subscript ("vor 9 Tagen"
// / "9 days ago"). The raw ISO date is preserved as a tooltip so the
// operator can copy it for grepping logs / look-through pool entries.
//
// Use AsOfInline for grid / inline contexts (badges, definition lists)
// and AsOfCell when the value goes inside a table cell — it adds the
// muted-foreground colour and em-dash placeholder our tables use for
// missing data.
export function AsOfInline({
  value,
  lang,
}: {
  value: string | null | undefined;
  lang: AdminLang;
}) {
  const f = value ? formatAsOf(value, lang) : null;
  if (!f) return <span className="text-muted-foreground">—</span>;
  return (
    <span
      className="leading-tight inline-block tabular-nums"
      title={value ?? undefined}
    >
      <span className="block">{f.local}</span>
      <span className="block text-[10px] text-muted-foreground">
        {f.relative}
      </span>
    </span>
  );
}

export function AsOfCell({ value }: { value: string | null | undefined }) {
  const { lang } = useAdminT();
  return (
    <span className="text-muted-foreground">
      <AsOfInline value={value} lang={lang} />
    </span>
  );
}

export function fmt(v: unknown): string {
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

export function normalizeReplication(v: unknown): Replication {
  const s = String(v ?? "").toLowerCase();
  if (s.includes("sampl")) return "Physical (sampled)";
  if (s.includes("synth") || s.includes("swap")) return "Synthetic";
  return "Physical";
}

export function normalizeDistribution(v: unknown): Distribution {
  const s = String(v ?? "").toLowerCase();
  if (s.startsWith("dist")) return "Distributing";
  return "Accumulating";
}

export function buildDraftFromPreview(p: PreviewResponse): AddEtfRequest {
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
    domicile:
      typeof f.domicile === "string" ? (f.domicile as string) : "Ireland",
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

// Same projection as buildDraftFromPreview, but for the alternative
// shape (no `key` field — alts are positional inside their parent).
// Merges into an existing draft so a user-typed `comment` survives the
// autofill (justETF doesn't supply that field).
export function mergePreviewIntoAlternativeDraft(
  current: AddBucketAlternativeRequest,
  p: PreviewResponse,
): AddBucketAlternativeRequest {
  const f = p.fields;
  const listings: AddBucketAlternativeRequest["listings"] = {};
  if (p.listings && typeof p.listings === "object") {
    for (const ex of EXCHANGES) {
      const v = p.listings[ex];
      if (v?.ticker) listings[ex] = { ticker: v.ticker };
    }
  }
  const mergedListings =
    Object.keys(listings).length > 0 ? listings : current.listings;
  const defaultExchange =
    (Object.keys(mergedListings)[0] as Exchange | undefined) ??
    current.defaultExchange ??
    "LSE";
  return {
    ...current,
    name: typeof f.name === "string" ? (f.name as string) : current.name,
    isin: p.isin,
    terBps:
      typeof f.terBps === "number" ? (f.terBps as number) : current.terBps,
    domicile:
      typeof f.domicile === "string"
        ? (f.domicile as string)
        : current.domicile,
    replication: normalizeReplication(f.replication),
    distribution: normalizeDistribution(f.distribution),
    currency:
      typeof f.currency === "string"
        ? (f.currency as string)
        : current.currency,
    listings: mergedListings,
    defaultExchange,
  };
}

export const mergePreviewIntoInstrumentDraft = (
  current: AddInstrumentRequest,
  p: PreviewResponse,
): AddInstrumentRequest =>
  mergePreviewIntoAlternativeDraft(current, p) as AddInstrumentRequest;

export function blankAlternativeDraft(): AddBucketAlternativeRequest {
  return {
    name: "",
    isin: "",
    terBps: 0,
    domicile: "Ireland",
    replication: "Physical",
    distribution: "Accumulating",
    currency: "USD",
    comment: "",
    defaultExchange: "LSE",
    listings: {},
  };
}
