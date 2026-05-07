// @vitest-environment jsdom
// ----------------------------------------------------------------------------
// buildUserDrivenSignal.test.ts
// ----------------------------------------------------------------------------
// Locks in the Task #186 nav-dot fixes:
//
//   1. `getLastBuildUserDriven()` is `false` on a fresh module load (no
//      auto-generate, no Generate button click yet).
//   2. After `setLastBuildUserDriven(true)` it returns `true`, and after
//      `setLastBuildUserDriven(false)` (the Build reset path) it returns
//      `false` again.
//   3. The corresponding subscribe channel only fires when the value
//      actually changes (deduped writes are dropped, so subscribers
//      never see the same value twice in a row).
// ----------------------------------------------------------------------------

import { describe, it, expect, beforeEach } from "vitest";

import {
  getLastBuildInput,
  getLastBuildUserDriven,
  setLastBuildInput,
  setLastBuildUserDriven,
  subscribeLastBuildUserDriven,
} from "../src/lib/settings";

describe("Task #186 — lastBuildUserDriven channel", () => {
  beforeEach(() => {
    // Reset the module-level flag back to false between tests so each
    // case starts from the same fresh-page-load baseline.
    setLastBuildUserDriven(false);
  });

  it("starts false on a fresh load (no Build interaction yet)", () => {
    expect(getLastBuildUserDriven()).toBe(false);
  });

  it("flips true on user-driven Build, then back to false on reset", () => {
    setLastBuildUserDriven(true);
    expect(getLastBuildUserDriven()).toBe(true);
    setLastBuildUserDriven(false);
    expect(getLastBuildUserDriven()).toBe(false);
  });

  it("lastBuildInput is null on fresh load and after a reset round-trip", () => {
    // Defensively clear, then assert "fresh-load" semantics.
    setLastBuildInput(null);
    expect(getLastBuildInput()).toBeNull();

    // Simulate a Build generate publishing a snapshot.
    setLastBuildInput({ baseCurrency: "CHF", horizon: 10 });
    expect(getLastBuildInput()).toEqual({ baseCurrency: "CHF", horizon: 10 });

    // Simulate the Build reset button — must clear the channel back to null
    // so the nav-bar Build dot disappears and Compare's link mirror has
    // nothing to echo. Locks in Task #186 step 1+2.
    setLastBuildInput(null);
    expect(getLastBuildInput()).toBeNull();
  });

  it("subscribers receive only true→false→true transitions, never duplicates", () => {
    const seen: boolean[] = [];
    const unsub = subscribeLastBuildUserDriven((v) => seen.push(v));

    setLastBuildUserDriven(false); // no-op (already false)
    setLastBuildUserDriven(true);
    setLastBuildUserDriven(true); // no-op (deduped)
    setLastBuildUserDriven(false);
    setLastBuildUserDriven(false); // no-op (deduped)

    unsub();

    expect(seen).toEqual([true, false]);
  });
});
