import { profile, meta } from "@/data/reportData";

function Chip({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div
      className={
        "flex flex-col gap-[0.4vh] rounded-[0.4vw] border px-[1.2vw] py-[1.4vh] " +
        (accent ? "border-accent/60 bg-accent/10" : "border-ink/15 bg-paper")
      }
    >
      <div className="font-mono uppercase tracking-[0.2em] text-[0.7vw] text-ink/55">{label}</div>
      <div className={"font-display text-[1.9vw] leading-none " + (accent ? "text-accent" : "text-primary")}>
        {value}
      </div>
    </div>
  );
}

function Toggle({ label, value }: { label: string; value: string }) {
  const on = value !== "Off";
  return (
    <div className="flex items-center justify-between border-b border-ink/10 py-[1.1vh]">
      <span className="font-sans text-[1.05vw] text-ink">{label}</span>
      <span
        className={
          "font-mono text-[0.9vw] uppercase tracking-[0.2em] px-[0.7vw] py-[0.3vh] rounded-full " +
          (on ? "bg-accent/15 text-accent" : "bg-ink/8 text-ink/55")
        }
      >
        {value}
      </span>
    </div>
  );
}

export default function Profile() {
  return (
    <div className="w-screen h-screen overflow-hidden relative bg-paper text-ink">
      <div className="absolute left-[7vw] top-[8vh] right-[7vw] flex items-baseline justify-between">
        <div className="font-mono uppercase tracking-[0.25em] text-[0.9vw] text-accent">
          01 · Profile summary
        </div>
        <div className="font-mono text-[0.9vw] text-ink/50">p. 03</div>
      </div>

      <div className="absolute left-[7vw] top-[14vh] right-[7vw]">
        <h1 className="font-display font-medium text-[4.2vw] leading-none text-primary">
          Investor profile.
        </h1>
        <div className="mt-[1.2vh] font-sans text-[1.05vw] text-ink/65 max-w-[55vw]">
          {meta.profileOneLiner} Jurisdiction: {meta.jurisdiction}. Correlation regime: {meta.correlationRegime}.
        </div>
      </div>

      <div className="absolute left-[7vw] right-[7vw] top-[34vh] grid grid-cols-5 gap-[1.2vw]">
        <Chip label="Base currency" value={profile.baseCurrency} accent />
        <Chip label="Risk profile" value={profile.riskProfile} />
        <Chip label="Horizon" value={`${profile.horizonYears} years`} />
        <Chip label="Target equity" value={`${profile.targetEquityPct}%`} accent />
        <Chip label="# of ETFs" value={String(profile.numEtfs)} />
      </div>

      <div className="absolute left-[7vw] right-[7vw] top-[54vh] bottom-[8vh] grid grid-cols-2 gap-[3vw]">
        <div>
          <div className="font-mono uppercase tracking-[0.25em] text-[0.85vw] text-accent mb-[1.4vh]">
            Engine toggles
          </div>
          <Toggle label="FX hedging on developed equity" value={profile.toggles.hedging} />
          <Toggle label="Bond hedging" value={profile.toggles.bondHedging} />
          <Toggle label="Synthetic ETFs" value={profile.toggles.syntheticEtfs} />
          <Toggle label="Look-through holdings" value={profile.toggles.lookThrough} />
          <Toggle label="Thematic tilts" value={profile.toggles.thematic} />
        </div>
        <div>
          <div className="font-mono uppercase tracking-[0.25em] text-[0.85vw] text-accent mb-[1.4vh]">
            Mandate notes
          </div>
          <div className="font-sans text-[1.05vw] leading-[1.55] text-ink/85">
            A moderate, growth-tilted mandate built for a 15-year holding period. Equity sleeve is geographically broad with an emerging-markets boost reflecting the long horizon. Defensive sleeve stays in CHF — government bonds for duration, corporates for spread, and a globally diversified aggregate hedged into CHF for issuer breadth. FX hedging on developed equity dampens currency drag without giving up the EM diversification benefit.
          </div>
        </div>
      </div>

      <div className="absolute left-0 right-0 bottom-0 h-[0.6vh] bg-accent/70" />
    </div>
  );
}
