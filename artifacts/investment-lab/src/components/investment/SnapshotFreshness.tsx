import { RefreshCw } from "lucide-react";
import { useT } from "@/lib/i18n";
import { InfoHint } from "@/components/ui/info-hint";
import { getETFsSnapshotMeta } from "@/lib/etfs";
import {
  getLookthroughSnapshotMeta,
  topHoldingsStampFor,
  LOOKTHROUGH_REFERENCE_DATE,
} from "@/lib/lookthrough";
import { formatRefreshDate } from "@/lib/freshness";
import type { ETFImplementation } from "@/lib/types";

// Footer block shown beneath the ETF Implementation table. Surfaces the
// `_meta.lastRefreshed` and `_meta.lastRefreshedMode` written by the
// weekly + nightly refresh jobs (see scripts/refresh-justetf.mjs). Both
// cadences write to the same snapshot file, so a single timestamp covers
// both columns; the mode note tells the user which job ran most recently.
export function ETFSnapshotFreshness() {
  const { t, lang } = useT();
  const meta = getETFsSnapshotMeta();
  const dateStr = formatRefreshDate(meta.lastRefreshed, lang);

  if (!dateStr) {
    return (
      <div className="mt-3 flex items-start gap-2 text-[11px] text-muted-foreground">
        <RefreshCw className="h-3.5 w-3.5 mt-0.5 shrink-0" />
        <span>{t("build.impl.freshness.never")}</span>
      </div>
    );
  }

  const modeLabel =
    meta.lastRefreshedMode === "core"
      ? t("build.impl.freshness.mode.core")
      : meta.lastRefreshedMode === "listings"
      ? t("build.impl.freshness.mode.listings")
      : null;

  return (
    <div
      className="mt-3 flex flex-col gap-1 text-[11px] text-muted-foreground"
      data-testid="etf-snapshot-freshness"
    >
      <div className="flex items-center gap-2">
        <RefreshCw className="h-3.5 w-3.5 shrink-0" />
        <span className="font-semibold text-foreground">
          {t("build.impl.freshness.title")}
        </span>
        <InfoHint title={t("build.impl.freshness.title")}>
          {t("build.impl.freshness.help")}
        </InfoHint>
      </div>
      <div className="pl-5">
        {t("build.impl.freshness.coreFields").replace("{date}", dateStr)}
      </div>
      <div className="pl-5">
        {t("build.impl.freshness.listings").replace("{date}", dateStr)}
        {modeLabel && (
          <span className="ml-1 text-muted-foreground/80">
            {t("build.impl.freshness.modeNote").replace("{mode}", modeLabel)}
          </span>
        )}
      </div>
    </div>
  );
}

// Footer block for the Top 10 Holdings panel. Combines the file-level
// `_meta.lastRefreshed` (from lookthrough.overrides.json — written monthly)
// with each ETF's own `topHoldingsAsOf` per-ISIN stamp. Per-ISIN stamps win
// when present so users know exactly when the ETF behind a row was last
// scraped, not just when the script last ran.
export function TopHoldingsFreshness({ etfs }: { etfs: ETFImplementation[] }) {
  const { t, lang } = useT();
  const meta = getLookthroughSnapshotMeta();
  const fileDate = formatRefreshDate(meta.lastRefreshed, lang);

  // Deduplicate by ISIN — multiple buckets can reference the same underlying
  // basket (e.g. several share classes of the S&P 500).
  const seen = new Set<string>();
  const perEtf: Array<{ name: string; date: string | null; isin: string }> = [];
  for (const e of etfs) {
    if (!e.isin || e.isin === "—" || seen.has(e.isin)) continue;
    seen.add(e.isin);
    const stamp = topHoldingsStampFor(e.isin);
    perEtf.push({
      name: e.exampleETF,
      isin: e.isin,
      date: formatRefreshDate(stamp, lang),
    });
  }
  const perEtfWithStamp = perEtf.filter((row) => row.date !== null);

  return (
    <div
      className="text-xs text-muted-foreground space-y-1"
      data-testid="top-holdings-freshness"
    >
      {fileDate ? (
        <p>{t("build.top10.freshness.refreshed").replace("{date}", fileDate)}</p>
      ) : (
        <p>{t("build.top10.freshness.never")}</p>
      )}
      {perEtfWithStamp.length > 0 && (
        <details className="pl-1">
          <summary className="cursor-pointer text-muted-foreground/80 hover:text-foreground">
            {t("build.top10.freshness.perIsin")}
          </summary>
          <ul className="list-disc list-inside pl-2 mt-1 space-y-0.5">
            {perEtfWithStamp.map((row) => (
              <li key={row.isin}>
                <span className="font-mono">{row.isin}</span> — {row.name} · {row.date}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

// Small one-line stamp shown under the look-through breakdown to signal that
// the geo / sector / currency tables are hand-curated (Q4 2024 reference)
// and not refreshed from the snapshot, even though the rest of the app is.
export function LookthroughCuratedStamp() {
  const { t } = useT();
  return (
    <p
      className="text-[10px] text-muted-foreground italic"
      data-testid="lookthrough-curated-stamp"
    >
      {t("build.lookthrough.freshness.curated").replace(
        "{date}",
        LOOKTHROUGH_REFERENCE_DATE
      )}
    </p>
  );
}
