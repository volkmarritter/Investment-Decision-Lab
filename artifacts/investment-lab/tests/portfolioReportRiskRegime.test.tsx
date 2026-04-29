// @vitest-environment jsdom
// ----------------------------------------------------------------------------
// portfolioReportRiskRegime.test.tsx
// ----------------------------------------------------------------------------
// Locks in that the Crisis-Σ regime fed into <PortfolioReport /> actually
// shifts the printed analytical numbers AND the embedded Monte Carlo
// aggregates — not just the "Correlation regime" stamp in the header.
//
// Why this exists
// ---------------
// Task #105 wired the lifted `riskRegime` prop into both the
// `computeMetrics` call (powering σ / Sharpe / heuristic-MDD / α tiles)
// and the `runMonteCarlo` call (powering the MC summary tiles in the
// detailed variant). The existing e2e check only verifies the header
// "Correlation regime: Crisis (stressed)" label flips correctly.
//
// A future refactor could silently disconnect the prop from one of those
// call-sites — the header would still read "Crisis (stressed)" while the
// numbers underneath stayed at the long-run baseline. This test guards
// against that regression by asserting:
//
//   1. For an equity-heavy portfolio, the printed σ rises under
//      `riskRegime="crisis"` vs. `"normal"` (covers the basic + detailed
//      variants — both render the main metrics block).
//   2. Sharpe falls and heuristic max-drawdown gets *worse* (more
//      negative) under crisis, since both derive from the same regime-
//      aware vol — independent corroboration that `computeMetrics` saw
//      the regime change.
//   3. The detailed variant's embedded Monte Carlo expected vol rises
//      under crisis, and the printed P(loss) is non-decreasing — so the
//      `runMonteCarlo` call-site is also wired through.
//   4. A render with NO `riskRegime` prop reads byte-identically to an
//      explicit `"normal"` (default-prop backwards-compat lock; prevents
//      silently regressing the long-run baseline reading callers depend
//      on for old saved-PDF reproducibility).
// ----------------------------------------------------------------------------

