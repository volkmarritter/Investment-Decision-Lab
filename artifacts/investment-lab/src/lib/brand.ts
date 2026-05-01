// ----------------------------------------------------------------------------
// brand.ts
// ----------------------------------------------------------------------------
// Single source of truth for BICon brand presence inside the Investment
// Decision Lab. The Lab is a public showcase for BICon
// (Business & IT Consulting, www.bicon.li) — every header, footer, PDF
// header and PDF footer pulls its brand strings, links and contact details
// from here so the chrome stays consistent across the app and the exported
// reports. To change the email, the Calendly target, or the brand copy,
// edit this file only.
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

/** Build a `mailto:` URL for the "Professional dialogue" CTA. Adds a
 *  subject line plus a pre-filled body so the inbound message arrives
 *  with the same institutional tone the about.bicon.co marketing site
 *  uses, and so the receiver immediately sees who it is from, what
 *  they were doing on the showcase, and which topics interest them.
 *  The body is intentionally a short structured template — name /
 *  role / topic / availability — rather than free prose so the sender
 *  can fill the blanks in seconds and the receiver can triage just as
 *  fast. Subject and body are fully localised; other surfaces that
 *  link to the inbox (header CTA, footer attribution row, disclaimer
 *  contact link) all flow through this single helper so the wording
 *  stays consistent. */
export function biconContactMailto(lang: Lang): string {
  if (lang === "de") {
    const subject = "Investment Decision Lab — Fachlicher Austausch";
    const body = [
      "Hallo BICon-Team,",
      "",
      "ich habe das Investment Decision Lab näher angeschaut und möchte gerne einen fachlichen Austausch mit Ihnen starten.",
      "",
      "Damit unser Gespräch effizient verläuft, hier kurz zur Einordnung:",
      "  • Name:",
      "  • Rolle / Firma:",
      "  • Thema von Interesse (z. B. Portfoliokonstruktions-Methodik, Look-Through-Analyse, Stresstests, individuelle Integration):",
      "",
      "Ein 30-minütiges Erstgespräch passt mir gut. Mögliche Zeitfenster:",
      "  1)",
      "  2)",
      "  3)",
      "",
      "Freundliche Grüsse",
    ].join("\r\n");
    return (
      `mailto:${BRAND.contactEmail}` +
      `?subject=${encodeURIComponent(subject)}` +
      `&body=${encodeURIComponent(body)}`
    );
  }
  const subject = "Investment Decision Lab — Professional dialogue";
  const body = [
    "Hello BICon team,",
    "",
    "I have been exploring the Investment Decision Lab and would like to start a professional dialogue with you.",
    "",
    "A bit of context to keep our conversation efficient:",
    "  • Name:",
    "  • Role / firm:",
    "  • Topic of interest (e.g. portfolio construction methodology, look-through analysis, stress testing, custom integration):",
    "",
    "A 30-minute introductory call works well for me. Possible time windows:",
    "  1)",
    "  2)",
    "  3)",
    "",
    "Best regards",
  ].join("\r\n");
  return (
    `mailto:${BRAND.contactEmail}` +
    `?subject=${encodeURIComponent(subject)}` +
    `&body=${encodeURIComponent(body)}`
  );
}
