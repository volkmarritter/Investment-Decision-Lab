import type { BrowserContext, Page } from "@playwright/test";

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

/**
 * Reset all client-side state that the Investment Decision Lab persists
 * between page loads, then leave the page parked at `about:blank` so the
 * caller can `goto("/")` from a guaranteed-clean slate.
 *
 * Why this exists (Task #234): the explain-*.spec.ts files all pass when
 * run on their own, but flake intermittently when the whole
 * `test:e2e:explain` group runs in one sequence. Each test was already
 * doing a one-off `removeItem("investment-lab.explainPortfolio.v1")`,
 * which only purges the editor's own workspace key — *other* keys
 * (`savedExplainPortfolios.v1` written by the file-roundtrip spec,
 * `lang.v1`, `manualWeights.v1`, the admin token, …) were carried into
 * the next test through the shared dev-server cache + reused page
 * navigation history, and the welcome-dialog 400ms timer would
 * occasionally fire AFTER the test's `dismissWelcomeIfPresent()` had
 * already given up, blocking the next tap.
 *
 * The fix wipes localStorage + sessionStorage + cookies + permissions
 * inside a real app-origin page (about:blank can't touch storage), so
 * the next `goto("/")` truly starts from zero — no matter what previous
 * tests left behind.
 */
export async function resetAppState(
  page: Page,
  context: BrowserContext,
): Promise<void> {
  await context.clearCookies();
  try {
    await context.clearPermissions();
  } catch {
    // clearPermissions is best-effort — not all browsers support it and
    // it's not load-bearing for the storage reset.
  }
  // Storage APIs require a real document origin; about:blank has none.
  // Navigate to the app root first, wipe storage, then park back on
  // about:blank so the test's own `goto("/")` still triggers a real
  // navigation + fresh React mount.
  await page.goto("/");
  await page.evaluate(() => {
    try {
      window.localStorage.clear();
    } catch {
      // ignore — storage may be unavailable in some sandboxed contexts
    }
    try {
      window.sessionStorage.clear();
    } catch {
      // ignore
    }
  });
  await page.goto("about:blank");
}
