// Fixture-based scraper tests for the two justETF refresh scripts.
//
// Goal: when justETF changes the markup of its profile pages (label rename,
// data-testid restructure, table layout swap) one of these tests must fail
// loudly in CI BEFORE the next scheduled refresh job silently writes empty
// or malformed values into the override files.
//
// The fixtures live in tests/fixtures/justetf/ and are deliberately small
// synthetic snippets — see the per-file header comments for why we don't
// snapshot the real justETF page.
//
// We import the .mjs scraper modules directly. Both scripts gate their
// `main()` invocation on `process.argv[1] === fileURLToPath(import.meta.url)`
// so importing them does NOT trigger any network fetches.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import {
  CORE_EXTRACTORS,
  LISTINGS_EXTRACTORS,
  VENUE_MAP,
} from "../scripts/refresh-justetf.mjs";
import { extractTopHoldings } from "../scripts/refresh-lookthrough.mjs";

const FIXTURES = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures",
  "justetf",
);
const fx = (name: string) => readFileSync(path.join(FIXTURES, name), "utf8");

describe("refresh-justetf CORE_EXTRACTORS", () => {
  const html = fx("profile-core-fields.html");

  it("parses TER as basis points (rounded)", () => {
    // 0,20 % -> 20 bps
    expect(CORE_EXTRACTORS.terBps(html)).toBe(20);
  });

  it("parses fund size in millions of EUR (handles thousands separator)", () => {
    // "EUR 86,234 m" — the comma here is the thousands separator after the
    // ETL-ish normalization the extractor applies to handle both en-US and
    // de-DE number formats coming off justETF.
    expect(CORE_EXTRACTORS.aumMillionsEUR(html)).toBe(86234);
  });

  it("parses distribution policy (Accumulating)", () => {
    expect(CORE_EXTRACTORS.distribution(html)).toBe("Accumulating");
  });

  it("parses replication and folds full-replication into 'Physical'", () => {
    expect(CORE_EXTRACTORS.replication(html)).toBe("Physical");
  });

  it("parses inception date as ISO yyyy-mm-dd", () => {
    expect(CORE_EXTRACTORS.inceptionDate(html)).toBe("2009-09-25");
  });

  it("returns undefined for fields not present in HTML", () => {
    const empty = "<html><body><p>nothing here</p></body></html>";
    expect(CORE_EXTRACTORS.terBps(empty)).toBeUndefined();
    expect(CORE_EXTRACTORS.aumMillionsEUR(empty)).toBeUndefined();
    expect(CORE_EXTRACTORS.distribution(empty)).toBeUndefined();
    expect(CORE_EXTRACTORS.replication(empty)).toBeUndefined();
    expect(CORE_EXTRACTORS.inceptionDate(empty)).toBeUndefined();
  });
});

describe("refresh-justetf CORE_EXTRACTORS — German locale branches", () => {
  // The scraper hits justETF's English profile (?en=...) by default, but
  // every regex has a parallel DE branch as a defensive fallback in case the
  // page is served in German for some ISINs/regions. These tests guard those
  // DE branches so a label rename on the German profile still trips CI.
  const html = fx("profile-core-fields-de.html");

  it("parses TER from 'Gesamtkostenquote' with comma decimal (0,07 % -> 7 bps)", () => {
    expect(CORE_EXTRACTORS.terBps(html)).toBe(7);
  });

  it("parses fund size from 'Fondsgröße' with dot thousands separator and 'Mio' suffix", () => {
    // "EUR 12.345 Mio" — DE thousands separator is the dot.
    expect(CORE_EXTRACTORS.aumMillionsEUR(html)).toBe(12345);
  });

  it("maps 'Thesaurierend' to 'Accumulating'", () => {
    expect(CORE_EXTRACTORS.distribution(html)).toBe("Accumulating");
  });

  it("maps 'Physisch (Sampling)' to 'Physical (sampled)'", () => {
    expect(CORE_EXTRACTORS.replication(html)).toBe("Physical (sampled)");
  });

  it("parses DE-format inception date '15.05.2010' from Auflagedatum label", () => {
    expect(CORE_EXTRACTORS.inceptionDate(html)).toBe("2010-05-15");
  });
});

