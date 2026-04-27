// ----------------------------------------------------------------------------
// api-app-defaults.test.ts
// ----------------------------------------------------------------------------
// Lives in investment-lab/tests because api-server has no test runner of its
// own. Imports the api-server's strict validator via a relative path —
// vitest transpiles cross-package TS the same way it does in-package TS.
// Covers happy-path validation, error collection, and the file-rendering /
// _meta-stamping helpers used right before openUpdateAppDefaultsPr().
// ----------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import {
  renderAppDefaultsFile,
  stampMeta,
  validateAppDefaults,
} from "../../api-server/src/lib/app-defaults";

describe("validateAppDefaults — happy path", () => {
  it("accepts an empty object", () => {
    const r = validateAppDefaults({});
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual({});
  });

  it("accepts all three sections with valid values", () => {
    const r = validateAppDefaults({
      riskFreeRates: { USD: 0.05, EUR: 0.025 },
      homeBias: { CHF: 2.5 },
      cma: { equity_us: { expReturn: 0.08, vol: 0.17 } },
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.riskFreeRates).toEqual({ USD: 0.05, EUR: 0.025 });
      expect(r.value.homeBias).toEqual({ CHF: 2.5 });
      expect(r.value.cma).toEqual({ equity_us: { expReturn: 0.08, vol: 0.17 } });
    }
  });

  it("accepts a _meta block with strings or nulls", () => {
    const r = validateAppDefaults({
      _meta: { lastUpdated: "2026-04-27", lastUpdatedBy: null, comment: "foo" },
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value._meta?.lastUpdated).toBe("2026-04-27");
      expect(r.value._meta?.comment).toBe("foo");
    }
  });
});

describe("validateAppDefaults — error cases", () => {
  it("rejects non-object input", () => {
    const r = validateAppDefaults("oops");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.length).toBeGreaterThan(0);
  });

  it("rejects unknown top-level keys", () => {
    const r = validateAppDefaults({ totallyMadeUpKey: 1 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.includes("totallyMadeUpKey"))).toBe(true);
  });

  it("rejects unknown RF currencies", () => {
    const r = validateAppDefaults({ riskFreeRates: { JPY: 0.001 } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.includes("JPY"))).toBe(true);
  });

  it("rejects out-of-range RF values", () => {
    const r = validateAppDefaults({ riskFreeRates: { USD: 0.5 } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.includes("USD"))).toBe(true);
  });

  it("rejects non-finite RF values", () => {
    const r = validateAppDefaults({ riskFreeRates: { USD: Number.NaN } });
    expect(r.ok).toBe(false);
  });

  it("rejects negative home-bias", () => {
    const r = validateAppDefaults({ homeBias: { USD: -0.1 } });
    expect(r.ok).toBe(false);
  });

  it("rejects unknown CMA asset keys", () => {
    const r = validateAppDefaults({ cma: { unknown_asset: { expReturn: 0.05 } } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.includes("unknown_asset"))).toBe(true);
  });

  it("rejects CMA expReturn outside [-0.5, 1]", () => {
    const r = validateAppDefaults({ cma: { equity_us: { expReturn: 2 } } });
    expect(r.ok).toBe(false);
  });

  it("rejects CMA vol outside [0, 2]", () => {
    const r = validateAppDefaults({ cma: { equity_us: { vol: -0.1 } } });
    expect(r.ok).toBe(false);
  });

  it("collects multiple errors in one pass", () => {
    const r = validateAppDefaults({
      riskFreeRates: { JPY: 0.001 },
      homeBias: { USD: -1 },
      cma: { unknown_asset: { expReturn: 0.05 } },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.length).toBeGreaterThanOrEqual(3);
  });
});

describe("renderAppDefaultsFile / stampMeta", () => {
  it("renders 2-space indented JSON with a trailing newline", () => {
    const s = renderAppDefaultsFile({ riskFreeRates: { USD: 0.05 } });
    expect(s.endsWith("\n")).toBe(true);
    expect(s).toContain("  \"riskFreeRates\"");
    expect(s).toContain("    \"USD\": 0.05");
  });

  it("stampMeta sets lastUpdated to today (YYYY-MM-DD) and lastUpdatedBy", () => {
    const stamped = stampMeta({ riskFreeRates: { USD: 0.05 } }, "operator");
    const today = new Date().toISOString().slice(0, 10);
    expect(stamped._meta?.lastUpdated).toBe(today);
    expect(stamped._meta?.lastUpdatedBy).toBe("operator");
  });

  it("stampMeta defaults the operator label to 'admin' when null", () => {
    const stamped = stampMeta({}, null);
    expect(stamped._meta?.lastUpdatedBy).toBe("admin");
  });

  it("stampMeta preserves a pre-existing _meta.comment", () => {
    const stamped = stampMeta({ _meta: { comment: "keep me" } });
    expect(stamped._meta?.comment).toBe("keep me");
  });
});
