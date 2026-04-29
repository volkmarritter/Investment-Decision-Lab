// @vitest-environment jsdom
// ----------------------------------------------------------------------------
// biconBrand.test.tsx
// ----------------------------------------------------------------------------
// Locks in the surviving BICon brand chrome (Task #80, trimmed by Task #87)
// across the three surfaces it lives on:
//
//   1. App header — "A BICon showcase" attribution next to the Lab tagline,
//      plus a persistent "Talk to us" CTA pill that links to the BICon
//      mailto contact.
//   2. App footer (DisclaimerFooter) — language-aware attribution row with
//      copyright line, mailto button and bicon.li button.
//   3. PDF report — the same attribution lines appear in the printed/forwarded
//      PortfolioReport header and footer so any artefact that travels carries
//      the brand and a contact path.
//
// Task #87 removed the BiconMark logo from every surface and the
// "We build investment tools like this — talk to us about your project."
// tagline from the footer; this file now also pins those removals so they
// can't silently regress.
//
// We render the real components (not snapshots) and assert on stable
// data-testid hooks so future copy / styling tweaks don't fight the tests.
// The CTA URL is asserted to make sure the mailto contract (subject line +
// language switch) does not silently regress on copy edits.
// ----------------------------------------------------------------------------

import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { cleanup, render, screen, act } from "@testing-library/react";
import { LanguageProvider, useT } from "../src/lib/i18n";
import { TooltipProvider } from "../src/components/ui/tooltip";
import { DisclaimerFooter } from "../src/components/investment/Disclaimer";
import { BRAND } from "../src/lib/brand";
import { PortfolioReport } from "../src/components/investment/PortfolioReport";
import type {
  PortfolioInput,
  PortfolioOutput,
  ETFImplementation,
} from "../src/lib/types";

// Exact tagline copy that Task #87 removed. Asserted to be absent from every
// brand surface so a future copy revert won't silently bring it back.
const REMOVED_TAGLINE_EN =
  "We build investment tools like this — talk to us about your project.";
const REMOVED_TAGLINE_DE =
  "Wir bauen Anlagetools wie dieses — sprechen Sie uns auf Ihr Projekt an.";

// -----------------------------------------------------------------------------
// Test harness
// -----------------------------------------------------------------------------

afterEach(() => cleanup());

beforeEach(() => {
  // The footer button uses Radix Tooltip primitives indirectly via the
  // Button component, and the InvestmentLab page mounts all four tab
  // panels (forceMount) so the polyfills below have to cover everything
  // Radix and chart libs reach for in jsdom.
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = () => false;
  }
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {};
  }
  if (!window.matchMedia) {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: (query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      }),
    });
  }
  // Radix Tooltip / Popover internally use ResizeObserver; jsdom does not
  // ship one by default. A no-op stub is enough for these render tests
  // since we never assert on layout.
  if (typeof (globalThis as any).ResizeObserver === "undefined") {
    (globalThis as any).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
  if (typeof (globalThis as any).IntersectionObserver === "undefined") {
    (globalThis as any).IntersectionObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
      takeRecords() {
        return [];
      }
    };
  }
});

// LanguageProvider seeds its initial state from `localStorage` (or browser
// language). Tests prime that key before rendering to deterministically
// control which translation block we exercise.
function setLangBeforeRender(lang: "en" | "de") {
  try {
    window.localStorage.setItem("investment-lab.lang.v1", lang);
  } catch {
    /* ignore */
  }
}

function withProviders(node: React.ReactNode, lang: "en" | "de" = "en") {
  setLangBeforeRender(lang);
  return (
    <LanguageProvider>
      <TooltipProvider>{node}</TooltipProvider>
    </LanguageProvider>
  );
}

// -----------------------------------------------------------------------------
// 1. Footer — DisclaimerFooter attribution row
// -----------------------------------------------------------------------------

