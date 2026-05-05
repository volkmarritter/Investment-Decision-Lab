import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Home, ThumbsUp, ThumbsDown, Lightbulb, ChevronDown, ChevronUp } from "lucide-react";
import { ETFImplementation, BaseCurrency } from "@/lib/types";
import { evaluateHomeBias, HomeBiasVerdict } from "@/lib/homebias";
import { useT } from "@/lib/i18n";

interface Props {
  etfs: ETFImplementation[];
  baseCurrency: BaseCurrency;
  // When the parent's "Look-Through" toggle is OFF, the home-share figure
  // can no longer be computed honestly (the verdict needs the geo
  // look-through baskets). The card hides itself in that case so the page
  // never silently shows a verdict that contradicts what the rest of the
  // metrics are doing. Defaults to ON for callers that don't have the
  // toggle (e.g. Methodology preview).
  lookThroughView?: boolean;
}

const verdictTone: Record<HomeBiasVerdict, string> = {
  under: "bg-blue-500/10 text-blue-700 dark:text-blue-300 border-blue-500/30",
  modest: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30",
  pronounced: "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30",
  over: "bg-red-500/10 text-red-700 dark:text-red-300 border-red-500/30",
  neutral: "",
};

export function HomeBiasAnalysis({ etfs, baseCurrency, lookThroughView = true }: Props) {
  const { t, lang } = useT();
  const r = evaluateHomeBias(etfs, baseCurrency, lang);
  const [open, setOpen] = useState(false);

  if (!r.applicable) return null;
  // Hide the card when the parent's look-through toggle is OFF — the verdict
  // is computed from the geo look-through baskets and would otherwise
  // contradict the surrounding metrics (which fall back to row-region
  // routing). Mirrors the look-through panel's own gating.
  if (!lookThroughView) return null;

  return (
    <Card className="w-full">
      <CardHeader>
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
          <div className="flex-1">
            <CardTitle className="flex items-center gap-2 flex-wrap">
              <Home className="h-5 w-5" />
              <span>{t("build.homeBias.title")}</span>
              <Badge variant="outline" className={verdictTone[r.verdict]}>
                {r.verdictLabel}
              </Badge>
              <span className="text-xs text-muted-foreground font-normal">
                {r.homeShareOfEquityPct.toFixed(1)}% {t("build.homeBias.ofEquity")} ·{" "}
                {r.biasRatio > 0 ? `${r.biasRatio.toFixed(1)}× ${t("build.homeBias.metric.neutralCap").toLowerCase()}` : ""}
              </span>
            </CardTitle>
            <CardDescription className="mt-2">
              {t("build.homeBias.desc")
                .replace("{home}", r.homeMarketLabel)
                .replace("{base}", r.baseCurrency)}
            </CardDescription>
            <p className="text-[10px] text-muted-foreground italic mt-1.5">
              {t("build.homeBias.lookThroughNote")}
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setOpen((o) => !o)}
            className="shrink-0"
          >
            {open ? (
              <>
                <ChevronUp className="h-4 w-4 mr-1" /> {t("build.homeBias.collapse")}
              </>
            ) : (
              <>
                <ChevronDown className="h-4 w-4 mr-1" /> {t("build.homeBias.expand")}
              </>
            )}
          </Button>
        </div>
      </CardHeader>

      {open && (
        <CardContent className="space-y-5">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
            <div className="rounded-md border p-3">
              <div className="text-muted-foreground">{t("build.homeBias.metric.actualEquity")}</div>
              <div className="font-mono text-base mt-1">{r.homeShareOfEquityPct.toFixed(1)}%</div>
            </div>
            <div className="rounded-md border p-3">
              <div className="text-muted-foreground">{t("build.homeBias.metric.actualPortfolio")}</div>
              <div className="font-mono text-base mt-1">{r.homeShareOfPortfolioPct.toFixed(1)}%</div>
            </div>
            <div className="rounded-md border p-3">
              <div className="text-muted-foreground">{t("build.homeBias.metric.neutralCap")}</div>
              <div className="font-mono text-base mt-1">{r.neutralCapWeightPct.toFixed(1)}%</div>
            </div>
            <div className="rounded-md border p-3">
              <div className="text-muted-foreground">{t("build.homeBias.metric.biasRatio")}</div>
              <div className="font-mono text-base mt-1">
                {r.biasRatio > 0 ? `${r.biasRatio.toFixed(1)}×` : "—"}
              </div>
            </div>
          </div>

          <div className="text-xs text-muted-foreground">
            {t("build.homeBias.recommendedRange")}: {r.recommendedRangeOfEquity.min}–
            {r.recommendedRangeOfEquity.max}% {t("build.homeBias.ofEquity")}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="rounded-md border p-3 space-y-2">
              <div className="text-sm font-semibold flex items-center gap-2">
                <ThumbsUp className="h-4 w-4 text-emerald-600" /> {t("build.homeBias.pros")}
              </div>
              <ul className="text-xs text-muted-foreground space-y-2 list-disc list-inside">
                {r.pros.map((p, i) => (
                  <li key={i} className="leading-relaxed">{p}</li>
                ))}
              </ul>
            </div>
            <div className="rounded-md border p-3 space-y-2">
              <div className="text-sm font-semibold flex items-center gap-2">
                <ThumbsDown className="h-4 w-4 text-red-600" /> {t("build.homeBias.cons")}
              </div>
              <ul className="text-xs text-muted-foreground space-y-2 list-disc list-inside">
                {r.cons.map((c, i) => (
                  <li key={i} className="leading-relaxed">{c}</li>
                ))}
              </ul>
            </div>
          </div>

          <div className="rounded-md border border-primary/20 bg-primary/5 p-3 text-sm">
            <div className="flex items-center gap-2 font-semibold mb-1">
              <Lightbulb className="h-4 w-4 text-primary" /> {t("build.homeBias.recommendation")}
            </div>
            <p className="text-muted-foreground leading-relaxed">{r.recommendation}</p>
          </div>

          <p className="text-[10px] text-muted-foreground italic">{t("build.homeBias.disclaimer")}</p>
        </CardContent>
      )}
    </Card>
  );
}
