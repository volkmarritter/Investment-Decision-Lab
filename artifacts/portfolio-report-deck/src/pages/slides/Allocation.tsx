import { allocation } from "@/data/reportData";

const COLORS: Record<string, string> = {
  equity: "var(--bucket-equity)",
  bonds: "var(--bucket-bonds)",
  realestate: "var(--bucket-realestate)",
  cash: "var(--bucket-cash)",
  commodities: "var(--bucket-commodities, #a86f3d)",
  crypto: "var(--bucket-crypto, #6b4f8a)",
};

const GROUP_ORDER: Array<{
  key: "equity" | "realestate" | "bonds" | "commodities" | "crypto" | "cash";
  label: string;
  color: string;
}> = [
  { key: "equity", label: "Equity", color: "#1a3a5c" },
  { key: "realestate", label: "Real estate", color: "#a86f3d" },
  { key: "bonds", label: "Fixed income", color: "#3d7a5c" },
  { key: "commodities", label: "Commodities", color: "#a86f3d" },
  { key: "crypto", label: "Digital assets", color: "#6b4f8a" },
  { key: "cash", label: "Cash", color: "#8a8a8a" },
];

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
          style={{ width: `${widthVw}vw`, background: COLORS[group] ?? "#8a8a8a" }}
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
  const rows = allocation.rows;
  const totals = allocation.groupTotals as Record<string, number | undefined>;
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
          Equity is geographically diversified; the defensive sleeve anchors risk.
        </div>
      </div>

      <div className="absolute left-[7vw] right-[7vw] top-[36vh] bottom-[8vh]">
        {GROUP_ORDER.map((g) => {
          const groupRows = rows.filter((r) => r.group === g.key);
          if (groupRows.length === 0) return null;
          const total = totals[g.key] ?? groupRows.reduce((s, r) => s + r.weight, 0);
          return (
            <div key={g.key}>
              <GroupHeader label={g.label} total={Math.round(total)} color={g.color} />
              {groupRows.map((r, i) => (
                <Row key={`${g.key}-${i}`} label={r.label} weight={r.weight} group={r.group} />
              ))}
            </div>
          );
        })}
      </div>

      <div className="absolute left-0 right-0 bottom-0 h-[0.6vh] bg-accent/70" />
    </div>
  );
}
