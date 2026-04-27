import { describe, expect, it } from "vitest";
import {
  APP_DEFAULTS_PRESETS,
  applyPresetToFields,
  findPresetById,
  type AppDefaultsPreset,
  type CmaFields,
  type HbFields,
  type RfFields,
} from "../src/lib/appDefaultsPresets";
import { sanitizeAppDefaults } from "../src/lib/appDefaults";

const RF_KEYS = ["USD", "EUR", "GBP", "CHF"];
const HB_KEYS = ["USD", "EUR", "GBP", "CHF"];
const ASSET_KEYS = [
  "equity_us",
  "equity_eu",
  "equity_uk",
  "equity_ch",
  "equity_jp",
  "equity_em",
  "equity_thematic",
  "bonds",
  "cash",
  "gold",
  "reits",
  "crypto",
];

function emptyState(): { rf: RfFields; hb: HbFields; cma: CmaFields } {
  return {
    rf: { USD: "", EUR: "", GBP: "", CHF: "" },
    hb: { USD: "", EUR: "", GBP: "", CHF: "" },
    cma: Object.fromEntries(ASSET_KEYS.map((k) => [k, { expReturn: "", vol: "" }])) as CmaFields,
  };
}

function withSomeManualEdits(): { rf: RfFields; hb: HbFields; cma: CmaFields } {
  const s = emptyState();
  s.rf.USD = "4.250";
  s.rf.EUR = "2.500";
  s.hb.CHF = "2.5";
  s.cma.bonds = { expReturn: "3.500", vol: "6.000" };
  s.cma.equity_us = { expReturn: "7.000", vol: "16.000" };
  return s;
}

describe("AppDefaults presets registry", () => {
  it("has at least one preset", () => {
    expect(APP_DEFAULTS_PRESETS.length).toBeGreaterThan(0);
  });

  it("ships the 'reset to built-in' preset that clears all three sections", () => {
    const reset = findPresetById("reset-builtin");
    expect(reset).toBeDefined();
    expect(reset!.clear).toEqual(["rf", "hb", "cma"]);
    expect(reset!.payload).toBeUndefined();
  });

  it("preset ids are unique kebab-case slugs", () => {
    const ids = APP_DEFAULTS_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(id).toMatch(/^[a-z0-9-]+$/);
    }
  });

  it("every preset has a non-empty label and description", () => {
    for (const p of APP_DEFAULTS_PRESETS) {
      expect(p.label.trim().length).toBeGreaterThan(0);
      expect(p.description.trim().length).toBeGreaterThan(20);
    }
  });

  it("findPresetById returns undefined for unknown id", () => {
    expect(findPresetById("does-not-exist")).toBeUndefined();
    expect(findPresetById("")).toBeUndefined();
  });

  // Presets must produce values the strict backend validator will accept.
  it("every preset value passes the frontend sanitiser unchanged", () => {
    for (const p of APP_DEFAULTS_PRESETS) {
      if (!p.payload) continue;
      const sanitised = sanitizeAppDefaults(p.payload);
      for (const [k, v] of Object.entries(p.payload.riskFreeRates ?? {})) {
        expect(sanitised.riskFreeRates[k], `preset ${p.id}: RF ${k}`).toBe(v);
      }
      for (const [k, v] of Object.entries(p.payload.homeBias ?? {})) {
        expect(sanitised.homeBias[k], `preset ${p.id}: HB ${k}`).toBe(v);
      }
      for (const [k, v] of Object.entries(p.payload.cma ?? {})) {
        const out = sanitised.cma[k];
        expect(out, `preset ${p.id}: CMA ${k} dropped`).toBeDefined();
        if (v.expReturn !== undefined) expect(out.expReturn).toBe(v.expReturn);
        if (v.vol !== undefined) expect(out.vol).toBe(v.vol);
      }
    }
  });

  it("presets only reference known RF/HB currencies and asset keys", () => {
    for (const p of APP_DEFAULTS_PRESETS) {
      for (const k of Object.keys(p.payload?.riskFreeRates ?? {})) {
        expect(RF_KEYS, `preset ${p.id}: unknown RF key ${k}`).toContain(k);
      }
      for (const k of Object.keys(p.payload?.homeBias ?? {})) {
        expect(HB_KEYS, `preset ${p.id}: unknown HB key ${k}`).toContain(k);
      }
      for (const k of Object.keys(p.payload?.cma ?? {})) {
        expect(ASSET_KEYS, `preset ${p.id}: unknown asset key ${k}`).toContain(k);
      }
    }
  });

  it("presets respect documented value bounds", () => {
    for (const p of APP_DEFAULTS_PRESETS) {
      for (const [k, v] of Object.entries(p.payload?.riskFreeRates ?? {})) {
        expect(v, `preset ${p.id}: RF ${k} below 0`).toBeGreaterThanOrEqual(0);
        expect(v, `preset ${p.id}: RF ${k} above 0.20`).toBeLessThanOrEqual(0.2);
      }
      for (const [k, v] of Object.entries(p.payload?.homeBias ?? {})) {
        expect(v, `preset ${p.id}: HB ${k} below 0`).toBeGreaterThanOrEqual(0);
        expect(v, `preset ${p.id}: HB ${k} above 5`).toBeLessThanOrEqual(5);
      }
      for (const [k, v] of Object.entries(p.payload?.cma ?? {})) {
        if (v.expReturn !== undefined) {
          expect(v.expReturn, `preset ${p.id}: CMA ${k} mu below -0.5`).toBeGreaterThanOrEqual(-0.5);
          expect(v.expReturn, `preset ${p.id}: CMA ${k} mu above 1`).toBeLessThanOrEqual(1);
        }
        if (v.vol !== undefined) {
          expect(v.vol, `preset ${p.id}: CMA ${k} vol below 0`).toBeGreaterThanOrEqual(0);
          expect(v.vol, `preset ${p.id}: CMA ${k} vol above 2`).toBeLessThanOrEqual(2);
        }
      }
    }
  });
});

