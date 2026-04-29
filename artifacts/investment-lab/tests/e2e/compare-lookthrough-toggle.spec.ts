import { test, expect } from "@playwright/test";
import { dismissWelcomeIfPresent } from "./utils";

// Task #98 — regression net for the per-slot Look-Through toggle on the
// Compare tab. This pins the round-trip behaviour the task introduced
// (both ON → A OFF → both OFF → A back ON) end-to-end so a future
// refactor of `rebuildSide` or the per-side gating predicates can't
// silently regress to either:
//   - the wrapping Card staying mounted when both sides are OFF, or
//   - a side's column reappearing after that side has been toggled OFF.
//
// Cards under test:
//   - Geographic Exposure (GeoExposureMap renders its own Card with the
//     unique title "Effective Geographic Equity Exposure")
//   - Look-Through Analysis (wrapping Card,
//     data-testid="compare-lookthrough-analysis-card")
//   - Top 10 Equity Holdings (Look-Through) (wrapping Card,
//     data-testid="compare-top10-holdings-card")
//
// All three live under the same per-slot gating predicate
// (`inputA.lookThroughView || inputB.lookThroughView`) so a single
// driver covers all three.
//
// The Playwright project uses an iPhone 13 viewport (see
// playwright.config.ts), so we run against the mobile branch of
// renderLookThroughSection. On mobile, when both sides are ON the
// section uses an A/B Tabs control (data-testid="*-mobile-toggle");
// when only one side is ON the Tabs control collapses to a single
// labelled column with no A/B switcher (matches Build's behaviour).

