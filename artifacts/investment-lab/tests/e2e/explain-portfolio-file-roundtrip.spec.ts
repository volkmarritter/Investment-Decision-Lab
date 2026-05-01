import { test, expect } from "@playwright/test";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { dismissWelcomeIfPresent } from "./utils";

// ----------------------------------------------------------------------------
// Personal-portfolio file round-trip (Save to file → reload → Load from file).
// ----------------------------------------------------------------------------
// `tests/personalPortfolioFile.test.ts` already covers the parser and
// serializer at the module level. This spec locks in the *UI wiring* —
// download anchor, hidden file input, toast + saved-counter side effects —
// so a regression in the buttons or their handlers fails loudly here
// rather than only in a manual smoke test.
// ----------------------------------------------------------------------------

const ISIN_USA = "IE00B5BMR087";
const ISIN_EUROPE = "IE00B4K48X80";

const EXPLAIN_WORKSPACE_KEY = "investment-lab.explainPortfolio.v1";
const SAVED_PORTFOLIOS_KEY = "investment-lab.savedExplainPortfolios.v1";

async function openExplainTab(page: import("@playwright/test").Page) {
  await page.goto("/");
  await dismissWelcomeIfPresent(page);
  const explainTab = page.getByRole("tab", { name: /explain my portfolio/i });
  await expect(explainTab).toBeVisible();
  await explainTab.tap();
}

async function addCatalogRow(
  page: import("@playwright/test").Page,
  rowIndex: number,
  isin: string,
) {
  await page.getByTestId("explain-add-row").tap();
  const picker = page.getByTestId(`explain-picker-${rowIndex}`);
  await expect(picker).toBeVisible();
  await picker.scrollIntoViewIfNeeded();
  await picker.tap();
  const option = page.getByTestId(`isin-option-${isin}`);
  await expect(option).toBeVisible();
  await option.tap();
  await expect(option).toBeHidden();
}

async function setRowWeight(
  page: import("@playwright/test").Page,
  rowIndex: number,
  weight: string,
) {
  const input = page.getByTestId(`explain-weight-${rowIndex}`);
  await input.scrollIntoViewIfNeeded();
  await input.fill(weight);
}