import { describe, it, expect, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { LanguageProvider } from "../src/lib/i18n";
import { PortfolioReport } from "../src/components/investment/PortfolioReport";
import type {
  PortfolioInput,
  PortfolioOutput,
  AssetAllocation,
  ETFImplementation,
} from "../src/lib/types";

afterEach(() => cleanup());

// --- Fixtures ---------------------------------------------------------------

// USD-base, equity-heavy (90 % equity / 10 % bonds), no look-through (so
// the test is purely a function of CMA + correlation matrix + bond drag).
// US + Europe equity tilt (i.e. NOT the ACWI benchmark mix) so that
// crisis correlation lifts the cross-pair contributions to portfolio
// variance noticeably above the normal matrix.
const baseInput: PortfolioInput = {
  riskAppetite: "High",
  horizon: 10,
  baseCurrency: "USD",
  targetEquityPct: 90,
  numETFs: 3,
  numETFsMin: 3,
  preferredExchange: "None",
  thematicPreference: "None",
  includeCurrencyHedging: false,
  includeSyntheticETFs: false,
  lookThroughView: false,
  includeCrypto: false,
  includeListedRealEstate: false,
  includeCommodities: false,
};

const equityHeavyAllocation: AssetAllocation[] = [
  { assetClass: "Equity", region: "USA", weight: 60 },
  { assetClass: "Equity", region: "Europe", weight: 30 },
  { assetClass: "Fixed Income", region: "Global", weight: 10 },
];

// Minimal ETF implementation rows so the implementation table renders.
// Look-through is OFF on the input above, so these rows do NOT influence
// computeMetrics / runMonteCarlo — they exist only so the report doesn't
// short-circuit anywhere on an empty list.
const etfRows: ETFImplementation[] = [
  {
    bucket: "Equity-USA",
    assetClass: "Equity",
    weight: 60,
    intent: "US core",
    exampleETF: "Test US ETF",
    rationale: "n/a",
    isin: "IE0000000001",
    ticker: "USA",
    exchange: "XETRA",
    terBps: 7,
    domicile: "Ireland",
    replication: "Physical",
    distribution: "Accumulating",
    currency: "USD",
    comment: "",
    catalogKey: null,
    selectedSlot: 0,
    selectableOptions: [],
  },
  {
    bucket: "Equity-Europe",
    assetClass: "Equity",
    weight: 30,
    intent: "Europe core",
    exampleETF: "Test EU ETF",
    rationale: "n/a",
    isin: "IE0000000002",
    ticker: "EU",
    exchange: "XETRA",
    terBps: 12,
    domicile: "Ireland",
    replication: "Physical",
    distribution: "Accumulating",
    currency: "USD",
    comment: "",
    catalogKey: null,
    selectedSlot: 0,
    selectableOptions: [],
  },
  {
    bucket: "FixedIncome-Global",
    assetClass: "Fixed Income",
    weight: 10,
    intent: "Bond ballast",
    exampleETF: "Test Bond ETF",
    rationale: "n/a",
    isin: "IE0000000003",
    ticker: "BND",
    exchange: "XETRA",
    terBps: 10,
    domicile: "Ireland",
    replication: "Physical",
    distribution: "Accumulating",
    currency: "USD",
    comment: "",
    catalogKey: null,
    selectedSlot: 0,
    selectableOptions: [],
  },
];

const baseOutput: PortfolioOutput = {
  allocation: equityHeavyAllocation,
  etfImplementation: etfRows,
  rationale: [],
  risks: [],
  learning: [],
};

function renderReport(props: {
  variant: "basic" | "detailed";
  riskRegime?: "normal" | "crisis";
}) {
  return render(
    <LanguageProvider>
      <PortfolioReport
        output={baseOutput}
        input={baseInput}
        generatedAt={new Date("2026-04-29T12:00:00Z")}
        variant={props.variant}
        // Intentionally only set when explicitly provided so the
        // backwards-compat case (prop omitted) actually exercises the
        // component default.
        {...(props.riskRegime !== undefined ? { riskRegime: props.riskRegime } : {})}
      />
    </LanguageProvider>,
  );
}

/** Parse "13.5%" → 13.5 (or e.g. "12.34 / 5.67%" → first number). The
 *  Sharpe tile is a plain number ("0.42"); the σ / MDD / MC vol tiles are
 *  percent strings. We only need numeric ordering, not unit interpretation. */
function readNum(testId: string): number {
  const el = screen.getByTestId(testId);
  const m = (el.textContent ?? "").match(/-?\d+(?:\.\d+)?/);
  if (!m) throw new Error(`No numeric content in ${testId}: ${el.textContent}`);
  return parseFloat(m[0]);
}

/** Read both halves of the "P(loss) / P(doubled)" tile. */
function readPctPair(testId: string): { left: number; right: number } {
  const el = screen.getByTestId(testId);
  const matches = (el.textContent ?? "").match(/-?\d+(?:\.\d+)?/g);
  if (!matches || matches.length < 2) {
    throw new Error(
      `Expected two numbers in ${testId}: ${el.textContent}`,
    );
  }
  return { left: parseFloat(matches[0]), right: parseFloat(matches[1]) };
}

// --- Tests ------------------------------------------------------------------

describe("PortfolioReport — riskRegime wires through to computeMetrics (basic + detailed)", () => {
  it.each(["basic", "detailed"] as const)(
    "[%s variant] σ rises, Sharpe falls, heuristic MDD worsens under crisis vs normal",
    (variant) => {
      // --- Normal regime ---
      const normal = renderReport({ variant, riskRegime: "normal" });
      const volNormal = readNum("report-metric-vol");
      const sharpeNormal = readNum("report-metric-sharpe");
      // maxDD is rendered as a *negative* percent (e.g. "-32.4%"); a worse
      // drawdown is more negative, i.e. a smaller number.
      const mddNormal = readNum("report-metric-maxDD");
      normal.unmount();

      // --- Crisis regime ---
      renderReport({ variant, riskRegime: "crisis" });
      const volCrisis = readNum("report-metric-vol");
      const sharpeCrisis = readNum("report-metric-sharpe");
      const mddCrisis = readNum("report-metric-maxDD");

      // 1. σ — the headline crisis effect: equity-equity correlations
      //    rise (~0.82 → 0.95 between US and Europe), so portfolio vol
      //    must rise for the chosen 60/30/10 mix. This ALSO covers the
      //    "at least one of σ / β / TE goes up" lock from the task spec —
      //    the report only prints σ from that triplet, but the regime
      //    propagation that drives σ is the same propagation that drives
      //    β and TE inside computeMetrics. STRICT inequality is the
      //    primary regression signal here.
      expect(volCrisis).toBeGreaterThan(volNormal);

      // 2. Sharpe — derived as (r - rf) / σ with regime-INVARIANT r and rf,
      //    so the rise in σ can only drag Sharpe down (or leave it
      //    unchanged at display precision). Asserted non-strictly so a
      //    sub-display-precision delta doesn't make the test brittle —
      //    the strict directional signal is on σ above; this guards the
      //    weaker "Sharpe never *improves* under crisis" invariant.
      expect(sharpeCrisis).toBeLessThanOrEqual(sharpeNormal);

      // 3. Heuristic max-drawdown — proportional to σ (with an equity-
      //    share scaler that doesn't depend on regime), so a higher σ
      //    gives an MDD that is no less negative than normal. Same non-
      //    strict guard as Sharpe; the strict signal lives on σ.
      expect(mddCrisis).toBeLessThanOrEqual(mddNormal);
    },
  );
});

describe("PortfolioReport — riskRegime wires through to runMonteCarlo (detailed variant)", () => {
  it("MC expected vol rises and P(loss) is non-decreasing under crisis vs normal", () => {
    // Both renders use the default seed (42) inside runMonteCarlo, so the
    // only thing changing between the two passes is the correlation
    // matrix the MC engine folds into σ_p. That makes the comparison
    // deterministic — no need to set seeds explicitly here.

    // --- Normal ---
    const normal = renderReport({ variant: "detailed", riskRegime: "normal" });
    const mcVolNormal = readNum("report-mc-expectedVol");
    const probLossNormal = readPctPair("report-mc-probLossDoubled").left;
    normal.unmount();

    // --- Crisis ---
    renderReport({ variant: "detailed", riskRegime: "crisis" });
    const mcVolCrisis = readNum("report-mc-expectedVol");
    const probLossCrisis = readPctPair("report-mc-probLossDoubled").left;

    // MC expected vol = analytical σ_p of the bucket portfolio under the
    // chosen correlation matrix; same crisis effect as computeMetrics.
    expect(mcVolCrisis).toBeGreaterThan(mcVolNormal);

    // P(loss) over the horizon: with regime-invariant μ and a wider σ,
    // the log-normal terminal-value distribution gets wider too, which
    // cannot reduce the mass below the initial value for a non-negative
    // expected return. Use >= so the test stays robust to rounding when
    // the displayed value happens to land on the same 0.1 % bucket
    // (e.g. when both reads round to 0.0 % at long horizons with strong
    // positive drift) — the strict directional lock is on σ above.
    expect(probLossCrisis).toBeGreaterThanOrEqual(probLossNormal);
  });
});

describe("PortfolioReport — default riskRegime prop matches explicit 'normal' (backwards-compat)", () => {
  it.each(["basic", "detailed"] as const)(
    "[%s variant] omitting riskRegime renders identical σ / Sharpe / MDD as 'normal'",
    (variant) => {
      // Explicit "normal" baseline.
      const explicit = renderReport({ variant, riskRegime: "normal" });
      const volExplicit = screen.getByTestId("report-metric-vol").textContent;
      const sharpeExplicit = screen.getByTestId("report-metric-sharpe").textContent;
      const mddExplicit = screen.getByTestId("report-metric-maxDD").textContent;
      const expReturnExplicit = screen.getByTestId("report-metric-expReturn").textContent;
      const alphaExplicit = screen.getByTestId("report-metric-alpha").textContent;
      let mcVolExplicit: string | null = null;
      let mcRetExplicit: string | null = null;
      let mcFinalExplicit: string | null = null;
      let mcProbExplicit: string | null = null;
      if (variant === "detailed") {
        mcVolExplicit = screen.getByTestId("report-mc-expectedVol").textContent;
        mcRetExplicit = screen.getByTestId("report-mc-expectedReturn").textContent;
        mcFinalExplicit = screen.getByTestId("report-mc-finalP50").textContent;
        mcProbExplicit = screen.getByTestId("report-mc-probLossDoubled").textContent;
      }
      explicit.unmount();

      // Default (prop omitted) — must read byte-for-byte the same. This
      // is the "old saved PDFs still reproduce" lock.
      renderReport({ variant });
      expect(screen.getByTestId("report-metric-vol").textContent).toBe(volExplicit);
      expect(screen.getByTestId("report-metric-sharpe").textContent).toBe(sharpeExplicit);
      expect(screen.getByTestId("report-metric-maxDD").textContent).toBe(mddExplicit);
      expect(screen.getByTestId("report-metric-expReturn").textContent).toBe(expReturnExplicit);
      expect(screen.getByTestId("report-metric-alpha").textContent).toBe(alphaExplicit);
      if (variant === "detailed") {
        expect(screen.getByTestId("report-mc-expectedVol").textContent).toBe(mcVolExplicit);
        expect(screen.getByTestId("report-mc-expectedReturn").textContent).toBe(mcRetExplicit);
        expect(screen.getByTestId("report-mc-finalP50").textContent).toBe(mcFinalExplicit);
        expect(screen.getByTestId("report-mc-probLossDoubled").textContent).toBe(mcProbExplicit);
      }
    },
  );
});
