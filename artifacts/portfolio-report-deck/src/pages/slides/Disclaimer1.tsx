export default function Disclaimer1() {
  return (
    <div className="w-screen h-screen overflow-hidden relative bg-paper text-ink">
      <div className="absolute left-[7vw] top-[6vh] right-[7vw] flex items-baseline justify-between">
        <div className="font-mono uppercase tracking-[0.25em] text-[0.85vw] text-accent">
          08 · Methodology &amp; disclaimer — I of II
        </div>
        <div className="font-mono text-[0.85vw] text-ink/50">p. 11 · Sections 1–4</div>
      </div>

      <div className="absolute left-[7vw] right-[7vw] top-[12vh]">
        <h1 className="font-display font-medium text-[3.4vw] leading-none text-primary">
          Important information.
        </h1>
        <div className="mt-[0.8vh] font-sans text-[1vw] text-ink/65 max-w-[60vw]">
          Read in full before acting on anything in this document.
        </div>
      </div>

      <div className="absolute left-[7vw] right-[7vw] top-[24vh] bottom-[6vh] grid grid-cols-2 gap-x-[3vw] gap-y-[2vh]">
        <div>
          <div className="font-mono uppercase tracking-[0.2em] text-[0.78vw] text-accent">01 — No investment advice</div>
          <div className="mt-[0.6vh] font-display text-[1.3vw] text-primary leading-tight">Educational tool, not a personal recommendation.</div>
          <div className="mt-[0.6vh] text-[0.92vw] leading-snug text-ink/85">
            The Investment Decision Lab is a research and education tool. The portfolio shown here is a generic illustration produced from three profile inputs — currency, risk profile, and horizon — and has not been calibrated to any specific person’s tax situation, liabilities, income, or other holdings. Nothing in this report constitutes investment, tax, legal, or accounting advice.
          </div>
        </div>
        <div>
          <div className="font-mono uppercase tracking-[0.2em] text-[0.78vw] text-accent">02 — Past performance</div>
          <div className="mt-[0.6vh] font-display text-[1.3vw] text-primary leading-tight">Backward-looking data is not a forecast.</div>
          <div className="mt-[0.6vh] text-[0.92vw] leading-snug text-ink/85">
            Expected returns, volatilities, and Sharpe ratios are derived from long-run historical estimates and capital-market assumptions. Past performance is not indicative of future results. Realised returns can differ materially from the figures reported here and may be negative over the full fifteen-year horizon.
          </div>
        </div>
        <div>
          <div className="font-mono uppercase tracking-[0.2em] text-[0.78vw] text-accent">03 — Monte Carlo limitations</div>
          <div className="mt-[0.6vh] font-display text-[1.3vw] text-primary leading-tight">Models cannot price every kind of risk.</div>
          <div className="mt-[0.6vh] text-[0.92vw] leading-snug text-ink/85">
            The Monte Carlo simulation assumes stable correlation regimes, log-normal returns, and continuous rebalancing. It will under-state the impact of crises in which correlations move to one, liquidity vanishes, or fat-tailed events occur. The 80% band shown on the projection chart is not a worst-case scenario.
          </div>
        </div>
        <div>
          <div className="font-mono uppercase tracking-[0.2em] text-[0.78vw] text-accent">04 — Currency &amp; hedging</div>
          <div className="mt-[0.6vh] font-display text-[1.3vw] text-primary leading-tight">CHF reporting does not eliminate FX risk.</div>
          <div className="mt-[0.6vh] text-[0.92vw] leading-snug text-ink/85">
            Bonds are currency-hedged into CHF, but equity sleeves remain exposed to USD, EUR, JPY, and emerging-market currencies. Hedging carries its own roll cost and basis risk. Hedge effectiveness can fall sharply in stressed markets.
          </div>
        </div>
      </div>

      <div className="absolute left-0 right-0 bottom-0 h-[0.6vh] bg-accent/70" />
    </div>
  );
}
