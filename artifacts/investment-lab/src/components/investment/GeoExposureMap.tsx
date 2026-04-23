import { useMemo, useState } from "react";
import { ComposableMap, Geographies, Geography } from "react-simple-maps";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Globe2 } from "lucide-react";
import { ETFImplementation, BaseCurrency } from "@/lib/types";
import { buildLookthrough } from "@/lib/lookthrough";
import { buildCountryWeights, colorFor, COLOR_STOPS } from "@/lib/geomap";
import { useT } from "@/lib/i18n";

interface Props {
  etfs: ETFImplementation[];
  baseCurrency: BaseCurrency;
}

const GEO_URL = "https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json";

export function GeoExposureMap({ etfs, baseCurrency }: Props) {
  const { t, lang } = useT();
  const result = buildLookthrough(etfs, lang, baseCurrency);
  const { countries } = useMemo(
    () => buildCountryWeights(result.geoEquity),
    [result.geoEquity],
  );
  const weightByName = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of countries) m.set(c.name, c.pct);
    return m;
  }, [countries]);
  const [hovered, setHovered] = useState<{ name: string; pct: number } | null>(null);

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
                  const pct = weightByName.get(name) ?? 0;
                  return (
                    <Geography
                      key={geo.rsmKey}
                      geography={geo}
                      fill={colorFor(pct)}
                      stroke="hsl(var(--border))"
                      strokeWidth={0.4}
                      onMouseEnter={() => setHovered({ name, pct })}
                      onMouseLeave={() => setHovered(null)}
                      style={{
                        default: { outline: "none" },
                        hover: { outline: "none", opacity: 0.8, cursor: "pointer" },
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
              <div className="font-mono text-muted-foreground">
                {hovered.pct > 0 ? `${hovered.pct.toFixed(2)}%` : t("build.geomap.noExposure")}
              </div>
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3 text-[10px] text-muted-foreground">
          <span className="font-semibold uppercase tracking-wider">{t("build.geomap.legend")}</span>
          {COLOR_STOPS.map((s) => (
            <div key={s.label} className="flex items-center gap-1.5">
              <span
                className="inline-block h-3 w-4 rounded-sm border"
                style={{ background: s.fill }}
              />
              <span className="font-mono">{s.label}</span>
            </div>
          ))}
        </div>

        <p className="text-[10px] text-muted-foreground italic">{t("build.geomap.disclaimer")}</p>
      </CardContent>
    </Card>
  );
}
