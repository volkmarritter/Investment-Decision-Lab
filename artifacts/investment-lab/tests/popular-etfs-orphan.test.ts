// ----------------------------------------------------------------------------
// popular-etfs-orphan.test.ts
// ----------------------------------------------------------------------------
// Guards the auto-added orphan popular-ETFs block in `src/lib/etfs.ts`
// (added 2026-05-01 via `scripts/inject-popular-etfs.mjs`).
//
// Invariants enforced:
//   1. The marker block (BEGIN/END comments) is intact in `etfs.ts`.
//   2. Every ISIN listed in `scripts/data/popular-etfs-staged.json` is
//      registered in INSTRUMENTS and resolvable via getInstrumentByIsin().
//   3. None of those ISINs is bound to a BUCKET as `default` or
//      `alternative`. They MAY be assigned to the per-bucket `pool`
//      slot (extended universe, surfaced via the "More ETFs" dialog
//      in Build and via the IsinPicker in Explain) — that is now an
//      explicit, supported placement for staged popular ETFs.
//   4. validateCatalog() reports no errors for the catalog as a whole.
//   5. ≥ 80 orphan entries exist (Definition of Done minimum).
//   6. ≥ 80% of orphan ISINs have a complete look-through pool entry
//      in `src/data/lookthrough.overrides.json` (DoD coverage gate).
// ----------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  getInstrumentByIsin,
  getInstrumentRole,
  validateCatalog,
} from "../src/lib/etfs";
import { profileFor } from "../src/lib/lookthrough";
import overrides from "../src/data/lookthrough.overrides.json";
import { POPULAR_ETF_SEED } from "../scripts/data/popular-etfs-seed.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const STAGED_PATH = resolve(here, "../scripts/data/popular-etfs-staged.json");
const ETFS_TS_PATH = resolve(here, "../src/lib/etfs.ts");

interface StagedEntry {
  isin: string;
  name: string;
  currency: string;
  domicile: string;
  terBps: number;
  replication: string;
  distribution: string;
  defaultExchange: string;
}

interface StagedFile {
  _meta: Record<string, unknown>;
  instruments: StagedEntry[];
  failed?: unknown[];
}

const stagedFile: StagedFile = JSON.parse(readFileSync(STAGED_PATH, "utf8"));
const staged: StagedEntry[] = stagedFile.instruments;
const etfsSource = readFileSync(ETFS_TS_PATH, "utf8");

describe("popular-ETFs orphan block", () => {
  it("preserves the marker comment block in etfs.ts", () => {
    expect(etfsSource).toContain(
      "// ----- BEGIN auto-added popular-ETFs orphans -----",
    );
    expect(etfsSource).toContain(
      "// ----- END auto-added popular-ETFs orphans -----",
    );
  });

  it("staged set contains at least 80 entries (DoD minimum)", () => {
    expect(staged.length).toBeGreaterThanOrEqual(80);
  });

  it("every staged ISIN resolves through getInstrumentByIsin()", () => {
    const missing: string[] = [];
    for (const entry of staged) {
      if (!getInstrumentByIsin(entry.isin)) missing.push(entry.isin);
    }
    expect(missing, `Unresolved staged ISINs: ${missing.join(", ")}`).toEqual(
      [],
    );
  });

  it("no staged ISIN is bound as default or alternative (pool placement is allowed)", () => {
    const wrongly: { isin: string; role: string }[] = [];
    for (const entry of staged) {
      const role = getInstrumentRole(entry.isin);
      if (role === "default" || role === "alternative") {
        wrongly.push({ isin: entry.isin, role });
      }
    }
    expect(
      wrongly,
      `Staged popular ETFs may only be unassigned or pool-only; offenders: ${wrongly
        .map((w) => `${w.isin}=${w.role}`)
        .join(", ")}`,
    ).toEqual([]);
  });

  it("validateCatalog() returns no issues with the orphan block in place", () => {
    const issues = validateCatalog();
    expect(issues, JSON.stringify(issues, null, 2)).toEqual([]);
  });

  it("≥ 80% of orphan ISINs are consumable via profileFor() at runtime", () => {
    // Architect feedback (2026-05-01): the previous version of this test
    // counted raw `pool[isin]` JSON-key presence, which silently passed
    // even when the runtime merge in src/lib/lookthrough.ts dropped the
    // entry (it required topHoldings). Now we assert the end-to-end
    // contract: profileFor() returns a non-null profile with usable
    // geo + sector. This is what analyzeLookthrough() actually consumes,
    // so this is the real coverage gate.
    const total = staged.length;
    const covered = staged.filter((e) => {
      const p = profileFor(e.isin);
      return Boolean(
        p &&
          p.geo &&
          Object.keys(p.geo).length > 0 &&
          p.sector &&
          Object.keys(p.sector).length > 0,
      );
    }).length;
    const ratio = covered / total;
    expect(
      ratio,
      `Runtime profileFor() coverage: ${covered}/${total} = ${(ratio * 100).toFixed(1)}% (need ≥ 80%). ` +
        `If the writer-side gate (scripts/scrape-popular-etfs-pool.mjs) and the reader-side gate ` +
        `(src/lib/lookthrough.ts pool-merge loop) drift apart, this assertion will catch it.`,
    ).toBeGreaterThanOrEqual(0.8);
  });

  it("bond ETFs in the staged set carry isEquity:false in their pool entry", () => {
    // Architect feedback (2026-05-01): the runtime merge defaults to
    // isEquity:true for backward compatibility with pre-Task-#127 admin
    // pool entries (all equity). Bond / money-market / inflation-linked
    // ETFs added by scripts/scrape-popular-etfs-pool.mjs MUST carry
    // isEquity:false so analyzeLookthrough() routes them to the
    // fixed-income geo path instead of polluting equity geo/sector cards.
    //
    // We assert against the pool JSON directly (not profileFor()) because
    // profileFor() resolves through the ALIAS map first — and a small
    // pre-existing set of share-class aliases (HEDGED_ISINS) intentionally
    // reroute their look-through to the underlying equity profile (e.g.
    // EUR-hedged share classes of S&P 500). Those rerouted lookups are
    // by design; what we care about here is that the data we wrote is
    // shaped correctly so the non-aliased majority routes through the
    // bond path.
    const FIXED_INCOME_RE =
      /^(corp bonds|govt bonds|em bonds|us aggregate bond|inflation-linked|money market|fallen angels)/i;
    const fiSeedIsins = new Set(
      (POPULAR_ETF_SEED as ReadonlyArray<{ isin: string; category?: string }>)
        .filter((s) => FIXED_INCOME_RE.test(s.category ?? ""))
        .map((s) => s.isin),
    );
    const pool = (overrides as { pool: Record<string, { isEquity?: boolean }> })
      .pool;
    const wronglyEquity: string[] = [];
    for (const e of staged) {
      if (!fiSeedIsins.has(e.isin)) continue;
      const entry = pool[e.isin];
      if (!entry) continue; // no pool entry at all → covered by other tests
      if (entry.isEquity !== false) wronglyEquity.push(e.isin);
    }
    expect(
      wronglyEquity,
      `Bond/MM pool entries missing isEquity:false (would route to equity ` +
        `geo/sector for non-aliased ISINs): ${wronglyEquity.join(", ")}`,
    ).toEqual([]);
  });
});
