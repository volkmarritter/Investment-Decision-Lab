import { describe, it, expect } from "vitest";
import { formatThousandsLive } from "../src/components/investment/FeeEstimator";

// Regression for the "Fee Estimator: Investment Amount thousand separator"
// task. Locks in the live-typing behavior the e2e smoke test depends on.
describe("formatThousandsLive", () => {
  it("inserts US-style thousand separators on integer values", () => {
    expect(formatThousandsLive("100000")).toBe("100,000");
    expect(formatThousandsLive("5000000")).toBe("5,000,000");
    expect(formatThousandsLive("1234567890")).toBe("1,234,567,890");
  });

  it("re-groups when the value already contains commas (the digit-by-digit case)", () => {
    // After the user types "5", "0", "0", "0", the input value is "5,000".
    // When they type the next "0" the input becomes "5,0000". The formatter
    // must collapse that back into a clean "50,000".
    expect(formatThousandsLive("5,0000")).toBe("50,000");
    expect(formatThousandsLive("5,00000")).toBe("500,000");
    expect(formatThousandsLive("5,000000")).toBe("5,000,000");
  });

  it("preserves the decimal portion (`.` is the decimal separator)", () => {
    expect(formatThousandsLive("1234567.89")).toBe("1,234,567.89");
    expect(formatThousandsLive("100000.")).toBe("100,000.");
    expect(formatThousandsLive("100000.5")).toBe("100,000.5");
  });

  it("accepts Swiss apostrophe and whitespace as thousand separators", () => {
    expect(formatThousandsLive("100'000")).toBe("100,000");
    expect(formatThousandsLive("1 234 567")).toBe("1,234,567");
  });

  it("returns intermediate states unchanged so the cursor doesn't jump", () => {
    expect(formatThousandsLive("")).toBe("");
    expect(formatThousandsLive("-")).toBe("-");
    expect(formatThousandsLive("5")).toBe("5");
    expect(formatThousandsLive("50")).toBe("50");
    expect(formatThousandsLive("500")).toBe("500");
  });

  it("falls through unchanged on garbled input it cannot parse", () => {
    // Two decimal points is not a valid number — keep the raw value so the
    // user can fix it without the field "fighting" them.
    expect(formatThousandsLive("12.34.56")).toBe("12.34.56");
    expect(formatThousandsLive("abc")).toBe("abc");
  });

  it("normalises leading zeros (acceptable for an amount field)", () => {
    expect(formatThousandsLive("000123")).toBe("123");
    expect(formatThousandsLive("0100000")).toBe("100,000");
  });

  it("groups a negative draft (the parser later clamps to >= 0)", () => {
    // The Investment Amount input itself is non-negative, but the user
    // can mistype a leading "-". The formatter must not throw and the
    // downstream `parseDecimalInput(..., { min: 0 })` clamps the actual
    // computation to zero.
    expect(formatThousandsLive("-100000")).toBe("-100,000");
    expect(formatThousandsLive("-")).toBe("-");
  });

  it("handles realistic upper-bound investment amounts without precision loss", () => {
    // Up to a trillion CHF is comfortably within IEEE-754 safe integer
    // range, so grouping stays exact.
    expect(formatThousandsLive("999999999999")).toBe("999,999,999,999");
  });
});