describe("applyPresetToFields semantics", () => {
  it("'reset-builtin' clears every field across all three sections", () => {
    const start = withSomeManualEdits();
    const reset = findPresetById("reset-builtin")!;
    const out = applyPresetToFields(reset, start);
    for (const k of RF_KEYS) expect(out.rf[k as keyof RfFields]).toBe("");
    for (const k of HB_KEYS) expect(out.hb[k as keyof HbFields]).toBe("");
    for (const k of ASSET_KEYS) {
      expect(out.cma[k as keyof CmaFields].expReturn).toBe("");
      expect(out.cma[k as keyof CmaFields].vol).toBe("");
    }
  });

  it("'rf-low-rate' replaces all 4 RF fields, leaves HB and CMA untouched", () => {
    const start = withSomeManualEdits();
    const preset = findPresetById("rf-low-rate")!;
    const out = applyPresetToFields(preset, start);
    expect(out.rf.USD).toBe("1.000");
    expect(out.rf.EUR).toBe("0.500");
    expect(out.rf.GBP).toBe("1.000");
    expect(out.rf.CHF).toBe("0.000");
    // HB / CMA untouched
    expect(out.hb).toEqual(start.hb);
    expect(out.cma).toEqual(start.cma);
  });

  it("'cma-conservative-equity' merges per-key: equity expReturn changes, vol untouched, bonds/cash/gold/crypto untouched", () => {
    const start = withSomeManualEdits();
    const preset = findPresetById("cma-conservative-equity")!;
    const out = applyPresetToFields(preset, start);
    // equity_us expReturn changed to 5.5%, vol untouched (still 16.000)
    expect(out.cma.equity_us.expReturn).toBe("5.500");
    expect(out.cma.equity_us.vol).toBe("16.000");
    // bonds / cash / gold / crypto entirely untouched
    expect(out.cma.bonds).toEqual(start.cma.bonds);
    expect(out.cma.cash).toEqual(start.cma.cash);
    expect(out.cma.gold).toEqual(start.cma.gold);
    expect(out.cma.crypto).toEqual(start.cma.crypto);
    // RF and HB untouched
    expect(out.rf).toEqual(start.rf);
    expect(out.hb).toEqual(start.hb);
  });

  it("'hb-global' clears HB section then sets all currencies to 1, leaves RF and CMA untouched", () => {
    const start = withSomeManualEdits();
    const preset = findPresetById("hb-global")!;
    const out = applyPresetToFields(preset, start);
    expect(out.hb.USD).toBe("1");
    expect(out.hb.EUR).toBe("1");
    expect(out.hb.GBP).toBe("1");
    expect(out.hb.CHF).toBe("1");
    expect(out.rf).toEqual(start.rf);
    expect(out.cma).toEqual(start.cma);
  });

  it("custom preset with `clear` only blanks listed sections", () => {
    const start = withSomeManualEdits();
    const preset: AppDefaultsPreset = {
      id: "test-clear-rf-only",
      label: "Test",
      description: "x".repeat(30),
      clear: ["rf"],
    };
    const out = applyPresetToFields(preset, start);
    for (const k of RF_KEYS) expect(out.rf[k as keyof RfFields]).toBe("");
    expect(out.hb).toEqual(start.hb);
    expect(out.cma).toEqual(start.cma);
  });

  it("custom preset with `clear` + `payload` does clear-then-merge in that order", () => {
    const start = withSomeManualEdits();
    const preset: AppDefaultsPreset = {
      id: "test-clear-then-set",
      label: "Test",
      description: "x".repeat(30),
      clear: ["rf"],
      payload: { riskFreeRates: { USD: 0.03 } },
    };
    const out = applyPresetToFields(preset, start);
    expect(out.rf.USD).toBe("3.000"); // set by payload
    expect(out.rf.EUR).toBe(""); // cleared, not in payload
    expect(out.rf.GBP).toBe(""); // cleared, not in payload
    expect(out.rf.CHF).toBe(""); // cleared, not in payload
  });

  it("payload-only preset (no clear) preserves manual edits in untouched keys", () => {
    const start = withSomeManualEdits();
    const preset: AppDefaultsPreset = {
      id: "test-payload-only",
      label: "Test",
      description: "x".repeat(30),
      payload: { riskFreeRates: { GBP: 0.05 } },
    };
    const out = applyPresetToFields(preset, start);
    expect(out.rf.USD).toBe("4.250"); // manual edit preserved
    expect(out.rf.EUR).toBe("2.500"); // manual edit preserved
    expect(out.rf.GBP).toBe("5.000"); // set by payload
    expect(out.rf.CHF).toBe(""); // unchanged (was empty)
  });
});
