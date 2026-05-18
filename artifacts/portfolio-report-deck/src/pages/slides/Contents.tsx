import { tocSections } from "@/data/reportData";

export default function Contents() {
  const base = import.meta.env.BASE_URL;
  const s = tocSections;
  const linkCls =
    "group flex items-baseline gap-[1.2vw] border-b border-ink/15 py-[1.6vh] hover:border-accent transition-colors no-underline";
  const num = "font-mono text-[1vw] text-accent w-[3vw]";
  const title =
    "font-display text-[2.2vw] text-ink leading-tight flex-1 group-hover:text-accent transition-colors";
  const page = "font-mono text-[1vw] text-ink/50 tabular-nums";

  return (
    <div className="w-screen h-screen overflow-hidden relative bg-paper text-ink">
      <div className="absolute left-[7vw] top-[8vh] right-[7vw] flex items-baseline justify-between">
        <div className="font-mono uppercase tracking-[0.25em] text-[0.9vw] text-accent">
          Table of Contents
        </div>
        <div className="font-mono text-[0.9vw] text-ink/50">p. 02</div>
      </div>

      <div className="absolute left-[7vw] top-[14vh] right-[7vw]">
        <h1 className="font-display font-medium text-[4.2vw] leading-none text-primary">
          Contents.
        </h1>
        <div className="mt-[1.2vh] font-sans text-[1.05vw] text-ink/65 max-w-[44vw]">
          Each entry is a clickable link to the opening slide of that section. Internal hyperlinks survive PPTX export.
        </div>
      </div>

      <div className="absolute left-[7vw] right-[7vw] top-[34vh] bottom-[8vh]">
        {s.map((entry, i) => (
          <a key={entry.n} href={`${base}slide${entry.slide}`} className={linkCls}>
            <span className={num}>{String(i + 1).padStart(2, "0")}</span>
            <span className={title}>{entry.title}</span>
            <span className={page}>{entry.page}</span>
          </a>
        ))}
      </div>
    </div>
  );
}
