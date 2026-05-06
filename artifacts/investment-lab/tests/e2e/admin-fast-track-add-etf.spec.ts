import { expect, test, type Page, type Route } from "@playwright/test";

// E2E for the Task #165 fast-track add-ETF flow on /admin/catalog.
// All /api/admin/* calls are mocked via page.route so the test is
// hermetic — it never opens a real PR and never edits the workspace
// catalog files.

interface MockState {
  capturedAddInstrument?: { entry: { isin: string; comment?: string } };
  capturedAttachAlt?: { parentKey: string; isin: string };
  capturedSetDefault?: { parentKey: string; isin: string };
  capturedAttachPool?: { parentKey: string; isin: string };
  capturedLookthroughChain: string[];
}

const TEST_ISIN = "IE00B5BMR087";
const TEST_BUCKET = "Equity-USA";

async function mockAdminApi(page: Page, state: MockState, opts: {
  directWrite?: boolean;
  policyFitOk?: boolean;
} = {}) {
  const directWrite = opts.directWrite ?? true;
  const policyFitOk = opts.policyFitOk ?? true;

  await page.route(/\/api\/admin\/(.*)/, async (route: Route) => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname.replace(/^.*\/api\/admin\//, "/");
    const method = req.method();

    if (path === "/whoami") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          githubConfigured: true,
          githubOwner: "test",
          githubRepo: "test",
          githubBaseBranch: "main",
          directWrite,
        }),
      });
    }
    if (path === "/catalog") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          entries: {
            [TEST_BUCKET]: {
              key: TEST_BUCKET,
              name: "Existing default ETF",
              isin: "IE00B3XXRP09",
              terBps: 7,
              domicile: "Ireland",
              replication: "Physical",
              distribution: "Accumulating",
              currency: "USD",
              comment: "",
              listings: { LSE: { ticker: "VUSA" } },
              defaultExchange: "LSE",
              alternatives: [],
              pool: [],
            },
          },
        }),
      });
    }
    if (path === "/preview-isin" && method === "POST") {
      const body = req.postDataJSON() ?? {};
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          isin: body.isin ?? TEST_ISIN,
          fields: {
            name: "Test World ETF",
            terBps: 20,
            domicile: "Ireland",
            replication: "Physical",
            distribution: "Accumulating",
            currency: "USD",
            aumMillionsEUR: 5000,
            inceptionDate: "2010-01-01",
            description:
              "The fund seeks to track the MSCI World index of large-cap developed-market equities.",
          },
          listings: { LSE: { ticker: "TWLD" } },
          policyFit: {
            aumOk: policyFitOk,
            terOk: policyFitOk,
            notes: policyFitOk ? [] : ["Below AUM threshold"],
          },
          sourceUrl: `https://www.justetf.com/en/etf-profile.html?isin=${body.isin}`,
        }),
      });
    }
    if (path === "/instruments" && method === "POST") {
      state.capturedAddInstrument = req.postDataJSON();
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, prUrl: "", prNumber: 0 }),
      });
    }
    const altMatch = path.match(/^\/buckets\/([^/]+)\/alternatives$/);
    if (altMatch && method === "POST") {
      const body = req.postDataJSON() ?? {};
      state.capturedAttachAlt = { parentKey: altMatch[1]!, isin: body.isin };
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          prUrl: "",
          prNumber: 0,
          lookthroughIncluded: true,
        }),
      });
    }
    const defMatch = path.match(/^\/buckets\/([^/]+)\/default$/);
    if (defMatch && method === "PUT") {
      const body = req.postDataJSON() ?? {};
      state.capturedSetDefault = { parentKey: defMatch[1]!, isin: body.isin };
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, prUrl: "", prNumber: 0 }),
      });
    }
    const poolMatch = path.match(/^\/buckets\/([^/]+)\/pool$/);
    if (poolMatch && method === "POST") {
      const body = req.postDataJSON() ?? {};
      state.capturedAttachPool = { parentKey: poolMatch[1]!, isin: body.isin };
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, prUrl: "", prNumber: 0 }),
      });
    }
    const ltMatch = path.match(/^\/lookthrough-pool\/([^/]+)$/);
    if (ltMatch && method === "POST") {
      state.capturedLookthroughChain.push(ltMatch[1]!);
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          prUrl: "",
          prNumber: 0,
          topHoldingCount: 10,
          geoCount: 20,
          sectorCount: 11,
        }),
      });
    }
    // Default: succeed empty so unrelated polls don't crash the page.
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true }),
    });
  });
}

async function gotoCatalog(page: Page) {
  // Seed sessionStorage so TokenPrompt is bypassed.
  await page.addInitScript(() => {
    try {
      sessionStorage.setItem("investment-lab.admin-token", "test-token");
    } catch {
      /* noop */
    }
  });
  await page.goto("/admin/catalog/browse");
  await expect(page.getByTestId("card-fast-track-add-etf")).toBeVisible({
    timeout: 15_000,
  });
}

