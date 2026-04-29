// ----------------------------------------------------------------------------
// badges.tsx — small presentational helpers shared by the consolidated tree
// and the unclassified-row view: status of look-through data per pool entry,
// and the source provenance (curated / auto-refresh / both).
// ----------------------------------------------------------------------------

import type { LookthroughPoolEntry } from "@/lib/admin-api";
import { useAdminT } from "@/lib/admin-i18n";
import { Badge } from "@/components/ui/badge";

export type PoolStatusTone = "ok" | "stale" | "missing";
export type PoolStatus = { tone: PoolStatusTone };

// Pool status heuristic: an entry is "ok" when all three sources
// (top-holdings, geo breakdown, sectors) are populated AND the most
// recent scrape is younger than 60 days. Older → "stale". At least
// one source empty → "missing". Lets the operator see at a glance
// which pool entries need manual attention.
export function computePoolStatus(e: LookthroughPoolEntry): PoolStatus {
  const hasAll = e.topHoldingCount > 0 && e.geoCount > 0 && e.sectorCount > 0;
  if (!hasAll) return { tone: "missing" };
  const asOf = e.topHoldingsAsOf || e.breakdownsAsOf;
  if (!asOf) return { tone: "stale" };
  const ts = Date.parse(asOf);
  if (Number.isNaN(ts)) return { tone: "stale" };
  const ageDays = (Date.now() - ts) / (1000 * 60 * 60 * 24);
  if (ageDays > 60) return { tone: "stale" };
  return { tone: "ok" };
}

export function poolStatusLabel(
  tone: PoolStatusTone,
  lang: "de" | "en",
): string {
  if (tone === "ok") return lang === "de" ? "Daten OK" : "Data OK";
  if (tone === "stale") return lang === "de" ? "Veraltet" : "Stale";
  return lang === "de" ? "Daten fehlen" : "Data missing";
}

export function LookthroughStatusBadge({
  entry,
}: {
  entry: LookthroughPoolEntry | undefined;
}) {
  const { t, lang } = useAdminT();
  if (!entry) {
    return (
      <Badge
        variant="outline"
        className="border-rose-600/40 text-rose-700 dark:text-rose-400"
      >
        {t({ de: "Keine LT-Daten", en: "No LT data" })}
      </Badge>
    );
  }
  const status = computePoolStatus(entry);
  return (
    <Badge
      variant="outline"
      className={
        status.tone === "ok"
          ? "border-emerald-600 text-emerald-700 dark:text-emerald-400"
          : status.tone === "stale"
            ? "border-amber-600 text-amber-700 dark:text-amber-400"
            : "border-rose-600 text-rose-700 dark:text-rose-400"
      }
    >
      {poolStatusLabel(status.tone, lang)}
    </Badge>
  );
}

export function PoolSourceBadge({
  entry,
}: {
  entry: LookthroughPoolEntry | undefined;
}) {
  const { t } = useAdminT();
  if (!entry) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }
  return (
    <Badge
      variant="outline"
      className={
        entry.source === "pool"
          ? "border-sky-600 text-sky-700 dark:text-sky-400"
          : entry.source === "both"
            ? "border-violet-600 text-violet-700 dark:text-violet-400"
            : "border-slate-500 text-slate-700 dark:text-slate-400"
      }
    >
      {entry.source === "pool"
        ? t({ de: "Auto-Refresh", en: "Auto-refresh" })
        : entry.source === "both"
          ? t({ de: "Beide", en: "Both" })
          : t({ de: "Kuratiert", en: "Curated" })}
    </Badge>
  );
}
