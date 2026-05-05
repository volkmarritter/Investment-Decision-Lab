// ----------------------------------------------------------------------------
// catalog-validate.test.ts
// ----------------------------------------------------------------------------
// Guards the per-bucket ETF picker invariants. The curated catalog
// carries 1 default + up to MAX_ALTERNATIVES_PER_BUCKET alternatives
// per bucket, and the system relies on validateCatalog() returning []
// at build time. CI must fail loudly the moment a future edit violates
// any of:
//   • alternatives.length ≤ MAX_ALTERNATIVES_PER_BUCKET per bucket
//   • all ISINs within a bucket are distinct
//   • every ISIN appears in at most one bucket slot across the whole
//     catalog (default OR alternative — Task #111 strict-uniqueness rule)
// ----------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import {
  validateCatalog,
  getCatalog,
  getBucketPool,
  getInstrumentRole,
  ALL_BUCKET_KEYS,
  MAX_ALTERNATIVES_PER_BUCKET,
  MAX_POOL_PER_BUCKET,
} from "../src/lib/etfs";

describe("validateCatalog()", () => {
  it("returns no issues for the curated catalog", () => {
    const issues = validateCatalog();
    expect(issues, JSON.stringify(issues, null, 2)).toEqual([]);
  });

  it(`every bucket has at most ${MAX_ALTERNATIVES_PER_BUCKET} alternatives`, () => {
    const cat = getCatalog();
    for (const [key, rec] of Object.entries(cat)) {
      const altCount = rec.alternatives?.length ?? 0;
      expect(
        altCount,
        `bucket "${key}" has ${altCount} alternatives`,
      ).toBeLessThanOrEqual(MAX_ALTERNATIVES_PER_BUCKET);
    }
  });

  it("every bucket has a default ETF (the record itself)", () => {
    const cat = getCatalog();
    for (const [key, rec] of Object.entries(cat)) {
      expect(rec.isin, `bucket "${key}" has no default ISIN`).toBeTruthy();
      expect(rec.name, `bucket "${key}" has no default name`).toBeTruthy();
    }
  });

  it("ISINs within a single bucket are distinct (default + alternatives)", () => {
    const cat = getCatalog();
    for (const [key, rec] of Object.entries(cat)) {
      const isins = [rec.isin, ...(rec.alternatives ?? []).map((a) => a.isin)];
      const unique = new Set(isins);
      expect(unique.size, `bucket "${key}" has duplicate ISIN(s): ${isins.join(", ")}`).toBe(isins.length);
    }
  });

  it("every ISIN appears in at most one bucket slot across the catalog (default | alternative | pool)", () => {
    const cat = getCatalog();
    const ownership = new Map<string, { bucket: string; role: string }>();
    for (const [key, rec] of Object.entries(cat)) {
      const slots: Array<{ isin: string; role: string }> = [
        { isin: rec.isin, role: "default" },
        ...(rec.alternatives ?? []).map((a) => ({ isin: a.isin, role: "alternative" })),
        ...getBucketPool(key).map((p) => ({ isin: p.isin, role: "pool" })),
      ];
      for (const slot of slots) {
        const prev = ownership.get(slot.isin);
        if (prev) {
          throw new Error(
            `ISIN ${slot.isin} appears in "${prev.bucket}" (${prev.role}) and "${key}" (${slot.role}) — every ISIN may belong to at most one bucket slot`,
          );
        }
        ownership.set(slot.isin, { bucket: key, role: slot.role });
      }
    }
    expect(ownership.size).toBeGreaterThan(0);
  });

  it(`every bucket pool has at most ${MAX_POOL_PER_BUCKET} entries`, () => {
    for (const key of ALL_BUCKET_KEYS) {
      const pool = getBucketPool(key);
      expect(
        pool.length,
        `bucket "${key}" has a pool with ${pool.length} entries`,
      ).toBeLessThanOrEqual(MAX_POOL_PER_BUCKET);
    }
  });

  it("getInstrumentRole agrees with the bucket assignment shape for default + alternative slots", () => {
    const cat = getCatalog();
    for (const [, rec] of Object.entries(cat)) {
      expect(getInstrumentRole(rec.isin)).toBe("default");
      for (const alt of rec.alternatives ?? []) {
        expect(getInstrumentRole(alt.isin)).toBe("alternative");
      }
    }
  });

  it("getInstrumentRole returns 'pool' for every pool entry", () => {
    for (const key of ALL_BUCKET_KEYS) {
      for (const p of getBucketPool(key)) {
        expect(getInstrumentRole(p.isin)).toBe("pool");
      }
    }
  });

  it("buckets that expose alternatives include the headline 6 the operator selected", () => {
    // Operator decision (per task brief): Equity-Global, Equity-USA,
    // Equity-Europe, Equity-EM, FixedIncome-Global, Commodities-Gold
    // get curated alternatives. The hedged/synthetic variant keys
    // intentionally do NOT — they're conditional defaults, not picker
    // targets. Locking the headline list here so a regression on any
    // single bucket fails the build with a clear message.
    const cat = getCatalog();
    const required = [
      "Equity-Global",
      "Equity-USA",
      "Equity-Europe",
      "Equity-EM",
      "FixedIncome-Global",
      "Commodities-Gold",
    ];
    for (const key of required) {
      const rec = cat[key];
      expect(rec, `headline bucket "${key}" missing from catalog`).toBeDefined();
      const altCount = rec.alternatives?.length ?? 0;
      expect(altCount, `headline bucket "${key}" must expose at least 1 alternative`).toBeGreaterThanOrEqual(1);
    }
  });
});