async function prefill(page: Page) {
  await page.getByTestId("input-fast-track-isin").fill(TEST_ISIN);
  await page.getByTestId("button-fast-track-prefill").tap();
  // Comment is auto-filled from the description block.
  await expect(page.getByTestId("input-fast-track-comment")).toHaveValue(
    /MSCI World index/,
  );
  await expect(page.getByTestId("fast-track-policy-fit")).toBeVisible();
  await expect(page.getByTestId("fast-track-policy-fit-aum")).toContainText(
    "OK",
  );
  await expect(page.getByTestId("fast-track-policy-fit-ter")).toContainText(
    "OK",
  );
}

async function pickBucket(page: Page, destTestid: string, bucketKey: string) {
  await page.getByTestId(`select-${destTestid}`).tap();
  await page.getByRole("option", { name: bucketKey }).first().tap();
}

test.describe("Admin · Fast-track Add ETF panel (Task #165)", () => {
  test("Register only → POST /admin/instruments only, no bucket route, no look-through chain when unchecked", async ({ page }) => {
    const state: MockState = { capturedLookthroughChain: [] };
    await mockAdminApi(page, state);
    await gotoCatalog(page);
    await prefill(page);
    // Register only is the default destination.
    // Uncheck look-through to verify the chain really is gated.
    await page.getByTestId("checkbox-fast-track-lookthrough").tap();
    await page.getByTestId("button-fast-track-save").tap();
    await expect(page.getByText(/Saved|Gespeichert/i).first()).toBeVisible();
    expect(state.capturedAddInstrument?.entry.isin).toBe(TEST_ISIN);
    expect(state.capturedAddInstrument?.entry.comment).toMatch(
      /MSCI World index/,
    );
    expect(state.capturedAttachAlt).toBeUndefined();
    expect(state.capturedSetDefault).toBeUndefined();
    expect(state.capturedAttachPool).toBeUndefined();
    expect(state.capturedLookthroughChain).toEqual([]);
  });

  test("Set as default of bucket → addInstrument + PUT /admin/buckets/:key/default + look-through chain when checked", async ({ page }) => {
    const state: MockState = { capturedLookthroughChain: [] };
    await mockAdminApi(page, state);
    await gotoCatalog(page);
    await prefill(page);
    await page.getByTestId("button-dest-default").tap();
    await pickBucket(page, "dest-default-bucket", TEST_BUCKET);
    await page.getByTestId("button-fast-track-save").tap();
    await expect(page.getByText(/Saved|Gespeichert/i).first()).toBeVisible();
    expect(state.capturedAddInstrument?.entry.isin).toBe(TEST_ISIN);
    expect(state.capturedSetDefault).toEqual({
      parentKey: TEST_BUCKET,
      isin: TEST_ISIN,
    });
    expect(state.capturedLookthroughChain).toEqual([TEST_ISIN]);
  });

  test("Add as alternative → POST /admin/instruments + POST /admin/buckets/:key/alternatives (no separate look-through chain since attach bundled it)", async ({ page }) => {
    const state: MockState = { capturedLookthroughChain: [] };
    await mockAdminApi(page, state);
    await gotoCatalog(page);
    await prefill(page);
    await page.getByTestId("button-dest-alternative").tap();
    await pickBucket(page, "dest-alternative-bucket", TEST_BUCKET);
    await page.getByTestId("button-fast-track-save").tap();
    await expect(page.getByText(/Saved|Gespeichert/i).first()).toBeVisible();
    expect(state.capturedAddInstrument?.entry.isin).toBe(TEST_ISIN);
    expect(state.capturedAttachAlt).toEqual({
      parentKey: TEST_BUCKET,
      isin: TEST_ISIN,
    });
    // Attach route reports lookthroughIncluded=true → no separate chain.
    expect(state.capturedLookthroughChain).toEqual([]);
  });

  test("Add to pool of bucket → addInstrument + POST /admin/buckets/:key/pool + look-through chain when checked", async ({ page }) => {
    const state: MockState = { capturedLookthroughChain: [] };
    await mockAdminApi(page, state);
    await gotoCatalog(page);
    await prefill(page);
    await page.getByTestId("button-dest-pool").tap();
    await pickBucket(page, "dest-pool-bucket", TEST_BUCKET);
    await page.getByTestId("button-fast-track-save").tap();
    await expect(page.getByText(/Saved|Gespeichert/i).first()).toBeVisible();
    expect(state.capturedAddInstrument?.entry.isin).toBe(TEST_ISIN);
    expect(state.capturedAttachPool).toEqual({
      parentKey: TEST_BUCKET,
      isin: TEST_ISIN,
    });
    expect(state.capturedLookthroughChain).toEqual([TEST_ISIN]);
  });
});
