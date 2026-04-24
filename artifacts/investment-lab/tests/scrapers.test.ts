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
  lastRefreshedModeFor,
} from "../scripts/refresh-justetf.mjs";
import {
  extractTopHoldings,
  extractBreakdown,
  deriveCurrencyFromGeo,
  COUNTRY_TO_CURRENCY,
  HEDGED_ISINS,
  parseEquityIsinsFromLookthroughSource,
} from "../scripts/refresh-lookthrough.mjs";

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

describe("refresh-justetf lastRefreshedModeFor", () => {
  // Guard for the Snapshot freshness footer (ETFSnapshotFreshness): the
  // "(last refresh job: ...)" hint is only rendered when _meta
  // .lastRefreshedMode is exactly "core" or "listings". The script must
  // never let the raw "all" CLI value leak into the snapshot, otherwise
  // the hint silently disappears for any developer who runs the script
  // without a --mode flag.
  it("preserves explicit CI cadences", () => {
    expect(lastRefreshedModeFor("core")).toBe("core");
    expect(lastRefreshedModeFor("listings")).toBe("listings");
  });

  it("collapses the manual --mode=all run to 'core'", () => {
    expect(lastRefreshedModeFor("all")).toBe("core");
  });

  it("falls back to 'core' for any unexpected value", () => {
    // Defensive: if a future flag accidentally reaches this point, we
    // still want a hint label the UI can display.
    expect(lastRefreshedModeFor(undefined)).toBe("core");
    expect(lastRefreshedModeFor("")).toBe("core");
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

  // justETF emits holding names HTML-entity encoded inside the
  // title="..." attribute (named entities like &amp;, numeric like &#39;,
  // and hex like &#x2014;). The scraper must decode them before writing
  // to the snapshot JSON, otherwise the UI panel renders raw "&amp;"
  // artefacts (regression caught in code review of task #6).
  it("decodes HTML entities in holding names (named, decimal and hex)", () => {
    const encoded = `
      <table data-testid="etf-holdings_top-holdings_table">
        <tr data-testid="etf-holdings_top-holdings_row">
          <td><a title="Johnson &amp; Johnson">Johnson &amp; Johnson</a></td>
          <td><span data-testid="row_value_percentage">3.0 %</span></td>
        </tr>
        <tr data-testid="etf-holdings_top-holdings_row">
          <td><a title="L&#39;Oreal SA">L&#39;Oreal SA</a></td>
          <td><span data-testid="row_value_percentage">2.0 %</span></td>
        </tr>
        <tr data-testid="etf-holdings_top-holdings_row">
          <td><a title="Berkshire Hathaway &#x2014; Class B">Berkshire Hathaway &#x2014; Class B</a></td>
          <td><span data-testid="row_value_percentage">1.0 %</span></td>
        </tr>
      </table>
    `;
    const out = extractTopHoldings(encoded)!;
    expect(out).toBeDefined();
    expect(out.map((h) => h.name)).toEqual([
      "Johnson & Johnson",
      "L'Oreal SA",
      "Berkshire Hathaway \u2014 Class B",
    ]);
  });
});

describe("refresh-lookthrough extractBreakdown", () => {
  // Happy-path fixtures are real Wicket Ajax responses from justETF for
  // IE00B4L5Y983 (iShares Core MSCI World — IWDA), captured live during
  // the endpoint discovery for task #8. They reproduce the exact wire
  // format the refresh job sees in production: an `<ajax-response>` XML
  // envelope with one `<component id="...">` whose `<![CDATA[...]]>`
  // payload contains the same `<table data-testid="etf-holdings_${kind}_
  // table">` markup that justETF also serves on the static profile page.
  // Because the parser regex matches the table markup itself, the same
  // function works on both surfaces.
  const sectorsXml = fx("breakdown-iwda-sectors.xml");
  const countriesXml = fx("breakdown-iwda-countries.xml");

  it("parses the full sectors map from a Wicket Ajax response", () => {
    const out = extractBreakdown(sectorsXml, "sectors");
    expect(out).toBeDefined();
    // Real IWDA snapshot has 11 sector rows + the "Other" bucket = 12.
    expect(Object.keys(out!).length).toBeGreaterThanOrEqual(10);
    expect(out!.Technology).toBe(26.27);
    expect(out!.Financials).toBe(14.51);
    // justETF uses an "Other" bucket to make every breakdown sum to 100 %.
    expect(out!.Other).toBeGreaterThan(0);
    const sum = Object.values(out!).reduce((a, b) => a + b, 0);
    expect(sum).toBeGreaterThanOrEqual(95);
    expect(sum).toBeLessThanOrEqual(105);
  });

  it("parses the full countries map from a Wicket Ajax response", () => {
    const out = extractBreakdown(countriesXml, "countries");
    expect(out).toBeDefined();
    expect(Object.keys(out!).length).toBeGreaterThanOrEqual(10);
    expect(out!["United States"]).toBe(66.27);
    expect(out!.Japan).toBe(5.94);
    expect(out!["United Kingdom"]).toBe(3.45);
    const sum = Object.values(out!).reduce((a, b) => a + b, 0);
    expect(sum).toBeGreaterThanOrEqual(95);
    expect(sum).toBeLessThanOrEqual(105);
  });

  it("parses the same table from a static profile-HTML snippet (top-4 + Other preview)", () => {
    // The static profile page ships only the top-4 + "Other" bucket of
    // each breakdown table (the "Show more" link is what triggers the
    // Wicket Ajax call). The parser must accept that surface too — the
    // table markup is identical, only the row count differs.
    const staticHtml = `
      <table class="table mb-0" data-testid="etf-holdings_sectors_table">
        <tbody>
          <tr data-testid="etf-holdings_sectors_row">
            <td data-testid="tl_etf-holdings_sectors_value_name">Technology</td>
            <td><span data-testid="tl_etf-holdings_sectors_value_percentage">33.99%</span></td>
          </tr>
          <tr data-testid="etf-holdings_sectors_row">
            <td data-testid="tl_etf-holdings_sectors_value_name">Financials</td>
            <td><span data-testid="tl_etf-holdings_sectors_value_percentage">10.49%</span></td>
          </tr>
          <tr data-testid="etf-holdings_sectors_row">
            <td data-testid="tl_etf-holdings_sectors_value_name">Telecommunication</td>
            <td><span data-testid="tl_etf-holdings_sectors_value_percentage">10.27%</span></td>
          </tr>
          <tr data-testid="etf-holdings_sectors_row">
            <td data-testid="tl_etf-holdings_sectors_value_name">Consumer Discretionary</td>
            <td><span data-testid="tl_etf-holdings_sectors_value_percentage">10.05%</span></td>
          </tr>
          <tr data-testid="etf-holdings_sectors_row">
            <td data-testid="tl_etf-holdings_sectors_value_name">Other</td>
            <td><span data-testid="tl_etf-holdings_sectors_value_percentage">35.20%</span></td>
          </tr>
        </tbody>
      </table>
    `;
    const out = extractBreakdown(staticHtml, "sectors");
    expect(out).toBeDefined();
    expect(out!.Technology).toBe(33.99);
    expect(out!.Other).toBe(35.2);
  });

  it("returns undefined when the breakdown table is missing entirely", () => {
    expect(extractBreakdown("<html><body>nothing</body></html>", "countries")).toBeUndefined();
    expect(extractBreakdown("<html><body>nothing</body></html>", "sectors")).toBeUndefined();
  });

  it("accepts a single 100 % row (single-sector / single-country thematic ETFs)", () => {
    // A pure-tech or single-country ETF can legitimately concentrate
    // 100 % of weight into one bucket — the parser must keep it rather
    // than reject it as malformed. The sum guard (95–105 %) still
    // protects against truly empty / broken payloads.
    const onlyOne = `
      <table data-testid="etf-holdings_sectors_table">
        <tr data-testid="etf-holdings_sectors_row">
          <td data-testid="_value_name">Only Sector</td>
          <td><span data-testid="_value_percentage">100.0%</span></td>
        </tr>
      </table>
    `;
    expect(extractBreakdown(onlyOne, "sectors")).toEqual({ "Only Sector": 100 });
  });

  it("returns undefined when the table has zero valid rows", () => {
    const empty = `<table data-testid="etf-holdings_sectors_table"></table>`;
    expect(extractBreakdown(empty, "sectors")).toBeUndefined();
  });

  it("returns undefined when the rows sum well outside 95–105 % (likely matched the wrong table)", () => {
    const wrongTable = `
      <table data-testid="etf-holdings_sectors_table">
        <tr data-testid="etf-holdings_sectors_row">
          <td data-testid="_value_name">Tech</td>
          <td><span data-testid="_value_percentage">30.0%</span></td>
        </tr>
        <tr data-testid="etf-holdings_sectors_row">
          <td data-testid="_value_name">Health</td>
          <td><span data-testid="_value_percentage">15.0%</span></td>
        </tr>
        <tr data-testid="etf-holdings_sectors_row">
          <td data-testid="_value_name">Industrials</td>
          <td><span data-testid="_value_percentage">10.0%</span></td>
        </tr>
      </table>
    `;
    // 55 % is well below the 95 % floor — must be rejected.
    expect(extractBreakdown(wrongTable, "sectors")).toBeUndefined();
  });

  it("returns undefined for unknown breakdown kinds (only 'countries' / 'sectors' supported)", () => {
    // A future caller passing an unsupported kind name (e.g. 'currency')
    // must not silently match an arbitrary table — guards against the
    // currency-breakdown limitation documented in refresh-lookthrough.mjs.
    expect(extractBreakdown("<table>any</table>", "currency" as never)).toBeUndefined();
    expect(extractBreakdown("<table>any</table>", "" as never)).toBeUndefined();
  });

  it("returns undefined for non-string / empty payloads", () => {
    expect(extractBreakdown(undefined as never, "sectors")).toBeUndefined();
    expect(extractBreakdown(null as never, "sectors")).toBeUndefined();
    expect(extractBreakdown("", "sectors")).toBeUndefined();
    expect(extractBreakdown(42 as never, "sectors")).toBeUndefined();
  });
});

describe("refresh-lookthrough deriveCurrencyFromGeo", () => {
  // Currency exposure for an unhedged equity ETF is approximated by
  // re-bucketing its country exposure via the local listing currency for
  // each country (USA → USD, Switzerland → CHF, eurozone members → EUR,
  // etc.). justETF doesn't publish a per-ETF currency table directly, so
  // this is the cleanest auto-refreshable approximation. Currency-hedged
  // share classes (HEDGED_ISINS) deliberately bypass this — for those
  // the curated hedge-currency map remains authoritative.

  it("re-buckets a typical world-equity geo into USD/EUR/JPY/...", () => {
    // Mimics a developed-market index: USA dominates, Japan / UK / Swiss /
    // eurozone fill the rest.
    const geo = {
      "United States": 65,
      Japan: 6,
      "United Kingdom": 4,
      Switzerland: 3,
      France: 4,
      Germany: 4,
      Netherlands: 2,
      Canada: 3,
      Australia: 2,
      Other: 7,
    };
    const out = deriveCurrencyFromGeo(geo);
    expect(out).toBeDefined();
    expect(out!.USD).toBe(65);
    expect(out!.JPY).toBe(6);
    expect(out!.GBP).toBe(4);
    expect(out!.CHF).toBe(3);
    // Eurozone countries collapse into a single EUR bucket.
    expect(out!.EUR).toBe(10);
    expect(out!.CAD).toBe(3);
    expect(out!.AUD).toBe(2);
    expect(out!.Other).toBe(7);
    const sum = Object.values(out!).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(100, 1);
  });

  it("collapses every eurozone member into a single EUR bucket", () => {
    const geo = {
      France: 25,
      Germany: 25,
      Italy: 15,
      Spain: 15,
      Netherlands: 10,
      Ireland: 5,
      Belgium: 5,
    };
    const out = deriveCurrencyFromGeo(geo);
    expect(out).toBeDefined();
    expect(Object.keys(out!)).toEqual(["EUR"]);
    expect(out!.EUR).toBe(100);
  });

  it("passes the 'Other' country bucket straight through to an 'Other' currency bucket", () => {
    // justETF's "Other" row is the normalising remainder; we don't try to
    // attribute a currency to it.
    const geo = { "United States": 70, Other: 30 };
    const out = deriveCurrencyFromGeo(geo);
    expect(out).toBeDefined();
    expect(out!.USD).toBe(70);
    expect(out!.Other).toBe(30);
  });

  it("returns undefined when more than 5 % of weight falls into unmapped countries", () => {
    // 'Atlantis' is not in COUNTRY_TO_CURRENCY. 8 % unmapped > 5 % cap, so
    // the derivation must refuse rather than silently mis-bucket.
    const geo = { "United States": 60, Japan: 32, Atlantis: 8 };
    expect(deriveCurrencyFromGeo(geo)).toBeUndefined();
  });

  it("tolerates ≤ 5 % unmapped weight by routing it into the 'Other' currency bucket", () => {
    // 3 % unmapped is within the tolerance — it folds into Other rather
    // than rejecting the whole derivation.
    const geo = { "United States": 75, Japan: 22, Atlantis: 3 };
    const out = deriveCurrencyFromGeo(geo);
    expect(out).toBeDefined();
    expect(out!.USD).toBe(75);
    expect(out!.JPY).toBe(22);
    expect(out!.Other).toBe(3);
  });

  it("returns undefined for missing or non-object inputs", () => {
    expect(deriveCurrencyFromGeo(undefined as never)).toBeUndefined();
    expect(deriveCurrencyFromGeo(null as never)).toBeUndefined();
    expect(deriveCurrencyFromGeo("not a map" as never)).toBeUndefined();
  });

  it("returns undefined when input rows sum well outside 95–105 %", () => {
    // After re-bucketing through the country map a sum < 95 % can only
    // happen if the geo input itself was malformed. Refusing here stops
    // a corrupted refresh from poisoning the curated currency value.
    expect(deriveCurrencyFromGeo({ "United States": 30, Japan: 20 })).toBeUndefined();
  });

  it("HEDGED_ISINS contains the currency-hedged share classes the script must skip", () => {
    // Pinned so a future drift between the script-side HEDGED_ISINS and
    // the runtime HEDGED_ISINS in src/lib/lookthrough.ts surfaces as a
    // test failure, not as a silently wrong currency map.
    expect(HEDGED_ISINS.has("IE00BCRY6557")).toBe(true);
    expect(HEDGED_ISINS.has("IE00BYX5MS15")).toBe(true);
    expect(HEDGED_ISINS.has("IE00B3ZW0K18")).toBe(true);
    expect(HEDGED_ISINS.has("IE00BDBRDM35")).toBe(true);
    expect(HEDGED_ISINS.has("IE00BDBRDN42")).toBe(true);
    expect(HEDGED_ISINS.has("IE00BDBRDP65")).toBe(true);
    // Spot-check that broad unhedged ETFs are NOT in the set (they MUST
    // get a derived currency map).
    expect(HEDGED_ISINS.has("IE00B4L5Y983")).toBe(false);
  });

  it("COUNTRY_TO_CURRENCY covers every country produced by the live justETF refresh", () => {
    // The refresh script runs against ~11 equity ISINs and produces a
    // bounded set of country names. We pin the union here so a new
    // ISIN/country combination forces an explicit decision about its
    // currency rather than silently rejecting the derivation.
    const liveCountries = [
      "United States", "United Kingdom", "Switzerland", "Japan", "Canada",
      "Australia", "China", "Hong Kong", "Taiwan", "South Korea", "India",
      "Singapore", "Sweden", "Denmark", "Brazil", "South Africa", "Mexico",
      "Israel", "Saudi Arabia", "United Arab Emirates", "Thailand",
      "Indonesia", "Malaysia", "Poland", "Germany", "France", "Italy",
      "Spain", "Netherlands", "Belgium", "Ireland", "Finland", "Portugal",
      "Other",
    ];
    for (const c of liveCountries) {
      expect(COUNTRY_TO_CURRENCY[c]).toBeTruthy();
    }
  });
});

describe("refresh-lookthrough parseEquityIsinsFromLookthroughSource", () => {
  // The monthly top-holdings refresh deliberately skips non-equity ISINs:
  //   - gold ETFs publish no holdings (the fund holds bullion, not equities),
  //   - broad-market crypto baskets publish daily-shifting weights that are
  //     uninformative as a static "Top 10" snapshot.
  // The filter relies on parsing src/lib/lookthrough.ts and matching the
  // `"ISIN": { isEquity: true | false, ... }` literal shape. If anyone ever
  // restructures PROFILES (e.g. moves isEquity out of the inline object,
  // wraps each entry in a helper, or renames the field) the regex would
  // silently match nothing and the script would happily skip every ISIN as
  // "non-equity". This test feeds a synthetic source string covering one of
  // each ISIN class — an equity index, a gold-bullion ETC, a crypto basket
  // — and asserts only the equity ISIN is returned, so any drift in the
  // PROFILES literal shape trips CI loudly.
  const fixtureSrc = `
    export const PROFILES: Record<string, LookthroughProfile> = {
      // Equity index — must be included in the refresh batch.
      "IE00B4L5Y983": {
        isEquity: true,
        geo: { US: 70, JP: 6 },
      },
      // Physical gold ETC — must be excluded.
      "IE00B4ND3602": {
        isEquity: false,
        geo: {},
      },
      // Crypto basket — must be excluded.
      "DE000A27Z304": {
        isEquity: false,
        geo: {},
      },
    };
  `;

  it("returns only ISINs whose PROFILES entry has isEquity: true", () => {
    const equity = parseEquityIsinsFromLookthroughSource(fixtureSrc);
    expect([...equity].sort()).toEqual(["IE00B4L5Y983"]);
  });

  it("excludes the gold ETC and crypto basket ISINs (isEquity: false)", () => {
    const equity = parseEquityIsinsFromLookthroughSource(fixtureSrc);
    expect(equity.has("IE00B4ND3602")).toBe(false);
    expect(equity.has("DE000A27Z304")).toBe(false);
  });

  it("returns an empty Set when no PROFILES entries are present", () => {
    const equity = parseEquityIsinsFromLookthroughSource("export const PROFILES = {};");
    expect(equity.size).toBe(0);
  });

  it("stays in sync with the real lookthrough.ts catalog (sentinel ISINs and minimum count)", () => {
    // Read the actual src/lib/lookthrough.ts and confirm the parser still
    // finds the well-known equity sentinel ISINs the engine ships with.
    // We assert specific ISINs (not just `size > 0`) so a partial regex
    // degradation — e.g. someone wraps a few PROFILES entries in a helper
    // and only the unwrapped ones still match — fails CI loudly instead of
    // sneaking through with a smaller-but-non-zero result.
    const lookthroughTs = readFileSync(
      path.join(
        path.dirname(fileURLToPath(import.meta.url)),
        "..",
        "src",
        "lib",
        "lookthrough.ts",
      ),
      "utf8",
    );
    const equity = parseEquityIsinsFromLookthroughSource(lookthroughTs);

    // Sentinels: a representative slice of the curated equity catalog
    // (broad world, S&P 500, regional, sector). Any of these going missing
    // means either the catalog dropped a pillar holding (worth a code
    // review) or the parser regressed (worth a parser fix) — both warrant
    // a loud CI failure rather than a quiet skip.
    const SENTINEL_EQUITY_ISINS = [
      "IE00B3YLTY66", // MSCI ACWI IMI
      "IE00B5BMR087", // S&P 500 (iShares Core CSPX)
      "IE00B4K48X80", // MSCI Europe IMI
      "IE00BKM4GZ66", // MSCI EM IMI
      "IE00B3WJKG14", // S&P 500 Information Technology
    ];
    for (const isin of SENTINEL_EQUITY_ISINS) {
      expect(equity.has(isin)).toBe(true);
    }

    // Minimum count: the curated catalog has > 10 equity profiles today;
    // a sudden drop below that almost certainly means the parser only
    // matched a subset of entries.
    expect(equity.size).toBeGreaterThanOrEqual(10);

    // Every parsed value still has to be a syntactically valid ISIN.
    for (const isin of equity) {
      expect(isin).toMatch(/^[A-Z]{2}[A-Z0-9]{9}\d$/);
    }
  });
});
