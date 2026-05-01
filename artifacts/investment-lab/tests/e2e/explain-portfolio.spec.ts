import { test, expect } from "@playwright/test";
import { dismissWelcomeIfPresent } from "./utils";

// Test ISINs and the catalog buckets they live in. The Explain editor is now
// a tree-of-buckets: every catalog asset class is a collapsible chevron and
// every bucket inside it has its own scoped picker. So adding a known ISIN
// goes through (asset-class chevron) → (bucket [+]) → (scoped picker pick).
const ISIN_USA = "IE00B5BMR087";
const ISIN_FI = "IE00B3F81409";
const ISIN_EUROPE = "IE00B4K48X80";

const BUCKET_USA = "Equity-USA";
const BUCKET_EUROPE = "Equity-Europe";
const BUCKET_FI = "FixedIncome-Global";

const GROUP_EQUITY = "equity"; // asset-class slug → testid suffix
const GROUP_FI = "fixed-income";

async function openExplainTab(page: import("@playwright/test").Page) {
  await page.goto("/");
  await dismissWelcomeIfPresent(page);
  const explainTab = page.getByRole("tab", { name: /explain my portfolio/i });
  await expect(explainTab).toBeVisible();
  await explainTab.tap();
}

// Idempotent expand of an asset-class chevron. Smart default opens groups
// that already carry a position, but the first add inside a group has the
// chevron closed — flip it once if needed and skip otherwise so subsequent
// adds in the same group don't accidentally collapse it again.
async function ensureGroupExpanded(
  page: import("@playwright/test").Page,
  groupSlug: string,
) {
  const toggle = page.getByTestId(`explain-group-${groupSlug}`);
  await expect(toggle).toBeVisible();
  await toggle.scrollIntoViewIfNeeded();
  const state = await toggle.getAttribute("data-state");
  if (state === "closed") await toggle.tap();
}

