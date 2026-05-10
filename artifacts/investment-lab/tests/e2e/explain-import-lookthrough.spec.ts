import { test, expect } from "@playwright/test";
import { dismissWelcomeIfPresent, resetAppState } from "./utils";

// Task #236 — regression guard for the "stale Look-Through after
// Explain → Import" symptom. Pasting a portfolio in the Explain
// import dialog must drive the Effective Geographic Equity Exposure
// (Look-Through) card to the engine-correct values immediately —
// the user must NOT have to toggle any ETF picker for the card to
// "self-heal".
//
// Strategy: import the user's 9-ISIN reproducer in CHF base, then
// assert each visible region cell of the GeoExposureMap matches the
// engine's `buildLookthrough(...)` output for that exact input.
// The expected numbers below are pinned from the engine-level parity
// test in `tests/explainImportPortfolio.test.ts` ("Task #236 —
// paste-import vs picker look-through parity") and recomputed once
// via `_brwBaseline(lt.geoEquity, "CHF")`. Drift in either the
// engine OR the React state-write path will break this test.

test.beforeEach(async ({ page, context }) => {
  await resetAppState(page, context);
});

const REPRO_TEXT = `IE00B5BMR087 / 25
IE00BKX55T58 / 10
IE0005042456 / 10
IE00BKM4GZ66 / 10
IE00B53QDK08 / 5
IE00B42WWV65 / 10
IE00B3VWP018 / 10
LU1230136894 / 5
IE00B4ND3602 / 15`;

// Engine-derived expected region weights for REPRO_TEXT in CHF base
// (computed from `buildRegionWeights(buildLookthrough(...).geoEquity, "CHF")`).
// Tolerance ±0.15 absorbs the .toFixed(1) display rounding that the
// GeoExposureMap applies to each cell.
const EXPECTED_REGIONS_CHF = {
  NA: 61.8,
  Europe: 3.2,
  Switzerland: 0.4,
  Japan: 11.0,
  EM: 19.1,
} as const;

async function readRegionPercent(
  page: import("@playwright/test").Page,
  region: keyof typeof EXPECTED_REGIONS_CHF,
): Promise<number> {
  // GeoExposureMap tags each region tile with `geo-region-${r}-pct`
  // — a precise scalar locator avoids the strict-mode/multi-match
  // pitfalls of label-only text matching.
  // The Build tab also mounts a GeoExposureMap (kept in the DOM
  // but hidden when Explain is the active tab), so multiple test-id
  // matches exist. Pick the visible one — that's the Explain copy
  // we just drove via the import dialog.
  const cell = page.locator('[data-testid="geo-region-' + region + '-pct"]:visible').first();
  await cell.waitFor({ state: "visible" });
  const txt = (await cell.innerText()) ?? "";
  const m = txt.match(/(\d+(?:\.\d+)?)\s*%/);
  expect(m, `no percent found in geo-region-${region}-pct`).not.toBeNull();
  return Number(m![1]);
}

