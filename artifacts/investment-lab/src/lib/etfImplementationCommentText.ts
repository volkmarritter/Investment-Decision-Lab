// ----------------------------------------------------------------------------
// etfImplementationCommentText
// ----------------------------------------------------------------------------
// Pure (React-free) resolver for the text shown in the Build tab's ETF
// Implementation table "Comment" column. Two consumers must stay in sync:
//
//   1. EtfImplementationCommentCell — the on-screen table cell renderer.
//   2. exportEtfImplementationXlsx — the Excel export.
//
// Both must show the same string for the same ETF: the curated `comment`
// always wins; when blank, fall back to the deterministic auto-description
// produced by `describeEtf()` from the look-through profile.
//
// This module owns ONLY the text resolution. Surrounding presentation
// (italic styling, "auto-generated" hint label, JSX wrapper) lives in the
// cell component because it is React-specific and not relevant to Excel.
// ----------------------------------------------------------------------------

import { describeEtf } from "./etfDescription";
import type { Lang } from "./i18n";
import { profileFor } from "./lookthrough";
import type { ETFImplementation } from "./types";

export type EtfCommentInput = Pick<
  ETFImplementation,
  "comment" | "exampleETF" | "isin" | "domicile" | "distribution" | "currency"
>;

export interface ResolvedEtfComment {
  /** The text to display / export. Empty string when neither a curated
   *  comment nor an auto-description is available. */
  text: string;
  /** Which branch the resolver took. The cell uses this to decide whether
   *  to render the "auto-generated" hint label and italic styling; the
   *  export uses it for nothing today but keeping the channel open avoids
   *  another round of refactoring if we ever want a "(auto)" suffix in the
   *  Excel cell. */
  source: "curated" | "auto" | "none";
}

export function resolveEtfImplementationComment(
  etf: EtfCommentInput,
  lang: Lang,
): ResolvedEtfComment {
  if (etf.comment && etf.comment.trim()) {
    return { text: etf.comment, source: "curated" };
  }
  const auto = describeEtf({
    name: etf.exampleETF,
    profile: profileFor(etf.isin),
    catalog: {
      domicile: etf.domicile,
      distribution: etf.distribution,
      currency: etf.currency,
    },
  });
  if (!auto) return { text: "", source: "none" };
  return { text: lang === "de" ? auto.de : auto.en, source: "auto" };
}
