import { etfs } from "@/data/reportData";

function Th({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={
        "font-mono uppercase tracking-[0.18em] text-[0.7vw] text-ink/55 pb-[0.6vh] border-b border-ink/30 " +
        className
      }
    >
      {children}
    </div>
  );
}

function Cell({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={"font-sans text-[0.82vw] text-ink leading-[1.25] " + className}>{children}</div>;
}

function Row({ e }: { e: (typeof etfs)[number] }) {
  return (
    <>
      <Cell className="font-mono text-ink/55 tabular-nums">{String(e.n).padStart(2, "0")}</Cell>
      <Cell>
        <div className="font-medium text-ink">{e.name}</div>
        <div className="font-mono text-[0.7vw] text-ink/55 mt-[0.2vh]">
          {e.bucket} · {e.exchange} · {e.currency} · {e.distribution}
        </div>
      </Cell>
      <Cell className="font-mono tabular-nums text-ink/80">{e.isin}</Cell>
      <Cell className="font-mono tabular-nums text-ink/80">{e.ticker}</Cell>
      <Cell className="font-mono tabular-nums text-right">{e.ter}</Cell>
      <Cell className="font-mono tabular-nums text-right font-medium">{e.weight}</Cell>
      <Cell className="text-ink/75 italic">{e.comment}</Cell>
    </>
  );
}

export default function Implementation() {
  return (
    <div className="w-screen h-screen overflow-hidden relative bg-paper text-ink">
      <div className="absolute left-[5vw] top-[6vh] right-[5vw] flex items-baseline justify-between">
        <div className="font-mono uppercase tracking-[0.25em] text-[0.9vw] text-accent">
          04 · ETF implementation
        </div>
        <div className="font-mono text-[0.9vw] text-ink/50">p. 06</div>
      </div>

      <div className="absolute left-[5vw] top-[11vh] right-[5vw]">
        <h1 className="font-display font-medium text-[3.6vw] leading-none text-primary">
          The instruments.
        </h1>
        <div className="mt-[0.8vh] font-sans text-[0.95vw] text-ink/65 max-w-[60vw]">
          Ten UCITS ETFs implement the policy — chosen for low TER, tight tracking, broad coverage,
          and Swiss listing where possible.
        </div>
      </div>

      <div className="absolute left-[5vw] right-[5vw] top-[27vh] bottom-[6vh]">
        <div className="grid grid-cols-[2.5vw_22vw_8.5vw_5vw_4.5vw_5vw_1fr] gap-x-[1vw] gap-y-[1.1vh]">
          <Th>#</Th>
          <Th>ETF · bucket · exchange · ccy · dist.</Th>
          <Th>ISIN</Th>
          <Th>Ticker</Th>
          <Th className="text-right">TER</Th>
          <Th className="text-right">Weight</Th>
          <Th>Comment</Th>

          {etfs.map((e) => (
            <Row key={`${e.n}-${e.isin}`} e={e} />
          ))}
        </div>
      </div>

      <div className="absolute left-0 right-0 bottom-0 h-[0.6vh] bg-accent/70" />
    </div>
  );
}
