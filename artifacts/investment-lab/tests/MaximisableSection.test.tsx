// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";
import { TooltipProvider } from "../src/components/ui/tooltip";
import { MaximisableSection } from "../src/components/investment/MaximisableSection";

const props = {
  title: "ETF Implementation",
  description: "ISIN, ticker, TER, and details for each row.",
  maximiseLabel: "Maximise",
  maximiseHint: "Open the table in a full-screen view",
  closeLabel: "Close",
  dialogTitle: "ETF Implementation — maximised view",
  dialogDescription: "ISIN, ticker, TER, and details for each row.",
  testIdPrefix: "etf-implementation",
};

function renderSection() {
  return render(
    <TooltipProvider>
      <MaximisableSection
        {...props}
        renderContent={({ compact }) => (
          <div data-testid={`content-${compact ? "compact" : "normal"}`}>
            row
          </div>
        )}
        renderFooter={() => <div data-testid="footer">footer</div>}
      />
    </TooltipProvider>,
  );
}

beforeEach(() => {
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = () => false;
  }
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {};
  }
});

afterEach(() => {
  cleanup();
});

describe("MaximisableSection", () => {
  it("renders the card with maximise button and no dialog by default", () => {
    renderSection();
    const button = screen.getByTestId("etf-implementation-maximise-button");
    expect(button.getAttribute("aria-label")).toBe("Maximise");
    expect(button.getAttribute("title")).toBe("Maximise");
    expect(screen.getByTestId("content-normal")).toBeTruthy();
    expect(screen.getByTestId("footer")).toBeTruthy();
    expect(screen.queryByTestId("etf-implementation-dialog")).toBeNull();
  });

  it("opens the dialog when the maximise button is clicked", () => {
    renderSection();
    act(() => {
      fireEvent.click(screen.getByTestId("etf-implementation-maximise-button"));
    });
    expect(screen.getByTestId("etf-implementation-dialog")).toBeTruthy();
    expect(screen.getByText("ETF Implementation — maximised view")).toBeTruthy();
    expect(screen.getByTestId("content-compact")).toBeTruthy();
  });

  it("closes the dialog when the localised close (X) button is clicked", () => {
    renderSection();
    act(() => {
      fireEvent.click(screen.getByTestId("etf-implementation-maximise-button"));
    });
    expect(screen.queryByTestId("etf-implementation-dialog")).not.toBeNull();

    const closeButton = screen
      .getAllByLabelText("Close")
      .find((el) => el.tagName === "BUTTON");
    expect(closeButton).toBeDefined();
    act(() => {
      fireEvent.click(closeButton!);
    });
    expect(screen.queryByTestId("etf-implementation-dialog")).toBeNull();
  });

  it("closes the dialog when ESC is pressed", () => {
    renderSection();
    act(() => {
      fireEvent.click(screen.getByTestId("etf-implementation-maximise-button"));
    });
    expect(screen.queryByTestId("etf-implementation-dialog")).not.toBeNull();

    act(() => {
      fireEvent.keyDown(document.activeElement || document.body, {
        key: "Escape",
        code: "Escape",
      });
    });
    expect(screen.queryByTestId("etf-implementation-dialog")).toBeNull();
  });

  it("supports a full open / close / reopen cycle", () => {
    renderSection();
    const button = screen.getByTestId("etf-implementation-maximise-button");
    act(() => {
      fireEvent.click(button);
    });
    expect(screen.queryByTestId("etf-implementation-dialog")).not.toBeNull();
    act(() => {
      fireEvent.click(button);
    });
    expect(screen.queryByTestId("etf-implementation-dialog")).toBeNull();
    act(() => {
      fireEvent.click(button);
    });
    expect(screen.queryByTestId("etf-implementation-dialog")).not.toBeNull();
  });
});
