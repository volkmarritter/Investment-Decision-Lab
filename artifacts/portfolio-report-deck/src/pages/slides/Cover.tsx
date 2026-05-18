import { meta, profile } from "@/data/reportData";

export default function Cover() {
  return (
    <div className="w-screen h-screen overflow-hidden relative bg-primary text-paper">
      <div className="absolute inset-0 opacity-[0.06]" aria-hidden="true">
        <svg viewBox="0 0 1920 1080" preserveAspectRatio="none" className="w-full h-full">
          <defs>
            <pattern id="grid" width="80" height="80" patternUnits="userSpaceOnUse">
              <path d="M80 0H0V80" fill="none" stroke="#ffffff" strokeWidth="1" />
            </pattern>
          </defs>
          <rect width="1920" height="1080" fill="url(#grid)" />
        </svg>
      </div>

      <div className="absolute left-[8vw] top-[10vh] flex items-center gap-[1.2vw]">
        <div className="w-[1.4vw] h-[1.4vw] rotate-45 bg-accent" />
        <div>
          <div className="font-mono tracking-[0.3em] text-[1.2vw] text-accent uppercase leading-none">
            Investment Decision Lab
          </div>
          <div className="font-mono tracking-[0.3em] text-[0.78vw] text-paper/70 uppercase mt-[0.6vh]">
            A BICon showcase
          </div>
        </div>
      </div>

      <div className="absolute right-[8vw] top-[10vh] font-mono text-[1.1vw] text-paper/60 text-right">
        <div>Report {meta.reportId}</div>
        <div className="mt-[0.4vh]">Issued {meta.generatedOn}</div>
      </div>

      <div className="absolute left-[8vw] right-[8vw] top-[32vh]">
        <div className="font-display font-medium text-[7.4vw] leading-[0.92] tracking-tight text-paper">
          Portfolio
        </div>
        <div className="font-display font-medium text-[7.4vw] leading-[0.92] tracking-tight text-accent -mt-[1vh]">
          Report.
        </div>
        <div className="mt-[3vh] font-display italic text-[2.2vw] leading-tight text-paper/90 max-w-[60vw]">
          {meta.profileOneLiner}
        </div>
      </div>

      <div className="absolute left-[8vw] right-[8vw] bottom-[14vh] grid grid-cols-4 gap-[2vw]">
        <div>
          <div className="font-mono uppercase tracking-[0.25em] text-[0.85vw] text-paper/50">Base currency</div>
          <div className="mt-[0.6vh] font-display text-[2vw] text-paper">{profile.baseCurrency}</div>
        </div>
        <div>
          <div className="font-mono uppercase tracking-[0.25em] text-[0.85vw] text-paper/50">Correlation regime</div>
          <div className="mt-[0.6vh] font-display text-[2vw] text-paper">{meta.correlationRegime}</div>
        </div>
        <div>
          <div className="font-mono uppercase tracking-[0.25em] text-[0.85vw] text-paper/50">Generated on</div>
          <div className="mt-[0.6vh] font-display text-[2vw] text-paper">{meta.generatedOn}</div>
        </div>
        <div>
          <div className="font-mono uppercase tracking-[0.25em] text-[0.85vw] text-paper/50">Prepared for</div>
          <div className="mt-[0.6vh] font-display text-[2vw] text-paper">{meta.preparedFor}</div>
        </div>
      </div>

      <div className="absolute left-0 right-0 bottom-0 h-[1.2vh] bg-accent" />
    </div>
  );
}
