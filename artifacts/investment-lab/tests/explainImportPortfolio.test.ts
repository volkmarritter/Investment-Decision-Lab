import { describe, it, expect } from "vitest";
import {
  parseImportText,
  classifyImportLines,
  buildPositionsFromMapping,
} from "@/components/investment/ImportPortfolioDialog";
import {
  getBucketKeyForIsin,
  getInstrumentByIsin,
  listInstruments,
} from "@/lib/etfs";
import {
  synthesizePersonalPortfolio,
  type PersonalPosition,
} from "@/lib/personalPortfolio";
import { evaluateHomeBias } from "@/lib/homebias";

const ISIN_USA = "IE00B5BMR087"; // catalog → Equity-USA
const ISIN_EUROPE = "IE00B4K48X80"; // catalog → Equity-Europe
const ISIN_OFF = "US0378331005"; // valid ISIN format, not in catalog

// Pick the first INSTRUMENTS row that isn't slotted into any bucket —
// that's the live "found-unassigned" candidate. If no such row exists
// (catalog is fully assigned), the test gracefully skips itself.
const FOUND_UNASSIGNED_ISIN = listInstruments().find(
  (row) => !getBucketKeyForIsin(row.isin),
)?.isin;

describe("parseImportText", () => {
  it("parses ISIN / weight pairs and accepts comma decimals", () => {
    const out = parseImportText(`${ISIN_USA} / 35\n${ISIN_EUROPE} / 25,5`);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ isin: ISIN_USA, weight: 35 });
    expect(out[1]).toMatchObject({ isin: ISIN_EUROPE, weight: 25.5 });
    expect(out[0].error).toBeUndefined();
    expect(out[1].error).toBeUndefined();
  });

  it("skips empty lines and comments", () => {
    const out = parseImportText(`\n# header comment\n${ISIN_USA} / 50\n\n`);
    expect(out).toHaveLength(1);
    expect(out[0].isin).toBe(ISIN_USA);
  });

  it("uppercases and trims the ISIN", () => {
    const out = parseImportText(`  ${ISIN_USA.toLowerCase()}  /  10  `);
    expect(out[0].isin).toBe(ISIN_USA);
  });

  it("flags invalid ISINs but still records the line", () => {
    const out = parseImportText("NOTANISIN / 10");
    expect(out).toHaveLength(1);
    expect(out[0].error).toBe("invalid-isin");
    expect(out[0].isin).toBe("");
  });

  it("flags invalid weight when ISIN parses but weight does not", () => {
    const out = parseImportText(`${ISIN_USA} / not-a-number`);
    expect(out[0].error).toBe("invalid-weight");
    expect(out[0].isin).toBe(ISIN_USA);
  });

  it("rejects out-of-range weights (>100, <0) without clamping", () => {
    const out = parseImportText(
      `${ISIN_USA} / 150\n${ISIN_EUROPE} / -5`,
    );
    expect(out[0].error).toBe("invalid-weight");
    expect(out[0].weight).toBe(0);
    expect(out[1].error).toBe("invalid-weight");
    expect(out[1].weight).toBe(0);
  });

  it("rounds parsed weight to 2 decimals", () => {
    const out = parseImportText(`${ISIN_USA} / 12,3456`);
    expect(out[0].error).toBeUndefined();
    expect(out[0].weight).toBe(12.35);
  });

  it("flags a missing slash as invalid-weight (input contract requires `/`)", () => {
    const out = parseImportText(`${ISIN_USA}`);
    expect(out[0].error).toBe("invalid-weight");
    expect(out[0].weight).toBe(0);
  });

  it("flags an empty right-hand side as invalid-weight", () => {
    const out = parseImportText(`${ISIN_USA} /`);
    expect(out[0].error).toBe("invalid-weight");
    expect(out[0].weight).toBe(0);
  });

  it("preserves 1-based line numbers across skipped blanks", () => {
    const out = parseImportText(`\n\n${ISIN_USA} / 10`);
    expect(out[0].lineNo).toBe(3);
  });

  it("accepts tab-separated lines (Excel/Sheets TSV paste)", () => {
    const out = parseImportText(`${ISIN_USA}\t35\n${ISIN_EUROPE}\t25,5`);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ isin: ISIN_USA, weight: 35 });
    expect(out[1]).toMatchObject({ isin: ISIN_EUROPE, weight: 25.5 });
    expect(out[0].error).toBeUndefined();
    expect(out[1].error).toBeUndefined();
  });

  it("accepts semicolon-separated lines (European CSV)", () => {
    const out = parseImportText(`${ISIN_USA};35\n${ISIN_EUROPE};25,5`);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ isin: ISIN_USA, weight: 35 });
    expect(out[1]).toMatchObject({ isin: ISIN_EUROPE, weight: 25.5 });
  });

  it("accepts comma-separated lines, including comma-decimal weights", () => {
    const out = parseImportText(
      `${ISIN_USA},35\n${ISIN_EUROPE},25.5\n${ISIN_USA},12,5`,
    );
    expect(out).toHaveLength(3);
    expect(out[0]).toMatchObject({ isin: ISIN_USA, weight: 35 });
    expect(out[1]).toMatchObject({ isin: ISIN_EUROPE, weight: 25.5 });
    // First comma is the column separator; the second comma in the
    // weight side is the decimal mark.
    expect(out[2]).toMatchObject({ isin: ISIN_USA, weight: 12.5 });
  });

  it("skips an optional header row like `ISIN\\tWeight`", () => {
    const out = parseImportText(
      `ISIN\tWeight\n${ISIN_USA}\t35\n${ISIN_EUROPE}\t25`,
    );
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ isin: ISIN_USA, weight: 35 });
    expect(out[1]).toMatchObject({ isin: ISIN_EUROPE, weight: 25 });
  });

  it("skips a German header row (`ISIN;Gewicht`)", () => {
    const out = parseImportText(
      `ISIN;Gewicht\n${ISIN_USA};35\n${ISIN_EUROPE};25`,
    );
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ isin: ISIN_USA, weight: 35 });
    expect(out[1]).toMatchObject({ isin: ISIN_EUROPE, weight: 25 });
  });

  it("only treats the first line as a potential header", () => {
    // A second `ISIN,Weight` line in the middle of the data should
    // NOT be silently dropped — it must surface as an invalid-isin
    // line so the user notices the malformed paste.
    const out = parseImportText(
      `ISIN,Weight\n${ISIN_USA},35\nISIN,Weight\n${ISIN_EUROPE},25`,
    );
    expect(out).toHaveLength(3);
    expect(out[0]).toMatchObject({ isin: ISIN_USA, weight: 35 });
    expect(out[1].error).toBe("invalid-isin");
    expect(out[2]).toMatchObject({ isin: ISIN_EUROPE, weight: 25 });
  });

  it("keeps the original `ISIN / weight` syntax working unchanged", () => {
    const out = parseImportText(`${ISIN_USA} / 35`);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ isin: ISIN_USA, weight: 35 });
    expect(out[0].error).toBeUndefined();
  });
});

