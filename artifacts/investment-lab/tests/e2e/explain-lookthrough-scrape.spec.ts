import { test, expect, type Route } from "@playwright/test";
import { dismissWelcomeIfPresent, resetAppState } from "./utils";

// Task #240 — live regression guard for the on-demand look-through scrape
// added in Task #238. When the user types an off-catalog ISIN into a
// manual Explain row, `setManualIsin` fires
// GET /api/lookthrough-scrape/:isin, registers the result into the
// runtime profile registry, bumps `runtimeProfileVersion` and the
// `portfolio` useMemo recomputes — at which point the destructive
// `alert-lookthrough-unmapped` banner must disappear without a reload
// or any picker toggle.
//
// Strategy: mock the public scrape endpoint with an artificial delay so
// we can observe BOTH states deterministically — the alert must first
// render (off-catalog ISIN present, no profile yet) and must then clear
// once the mocked response resolves and the registry update fires.
//
// Engine + component coverage already lives in
// `tests/runtimeLookthroughPersistence.test.ts`; this spec specifically
// pins the React state-write + memo-recompute wiring so a future
// regression in the in-component scrape glue is caught at the e2e
// boundary too.

test.beforeEach(async ({ page, context }) => {
  await resetAppState(page, context);
});

const ISIN_USA = "IE00B5BMR087"; // catalog default for Equity-USA
const BUCKET_USA = "Equity-USA";
const GROUP_EQUITY = "equity";

// 12-char ISIN that matches the regex (`^[A-Z]{2}[A-Z0-9]{9}\d$`) but
// is NOT in the catalog or the curated look-through registry, so the
// row would be unmapped without the on-demand scrape.
const OFF_CATALOG_ISIN = "XX1234567890";

const SCRAPE_PAYLOAD = {
  isin: OFF_CATALOG_ISIN,
  name: "Mocked Off-Catalog Equity ETF",
  geo: { "United States": 60, Japan: 20, "United Kingdom": 20 },
  sector: { Technology: 40, Financials: 30, Healthcare: 30 },
  currency: { USD: 70, JPY: 20, GBP: 10 },
  asOf: "2026-05-10",
  sourceUrl: `https://www.justetf.com/en/etf-profile.html?isin=${OFF_CATALOG_ISIN}`,
};

async function ensureGroupExpanded(
  page: import("@playwright/test").Page,
  groupSlug: string,
) {
  const toggle = page.getByTestId(`explain-group-${groupSlug}`);
  await expect(toggle).toBeVisible();
  await toggle.scrollIntoViewIfNeeded();
  if ((await toggle.getAttribute("data-state")) === "closed") {
    await toggle.tap();
  }
}

async function addCatalogRow(
  page: import("@playwright/test").Page,
  rowIndex: number,
  isin: string,
  bucketKey: string,
  groupSlug: string,
) {
  await ensureGroupExpanded(page, groupSlug);
  const addBtn = page.getByTestId(`explain-add-in-bucket-${bucketKey}`);
  await expect(addBtn).toBeVisible();
  await addBtn.scrollIntoViewIfNeeded();
  await addBtn.tap();
  const picker = page.getByTestId(`explain-picker-${rowIndex}`);
  await expect(picker).toBeVisible();
  await picker.tap();
  const option = page.getByTestId(`isin-option-${isin}`);
  await expect(option).toBeVisible();
  await option.click({ force: true });
  await expect(option).toBeHidden();
  await page
    .waitForFunction(
      () => !document.body.hasAttribute("data-scroll-locked"),
      null,
      { timeout: 1000 },
    )
    .catch(() => {});
}

test.describe("ExplainPortfolio · on-demand look-through scrape (mobile)", () => {
  test("typing an off-catalog ISIN clears the unmapped-ETF alert once the scrape resolves", async ({
    page,
  }) => {
    // Use a manual gate so we control exactly when the scrape response
    // resolves: assert the destructive alert is visible WHILE the
    // request is still pending, then release the response and assert
    // the alert clears. This avoids a flaky race where the scrape
    // could otherwise resolve before the React render with the
    // pre-scrape (unmapped) state commits.
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

    // Seed a real catalog row so the analysis block has something to
    // compare the off-catalog row against once both weights are set.
    await addCatalogRow(page, 0, ISIN_USA, BUCKET_USA, GROUP_EQUITY);

    // Add an empty manual row at index 1.
    await page.getByTestId("explain-add-manual").tap();

    // Type the off-catalog ISIN. `setManualIsin` fires the scrape
    // immediately on the first onChange whose trimmed value matches
    // the ISIN regex. The mocked endpoint sits on a 1.2s delay so
    // we have a deterministic window in which the runtime profile
    // is still missing — long enough to set both weights and observe
    // the destructive alert before the response resolves.
    const manualIsin = page.getByTestId("explain-manual-isin-1");
    await manualIsin.scrollIntoViewIfNeeded();
    await manualIsin.fill(OFF_CATALOG_ISIN);

    // Drive sum to 100% so `validation.isValid` flips and
    // `explain-analysis` mounts (which is where the look-through
    // alert lives).
    const w0 = page.getByTestId("explain-weight-0");
    await w0.scrollIntoViewIfNeeded();
    await w0.fill("50");
    const w1 = page.getByTestId("explain-weight-1");
    await w1.scrollIntoViewIfNeeded();
    await w1.fill("50");

    const analysis = page.getByTestId("explain-analysis");
    await expect(analysis).toBeVisible();

    const alert = page.getByTestId("alert-lookthrough-unmapped");
    await expect(alert).toBeVisible();
    await expect(
      alert.getByTestId(`unmapped-row-${OFF_CATALOG_ISIN}`),
    ).toBeVisible();

    // Release the gated scrape response. Once it resolves, the runtime
    // profile is registered, `runtimeProfileVersion` bumps, and the
    // portfolio memo recomputes — the alert must disappear without
    // any further user interaction (no reload, no picker toggle).
    releaseScrape!();
    await expect(alert).toBeHidden({ timeout: 5000 });

    // Sanity: the scrape endpoint was actually hit at least once for
    // the off-catalog ISIN — guards against a future change that
    // would silently bypass the on-demand fetch and make the alert
    // clear via some other (unintended) path.
    expect(scrapeHits).toBeGreaterThanOrEqual(1);
  });
});
