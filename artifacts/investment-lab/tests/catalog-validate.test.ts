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
//   • alternative ISINs are unique globally (no overlap with other
//     buckets' defaults or alternatives)
// ----------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import {
  validateCatalog,
  getCatalog,
  MAX_ALTERNATIVES_PER_BUCKET,
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

  it("alternative ISINs are globally unique across the catalog", () => {
    const cat = getCatalog();
    const ownership = new Map<string, string>();
    for (const [key, rec] of Object.entries(cat)) {
      for (const alt of rec.alternatives ?? []) {
        const prev = ownership.get(alt.isin);
        if (prev) {
          throw new Error(
            `alternative ISIN ${alt.isin} appears in both "${prev}" and "${key}" — alternatives must have a unique bucket assignment`,
          );
        }
        ownership.set(alt.isin, key);
      }
    }
    // No assertion needed — throw above is the failure mode.
    expect(ownership.size).toBeGreaterThan(0);
  });

  it("alternative ISINs do not collide with any bucket's default ISIN", () => {
    const cat = getCatalog();
    const defaultIsins = new Map<string, string>(
      Object.entries(cat).map(([k, r]) => [r.isin, k]),
    );
    for (const [key, rec] of Object.entries(cat)) {
      for (const alt of rec.alternatives ?? []) {
        const owner = defaultIsins.get(alt.isin);
        // Same-bucket default↔alt collision is caught by the previous
        // intra-bucket-distinct test; here we only flag cross-bucket
        // collisions where the alternative shadows a different bucket's
        // default (which would make the picker semantics ambiguous).
        if (owner && owner !== key) {
          throw new Error(
            `alternative ISIN ${alt.isin} in "${key}" also serves as the default of "${owner}"`,
          );
        }
      }
    }
    expect(defaultIsins.size).toBeGreaterThan(0);
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
