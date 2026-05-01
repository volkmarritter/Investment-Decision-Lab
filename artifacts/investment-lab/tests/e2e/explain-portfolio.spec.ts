import { test, expect } from "@playwright/test";
import { dismissWelcomeIfPresent } from "./utils";

const ISIN_USA = "IE00B5BMR087";
const ISIN_FI = "IE00B3F81409";
const ISIN_EUROPE = "IE00B4K48X80";

async function openExplainTab(page: import("@playwright/test").Page) {
  await page.goto("/");
  await dismissWelcomeIfPresent(page);
  const explainTab = page.getByRole("tab", { name: /explain my portfolio/i });
  await expect(explainTab).toBeVisible();
  await explainTab.tap();
}

async function addCatalogRow(
  page: import("@playwright/test").Page,
  rowIndex: number,
  isin: string,
) {
  await page.getByTestId("explain-add-row").tap();
  const picker = page.getByTestId(`explain-picker-${rowIndex}`);
  await expect(picker).toBeVisible();
  await picker.scrollIntoViewIfNeeded();
  await picker.tap();
  const option = page.getByTestId(`isin-option-${isin}`);
  await expect(option).toBeVisible();
  await option.tap();
  await expect(option).toBeHidden();
}

async function setRowWeight(
  page: import("@playwright/test").Page,
  rowIndex: number,
  weight: string,
) {
  const input = page.getByTestId(`explain-weight-${rowIndex}`);
  await input.scrollIntoViewIfNeeded();
  await input.fill(weight);
}

