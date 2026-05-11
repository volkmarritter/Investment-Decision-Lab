import { test, expect, type Route } from "@playwright/test";
import { dismissWelcomeIfPresent, resetAppState } from "./utils";

// Task #263 — end-to-end coverage for the import-triggered look-through
// scrape introduced in Task #259. The unit test in
// `tests/importLookthroughScrape.test.ts` already pins the pure helper
// (`triggerImportLookthroughScrapes`) by injecting a fake `scrape`
// implementation, but it does NOT exercise the full UI flow:
//   open Explain → "Import portfolio" → paste a mix of catalog +
//   off-universe ISINs → submit → watch the GeoExposureMap card
//   populate WITHOUT any further user interaction (no picker toggle,
//   no row re-edit).
//
// This spec mocks `/api/lookthrough-scrape/:isin` (same pattern as the
// typed-in regression in `explain-lookthrough-scrape.spec.ts`) and
// asserts that the engine-derived Japan region cell jumps from 0%
// to ~30% once the mocked scrape resolves — proving that the import
// path actually fanned out the on-demand scrape and that the registry
// update propagated through to the GeoExposureMap render.

test.beforeEach(async ({ page, context }) => {
  await resetAppState(page, context);
});

// Catalog Equity-USA ETF — contributes only to NA in the engine's
// geoEquity output, so any non-zero Japan weight in the rendered map
// can ONLY come from the off-catalog row's scraped profile.
const ISIN_USA = "IE00B5BMR087";
// 12-char ISIN that matches `^[A-Z]{2}[A-Z0-9]{9}\d$` but is NOT in
// the catalog → import dialog routes it as `off-universe` with a
// manualMeta seed of Equity / Global → eligible for the on-demand
// scrape fan-out under Task #259.
const OFF_CATALOG_ISIN = "XX1234567890";

// 100% Japan geo so the assertion is unambiguous: the catalog row
// contributes 0 to Japan, the off-catalog row contributes 100 of its
// own equity weight, and after `normaliseTo100` over a 100% equity
// sleeve Japan settles at exactly the row's weight (~30%). The
// sector list deliberately includes equity-only sectors so
// `handleManualScrapeResult`'s `inferredIsEquity` heuristic flags
// the runtime profile as equity (otherwise the row would land in
// the fixed-income sleeve and Japan would stay at 0% on the equity
// map).
const SCRAPE_PAYLOAD = {
  isin: OFF_CATALOG_ISIN,
  name: "Mocked Off-Catalog Japan Equity ETF",
  geo: { Japan: 100 },
  sector: { Technology: 50, Financials: 30, Healthcare: 20 },
  currency: { JPY: 100 },
  asOf: "2026-05-11",
  sourceUrl: `https://www.justetf.com/en/etf-profile.html?isin=${OFF_CATALOG_ISIN}`,
};

async function readRegionPercent(
  page: import("@playwright/test").Page,
  region: "NA" | "Japan",
): Promise<number> {
  const cell = page
    .locator(`[data-testid="geo-region-${region}-pct"]:visible`)
    .first();
  await cell.waitFor({ state: "visible" });
  const txt = (await cell.innerText()) ?? "";
  const m = txt.match(/(\d+(?:\.\d+)?)\s*%/);
  expect(m, `no percent found in geo-region-${region}-pct`).not.toBeNull();
  return Number(m![1]);
}

test.describe("ExplainPortfolio · paste-import on-demand look-through scrape (mobile)", () => {
  test("off-catalog imported row triggers a scrape and Geo card populates without re-typing", async ({
    page,
  }) => {
    // Gate the scrape response so we can deterministically observe both
    // states: the geo card BEFORE the scrape resolves (Japan = 0%, only
    // the catalog row contributes) and AFTER (Japan ≈ 30%, the off-
    // catalog row's mocked profile is now in the runtime registry).
    let releaseScrape: (() => void) | null = null;
    const scrapeReleased = new Promise<void>((resolve) => {
      releaseScrape = resolve;
    });
    let scrapeHits = 0;
    await page.route(/\/api\/lookthrough-scrape\/.+$/, async (route: Route) => {
      const url = new URL(route.request().url());
      const isin = url.pathname.split("/").pop() ?? "";
      if (isin !== OFF_CATALOG_ISIN) {
        return route.fulfill({
          status: 404,
          contentType: "application/json",
          body: JSON.stringify({ error: "not_found" }),
        });
      }
      scrapeHits++;
      await scrapeReleased;
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(SCRAPE_PAYLOAD),
      });
    });

    await page.goto("/");
    await dismissWelcomeIfPresent(page);
    await page.getByRole("tab", { name: /explain my portfolio/i }).tap();

    // Open the import dialog and paste a catalog + off-catalog mix that
    // sums to 100% so the analysis block (and with it the GeoExposureMap)
    // mounts.
    const importBtn = page.getByTestId("explain-import-open");
    await expect(importBtn).toBeVisible();
    await importBtn.scrollIntoViewIfNeeded();
    await importBtn.tap();

    const ta = page.getByTestId("explain-import-textarea");
    await expect(ta).toBeVisible();
    await ta.fill(`${ISIN_USA} / 70\n${OFF_CATALOG_ISIN} / 30`);

    const submit = page.getByTestId("explain-import-submit");
    await expect(submit).toBeEnabled();
    await submit.tap();

    // Two rows landed — catalog at index 0, off-universe at index 1.
    await expect(page.getByTestId("explain-row-0")).toBeVisible();
    await expect(page.getByTestId("explain-row-1")).toBeVisible();
    await expect(
      page.getByTestId("explain-row-badge-off-universe-1"),
    ).toBeVisible();

    // Sum is 100% → analysis block (and the GeoExposureMap) mounts.
    const analysis = page.getByTestId("explain-analysis");
    await expect(analysis).toBeVisible();

    // BEFORE the scrape resolves the off-catalog row has no profile —
    // it's reported as unmapped, equityWeightTotal = 70, and after
    // normaliseTo100 the catalog row's USA contribution fills NA at
    // ~100% with Japan still at 0%.
    const naBefore = await readRegionPercent(page, "NA");
    const japanBefore = await readRegionPercent(page, "Japan");
    expect(
      japanBefore,
      `pre-scrape Japan should be 0% (off-catalog row has no profile yet), got ${japanBefore}%`,
    ).toBeLessThan(0.5);
    expect(
      naBefore,
      `pre-scrape NA should be > 0 (catalog row contributes), got ${naBefore}%`,
    ).toBeGreaterThan(0);

    // Release the gated scrape. The runtime profile is registered,
    // `runtimeProfileVersion` bumps, the `portfolio` useMemo recomputes
    // and the GeoExposureMap re-renders — Japan must climb to ~30%
    // (the off-catalog row's weight, normalised over a 100% equity
    // sleeve) WITHOUT any picker toggle or further user input.
    releaseScrape!();

    await expect
      .poll(
        async () => readRegionPercent(page, "Japan"),
        {
          timeout: 5000,
          message:
            "Japan region cell never reflected the scraped off-catalog profile after import",
        },
      )
      .toBeGreaterThan(25);

    const japanAfter = await readRegionPercent(page, "Japan");
    expect(Math.abs(japanAfter - 30)).toBeLessThanOrEqual(1);

    // Sanity: the scrape endpoint was actually hit for the off-catalog
    // ISIN. Guards against a future change that would silently bypass
    // the import-time fan-out and make the geo card "self-heal" via
    // some other (unintended) path.
    expect(scrapeHits).toBeGreaterThanOrEqual(1);
  });
});