// Wait for Radix's scroll-lock + pointer-events overlay to fully release
// after a Popover/Select closes. The IsinPicker uses Radix Popover, and on
// mobile the close animation can leave `data-scroll-locked` on <body> for
// ~150ms which makes the very next `tap()` get intercepted by the html
// element. Polling on the attribute is more deterministic than a fixed
// sleep and only adds latency when Radix is actually still locking.
async function waitForRadixOverlayRelease(
  page: import("@playwright/test").Page,
) {
  // 1s ceiling: Radix's close animation is ~150ms; anything longer almost
  // certainly means a real bug (e.g. an overlay that never closes), not a
  // slow animation. Keep the wait tight so the chained-add path through
  // `addCatalogRow` doesn't compound 2s waits across three catalog rows.
  await page.waitForFunction(
    () =>
      !document.body.hasAttribute("data-scroll-locked") &&
      getComputedStyle(document.documentElement).pointerEvents !== "none" &&
      getComputedStyle(document.body).pointerEvents !== "none",
    null,
    { timeout: 1000 },
  );
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
  await picker.scrollIntoViewIfNeeded();
  await picker.tap();
  const option = page.getByTestId(`isin-option-${isin}`);
  await expect(option).toBeVisible();
  // The cmdk group heading (`<div cmdk-group-heading aria-hidden>`) can
  // overlay the option's hit-rect on the iphone-13 viewport once the user
  // scrolls within the popover. Force-click bypasses the interceptor —
  // the option's click handler still fires and the popover closes.
  await option.click({ force: true });
  await expect(option).toBeHidden();
  await waitForRadixOverlayRelease(page);
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

    await addCatalogRow(page, 0, ISIN_USA, BUCKET_USA, GROUP_EQUITY);
    await addCatalogRow(page, 1, ISIN_EUROPE, BUCKET_EUROPE, GROUP_EQUITY);
    await addCatalogRow(page, 2, ISIN_FI, BUCKET_FI, GROUP_FI);

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
    // when lookThrough is on (default). Default base is CHF (matches Build's
    // defaults — Task #149) so Home Bias also mounts, but its rendering is
    // covered by the dedicated NON_USD_BASES tests below; here we only
    // assert the always-on cards.
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

    await addCatalogRow(page, 0, ISIN_USA, BUCKET_USA, GROUP_EQUITY);
    await page.getByTestId("explain-add-manual").tap();

    const manualIsin = page.getByTestId("explain-manual-isin-1");
    await expect(manualIsin).toBeVisible();
    await manualIsin.fill("LU0000000123");

    const assetSelect = page.getByTestId("explain-manual-asset-1");
    await expect(assetSelect).toBeVisible();
    await assetSelect.tap();
    // Radix Select's overlay briefly puts `pointer-events: none` on <html>
    // while the listbox animates open, so a normal mobile tap gets blocked
    // by html intercepting pointer events. Force the click through — same
    // workaround the non-USD home-bias tests below use for `explain-base-
    // currency`. The chained Radix Popover (IsinPicker) opened/closed by
    // `addCatalogRow` above makes this race more likely on iphone-13.
    const fiOption = page.getByRole("option", { name: /^Fixed Income$/ });
    await expect(fiOption).toBeVisible();
    await fiOption.click({ force: true });

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
  // The "default state" first test in this file already covers the USD path
  // (Stress + Geo visible, Home Bias suppressed); the cases below lock in
  // each non-USD branch so a regression in the Explain-specific gating
  // wiring — or in `HOME_LABEL` / `HOME_GEO_KEYS` in `lib/homebias.ts` —
  // would be caught directly, instead of relying on Build's coverage of
  // the shared HomeBiasAnalysis component. Each non-USD base also asserts
  // the CardDescription mentions the expected home-market label, so a
  // future swap of e.g. EUR's label from "Eurozone" to "Germany" wouldn't
  // pass silently. Task #146 expanded this from CHF-only to also cover
  // EUR and GBP.
  const NON_USD_BASES = [
    {
      code: "CHF" as const,
      // CardDescription is `…of the {home} (CHF) tilt…` (en) or
      // `…der {home}-Übergewichtung (CHF)…` (de). Match either label.
      homeLabelRegex: /Switzerland|Schweiz/,
    },
    {
      code: "EUR" as const,
      // EUR's home label is "Eurozone" in both EN and DE (HOME_LABEL).
      homeLabelRegex: /Eurozone/,
    },
    {
      code: "GBP" as const,
      homeLabelRegex: /United Kingdom|Vereinigtes Königreich/,
    },
  ];

  for (const { code, homeLabelRegex } of NON_USD_BASES) {
    test(`switching Explain to ${code} shows Home Bias with the ${code} home market`, async ({
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
      // a fixed-income sleeve so the default High risk profile's equity cap
      // (Build defaults — Task #149) is comfortably satisfied and validation
      // doesn't suppress the analysis cards.
      await addCatalogRow(page, 0, ISIN_USA, BUCKET_USA, GROUP_EQUITY);
      await addCatalogRow(page, 1, ISIN_EUROPE, BUCKET_EUROPE, GROUP_EQUITY);
      await addCatalogRow(page, 2, ISIN_FI, BUCKET_FI, GROUP_FI);
      await setRowWeight(page, 0, "30");
      await setRowWeight(page, 1, "30");
      await setRowWeight(page, 2, "40");
      await expect(page.getByTestId("explain-total")).toContainText(/100(\.0)?\s*%/);

      const analysis = page.getByTestId("explain-analysis");
      await expect(analysis).toBeVisible();

      // Default base was USD before Task #149; the prior "USD default → Home
      // Bias suppressed" sanity check is no longer applicable now that the
      // default is CHF. The positive assertion below (target home label
      // visible after switching to `code`) remains the test's main contract.

      // Flip the base currency. The Select trigger uses Radix under
      // the hood, so we tap to open the listbox and pick the option by
      // role — same pattern the manual-asset-class test uses above. Use
      // `click()` on the option (not `tap()`): Radix auto-focuses the
      // currently-selected option on open which can intercept touch events
      // before the listbox is fully stable on mobile.
      const baseCurrency = page.getByTestId("explain-base-currency");
      await baseCurrency.scrollIntoViewIfNeeded();
      await baseCurrency.tap();
      const targetOption = page.getByRole("option", { name: new RegExp(`^${code}$`) });
      await expect(targetOption).toBeVisible();
      // Radix Select's overlay briefly puts `pointer-events: none` on the
      // root while the listbox animates open on mobile, so a normal click
      // gets blocked by html intercepting pointer events. Force the click
      // through — the option element itself is fully visible and the
      // outcome is verified by the trigger's text changing to the code.
      await targetOption.click({ force: true });
      await expect(baseCurrency).toContainText(code);

      // Non-USD base → Home Bias card renders. Match the title text in
      // either language so this doesn't pin to a particular locale.
      await expect(
        analysis.getByText(/home bias analysis|home-bias-analyse/i).first(),
      ).toBeVisible();

      // The CardDescription template interpolates the per-currency
      // `homeMarketLabel` from `HOME_LABEL`. Asserting the rendered
      // description contains the expected label catches a regression in
      // either the i18n template (`build.homeBias.desc`) or the
      // `HOME_LABEL`/`HOME_GEO_KEYS` wiring on the Explain side. The
      // description text node sits next to the title inside the same
      // card header, so we scope the search to elements that also
      // mention the base code in parens — that's the literal `({base})`
      // substring of the `build.homeBias.desc` template — to avoid false
      // positives from pros/cons bullets or other cards that may also
      // mention the home country.
      await expect(
        analysis
          .getByText(homeLabelRegex)
          .filter({ hasText: new RegExp(`\\(${code}\\)`) })
          .first(),
      ).toBeVisible();
    });
  }
});