test.describe("ExplainPortfolio · bring-your-own-ETFs (mobile)", () => {
  test("add three ETFs, weights sum live, normalize, analysis renders, persists across reload", async ({
    page,
    context,
  }) => {
    await context.clearCookies();
    await openExplainTab(page);
    await page.evaluate(() =>
      window.localStorage.removeItem("investment-lab.explainPortfolio.v1"),
    );
    await page.reload();
    await dismissWelcomeIfPresent(page);
    await page.getByRole("tab", { name: /explain my portfolio/i }).tap();

    await expect(
      page.getByText(/no positions yet|noch keine positionen/i).first(),
    ).toBeVisible();

    await addCatalogRow(page, 0, ISIN_USA);
    await addCatalogRow(page, 1, ISIN_EUROPE);
    await addCatalogRow(page, 2, ISIN_FI);

    const total = page.getByTestId("explain-total");
    await expect(total).toContainText(/0(\.0)?\s*%/);

    await setRowWeight(page, 0, "33,3");
    await expect(total).toContainText(/33(\.3)?\s*%/);
    await setRowWeight(page, 1, "33,3");
    await expect(total).toContainText(/66(\.[56])?\s*%/);
    await setRowWeight(page, 2, "30");
    await expect(total).toContainText(/96(\.[56])?\s*%/);

    await expect(
      page.getByText(/weights sum to|summe der gewichte/i).first(),
    ).toBeVisible();

    const normalize = page.getByTestId("explain-normalize");
    await expect(normalize).toBeEnabled();
    await normalize.tap();
    await expect(total).toContainText(/100(\.0)?\s*%/);

    const analysis = page.getByTestId("explain-analysis");
    await expect(analysis).toBeVisible();

    // Tighten: PortfolioMetrics renders the risk-regime toggle and at least
    // one numeric metric (e.g. "5.42%"); MonteCarlo renders the P50/P90
    // legend labels with non-empty currency-formatted percentile values.
    await expect(analysis.getByTestId("risk-regime-toggle")).toBeVisible();
    await expect(analysis.getByText(/median.*p50|median \(p50\)/i).first()).toBeVisible();
    await expect(analysis.getByText(/optimistic.*p90|optimistisch.*p90/i).first()).toBeVisible();
    // mc-mdd-p50 holds the formatted median max-drawdown — proves MC numbers
    // actually computed (not just chrome).
    await expect(analysis.getByTestId("mc-mdd-p50")).toContainText(/-?\d/);

    // Stress Test, Geo Exposure Map, and Home Bias were added in Task #136 to
    // mirror Build's analysis stack. StressTest always renders; the reverse
    // stress sub-table is the only stable testid below the fold. Geo renders
    // when lookThrough is on (default), and Home Bias renders for non-USD
    // bases only — default state here is USD + lookThrough on, so we assert
    // geo + stress are visible and trust Build's coverage for the home-bias
    // gating itself (HomeBiasAnalysis is shared, not forked).
    await expect(analysis.getByTestId("reverse-stress")).toBeVisible();
    await expect(analysis.getByText(/effective geographic|effektive geografische/i).first()).toBeVisible();

    const stored = await page.evaluate(() =>
      window.localStorage.getItem("investment-lab.explainPortfolio.v1"),
    );
    expect(stored).toBeTruthy();
    const parsed = JSON.parse(stored!);
    expect(Array.isArray(parsed.positions)).toBe(true);
    expect(parsed.positions.length).toBe(3);
    expect(parsed.positions.map((p: { isin: string }) => p.isin).sort()).toEqual(
      [ISIN_USA, ISIN_EUROPE, ISIN_FI].sort(),
    );

    await page.reload();
    await dismissWelcomeIfPresent(page);
    await page.getByRole("tab", { name: /explain my portfolio/i }).tap();
    await expect(page.getByTestId("explain-analysis")).toBeVisible();
    await expect(page.getByTestId("explain-total")).toContainText(/100(\.0)?\s*%/);
  });

  test("manual ISIN entry produces an analysis with user-supplied asset class", async ({
    page,
    context,
  }) => {
    await context.clearCookies();
    await openExplainTab(page);
    await page.evaluate(() =>
      window.localStorage.removeItem("investment-lab.explainPortfolio.v1"),
    );
    await page.reload();
    await dismissWelcomeIfPresent(page);
    await page.getByRole("tab", { name: /explain my portfolio/i }).tap();

    await addCatalogRow(page, 0, ISIN_USA);
    await page.getByTestId("explain-add-manual").tap();

    const manualIsin = page.getByTestId("explain-manual-isin-1");
    await expect(manualIsin).toBeVisible();
    await manualIsin.fill("LU0000000123");

    const assetSelect = page.getByTestId("explain-manual-asset-1");
    await expect(assetSelect).toBeVisible();
    await assetSelect.tap();
    await page.getByRole("option", { name: /^Fixed Income$/ }).tap();

    await setRowWeight(page, 0, "60");
    await setRowWeight(page, 1, "40");

    await expect(page.getByTestId("explain-total")).toContainText(/100(\.0)?\s*%/);

    const analysis = page.getByTestId("explain-analysis");
    await expect(analysis).toBeVisible();
    await expect(analysis.getByTestId("mc-mdd-p50")).toContainText(/-?\d/);

    const warnings = page.getByTestId("explain-warnings");
    if (await warnings.count()) {
      await expect(warnings).not.toContainText(/no longer registered|nicht mehr im katalog/i);
    }
  });

  // Task #136 added HomeBiasAnalysis to Explain, but it's gated to non-USD
  // bases (the framing of "home" only makes sense outside the global default).
  // The other Explain test covers the USD path (Stress + Geo visible, Home
  // Bias suppressed); this one locks in the non-USD branch so a regression
  // in the Explain-specific gating wiring would be caught directly, instead
  // of relying on Build's coverage of the shared HomeBiasAnalysis component.
  test("switching Explain to a non-USD base shows Home Bias; flipping back to USD hides it", async ({
    page,
    context,
  }) => {
    await context.clearCookies();
    await openExplainTab(page);
    await page.evaluate(() =>
      window.localStorage.removeItem("investment-lab.explainPortfolio.v1"),
    );
    await page.reload();
    await dismissWelcomeIfPresent(page);
    await page.getByRole("tab", { name: /explain my portfolio/i }).tap();

    // Three catalog ETFs summing to 100% so the analysis block actually
    // renders — Home Bias only mounts inside `explain-analysis`. We mix in
    // a fixed-income sleeve so the default Moderate risk profile's equity
    // cap doesn't trip validation and suppress the analysis cards.
    await addCatalogRow(page, 0, ISIN_USA);
    await addCatalogRow(page, 1, ISIN_EUROPE);
    await addCatalogRow(page, 2, ISIN_FI);
    await setRowWeight(page, 0, "30");
    await setRowWeight(page, 1, "30");
    await setRowWeight(page, 2, "40");
    await expect(page.getByTestId("explain-total")).toContainText(/100(\.0)?\s*%/);

    const analysis = page.getByTestId("explain-analysis");
    await expect(analysis).toBeVisible();

    // Sanity: USD default → Home Bias suppressed.
    const homeBiasTitle = analysis.getByText(/home bias analysis|home-bias-analyse/i);
    await expect(homeBiasTitle).toHaveCount(0);

    // Flip the base currency to CHF. The Select trigger uses Radix under
    // the hood, so we tap to open the listbox and pick the CHF option by
    // role — same pattern the manual-asset-class test uses above. Use
    // `click()` on the option (not `tap()`): Radix auto-focuses the
    // currently-selected option on open which can intercept touch events
    // before the listbox is fully stable on mobile.
    const baseCurrency = page.getByTestId("explain-base-currency");
    await baseCurrency.scrollIntoViewIfNeeded();
    await baseCurrency.tap();
    const chfOption = page.getByRole("option", { name: /^CHF$/ });
    await expect(chfOption).toBeVisible();
    // Radix Select's overlay briefly puts `pointer-events: none` on the
    // root while the listbox animates open on mobile, so a normal click
    // gets blocked by html intercepting pointer events. Force the click
    // through — the option element itself is fully visible and the
    // outcome is verified by the trigger's text changing to "CHF".
    await chfOption.click({ force: true });
    await expect(baseCurrency).toContainText("CHF");

    // Non-USD base → Home Bias card renders. Match the title text in
    // either language so this doesn't pin to a particular locale.
    await expect(
      analysis.getByText(/home bias analysis|home-bias-analyse/i).first(),
    ).toBeVisible();

    // Flip back to USD and confirm the card disappears again. Same
    // forced click as above to dodge Radix's animated overlay.
    await baseCurrency.tap();
    const usdOption = page.getByRole("option", { name: /^USD$/ });
    await expect(usdOption).toBeVisible();
    await usdOption.click({ force: true });
    await expect(baseCurrency).toContainText("USD");

    await expect(
      analysis.getByText(/home bias analysis|home-bias-analyse/i),
    ).toHaveCount(0);
  });
});
