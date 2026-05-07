import { test, expect } from "@playwright/test";

// Task #191 — regression for Task #190.
//
// The "Your sample portfolio is ready in Build" hint tooltip
// (`nav-hint-build` / `nav-hint-build-mobile`) USED to be one-shot,
// gated by the `idl.navDotsHintShownOnce` localStorage flag. Task #190
// removed that gate so the hint fires on EVERY welcome-dialog dismiss.
// This spec locks that behaviour down: a future cleanup that
// reintroduces a one-shot guard (e.g. by re-adding the
// `getNavDotsHintShownOnce()` check around `setShowBuildHint(true)` in
// `InvestmentLab.tsx`) must fail this test.
//
// Runs under the iphone-13 chromium viewport (see playwright.config.ts),
// so we assert against the mobile testid `nav-hint-build-mobile`
// rendered by the portaled bottom <nav>.

const BUILD_HINT_TESTID = "nav-hint-build-mobile";

test("welcome dismiss shows the Build hint on every visit, not just the first", async ({
  page,
}) => {
  // Pass 1 — fresh browser. Clear localStorage on the very first nav
  // only, so any persisted flags from earlier tests can't gate the hint
  // off; preserve it across the later reload to prove the hint is NOT
  // gated by a "shown once" flag.
  await page.addInitScript(() => {
    if (!sessionStorage.getItem("__idl_e2e_cleared")) {
      localStorage.clear();
      sessionStorage.setItem("__idl_e2e_cleared", "1");
    }
  });

  await page.goto("/");

  const dismiss = page.getByTestId("welcome-dialog-dismiss");
  await expect(dismiss).toBeVisible({ timeout: 5_000 });
  await dismiss.click();
  await expect(dismiss).toBeHidden();

  // First-pass hint appears.
  const hint = page.getByTestId(BUILD_HINT_TESTID);
  await expect(hint).toBeVisible({ timeout: 3_000 });

  // Wait for the 3 s auto-dismiss timer in `handleWelcomeDismiss` to
  // fire so the next pass starts from a clean tooltip state. (We can't
  // just rely on the reload because the hint is React state and the
  // reload remounts the tree anyway, but waiting here also catches a
  // regression where the timer never fires.)
  await expect(hint).toBeHidden({ timeout: 5_000 });

  // Sanity: after pass 1, if the legacy one-shot flag were still being
  // set, it would now be `"true"`. We do NOT assert its value (the flag
  // is gone) — but we DO leave localStorage intact across the reload so
  // any reintroduced gate would observe its persisted "already shown"
  // state and skip the hint on pass 2.
  await page.reload();

  const dismiss2 = page.getByTestId("welcome-dialog-dismiss");
  await expect(dismiss2).toBeVisible({ timeout: 5_000 });
  await dismiss2.click();
  await expect(dismiss2).toBeHidden();

  // Pass 2 — hint must appear again.
  await expect(page.getByTestId(BUILD_HINT_TESTID)).toBeVisible({
    timeout: 3_000,
  });
});
