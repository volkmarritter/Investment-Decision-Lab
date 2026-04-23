import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Telescope, Info } from "lucide-react";
import { ETFImplementation, BaseCurrency } from "@/lib/types";
import { buildLookthrough } from "@/lib/lookthrough";
import { useT } from "@/lib/i18n";

interface Props {
  etfs: ETFImplementation[];
  baseCurrency: BaseCurrency;
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
  );
}
