// Seam tests for the merge layer between the monthly justETF refresh job
// (writes src/data/lookthrough.overrides.json) and the curated PROFILES in
// src/lib/lookthrough.ts.
//
// Why this exists: the monthly refresh writes per-ISIN `topHoldings` and
// `topHoldingsAsOf` stamps into lookthrough.overrides.json, and the merge
// loop in lookthrough.ts shallow-merges those onto PROFILES at module load.
// scrapers.test.ts only covers the parser side (raw HTML → {name, pct}[]),
// and engine.test.ts doesn't assert that an override actually flows through
// `profileFor` / `topHoldingsStampFor` / `getLookthroughSnapshotMeta`. A
// future refactor (renaming the override key, changing the merge order,
// dropping `topHoldingsAsOf`, or breaking ALIAS resolution) could silently
// revert the UI to the empty curated fallback again — exactly the bug
// task #10 just fixed. This file pins the seam down with a synthetic
// fixture so any such regression trips CI before the snapshot is committed
// (the monthly GitHub Action runs `pnpm run test` after the refresh).
import { describe, it, expect, vi } from "vitest";

// Fixture override file injected in place of the real
// src/data/lookthrough.overrides.json. We pick:
//   - IE00B5BMR087 (S&P 500): has a curated default `topHoldings`, so we can
//     assert the override REPLACES rather than merges with the curated list.
//     It is also the alias target for several hedged share classes — used
//     below to verify alias resolution carries the override through.
//   - IE00B4L5YX21 (MSCI Japan IMI): has a curated default but receives no
//     override here, so we can assert non-overridden ISINs keep their
//     curated defaults (the merge loop must be additive, not destructive).
//   - IE00B3WJKG14: receives a `topHoldingsAsOf` stamp WITHOUT a
//     `topHoldings` array — guards against a future refactor where the
//     stamp branch silently piggybacks on the holdings branch.
//
// The fixture and the constants used both inside the vi.mock factory AND
// inside the test bodies are declared via `vi.hoisted` so they survive
// vi.mock's top-of-file hoisting (otherwise the factory references vars
// that aren't initialised yet — see vitest hoisting rules).
const FX = vi.hoisted(() => ({
  LAST_REFRESHED: "2030-04-15T08:30:00.000Z",
  SP500_HOLDINGS: [
    { name: "Test Holding Alpha", pct: 9.99 },
    { name: "Test Holding Beta", pct: 8.88 },
    { name: "Test Holding Gamma", pct: 7.77 },
  ],
  SP500_AS_OF: "2030-04-15T08:30:00.000Z",
  TECH_AS_OF: "2030-03-01T00:00:00.000Z",
}));

vi.mock("@/data/lookthrough.overrides.json", () => ({
  default: {
    _meta: {
      source: "test-fixture",
      lastRefreshed: FX.LAST_REFRESHED,
      refreshedBy: "tests/lookthrough-overrides.test.ts",
    },
    overrides: {
      // S&P 500 — full override (holdings + stamp). Drives the alias and
      // "override replaces curated default" assertions below.
      "IE00B5BMR087": {
        topHoldings: FX.SP500_HOLDINGS,
        topHoldingsAsOf: FX.SP500_AS_OF,
      },
      // Stamp-only override — no `topHoldings` array. The merge loop must
      // still apply the stamp, and must NOT clobber the curated default
      // top-holdings list with `undefined`.
      "IE00B3WJKG14": {
        topHoldingsAsOf: FX.TECH_AS_OF,
      },
      // ISIN that does not exist in PROFILES — the merge loop must skip
      // it without throwing. Guards against a future refactor that
      // assumes every override key has a matching curated profile.
      "XX9999999999": {
        topHoldings: [{ name: "Should Be Ignored", pct: 1.0 }],
        topHoldingsAsOf: "2030-04-15T08:30:00.000Z",
      },
    },
  },
}));

// IMPORTANT: import AFTER vi.mock so the module-load merge loop in
// lookthrough.ts sees the mocked overrides JSON. (vi.mock is hoisted by
// Vitest, but keeping the import order explicit makes the contract obvious
// to a future reader.)
import {
  profileFor,
  topHoldingsStampFor,
  getLookthroughSnapshotMeta,
} from "../src/lib/lookthrough";

describe("lookthrough overrides — getLookthroughSnapshotMeta", () => {
  it("surfaces the file-level _meta.lastRefreshed timestamp", () => {
    // The TopHoldings card in SnapshotFreshness.tsx falls back to this
    // value when no per-ISIN stamp is available. If the merge layer ever
    // stops reading `_meta.lastRefreshed` (e.g. the field is renamed or
    // moved) the UI silently shows "—" again, which is the bug this guards.
    expect(getLookthroughSnapshotMeta().lastRefreshed).toBe(FX.LAST_REFRESHED);
  });
});

