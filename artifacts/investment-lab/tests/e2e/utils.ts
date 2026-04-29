import type { Page } from "@playwright/test";

/**
 * Dismiss the welcome dialog (Task #96) if it is visible.
 *
 * The Investment Decision Lab opens a welcome popup ~400ms after the app
 * shell mounts on every fresh page load. Radix's modal Dialog sets the
 * `inert` attribute on its siblings while open, which removes the rest of
 * the page from the accessibility tree — Playwright's `getByRole(...)`
 * locators then can't find buttons like "Generate Portfolio" or
 * "Compare Portfolios" until the dialog is closed.
 *
 * Tests that drive the underlying app flow should call this helper right
 * after `page.goto(...)` so the welcome popup never gets in the way. The
 * helper is intentionally tolerant: if the dialog is not visible within a
 * short window (e.g. the timer hasn't fired yet on a slow CI run, or a
 * future change skips the popup), it just returns without failing.
 */
export async function dismissWelcomeIfPresent(page: Page): Promise<void> {
  const dismiss = page.getByTestId("welcome-dialog-dismiss");
  try {
    await dismiss.waitFor({ state: "visible", timeout: 2_000 });
  } catch {
    return;
  }
  await dismiss.click();
  await dismiss.waitFor({ state: "hidden", timeout: 2_000 });
}