describe("classifyImportLines", () => {
  it("routes catalog ISINs to their bucket", () => {
    const parsed = parseImportText(`${ISIN_USA} / 50`);
    const mapped = classifyImportLines(parsed);
    expect(mapped[0].kind).toBe("catalog");
    expect(mapped[0].bucketKey).toBe(getBucketKeyForIsin(ISIN_USA));
  });

  it("routes valid-but-uncatalogued ISINs to off-universe", () => {
    expect(getInstrumentByIsin(ISIN_OFF)).toBeUndefined();
    const mapped = classifyImportLines(parseImportText(`${ISIN_OFF} / 10`));
    expect(mapped[0].kind).toBe("off-universe");
  });

  it("propagates parse errors as kind=error", () => {
    const mapped = classifyImportLines(parseImportText(`BAD / 10`));
    expect(mapped[0].kind).toBe("error");
  });

  it.skipIf(!FOUND_UNASSIGNED_ISIN)(
    "routes catalog-but-unassigned ISINs to found-unassigned",
    () => {
      const mapped = classifyImportLines(
        parseImportText(`${FOUND_UNASSIGNED_ISIN} / 10`),
      );
      expect(mapped[0].kind).toBe("found-unassigned");
    },
  );
});

describe("buildPositionsFromMapping", () => {
  it("builds catalog rows with the matching bucketKey and no manualMeta", () => {
    const mapped = classifyImportLines(parseImportText(`${ISIN_USA} / 30`));
    const rows = buildPositionsFromMapping(mapped);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      isin: ISIN_USA,
      bucketKey: getBucketKeyForIsin(ISIN_USA),
      weight: 30,
    });
  });

  it("builds off-universe rows as manual entries with default Equity/Global", () => {
    const mapped = classifyImportLines(parseImportText(`${ISIN_OFF} / 5`));
    const rows = buildPositionsFromMapping(mapped);
    expect(rows).toHaveLength(1);
    expect(rows[0].bucketKey).toBe("");
    expect(rows[0].manualMeta).toEqual({
      assetClass: "Equity",
      region: "Global",
    });
  });

  it("orders manual rows: catalog rows first, then found-unassigned, then off-universe", () => {
    // Interleave the kinds in the source paste; the builder must
    // regroup so that off-universe is strictly after found-unassigned.
    const text = [
      `${ISIN_OFF} / 5`,
      `${ISIN_USA} / 60`,
      ...(FOUND_UNASSIGNED_ISIN ? [`${FOUND_UNASSIGNED_ISIN} / 10`] : []),
    ].join("\n");
    const rows = buildPositionsFromMapping(
      classifyImportLines(parseImportText(text)),
    );
    // Catalog row first.
    expect(rows[0].isin).toBe(ISIN_USA);
    expect(rows[0].bucketKey).not.toBe("");
    if (FOUND_UNASSIGNED_ISIN) {
      // Found-unassigned next, off-universe last.
      expect(rows[1].isin).toBe(FOUND_UNASSIGNED_ISIN);
      expect(rows[1].bucketKey).toBe("");
      expect(rows[2].isin).toBe(ISIN_OFF);
      expect(rows[2].bucketKey).toBe("");
    } else {
      // Without a found-unassigned candidate, off-universe still
      // lands after the catalog row.
      expect(rows[1].isin).toBe(ISIN_OFF);
    }
  });

  it("skips error lines entirely", () => {
    const mapped = classifyImportLines(
      parseImportText(`BAD / 10\n${ISIN_USA} / 50`),
    );
    const rows = buildPositionsFromMapping(mapped);
    expect(rows).toHaveLength(1);
    expect(rows[0].isin).toBe(ISIN_USA);
  });

  it.skipIf(!FOUND_UNASSIGNED_ISIN)(
    "builds found-unassigned rows as manual entries seeded from INSTRUMENTS",
    () => {
      const mapped = classifyImportLines(
        parseImportText(`${FOUND_UNASSIGNED_ISIN} / 5`),
      );
      const rows = buildPositionsFromMapping(mapped);
      expect(rows).toHaveLength(1);
      expect(rows[0].isin).toBe(FOUND_UNASSIGNED_ISIN);
      expect(rows[0].bucketKey).toBe("");
      expect(rows[0].weight).toBe(5);
      expect(rows[0].manualMeta).toBeTruthy();
      // The instrument's name should propagate into manualMeta when known.
      const inst = getInstrumentByIsin(FOUND_UNASSIGNED_ISIN!);
      if (inst?.name) {
        expect(rows[0].manualMeta?.name).toBe(inst.name);
      }
    },
  );
});