describe("lookthrough overrides — topHoldingsStampFor", () => {
  it("returns the per-ISIN topHoldingsAsOf stamp from the override file", () => {
    expect(topHoldingsStampFor("IE00B5BMR087")).toBe(FX.SP500_AS_OF);
  });

  it("returns the stamp even when the override only carries topHoldingsAsOf (no topHoldings)", () => {
    // Guards the independent stamp branch in the merge loop.
    expect(topHoldingsStampFor("IE00B3WJKG14")).toBe(FX.TECH_AS_OF);
  });

  it("returns null for a curated ISIN that has no override entry", () => {
    // IE00B4L5YX21 (MSCI Japan IMI) is in PROFILES but absent from the
    // fixture overrides — so its stamp must be null (the UI then falls
    // back to LOOKTHROUGH_REFERENCE_DATE).
    expect(topHoldingsStampFor("IE00B4L5YX21")).toBeNull();
  });

  it("returns null for an ISIN that is not in PROFILES at all", () => {
    expect(topHoldingsStampFor("ZZ0000000000")).toBeNull();
  });
});

describe("lookthrough overrides — profileFor.topHoldings", () => {
  it("returns the OVERRIDE topHoldings array (not the curated default) when an override is present", () => {
    const profile = profileFor("IE00B5BMR087");
    expect(profile).not.toBeNull();
    expect(profile!.topHoldings).toEqual(FX.SP500_HOLDINGS);
    // Sanity: the curated default for S&P 500 leads with Apple at ~7%.
    // The fixture leads with "Test Holding Alpha" — so if the merge ever
    // silently no-ops, this assertion catches it.
    expect(profile!.topHoldings![0].name).toBe("Test Holding Alpha");
  });

  it("preserves the curated default topHoldings for ISINs without an override", () => {
    // The merge loop must be additive. Wiping the curated list whenever an
    // override file is loaded would silently empty most cards in the UI.
    const profile = profileFor("IE00B4L5YX21");
    expect(profile).not.toBeNull();
    expect(profile!.topHoldings).toBeDefined();
    expect(profile!.topHoldings!.length).toBeGreaterThan(0);
    // Curated default for MSCI Japan IMI starts with Toyota.
    expect(profile!.topHoldings![0].name).toMatch(/Toyota/);
  });

  it("does NOT clobber curated topHoldings when an override only carries topHoldingsAsOf", () => {
    // IE00B3WJKG14 (S&P 500 IT sector) gets a stamp-only patch in the
    // fixture. The curated default lists Apple/Microsoft/Nvidia — the
    // merge loop must keep that list intact even though the override
    // entry exists.
    const profile = profileFor("IE00B3WJKG14");
    expect(profile).not.toBeNull();
    expect(profile!.topHoldings).toBeDefined();
    expect(profile!.topHoldings!.length).toBeGreaterThan(0);
    // Curated leader for the IT-sector ETF is Apple at ~17%.
    const leaderName = profile!.topHoldings![0].name;
    expect(leaderName).toMatch(/Apple|Microsoft|Nvidia/);
  });

  it("ignores override entries whose ISIN is not present in the curated PROFILES", () => {
    // The fixture includes "XX9999999999" — the merge loop's `if (!target)
    // continue;` guard must skip it cleanly. profileFor must still report
    // null for it (and crucially, must not have crashed at module load).
    expect(profileFor("XX9999999999")).toBeNull();
  });
});

describe("lookthrough overrides — ALIAS resolution flows the override through", () => {
  // ALIAS in lookthrough.ts maps several hedged share classes to the
  // canonical S&P 500 ISIN (IE00B5BMR087). The TopHoldings card looks
  // up holdings by the user's actual ETF ISIN, which is often a hedged
  // alias — so the override must reach the user via ALIAS, not just via
  // the canonical key. If a future refactor resolves the alias *before*
  // the merge (or merges into a copy that the alias path doesn't see),
  // the UI silently falls back to the curated list for hedged variants.
  it.each([
    ["IE00B3YCGJ38", "Invesco S&P 500 Synthetic"],
    ["IE00BCRY6557", "S&P 500 EUR Hedged"],
    ["IE00BYX5MS15", "S&P 500 GBP Hedged"],
    ["IE00B3ZW0K18", "S&P 500 CHF Hedged variant slot"],
  ])("alias %s (%s) inherits the overridden topHoldings of the canonical S&P 500 ISIN", (alias) => {
    const profile = profileFor(alias);
    expect(profile).not.toBeNull();
    expect(profile!.topHoldings).toEqual(FX.SP500_HOLDINGS);
  });

  it("aliases also inherit the per-ISIN topHoldingsAsOf stamp of the canonical ISIN", () => {
    // topHoldingsStampFor goes through profileFor, so alias resolution
    // applies here too. The hedged S&P 500 cards need this to render the
    // refreshed timestamp instead of the LOOKTHROUGH_REFERENCE_DATE
    // fallback.
    expect(topHoldingsStampFor("IE00BCRY6557")).toBe(FX.SP500_AS_OF);
    expect(topHoldingsStampFor("IE00B3YCGJ38")).toBe(FX.SP500_AS_OF);
  });
});