test.describe("ExplainPortfolio · personal-portfolio file round-trip", () => {
  test("save current workspace to a file, then re-import it after a clean reload", async ({
    page,
    context,
  }, testInfo) => {
    await context.clearCookies();
    await openExplainTab(page);

    // Start from a known-empty Explain workspace + saved-portfolio store
    // so the Saved (N) counter starts at 0 and we can assert it ticks up
    // to 1 after the import.
    await page.evaluate(
      ({ workspaceKey, savedKey }) => {
        window.localStorage.removeItem(workspaceKey);
        window.localStorage.removeItem(savedKey);
      },
      { workspaceKey: EXPLAIN_WORKSPACE_KEY, savedKey: SAVED_PORTFOLIOS_KEY },
    );
    await page.reload();
    await dismissWelcomeIfPresent(page);
    await page.getByRole("tab", { name: /explain my portfolio/i }).tap();

    // Build a tiny two-position portfolio so the file we save has
    // something concrete to verify on re-import.
    await addCatalogRow(page, 0, ISIN_USA);
    await addCatalogRow(page, 1, ISIN_EUROPE);
    await setRowWeight(page, 0, "60");
    await setRowWeight(page, 1, "40");
    await expect(page.getByTestId("explain-total")).toContainText(
      /100(\.0)?\s*%/,
    );

    // Saved-list dialog still shows zero entries — we have not used the
    // localStorage Save button, only built up the live workspace.
    const savedListButton = page.getByTestId("explain-saved-list");
    await expect(savedListButton).toContainText(/0/);

    // ------------------------------------------------------------------
    // Save to file: clicking the button triggers a browser download via
    // an anchor element. Catch the download event and persist the file
    // to a temp location so we can hand it back to the file input later.
    // ------------------------------------------------------------------
    const saveToFile = page.getByTestId("explain-saved-save-file");
    await expect(saveToFile).toBeEnabled();
    await saveToFile.scrollIntoViewIfNeeded();

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      saveToFile.tap(),
    ]);

    expect(download.suggestedFilename()).toMatch(
      /^investment-lab-personal-portfolio-.+\.json$/,
    );

    const tmpDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "explain-portfolio-roundtrip-"),
    );
    const downloadedPath = path.join(tmpDir, download.suggestedFilename());
    await download.saveAs(downloadedPath);
    testInfo.attach("personal-portfolio.json", {
      path: downloadedPath,
      contentType: "application/json",
    });

    // Sanity-check: the downloaded file is well-formed JSON and carries
    // the personal-portfolio wrapper plus the two ISINs we picked. If
    // this assertion fails the rest of the test would fail with a
    // confusing "import did nothing" error — surface the real reason.
    const downloaded = JSON.parse(await fs.readFile(downloadedPath, "utf8"));
    expect(downloaded.format).toBe(
      "investment-decision-lab.personal-portfolio",
    );
    expect(downloaded.schemaVersion).toBe(1);
    expect(
      downloaded.portfolio.workspace.positions
        .map((p: { isin: string }) => p.isin)
        .sort(),
    ).toEqual([ISIN_USA, ISIN_EUROPE].sort());

    // ------------------------------------------------------------------
    // Wipe both stores and reload so the workspace is genuinely empty
    // before the import — otherwise a successful "Load from file" would
    // be indistinguishable from the workspace we just persisted.
    // ------------------------------------------------------------------
    await page.evaluate(
      ({ workspaceKey, savedKey }) => {
        window.localStorage.removeItem(workspaceKey);
        window.localStorage.removeItem(savedKey);
      },
      { workspaceKey: EXPLAIN_WORKSPACE_KEY, savedKey: SAVED_PORTFOLIOS_KEY },
    );
    await page.reload();
    await dismissWelcomeIfPresent(page);
    await page.getByRole("tab", { name: /explain my portfolio/i }).tap();

    // Empty-state copy proves the workspace really did get cleared.
    await expect(
      page.getByText(/no positions yet|noch keine positionen/i).first(),
    ).toBeVisible();
    await expect(page.getByTestId("explain-saved-list")).toContainText(/0/);

    // ------------------------------------------------------------------
    // Load from file: drive the *visible* button so the wiring from
    // `explain-saved-load-file` → `fileInputRef.current?.click()` →
    // hidden <input type=file> is part of the assertion path. A
    // regression in the load button's onClick (e.g. ref dropped, wrong
    // handler) would now fail here instead of silently passing if we
    // had only driven the hidden input directly. Playwright surfaces
    // the file chooser via `waitForEvent("filechooser")` regardless of
    // whether the underlying input is hidden.
    // ------------------------------------------------------------------
    const loadFromFile = page.getByTestId("explain-saved-load-file");
    await expect(loadFromFile).toBeVisible();
    await loadFromFile.scrollIntoViewIfNeeded();
    const [fileChooser] = await Promise.all([
      page.waitForEvent("filechooser"),
      loadFromFile.tap(),
    ]);
    await fileChooser.setFiles(downloadedPath);

    // Sonner renders toasts under `[data-sonner-toaster]`. Asserting
    // the success copy proves the import handler reached the success
    // branch (parse OK + saveExplainPortfolio OK), which is one of the
    // few user-visible side-effects beyond the workspace and counter.
    await expect(
      page.getByText(/personal portfolio loaded from file|persönliches portfolio aus datei geladen/i).first(),
    ).toBeVisible();

    // Imported portfolio is auto-loaded into the live workspace (the
    // SavedExplainPortfoliosUI component calls onLoadPortfolio after a
    // successful parse), so the two rows should reappear with the same
    // weights, summing back to 100%.
    await expect(page.getByTestId("explain-weight-0")).toHaveValue(/60/);
    await expect(page.getByTestId("explain-weight-1")).toHaveValue(/40/);
    await expect(page.getByTestId("explain-total")).toContainText(
      /100(\.0)?\s*%/,
    );

    // Saved counter ticked to 1 — the import path also persists the
    // imported portfolio into the saved-portfolio store so the user
    // can re-load it later from the bookmarks list.
    await expect(page.getByTestId("explain-saved-list")).toContainText(/1/);

    // The persisted store actually contains the imported portfolio
    // with the same two ISINs — guards against a regression where the
    // counter increments but the underlying data is dropped.
    const stored = await page.evaluate(
      (key) => window.localStorage.getItem(key),
      SAVED_PORTFOLIOS_KEY,
    );
    expect(stored).toBeTruthy();
    const parsed = JSON.parse(stored!);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBe(1);
    expect(
      parsed[0].workspace.positions
        .map((p: { isin: string }) => p.isin)
        .sort(),
    ).toEqual([ISIN_USA, ISIN_EUROPE].sort());

    await fs.rm(tmpDir, { recursive: true, force: true });
  });
});
