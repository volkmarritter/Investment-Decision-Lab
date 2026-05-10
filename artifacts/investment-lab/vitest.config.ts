import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

const sharedTest = {
  environment: "node" as const,
  setupFiles: ["./tests/setup.ts"],
  testTimeout: 15000,
  hookTimeout: 15000,
};

const engineInclude = [
  "tests/engine.test.ts",
  "tests/monteCarlo.test.ts",
  "tests/allocationGroups.test.ts",
  "tests/maximisable.test.ts",
  "tests/comparePerSlot.test.ts",
  "tests/etfSelection.test.ts",
  "tests/etfSlotBadge.test.ts",
  "tests/etfDescription.test.ts",
  "tests/feeEstimatorFormat.test.ts",
  "tests/buildDraftFromPreview.test.ts",
  "tests/buildToExplain.test.ts",
  "tests/buildUserDrivenSignal.test.ts",
  "tests/personalPortfolio.test.ts",
  "tests/personalPortfolioFile.test.ts",
  "tests/portfolioFile.test.ts",
];

const catalogInclude = [
  "tests/catalog-classify.test.ts",
  "tests/catalog-parser.test.ts",
  "tests/catalog-validate.test.ts",
  "tests/catalog-validate-lookthrough-orphans.test.ts",
  "tests/inject-alternative.test.ts",
  "tests/inject-pool.test.ts",
  "tests/render-alternative.test.ts",
  "tests/render-entry-block.test.ts",
  "tests/lookthrough-overrides.test.ts",
  "tests/refreshLookthroughOrphans.test.ts",
  "tests/diff-overrides.test.ts",
  "tests/scrapers.test.ts",
  "tests/app-defaults.test.ts",
  "tests/app-defaults-presets.test.ts",
  "tests/api-app-defaults.test.ts",
  "tests/backfillCommentsModes.test.ts",
  "tests/backfillManualProtection.test.ts",
  "tests/backfillSourcePriority.test.ts",
  "tests/changesShimExpand.test.ts",
  "tests/etfImplementationCommentResolver.test.ts",
  "tests/exportEtfImplementationXlsx.test.ts",
];

const componentsInclude = [
  "tests/**/*.test.tsx",
  "tests/smoke-report.test.ts",
];

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    ...sharedTest,
    projects: [
      {
        extends: true,
        test: {
          ...sharedTest,
          name: "engine",
          include: engineInclude,
        },
      },
      {
        extends: true,
        test: {
          ...sharedTest,
          name: "catalog",
          include: catalogInclude,
        },
      },
      {
        extends: true,
        test: {
          ...sharedTest,
          name: "components",
          include: componentsInclude,
        },
      },
    ],
  },
});
