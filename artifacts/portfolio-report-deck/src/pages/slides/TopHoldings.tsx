import { holdings } from "@/data/reportData";

function Th({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={
        "font-mono uppercase tracking-[0.18em] text-[0.75vw] text-ink/55 pb-[0.8vh] border-b border-ink/30 " +
        className
      }
    >
      {children}
    </div>
  );
}

function Cell({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={"font-sans text-[1vw] text-ink py-[1vh] border-b border-ink/10 " + className}>{children}</div>;
}

function Row({ h }: { h: (typeof holdings)[number] }) {
  return (
    <>
      <Cell className="font-mono text-ink/55 tabular-nums">{String(h.n).padStart(2, "0")}</Cell>
      <Cell className="font-medium">{h.name}</Cell>
      <Cell className="text-ink/65 italic text-[0.9vw]">{h.source}</Cell>
      <Cell className="font-mono tabular-nums text-right">{h.pctPortfolio}</Cell>
      <Cell className="font-mono tabular-nums text-right text-accent font-medium">{h.pctEquity}</Cell>
    </>
  );
}

export default function TopHoldings() {
  return (
    <div className="w-screen h-screen overflow-hidden relative bg-paper text-ink">
      <div className="absolute left-[7vw] top-[8vh] right-[7vw] flex items-baseline justify-between">
        <div className="font-mono uppercase tracking-[0.25em] text-[0.9vw] text-accent">
          05 · Top 10 equity holdings
        </div>
        <div className="font-mono text-[0.9vw] text-ink/50">p. 07</div>
      </div>

      <div className="absolute left-[7vw] top-[14vh] right-[7vw]">
        <h1 className="font-display font-medium text-[4.2vw] leading-none text-primary">
          Look-through holdings.
        </h1>
        <div className="mt-[1.2vh] font-sans text-[1.05vw] text-ink/65 max-w-[60vw]">
          Ten largest single names inside the equity sleeve after looking through every ETF to its
          underlying issuers. Shown as % of total portfolio and % of the equity portion.
        </div>
      </div>

      <div className="absolute left-[7vw] right-[7vw] top-[36vh] bottom-[8vh]">
        <div className="grid grid-cols-[3vw_22vw_1fr_8vw_8vw] gap-x-[1.5vw]">
          <Th>#</Th>
          <Th>Holding</Th>
          <Th>Source</Th>
          <Th className="text-right">% of portfolio</Th>
          <Th className="text-right">% of equity</Th>

          <Row h={holdings[0]} />
          <Row h={holdings[1]} />
          <Row h={holdings[2]} />
          <Row h={holdings[3]} />
          <Row h={holdings[4]} />
          <Row h={holdings[5]} />
          <Row h={holdings[6]} />
          <Row h={holdings[7]} />
          <Row h={holdings[8]} />
          <Row h={holdings[9]} />
        </div>
      </div>

      <div className="absolute left-0 right-0 bottom-0 h-[0.6vh] bg-accent/70" />
    </div>
  );
}
