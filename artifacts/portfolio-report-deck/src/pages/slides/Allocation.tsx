import { allocation } from "@/data/reportData";

const COLORS: Record<string, string> = {
  equity: "var(--bucket-equity)",
  bonds: "var(--bucket-bonds)",
  realestate: "var(--bucket-realestate)",
  cash: "var(--bucket-cash)",
};

function Row({
  label,
  weight,
  group,
}: {
  label: string;
  weight: number;
  group: string;
}) {
  const widthVw = (weight / 30) * 38; // 30% would fill the bar track
  return (
    <div className="grid grid-cols-[16vw_1fr_3vw] items-center gap-[1vw] py-[0.6vh]">
      <div className="font-sans text-[1vw] text-ink">{label}</div>
      <div className="relative h-[2vh] bg-ink/8 rounded-[0.2vw] overflow-hidden">
        <div
          className="absolute left-0 top-0 bottom-0 rounded-[0.2vw]"
          style={{ width: `${widthVw}vw`, background: COLORS[group] }}
        />
      </div>
      <div className="font-mono text-[1vw] tabular-nums text-right text-ink">
        {weight.toFixed(0)}%
      </div>
    </div>
  );
}

function GroupHeader({ label, total, color }: { label: string; total: number; color: string }) {
  return (
    <div className="flex items-center gap-[0.8vw] mt-[1.4vh] mb-[0.4vh] border-b border-ink/15 pb-[0.4vh]">
      <span className="inline-block w-[0.8vw] h-[0.8vw] rounded-sm" style={{ background: color }} />
      <span className="font-mono uppercase tracking-[0.2em] text-[0.85vw] text-ink/70 flex-1">
        {label}
      </span>
      <span className="font-mono text-[0.95vw] text-ink tabular-nums">{total}%</span>
    </div>
  );
}

export default function Allocation() {
  const r = allocation.rows;
  return (
    <div className="w-screen h-screen overflow-hidden relative bg-paper text-ink">
      <div className="absolute left-[7vw] top-[8vh] right-[7vw] flex items-baseline justify-between">
        <div className="font-mono uppercase tracking-[0.25em] text-[0.9vw] text-accent">
          03 · Target allocation
        </div>
        <div className="font-mono text-[0.9vw] text-ink/50">p. 05</div>
      </div>

      <div className="absolute left-[7vw] top-[14vh] right-[7vw]">
        <h1 className="font-display font-medium text-[4.2vw] leading-none text-primary">
          Where the money sits.
        </h1>
        <div className="mt-[1.2vh] font-sans text-[1.05vw] text-ink/65 max-w-[55vw]">
          Policy weights at the catalog-bucket level after look-through.
          Equity is geographically diversified with an EM tilt; the defensive sleeve is CHF-native.
        </div>
      </div>

      <div className="absolute left-[7vw] right-[7vw] top-[36vh] bottom-[8vh]">
        <GroupHeader label="Equity" total={allocation.groupTotals.equity} color="#1a3a5c" />
        <Row label={r[0].label} weight={r[0].weight} group={r[0].group} />
        <Row label={r[1].label} weight={r[1].weight} group={r[1].group} />
        <Row label={r[2].label} weight={r[2].weight} group={r[2].group} />
        <Row label={r[3].label} weight={r[3].weight} group={r[3].group} />
        <Row label={r[4].label} weight={r[4].weight} group={r[4].group} />
        <Row label={r[5].label} weight={r[5].weight} group={r[5].group} />

        <GroupHeader label="Real estate" total={allocation.groupTotals.realestate} color="#a86f3d" />
        <Row label={r[6].label} weight={r[6].weight} group={r[6].group} />

        <GroupHeader label="Fixed income" total={allocation.groupTotals.bonds} color="#3d7a5c" />
        <Row label={r[7].label} weight={r[7].weight} group={r[7].group} />
        <Row label={r[8].label} weight={r[8].weight} group={r[8].group} />
        <Row label={r[9].label} weight={r[9].weight} group={r[9].group} />

        <GroupHeader label="Cash" total={allocation.groupTotals.cash} color="#8a8a8a" />
        <Row label={r[10].label} weight={r[10].weight} group={r[10].group} />
      </div>

      <div className="absolute left-0 right-0 bottom-0 h-[0.6vh] bg-accent/70" />
    </div>
  );
}
