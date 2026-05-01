import { test, expect } from "@playwright/test";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { dismissWelcomeIfPresent } from "./utils";

// ----------------------------------------------------------------------------
// Build-tab scenario file round-trip (Save to file → reload → Load from file).
// ----------------------------------------------------------------------------
// `tests/portfolioFile.test.ts` already covers the parser and serializer at
// the module level. This spec mirrors `explain-portfolio-file-roundtrip.spec`
// to lock in the *UI wiring* on the Build tab — download anchor, hidden file
// input, toast + saved-counter side effects — so a regression in the buttons
// or their handlers in `SavedScenariosUI` fails loudly here rather than only
// in a manual smoke test.
// ----------------------------------------------------------------------------

const SAVED_SCENARIOS_KEY = "investment-lab.savedScenarios.v1";
const MANUAL_WEIGHTS_KEY = "investment-lab.manualWeights.v1";

test.describe("BuildPortfolio · scenario file round-trip", () => {
  test("save current build to a file, then re-import it after a clean reload", async ({
    page,
    context,
  }, testInfo) => {
    await context.clearCookies();
    await page.goto("/");
    await dismissWelcomeIfPresent(page);

    // Start from a known-empty saved-scenarios + manual-weights store so the
    // Saved (N) counter starts at 0 and we can assert it ticks up to 1 after
    // the import. The manual-weights store is global Build state — clearing
    // it guarantees the Custom badge we assert on after re-import is the one
    // restored from the file, not a stale pin from a previous test run.
    await page.evaluate(
      ({ savedKey, manualKey }) => {
        window.localStorage.removeItem(savedKey);
        window.localStorage.removeItem(manualKey);
      },
      { savedKey: SAVED_SCENARIOS_KEY, manualKey: MANUAL_WEIGHTS_KEY },
    );
    await page.reload();
    await dismissWelcomeIfPresent(page);

    // Build tab is the default. Generate a portfolio so the ETF Implementation
    // table renders and the Save buttons enable.
    const generate = page.getByRole("button", { name: /generate portfolio/i });
    await expect(generate).toBeVisible();
    await generate.tap();

    const firstRow = page.locator('[data-testid^="etf-row-"]').first();
    await expect(firstRow).toBeVisible();

    // Pin a manual weight on the first bucket so the saved file carries a
    // user-visible mutation that's easy to assert on re-import. Without a
    // pin, the imported scenario would be indistinguishable from a fresh
    // "Generate Portfolio" call after the reload.
    const firstWeightInput = page
      .locator('[data-testid^="weight-input-"]')
      .first();
    await expect(firstWeightInput).toBeVisible();
    const weightTestid = await firstWeightInput.getAttribute("data-testid");
    expect(weightTestid).toMatch(/^weight-input-/);
    const bucket = weightTestid!.replace("weight-input-", "");

    await firstWeightInput.tap();
    await firstWeightInput.fill("11.1");
    // Tap header to blur and commit the weight.
    await page.locator("header").first().tap();
    await expect(firstWeightInput).toHaveValue("11.1");
    await expect(page.getByTestId(`custom-badge-${bucket}`)).toBeVisible();

    // Saved-list dialog still shows zero entries — we have not used the
    // localStorage Save Scenario button, only built up the live workspace.
    const savedListButton = page.getByTestId("build-saved-list");
    await expect(savedListButton).toContainText(/0/);

    // ------------------------------------------------------------------
    // Save to file: clicking the button triggers a browser download via
    // an anchor element. Catch the download event and persist the file
    // to a temp location so we can hand it back to the file input later.
    // ------------------------------------------------------------------
    const saveToFile = page.getByTestId("build-saved-save-file");
    await expect(saveToFile).toBeEnabled();
    await saveToFile.scrollIntoViewIfNeeded();

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      saveToFile.tap(),
    ]);

    expect(download.suggestedFilename()).toMatch(
      /^investment-lab-portfolio-.+\.json$/,
    );

    const tmpDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "build-portfolio-roundtrip-"),
    );
    const downloadedPath = path.join(tmpDir, download.suggestedFilename());
    await download.saveAs(downloadedPath);
    await testInfo.attach("portfolio.json", {
      path: downloadedPath,
      contentType: "application/json",
    });

    // Sanity-check: the downloaded file is well-formed JSON, carries the
    // Build wrapper format, and preserves the manual-weight pin we just
    // added. If this fails the rest of the test would fail with a
    // confusing "import did nothing" — surface the real reason here.
    const downloaded = JSON.parse(await fs.readFile(downloadedPath, "utf8"));
    expect(downloaded.format).toBe("investment-decision-lab.portfolio");
    expect(downloaded.schemaVersion).toBe(1);
    expect(downloaded.scenario.input.baseCurrency).toBeTruthy();
    expect(downloaded.scenario.manualWeights?.[bucket]).toBeCloseTo(11.1);

    // ------------------------------------------------------------------
    // Wipe both stores and reload so the Build state is genuinely empty
    // before the import — otherwise a successful "Load from file" would
    // be indistinguishable from the manual-weight pin we just persisted.
    // ------------------------------------------------------------------
    await page.evaluate(
      ({ savedKey, manualKey }) => {
        window.localStorage.removeItem(savedKey);
        window.localStorage.removeItem(manualKey);
      },
      { savedKey: SAVED_SCENARIOS_KEY, manualKey: MANUAL_WEIGHTS_KEY },
    );
    await page.reload();
    await dismissWelcomeIfPresent(page);

    // Counter back to 0 — confirms the saved-scenarios store was cleared.
    await expect(page.getByTestId("build-saved-list")).toContainText(/0/);

    // ------------------------------------------------------------------
    // Load from file: drive the *visible* button so the wiring from
    // `build-saved-load-file` → `fileInputRef.current?.click()` →
    // hidden <input type=file> is part of the assertion path. A
    // regression in the load button's onClick (e.g. ref dropped, wrong
    // handler) would now fail here instead of silently passing if we
    // had only driven the hidden input directly. Playwright surfaces
    // the file chooser via `waitForEvent("filechooser")` regardless of
    // whether the underlying input is hidden.
    // ------------------------------------------------------------------
    const loadFromFile = page.getByTestId("build-saved-load-file");
    await expect(loadFromFile).toBeVisible();
    await loadFromFile.scrollIntoViewIfNeeded();
    const [fileChooser] = await Promise.all([
      page.waitForEvent("filechooser"),
      loadFromFile.tap(),
    ]);
    await fileChooser.setFiles(downloadedPath);

    // Sonner renders toasts under `[data-sonner-toaster]`. Asserting the
    // success copy proves the import handler reached the success branch
    // (parse OK + saveScenario OK). Match either localized copy in case
    // the test ever runs with the German locale toggled on.
    await expect(
      page
        .getByText(/portfolio loaded from file|portfolio aus datei geladen/i)
        .first(),
    ).toBeVisible();

    // Saved counter ticked to 1 — the import path also persists the
    // imported scenario into the saved-scenarios store so the user can
    // re-load it later from the bookmarks list.
    await expect(page.getByTestId("build-saved-list")).toContainText(/1/);

    // The Build onLoadScenario handler resets the form, restores the
    // manual-weights snapshot, and re-runs the engine via onSubmit. The
    // ETF Implementation table re-renders with the same buckets and the
    // pinned weight + Custom badge come back on the same bucket.
    const restoredWeightInput = page.getByTestId(`weight-input-${bucket}`);
    await expect(restoredWeightInput).toBeVisible();
    await expect(restoredWeightInput).toHaveValue("11.1");
    await expect(page.getByTestId(`custom-badge-${bucket}`)).toBeVisible();

    // The persisted store actually contains the imported scenario with
    // the same manual-weight pin — guards against a regression where
    // the counter increments but the underlying data is dropped.
    const stored = await page.evaluate(
      (key) => window.localStorage.getItem(key),
      SAVED_SCENARIOS_KEY,
    );
    expect(stored).toBeTruthy();
    const parsed = JSON.parse(stored!);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBe(1);
    expect(parsed[0].manualWeights?.[bucket]).toBeCloseTo(11.1);

    await fs.rm(tmpDir, { recursive: true, force: true });
  });
});
