import { test, expect } from "@playwright/test";
import { dismissWelcomeIfPresent } from "./utils";

// Task #175 — Build → Explain handoff. The Build tab auto-generates an
// example portfolio shortly after the welcome dialog dismisses, so by the
// time we tap "Send to Explain" the button has a portfolio to send.

test("Send to Explain copies the Build portfolio into the Explain workspace", async ({
  page,
}) => {
  await page.goto("/");
  await dismissWelcomeIfPresent(page);

  // Wait for the auto-generated portfolio to render the results header
  // (the Send-to-Explain button only appears alongside the export buttons
  // once `output && validation.isValid`).
  const sendBtn = page.getByTestId("build-send-to-explain");
  await expect(sendBtn).toBeVisible({ timeout: 15_000 });
  await sendBtn.scrollIntoViewIfNeeded();
  await sendBtn.tap();

  // First-load case: the Explain workspace is empty by default, so no
  // confirm dialog should pop up. We immediately land on Explain.
  await expect(page).toHaveURL(/[?&]tab=explain\b/);

  // The receiver replaces state and persists to localStorage. Inspect
  // the persisted shape directly so the assertion doesn't depend on
  // catalog-specific UI labels.
  const persisted = await page.evaluate(() => {
    return window.localStorage.getItem("investment-lab.explainPortfolio.v1");
  });
  expect(persisted).not.toBeNull();
  const parsed = JSON.parse(persisted as string);
  expect(parsed.v).toBe(1);
  expect(Array.isArray(parsed.positions)).toBe(true);
  expect(parsed.positions.length).toBeGreaterThan(0);
  for (const p of parsed.positions) {
    expect(typeof p.isin).toBe("string");
    expect(p.isin.length).toBeGreaterThan(0);
    expect(typeof p.weight).toBe("number");
    expect(p.weight).toBeGreaterThan(0);
  }

  // At least one Explain row should be visible (the tree of buckets
  // expands smart-default for any populated asset class).
  await expect(page.getByTestId("explain-row-0")).toBeVisible({
    timeout: 10_000,
  });

  // Now the workspace has content: a second Send-from-Build click should
  // open the replace-with-confirm AlertDialog instead of overwriting
  // silently. Switch back to Build via tab nav.
  await page.getByRole("tab", { name: /build portfolio/i }).tap();
  await expect(sendBtn).toBeVisible();
  await sendBtn.scrollIntoViewIfNeeded();
  await sendBtn.tap();

  const dialog = page.getByTestId("build-send-to-explain-dialog");
  await expect(dialog).toBeVisible();
  // Cancel keeps us on Build with the dialog dismissed and Explain
  // localStorage untouched.
  await page.getByTestId("build-send-to-explain-cancel").tap();
  await expect(dialog).toBeHidden();
});
