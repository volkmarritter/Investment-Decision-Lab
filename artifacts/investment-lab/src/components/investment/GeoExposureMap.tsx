import { useMemo, useState } from "react";
import { ComposableMap, Geographies, Geography } from "react-simple-maps";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Globe2 } from "lucide-react";
import { ETFImplementation, BaseCurrency } from "@/lib/types";
import { buildLookthrough } from "@/lib/lookthrough";
import {
  buildRegionWeights,
  RegionKey,
  REGION_COLORS,
  regionFill,
  regionLabel,
} from "@/lib/geomap";
import { useT } from "@/lib/i18n";

interface Props {
  etfs: ETFImplementation[];
  baseCurrency: BaseCurrency;
}

const GEO_URL = "https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json";

export function GeoExposureMap({ etfs, baseCurrency }: Props) {
  const { t, lang } = useT();
  const result = buildLookthrough(etfs, lang, baseCurrency);
  const { weights, otherPct, countryToRegion } = useMemo(
    () => buildRegionWeights(result.geoEquity, baseCurrency),
    [result.geoEquity, baseCurrency],
  );

  const activeRegions: RegionKey[] = (["NA", "Europe", "UK", "Switzerland", "Japan", "EM"] as RegionKey[])
    .filter((r) => {
      if (r === "UK") return baseCurrency === "GBP";
      if (r === "Switzerland") return baseCurrency === "CHF";
      return true;
    });

  const maxPct = Math.max(...activeRegions.map((r) => weights[r]), 0.0001);
  const [hovered, setHovered] = useState<{ name: string; region: RegionKey | null; pct: number } | null>(null);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 flex-wrap">
          <Globe2 className="h-5 w-5" />
          <span>{t("build.geomap.title")}</span>
          <span className="text-xs text-muted-foreground font-normal">
            {result.equityWeightTotal.toFixed(0)}% {t("build.lookthrough.ofPortfolio")}
          </span>
        </CardTitle>
        <CardDescription>{t("build.geomap.desc")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="relative w-full overflow-hidden rounded-md border bg-background">
          <ComposableMap
            projectionConfig={{ scale: 145 }}
            width={900}
            height={420}
            style={{ width: "100%", height: "auto" }}
          >
            <Geographies geography={GEO_URL}>
              {({ geographies }) =>
                geographies.map((geo) => {
                  const name: string = geo.properties.name;
                  const region = countryToRegion.get(name) ?? null;
                  const pct = region ? weights[region] : 0;
                  const fill = region && pct > 0
                    ? regionFill(region, pct, maxPct)
                    : "hsl(var(--muted))";
                  return (
                    <Geography
                      key={geo.rsmKey}
                      geography={geo}
                      fill={fill}
                      stroke="hsl(var(--border))"
                      strokeWidth={0.4}
                      onMouseEnter={() => setHovered({ name, region, pct })}
                      onMouseLeave={() => setHovered(null)}
                      style={{
                        default: { outline: "none" },
                        hover: { outline: "none", opacity: 0.85, cursor: "pointer" },
                        pressed: { outline: "none" },
                      }}
                    />
                  );
                })
              }
            </Geographies>
          </ComposableMap>
          {hovered && (
            <div className="absolute top-2 right-2 rounded-md border bg-background/95 px-3 py-1.5 text-xs shadow-sm">
              <div className="font-semibold">{hovered.name}</div>
              <div className="text-muted-foreground">
                {hovered.region
                  ? `${regionLabel(hovered.region, lang)} · ${hovered.pct.toFixed(1)}%`
                  : t("build.geomap.noExposure")}
              </div>
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
          {activeRegions.map((r) => (
            <div
              key={r}
              data-testid={`geo-region-${r}`}
              className="rounded-md border p-2 text-xs"
            >
              <div className="flex items-center gap-1.5">
                <span
                  className="inline-block h-3 w-3 rounded-sm"
                  style={{ background: REGION_COLORS[r] }}
                />
                <span className="font-medium truncate">{regionLabel(r, lang)}</span>
              </div>
              <div
                data-testid={`geo-region-${r}-pct`}
                className="font-mono text-base mt-1"
              >
                {weights[r].toFixed(1)}%
              </div>
            </div>
          ))}
          {/* Surface the "Other / Residual" leg as its own legend tile so it's
              visible at a glance — the country-level map cannot colour this
              slice (justETF aggregates it past the top ~10 countries) so it
              gets a neutral grey swatch and a tooltip. Task #241, 2026-05. */}
          {otherPct > 0.5 && (
            <div
              className="rounded-md border p-2 text-xs"
              data-testid="build-geomap-other-tile"
              title={lang === "de"
                ? "Sonstige / Rest — Anteil des Aktien-Sleeves, der sich nicht eindeutig einer der gefärbten Regionen zuordnen lässt (justETFs „Sonstige“-Sammelposten plus mehrdeutige Labels wie Irland; Kanada ist hier in der NA-Region mit den USA enthalten — die Karte zeigt geografische Regionen, im CMA-Bucket Other/Residual landet Kanada hingegen)."
                : "Other / Residual — share of the equity sleeve that cannot be unambiguously placed into any of the coloured regions (justETF's “Other” catch-all plus context-dependent labels such as Ireland; Canada is grouped with the US under NA on this geographic map, but lives in the Other/Residual CMA bucket on the metrics side)."}
            >
              <div className="flex items-center gap-1.5">
                <span
                  className="inline-block h-3 w-3 rounded-sm"
                  style={{ background: "hsl(220, 12%, 55%)" }}
                />
                <span className="font-medium truncate">
                  {lang === "de" ? "Sonstige / Rest" : "Other / Residual"}
                </span>
              </div>
              <div className="font-mono text-base mt-1">{otherPct.toFixed(1)}%</div>
            </div>
          )}
        </div>

        {otherPct > 0.5 && (
          <p className="text-[10px] text-muted-foreground">
            {t("build.geomap.other").replace("{pct}", otherPct.toFixed(1))}
          </p>
        )}

        <p className="text-[10px] text-muted-foreground italic">{t("build.geomap.disclaimer")}</p>
      </CardContent>
    </Card>
  );
}
