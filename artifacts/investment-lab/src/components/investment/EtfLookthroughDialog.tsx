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
import { Separator } from "@/components/ui/separator";
import {
  profileFor,
  topHoldingsStampFor,
  breakdownsStampFor,
  LOOKTHROUGH_REFERENCE_DATE,
} from "@/lib/lookthrough";
import { useT } from "@/lib/i18n";
import { useAdminT } from "@/lib/admin-i18n";
import { describeEtf } from "@/lib/etfDescription";
import { ExposureList, sortedTop, formatStamp } from "./ETFDetailsDialog";

interface EtfLookthroughDialogProps {
  isin: string | null;
  name?: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function justEtfUrl(isin: string, lang: string): string {
  const locale = lang === "de" ? "de" : "en";
  return `https://www.justetf.com/${locale}/etf-profile.html?isin=${encodeURIComponent(isin)}`;
}

// Admin-side variant of ETFDetailsDialog. Same look-through detail layout
// (geo / sector / currency / top holdings) and same justETF deep-link, but
// without the catalog-only quick-facts grid (TER, Domizil, Replikation,
// Aussch/Thes, Gewicht). The latter requires a full ETFImplementation —
// which we don't have on Admin's "Pool-only" rows: those entries exist
// only in lookthrough.overrides.json (or its `pool` section), with just an
// ISIN + an optional scraped name. The look-through grid only needs the
// ISIN, so it's the right reusable surface for "what data do we already
// have on this ISIN" without faking a stub catalog row.
export function EtfLookthroughDialog({
  isin,
  name,
  open,
  onOpenChange,
}: EtfLookthroughDialogProps) {
  const { t, lang } = useT();
  const { t: adminT } = useAdminT();

  if (!isin) return null;

  const profile = profileFor(isin);
  const geoRows = sortedTop(profile?.geo);
  const sectorRows = sortedTop(profile?.sector);
  const ccyRows = sortedTop(profile?.currency, 8);
  const topHoldings = profile?.topHoldings ?? [];
  const topStamp = topHoldingsStampFor(isin);
  const breakdownsStamp = breakdownsStampFor(isin);
  // Pool-only / look-through-only ETFs have no curated `comment`, so we
  // always fall back to the auto-generated description here. Returns null
  // if the profile isn't rich enough to say anything useful — in which
  // case we render nothing rather than a vacuous placeholder.
  const autoDescription = describeEtf({
    name: name?.trim() || isin,
    profile,
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-3xl max-h-[85vh] flex flex-col p-0 gap-0"
        data-testid="admin-etf-lookthrough-dialog"
      >
        <DialogHeader className="p-6 pb-3 space-y-2">
          <div className="min-w-0">
            <DialogTitle className="text-base">
              {/* Trim defends against scraper edge cases where the
                  persisted `name` is a whitespace-only string — would
                  otherwise render an empty title and leave the dialog
                  looking unlabelled. */}
              {name?.trim() ? name.trim() : isin}
            </DialogTitle>
            <DialogDescription className="font-mono text-xs mt-1">
              {isin}
            </DialogDescription>
          </div>
          {profile && (
            <div
              className="flex items-center gap-1.5 text-[11px] text-muted-foreground"
              data-testid="admin-etf-lookthrough-asof"
            >
              <CalendarClock className="h-3 w-3 shrink-0" aria-hidden="true" />
              <span>
                {t("etf.details.asof.label")}{" "}
                <span className="font-medium text-foreground/80">
                  {breakdownsStamp
                    ? formatStamp(breakdownsStamp)
                    : LOOKTHROUGH_REFERENCE_DATE}
                </span>
                {topHoldings.length > 0 && (
                  <>
                    {" · "}
                    {t("etf.details.asof.holdings")}{" "}
                    <span className="font-medium text-foreground/80">
                      {topStamp
                        ? formatStamp(topStamp)
                        : LOOKTHROUGH_REFERENCE_DATE}
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
          data-testid="admin-etf-lookthrough-scroll"
        >
          <div className="space-y-5 py-4">
            {autoDescription && (
              <div
                className="space-y-1 border-l-2 border-muted pl-3"
                data-testid="admin-etf-lookthrough-auto-description"
              >
                <div className="text-xs text-muted-foreground italic">
                  {lang === "de" ? autoDescription.de : autoDescription.en}
                </div>
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground/70">
                  {t("etf.details.autoDescriptionHint")}
                </div>
              </div>
            )}
            {profile ? (
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
            ) : (
              <>
                <div className="text-xs text-muted-foreground italic">
                  {t("etf.details.noProfile")}
                </div>
                <Separator />
                <div className="text-xs text-muted-foreground">
                  {adminT({
                    de: "Hinweis: Das Frontend bündelt die Look-through-Daten zur Build-Zeit. Pool-Einträge aus einem noch nicht gemergten PR sind hier erst nach dem nächsten Deploy sichtbar.",
                    en: "Note: the frontend bundles look-through data at build time. Pool entries from a PR that hasn't been merged yet only become visible here after the next deploy.",
                  })}
                </div>
              </>
            )}
          </div>
        </div>

        <DialogFooter className="p-4 gap-2 sm:justify-between">
          <span className="text-[10px] text-muted-foreground italic self-center">
            {t("etf.details.justetfDisclaimer")}
          </span>
          <Button
            asChild
            variant="outline"
            size="sm"
            data-testid="admin-etf-lookthrough-justetf-link"
          >
            <a
              href={justEtfUrl(isin, lang)}
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
