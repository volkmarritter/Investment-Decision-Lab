import { test, expect } from "@playwright/test";
import { dismissWelcomeIfPresent } from "./utils";

// Mobile-viewport regression net for Task #21: the Fee Estimator's
// Investment Amount input on the Compare tab must accept a fresh number
// on a phone-sized viewport, live-format with thousand separators, and
// survive a blur without losing the value. The viewport comes from the
// project config (iPhone 13). Sister suite to manual-weight.spec.ts
// (Task #12) — extends the touch-input net to the Compare tab so a
// regression in the touch / blur / IME path on this cell can't leak to
// a phone user.

test.describe("ComparePortfolios · Fee Estimator amount (mobile)", () => {
  test("type 250000, blur, see 250'000 live-formatted and committed", async ({
    page,
  }) => {
    await page.goto("/?tab=compare");
    await dismissWelcomeIfPresent(page);

    // The FeeEstimator only mounts inside the Compare results card, so
    // submit the form first to render it. The submit control is the
    // page's "Compare Portfolios" button.
    const generate = page.getByRole("button", {
      name: /compare portfolios/i,
    });
    await expect(generate).toBeVisible();
    await generate.click();

    // The Fees & Costs (TER) card switches to the mobile A/B Tabs at
    // narrow viewports. Scope to that toggle so we never grab the
    // desktop-only side-by-side instances (still in the DOM via
    // Tailwind's `hidden md:grid`, just not visible on a phone).
    const compareFeesMobile = page.getByTestId("compare-fees-mobile-toggle");
    await expect(compareFeesMobile).toBeVisible();
    const amountInput = compareFeesMobile.getByTestId(
      "input-fee-investment-amount",
    );
    await expect(amountInput).toBeVisible();

    // Initial value is seeded already-formatted as "100'000" so the
    // first render and the live-formatted state match — see the
    // comment block above `formatThousandsLive` in FeeEstimator.tsx.
    await expect(amountInput).toHaveValue("100'000");

    // Type a fresh amount the way a phone user would: tap, fill, blur.
    // formatThousandsLive runs on every onChange, so the display value
    // should land on the grouped form before the blur even happens —
    // and still be there afterwards.
    await amountInput.tap();
    await amountInput.fill("250000");
    await page.locator("header").first().tap();

    await expect(amountInput).toHaveValue("250'000");

    // The cross-portfolio delta sentence reads from the same draft via
    // the lifted `portAFeeAmountDraft`. After the commit it must mention
    // the new reference figure. The delta uses the currency formatter
    // (`Intl.NumberFormat("en-US", { style: "currency" })`), which is
    // explicitly out of scope for the apostrophe switch — only the input
    // itself flips to apostrophes — so the sentence still reads "250,000"
    // verbatim regardless of the base currency.
    await expect(page.getByTestId("compare-fees-delta")).toContainText(
      "250,000",
    );
  });
});
