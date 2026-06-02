import { test, expect, type Route } from "@playwright/test";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { dismissWelcomeIfPresent, resetAppState } from "./utils";

// Task #317 — end-to-end coverage for the file-load-triggered look-through
// scrape. The paste-import path (Task #259, covered by
// `explain-import-lookthrough-scrape.spec.ts`) already fans out justETF
// scrapes for off-catalog rows; this spec proves the SAME behaviour now
// fires when a saved `.json` portfolio is loaded from a file — the case
// that matters most because a file created on another device carries an
// empty runtime registry, so without the fan-out the Geo / Sector /
// Top-Holdings charts stayed blank until the user re-touched each ISIN.
//
// We mock `/api/lookthrough-scrape/:isin` and assert the engine-derived
// Japan region cell climbs from 0% to ~30% once the mocked scrape
// resolves — proving the file-load path fanned out the on-demand scrape
// and that the registry update propagated through to the GeoExposureMap.

test.beforeEach(async ({ page, context }) => {
  await resetAppState(page, context);
});

// Catalog Equity-USA ETF — contributes only to NA in the engine's
// geoEquity output, so any non-zero Japan weight can only come from the
// off-catalog row's scraped profile.
const ISIN_USA = "IE00B5BMR087";
// 12-char ISIN matching `^[A-Z]{2}[A-Z0-9]{9}\d$` but NOT in the catalog
// → off-universe row with a manualMeta seed of Equity / Global → eligible
// for the on-demand scrape fan-out.
const OFF_CATALOG_ISIN = "XX1234567890";

const EXPLAIN_WORKSPACE_KEY = "investment-lab.explainPortfolio.v1";
const SAVED_PORTFOLIOS_KEY = "investment-lab.savedExplainPortfolios.v1";

// 100% Japan geo so the assertion is unambiguous: the catalog row
// contributes 0 to Japan, the off-catalog row contributes 100 of its own
// equity weight, and after normaliseTo100 over a 100% equity sleeve Japan
// settles at exactly the row's weight (~30%). Equity-only sectors make
// `handleManualScrapeResult` classify the runtime profile as equity.
const SCRAPE_PAYLOAD = {
  isin: OFF_CATALOG_ISIN,
  name: "Mocked Off-Catalog Japan Equity ETF",
  geo: { Japan: 100 },
  sector: { Technology: 50, Financials: 30, Healthcare: 20 },
  currency: { JPY: 100 },
  asOf: "2026-05-11",
  sourceUrl: `https://www.justetf.com/en/etf-profile.html?isin=${OFF_CATALOG_ISIN}`,
};

// A valid personal-portfolio file (v1) carrying one catalog row and one
// off-catalog row. The off-catalog row has a manualMeta seed but no
// look-through profile, so loading it must fan out a scrape.
function buildPortfolioFile() {
  return {
    format: "investment-decision-lab.personal-portfolio",
    schemaVersion: 1,
    app: "Investment Decision Lab",
    exportedAt: "2026-05-11T10:00:00.000Z",
    portfolio: {
      id: "file-load-scrape-test",
      name: "File Load Scrape Test",
      createdAt: 1715420400000,
      workspace: {
        v: 1,
        baseCurrency: "USD",
        // "Very High" caps risk-asset weight at 100% (error threshold
        // cap+15 = 115%), so the 100%-equity sleeve (catalog 70% + the
        // off-catalog row 30%, which resolves to an Equity sleeve via its
        // manualMeta) keeps the diagnosis coherent both BEFORE and AFTER
        // the scrape. With "Moderate" (cap 70%) the restored off-catalog
        // row pushes equity to 100% > 85%, flips the diagnosis to
        // "Inconsistent", and `showAnalysis` hides the GeoExposureMap —
        // which would make this test fail for a reason unrelated to the
        // file-load scrape fan-out it is meant to prove.
        riskAppetite: "Very High",
        horizon: 10,
        hedged: false,
        lookThroughView: true,
        positions: [
          { isin: ISIN_USA, bucketKey: "Equity-USA", weight: 70 },
          {
            isin: OFF_CATALOG_ISIN,
            bucketKey: "",
            weight: 30,
            manualMeta: { assetClass: "Equity", region: "Global" },
          },
        ],
      },
    },
  };
}

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

test.describe("ExplainPortfolio · file-load on-demand look-through scrape (mobile)", () => {
  test("loading a file with an off-catalog ISIN triggers a scrape and Geo card populates without re-typing", async ({
    page,
    context,
  }) => {
    // Gate the scrape response so we can observe both states: the geo
    // card BEFORE the scrape resolves (Japan = 0%) and AFTER (Japan ≈ 30%).
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

    await context.clearCookies();
    await page.goto("/");
    await dismissWelcomeIfPresent(page);

    // Start from a genuinely empty workspace + saved store + runtime
    // registry so the only path to a populated Japan cell is the
    // file-load scrape fan-out.
    await page.evaluate(
      ({ workspaceKey, savedKey }) => {
        window.localStorage.removeItem(workspaceKey);
        window.localStorage.removeItem(savedKey);
      },
      { workspaceKey: EXPLAIN_WORKSPACE_KEY, savedKey: SAVED_PORTFOLIOS_KEY },
    );
    await page.reload();
    await dismissWelcomeIfPresent(page);
    await page.getByRole("tab", { name: /explain my portfolio/i }).tap();

    // Empty-state copy proves the workspace really did get cleared.
    await expect(
      page.getByText(/no positions yet|noch keine positionen/i).first(),
    ).toBeVisible();

    // Write the portfolio file to a temp location and hand it to the
    // hidden file input via the visible "Load from file" button.
    const tmpDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "explain-file-load-scrape-"),
    );
    const filePath = path.join(tmpDir, "portfolio.json");
    await fs.writeFile(filePath, JSON.stringify(buildPortfolioFile(), null, 2));

    const loadFromFile = page.getByTestId("explain-saved-load-file");
    await expect(loadFromFile).toBeVisible();
    await loadFromFile.scrollIntoViewIfNeeded();
    const [fileChooser] = await Promise.all([
      page.waitForEvent("filechooser"),
      loadFromFile.tap(),
    ]);
    await fileChooser.setFiles(filePath);

    // Both rows landed: catalog at index 0, off-universe at index 1.
    await expect(page.getByTestId("explain-row-0")).toBeVisible();
    await expect(page.getByTestId("explain-row-1")).toBeVisible();

    // Sum is 100% → analysis block (and the GeoExposureMap) mounts.
    const analysis = page.getByTestId("explain-analysis");
    await expect(analysis).toBeVisible();

    // BEFORE the scrape resolves the off-catalog row has no profile, so
    // only the catalog row contributes — NA > 0, Japan = 0%.
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

    // Release the gated scrape. Japan must climb to ~30% WITHOUT any
    // picker toggle or further user input.
    releaseScrape!();

    await expect
      .poll(async () => readRegionPercent(page, "Japan"), {
        timeout: 5000,
        message:
          "Japan region cell never reflected the scraped off-catalog profile after file load",
      })
      .toBeGreaterThan(25);

    const japanAfter = await readRegionPercent(page, "Japan");
    expect(Math.abs(japanAfter - 30)).toBeLessThanOrEqual(1);

    // Sanity: the scrape endpoint was actually hit for the off-catalog
    // ISIN. Guards against a regression that bypasses the file-load
    // fan-out and makes the geo card "self-heal" via some other path.
    expect(scrapeHits).toBeGreaterThanOrEqual(1);

    await fs.rm(tmpDir, { recursive: true, force: true });
  });
});
