// @vitest-environment jsdom
//
// Task #160 — Explain's per-bucket IsinPicker now renders a full
// Default / Alt N / Pool role badge (sharing the same colour helpers
// as Build's picker: alt = green, pool = orange, default = neutral).
//
// We only need the IsinPicker, but it is a non-exported component
// inside ExplainPortfolio. This test instead exercises the logic
// shared with Build by mounting a tiny consumer that mimics the
// rendering branch and asserting the badge label + classes per role.

import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { Badge } from "../src/components/ui/badge";
import {
  slotBadgeClassName,
  slotBadgeVariant,
  type SlotKind,
} from "../src/components/investment/etfSlotBadge";
import {
  getInstrumentRole,
  getInstrumentAltIndex,
  type InstrumentRole,
} from "../src/lib/etfs";

function RoleBadge({ isin }: { isin: string }) {
  const role = getInstrumentRole(isin) as InstrumentRole;
  if (role !== "default" && role !== "alternative" && role !== "pool") {
    return null;
  }
  const kind: SlotKind =
    role === "default" ? "default" : role === "pool" ? "pool" : "alternative";
  const altIdx = role === "alternative" ? getInstrumentAltIndex(isin) : null;
  const label =
    role === "default"
      ? "Default"
      : role === "pool"
        ? "Pool"
        : `Alt ${altIdx ?? ""}`.trim();
  const testId =
    role === "default"
      ? `isin-option-default-badge-${isin}`
      : role === "pool"
        ? `isin-option-pool-badge-${isin}`
        : `isin-option-alt-badge-${isin}`;
  return (
    <Badge
      variant={slotBadgeVariant(kind)}
      className={slotBadgeClassName(kind)}
      data-testid={testId}
    >
      {label}
    </Badge>
  );
}

describe("Explain picker role badge — Task #160", () => {
  it("renders a neutral 'Default' badge for the bucket default ISIN", () => {
    // CSPX is the default of Equity-USA in the curated catalog.
    const { getByTestId } = render(<RoleBadge isin="IE00B5BMR087" />);
    const el = getByTestId("isin-option-default-badge-IE00B5BMR087");
    expect(el.textContent).toBe("Default");
    expect(el.className).not.toMatch(/emerald/);
    expect(el.className).not.toMatch(/orange/);
  });

  it("renders a green 'Alt N' badge for a curated alternative", () => {
    // Vanguard S&P 500 (VUAA) is registered as an Equity-USA
    // alternative in the curated catalog. Numbering matches its
    // 1-based slot order in BUCKETS["Equity-USA"].alternatives.
    const isin = "IE00BFMXXD54";
    const idx = getInstrumentAltIndex(isin);
    expect(idx).not.toBeNull();
    expect(idx).toBeGreaterThanOrEqual(1);
    const { getByTestId } = render(<RoleBadge isin={isin} />);
    const el = getByTestId(`isin-option-alt-badge-${isin}`);
    expect(el.textContent).toBe(`Alt ${idx}`);
    expect(el.className).toMatch(/border-emerald-600/);
    expect(el.className).not.toMatch(/orange/);
  });

  it("renders an orange 'Pool' badge for an extended-universe pool entry", () => {
    // IE00B4L5Y983 (iShares Core MSCI World) lives in a bucket pool —
    // not as default, not as a curated alternative. Pool badge must be
    // orange (matching Build's pool indicator), with the existing
    // isin-option-pool-badge-${isin} test-id preserved.
    const isin = "IE00B4L5Y983";
    const { getByTestId } = render(<RoleBadge isin={isin} />);
    const el = getByTestId(`isin-option-pool-badge-${isin}`);
    expect(el.textContent).toBe("Pool");
    expect(el.className).toMatch(/border-orange-600/);
    expect(el.className).not.toMatch(/emerald/);
  });

  it("returns null altIndex for default, pool, and unregistered ISINs", () => {
    // Default ISIN.
    expect(getInstrumentAltIndex("IE00B5BMR087")).toBeNull();
    // Pool ISIN — must also return null since it isn't in alternatives.
    expect(getInstrumentAltIndex("IE00B4L5Y983")).toBeNull();
    // An unregistered ISIN must also return null.
    expect(getInstrumentAltIndex("XX0000000000")).toBeNull();
  });
});
