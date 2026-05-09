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

  it("treats a missing weight as 0 (no error)", () => {
    const out = parseImportText(`${ISIN_USA}`);
    expect(out[0].error).toBeUndefined();
    expect(out[0].weight).toBe(0);
  });

  it("preserves 1-based line numbers across skipped blanks", () => {
    const out = parseImportText(`\n\n${ISIN_USA} / 10`);
    expect(out[0].lineNo).toBe(3);
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
