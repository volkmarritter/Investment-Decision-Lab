import { defineConfig, devices } from "@playwright/test";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.E2E_PORT ?? 5174);
const BASE_URL = `http://127.0.0.1:${PORT}/`;

// Prefer the Nix-managed chromium that ships with the Replit container
// (REPLIT_PLAYWRIGHT_CHROMIUM_EXECUTABLE). It comes with the system libs
// chromium needs and matches the pinned `@playwright/test` driver version,
// so we don't have to run `playwright install` in CI. If the env var is not
// set (e.g. running outside Replit), Playwright will fall back to whichever
// browser was installed via `pnpm --filter @workspace/investment-lab run
// test:e2e:install`.
const replitChromium = process.env.REPLIT_PLAYWRIGHT_CHROMIUM_EXECUTABLE;

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: /.*\.spec\.ts$/,
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: BASE_URL,
    locale: "en-US",
    timezoneId: "Europe/Zurich",
    trace: "retain-on-failure",
    video: "off",
    screenshot: "only-on-failure",
    launchOptions: {
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
      ...(replitChromium ? { executablePath: replitChromium } : {}),
    },
  },
  projects: [
    {
      // Phone-sized viewport emulated under chromium. We deliberately do not
      // use the WebKit-backed iPhone presets so this suite runs against the
      // browser that's already installed in the workspace. Touch + mobile
      // user agent + 390×844 viewport reproduce the mobile-only layout that
      // Task #12 originally regressed in.
      name: "iphone-13-chromium",
      use: {
        ...devices["iPhone 13"],
        browserName: "chromium",
        defaultBrowserType: "chromium",
      },
    },
  ],
  webServer: {
    command: "pnpm run dev",
    url: BASE_URL,
    cwd: __dirname,
    timeout: 90_000,
    reuseExistingServer: !process.env.CI,
    env: {
      PORT: String(PORT),
      BASE_PATH: "/",
      NODE_ENV: "development",
    },
    stdout: "pipe",
    stderr: "pipe",
  },
});
