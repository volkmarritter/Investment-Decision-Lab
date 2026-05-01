// ----------------------------------------------------------------------------
// EtfInfoPreview — live preview card under the Explain manual-entry input.
// ----------------------------------------------------------------------------
// Renders whatever ETF metadata we can find for the typed ISIN, from three
// sources merged in this priority order (highest first):
//
//   1. catalogInstrument — the ETF lives in the curated catalog
//      (etfs.ts). Operator should normally use the picker for these, but
//      if they manually-enter a known ISIN we surface the catalog values
//      so they see what they'd get if they switched to the picker.
//
//   2. scrape — live justETF lookup via /api/etf-preview/:isin (debounced,
//      rate-limited, server-side cached). Authoritative for non-catalog
//      ETFs. Slightly slower (1-8s on cold cache).
//
//   3. pool — bundled lookthrough.overrides.json profile. Not used for
//      master-data fields (it doesn't track TER/AUM/etc.) but we surface
//      its presence as a separate banner: when pool data exists, the
//      manual position will already feed the look-through cards (Geo,
//      Sector, TopHoldings, HomeBias) — this is the most operationally
//      important fact for the operator to see before adding the row.
//
// "Use these values" copies scrape/catalog values into manualMeta — but
// only into fields the user hasn't explicitly set yet (no clobbering).
// ----------------------------------------------------------------------------

import { useMemo } from "react";
import { useT } from "@/lib/i18n";
import { useEtfInfo } from "@/lib/useEtfInfo";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, ExternalLink, Check } from "lucide-react";

export interface QuickFillValues {
  name?: string;
  currency?: string;
  terBps?: number;
}

export interface EtfInfoPreviewProps {
  isin: string;
  rowIndex: number;
  // Currently-set values on the row's manualMeta — used to know which
  // quick-fill targets are still empty (we never overwrite user input).
  currentName?: string;
  currentCurrency?: string;
  currentTerBps?: number;
  onQuickFill: (values: QuickFillValues) => void;
}

// Pull a number out of the scrape `fields` blob. Some scraper extractors
// emit TER as basis points (7 → 7 bps), others as percent (0.07 → 7 bps);
// AUM is millions of EUR. We accept both representations and normalize
// to the catalog convention (terBps = bps, aumMillionsEUR = millions).
function pickTerBps(fields: Record<string, unknown>): number | undefined {
  const bps = fields.terBps;
  if (typeof bps === "number" && Number.isFinite(bps)) return bps;
  const pct = fields.ter;
  if (typeof pct === "number" && Number.isFinite(pct)) {
    // Heuristic: <= 5 means percent (0.07 → 7 bps), > 5 means already bps.
    return pct <= 5 ? Math.round(pct * 100) : Math.round(pct);
  }
  return undefined;
}

function pickAumMillionsEUR(fields: Record<string, unknown>): number | undefined {
  const v = fields.aumMillionsEUR ?? fields.aum;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  return undefined;
}

function pickStr(...candidates: unknown[]): string | undefined {
  for (const c of candidates) {
    if (typeof c === "string" && c.trim().length > 0) return c.trim();
  }
  return undefined;
}

function fmtBps(bps: number | undefined): string {
  if (bps === undefined) return "—";
  return `${bps} bps · ${(bps / 100).toFixed(2)} %`;
}

function fmtAum(m: number | undefined): string {
  if (m === undefined) return "—";
  if (m >= 1000) return `${(m / 1000).toFixed(2)} bn EUR`;
  return `${m.toFixed(0)} M EUR`;
}

function fmtDate(s: string | undefined): string {
  return s ?? "—";
}

