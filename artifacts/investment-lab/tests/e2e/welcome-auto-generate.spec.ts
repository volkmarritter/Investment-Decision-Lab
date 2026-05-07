import { test, expect } from "@playwright/test";
import { dismissWelcomeIfPresent } from "./utils";

// Task #189 — welcome → auto-generate handoff regression.
//
// The Build tab no longer auto-generates its sample portfolio on mount;
// instead the welcome dialog's OK click fires the one-shot
// `requestBuildSampleGeneration()` event AND, on the very first
// dismissal in this browser, briefly applies `animate-dot-flash` to the
// nav-bar Build dot (one-shot, persisted via
// `idl.navDotsFlashedOnce`). This spec locks both halves down so a
// regression to either — auto-generate firing on mount again, or the
// flash replaying on every load — fails loudly.
//
// Runs under the iphone-13 chromium viewport, so the relevant nav-dot
// testid is the mobile variant `nav-dot-build-mobile` rendered by the
// portaled bottom <nav>.

const BUILD_ROW_SELECTOR = '[data-testid^="etf-row-"]';
const BUILD_DOT_TESTID = "nav-dot-build-mobile";

test("welcome OK kicks off Build generation and flashes the nav dot exactly once per browser", async ({
  page,
}) => {
  // Ensure the very first page load starts from a fully empty storage
  // so the per-session flash flag (Task #206 — moved from localStorage
  // to sessionStorage) is unset. We use a sessionStorage sentinel so
  // the SAME helper, which runs on every navigation in the page,
  // doesn't wipe `idl.navDotsFlashedOnce` from sessionStorage on the
  // later reload — pass 2 needs the flag to still be "true" so the
  // flash branch stays skipped.
  await page.addInitScript(() => {
    if (!sessionStorage.getItem("__idl_e2e_cleared")) {
      localStorage.clear();
      sessionStorage.removeItem("idl.navDotsFlashedOnce");
      sessionStorage.setItem("__idl_e2e_cleared", "1");
    }
  });

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

  // Click OK and let the one-shot event fan out: portfolio generation
  // + first-time flash on the Build dot. We start sampling the dot's
  // class IMMEDIATELY in a parallel polling loop (every ~50 ms for up
  // to 5 s) — that way we catch the `animate-dot-flash` class while
  // it's actively applied, regardless of whether the dot itself
  // appears synchronously (signals.build flips inside the dismiss
  // handler) or a few hundred ms later (subscriber chain → React
  // re-render). A simple post-hoc `toHaveClass` would race the 1.2 s
  // animation gate timer (`setTimeout(..., 1200)` in
  // InvestmentLab.tsx) on a cold validation env where generation +
  // re-render latency can creep past that window.
  const dot = page.getByTestId(BUILD_DOT_TESTID);
  // Sample via raw DOM query (not the locator API, which would wait
  // for the element to exist on every probe and defeat the loop):
  // returns the live class string or `null` when the dot isn't
  // mounted yet.
  const probeDotClass = () =>
    page.evaluate((sel) => {
      const el = document.querySelector(`[data-testid="${sel}"]`);
      return el ? el.getAttribute("class") : null;
    }, BUILD_DOT_TESTID);
  const sawFlashPromise = (async () => {
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      const cls = await probeDotClass().catch(() => null);
      if (cls && cls.includes("animate-dot-flash")) return true;
      await page.waitForTimeout(50);
    }
    return false;
  })();

  await dismiss.click();
  await expect(dismiss).toBeHidden();

  // Build table populates.
  await expect(page.locator(BUILD_ROW_SELECTOR).first()).toBeVisible({
    timeout: 10_000,
  });
  expect(await page.locator(BUILD_ROW_SELECTOR).count()).toBeGreaterThan(0);

  // Dot is now in the DOM (rendered when `signals.build` flipped).
  await expect(dot).toBeVisible();

  // The polling loop above must have observed the flash class at
  // least once during its 5 s window.
  expect(
    await sawFlashPromise,
    "expected `animate-dot-flash` to be applied to the Build dot at some point during the first dismiss",
  ).toBe(true);

  // Per-session persisted flag flipped on (Task #206 — sessionStorage,
  // not localStorage, so the cue replays on every fresh page load
  // outside the same tab session).
  const flashedOnce = await page.evaluate(() =>
    window.sessionStorage.getItem("idl.navDotsFlashedOnce"),
  );
  expect(flashedOnce).toBe("true");

  // Pass 2 — reload the same browser tab. sessionStorage persists
  // across an in-tab reload (the init-script guard above means we do
  // NOT wipe the flag), so `getNavDotsFlashedOnce()` returns true and
  // the welcome dismiss handler must skip the flash branch entirely
  // for the rest of this session.
  await page.reload();
  await dismissWelcomeIfPresent(page);

  // Build table populates again (auto-generate still fires on every
  // welcome dismiss — this is the handoff half).
  await expect(page.locator(BUILD_ROW_SELECTOR).first()).toBeVisible({
    timeout: 10_000,
  });

  // Crucially: the flash class must NEVER be applied on this pass. A
  // simple post-hoc `not.toHaveClass` only proves absence at assertion
  // time — a brief reflash between dismiss and the check would slip
  // through. So we sample the dot's class repeatedly for a window
  // that fully covers the original ~1.2 s animation gate (sample
  // every ~75 ms over ~1.5 s = ~20 samples) and fail if it ever
  // carries `animate-dot-flash`.
  // Sample the dot's class via raw DOM query (same reason as the
  // first-pass probe — locator-based getAttribute would wait for the
  // dot to exist and bunch the samples). Cover the full original
  // 1.2 s gate window plus headroom (~2 s, sample every 50 ms ≈ 40
  // probes); the class must NEVER appear during this window.
  const SAMPLE_MS = 50;
  const WINDOW_MS = 2_000;
  const deadline = Date.now() + WINDOW_MS;
  let probeIdx = 0;
  while (Date.now() < deadline) {
    const cls = (await probeDotClass().catch(() => null)) ?? "";
    expect(
      cls.includes("animate-dot-flash"),
      `flash class unexpectedly present on second pass at sample ${probeIdx} (class=${cls})`,
    ).toBe(false);
    probeIdx++;
    await page.waitForTimeout(SAMPLE_MS);
  }
});
