import { fees } from "@/data/reportData";

function Th({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={
        "font-mono uppercase tracking-[0.18em] text-[0.72vw] text-ink/55 pb-[0.6vh] border-b border-ink/30 " +
        className
      }
    >
      {children}
    </div>
  );
}

function Cell({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={"font-sans text-[0.92vw] text-ink py-[0.75vh] border-b border-ink/10 " + className}>{children}</div>;
}

function Row({ r }: { r: (typeof fees.rows)[number] }) {
  return (
    <>
      <Cell>{r.bucket}</Cell>
      <Cell className="font-mono tabular-nums text-right">{r.weightPct}</Cell>
      <Cell className="font-mono tabular-nums text-right">{r.terBps}</Cell>
      <Cell className="font-mono tabular-nums text-right text-accent">{r.contributionBps.toFixed(2)}</Cell>
    </>
  );
}

function Metric({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="border-l border-ink/15 pl-[1vw] py-[0.4vh]">
      <div className="font-mono uppercase tracking-[0.18em] text-[0.72vw] text-ink/55">{label}</div>
      <div className="font-display text-[2.2vw] text-primary leading-none mt-[0.4vh] tabular-nums">{value}</div>
      {sub ? <div className="font-sans text-[0.82vw] text-ink/55 mt-[0.3vh]">{sub}</div> : null}
    </div>
  );
}

export default function Fees() {
  return (
    <div className="w-screen h-screen overflow-hidden relative bg-paper text-ink">
      <div className="absolute left-[5vw] top-[6vh] right-[5vw] flex items-baseline justify-between">
        <div className="font-mono uppercase tracking-[0.25em] text-[0.9vw] text-accent">
          07 · Fee estimate
        </div>
        <div className="font-mono text-[0.9vw] text-ink/50">p. 09</div>
      </div>

      <div className="absolute left-[5vw] top-[11vh] right-[5vw]">
        <h1 className="font-display font-medium text-[3.6vw] leading-none text-primary">
          The cost of staying invested.
        </h1>
        <div className="mt-[0.8vh] font-sans text-[0.95vw] text-ink/65 max-w-[60vw]">
          Blended TER computed as Σ(weight × TER). Year-1 fee assumes a {fees.portfolioSize} portfolio.
          Drag is the cumulative TER cost across the 15-year horizon at P50.
        </div>
      </div>

      <div className="absolute left-[5vw] right-[5vw] top-[27vh] grid grid-cols-4 gap-[1.2vw]">
        <Metric label="Blended TER" value={fees.blendedTERPct} sub={`${fees.blendedTERBps} bps p.a.`} />
        <Metric label="Year-1 fee" value={fees.year1FeeCHF} sub={fees.portfolioSize} />
        <Metric label="Drag p.a. (all-in)" value={fees.totalDragPctPa} sub="incl. ~15 bps trading & FX" />
        <Metric label="15-yr cumulative drag" value={fees.totalDrag15yCHF} sub="vs. zero-fee P50 path" />
      </div>

      <div className="absolute left-[5vw] right-[5vw] top-[48vh] bottom-[6vh]">
        <div className="font-mono uppercase tracking-[0.2em] text-[0.78vw] text-accent mb-[1vh]">
          Breakdown by bucket
        </div>
        <div className="grid grid-cols-[1fr_7vw_7vw_9vw] gap-x-[1.4vw]">
          <Th>Bucket</Th>
          <Th className="text-right">Weight</Th>
          <Th className="text-right">TER (bps)</Th>
          <Th className="text-right">Contribution (bps)</Th>

          <Row r={fees.rows[0]} />
          <Row r={fees.rows[1]} />
          <Row r={fees.rows[2]} />
          <Row r={fees.rows[3]} />
          <Row r={fees.rows[4]} />
          <Row r={fees.rows[5]} />
          <Row r={fees.rows[6]} />
          <Row r={fees.rows[7]} />
          <Row r={fees.rows[8]} />
          <Row r={fees.rows[9]} />
          <Row r={fees.rows[10]} />

          <div className="font-sans text-[0.95vw] text-ink font-medium pt-[1vh]">Total (weighted TER)</div>
          <div className="font-mono tabular-nums text-right text-[0.95vw] text-ink font-medium pt-[1vh]">100.0%</div>
          <div className="font-mono tabular-nums text-right text-[0.95vw] text-ink font-medium pt-[1vh]">—</div>
          <div className="font-mono tabular-nums text-right text-[0.95vw] text-accent font-medium pt-[1vh]">
            {fees.blendedTERBps}.00
          </div>
        </div>
      </div>

      <div className="absolute left-0 right-0 bottom-0 h-[0.6vh] bg-accent/70" />
    </div>
  );
}