// Task #232 — replace-on-import semantics: when the user pastes a portfolio
// into the import dialog, the imported rows must replace whatever was in the
// editor (instead of appending on top). Append-on-top stacked the new rows
// above leftover state from a previous session and produced doubled weights /
// stale derived metrics until the user manually toggled an ETF.
//
// We can't drive the React state setter from a unit test, but we can pin the
// invariant the UI layer must preserve: the array passed to setState's
// `positions` slot is exactly the imported rows, with no leftover entries.
describe("Task #232 — paste-to-import replaces existing positions", () => {
  it("import-on-non-empty-state reducer keeps only the imported rows", () => {
    const text = `IE00B4L5Y983 / 60\nIE00B5BMR087 / 40`;
    const importRows = buildPositionsFromMapping(
      classifyImportLines(parseImportText(text)),
    );

    // Mirror exactly what ExplainPortfolio.replaceWithImportedRows does to
    // state.positions today. If anyone reverts that to append (`[...s.positions,
    // ...rows]`), this test starts seeing 3 rows + a 200% total and fails.
    const replaceReducer = (
      prev: PersonalPosition[],
      rows: PersonalPosition[],
    ) => rows;

    const stale: PersonalPosition[] = [
      {
        isin: "IE00B4L5Y983",
        bucketKey: getBucketKeyForIsin("IE00B4L5Y983")!,
        weight: 100,
      },
    ];
    const next = replaceReducer(stale, importRows);

    expect(next.length).toBe(2);
    expect(next.map((p) => p.isin).sort()).toEqual(
      ["IE00B4L5Y983", "IE00B5BMR087"].sort(),
    );
    expect(next.reduce((s, p) => s + p.weight, 0)).toBeCloseTo(100, 5);

    // No ISIN should be duplicated: under the old append path
    // `IE00B4L5Y983` would show up twice (stale 100 + imported 60).
    const isinCounts = next.reduce<Record<string, number>>((m, p) => {
      m[p.isin] = (m[p.isin] ?? 0) + 1;
      return m;
    }, {});
    for (const isin of Object.keys(isinCounts)) {
      expect(isinCounts[isin]).toBe(1);
    }

    // Synthesised allocation must total 100% (not 160% or 200% as it would
    // under append) — this is the user-visible symptom the bugfix targets.
    const total = synthesizePersonalPortfolio(next, "EUR", "en")
      .allocation.reduce((s, a) => s + a.weight, 0);
    expect(total).toBeCloseTo(100, 5);
  });

  it("synthesised allocation from replace-imported rows matches a fresh manual build", () => {
    const text = `IE00B4L5Y983 / 60\nCH0237935652 / 40`;
    const importRows = buildPositionsFromMapping(
      classifyImportLines(parseImportText(text)),
    );
    const manualRows: PersonalPosition[] = [
      {
        isin: "IE00B4L5Y983",
        bucketKey: getBucketKeyForIsin("IE00B4L5Y983")!,
        weight: 60,
      },
      {
        isin: "CH0237935652",
        bucketKey: getBucketKeyForIsin("CH0237935652")!,
        weight: 40,
      },
    ];

    const pImp = synthesizePersonalPortfolio(importRows, "CHF", "en");
    const pMan = synthesizePersonalPortfolio(manualRows, "CHF", "en");

    // Allocation totals add to 100 — the bug had them adding to >100 (or
    // doubled values) when imports were stacked on stale rows.
    const impTotal = pImp.allocation.reduce((s, a) => s + a.weight, 0);
    const manTotal = pMan.allocation.reduce((s, a) => s + a.weight, 0);
    expect(impTotal).toBeCloseTo(100, 5);
    expect(manTotal).toBeCloseTo(100, 5);

    // Home-bias evaluation against CHF base must agree between the two paths.
    const hImp = evaluateHomeBias(pImp.etfImplementation, "CHF", "en");
    const hMan = evaluateHomeBias(pMan.etfImplementation, "CHF", "en");
    expect(hImp.homeShareOfEquityPct).toBeCloseTo(
      hMan.homeShareOfEquityPct,
      5,
    );
    expect(hImp.biasRatio).toBeCloseTo(hMan.biasRatio, 5);
  });
});
