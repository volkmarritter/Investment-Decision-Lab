// ----------------------------------------------------------------------------
// app-defaults.test.ts
// ----------------------------------------------------------------------------
// Covers two related layers:
//   1. The frontend `sanitizeAppDefaults` (lib/appDefaults.ts) — defensive
//      reader of the bundled JSON; silently drops unknown keys / out-of-range
//      values so a malformed admin PR cannot brick the engine.
//   2. The backend-equivalent `validateAppDefaults` shape — we don't import
//      the api-server module from here (no test runner in api-server yet),
//      but the frontend sanitiser shares the same bounds and we cover both
//      "good" and "drops bad" paths.
// ----------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { sanitizeAppDefaults } from "../src/lib/appDefaults";

describe("sanitizeAppDefaults — happy path", () => {
  it("returns empty maps for an empty object", () => {
    const r = sanitizeAppDefaults({});
    expect(r).toEqual({ riskFreeRates: {}, homeBias: {}, cma: {} });
  });

  it("accepts a populated payload with all three sections", () => {
    const r = sanitizeAppDefaults({
      riskFreeRates: { USD: 0.05, EUR: 0.025 },
      homeBias: { USD: 1.0, CHF: 2.5 },
      cma: {
        equity_us: { expReturn: 0.08, vol: 0.17 },
        bonds: { vol: 0.07 },
      },
    });
    expect(r.riskFreeRates).toEqual({ USD: 0.05, EUR: 0.025 });
    expect(r.homeBias).toEqual({ USD: 1.0, CHF: 2.5 });
    expect(r.cma).toEqual({
      equity_us: { expReturn: 0.08, vol: 0.17 },
      bonds: { vol: 0.07 },
    });
  });

  it("preserves CMA entries where only one of the two fields is set", () => {
    const r = sanitizeAppDefaults({
      cma: { equity_us: { expReturn: 0.08 }, bonds: { vol: 0.07 } },
    });
    expect(r.cma).toEqual({
      equity_us: { expReturn: 0.08 },
      bonds: { vol: 0.07 },
    });
  });
});

describe("sanitizeAppDefaults — defensive drops", () => {
  it("drops unknown RF currencies", () => {
    const r = sanitizeAppDefaults({
      riskFreeRates: { USD: 0.05, JPY: 0.001 },
    });
    expect(r.riskFreeRates).toEqual({ USD: 0.05 });
  });

  it("drops out-of-range RF values", () => {
    const r = sanitizeAppDefaults({
      riskFreeRates: { USD: 0.5, EUR: -0.01, GBP: 0.04 },
    });
    expect(r.riskFreeRates).toEqual({ GBP: 0.04 });
  });

  it("drops non-finite values silently", () => {
    const r = sanitizeAppDefaults({
      riskFreeRates: { USD: Number.NaN },
      homeBias: { CHF: Number.POSITIVE_INFINITY },
    });
    expect(r.riskFreeRates).toEqual({});
    expect(r.homeBias).toEqual({});
  });

  it("drops out-of-range home-bias values", () => {
    const r = sanitizeAppDefaults({
      homeBias: { USD: -0.1, EUR: 6, GBP: 1.5 },
    });
    expect(r.homeBias).toEqual({ GBP: 1.5 });
  });

  it("drops unknown CMA asset keys", () => {
    const r = sanitizeAppDefaults({
      cma: {
        equity_us: { expReturn: 0.08 },
        unknown_asset: { expReturn: 0.05 },
      },
    });
    expect(r.cma).toEqual({ equity_us: { expReturn: 0.08 } });
  });

  it("drops out-of-range CMA values but keeps the other field if valid", () => {
    const r = sanitizeAppDefaults({
      cma: { equity_us: { expReturn: 99, vol: 0.17 } },
    });
    expect(r.cma).toEqual({ equity_us: { vol: 0.17 } });
  });

  it("drops a CMA entry where both fields are invalid", () => {
    const r = sanitizeAppDefaults({
      cma: { equity_us: { expReturn: 99, vol: -1 } },
    });
    expect(r.cma).toEqual({});
  });

  it("returns empty maps for non-object input", () => {
    expect(sanitizeAppDefaults(null)).toEqual({ riskFreeRates: {}, homeBias: {}, cma: {} });
    expect(sanitizeAppDefaults("oops")).toEqual({ riskFreeRates: {}, homeBias: {}, cma: {} });
    expect(sanitizeAppDefaults(42)).toEqual({ riskFreeRates: {}, homeBias: {}, cma: {} });
  });

  it("ignores a section whose value is not an object", () => {
    const r = sanitizeAppDefaults({
      riskFreeRates: "not an object",
      homeBias: 42,
      cma: null,
    });
    expect(r).toEqual({ riskFreeRates: {}, homeBias: {}, cma: {} });
  });
});
