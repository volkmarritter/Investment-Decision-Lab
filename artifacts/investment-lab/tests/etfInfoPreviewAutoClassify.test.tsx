// @vitest-environment jsdom
//
// Task #251 — locks in the auto-classify effect of the Explain manual-entry
// preview card:
//   1. fires `onAutoClassify` with the inferred {assetClass, region} when
//      the ETF-preview Stammdaten arrive for an off-catalog ISIN AND the
//      row still carries the fresh {Equity, Global} defaults (e.g. a Gold
//      ETF → Commodities/Global; an S&P 500 ETF → Equity/USA);
//   2. does NOT fire when the row's defaults have already been overridden
//      by the operator (operator picks always win);
//   3. does NOT fire when the row is already flagged as auto-classified
//      (no thrash on re-render);
//   4. does NOT fire when the heuristic produces only the generic
//      Equity/Global default (would be misleading to flag the row);
//   5. renders the bilingual hint when `currentAutoClassified` is true.

import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { LanguageProvider } from "../src/lib/i18n";

vi.mock("../src/lib/useEtfInfo", () => ({
  useEtfInfo: vi.fn(),
}));

import { useEtfInfo } from "../src/lib/useEtfInfo";
import { EtfInfoPreview } from "../src/components/explain/EtfInfoPreview";

const mockedUseEtfInfo = useEtfInfo as unknown as ReturnType<typeof vi.fn>;

afterEach(() => {
  cleanup();
  mockedUseEtfInfo.mockReset();
});

function mockScrape(name: string, currency = "USD") {
  mockedUseEtfInfo.mockReturnValue({
    isValidIsin: true,
    catalogInstrument: undefined,
    pool: null,
    scrape: { fields: { name, currency } },
    scrapeLoading: false,
    scrapeError: null,
  });
}

function renderPreview(props: {
  isin?: string;
  currentAssetClass?: string;
  currentRegion?: string;
  currentAutoClassified?: boolean;
  onAutoClassify?: (v: { assetClass: string; region: string }) => void;
}) {
  return render(
    <LanguageProvider>
      <EtfInfoPreview
        isin={props.isin ?? "XX0000000001"}
        rowIndex={0}
        currentAssetClass={props.currentAssetClass}
        currentRegion={props.currentRegion}
        currentAutoClassified={props.currentAutoClassified}
        onAutoClassify={props.onAutoClassify}
        onQuickFill={() => {}}
      />
    </LanguageProvider>,
  );
}

describe("EtfInfoPreview auto-classify", () => {
  it("fires onAutoClassify with Commodities/Global for a Gold ETF", () => {
    mockScrape("Invesco Physical Gold ETC", "USD");
    const onAutoClassify = vi.fn();
    renderPreview({
      currentAssetClass: "Equity",
      currentRegion: "Global",
      onAutoClassify,
    });
    expect(onAutoClassify).toHaveBeenCalledTimes(1);
    expect(onAutoClassify).toHaveBeenCalledWith({
      assetClass: "Commodities",
      region: "Global",
    });
  });

  it("fires onAutoClassify with Equity/USA for an S&P 500 ETF", () => {
    mockScrape("iShares Core S&P 500 UCITS ETF", "USD");
    const onAutoClassify = vi.fn();
    renderPreview({
      currentAssetClass: "Equity",
      currentRegion: "Global",
      onAutoClassify,
    });
    expect(onAutoClassify).toHaveBeenCalledTimes(1);
    expect(onAutoClassify).toHaveBeenCalledWith({
      assetClass: "Equity",
      region: "USA",
    });
  });

  it("does NOT fire when operator already picked a non-default region", () => {
    mockScrape("iShares Core S&P 500 UCITS ETF", "USD");
    const onAutoClassify = vi.fn();
    renderPreview({
      currentAssetClass: "Equity",
      currentRegion: "Europe",
      onAutoClassify,
    });
    expect(onAutoClassify).not.toHaveBeenCalled();
  });

  it("does NOT fire when the row is already flagged auto-classified", () => {
    mockScrape("Invesco Physical Gold ETC", "USD");
    const onAutoClassify = vi.fn();
    renderPreview({
      currentAssetClass: "Equity",
      currentRegion: "Global",
      currentAutoClassified: true,
      onAutoClassify,
    });
    expect(onAutoClassify).not.toHaveBeenCalled();
  });

  it("does NOT fire when the heuristic only produces the generic Equity/Global", () => {
    // No keyword hits → guess equals defaults → no point flagging.
    mockScrape("Some Generic Fund", "USD");
    const onAutoClassify = vi.fn();
    renderPreview({
      currentAssetClass: "Equity",
      currentRegion: "Global",
      onAutoClassify,
    });
    expect(onAutoClassify).not.toHaveBeenCalled();
  });

  it("renders the bilingual hint when currentAutoClassified is true", () => {
    mockedUseEtfInfo.mockReturnValue({
      isValidIsin: true,
      catalogInstrument: undefined,
      pool: null,
      scrape: { fields: { name: "Invesco Physical Gold ETC", currency: "USD" } },
      scrapeLoading: false,
      scrapeError: null,
    });
    renderPreview({
      currentAssetClass: "Commodities",
      currentRegion: "Global",
      currentAutoClassified: true,
    });
    const hint = screen.getByTestId("etf-info-auto-classified-0");
    expect(hint).toBeTruthy();
    expect(hint.textContent).toMatch(/auto-detected/i);
  });
});