describe("refresh-justetf LISTINGS_EXTRACTORS", () => {
  const html = fx("listings-cspx-lse.html");

  it("prefers the share class whose currency matches the catalog primary currency (CSPX over CSP1 on LSE/USD)", () => {
    const out = LISTINGS_EXTRACTORS.listings(html, { currency: "USD" });
    expect(out).toBeDefined();
    expect(out!.LSE).toEqual({ ticker: "CSPX" });
  });

  it("falls back to non-GBX/GBP candidates when no exact currency match is found", () => {
    // Pretend the catalog says CHF (no CHF row exists in the fixture). For
    // LSE the picker must skip the GBX row (CSP1) and return the USD row.
    const out = LISTINGS_EXTRACTORS.listings(html, { currency: "CHF" });
    expect(out!.LSE).toEqual({ ticker: "CSPX" });
  });

  it("maps xlon -> LSE, xetr -> XETRA, vtx -> SIX, ams -> Euronext", () => {
    const out = LISTINGS_EXTRACTORS.listings(html, { currency: "USD" });
    expect(Object.keys(out!).sort()).toEqual(["Euronext", "LSE", "SIX", "XETRA"]);
    expect(out!.XETRA).toEqual({ ticker: "SXR8" });
    expect(out!.SIX).toEqual({ ticker: "CSSPX" });
    expect(out!.Euronext).toEqual({ ticker: "CSPX" });
  });

  it("ignores unmapped venues (mund / Munich)", () => {
    const out = LISTINGS_EXTRACTORS.listings(html, { currency: "USD" });
    // mund is in the fixture but must NOT show up as its own bucket.
    expect((out as Record<string, unknown>).mund).toBeUndefined();
    expect((out as Record<string, unknown>).Munich).toBeUndefined();
  });

  it("returns undefined when the listings table is missing entirely", () => {
    const empty = "<html><body><table>nothing</table></body></html>";
    expect(LISTINGS_EXTRACTORS.listings(empty, { currency: "USD" })).toBeUndefined();
  });

  it("VENUE_MAP keeps the four exchange buckets the UI actually surfaces", () => {
    const buckets = new Set(Object.values(VENUE_MAP));
    expect(buckets).toEqual(new Set(["LSE", "XETRA", "SIX", "Euronext"]));
  });
});

describe("refresh-lookthrough extractTopHoldings", () => {
  const html = fx("top-holdings-iwda.html");

  it("parses the descending Top-10 list and trims to 10 rows", () => {
    const out = extractTopHoldings(html);
    expect(out).toBeDefined();
    expect(out!.length).toBe(10);
    expect(out![0].name).toBe("Apple Inc");
    expect(out![0].pct).toBe(5.21);
    expect(out![9].name).toBe("Eli Lilly and Co");
  });

  it("preserves descending weight ordering (Apple > Microsoft > Nvidia > ...)", () => {
    const out = extractTopHoldings(html)!;
    for (let i = 1; i < out.length; i++) {
      expect(out[i].pct).toBeLessThanOrEqual(out[i - 1].pct);
    }
  });

  it("rejects parses with fewer than 3 valid rows (table must be a real Top-10, not a stray match)", () => {
    const tiny = `
      <table data-testid="etf-holdings_top-holdings_table">
        <tr data-testid="etf-holdings_top-holdings_row">
          <td><a title="Only Holding">Only Holding</a></td>
          <td><span data-testid="row_value_percentage">99.0 %</span></td>
        </tr>
      </table>
    `;
    expect(extractTopHoldings(tiny)).toBeUndefined();
  });

  it("rejects parses whose summed weight exceeds 105 % (likely matched the wrong table)", () => {
    const overweight = `
      <table data-testid="etf-holdings_top-holdings_table">
        ${Array.from({ length: 5 })
          .map(
            (_, i) => `
          <tr data-testid="etf-holdings_top-holdings_row">
            <td><a title="Holding ${i}">Holding ${i}</a></td>
            <td><span data-testid="row_value_percentage">40.0 %</span></td>
          </tr>`,
          )
          .join("")}
      </table>
    `;
    expect(extractTopHoldings(overweight)).toBeUndefined();
  });

  it("rejects parses where weights are not monotonically non-increasing", () => {
    const inverted = `
      <table data-testid="etf-holdings_top-holdings_table">
        <tr data-testid="etf-holdings_top-holdings_row">
          <td><a title="A">A</a></td>
          <td><span data-testid="row_value_percentage">2.0 %</span></td>
        </tr>
        <tr data-testid="etf-holdings_top-holdings_row">
          <td><a title="B">B</a></td>
          <td><span data-testid="row_value_percentage">5.0 %</span></td>
        </tr>
        <tr data-testid="etf-holdings_top-holdings_row">
          <td><a title="C">C</a></td>
          <td><span data-testid="row_value_percentage">1.0 %</span></td>
        </tr>
      </table>
    `;
    expect(extractTopHoldings(inverted)).toBeUndefined();
  });

  it("returns undefined when the holdings table is missing entirely", () => {
    expect(extractTopHoldings("<html><body>nothing</body></html>")).toBeUndefined();
  });
});
