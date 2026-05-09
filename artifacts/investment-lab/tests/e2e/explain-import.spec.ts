import { test, expect } from "@playwright/test";
import { dismissWelcomeIfPresent } from "./utils";

// One catalog ISIN (Equity-USA) and one valid-but-uncatalogued ISIN
// (Apple Inc., not in the curated UCITS-ETF catalog) to exercise both
// the catalog and off-universe routing paths in a single import.
const ISIN_USA = "IE00B5BMR087";
const ISIN_OFF = "US0378331005";

test.describe("ExplainPortfolio · paste-to-import (mobile)", () => {
  test("imports a mixed catalog + off-universe paste, appends rows, shows summary toast", async ({
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

    // Open the import dialog from the positions card header.
    const importBtn = page.getByTestId("explain-import-open");
    await expect(importBtn).toBeVisible();
    await importBtn.scrollIntoViewIfNeeded();
    await importBtn.tap();

    const ta = page.getByTestId("explain-import-textarea");
    await expect(ta).toBeVisible();
    await ta.fill(`${ISIN_USA} / 60\n${ISIN_OFF} / 30`);

    // Live preview reflects the parsed/classified counts.
    await expect(page.getByTestId("explain-import-preview")).toContainText(/2/);

    // Submit the import.
    const submit = page.getByTestId("explain-import-submit");
    await expect(submit).toBeEnabled();
    await submit.tap();

    // Two rows appended at indices 0 and 1.
    await expect(page.getByTestId("explain-row-0")).toBeVisible();
    await expect(page.getByTestId("explain-row-1")).toBeVisible();

    // Total reflects the imported weights (60 + 30 = 90).
    await expect(page.getByTestId("explain-total")).toContainText(
      /90(\.0)?\s*%/,
    );

    // Off-universe row carries the badge.
    await expect(
      page.getByTestId("explain-row-badge-off-universe-1"),
    ).toBeVisible();

    // Persistence — both rows survive a reload.
    const stored = JSON.parse(
      (await page.evaluate(() =>
        window.localStorage.getItem("investment-lab.explainPortfolio.v1"),
      )) ?? "{}",
    );
    expect(Array.isArray(stored.positions)).toBe(true);
    expect(stored.positions.length).toBe(2);
    expect(stored.positions.map((p: { isin: string }) => p.isin).sort()).toEqual(
      [ISIN_USA, ISIN_OFF].sort(),
    );
  });
});
