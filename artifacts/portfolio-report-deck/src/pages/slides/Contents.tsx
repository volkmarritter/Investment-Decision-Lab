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
        <a href={`${base}slide${s[0].slide}`} className={linkCls}>
          <span className={num}>01</span>
          <span className={title}>{s[0].title}</span>
          <span className={page}>{s[0].page}</span>
        </a>
        <a href={`${base}slide${s[1].slide}`} className={linkCls}>
          <span className={num}>02</span>
          <span className={title}>{s[1].title}</span>
          <span className={page}>{s[1].page}</span>
        </a>
        <a href={`${base}slide${s[2].slide}`} className={linkCls}>
          <span className={num}>03</span>
          <span className={title}>{s[2].title}</span>
          <span className={page}>{s[2].page}</span>
        </a>
        <a href={`${base}slide${s[3].slide}`} className={linkCls}>
          <span className={num}>04</span>
          <span className={title}>{s[3].title}</span>
          <span className={page}>{s[3].page}</span>
        </a>
        <a href={`${base}slide${s[4].slide}`} className={linkCls}>
          <span className={num}>05</span>
          <span className={title}>{s[4].title}</span>
          <span className={page}>{s[4].page}</span>
        </a>
        <a href={`${base}slide${s[5].slide}`} className={linkCls}>
          <span className={num}>06</span>
          <span className={title}>{s[5].title}</span>
          <span className={page}>{s[5].page}</span>
        </a>
        <a href={`${base}slide${s[6].slide}`} className={linkCls}>
          <span className={num}>07</span>
          <span className={title}>{s[6].title}</span>
          <span className={page}>{s[6].page}</span>
        </a>
        <a href={`${base}slide${s[7].slide}`} className={linkCls}>
          <span className={num}>08</span>
          <span className={title}>{s[7].title}</span>
          <span className={page}>{s[7].page}</span>
        </a>
      </div>
    </div>
  );
}
