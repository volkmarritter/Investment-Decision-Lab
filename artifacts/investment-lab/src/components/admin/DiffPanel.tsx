// ----------------------------------------------------------------------------
// DiffPanel — contextual replace-vs-add panel rendered above the submit
// button in the SuggestIsinPanel's PreviewEditor.
// ----------------------------------------------------------------------------

import { useMemo } from "react";
import type { AddEtfRequest } from "@/lib/admin-api";
import type { ClassifyResult } from "@/lib/catalog-classify";
import { useAdminT } from "@/lib/admin-i18n";
import { Badge } from "@/components/ui/badge";
import { GeneratedCodeDisclosure } from "./GeneratedCodeDisclosure";

export function DiffPanel({
  classification,
  draft,
}: {
  classification: ClassifyResult | null;
  draft: AddEtfRequest;
}) {
  const { t, lang } = useAdminT();
  if (!classification) {
    return (
      <div className="text-xs text-muted-foreground" data-testid="diff-panel-loading">
        {t({ de: "Katalog wird geladen …", en: "Loading catalog …" })}
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
          <Badge variant="destructive">
            {t({ de: "Doppelte ISIN", en: "Duplicate ISIN" })}
          </Badge>
          <span className="text-sm">
            {lang === "de" ? (
              <>
                Diese ISIN wird bereits von{" "}
                <code className="font-mono text-xs">
                  {classification.conflictKey}
                </code>{" "}
                verwendet.
              </>
            ) : (
              <>
                This ISIN is already used by{" "}
                <code className="font-mono text-xs">
                  {classification.conflictKey}
                </code>
                .
              </>
            )}
          </span>
        </div>
        <p className="text-xs text-muted-foreground">
          {lang === "de" ? (
            <>
              Bestehender Eintrag: <strong>{classification.conflict.name}</strong>{" "}
              ({classification.conflict.isin}). Vor dem Pull Request die ISIN ändern —
              oder den Katalog-Key auf <code>{classification.conflictKey}</code>{" "}
              setzen, um den bestehenden Eintrag zu ersetzen.
            </>
          ) : (
            <>
              Existing entry: <strong>{classification.conflict.name}</strong>{" "}
              ({classification.conflict.isin}). Either change the ISIN before
              opening the Pull Request, or set the catalog key to{" "}
              <code>{classification.conflictKey}</code> to replace the existing
              entry.
            </>
          )}
        </p>
        {/* Still expose the generated TS even while the Pull Request is blocked,
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
            {t({ de: "Neuer Bucket", en: "New bucket" })}
          </Badge>
          <span className="text-sm">
            <code className="font-mono text-xs">
              {draft.key || t({ de: "(kein Key)", en: "(no key)" })}
            </code>{" "}
            {t({
              de: "existiert noch nicht — dieser Pull Request legt einen neuen Eintrag an.",
              en: "does not exist yet — this Pull Request adds a new entry.",
            })}
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
          {t({
            de: "Ersetzt bestehenden Eintrag",
            en: "Replaces existing entry",
          })}
        </Badge>
        <span className="text-sm">
          <code className="font-mono text-xs">{draft.key}</code>{" "}
          {t({
            de: "existiert bereits im Katalog. Diff bitte vor dem Öffnen des Pull Requests prüfen.",
            en: "already exists in the catalog. Please review the diff before opening the Pull Request.",
          })}
        </span>
      </div>
      <SideBySideDiff existing={classification.existing} draft={draft} />
      <GeneratedCodeDisclosure draft={draft} />
    </div>
  );
}

// Fixed list of fields, in the same order the renderer emits them, so the
// table mirrors what the Pull Request diff will look like.
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
  const { t } = useAdminT();
  const rows = useMemo(() => buildDiffRows(existing, draft), [existing, draft]);
  return (
    <div className="overflow-x-auto" data-testid="diff-table">
      <table className="text-xs w-full border-collapse">
        <thead>
          <tr className="text-left border-b">
            <th className="py-1 pr-2 font-medium w-32">
              {t({ de: "Feld", en: "Field" })}
            </th>
            <th className="py-1 pr-2 font-medium">
              {t({
                de: "Aktuell (im Katalog)",
                en: "Current (in catalog)",
              })}
            </th>
            <th className="py-1 pr-2 font-medium">
              {t({
                de: "Vorgeschlagen (dieser Pull Request)",
                en: "Proposed (this Pull Request)",
              })}
            </th>
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
        {t({
          de: 'Hinweis: aumMillionsEUR und inceptionDate liegen in der Override-Schicht (nächtlicher Refresh), nicht im statischen Katalog — die Spalte „Aktuell" zeigt „—", wenn nicht manuell gepflegt.',
          en: "Note: aumMillionsEUR and inceptionDate live in the override layer (nightly refresh), not the static catalog — the 'Current' column shows '—' when not manually maintained.",
        })}
      </p>
    </div>
  );
}
