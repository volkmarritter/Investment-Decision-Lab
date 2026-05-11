// ----------------------------------------------------------------------------
// importLookthroughScrape.ts
// ----------------------------------------------------------------------------
// Task #259 — when the Explain tab imports a portfolio (paste-an-ISIN-list
// dialog), off-catalog rows (`manualMeta` set, no curated/runtime profile)
// need their look-through data fetched from justETF so the Geo / Sector /
// Top-Holdings charts populate without the operator having to re-paste the
// ISIN. The on-demand scrape that runs from the row-level `setManualIsin`
// editor only fires on user typing, not on import — so without this helper
// the charts would stay empty until the user re-typed the same ISIN.
//
// This file is a tiny pure helper extracted out of ExplainPortfolio.tsx so
// it can be exercised by a unit test that injects fake `profileFor` and
// `scrape` implementations.
// ----------------------------------------------------------------------------

import {
  scrapeLookthroughForIsin as defaultScrape,
  type ScrapeLookthroughResult,
} from "./etf-api";
import type { LookthroughProfile } from "./lookthrough";
import type { PersonalPosition } from "./personalPortfolio";

const ISIN_RE = /^[A-Z]{2}[A-Z0-9]{9}\d$/;

export interface TriggerImportScrapeDeps {
  profileFor: (isin: string) => LookthroughProfile | null | undefined;
  scrape?: (isin: string) => Promise<ScrapeLookthroughResult>;
  onResult?: (isin: string, result: ScrapeLookthroughResult) => void;
}

// Iterate `rows`, find the off-catalog entries (those with `manualMeta`)
// whose ISIN is well-formed AND has no curated/runtime look-through profile
// yet, and fire `scrape` for each. Returns the list of triggered ISINs so
// callers / tests can assert on the fan-out without awaiting promises.
//
// Catalog rows (no `manualMeta`) are skipped — they always carry curated
// look-through data via the bundled PROFILES table. `found-unassigned`
// rows whose look-through is already covered by bundled overrides are
// also skipped via the `profileFor` guard.
// Task #259 — pure decision helper for the failure-toast mute behavior in
// `ExplainPortfolio.handleManualScrapeResult`. Returns `true` iff the
// scrape-failure red toast should be SUPPRESSED for `trimmed`. The caller
// passes its own `autoClassifiedIsins` ref-set and `allowMute` flag.
//
// - The setManualIsin path passes `allowMute: true` because the parallel
//   EtfInfoPreview Stammdaten scrape may have just auto-classified the row,
//   in which case the in-row amber 0% banner is enough and the redundant
//   red toast would be noise.
// - The import path passes `allowMute: false` — the row's classification
//   came from the import dialog's manualMeta seed, NOT from the parallel
//   Stammdaten auto-classifier, so the operator must always see the
//   failure feedback (even if the same ISIN had been auto-classified
//   earlier in the same session and so happens to live in the ref-set).
export function shouldSuppressScrapeFailureToast(opts: {
  trimmed: string;
  autoClassifiedIsins: ReadonlySet<string>;
  allowMute: boolean;
}): boolean {
  return opts.allowMute && opts.autoClassifiedIsins.has(opts.trimmed);
}

export function triggerImportLookthroughScrapes(
  rows: ReadonlyArray<PersonalPosition>,
  deps: TriggerImportScrapeDeps,
): string[] {
  const scrape = deps.scrape ?? defaultScrape;
  const triggered: string[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    if (!r.manualMeta) continue;
    const trimmed = (r.isin ?? "").trim().toUpperCase();
    if (!ISIN_RE.test(trimmed)) continue;
    if (seen.has(trimmed)) continue;
    seen.add(trimmed);
    if (deps.profileFor(trimmed)) continue;
    triggered.push(trimmed);
    void scrape(trimmed).then((result) => {
      deps.onResult?.(trimmed, result);
    });
  }
  return triggered;
}
