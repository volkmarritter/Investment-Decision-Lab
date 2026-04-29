import { describe, it, expect } from "vitest";
import { nextMaximisedState } from "../src/lib/maximisable";

describe("nextMaximisedState", () => {
  it("toggles between open and closed", () => {
    expect(nextMaximisedState(false, "toggle")).toBe(true);
    expect(nextMaximisedState(true, "toggle")).toBe(false);
  });

  it("forces open regardless of previous state", () => {
    expect(nextMaximisedState(false, "open")).toBe(true);
    expect(nextMaximisedState(true, "open")).toBe(true);
  });

  it("forces closed regardless of previous state", () => {
    expect(nextMaximisedState(true, "close")).toBe(false);
    expect(nextMaximisedState(false, "close")).toBe(false);
  });

  it("supports a full open/close cycle", () => {
    let open = false;
    open = nextMaximisedState(open, "toggle");
    expect(open).toBe(true);
    open = nextMaximisedState(open, "close");
    expect(open).toBe(false);
    open = nextMaximisedState(open, "toggle");
    expect(open).toBe(true);
  });
});
