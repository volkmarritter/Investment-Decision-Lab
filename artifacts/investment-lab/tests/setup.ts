import { vi } from "vitest";

vi.mock("react-simple-maps", () => ({
  ComposableMap: ({ children }: { children?: unknown }) => children,
  Geographies: () => null,
  Geography: () => null,
}));
