// ----------------------------------------------------------------------------
// brand.ts
// ----------------------------------------------------------------------------
// Single source of truth for BICon brand presence inside the Investment
// Decision Lab. The Lab is a public showcase for BICon
// (Business & IT Consulting, www.bicon.li) — every header, footer, PDF
// header and PDF footer pulls its brand strings, links and contact details
// from here so the chrome stays consistent across the app and the exported
// reports. To change the email, the Calendly target, or the wordmark
// styling, edit this file (and the BiconMark SVG component) only.
// ----------------------------------------------------------------------------

import type { Lang } from "@/lib/i18n";

export const BRAND = {
  /** Display name. Note the deliberate "BIC" capitalisation followed by
   *  lowercase "on" — that is the official wordmark on bicon.li. Keep it
   *  consistent everywhere copy renders the brand name. */
  name: "BICon",
  /** Long-form attribution used in the footer copyright line. */
  fullName: "BICon | Business & IT Consulting",
  /** Discipline tagline that already lived in the existing footer. */
  disciplineTagline: "Strategy. Technology. Financial Services.",
  /** German landing page (root). */
  urlDe: "https://www.bicon.li",
  /** English landing page (subpath). */
  urlEn: "https://www.bicon.li/en/",
  /** Bare host shown on outbound buttons / PDF footer for compactness. */
  hostLabel: "bicon.li",
  /** Public contact mailbox. Routed into the "Talk to us" CTA, the footer
   *  attribution row and the PDF brand footer. Edit this single line if
   *  the destination address changes. */
  contactEmail: "info@bicon.li",
  /** ISO copyright year — refreshed once a year. Kept here rather than
   *  computed at render time so the same string appears in PDF exports
   *  generated across midnight without flicker. */
  copyrightYear: 2026,
} as const;

/** Language-aware outbound URL to bicon.li. Mirrors the toggle that
 *  already existed in DisclaimerFooter. */
export function biconSiteUrl(lang: Lang): string {
  return lang === "de" ? BRAND.urlDe : BRAND.urlEn;
}

/** Build a `mailto:` URL for the "Talk to us" CTA. Adds a subject line so
 *  the receiver can immediately see the lead came from the showcase. */
export function biconContactMailto(lang: Lang): string {
  const subject =
    lang === "de"
      ? "Investment Decision Lab — Gespräch buchen"
      : "Investment Decision Lab — Book a call";
  return `mailto:${BRAND.contactEmail}?subject=${encodeURIComponent(subject)}`;
}
