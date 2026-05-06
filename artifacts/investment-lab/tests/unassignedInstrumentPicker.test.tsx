// @vitest-environment jsdom
//
// Task #156 — covers the new UnassignedInstrumentPicker component:
//   1. exclusion of ISINs already used in OTHER rows;
//   2. row-aware allowance of the current row's ISIN even when in
//      `excludeIsins`;
//   3. atomic onPick callback delivering the full InstrumentRecord;
//   4. inferAssetClassRegionFromInstrument helper covering the
//      asset-class derivation requirement of the task spec.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";
import { UnassignedInstrumentPicker } from "../src/components/explain/UnassignedInstrumentPicker";
import {
  listUnassignedInstruments,
  inferAssetClassRegionFromInstrument,
  type InstrumentRecord,
} from "../src/lib/etfs";
import { LanguageProvider } from "../src/lib/i18n";

beforeEach(() => {
  // Radix Popover/Command rely on these jsdom-missing primitives.
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = () => false;
  }
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {};
  }
  if (typeof globalThis.ResizeObserver === "undefined") {
    // cmdk / Radix internally instantiate a ResizeObserver. jsdom has
    // no implementation; a no-op stub is enough for our render+click
    // assertions because we never assert on observed sizes.
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver =
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      };
  }
});

afterEach(() => cleanup());

function renderPicker(props: {
  excludeIsins?: ReadonlySet<string>;
  currentIsin?: string;
  onPick?: (r: Readonly<InstrumentRecord>) => void;
}) {
  const onPick = props.onPick ?? vi.fn();
  const utils = render(
    <LanguageProvider>
      <UnassignedInstrumentPicker
        excludeIsins={props.excludeIsins ?? new Set()}
        currentIsin={props.currentIsin}
        onPick={onPick}
        testId="picker"
      />
    </LanguageProvider>,
  );
  // Open the popover.
  act(() => {
    fireEvent.click(screen.getByTestId("picker"));
  });
  return { ...utils, onPick };
}

describe("UnassignedInstrumentPicker", () => {
  it("renders one option per unassigned instrument when nothing is excluded", () => {
    const all = listUnassignedInstruments();
    if (all.length === 0) {
      // Catalog currently has no unassigned rows — picker still mounts;
      // we just can't exercise the row list. Empty state is implied.
      const { container } = renderPicker({});
      expect(container).toBeTruthy();
      return;
    }
    renderPicker({});
    for (const r of all) {
      expect(screen.queryByTestId(`unassigned-option-${r.isin}`)).not.toBeNull();
    }
  });

  it("excludes ISINs that are listed in excludeIsins (used in other rows)", () => {
    const all = listUnassignedInstruments();
    if (all.length === 0) return; // nothing to exclude
    const excluded = all[0];
    renderPicker({ excludeIsins: new Set([excluded.isin]) });
    expect(screen.queryByTestId(`unassigned-option-${excluded.isin}`)).toBeNull();
    // Other rows still show.
    for (const r of all.slice(1, 5)) {
      expect(screen.queryByTestId(`unassigned-option-${r.isin}`)).not.toBeNull();
    }
  });

  it("keeps the current row's ISIN selectable even if it is in excludeIsins", () => {
    const all = listUnassignedInstruments();
    if (all.length === 0) return;
    const cur = all[0];
    renderPicker({
      excludeIsins: new Set([cur.isin]),
      currentIsin: cur.isin,
    });
    expect(screen.queryByTestId(`unassigned-option-${cur.isin}`)).not.toBeNull();
  });

  it("invokes onPick with the full InstrumentRecord on selection", () => {
    const all = listUnassignedInstruments();
    if (all.length === 0) return;
    const target = all[0];
    const onPick = vi.fn();
    renderPicker({ onPick });
    act(() => {
      fireEvent.click(screen.getByTestId(`unassigned-option-${target.isin}`));
    });
    expect(onPick).toHaveBeenCalledTimes(1);
    const arg = onPick.mock.calls[0][0] as InstrumentRecord;
    expect(arg.isin).toBe(target.isin);
    expect(arg.name).toBe(target.name);
    expect(arg.currency).toBe(target.currency);
    expect(typeof arg.terBps).toBe("number");
  });
});

describe("inferAssetClassRegionFromInstrument (Task #156 derivation)", () => {
  function infer(
    name: string,
    comment: string,
    currency = "USD",
  ): { assetClass: string; region: string } {
    return inferAssetClassRegionFromInstrument({ name, comment, currency });
  }

  it("classifies bond ETFs as Fixed Income", () => {
    expect(infer("iShares US Treasury Bond 7-10y", "Govt bonds US 7-10").assetClass).toBe(
      "Fixed Income",
    );
    expect(infer("Vanguard Global Aggregate Bond", "Global Aggregate Bond").assetClass).toBe(
      "Fixed Income",
    );
  });

  it("classifies REIT ETFs as Real Estate", () => {
    expect(
      infer("HSBC FTSE EPRA NAREIT Developed", "REITs Global").assetClass,
    ).toBe("Real Estate");
  });

  it("classifies bitcoin/crypto products as Digital Assets", () => {
    expect(infer("WisdomTree Physical Bitcoin", "Bitcoin").assetClass).toBe(
      "Digital Assets",
    );
  });

  it("classifies gold/commodities products as Commodities", () => {
    expect(infer("iShares Physical Gold ETC", "Gold (physical)").assetClass).toBe(
      "Commodities",
    );
  });

  it("defaults equity / ambiguous rows to Equity / Global", () => {
    const { assetClass, region } = infer("Vanguard FTSE All-World", "Broad world equity");
    expect(assetClass).toBe("Equity");
    expect(region).toBe("Global");
  });

  it("derives Switzerland from name or CHF currency", () => {
    expect(infer("UBS MSCI Switzerland", "Switzerland equity").region).toBe(
      "Switzerland",
    );
    expect(infer("Some fund", "Generic", "CHF").region).toBe("Switzerland");
  });

  it("derives USA from S&P 500 / NASDAQ keywords", () => {
    expect(infer("iShares Core S&P 500", "S&P 500").region).toBe("USA");
    expect(infer("Invesco NASDAQ 100", "NASDAQ 100").region).toBe("USA");
  });

  it("derives Europe from EURO STOXX / FTSE 100 keywords", () => {
    expect(infer("iShares Core EURO STOXX 50", "EURO STOXX 50 eurozone").region).toBe(
      "Europe",
    );
    expect(infer("Vanguard FTSE 100", "FTSE 100 UK").region).toBe("Europe");
  });

  it("derives Emerging Markets from EM keywords", () => {
    expect(infer("Xtrackers MSCI EM", "EM equity").region).toBe("Emerging Markets");
  });

  it("derives Japan from Nikkei/Topix", () => {
    expect(infer("Xtrackers Nikkei 225", "Japan equity").region).toBe("Japan");
  });

  it("forces Global region for region-less asset classes", () => {
    expect(infer("WisdomTree Physical Bitcoin", "Bitcoin").region).toBe("Global");
    expect(infer("iShares Physical Gold ETC", "Gold (physical)").region).toBe(
      "Global",
    );
  });
});
