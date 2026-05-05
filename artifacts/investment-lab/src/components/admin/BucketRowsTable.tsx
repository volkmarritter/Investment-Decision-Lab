// ----------------------------------------------------------------------------
// BucketRowsTable — the per-bucket table of [Default + Alternatives] with
// look-through columns. Pure presentational sub-component of the catalog
// tree.
// ----------------------------------------------------------------------------

import type {
  AlternativeEntrySummary,
  CatalogEntrySummary,
  LookthroughPoolEntry,
} from "@/lib/admin-api";
import { useAdminT } from "@/lib/admin-i18n";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { LookthroughStatusBadge, PoolSourceBadge } from "./badges";
import { AsOfCell } from "./shared";

export function BucketRowsTable({
  parentKey,
  defaultEntry,
  alternatives,
  poolByIsin,
  onRemoveAlt,
  githubConfigured,
}: {
  parentKey: string;
  defaultEntry: CatalogEntrySummary;
  alternatives: AlternativeEntrySummary[];
  poolByIsin: Map<string, LookthroughPoolEntry>;
  onRemoveAlt: (parentKey: string, isin: string, name: string) => void;
  githubConfigured: boolean;
}) {
  const { t, lang } = useAdminT();
  const rows: Array<{
    role: "default" | "alt";
    name: string;
    isin: string;
  }> = [
    { role: "default", name: defaultEntry.name, isin: defaultEntry.isin },
    ...alternatives.map((a) => ({
      role: "alt" as const,
      name: a.name,
      isin: a.isin,
    })),
  ];
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs" data-testid={`tree-table-${parentKey}`}>
        <thead className="text-muted-foreground">
          <tr className="text-left">
            <th className="px-2 py-1 font-medium w-20">
              {t({ de: "Rolle", en: "Role" })}
            </th>
            <th className="px-2 py-1 font-medium">ISIN</th>
            <th className="px-2 py-1 font-medium">
              {t({ de: "Name", en: "Name" })}
            </th>
            <th className="px-2 py-1 font-medium">
              {t({ de: "LT-Status", en: "LT status" })}
            </th>
            <th className="px-2 py-1 font-medium" title="Top / Geo / Sektor">
              T/G/S
            </th>
            <th className="px-2 py-1 font-medium">
              {t({ de: "Quelle", en: "Source" })}
            </th>
            <th className="px-2 py-1 font-medium">
              {t({ de: "Stand", en: "As of" })}
            </th>
            <th className="px-2 py-1 font-medium w-24"></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const lt = poolByIsin.get(r.isin.toUpperCase());
            return (
              <tr
                key={`${r.role}-${r.isin}`}
                className="border-t"
                data-testid={`tree-row-${parentKey}-${r.isin}`}
              >
                <td className="px-2 py-1">
                  <Badge
                    variant="outline"
                    className={
                      r.role === "default"
                        ? "border-primary text-primary"
                        : "border-slate-500 text-slate-700 dark:text-slate-300"
                    }
                  >
                    {r.role === "default"
                      ? t({ de: "Default", en: "Default" })
                      : t({ de: "Alt", en: "Alt" })}
                  </Badge>
                </td>
                <td className="px-2 py-1 font-mono">{r.isin}</td>
                <td className="px-2 py-1">
                  <span className="truncate inline-block max-w-[36ch]" title={r.name}>
                    {r.name}
                  </span>
                </td>
                <td className="px-2 py-1">
                  <LookthroughStatusBadge entry={lt} />
                </td>
                <td className="px-2 py-1 font-mono">
                  {lt
                    ? `${lt.topHoldingCount}/${lt.geoCount}/${lt.sectorCount}`
                    : "—"}
                </td>
                <td className="px-2 py-1">
                  <PoolSourceBadge entry={lt} />
                </td>
                <td className="px-2 py-1 text-muted-foreground">
                  <AsOfCell
                    value={lt?.topHoldingsAsOf || lt?.breakdownsAsOf}
                  />
                </td>
                <td className="px-2 py-1 text-right">
                  {r.role === "alt" && githubConfigured && (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => onRemoveAlt(parentKey, r.isin, r.name)}
                      className="h-7 px-2 text-xs text-rose-700 hover:text-rose-800 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-950"
                      data-testid={`button-tree-remove-alt-${parentKey}-${r.isin}`}
                    >
                      {t({ de: "Entfernen", en: "Remove" })}
                    </Button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
