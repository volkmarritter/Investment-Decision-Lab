import type { BrowserContext, Page } from "@playwright/test";

/**
 * Dismiss the welcome dialog (Task #96) if it is visible.
 *
 * The Investment Decision Lab opens a welcome popup on a 400ms timer that
 * React only schedules *after* the app shell mounts (see the `setTimeout`
 * inside InvestmentLab.tsx). Radix's modal Dialog sets the `inert`
 * attribute on its siblings while open, which removes the rest of the page
 * from the accessibility tree — Playwright's `getByRole(...)` locators then
 * can't find buttons like "Generate Portfolio" or "Compare Portfolios"
 * until the dialog is closed, and a stray tap gets swallowed.
 *
 * Why this is a *polling* loop and not a single `waitFor` (Task #302): the
 * 400ms timer is scheduled relative to React mount, NOT to `page.goto()`.
 * `goto` resolves on the `load` event, which fires before React's effect
 * runs, so on a slow mount the dialog can pop open well after `goto`
 * returns. The old single `waitFor({ state: "visible", timeout: 2_000 })`
 * then raced that timer: it returned "not visible" just *before* the
 * dialog appeared, the test moved on, and the modal then trapped the next
 * interaction — the exact flake this helper now removes.
 *
 * The loop keeps re-checking until either the dialog has appeared (then it
 * is dismissed and confirmed hidden) or a generous deadline elapses (the
 * dialog was genuinely never shown — e.g. a slow build, or a future change
 * that drops the popup). It exits the instant the dialog shows, so it adds
 * no latency on the common path and only spends the full budget when there
 * is truly no dialog. The welcome timer is one-shot per mount, so once a
 * dismissed dialog is confirmed hidden it will not re-open for that page
 * load — callers issue a fresh `dismissWelcomeIfPresent` after each
 * `reload()`/navigation that triggers a new mount.
 */
export async function dismissWelcomeIfPresent(page: Page): Promise<void> {
  const dismiss = page.getByTestId("welcome-dialog-dismiss");
  // 10s budget comfortably covers app mount (after `load`) + the 400ms
  // timer even on a cold dev server, while still failing fast if the
  // dialog is genuinely absent. Each iteration blocks up to 1s on
  // `waitFor`, so this is at most ~10 polls — never a busy loop.
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      await dismiss.waitFor({ state: "visible", timeout: 1_000 });
    } catch (err) {
      // Only a per-iteration *timeout* means "not visible yet" — keep
      // polling until the deadline. Any other error (e.g. the page/context
      // was closed) is real: re-throw it so genuine failures surface
      // instead of being silently swallowed by the poll loop.
      if (err instanceof Error && err.name === "TimeoutError") continue;
      throw err;
    }
    await dismiss.click();
    await dismiss.waitFor({ state: "hidden", timeout: 2_000 });
    return;
  }
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
