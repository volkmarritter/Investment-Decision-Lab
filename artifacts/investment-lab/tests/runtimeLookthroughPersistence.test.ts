// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const STORAGE_KEY = "investment-lab.lookthrough.runtime.v1";

const SAMPLE_PROFILE = {
  isEquity: false,
  geo: { "United States": 60, Other: 40 },
  sector: { Other: 100 },
  currency: { USD: 60, Other: 40 },
};

beforeEach(() => {
  globalThis.localStorage.clear();
  vi.resetModules();
});

afterEach(() => {
  globalThis.localStorage.clear();
});

describe("Task #238 round 8 — runtime look-through profile persistence", () => {
  it("registerRuntimeLookthroughProfile writes the profile into localStorage", async () => {
    const mod = await import("../src/lib/lookthrough");
    mod.registerRuntimeLookthroughProfile("LU0000000123", SAMPLE_PROFILE);
    const raw = globalThis.localStorage.getItem(STORAGE_KEY);
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!);
    expect(parsed["LU0000000123"]).toEqual(SAMPLE_PROFILE);
  });

  it("a registered runtime profile survives a module reload via localStorage hydration", async () => {
    const first = await import("../src/lib/lookthrough");
    first.registerRuntimeLookthroughProfile("LU0000000123", SAMPLE_PROFILE);
    expect(first.profileFor("LU0000000123")).toEqual(SAMPLE_PROFILE);

    // Simulate page reload — drop the module cache and re-import. The
    // hydrate-on-load step in lookthrough.ts must reconstruct
    // RUNTIME_PROFILES from localStorage so profileFor() still returns
    // the off-catalog profile without re-running the public scrape.
    vi.resetModules();
    const second = await import("../src/lib/lookthrough");
    expect(second.profileFor("LU0000000123")).toEqual(SAMPLE_PROFILE);
  });

  it("clearRuntimeLookthroughProfiles also clears the localStorage cache", async () => {
    const mod = await import("../src/lib/lookthrough");
    mod.registerRuntimeLookthroughProfile("LU0000000123", SAMPLE_PROFILE);
    expect(globalThis.localStorage.getItem(STORAGE_KEY)).not.toBeNull();
    mod.clearRuntimeLookthroughProfiles();
    expect(globalThis.localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(mod.profileFor("LU0000000123")).toBeNull();
  });

  it("hydration ignores corrupt JSON without throwing", async () => {
    globalThis.localStorage.setItem(STORAGE_KEY, "not valid json {");
    // Module load must not throw — a corrupt cache should silently
    // fall back to an empty runtime registry, not crash the app boot.
    const mod = await import("../src/lib/lookthrough");
    expect(mod.profileFor("LU0000000123")).toBeNull();
  });

  it("hydration drops entries that fail the shape guard", async () => {
    globalThis.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        LU0000000123: { isEquity: "yes", geo: {}, sector: {} },
        LU0000000456: SAMPLE_PROFILE,
      }),
    );
    const mod = await import("../src/lib/lookthrough");
    expect(mod.profileFor("LU0000000123")).toBeNull();
    expect(mod.profileFor("LU0000000456")).toEqual(SAMPLE_PROFILE);
  });
});
