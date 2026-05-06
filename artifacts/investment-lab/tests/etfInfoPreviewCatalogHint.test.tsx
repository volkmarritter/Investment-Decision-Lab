// @vitest-environment jsdom
//
// Task #155 — locks in the "this ETF is already in the catalog" hint
// shown inside the Explain manual-entry preview card:
//   1. visible when the typed ISIN resolves to a catalog instrument
//      AND that instrument has a bucket assignment — and names the
//      bucket (assetClass — region) so the operator can find it in
//      the tree view above;
//   2. hidden for unknown / off-catalog ISINs (no catalogInstrument);
//   3. hidden when only pool look-through data exists but the ISIN
//      is NOT in the catalog (manual entry stays the right path).

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { LanguageProvider } from "../src/lib/i18n";
import { getInstrumentByIsin } from "../src/lib/etfs";

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

function renderPreview(isin: string) {
  return render(
    <LanguageProvider>
      <EtfInfoPreview isin={isin} rowIndex={0} onQuickFill={() => {}} />
    </LanguageProvider>,
  );
}

describe("EtfInfoPreview catalog hint", () => {
  it("shows the bucket-tree hint when the ISIN is in the catalog", () => {
    // S&P 500 — registered in INSTRUMENTS and assigned to bucket
    // "Equity-USA" (default of that bucket).
    const isin = "IE00B5BMR087";
    const catalogInstrument = getInstrumentByIsin(isin);
    expect(catalogInstrument).toBeTruthy();
    mockedUseEtfInfo.mockReturnValue({
      isValidIsin: true,
      catalogInstrument,
      pool: null,
      scrape: null,
      scrapeLoading: false,
      scrapeError: null,
    });
    renderPreview(isin);
    const hint = screen.getByTestId("etf-info-catalog-hint-0");
    expect(hint).toBeTruthy();
    // Names the bucket via assetClass — region.
    expect(hint.textContent).toMatch(/Equity\s*[—-]\s*USA/);
    // English copy (default LanguageProvider).
    expect(hint.textContent).toMatch(/already in the catalog/i);
    expect(hint.textContent).toMatch(/tree view/i);
  });

  it("hides the hint for an unknown / off-catalog ISIN", () => {
    mockedUseEtfInfo.mockReturnValue({
      isValidIsin: true,
      catalogInstrument: undefined,
      pool: null,
      scrape: null,
      scrapeLoading: false,
      scrapeError: null,
    });
    renderPreview("XX0000000001");
    expect(screen.queryByTestId("etf-info-catalog-hint-0")).toBeNull();
  });

  it("hides the hint when only pool look-through data exists (no catalog match)", () => {
    mockedUseEtfInfo.mockReturnValue({
      isValidIsin: true,
      catalogInstrument: undefined,
      pool: {
        geo: { US: 1 },
        sector: {},
        topHoldings: [],
      },
      scrape: null,
      scrapeLoading: false,
      scrapeError: null,
    });
    renderPreview("XX0000000002");
    expect(screen.queryByTestId("etf-info-catalog-hint-0")).toBeNull();
  });
});
