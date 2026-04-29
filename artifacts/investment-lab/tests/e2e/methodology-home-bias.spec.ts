import { test, expect } from "@playwright/test";
import { dismissWelcomeIfPresent } from "./utils";

// Mobile-viewport regression net for Task #21: typing a European-decimal
// home-bias multiplier ("1,2") on a phone-sized viewport must commit
// cleanly through the touch + IME + Apply path on the Methodology tab.
// The viewport comes from the project config (iPhone 13). Sister suite to
// manual-weight.spec.ts (Task #12) — extends the same touch-input net to
// the editable cells that are not on Build Portfolio.

test.describe("Methodology · home-bias multiplier (mobile)", () => {
  test("type '1,2' into USD home-bias, blur + Apply, see 1.20 + Custom badge, reset restores default", async ({
    page,
  }) => {
    // Hash routing auto-opens the home-bias accordion section and scrolls
    // it into view (see VALID_SECTION_IDS in Methodology.tsx). Loading
    // /?tab=methodology lands on the Methodology tab on first paint, and
    // the #home-bias fragment expands the editor without any extra clicks.
    await page.goto("/?tab=methodology#home-bias");
    await dismissWelcomeIfPresent(page);

    const usdInput = page.getByTestId("input-home-bias-USD");
    await expect(usdInput).toBeVisible();
    // Default state: empty draft, per-row reset disabled, no Custom badge
    // — all signals that no override is in effect for USD yet.
    await expect(usdInput).toHaveValue("");
    const resetUsd = page.getByTestId("button-home-bias-reset-USD");
    await expect(resetUsd).toBeDisabled();
    const editor = page.getByTestId("home-bias-editor");
    await expect(editor.getByText("Custom")).toHaveCount(0);

    // Type "1,2" the way a Swiss/German/French user would on their phone,
    // then blur by tapping outside the input. Home-bias commits on the
    // explicit "Apply" button (not on blur) — that's the editor's actual
    // contract on mobile, so we exercise the same flow here.
    await usdInput.tap();
    await usdInput.fill("1,2");
    await page.locator("header").first().tap();
    await page.getByTestId("button-home-bias-apply").tap();

    // After commit, parseDecimalInput("1,2") = 1.2 → buildHbDraft re-formats
    // it to ov.USD.toFixed(2) = "1.20" so the input must reflect that.
    await expect(usdInput).toHaveValue("1.20");
    // The "Custom" pill appears next to the USD label and the per-row
    // reset button flips to enabled — both indicate the override took.
    await expect(editor.getByText("Custom").first()).toBeVisible();
    await expect(resetUsd).toBeEnabled();

    // Tap the per-row reset — the override drops, the input clears back
    // to the empty draft and both the badge and the reset button vanish
    // from the override state.
    await resetUsd.tap();
    await expect(usdInput).toHaveValue("");
    await expect(resetUsd).toBeDisabled();
    await expect(editor.getByText("Custom")).toHaveCount(0);
  });
});
