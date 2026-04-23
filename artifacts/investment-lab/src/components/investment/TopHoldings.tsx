import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Trophy, Info, ChevronDown, ChevronUp } from "lucide-react";
import { ETFImplementation, BaseCurrency } from "@/lib/types";
import { buildLookthrough, LOOKTHROUGH_REFERENCE_DATE } from "@/lib/lookthrough";
import { useT } from "@/lib/i18n";

interface Props {
  etfs: ETFImplementation[];
  baseCurrency: BaseCurrency;
}

export function TopHoldings({ etfs, baseCurrency }: Props) {
  const { t, lang } = useT();
  const r = buildLookthrough(etfs, lang, baseCurrency);
  const [open, setOpen] = useState(false);
  const topName = r.topConcentrations[0]?.name;
  const topPct = r.topConcentrations[0]?.pctOfPortfolio.toFixed(2);

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
          <div className="flex-1">
            <CardTitle className="flex items-center gap-2 flex-wrap">
              <Trophy className="h-5 w-5" />
              <span>{t("build.top10.title")}</span>
              {topName && (
                <span className="text-xs text-muted-foreground font-normal">
                  #1 {topName} · {topPct}%
                </span>
              )}
            </CardTitle>
            <CardDescription className="mt-2">{t("build.top10.desc")}</CardDescription>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={() => setOpen((o) => !o)} className="shrink-0">
            {open ? <><ChevronUp className="h-4 w-4 mr-1" /> {t("build.homeBias.collapse")}</> : <><ChevronDown className="h-4 w-4 mr-1" /> {t("build.homeBias.expand")}</>}
          </Button>
        </div>
      </CardHeader>
      {open && (
      <CardContent className="space-y-4">
        {r.topConcentrations.length === 0 ? (
          <p className="text-sm text-muted-foreground italic">{t("build.top10.empty")}</p>
        ) : (
          <div className="rounded-md border overflow-x-auto">
            <Table className="text-xs">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">#</TableHead>
                  <TableHead>{t("build.lookthrough.col.holding")}</TableHead>
                  <TableHead className="text-right">{t("build.lookthrough.col.pctPortfolio")}</TableHead>
                  <TableHead className="text-right">{t("build.top10.col.pctEquity")}</TableHead>
                  <TableHead>{t("build.lookthrough.col.source")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {r.topConcentrations.map((h, i) => (
                  <TableRow key={h.name}>
                    <TableCell className="font-mono text-muted-foreground">{i + 1}</TableCell>
                    <TableCell className="font-medium">{h.name}</TableCell>
                    <TableCell className="text-right font-mono">{h.pctOfPortfolio.toFixed(2)}%</TableCell>
                    <TableCell className="text-right font-mono">
                      {r.equityWeightTotal > 0
                        ? ((h.pctOfPortfolio / r.equityWeightTotal) * 100).toFixed(2)
                        : "—"}
                      %
                    </TableCell>
                    <TableCell className="text-muted-foreground">{h.source}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-muted-foreground space-y-2">
          <div className="font-semibold text-foreground flex items-center gap-2">
            <Info className="h-3.5 w-3.5" /> {t("build.top10.transparency.title")}
          </div>
          <p>
            {t("build.top10.transparency.dataDate").replace("{date}", LOOKTHROUGH_REFERENCE_DATE)}
          </p>
          <p>{t("build.top10.transparency.differences")}</p>
          <ul className="list-disc list-inside pl-2 space-y-1">
            <li>{t("build.top10.transparency.reason.mix")}</li>
            <li>{t("build.top10.transparency.reason.region")}</li>
            <li>{t("build.top10.transparency.reason.tilt")}</li>
            <li>{t("build.top10.transparency.reason.date")}</li>
          </ul>
          <p>{t("build.top10.transparency.action")}</p>
        </div>
      </CardContent>
      )}
    </Card>
  );
}
