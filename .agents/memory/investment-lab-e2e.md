---
name: investment-lab e2e (Playwright, iphone-13 viewport)
description: Shared dev-server contention pitfall and the welcome-dialog dismiss race for the investment-lab Playwright suite.
---

## One shared dev server — don't run two Playwright invocations at once

`playwright.config.ts` starts a `webServer` on port 5174 with
`reuseExistingServer: !process.env.CI`. The `e2e` validation workflow and any
manual `npx playwright test` therefore latch onto the **same** dev server.

**Symptom of contention:** a run shows many failures all reporting
`page.goto: net::ERR_CONNECTION_REFUSED at http://127.0.0.1:5174/`, including
tests you never touched (e.g. the welcome-behaviour specs). That is the tell
that a second Playwright invocation tore the shared server down mid-run — it is
NOT a real regression.

**How to apply:** run the full suite *alone* — either restart the `e2e`
workflow OR run manually, never both overlapping. Run targeted groups
(`test:e2e:misc`, single spec files) only when the `e2e` workflow is idle.
The full suite is ~4 min; restart the `e2e` workflow and wait >4.5 min before
reading its log.

## Welcome-dialog dismiss race (the `dismissWelcomeIfPresent` helper)

The welcome popup in `src/pages/InvestmentLab.tsx` opens on a `setTimeout(…,
400)` scheduled inside a `useEffect` — i.e. **relative to React mount, with no
localStorage/sessionStorage persistence**. It re-appears on every fresh mount
(goto/reload).

**Why a single `waitFor` flakes:** `page.goto()` resolves on the `load` event,
which fires *before* React's effect runs. On a slow mount the 400ms timer fires
well after goto returns, so a one-shot `dismiss.waitFor({state:"visible",
timeout:2000})` can give up just before the dialog opens; the modal then sets
`inert` on its siblings and swallows the test's next tap.

**Durable rule:** any helper that dismisses this dialog must *poll* for it
until it appears (then dismiss + confirm hidden) or a generous deadline
elapses — never a single short `waitFor`, which can return before a late
timer fires. The timer is one-shot per mount, so re-dismiss after every
navigation/reload that triggers a new mount. When swallowing poll errors,
only swallow Playwright `TimeoutError` ("not visible yet") and re-throw
everything else, or a closed page/context will hide behind the loop.

**Don't** "fix" this with fixed `waitForTimeout` sleeps — that masks the race
instead of removing it.
