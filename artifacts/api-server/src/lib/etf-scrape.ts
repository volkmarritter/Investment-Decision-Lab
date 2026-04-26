// ----------------------------------------------------------------------------
// etf-scrape.ts
// ----------------------------------------------------------------------------
// Shared helper used by:
//   - POST /api/admin/preview-isin (admin-only, accepts arbitrary ISINs
//     in the new-ETF suggest flow)
//   - GET  /api/etf-preview/:isin  (public, used by the Methodology
//     "swap this bucket's ETF" dialog)
//
// Wraps the scraper module so both callers share the same field set,
// listings parser and policy-fit notes; the only difference is auth +
// payload shape (POST body vs URL param).
// ----------------------------------------------------------------------------

// Cross-artifact import of the pure scraper helpers. The api-server is
// bundled by esbuild, so the .mjs is inlined into dist/index.mjs at build
// time and there's no runtime path-resolution dependency in production.
import * as scraper from "../../../investment-lab/scripts/lib/justetf-extract.mjs";

export interface PreviewResult {
  isin: string;
  fields: Record<string, unknown>;
  listings: unknown;
  policyFit: { aumOk: boolean; terOk: boolean; notes: string[] };
  sourceUrl: string;
}

export class PreviewError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const ISIN_RE = /^[A-Z]{2}[A-Z0-9]{9}\d$/;

export function normalizeIsin(raw: unknown): string {
  return String(raw ?? "").trim().toUpperCase();
}

export async function scrapePreview(rawIsin: unknown): Promise<PreviewResult> {
  const isin = normalizeIsin(rawIsin);
  if (!ISIN_RE.test(isin)) {
    throw new PreviewError(400, "invalid_isin", `Invalid ISIN: ${isin}`);
  }

  let html: string;
  try {
    html = await scraper.fetchProfile(isin);
  } catch (err) {
    throw new PreviewError(
      502,
      "fetch_failed",
      err instanceof Error ? err.message : "Unknown fetch error",
    );
  }

  const fields: Record<string, unknown> = {};
  // Core fields used by the catalog (TER, AUM, inception, replication,
  // distribution) come from CORE_EXTRACTORS. The preview-only set adds
  // name/currency/domicile which are otherwise curated by hand.
  for (const [k, fn] of Object.entries(scraper.CORE_EXTRACTORS)) {
    try {
      fields[k] = (fn as (h: string) => unknown)(html);
    } catch {
      fields[k] = undefined;
    }
  }
  for (const [k, fn] of Object.entries(scraper.PREVIEW_EXTRACTORS)) {
    try {
      const v = (fn as (h: string) => unknown)(html);
      if (v !== undefined) fields[k] = v;
    } catch {
      // Skip silently — UI shows "—" for missing fields.
    }
  }
  // Listings are returned but not validated against VENUE_MAP — the user
  // edits/confirms them before applying.
  let listings: unknown = undefined;
  try {
    listings = (scraper.LISTINGS_EXTRACTORS.listings as (h: string) => unknown)(
      html,
    );
  } catch {
    listings = undefined;
  }

  const aum =
    typeof fields.aumMillionsEUR === "number"
      ? (fields.aumMillionsEUR as number)
      : undefined;
  const ter =
    typeof fields.terBps === "number" ? (fields.terBps as number) : undefined;
  const policyFit = {
    aumOk: aum !== undefined && aum > 100,
    terOk: ter !== undefined && ter < 30,
    notes: [] as string[],
  };
  if (aum === undefined) policyFit.notes.push("AUM not detected — verify manually.");
  if (ter === undefined) policyFit.notes.push("TER not detected — verify manually.");

  return {
    isin,
    fields,
    listings,
    policyFit,
    sourceUrl: `https://www.justetf.com/en/etf-profile.html?isin=${isin}`,
  };
}
