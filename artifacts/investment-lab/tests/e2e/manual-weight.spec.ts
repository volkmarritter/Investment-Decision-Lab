import { test, expect } from "@playwright/test";

// Mobile-viewport regression net for Task #12: typing a European-decimal
// weight ("12,5") into a manual-weight cell on a phone-sized viewport must
// commit cleanly on blur, surface a "Custom" badge, and be reversible via the
// × reset button. The viewport comes from the project config (iPhone 13).

test.describe("BuildPortfolio · manual weight cell (mobile)", () => {
  test("type '12,5', blur, see 12.5 + Custom badge, reset restores engine value", async ({
    page,
  }) => {
    await page.goto("/");

    // The Build tab is the default. Trigger a portfolio build so the
    // ETF Implementation table renders.
    const generate = page.getByRole("button", { name: /generate portfolio/i });
    await expect(generate).toBeVisible();
    await generate.click();

    // Wait for the ETF Implementation table — at least one row must appear.
    const firstRow = page.locator('[data-testid^="etf-row-"]').first();
    await expect(firstRow).toBeVisible();

    // Pick the first weight input and read its bucket id from the testid.
    // Some rows use the desktop-only narrow layout; scope to the input that's
    // actually visible on a phone.
    const firstWeightInput = page
      .locator('[data-testid^="weight-input-"]')
      .first();
    await expect(firstWeightInput).toBeVisible();
    const testid = await firstWeightInput.getAttribute("data-testid");
    expect(testid).toMatch(/^weight-input-/);
    const bucket = testid!.replace("weight-input-", "");

    // Capture the engine-allocated value so we can assert restoration later.
    const engineValue = await firstWeightInput.inputValue();
    expect(engineValue).toMatch(/^\d+(\.\d+)?$/);

    // Type "12,5" the way a Swiss/German/French user would on their phone,
    // then blur. The cell should commit 12.5 and surface the Custom badge.
    await firstWeightInput.tap();
    await firstWeightInput.fill("12,5");
    // Tap outside the input to blur. Header is reliably present on mobile.
    await page.locator("header").first().tap();

    await expect(firstWeightInput).toHaveValue("12.5");

    const customBadge = page.getByTestId(`custom-badge-${bucket}`);
    await expect(customBadge).toBeVisible();

    // Tap the × reset button — the row must drop the override and restore
    // the engine-allocated weight, badge gone.
    const resetButton = page.getByTestId(`weight-reset-${bucket}`);
    await expect(resetButton).toBeVisible();
    await resetButton.tap();

    await expect(customBadge).toHaveCount(0);
    await expect(firstWeightInput).toHaveValue(engineValue);
  });

  test("Build Portfolio renders and 'Generate Portfolio' produces an ETF table", async ({
    page,
  }) => {
    await page.goto("/");

    // Smoke check that the build tab is visible by default and can render
    // the ETF Implementation table on a mobile viewport — the precondition
    // for every other manual-weight regression we care about.
    const generate = page.getByRole("button", { name: /generate portfolio/i });
    await expect(generate).toBeVisible();
    await generate.click();

    const rows = page.locator('[data-testid^="etf-row-"]');
    await expect(rows.first()).toBeVisible();
    expect(await rows.count()).toBeGreaterThan(0);
  });
});
