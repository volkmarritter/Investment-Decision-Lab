import { test, expect } from "@playwright/test";
import { dismissWelcomeIfPresent } from "./utils";

// Task #175 — Build → Explain handoff. The Build tab auto-generates an
// example portfolio shortly after the welcome dialog dismisses, so by
// the time the Send-to-Explain button enables it has a portfolio to
// send. Covers two paths: silent first-load when Explain is empty, and
// confirm-and-replace when Explain already carries content.

const EXPLAIN_LS_KEY = "investment-lab.explainPortfolio.v1";

test("Send to Explain copies the Build portfolio into the Explain workspace, with the confirm path on second send", async ({
  page,
}) => {
  await page.goto("/");
  await dismissWelcomeIfPresent(page);

  // Wait for the auto-generated portfolio so the button enables.
  const sendBtn = page.getByTestId("build-send-to-explain");
  await expect(sendBtn).toBeVisible({ timeout: 15_000 });
  await expect(sendBtn).toBeEnabled({ timeout: 15_000 });
  await sendBtn.scrollIntoViewIfNeeded();
  await sendBtn.tap();

  // First-load case: Explain workspace is empty by default → no confirm
  // dialog; we land directly on Explain with the workspace replaced.
  await expect(page).toHaveURL(/[?&]tab=explain\b/);

  const persisted = await page.evaluate(
    (k) => window.localStorage.getItem(k),
    EXPLAIN_LS_KEY,
  );
  expect(persisted).not.toBeNull();
  const parsed = JSON.parse(persisted as string);
  expect(parsed.v).toBe(1);
  expect(Array.isArray(parsed.positions)).toBe(true);
  expect(parsed.positions.length).toBeGreaterThan(0);

  // lookThroughView toggle parity: Build's default is `true`, the
  // workspace must reflect it so the receiver lands in the same mode.
  expect(parsed.lookThroughView).toBe(true);

  // Each persisted position should have a non-empty ISIN and a
  // positive weight (the converter drops empty/zero rows).
  for (const p of parsed.positions) {
    expect(typeof p.isin).toBe("string");
    expect(p.isin.length).toBeGreaterThan(0);
    expect(typeof p.weight).toBe("number");
    expect(p.weight).toBeGreaterThan(0);
  }

  // First Explain row should now be visible in the editor.
  const firstRow = page.getByTestId("explain-row-0");
  await expect(firstRow).toBeVisible({ timeout: 10_000 });

  // The first persisted ISIN should be rendered somewhere inside the
  // first row (clickable badge, manual input, or row label) — confirms
  // the persisted state actually reached the rendered editor.
  const firstIsin = parsed.positions[0].isin as string;
  await expect(firstRow).toContainText(firstIsin);

  // Second pass: workspace now has content → tapping Send should open
  // the replace-with-confirm AlertDialog, and confirming it should
  // re-apply the workspace cleanly.
  // Task #183 — the mobile bottom nav is portaled to <body> with z-[60].
  // Playwright's tap() actionability check on iphone-13 + heavy Explain
  // content occasionally reports the nav as covered even though the
  // a11y snapshot + visual screenshot confirm it sits on top and a real
  // touch lands cleanly. `click({force: true})` skips that check and
  // still fires the React onClick handler, which is what the navigation
  // contract actually depends on.
  await page
    .getByRole("tab", { name: /build portfolio/i })
    .click({ force: true });
  await expect(sendBtn).toBeVisible();
  await expect(sendBtn).toBeEnabled();
  await sendBtn.scrollIntoViewIfNeeded();
  await sendBtn.tap();

  const dialog = page.getByTestId("build-send-to-explain-dialog");
  await expect(dialog).toBeVisible();
  await page.getByTestId("build-send-to-explain-confirm").tap();
  await expect(dialog).toBeHidden();
  await expect(page).toHaveURL(/[?&]tab=explain\b/);

  // Confirmed replace landed: workspace is still well-formed and the
  // Explain editor still shows the first row + same ISIN.
  const after = await page.evaluate(
    (k) => window.localStorage.getItem(k),
    EXPLAIN_LS_KEY,
  );
  const afterParsed = JSON.parse(after as string);
  expect(afterParsed.positions.length).toBeGreaterThan(0);
  expect(afterParsed.lookThroughView).toBe(true);
  await expect(page.getByTestId("explain-row-0")).toBeVisible({
    timeout: 10_000,
  });
  await expect(page.getByTestId("explain-row-0")).toContainText(
    afterParsed.positions[0].isin as string,
  );
});
