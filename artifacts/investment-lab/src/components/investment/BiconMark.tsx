// ----------------------------------------------------------------------------
// BiconMark.tsx
// ----------------------------------------------------------------------------
// Tiny inline SVG wordmark used wherever the BICon brand layer surfaces
// (header attribution, footer attribution row, PDF report header, PDF
// report footer). The mark is intentionally vector-only — no `<text>`
// elements — so html2canvas-pro can rasterise it cleanly into the PDF
// export pipeline at any size without font fallbacks.
//
// The rounded square uses `currentColor`, so callers control the brand
// colour by setting a `text-…` Tailwind class (e.g. `text-foreground`,
// `text-muted-foreground`, or an inline slate colour for the PDF). The
// inner "B" path is rendered in white on top of the coloured square.
// ----------------------------------------------------------------------------

import { type CSSProperties } from "react";

interface BiconMarkProps {
  /** Pixel size for the rendered SVG (square). Defaults to 16. */
  size?: number;
  /** Optional className passed through to the SVG (e.g. for colour). */
  className?: string;
  /** Optional inline style override (used by the PDF renderer to lock
   *  in slate colours independent of theme). */
  style?: CSSProperties;
  /** Optional aria-label override. The mark is decorative by default. */
  ariaLabel?: string;
}

export function BiconMark({
  size = 16,
  className,
  style,
  ariaLabel,
}: BiconMarkProps) {
  const decorative = !ariaLabel;
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={className}
      style={style}
      role={decorative ? undefined : "img"}
      aria-hidden={decorative ? true : undefined}
      aria-label={ariaLabel}
      data-testid="bicon-mark"
    >
      <rect width="24" height="24" rx="5" fill="currentColor" />
      <path
        d="M7.5 6.5h5.25c1.66 0 3 1.07 3 2.85 0 1.16-.6 2.04-1.5 2.45 1.2.34 2 1.34 2 2.75 0 1.91-1.43 2.95-3.4 2.95H7.5V6.5zm2.6 4.4h2.4c.84 0 1.45-.45 1.45-1.2 0-.7-.55-1.15-1.4-1.15h-2.45v2.35zm0 4.45h2.7c.95 0 1.55-.5 1.55-1.3 0-.83-.65-1.3-1.6-1.3h-2.65v2.6z"
        fill="#ffffff"
      />
    </svg>
  );
}