test.describe("ComparePortfolios · per-slot Look-Through toggle (mobile)", () => {
  test("toggle round-trip: both ON → A OFF → both OFF → A back ON", async ({
    page,
  }) => {
    await page.goto("/?tab=compare");
    await dismissWelcomeIfPresent(page);

    // Both per-slot Look-Through toggles default to ON in Compare's
    // form (see CompareFormValues.portA/portB defaults), so a fresh
    // submit lands us in the "both ON" branch of the renderer.
    const aSwitch = page.getByTestId("compare-a-lookthrough-switch");
    const bSwitch = page.getByTestId("compare-b-lookthrough-switch");
    await expect(aSwitch).toBeVisible();
    await expect(bSwitch).toBeVisible();
    await expect(aSwitch).toHaveAttribute("data-state", "checked");
    await expect(bSwitch).toHaveAttribute("data-state", "checked");

    const generate = page.getByRole("button", { name: /compare portfolios/i });
    await expect(generate).toBeVisible();
    await generate.click();

    // Locator helpers. We scope to the wrapping section testids so the
    // assertions can't accidentally match the BuildPortfolio tab's
    // GeoExposureMap (the parent app uses `forceMount` on every tab,
    // so Build's render tree is always in the DOM even when the
    // Compare tab is the visible one).
    const ltCard = page.getByTestId("compare-lookthrough-analysis-card");
    const top10Card = page.getByTestId("compare-top10-holdings-card");
    const geoSection = page.getByTestId("compare-geo-section");
    const geoMobileTabs = geoSection.getByTestId("geo-mobile-toggle");
    const ltMobileTabs = ltCard.getByTestId("compare-lookthrough-mobile-toggle");
    const top10MobileTabs = top10Card.getByTestId(
      "compare-topholdings-mobile-toggle",
    );

    // ── Step 1: both ON (default after first generate) ────────────────
    // The wrapping Cards / section must be mounted and the mobile A/B
    // Tabs control for each look-through section must render — that's
    // the tell that both sides have a column. Each Tabs control
    // exposes a "Portfolio B" tab trigger button.
    await expect(geoSection).toBeVisible();
    await expect(ltCard).toBeVisible();
    await expect(top10Card).toBeVisible();
    await expect(geoMobileTabs).toBeVisible();
    await expect(ltMobileTabs).toBeVisible();
    await expect(top10MobileTabs).toBeVisible();
    await expect(
      geoMobileTabs.getByRole("tab", { name: "Portfolio B" }),
    ).toBeVisible();
    await expect(
      ltMobileTabs.getByRole("tab", { name: "Portfolio B" }),
    ).toBeVisible();
    await expect(
      top10MobileTabs.getByRole("tab", { name: "Portfolio B" }),
    ).toBeVisible();
    // GeoExposureMap renders inside the geo section with its localised
    // title — pin it explicitly so this is a true Geographic Exposure
    // card check, not just a presence check on the wrapper.
    await expect(
      geoSection.getByText("Effective Geographic Equity Exposure").first(),
    ).toBeVisible();

    // ── Step 2: toggle A OFF (only B should render) ───────────────────
    // The cards must stay mounted (B is still ON) but the A/B Tabs
    // control collapses to a single labelled column for B. We assert
    // the absence of the Tabs and the presence of a "Portfolio B"
    // heading inside each card — but no "Portfolio A" heading inside
    // them, which is what would surface if A's column leaked back.
    await aSwitch.click();
    await expect(aSwitch).toHaveAttribute("data-state", "unchecked");

    await expect(geoSection).toBeVisible();
    await expect(ltCard).toBeVisible();
    await expect(top10Card).toBeVisible();
    // Only B is visible now → no mobile A/B tabs anywhere in the
    // three look-through sections.
    await expect(geoMobileTabs).toHaveCount(0);
    await expect(ltMobileTabs).toHaveCount(0);
    await expect(top10MobileTabs).toHaveCount(0);

    // The single column inside each section belongs to B, not A.
    await expect(
      geoSection.getByRole("heading", { name: "Portfolio B" }),
    ).toBeVisible();
    await expect(
      geoSection.getByRole("heading", { name: "Portfolio A" }),
    ).toHaveCount(0);
    // GeoExposureMap card content still renders (B's instance only).
    await expect(
      geoSection.getByText("Effective Geographic Equity Exposure").first(),
    ).toBeVisible();
    await expect(
      ltCard.getByRole("heading", { name: "Portfolio B" }),
    ).toBeVisible();
    await expect(
      ltCard.getByRole("heading", { name: "Portfolio A" }),
    ).toHaveCount(0);
    await expect(
      top10Card.getByRole("heading", { name: "Portfolio B" }),
    ).toBeVisible();
    await expect(
      top10Card.getByRole("heading", { name: "Portfolio A" }),
    ).toHaveCount(0);

    // ── Step 3: toggle B OFF (both OFF → entire sections gone) ────────
    // The wrapping Cards for Look-Through Analysis and Top 10 Holdings
    // must unmount entirely (no empty card shell, no "off for portfolio
    // X" placeholder), and the geographic section's wrapper must
    // unmount too.
    await bSwitch.click();
    await expect(bSwitch).toHaveAttribute("data-state", "unchecked");

    await expect(geoSection).toHaveCount(0);
    await expect(ltCard).toHaveCount(0);
    await expect(top10Card).toHaveCount(0);
    await expect(geoMobileTabs).toHaveCount(0);
    await expect(ltMobileTabs).toHaveCount(0);
    await expect(top10MobileTabs).toHaveCount(0);

    // ── Step 4: toggle A back ON (only A should render) ───────────────
    // The cards re-mount with A's column only — no B leakage. This is
    // the tightest check on rebuildSide: A's switch flip must re-run
    // A's portfolio so the gating predicate sees A.lookThroughView
    // back to true, and B must stay OFF (no surprise re-mount of B's
    // column).
    await aSwitch.click();
    await expect(aSwitch).toHaveAttribute("data-state", "checked");
    await expect(bSwitch).toHaveAttribute("data-state", "unchecked");

    await expect(geoSection).toBeVisible();
    await expect(ltCard).toBeVisible();
    await expect(top10Card).toBeVisible();
    // Single side visible → no A/B Tabs.
    await expect(geoMobileTabs).toHaveCount(0);
    await expect(ltMobileTabs).toHaveCount(0);
    await expect(top10MobileTabs).toHaveCount(0);

    // The single visible column belongs to A, with no B leakage.
    await expect(
      geoSection.getByRole("heading", { name: "Portfolio A" }),
    ).toBeVisible();
    await expect(
      geoSection.getByRole("heading", { name: "Portfolio B" }),
    ).toHaveCount(0);
    // GeoExposureMap card content renders again (A's instance only).
    await expect(
      geoSection.getByText("Effective Geographic Equity Exposure").first(),
    ).toBeVisible();
    await expect(
      ltCard.getByRole("heading", { name: "Portfolio A" }),
    ).toBeVisible();
    await expect(
      ltCard.getByRole("heading", { name: "Portfolio B" }),
    ).toHaveCount(0);
    await expect(
      top10Card.getByRole("heading", { name: "Portfolio A" }),
    ).toBeVisible();
    await expect(
      top10Card.getByRole("heading", { name: "Portfolio B" }),
    ).toHaveCount(0);
  });
});
