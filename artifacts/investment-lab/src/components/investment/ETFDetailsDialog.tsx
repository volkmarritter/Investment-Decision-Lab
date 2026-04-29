import { ExternalLink, CalendarClock } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ETFImplementation } from "@/lib/types";
import {
  profileFor,
  topHoldingsStampFor,
  breakdownsStampFor,
  LOOKTHROUGH_REFERENCE_DATE,
  type ExposureMap,
} from "@/lib/lookthrough";
import { useT } from "@/lib/i18n";
import { describeEtf } from "@/lib/etfDescription";

interface ETFDetailsDialogProps {
  etf: ETFImplementation | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function justEtfUrl(isin: string, lang: string): string {
  const locale = lang === "de" ? "de" : "en";
  return `https://www.justetf.com/${locale}/etf-profile.html?isin=${encodeURIComponent(isin)}`;
}

export function formatStamp(stamp: string): string {
  // Stamp may be a full ISO timestamp ("2026-04-24T19:43:14.034Z") written by
  // scripts/refresh-lookthrough.mjs, or a curated label like "Q4 2024".
  // For ISO timestamps, show only the YYYY-MM-DD date — the time-of-day is
  // noise for UI consumers and clutters the header line.
  const isoDateMatch = stamp.match(/^(\d{4}-\d{2}-\d{2})T/);
  return isoDateMatch ? isoDateMatch[1] : stamp;
}

export function sortedTop(map: ExposureMap | undefined, n = 12): Array<[string, number]> {
  if (!map) return [];
  return Object.entries(map)
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n);
}