export function EtfInfoPreview({
  isin,
  rowIndex,
  currentName,
  currentCurrency,
  currentTerBps,
  onQuickFill,
}: EtfInfoPreviewProps) {
  const { lang } = useT();
  const de = lang === "de";
  const tx = (deStr: string, enStr: string) => (de ? deStr : enStr);
  const info = useEtfInfo(isin);

  // Merge view: catalog wins over scrape for master-data display, since
  // the catalog values are hand-curated. Scrape fills the gaps.
  const merged = useMemo(() => {
    const catalog = info.catalogInstrument;
    const fields = info.scrape?.fields ?? {};
    const scrapeTerBps = pickTerBps(fields);
    const scrapeAum = pickAumMillionsEUR(fields);
    return {
      name: pickStr(catalog?.name, fields.name),
      currency: pickStr(catalog?.currency, fields.currency),
      terBps: catalog?.terBps ?? scrapeTerBps,
      aumMillionsEUR: catalog?.aumMillionsEUR ?? scrapeAum,
      inceptionDate: pickStr(catalog?.inceptionDate, fields.inceptionDate),
      replication: pickStr(catalog?.replication, fields.replication),
      distribution: pickStr(catalog?.distribution, fields.distribution),
      domicile: pickStr(catalog?.domicile, fields.domicile),
    };
  }, [info.catalogInstrument, info.scrape]);

  // Quick-fill payload: only fields the user hasn't filled yet, drawn
  // from scrape/catalog. Returns undefined if nothing to fill.
  const quickFillPayload = useMemo<QuickFillValues | null>(() => {
    if (!merged.name && !merged.currency && merged.terBps === undefined) {
      return null;
    }
    const out: QuickFillValues = {};
    if (!currentName && merged.name) out.name = merged.name;
    if (!currentCurrency && merged.currency) out.currency = merged.currency;
    if (currentTerBps === undefined && merged.terBps !== undefined) {
      out.terBps = merged.terBps;
    }
    return Object.keys(out).length > 0 ? out : null;
  }, [merged, currentName, currentCurrency, currentTerBps]);

  if (!info.isValidIsin) return null;

  const hasMaster = !!(
    merged.name ||
    merged.currency ||
    merged.terBps !== undefined ||
    merged.aumMillionsEUR !== undefined ||
    merged.inceptionDate ||
    merged.replication ||
    merged.distribution ||
    merged.domicile
  );
  const hasPool = !!info.pool;

  return (
    <div
      className="rounded border bg-muted/20 p-2.5 space-y-2"
      data-testid={`etf-info-preview-${rowIndex}`}
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[11px] font-medium text-muted-foreground">
          {tx("ETF-Info", "ETF info")}
        </span>
        <code className="text-[11px] font-mono text-muted-foreground">
          {isin}
        </code>
        {info.catalogInstrument && (
          <Badge
            variant="outline"
            className="border-emerald-600 text-emerald-700 dark:text-emerald-400 text-[10px] px-1.5 py-0"
            data-testid={`etf-info-source-catalog-${rowIndex}`}
          >
            {tx("im Katalog", "in catalog")}
          </Badge>
        )}
        {hasPool && (
          <Badge
            variant="outline"
            className="border-sky-600 text-sky-700 dark:text-sky-400 text-[10px] px-1.5 py-0"
            data-testid={`etf-info-source-pool-${rowIndex}`}
          >
            {tx("Look-Through aus Pool", "look-through in pool")}
          </Badge>
        )}
        {info.scrapeLoading && (
          <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" />
            {tx("lade justETF …", "loading justETF …")}
          </span>
        )}
        {info.scrape?.sourceUrl && (
          <a
            href={info.scrape.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground hover:underline"
            data-testid={`etf-info-source-link-${rowIndex}`}
          >
            justETF
            <ExternalLink className="h-2.5 w-2.5" />
          </a>
        )}
      </div>

      {info.scrapeError && !info.catalogInstrument && !hasPool && (
        <Alert variant="destructive" className="py-2">
          <AlertTitle className="text-xs">
            {tx("Live-Lookup fehlgeschlagen", "Live lookup failed")}
          </AlertTitle>
          <AlertDescription className="text-[11px] break-words">
            {/* The hook returns a sentinel code for the malformed-payload
                case so it can be localized here; everything else (HTTP
                status / upstream message / network error) is already a
                human-readable string from the server or the browser. */}
            {info.scrapeError === "ETF_PREVIEW_MALFORMED"
              ? tx(
                  "Unerwartetes Antwortformat von /etf-preview.",
                  "Unexpected response format from /etf-preview.",
                )
              : info.scrapeError}
          </AlertDescription>
        </Alert>
      )}

      {hasMaster && (
        <div
          className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[11px]"
          data-testid={`etf-info-master-${rowIndex}`}
        >
          {merged.name && (
            <div className="col-span-2">
              <span className="text-muted-foreground">
                {tx("Name", "Name")}:
              </span>{" "}
              <span className="font-medium">{merged.name}</span>
            </div>
          )}
          {merged.currency && (
            <div>
              <span className="text-muted-foreground">
                {tx("Währung", "Currency")}:
              </span>{" "}
              <span className="font-mono">{merged.currency}</span>
            </div>
          )}
          {merged.terBps !== undefined && (
            <div>
              <span className="text-muted-foreground">TER:</span>{" "}
              <span className="font-mono tabular-nums">
                {fmtBps(merged.terBps)}
              </span>
            </div>
          )}
          {merged.aumMillionsEUR !== undefined && (
            <div>
              <span className="text-muted-foreground">AUM:</span>{" "}
              <span className="font-mono tabular-nums">
                {fmtAum(merged.aumMillionsEUR)}
              </span>
            </div>
          )}
          {merged.inceptionDate && (
            <div>
              <span className="text-muted-foreground">
                {tx("Auflage", "Inception")}:
              </span>{" "}
              <span className="font-mono">{fmtDate(merged.inceptionDate)}</span>
            </div>
          )}
          {merged.distribution && (
            <div>
              <span className="text-muted-foreground">
                {tx("Ausschüttung", "Distribution")}:
              </span>{" "}
              <span>{merged.distribution}</span>
            </div>
          )}
          {merged.replication && (
            <div>
              <span className="text-muted-foreground">
                {tx("Replikation", "Replication")}:
              </span>{" "}
              <span>{merged.replication}</span>
            </div>
          )}
          {merged.domicile && (
            <div>
              <span className="text-muted-foreground">
                {tx("Domizil", "Domicile")}:
              </span>{" "}
              <span className="font-mono">{merged.domicile}</span>
            </div>
          )}
        </div>
      )}

      {hasPool && info.pool && (
        <div
          className="text-[11px] text-muted-foreground space-y-0.5"
          data-testid={`etf-info-pool-${rowIndex}`}
        >
          <div>
            {tx("Diese Position fließt automatisch in Geo-/Sektor-/Top-Holdings-Karten ein:", "This position will automatically feed Geo / Sector / TopHoldings cards:")}
          </div>
          <div className="grid grid-cols-2 gap-x-3">
            <span>
              {Object.keys(info.pool.geo ?? {}).length}{" "}
              {tx("Regionen", "regions")} ·{" "}
              {Object.keys(info.pool.sector ?? {}).length}{" "}
              {tx("Sektoren", "sectors")}
            </span>
            <span>
              {info.pool.topHoldings?.length ?? 0}{" "}
              {tx("Top-Holdings", "top holdings")}
            </span>
            {info.pool.breakdownsAsOf && (
              <span>
                {tx("Breakdowns Stand:", "Breakdowns as of:")}{" "}
                <span className="font-mono">
                  {info.pool.breakdownsAsOf.slice(0, 10)}
                </span>
              </span>
            )}
            {info.pool.topHoldingsAsOf && (
              <span>
                {tx("Holdings Stand:", "Holdings as of:")}{" "}
                <span className="font-mono">
                  {info.pool.topHoldingsAsOf.slice(0, 10)}
                </span>
              </span>
            )}
          </div>
        </div>
      )}

      {!hasPool && !info.scrapeLoading && info.isValidIsin && (
        <div className="text-[11px] text-amber-700 dark:text-amber-400">
          {tx("Keine Look-Through-Daten im Pool — diese Position trägt 0 % zu Geo-/Sektor-/Top-Holdings-Karten und Home-Bias bei.", "No look-through data in pool — this position contributes 0 % to Geo / Sector / TopHoldings cards and Home-Bias.")}
        </div>
      )}

      {quickFillPayload && (
        <div className="pt-1 border-t border-dashed">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 text-[11px]"
            onClick={() => onQuickFill(quickFillPayload)}
            data-testid={`button-etf-info-quickfill-${rowIndex}`}
          >
            <Check className="h-3 w-3 mr-1" />
            {tx("Werte übernehmen", "Use these values")}
            <span className="ml-1 text-muted-foreground">
              ({Object.keys(quickFillPayload).join(", ")})
            </span>
          </Button>
        </div>
      )}
    </div>
  );
}