describe("DisclaimerFooter — BICon attribution row", () => {
  it("renders the copyright line and both outbound buttons in EN, without the logo or tagline", () => {
    const { container } = render(withProviders(<DisclaimerFooter />, "en"));

    const block = screen.getByTestId("bicon-footer-attribution");
    expect(block).toBeTruthy();
    // Logo (Task #87) is no longer rendered anywhere in the footer.
    expect(container.querySelector('[data-testid="bicon-mark"]')).toBeNull();
    // Copyright + discipline tagline are still rendered.
    expect(block.textContent ?? "").toContain(String(BRAND.copyrightYear));
    expect(block.textContent ?? "").toContain(BRAND.fullName);
    expect(block.textContent ?? "").toContain(BRAND.disciplineTagline);
    // The removed tagline copy is not in the footer.
    expect(block.textContent ?? "").not.toContain(REMOVED_TAGLINE_EN);
    // Mailto + bicon.li buttons with the right hrefs.
    const mailto = screen.getByTestId(
      "bicon-footer-mailto",
    ) as HTMLAnchorElement;
    expect(mailto.getAttribute("href")).toContain(`mailto:${BRAND.contactEmail}`);
    expect(mailto.getAttribute("href")).toContain("Book%20a%20call");
    const link = screen.getByTestId("bicon-link") as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe(BRAND.urlEn);
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("uses the German subject line and DE site URL when lang=de, with no logo or tagline", () => {
    const { container } = render(withProviders(<DisclaimerFooter />, "de"));

    const block = screen.getByTestId("bicon-footer-attribution");
    // No logo, no removed tagline.
    expect(container.querySelector('[data-testid="bicon-mark"]')).toBeNull();
    expect(block.textContent ?? "").not.toContain(REMOVED_TAGLINE_DE);
    // Mailto subject is the DE variant.
    const mailto = screen.getByTestId(
      "bicon-footer-mailto",
    ) as HTMLAnchorElement;
    expect(mailto.getAttribute("href")).toContain("Gespr%C3%A4ch%20buchen");
    // German site URL (root, no /en/ subpath).
    const link = screen.getByTestId("bicon-link") as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe(BRAND.urlDe);
  });
});

// -----------------------------------------------------------------------------
// 2. App header — Lab page imports
// -----------------------------------------------------------------------------

// We render the Lab page itself rather than re-implement the header so we
// pick up the actual production layout. The page imports a lot of
// children (BuildPortfolio, ComparePortfolios etc.) that depend on
// localStorage / matchMedia / settings — keep this test focused on the
// header-only assertions and tolerate everything else that mounts.
import InvestmentLab from "../src/pages/InvestmentLab";

describe("InvestmentLab header — BICon brand layer", () => {
  it("renders the BICon attribution and the 'Talk to us' CTA in the header without a logo", () => {
    // jsdom doesn't implement scrollIntoView; some children call it on mount.
    if (!Element.prototype.scrollIntoView) {
      Element.prototype.scrollIntoView = () => {};
    }
    let container: HTMLElement;
    act(() => {
      const result = render(withProviders(<InvestmentLab />, "en"));
      container = result.container;
    });

    // Header attribution: span with "A BICon showcase" — no logo any more.
    const headerAttr = screen.getByTestId("bicon-header-attribution");
    expect(headerAttr).toBeTruthy();
    expect(headerAttr.textContent ?? "").toContain("A BICon showcase");
    // Logo (Task #87) is no longer rendered anywhere on the page.
    expect(container!.querySelector('[data-testid="bicon-mark"]')).toBeNull();
    // The removed tagline copy must not surface anywhere on the page.
    expect(container!.textContent ?? "").not.toContain(REMOVED_TAGLINE_EN);

    // CTA pill with mailto href and accessible label.
    const cta = screen.getByTestId("bicon-cta-header") as HTMLElement;
    expect(cta).toBeTruthy();
    const link =
      cta.tagName.toLowerCase() === "a"
        ? (cta as HTMLAnchorElement)
        : (cta.querySelector("a") as HTMLAnchorElement);
    expect(link.getAttribute("href")).toContain(`mailto:${BRAND.contactEmail}`);
    expect(link.getAttribute("aria-label")).toContain("BICon");

    // CTA carries both the long and short labels (responsive tailwind
    // classes hide one or the other depending on viewport — both are in
    // the DOM at all times).
    expect(link.textContent ?? "").toContain("Book a 30-min call");
    expect(link.textContent ?? "").toContain("Talk to us");
  });
});

// -----------------------------------------------------------------------------
// 3. PDF report — header + footer brand chrome
// -----------------------------------------------------------------------------

const baseInput: PortfolioInput = {
  riskAppetite: "balanced",
  horizon: 10,
  baseCurrency: "USD",
  targetEquityPct: 60,
  numETFs: 6,
  numETFsMin: 4,
  includeCurrencyHedging: false,
  includeSyntheticETFs: false,
  lookThroughView: false,
  thematicPreference: "None",
  topHoldings: [],
} as unknown as PortfolioInput;

const sampleEtf: ETFImplementation = {
  bucket: "Equity-Global",
  assetClass: "Equity",
  weight: 60,
  intent: "Core equity exposure",
  exampleETF: "Test ETF",
  rationale: "Diversified core",
  isin: "US0000000000",
  ticker: "TST",
  exchange: "XETRA",
  comment: "Sample row",
} as unknown as ETFImplementation;

const baseOutput: PortfolioOutput = {
  allocation: [
    { assetClass: "Equity", region: "Global", weight: 60 },
    { assetClass: "Bond", region: "Aggregate", weight: 40 },
  ],
  etfImplementation: [sampleEtf],
  rationale: ["sample"],
  risks: ["sample"],
  learning: [],
  validation: { errors: [], warnings: [] },
} as unknown as PortfolioOutput;

describe("PortfolioReport — BICon brand chrome (PDF)", () => {
  it("renders the BICon attribution under the title and the brand row in the footer, without the logo or tagline", () => {
    const { container } = render(
      withProviders(
        <PortfolioReport
          input={baseInput}
          output={baseOutput}
          generatedAt={new Date("2026-04-29T10:00:00Z")}
        />,
        "en",
      ),
    );

    // Header attribution block with "A BICon showcase" — no logo any more.
    const headerAttr = screen.getByTestId("report-bicon-attribution");
    expect(headerAttr).toBeTruthy();
    expect(headerAttr.textContent ?? "").toContain("A BICon showcase");

    // Footer brand row carries the attribution sentence + email + host.
    const footerRow = screen.getByTestId("report-bicon-footer");
    expect(footerRow).toBeTruthy();
    expect(footerRow.textContent ?? "").toContain(BRAND.contactEmail);
    expect(footerRow.textContent ?? "").toContain(BRAND.hostLabel);

    // Logo (Task #87) is no longer rendered anywhere in the report, and the
    // removed tagline copy must not appear either.
    expect(container.querySelector('[data-testid="bicon-mark"]')).toBeNull();
    expect(container.textContent ?? "").not.toContain(REMOVED_TAGLINE_EN);
  });

  it("uses German brand copy when the language is set to DE, without the logo or tagline", () => {
    const { container } = render(
      withProviders(
        <PortfolioReport
          input={baseInput}
          output={baseOutput}
          generatedAt={new Date("2026-04-29T10:00:00Z")}
        />,
        "de",
      ),
    );
    expect(
      screen.getByTestId("report-bicon-attribution").textContent ?? "",
    ).toContain("BICon-Showcase");
    expect(container.querySelector('[data-testid="bicon-mark"]')).toBeNull();
    expect(container.textContent ?? "").not.toContain(REMOVED_TAGLINE_DE);
  });
});

// Silences "useT must be used within a LanguageProvider" warnings if any
// downstream component pulls translations outside the provider during the
// InvestmentLab render. Kept as a no-op assertion to keep the import live
// in case a future refactor inlines translations directly.
describe("translation context", () => {
  it("useT can be imported and used", () => {
    function Probe() {
      const { t } = useT();
      return <span data-testid="probe">{t("header.bicon.attribution")}</span>;
    }
    render(withProviders(<Probe />, "en"));
    expect(screen.getByTestId("probe").textContent).toBe("A BICon showcase");
  });
});
