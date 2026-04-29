import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Coins, ChevronDown, ChevronUp } from "lucide-react";
import { ETFImplementation, BaseCurrency } from "@/lib/types";
import { buildLookthrough } from "@/lib/lookthrough";
import { useT } from "@/lib/i18n";

interface Props {
  etfs: ETFImplementation[];
  baseCurrency: BaseCurrency;
  /** When false, the unhedged-currency split falls back to each ETF's own
   *  share-class currency (no look-through into the underlying holdings).
   *  Defaults to true so existing callers keep the look-through view. */
  lookThroughView?: boolean;
}

export function CurrencyOverview({ etfs, baseCurrency, lookThroughView = true }: Props) {
  const { t, lang } = useT();
  const { currencyOverview: r } = buildLookthrough(etfs, lang, baseCurrency, {
    useLookThroughCurrency: lookThroughView,
  });
  const [open, setOpen] = useState(false);
  const baseShare = (r.rows.find((x) => x.currency === r.baseCurrency)?.pctOfPortfolio ?? 0).toFixed(1);
  const modeLabel = lookThroughView ? t("build.fx.mode.lookthrough") : t("build.fx.mode.etfOnly");
  const disclaimer = lookThroughView ? t("build.fx.disclaimer") : t("build.fx.disclaimer.etfOnly");

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
          <div className="flex-1">
            <CardTitle className="flex items-center gap-2 flex-wrap">
              <Coins className="h-5 w-5" />
              <span>{t("build.fx.title")}</span>
              <span
                className={
                  "text-[10px] uppercase tracking-wide font-medium px-1.5 py-0.5 rounded border " +
                  (lookThroughView
                    ? "border-emerald-500/40 text-emerald-700 dark:text-emerald-300 bg-emerald-50/60 dark:bg-emerald-500/10"
                    : "border-amber-500/40 text-amber-700 dark:text-amber-300 bg-amber-50/60 dark:bg-amber-500/10")
                }
                data-testid="fx-mode-badge"
                data-mode={lookThroughView ? "lookthrough" : "etfOnly"}
              >
                {modeLabel}
              </span>
              <span className="text-xs text-muted-foreground font-normal">
                {r.baseCurrency} {baseShare}% · {t("build.fx.summary.hedgedShare")}: {r.hedgedShareOfPortfolio.toFixed(1)}%
              </span>
            </CardTitle>
            <CardDescription className="mt-2">
              {t("build.fx.desc").replace("{base}", r.baseCurrency)}
            </CardDescription>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={() => setOpen((o) => !o)} className="shrink-0">
            {open ? <><ChevronUp className="h-4 w-4 mr-1" /> {t("build.homeBias.collapse")}</> : <><ChevronDown className="h-4 w-4 mr-1" /> {t("build.homeBias.expand")}</>}
          </Button>
        </div>
      </CardHeader>
      {open && (
      <CardContent className="space-y-4">
        <div className="rounded-md border overflow-x-auto">
          <Table className="text-xs">
            <TableHeader>
              <TableRow>
                <TableHead>{t("build.fx.col.currency")}</TableHead>
                <TableHead className="text-right">{t("build.fx.col.total")}</TableHead>
                <TableHead className="text-right">{t("build.fx.col.unhedged")}</TableHead>
                <TableHead className="text-right">{t("build.fx.col.hedged")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {r.rows.map((row) => (
                <TableRow key={row.currency}>
                  <TableCell className="font-medium">
                    {row.currency}
                    {row.currency === r.baseCurrency && (
                      <span className="ml-2 text-[10px] text-muted-foreground">
                        ({t("build.fx.base")})
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-right font-mono">{row.pctOfPortfolio.toFixed(1)}%</TableCell>
                  <TableCell className="text-right font-mono">{row.unhedgedPct.toFixed(1)}%</TableCell>
                  <TableCell className="text-right font-mono">{row.hedgedPct.toFixed(1)}%</TableCell>
                </TableRow>
              ))}
              {r.unmappedWeight > 0 && (
                <TableRow>
                  <TableCell className="text-muted-foreground italic">{t("build.fx.unmapped")}</TableCell>
                  <TableCell className="text-right font-mono">{r.unmappedWeight.toFixed(1)}%</TableCell>
                  <TableCell className="text-right font-mono">—</TableCell>
                  <TableCell className="text-right font-mono">—</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs text-muted-foreground">
          <div className="rounded-md border p-3">
            <div className="font-semibold text-foreground">{t("build.fx.summary.hedgedShare")}</div>
            <div className="font-mono text-base mt-1">{r.hedgedShareOfPortfolio.toFixed(1)}%</div>
            <div className="mt-1">{t("build.fx.summary.hedgedShareDesc")}</div>
          </div>
          <div className="rounded-md border p-3">
            <div className="font-semibold text-foreground">
              {t("build.fx.summary.baseShare").replace("{base}", r.baseCurrency)}
            </div>
            <div className="font-mono text-base mt-1">
              {(r.rows.find((x) => x.currency === r.baseCurrency)?.pctOfPortfolio ?? 0).toFixed(1)}%
            </div>
            <div className="mt-1">
              {t("build.fx.summary.baseShareDesc").replace("{base}", r.baseCurrency)}
            </div>
          </div>
        </div>
        <p className="text-[10px] text-muted-foreground italic" data-testid="fx-disclaimer">{disclaimer}</p>
      </CardContent>
      )}
    </Card>
  );
}
