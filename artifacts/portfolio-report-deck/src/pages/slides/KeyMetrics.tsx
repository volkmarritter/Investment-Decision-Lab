import { keyMetrics } from "@/data/reportData";

function Metric({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: boolean;
}) {
  return (
    <div className="flex flex-col gap-[0.6vh] border-l border-ink/15 pl-[1.2vw]">
      <div className="font-mono uppercase tracking-[0.2em] text-[0.75vw] text-ink/55">{label}</div>
      <div
        className={
          "font-display text-[3.6vw] leading-none tabular-nums " +
          (accent ? "text-accent" : "text-primary")
        }
      >
        {value}
      </div>
      {sub ? <div className="font-sans text-[0.9vw] text-ink/55">{sub}</div> : null}
    </div>
  );
}

export default function KeyMetrics() {
  return (
    <div className="w-screen h-screen overflow-hidden relative bg-paper text-ink">
      <div className="absolute left-[7vw] top-[8vh] right-[7vw] flex items-baseline justify-between">
        <div className="font-mono uppercase tracking-[0.25em] text-[0.9vw] text-accent">
          02 · Key metrics
        </div>
        <div className="font-mono text-[0.9vw] text-ink/50">p. 04</div>
      </div>

      <div className="absolute left-[7vw] top-[14vh] right-[7vw]">
        <h1 className="font-display font-medium text-[4.2vw] leading-none text-primary">
          The headline numbers.
        </h1>
        <div className="mt-[1.2vh] font-sans text-[1.05vw] text-ink/65 max-w-[55vw]">
          Forward-looking estimates from the engine's capital-market assumptions, blended at the
          portfolio's policy weights. Past performance is not a guide.
        </div>
      </div>

      <div className="absolute left-[7vw] right-[7vw] top-[40vh] grid grid-cols-5 gap-[1.4vw]">
        <Metric label="Expected return p.a." value={keyMetrics.expectedReturnPa} sub="Arithmetic, gross of tax" accent />
        <Metric label="Volatility p.a." value={keyMetrics.volatilityPa} sub="Std. dev. of annual return" />
        <Metric label="Sharpe ratio" value={keyMetrics.sharpe} sub={`Rf = ${keyMetrics.riskFreeRate}`} />
        <Metric label="Max drawdown" value={keyMetrics.maxDrawdownP5} sub="5th percentile path" />
        <Metric label="Alpha vs. ACWI" value={keyMetrics.alphaVsAcwi} sub="After hedging & costs" accent />
      </div>

      <div className="absolute left-[7vw] right-[7vw] top-[68vh] grid grid-cols-3 gap-[2vw]">
        <div className="border border-ink/15 rounded-[0.4vw] p-[1.6vh_1.4vw] bg-cream">
          <div className="font-mono uppercase tracking-[0.2em] text-[0.75vw] text-ink/55">Sharpe interpretation</div>
          <div className="mt-[0.6vh] font-sans text-[1.05vw] text-ink/85">{keyMetrics.sharpeInterpretation}</div>
        </div>
        <div className="border border-ink/15 rounded-[0.4vw] p-[1.6vh_1.4vw] bg-cream">
          <div className="font-mono uppercase tracking-[0.2em] text-[0.75vw] text-ink/55">Equity / defensive split</div>
          <div className="mt-[0.6vh] font-display text-[2vw] text-primary">{keyMetrics.equityDefensiveSplit}</div>
        </div>
        <div className="border border-ink/15 rounded-[0.4vw] p-[1.6vh_1.4vw] bg-cream">
          <div className="font-mono uppercase tracking-[0.2em] text-[0.75vw] text-ink/55">Weighted TER</div>
          <div className="mt-[0.6vh] font-display text-[2vw] text-primary">{keyMetrics.weightedTER}</div>
        </div>
      </div>

      <div className="absolute left-0 right-0 bottom-0 h-[0.6vh] bg-accent/70" />
    </div>
  );
}