test.describe("ExplainPortfolio · paste-import look-through (mobile)", () => {
  test("geo card shows engine-correct region weights immediately after import — no picker toggle needed", async ({
    page,
    context,
  }) => {
    await context.clearCookies();
    await page.goto("/");
    await dismissWelcomeIfPresent(page);
    await page.evaluate(() =>
      window.localStorage.removeItem("investment-lab.explainPortfolio.v1"),
    );
    await page.reload();
    await dismissWelcomeIfPresent(page);

    await page.getByRole("tab", { name: /explain my portfolio/i }).tap();

    // Switch base currency to CHF so the Switzerland region cell is
    // active (it is gated to baseCurrency === "CHF"). Default is
    // already CHF — kept explicit so the test is self-contained.
    const baseSel = page.getByTestId("explain-base-currency");
    await baseSel.scrollIntoViewIfNeeded();
    // Open the select and pick CHF if it isn't already.
    const baseTxt = (await baseSel.innerText()) ?? "";
    if (!/CHF/i.test(baseTxt)) {
      await baseSel.tap();
      await page.getByRole("option", { name: /CHF/i }).first().tap();
    }

    // Open the import dialog and paste the reproducer.
    const importBtn = page.getByTestId("explain-import-open");
    await importBtn.scrollIntoViewIfNeeded();
    await importBtn.tap();

    const ta = page.getByTestId("explain-import-textarea");
    await expect(ta).toBeVisible();
    await ta.fill(REPRO_TEXT);

    const submit = page.getByTestId("explain-import-submit");
    await expect(submit).toBeEnabled();
    await submit.tap();

    // All 9 rows are written and the analysis block mounts.
    await expect(page.getByTestId("explain-row-8")).toBeVisible();
    const analysis = page.getByTestId("explain-analysis");
    await expect(analysis).toBeVisible();

    // Look-through is ON by default, so GeoExposureMap is mounted.
    // The header carries "{N}% of portfolio" — pin it to the engine's
    // equityWeightTotal (50% of portfolio for this input).
    await expect(
      analysis
        .getByText(/50\s*%\s+(of total portfolio|des Gesamtportfolios)/i)
        .first(),
    ).toBeVisible();

    // Per-region cells must match the engine output WITHOUT any
    // picker toggle in between. The original bug surfaced exactly
    // here: each cell would show a stale value from the previous
    // workspace until the user opened any IsinPicker.
    const beforeToggle: Record<string, number> = {};
    for (const [key, expected] of Object.entries(EXPECTED_REGIONS_CHF) as [
      keyof typeof EXPECTED_REGIONS_CHF,
      number,
    ][]) {
      const got = await readRegionPercent(page, key);
      beforeToggle[key] = got;
      expect(
        Math.abs(got - expected),
        `region ${key} (post-import): expected ~${expected}%, got ${got}%`,
      ).toBeLessThanOrEqual(0.15);
    }

    // The reported user workaround: "the values self-heal once you
    // toggle any row's ETF picker". Reproduce that exactly — open
    // row 0's IsinPicker (currently IE00B5BMR087, Equity-USA), pick
    // a different in-bucket alternative (IE00BFMXXD54), then pick
    // the original ISIN back. Each pick fires the picker's
    // setState, which is the very code path the user reported as
    // the workaround. If the import path had left any sub-object in
    // `state.positions` stale (different shape than what the picker
    // writers produce), the post-toggle geo values would differ
    // from the pre-toggle snapshot.
    async function pickIsinForRow0(isin: string) {
      const picker = page.getByTestId("explain-picker-0");
      await picker.scrollIntoViewIfNeeded();
      await picker.tap();
      const option = page.getByTestId(`isin-option-${isin}`);
      await expect(option).toBeVisible();
      await option.click({ force: true });
      await expect(option).toBeHidden();
      // Radix Popover overlay can leave `data-scroll-locked` on
      // <body> for ~150ms after close; wait for it to clear before
      // the next interaction.
      await page
        .waitForFunction(
          () => !document.body.hasAttribute("data-scroll-locked"),
          null,
          { timeout: 1000 },
        )
        .catch(() => {});
    }

    await pickIsinForRow0("IE00BFMXXD54");
    await pickIsinForRow0("IE00B5BMR087");
    // Let React flush the second setState + portfolio useMemo recompute.
    await page.waitForTimeout(200);

    for (const [key, expected] of Object.entries(EXPECTED_REGIONS_CHF) as [
      keyof typeof EXPECTED_REGIONS_CHF,
      number,
    ][]) {
      const after = await readRegionPercent(page, key);
      expect(
        Math.abs(after - expected),
        `region ${key} (post-toggle): expected ~${expected}%, got ${after}%`,
      ).toBeLessThanOrEqual(0.15);
      expect(
        Math.abs(after - beforeToggle[key]),
        `region ${key}: post-toggle (${after}%) drifted from post-import (${beforeToggle[key]}%) — regression of the original Task #236 stale-state symptom`,
      ).toBeLessThanOrEqual(0.15);
    }
  });
});
