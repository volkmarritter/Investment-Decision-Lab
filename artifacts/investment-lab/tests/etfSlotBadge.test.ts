// ----------------------------------------------------------------------------
// etfSlotBadge.test.ts
// ----------------------------------------------------------------------------
// Locks in the per-slot badge mapping rendered next to the Build tab's
// ETF picker dropdown trigger and inside its dropdown items.
//
// Pinned invariants (Task #154):
//   • Slot 0 is always the bucket default → neutral (variant=secondary,
//     no colour classes).
//   • Slot 1..N pointing at curated alternatives → green outline badge.
//   • Slot pointing at an extended-universe pool ETF → orange outline badge.
//   • Default rows never carry the alt/pool colour class — guards against
//     a regression that would let the trailing badge silently take on the
//     pool colour for a default selection.
// ----------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import {
  getSlotKind,
  slotBadgeClassName,
  slotBadgeVariant,
} from "../src/components/investment/etfSlotBadge";

const OPTIONS = [
  { kind: "default" as const },
  { kind: "alternative" as const },
  { kind: "alternative" as const },
  { kind: "pool" as const },
];

describe("etfSlotBadge.getSlotKind", () => {
  it("treats slot 0 as default regardless of the option's kind", () => {
    expect(getSlotKind(OPTIONS, 0)).toBe("default");
    // Even if the option metadata says otherwise, slot 0 stays default.
    expect(getSlotKind([{ kind: "pool" }], 0)).toBe("default");
  });

  it("maps alternative slots to the alternative kind", () => {
    expect(getSlotKind(OPTIONS, 1)).toBe("alternative");
    expect(getSlotKind(OPTIONS, 2)).toBe("alternative");
  });

  it("maps pool slots to the pool kind", () => {
    expect(getSlotKind(OPTIONS, 3)).toBe("pool");
  });

  it("falls back to alternative when the option has no explicit kind", () => {
    expect(getSlotKind([{}, {}], 1)).toBe("alternative");
  });
});

describe("etfSlotBadge.slotBadgeVariant", () => {
  it("uses the secondary variant for the bucket default", () => {
    expect(slotBadgeVariant("default")).toBe("secondary");
  });

  it("uses the outline variant for alternatives and pool entries", () => {
    expect(slotBadgeVariant("alternative")).toBe("outline");
    expect(slotBadgeVariant("pool")).toBe("outline");
  });
});

describe("etfSlotBadge.slotBadgeClassName", () => {
  it("returns no colour classes for the default kind", () => {
    const cn = slotBadgeClassName("default");
    expect(cn).not.toMatch(/emerald/);
    expect(cn).not.toMatch(/orange/);
  });

  it("returns green (emerald) classes for alternatives", () => {
    const cn = slotBadgeClassName("alternative");
    expect(cn).toMatch(/border-emerald-600/);
    expect(cn).toMatch(/text-emerald-700/);
    expect(cn).not.toMatch(/orange/);
  });

  it("returns orange classes for pool entries", () => {
    const cn = slotBadgeClassName("pool");
    expect(cn).toMatch(/border-orange-600/);
    expect(cn).toMatch(/text-orange-700/);
    expect(cn).not.toMatch(/emerald/);
  });
});
