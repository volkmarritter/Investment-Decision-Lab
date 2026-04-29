import { test, expect } from "@playwright/test";
import { dismissWelcomeIfPresent } from "./utils";

// Mobile-viewport regression net for Task #97: the Risk-Free Rates editor
// (commit on blur) and the CMA μ / σ overrides (commit on Apply, like
// home-bias) are the two remaining comma-decimal-friendly editors on the
// Methodology page that Task #21 left covered only by unit tests of the
// parser. A regression in the touch / blur / IME path on those cells —
// especially the on-blur commit on RF rates — would still leak to a phone
// user. Sister suite to methodology-home-bias.spec.ts (Task #21); follows
// the same hash-routed accordion expansion + tap/fill/blur pattern.

test.describe("Methodology · Risk-Free rate cell (mobile, blur commit)", () => {
  test("type '2,75' into EUR RF, blur outside, see 2.75 + per-row reset enabled", async ({
    page,
  }) => {
    // Hash routing auto-opens the risk-free accordion and scrolls it into
    // view (see VALID_SECTION_IDS in Methodology.tsx). Loading
    // /?tab=methodology lands on the Methodology tab on first paint, and
    // the #risk-free fragment expands the editor without any extra clicks.
    await page.goto("/?tab=methodology#risk-free");
    await dismissWelcomeIfPresent(page);

    const eurInput = page.getByTestId("input-rf-EUR");
    await expect(eurInput).toBeVisible();
    // Default state: per-row reset disabled, since EUR has no override yet.
    const resetEur = page.getByTestId("button-rf-reset-EUR");
    await expect(resetEur).toBeDisabled();

    // Type "2,75" the way a Swiss/German/French user would on their phone,
    // then blur by tapping outside. The RF editor commits on blur (its
    // contract differs from home-bias / CMA, which commit on Apply), so
    // tapping outside is enough to drive applyRf.
    await eurInput.tap();
    await eurInput.fill("2,75");
    await page.locator("header").first().tap();

    // After commit, parseDecimalInput("2,75") = 2.75 → setRiskFreeRate
    // stores 0.0275 → subscribeRiskFreeRate refills the draft via
    // buildRfDraft as (rate * 100).toFixed(2) = "2.75".
    await expect(eurInput).toHaveValue("2.75");
    // Per-row reset flips to enabled because EUR is now in rfOverrides.
    await expect(resetEur).toBeEnabled();
  });
});

test.describe("Methodology · CMA µ override cell (mobile, Apply commit)", () => {
  test("type '8,5' into US-equity µ, blur + Apply, see Source flip to Custom", async ({
    page,
  }) => {
    // Same hash-routed expansion pattern as the RF test above — load the
    // Methodology tab with the #cma fragment so the editor is mounted and
    // visible without an extra accordion click.
    await page.goto("/?tab=methodology#cma");
    await dismissWelcomeIfPresent(page);

    const muInput = page.getByTestId("cma-mu-equity_us");
    await expect(muInput).toBeVisible();
    // Default state: empty draft + the µ source badge for this row reads
    // "Engine" or "Consensus" (anything but "Custom"). The reset button
    // for the row is disabled until an override is applied.
    await expect(muInput).toHaveValue("");
    const muRow = muInput.locator("xpath=ancestor::tr");
    await expect(muRow.getByText("Custom")).toHaveCount(0);
    const resetRow = page.getByTestId("cma-reset-equity_us");
    await expect(resetRow).toBeDisabled();

    // Type "8,5" the European-decimal way, blur outside, then tap Apply —
    // CMA commits on the explicit Apply button (same contract as
    // home-bias). This exercises the full touch + IME + Apply path.
    await muInput.tap();
    await muInput.fill("8,5");
    await page.locator("header").first().tap();
    await page.getByTestId("cma-apply").tap();

    // After commit, parseDecimalInput("8,5") = 8.5 → setCMAOverrides stores
    // expReturn = 0.085 → subscribeCMAOverrides refills the draft via
    // buildDraft as fmtPct(u.expReturn, 2) = "8.50". The µ source for the
    // row flips to "user" → the in-row badge now reads "Custom".
    await expect(muInput).toHaveValue("8.50");
    await expect(muRow.getByText("Custom").first()).toBeVisible();
    // Per-row reset flips to enabled because equity_us is now an override.
    await expect(resetRow).toBeEnabled();
  });
});
