import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Telescope, Info, Coins, Trophy } from "lucide-react";
import { ETFImplementation } from "@/lib/types";
import { buildLookthrough, LOOKTHROUGH_REFERENCE_DATE } from "@/lib/lookthrough";
import { useT } from "@/lib/i18n";

interface Props {
  etfs: ETFImplementation[];
  baseCurrency: string;
}

export function LookThroughAnalysis({ etfs, baseCurrency }: Props) {
  const { t, lang } = useT();
  const result = buildLookthrough(etfs, lang, baseCurrency);

  const renderRows = (rows: Array<[string, number]>, max = 10) =>
    rows.slice(0, max).map(([k, v]) => (
      <TableRow key={k}>
        <TableCell>{k}</TableCell>
        <TableCell className="text-right font-mono">{v.toFixed(1)}%</TableCell>
      </TableRow>
    ));

  return (
    <div className="space-y-6">
      {/* Card: Look-Through breakdowns */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Telescope className="h-5 w-5" /> {t("build.lookthrough.title")}
          </CardTitle>
          <CardDescription>{t("build.lookthrough.desc")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {result.geoEquity.length > 0 && (
              <div>
                <h4 className="text-sm font-semibold mb-2">
                  {t("build.lookthrough.geoEquity")}{" "}
                  <span className="text-xs text-muted-foreground font-normal">
                    ({result.equityWeightTotal.toFixed(0)}% {t("build.lookthrough.ofPortfolio")})
                  </span>
                </h4>
                <div className="rounded-md border">
                  <Table className="text-xs">
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t("build.lookthrough.col.country")}</TableHead>
                        <TableHead className="text-right">{t("build.lookthrough.col.share")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>{renderRows(result.geoEquity)}</TableBody>
                  </Table>
                </div>
              </div>
            )}

            {result.sectorEquity.length > 0 && (
              <div>
                <h4 className="text-sm font-semibold mb-2">{t("build.lookthrough.sectorEquity")}</h4>
                <div className="rounded-md border">
                  <Table className="text-xs">
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t("build.lookthrough.col.sector")}</TableHead>
                        <TableHead className="text-right">{t("build.lookthrough.col.share")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>{renderRows(result.sectorEquity)}</TableBody>
                  </Table>
                </div>
              </div>
            )}
          </div>

          {result.geoFixedIncome.length > 0 && (
            <div>
              <h4 className="text-sm font-semibold mb-2">
                {t("build.lookthrough.geoFI")}{" "}
                <span className="text-xs text-muted-foreground font-normal">
                  ({result.fixedIncomeWeightTotal.toFixed(0)}% {t("build.lookthrough.ofPortfolio")})
                </span>
              </h4>
              <div className="rounded-md border">
                <Table className="text-xs">
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("build.lookthrough.col.country")}</TableHead>
                      <TableHead className="text-right">{t("build.lookthrough.col.share")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>{renderRows(result.geoFixedIncome)}</TableBody>
                </Table>
              </div>
            </div>
          )}

          <div>
            <h4 className="text-sm font-semibold mb-2 flex items-center gap-2">
              <Info className="h-4 w-4" /> {t("build.lookthrough.observations")}
            </h4>
            <ul className="space-y-2 text-sm text-muted-foreground list-disc list-inside pl-1">
              {result.observations.map((o, i) => (
                <li key={i} className="leading-relaxed">{o}</li>
              ))}
            </ul>
          </div>

          <p className="text-[10px] text-muted-foreground italic">
            {t("build.lookthrough.disclaimer")}
          </p>
        </CardContent>
      </Card>

      {/* Card: Currency overview after hedging */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Coins className="h-5 w-5" /> {t("build.fx.title")}
          </CardTitle>
          <CardDescription>
            {t("build.fx.desc").replace("{base}", result.currencyOverview.baseCurrency)}
          </CardDescription>
        </CardHeader>
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
                {result.currencyOverview.rows.map((r) => (
                  <TableRow key={r.currency}>
                    <TableCell className="font-medium">
                      {r.currency}
                      {r.currency === result.currencyOverview.baseCurrency && (
                        <span className="ml-2 text-[10px] text-muted-foreground">
                          ({t("build.fx.base")})
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-right font-mono">{r.pctOfPortfolio.toFixed(1)}%</TableCell>
                    <TableCell className="text-right font-mono">{r.unhedgedPct.toFixed(1)}%</TableCell>
                    <TableCell className="text-right font-mono">{r.hedgedPct.toFixed(1)}%</TableCell>
                  </TableRow>
                ))}
                {result.currencyOverview.unmappedWeight > 0 && (
                  <TableRow>
                    <TableCell className="text-muted-foreground italic">{t("build.fx.unmapped")}</TableCell>
                    <TableCell className="text-right font-mono">{result.currencyOverview.unmappedWeight.toFixed(1)}%</TableCell>
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
              <div className="font-mono text-base mt-1">
                {result.currencyOverview.hedgedShareOfPortfolio.toFixed(1)}%
              </div>
              <div className="mt-1">{t("build.fx.summary.hedgedShareDesc")}</div>
            </div>
            <div className="rounded-md border p-3">
              <div className="font-semibold text-foreground">{t("build.fx.summary.baseShare")}</div>
              <div className="font-mono text-base mt-1">
                {(
                  result.currencyOverview.rows.find(
                    (r) => r.currency === result.currencyOverview.baseCurrency
                  )?.pctOfPortfolio ?? 0
                ).toFixed(1)}
                %
              </div>
              <div className="mt-1">
                {t("build.fx.summary.baseShareDesc").replace(
                  "{base}",
                  result.currencyOverview.baseCurrency
                )}
              </div>
            </div>
          </div>
          <p className="text-[10px] text-muted-foreground italic">{t("build.fx.disclaimer")}</p>
        </CardContent>
      </Card>

      {/* Card: Top 10 equity holdings on a look-through basis */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Trophy className="h-5 w-5" /> {t("build.top10.title")}
          </CardTitle>
          <CardDescription>{t("build.top10.desc")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {result.topConcentrations.length === 0 ? (
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
                  {result.topConcentrations.map((h, i) => (
                    <TableRow key={h.name}>
                      <TableCell className="font-mono text-muted-foreground">{i + 1}</TableCell>
                      <TableCell className="font-medium">{h.name}</TableCell>
                      <TableCell className="text-right font-mono">{h.pctOfPortfolio.toFixed(2)}%</TableCell>
                      <TableCell className="text-right font-mono">
                        {result.equityWeightTotal > 0
                          ? ((h.pctOfPortfolio / result.equityWeightTotal) * 100).toFixed(2)
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
      </Card>
    </div>
  );
}
