import { test, expect } from "@playwright/test";
import { dismissWelcomeIfPresent } from "./utils";

// Task #189 + Task #206 (revised) — welcome → auto-generate handoff
// AND nav-dot flash regression.
//
// The Build tab no longer auto-generates its sample portfolio on
// mount; instead the welcome dialog's OK click fires the one-shot
// `requestBuildSampleGeneration()` event AND briefly applies
// `animate-dot-flash` to the nav-bar Build dot. Per Task #206
// (revised), the flash is NO LONGER persisted — it plays on EVERY
// welcome-OK dismiss, on every fresh app load and reload, so the
// orientation cue never silently disappears.
//
// This spec locks both halves down so a regression to either —
// auto-generate firing on mount again, or the flash being silenced
// on a second load — fails loudly.
//
// Runs under the iphone-13 chromium viewport, so the relevant
// nav-dot testid is the mobile variant `nav-dot-build-mobile`
// rendered by the portaled bottom <nav>.

const BUILD_ROW_SELECTOR = '[data-testid^="etf-row-"]';
const BUILD_DOT_TESTID = "nav-dot-build-mobile";

test("welcome OK kicks off Build generation and flashes the nav dot on every load", async ({
  page,
}) => {
  await page.goto("/");

  // Welcome dialog appears ~400ms after mount. Wait for it before
  // asserting the empty Build table so we know the app shell has had
  // time to mount the BuildPortfolio subscriber too — otherwise an
  // "empty before OK" assertion could race the initial render.
  const dismiss = page.getByTestId("welcome-dialog-dismiss");
  await expect(dismiss).toBeVisible({ timeout: 5_000 });

  // Pre-OK: Build table must be empty (no `etf-row-*` rows). The rows
  // are only rendered once `output` exists, which now requires the
  // welcome OK click.
  await expect(page.locator(BUILD_ROW_SELECTOR)).toHaveCount(0);

  // Pre-OK: Build nav dot is hidden (no signal yet).
  await expect(page.getByTestId(BUILD_DOT_TESTID)).toHaveCount(0);

  // Sample via raw DOM query (not the locator API, which would wait
  // for the element to exist on every probe and defeat the loop):
  // returns the live class string or `null` when the dot isn't
  // mounted yet.
  const probeDotClass = () =>
    page.evaluate((sel) => {
      const el = document.querySelector(`[data-testid="${sel}"]`);
      return el ? el.getAttribute("class") : null;
    }, BUILD_DOT_TESTID);

  // Helper: poll up to 5 s for `animate-dot-flash` to land on the
  // dot. We start sampling IMMEDIATELY (in parallel with the click)
  // so we catch the class while it's actively applied — a simple
  // post-hoc `toHaveClass` would race the 1.2 s animation gate
  // timer (`setTimeout(..., 1200)` in InvestmentLab.tsx) on a cold
  // validation env where generation + re-render latency can creep
  // past that window.
  const watchForFlash = async (): Promise<boolean> => {
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      const cls = await probeDotClass().catch(() => null);
      if (cls && cls.includes("animate-dot-flash")) return true;
      await page.waitForTimeout(50);
    }
    return false;
  };

  // ── Pass 1 — first welcome OK ──────────────────────────────────
  const sawFlashPass1Promise = watchForFlash();
  await dismiss.click();
  await expect(dismiss).toBeHidden();

  // Build table populates.
  await expect(page.locator(BUILD_ROW_SELECTOR).first()).toBeVisible({
    timeout: 10_000,
  });
  expect(await page.locator(BUILD_ROW_SELECTOR).count()).toBeGreaterThan(0);

  // Dot is now in the DOM (rendered when `signals.build` flipped).
  await expect(page.getByTestId(BUILD_DOT_TESTID)).toBeVisible();

  expect(
    await sawFlashPass1Promise,
    "expected `animate-dot-flash` to be applied to the Build dot during the FIRST dismiss",
  ).toBe(true);

  // Wait for the flash window (≈1.2 s) to fully expire so pass 2
  // starts from a clean class state — otherwise a leftover class
  // from pass 1 would falsely satisfy the pass 2 watcher.
  await page.waitForTimeout(1500);

  // ── Pass 2 — reload the same browser tab, OK again ─────────────
  // Per Task #206 (revised), the flash is NO LONGER suppressed on
  // subsequent loads — it must replay on every welcome dismiss.
  await page.reload();
  const dismiss2 = page.getByTestId("welcome-dialog-dismiss");
  await expect(dismiss2).toBeVisible({ timeout: 5_000 });

  const sawFlashPass2Promise = watchForFlash();
  await dismiss2.click();
  await expect(dismiss2).toBeHidden();

  // Build table populates again (auto-generate still fires on every
  // welcome dismiss — this is the handoff half).
  await expect(page.locator(BUILD_ROW_SELECTOR).first()).toBeVisible({
    timeout: 10_000,
  });

  expect(
    await sawFlashPass2Promise,
    "expected `animate-dot-flash` to also be applied on the SECOND dismiss (no per-browser silencing)",
  ).toBe(true);
});