export function ExposureList({
  title,
  rows,
  emptyLabel,
}: {
  title: string;
  rows: Array<[string, number]>;
  emptyLabel: string;
}) {
  return (
    <div className="space-y-1.5">
      <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
        {title}
      </div>
      {rows.length === 0 ? (
        <div className="text-xs text-muted-foreground italic">{emptyLabel}</div>
      ) : (
        <ul className="space-y-1">
          {rows.map(([label, pct]) => (
            <li key={label} className="flex items-center gap-2 text-xs">
              <div className="flex-1 truncate">{label}</div>
              <div className="w-24 h-1.5 rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full bg-primary/70"
                  style={{ width: `${Math.min(100, pct)}%` }}
                />
              </div>
              <div className="w-10 text-right font-mono tabular-nums">
                {pct.toFixed(1)}%
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function ETFDetailsDialog({ etf, open, onOpenChange }: ETFDetailsDialogProps) {
  const { t, lang } = useT();

  if (!etf) return null;

  const profile = profileFor(etf.isin);
  const geoRows = sortedTop(profile?.geo);
  const sectorRows = sortedTop(profile?.sector);
  const ccyRows = sortedTop(profile?.currency, 8);
  const topHoldings = profile?.topHoldings ?? [];
  const topStamp = topHoldingsStampFor(etf.isin);
  const breakdownsStamp = breakdownsStampFor(etf.isin);
  // Curated `comment` always wins. Only compute the auto-generated fallback
  // when the catalog row left the field blank — keeps the work behind the
  // helper out of the hot path for the (common) curated case.
  const hasCuratedComment = Boolean(etf.comment && etf.comment.trim());
  const autoDescription = hasCuratedComment
    ? null
    : describeEtf({
        name: etf.exampleETF,
        profile,
        catalog: {
          domicile: etf.domicile,
          distribution: etf.distribution,
          currency: etf.currency,
        },
      });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-3xl max-h-[85vh] flex flex-col p-0 gap-0"
        data-testid="etf-details-dialog"
      >
        <DialogHeader className="p-6 pb-3 space-y-2">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <DialogTitle className="text-base">{etf.exampleETF}</DialogTitle>
              <DialogDescription className="font-mono text-xs mt-1">
                {etf.isin}
                {etf.ticker && etf.ticker !== "—" && (
                  <span className="ml-2">
                    · {etf.ticker}
                    {etf.exchange && etf.exchange !== "—" && ` (${etf.exchange})`}
                  </span>
                )}
              </DialogDescription>
            </div>
            <Badge variant="outline" className="shrink-0">
              {etf.assetClass}
            </Badge>
          </div>
          {profile && (
            <div
              className="flex items-center gap-1.5 text-[11px] text-muted-foreground"
              data-testid="etf-details-asof"
            >
              <CalendarClock className="h-3 w-3 shrink-0" aria-hidden="true" />
              <span>
                {t("etf.details.asof.label")}{" "}
                <span className="font-medium text-foreground/80">
                  {breakdownsStamp ? formatStamp(breakdownsStamp) : LOOKTHROUGH_REFERENCE_DATE}
                </span>
                {topHoldings.length > 0 && (
                  <>
                    {" · "}
                    {t("etf.details.asof.holdings")}{" "}
                    <span className="font-medium text-foreground/80">
                      {topStamp ? formatStamp(topStamp) : LOOKTHROUGH_REFERENCE_DATE}
                    </span>
                  </>
                )}
                {!breakdownsStamp && (
                  <span className="ml-1 italic">
                    ({t("etf.details.asof.curated")})
                  </span>
                )}
              </span>
            </div>
          )}
        </DialogHeader>

        <div
          className="flex-1 min-h-0 overflow-y-auto px-6 border-t border-b"
          data-testid="etf-details-scroll"
        >
          <div className="space-y-5 py-4">
            {/* Quick facts grid */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-2 text-xs">
              <FactCell label={t("build.impl.col.ter")}>
                {(etf.terBps / 100).toFixed(2)}%
              </FactCell>
              <FactCell label={t("build.impl.col.domicile")}>{etf.domicile}</FactCell>
              <FactCell label={t("build.impl.col.replication")}>
                {etf.replication}
              </FactCell>
              <FactCell label={t("build.impl.col.distribution")}>
                {etf.distribution === "Accumulating"
                  ? t("build.impl.dist.acc")
                  : t("build.impl.dist.dist")}
              </FactCell>
              <FactCell label={t("build.impl.col.currency")}>{etf.currency}</FactCell>
              <FactCell label={t("etf.details.weight")}>
                {etf.weight.toFixed(2)}%
              </FactCell>
            </div>

            {hasCuratedComment ? (
              <div
                className="text-xs text-muted-foreground border-l-2 border-muted pl-3 italic"
                data-testid="etf-details-curated-comment"
              >
                {etf.comment}
              </div>
            ) : autoDescription ? (
              <div
                className="space-y-1 border-l-2 border-muted pl-3"
                data-testid="etf-details-auto-description"
              >
                <div className="text-xs text-muted-foreground italic">
                  {lang === "de" ? autoDescription.de : autoDescription.en}
                </div>
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground/70">
                  {t("etf.details.autoDescriptionHint")}
                </div>
              </div>
            ) : null}

            <Separator />

            {/* Look-through */}
            {profile ? (
              <>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                  <ExposureList
                    title={t("etf.details.geo")}
                    rows={geoRows}
                    emptyLabel={t("etf.details.noData")}
                  />
                  <ExposureList
                    title={t("etf.details.sector")}
                    rows={sectorRows}
                    emptyLabel={
                      profile.isEquity
                        ? t("etf.details.noData")
                        : t("etf.details.notEquity")
                    }
                  />
                  <ExposureList
                    title={t("etf.details.currency")}
                    rows={ccyRows}
                    emptyLabel={t("etf.details.noData")}
                  />
                  <div className="space-y-1.5">
                    <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                      {t("etf.details.topHoldings")}
                    </div>
                    {topHoldings.length === 0 ? (
                      <div className="text-xs text-muted-foreground italic">
                        {t("etf.details.noTopHoldings")}
                      </div>
                    ) : (
                      <ul className="space-y-1">
                        {topHoldings.slice(0, 10).map((h) => (
                          <li
                            key={h.name}
                            className="flex items-center justify-between gap-2 text-xs"
                          >
                            <span className="truncate">{h.name}</span>
                            <span className="font-mono tabular-nums text-muted-foreground">
                              {h.pct.toFixed(2)}%
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>

              </>
            ) : (
              <div className="text-xs text-muted-foreground italic">
                {t("etf.details.noProfile")}
              </div>
            )}
          </div>
        </div>

        <DialogFooter className="p-4 gap-2 sm:justify-between">
          <span className="text-[10px] text-muted-foreground italic self-center">
            {t("etf.details.justetfDisclaimer")}
          </span>
          <Button asChild variant="outline" size="sm" data-testid="etf-details-justetf-link">
            <a
              href={justEtfUrl(etf.isin, lang)}
              target="_blank"
              rel="noopener noreferrer"
            >
              <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
              {t("etf.details.openJustetf")}
            </a>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function FactCell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-0.5">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="font-medium">{children}</div>
    </div>
  );
}
