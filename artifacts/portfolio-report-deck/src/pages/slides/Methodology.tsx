export default function Methodology() {
  return (
    <div className="w-screen h-screen overflow-hidden relative bg-paper text-ink">
      <div className="absolute left-[7vw] top-[8vh] right-[7vw] flex items-baseline justify-between">
        <div className="font-mono uppercase tracking-[0.25em] text-[0.9vw] text-accent">
          08 · Methodology &amp; disclaimer
        </div>
        <div className="font-mono text-[0.9vw] text-ink/50">p. 10</div>
      </div>

      <div className="absolute left-[7vw] top-[14vh] right-[7vw]">
        <h1 className="font-display font-medium text-[4.2vw] leading-none text-primary">
          From profile to portfolio.
        </h1>
        <div className="mt-[1.2vh] font-sans text-[1.05vw] text-ink/65 max-w-[60vw]">
          Five deterministic steps turn the three profile inputs into the allocation, ETF picks,
          and Monte Carlo distribution shown in this report. The full legal disclaimer follows on the next two slides.
        </div>
      </div>

      <div className="absolute left-[7vw] right-[7vw] top-[36vh] grid grid-cols-5 gap-[1.2vw]">
        <div className="bg-cream border border-ink/15 rounded-[0.4vw] p-[1.8vh_1.2vw]">
          <div className="font-mono text-accent text-[0.9vw]">01</div>
          <div className="mt-[0.6vh] font-display text-[1.4vw] leading-tight text-primary">Equity / defensive split</div>
          <div className="mt-[1vh] text-[0.88vw] text-ink/80 leading-snug">
            Target equity (60%) is capped by risk profile (Moderate → 70% max). Cash is set from horizon: 2% at 15 years. Bonds absorb the remainder.
          </div>
        </div>
        <div className="bg-cream border border-ink/15 rounded-[0.4vw] p-[1.8vh_1.2vw]">
          <div className="font-mono text-accent text-[0.9vw]">02</div>
          <div className="mt-[0.6vh] font-display text-[1.4vw] leading-tight text-primary">Regional anchors</div>
          <div className="mt-[1vh] text-[0.88vw] text-ink/80 leading-snug">
            Equity is distributed across US, Europe, Switzerland, Japan, EM, and World Small Cap using free-float capitalisation as the starting weight.
          </div>
        </div>
        <div className="bg-cream border border-ink/15 rounded-[0.4vw] p-[1.8vh_1.2vw]">
          <div className="font-mono text-accent text-[0.9vw]">03</div>
          <div className="mt-[0.6vh] font-display text-[1.4vw] leading-tight text-primary">Tilts &amp; overlays</div>
          <div className="mt-[1vh] text-[0.88vw] text-ink/80 leading-snug">
            Swiss home-bias multiplier (×2.5) for CHF investors. Long-horizon EM boost (×1.3 at ≥10 years). Sharpe-ratio overlay nudges weights toward higher risk-adjusted buckets.
          </div>
        </div>
        <div className="bg-cream border border-ink/15 rounded-[0.4vw] p-[1.8vh_1.2vw]">
          <div className="font-mono text-accent text-[0.9vw]">04</div>
          <div className="mt-[0.6vh] font-display text-[1.4vw] leading-tight text-primary">Instrument selection</div>
          <div className="mt-[1vh] text-[0.88vw] text-ink/80 leading-snug">
            Each bucket is filled by its catalog default ETF, biased toward UCITS-domiciled accumulating share classes with CHF-hedging where applicable.
          </div>
        </div>
        <div className="bg-cream border border-ink/15 rounded-[0.4vw] p-[1.8vh_1.2vw]">
          <div className="font-mono text-accent text-[0.9vw]">05</div>
          <div className="mt-[0.6vh] font-display text-[1.4vw] leading-tight text-primary">Monte Carlo</div>
          <div className="mt-[1vh] text-[0.88vw] text-ink/80 leading-snug">
            10,000 paths are simulated under the normal correlation regime with monthly rebalancing; percentiles are reported on the end-of-horizon distribution.
          </div>
        </div>
      </div>

      <div className="absolute left-[7vw] right-[7vw] top-[78vh] bg-primary text-paper p-[2vh_2vw] rounded-[0.4vw] flex items-center justify-between">
        <div className="font-display italic text-[1.4vw] max-w-[65vw] leading-tight">
          “Look-through” resolves every ETF down to its underlying issuers before reporting concentration, sector mix, and top holdings.
        </div>
        <div className="font-mono uppercase tracking-[0.2em] text-[0.8vw] text-paper/70 text-right">
          Engine reference<br />investment-decision-lab
        </div>
      </div>

      <div className="absolute left-0 right-0 bottom-0 h-[0.6vh] bg-accent/70" />
    </div>
  );
}
