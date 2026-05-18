import { monteCarlo } from "@/data/reportData";

function Metric({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="border-l border-ink/15 pl-[0.9vw] py-[0.6vh]">
      <div className="font-mono uppercase tracking-[0.18em] text-[0.7vw] text-ink/55">{label}</div>
      <div className="font-display text-[1.9vw] text-primary leading-none mt-[0.4vh] tabular-nums">{value}</div>
      {sub ? <div className="font-sans text-[0.8vw] text-ink/55 mt-[0.3vh]">{sub}</div> : null}
    </div>
  );
}

export default function MonteCarlo() {
  // Chart geometry (0..100 normalized). 15-year projection.
  // P10/P50/P90 endpoints rebased to start=100.
  const yScale = (v: number) => 100 - ((v - 60) / (450 - 60)) * 88; // map [60,450] → [98,10]
  const xs = [0, 1, 3, 5, 7, 9, 11, 13, 15].map((y) => 4 + (y / 15) * 92);

  const p10 = [100, 102, 106, 110, 114, 119, 124, 130, monteCarlo.finalP10].map(yScale);
  const p50 = [100, 106, 119, 132, 148, 165, 184, 204, monteCarlo.finalP50].map(yScale);
  const p90 = [100, 110, 134, 161, 194, 234, 282, 340, monteCarlo.finalP90].map(yScale);

  const pathFrom = (ys: number[]) =>
    ys.map((y, i) => `${i === 0 ? "M" : "L"} ${xs[i]} ${y}`).join(" ");

  const bandPath =
    pathFrom(p90) +
    " " +
    p10
      .map((y, i) => `L ${xs[p10.length - 1 - i]} ${p10[p10.length - 1 - i]}`)
      .reverse()
      .join(" ") +
    " Z";

  return (
    <div className="w-screen h-screen overflow-hidden relative bg-paper text-ink">
      <div className="absolute left-[5vw] top-[6vh] right-[5vw] flex items-baseline justify-between">
        <div className="font-mono uppercase tracking-[0.25em] text-[0.9vw] text-accent">
          06 · Monte Carlo projection
        </div>
        <div className="font-mono text-[0.9vw] text-ink/50">p. 08</div>
      </div>

      <div className="absolute left-[5vw] top-[11vh] right-[5vw]">
        <h1 className="font-display font-medium text-[3.6vw] leading-none text-primary">
          15-year outcomes.
        </h1>
        <div className="mt-[0.8vh] font-sans text-[0.95vw] text-ink/65 max-w-[60vw]">
          {monteCarlo.paths} simulated paths over a {monteCarlo.horizonYears}-year horizon, drawn
          from the engine's capital-market assumptions. Values rebased so today = 100.
        </div>
      </div>

      <div className="absolute left-[5vw] top-[27vh] w-[56vw] h-[55vh] border border-ink/15 rounded-[0.4vw] bg-cream p-[1.6vh_1.4vw]">
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="w-full h-full">
          <defs>
            <linearGradient id="mcband" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#c8a35c" stopOpacity="0.35" />
              <stop offset="100%" stopColor="#c8a35c" stopOpacity="0.05" />
            </linearGradient>
          </defs>
          <line x1="4" y1={yScale(100)} x2="96" y2={yScale(100)} stroke="#1a3a5c" strokeOpacity="0.2" strokeDasharray="0.6 0.6" strokeWidth="0.2" />
          <line x1="4" y1={yScale(200)} x2="96" y2={yScale(200)} stroke="#1a3a5c" strokeOpacity="0.12" strokeWidth="0.15" />
          <line x1="4" y1={yScale(300)} x2="96" y2={yScale(300)} stroke="#1a3a5c" strokeOpacity="0.12" strokeWidth="0.15" />
          <line x1="4" y1={yScale(400)} x2="96" y2={yScale(400)} stroke="#1a3a5c" strokeOpacity="0.12" strokeWidth="0.15" />
          <path d={bandPath} fill="url(#mcband)" />
          <path d={pathFrom(p10)} fill="none" stroke="#1a3a5c" strokeOpacity="0.55" strokeWidth="0.5" strokeDasharray="1 0.6" />
          <path d={pathFrom(p50)} fill="none" stroke="#1a3a5c" strokeWidth="0.8" />
          <path d={pathFrom(p90)} fill="none" stroke="#c8a35c" strokeWidth="0.7" />
          <text x={xs[xs.length - 1] + 0.6} y={p90[p90.length - 1] + 1} fontSize="2.4" fontFamily="IBM Plex Mono" fill="#c8a35c">P90 {monteCarlo.finalP90}</text>
          <text x={xs[xs.length - 1] + 0.6} y={p50[p50.length - 1] + 1} fontSize="2.4" fontFamily="IBM Plex Mono" fill="#1a3a5c">P50 {monteCarlo.finalP50}</text>
          <text x={xs[xs.length - 1] + 0.6} y={p10[p10.length - 1] + 1} fontSize="2.4" fontFamily="IBM Plex Mono" fill="#1a3a5c" opacity="0.7">P10 {monteCarlo.finalP10}</text>
          <text x="4" y={yScale(100) + 3} fontSize="2.2" fontFamily="IBM Plex Mono" fill="#1a3a5c" opacity="0.5">100</text>
          <text x="46" y="99" fontSize="2.2" fontFamily="IBM Plex Mono" fill="#1a3a5c" opacity="0.55">Years 0 — 15</text>
        </svg>
      </div>

      <div className="absolute right-[5vw] top-[27vh] w-[28vw] grid grid-cols-2 gap-x-[0.8vw] gap-y-[1.2vh]">
        <Metric label="P50 final value" value={String(monteCarlo.finalP50)} sub={monteCarlo.finalP50CAGR} />
        <Metric label="P10 final value" value={String(monteCarlo.finalP10)} sub={monteCarlo.finalP10CAGR} />
        <Metric label="P90 final value" value={String(monteCarlo.finalP90)} sub={monteCarlo.finalP90CAGR} />
        <Metric label="Exp. return (geom.)" value={monteCarlo.expReturnGeom} sub="annualised" />
        <Metric label="Exp. volatility" value={monteCarlo.expVol} sub="annualised" />
        <Metric label="P(loss) at 15y" value={monteCarlo.pLoss15y} sub="nominal CHF" />
        <Metric label="P(doubling) at 15y" value={monteCarlo.pDouble15y} sub="nominal CHF" />
        <Metric label="CVaR 5%" value={monteCarlo.cvar5} sub="tail loss, 1-year" />
      </div>

      <div className="absolute left-0 right-0 bottom-0 h-[0.6vh] bg-accent/70" />
    </div>
  );
}
