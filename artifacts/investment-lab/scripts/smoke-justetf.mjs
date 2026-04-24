#!/usr/bin/env node
// ----------------------------------------------------------------------------
// smoke-justetf.mjs
// ----------------------------------------------------------------------------
// Lightweight live-fetch smoke test for the justETF scrapers.
//
// Why this exists
// ---------------
// The unit tests under tests/scrapers.test.ts run the exported extractors
// against checked-in HTML fixtures. Those fixtures only change when a human
// remembers to refresh them, so they cannot detect a real layout change on
// justETF.com — the regexes happily keep matching the synthetic snippets even
// after the live site rewrites a data-testid or table structure.
//
// The three scheduled refresh jobs (weekly core / nightly listings / monthly
// look-through) also do not fail loudly on a layout break: every extractor is
// "no-clobber", so when a regex stops matching the previous override value is
// preserved on disk and the job exits 0 as long as failures don't outnumber
// successes. That is the right behaviour for the production refresh path
// (partial data is better than wiping good values), but it means a slow
// rolling break across many ISINs can go unnoticed for days.
//
// This smoke job closes that gap. It hits one well-known live profile page
// per ETF type, runs the exported extractors against the freshly-fetched
// HTML, and exits non-zero the moment any expected field comes back empty.
// CI surfaces that as a red workflow run the same day justETF changes their
// markup.
//
// Usage (from artifacts/investment-lab):
//   node scripts/smoke-justetf.mjs
//
// Politeness: same 1.5 s inter-request delay and same User-Agent as the
// scheduled refresh scripts. Three requests per run is well within polite
// scraping limits.
// ----------------------------------------------------------------------------

import { fileURLToPath } from "node:url";
import { writeFileSync, appendFileSync } from "node:fs";
import {
  CORE_EXTRACTORS,
  LISTINGS_EXTRACTORS,
} from "./refresh-justetf.mjs";
import { extractTopHoldings } from "./refresh-lookthrough.mjs";

const REQUEST_DELAY_MS = 1500;
const USER_AGENT =
  "InvestmentDecisionLab-DataRefresh/1.0 (+https://github.com/your-org/investment-lab; contact: ops@example.com)";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// One canary ISIN per ETF type the catalog covers. Picked because each is a
// large, long-lived fund unlikely to be delisted, so a parser break here is
// a real signal — not a flaky one-off.
//
//   - equity: iShares Core MSCI World UCITS ETF (IE00B4L5Y983) — the broadest
//     equity benchmark in the catalog; always has a populated Top-10 table.
//   - gold:   Invesco Physical Gold ETC (IE00B579F325) — single-asset commodity
//     ETC, no top-holdings (would-be holdings list is the bullion itself), so
//     we only assert the core fund metadata + listings table.
//   - crypto: 21Shares Bitcoin Core ETP (DE000A27Z304) — German-listed crypto
//     ETP, exercises the German-locale label fallback in the extractors.
//
// `expectTopHoldings` opts the equity canary into the additional Top-10
// holdings assertion. The two non-equity canaries skip it because justETF
// doesn't render an equity-style holdings table for them.
const CANARIES = [
  {
    type: "equity",
    isin: "IE00B4L5Y983",
    name: "iShares Core MSCI World UCITS ETF",
    currency: "USD",
    expectTopHoldings: true,
  },
  {
    type: "gold",
    isin: "IE00B579F325",
    name: "Invesco Physical Gold ETC",
    currency: "USD",
    expectTopHoldings: false,
  },
  {
    type: "crypto",
    isin: "DE000A27Z304",
    name: "21Shares Bitcoin Core ETP",
    currency: "EUR",
    expectTopHoldings: false,
  },
];

async function fetchProfile(isin) {
  const url = `https://www.justetf.com/en/etf-profile.html?isin=${isin}`;
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, "Accept-Language": "en" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${isin}`);
  return await res.text();
}

// Run every extractor against the fetched HTML and collect the names of any
// that returned `undefined` (= would silently keep the previous override on
// the production refresh path). The smoke job treats every empty field as a
// failure so a partial layout break is just as loud as a total one.
function checkCanary(html, canary) {
  const missing = [];
  const rec = { isin: canary.isin, currency: canary.currency };

  for (const [field, extractor] of Object.entries(CORE_EXTRACTORS)) {
    const v = extractor(html, rec);
    if (v === undefined) missing.push(`core.${field}`);
  }
  for (const [field, extractor] of Object.entries(LISTINGS_EXTRACTORS)) {
    const v = extractor(html, rec);
    if (v === undefined || (typeof v === "object" && Object.keys(v).length === 0)) {
      missing.push(`listings.${field}`);
    }
  }
  if (canary.expectTopHoldings) {
    const v = extractTopHoldings(html);
    if (!v || v.length === 0) missing.push("lookthrough.topHoldings");
  }

  return missing;
}

// Build the structured failure report consumed by the GitHub Actions notify
// step (see .github/workflows/justetf-smoke.yml). It's plain Markdown so it
// can be dropped straight into an issue body or step summary without further
// massaging. Kept separate from main() so the unit tests / future notifiers
// can call it without re-running the live fetches.
function buildFailureReport(failures, totalCanaries) {
  const lines = [];
  lines.push("## justETF smoke check failed");
  lines.push("");
  lines.push(
    `**${failures.length}/${totalCanaries} canary ISIN(s) regressed.** ` +
      "This usually means justETF changed a `data-testid` or table structure " +
      "on the profile page, so the production refresh job will silently keep " +
      "the previous override values until the affected extractor is patched."
  );
  lines.push("");
  lines.push("### Failing canaries");
  lines.push("");
  for (const f of failures) {
    const c = f.canary;
    const url = `https://www.justetf.com/en/etf-profile.html?isin=${c.isin}`;
    lines.push(`- **[${c.type}] ${c.isin}** — ${c.name} ([profile](${url}))`);
    if (f.error) {
      lines.push(`  - fetch error: \`${f.error}\``);
    } else if (f.missing && f.missing.length > 0) {
      lines.push(`  - missing fields: \`${f.missing.join("`, `")}\``);
    }
  }
  lines.push("");
  lines.push("### Where to fix");
  lines.push("");
  lines.push(
    "Each missing field name is `<group>.<field>` where the group maps to " +
      "the source extractor:"
  );
  lines.push("");
  lines.push(
    "- `core.*` and `listings.*` → `artifacts/investment-lab/scripts/refresh-justetf.mjs`"
  );
  lines.push(
    "- `lookthrough.*` → `artifacts/investment-lab/scripts/refresh-lookthrough.mjs`"
  );
  lines.push("");
  lines.push(
    "After patching the regex / selector, refresh the matching fixture under " +
      "`artifacts/investment-lab/tests/fixtures/justetf/` so the unit tests " +
      "lock in the new markup, then re-run this workflow from the Actions tab " +
      "to confirm the canaries are green again."
  );
  return lines.join("\n") + "\n";
}

async function main() {
  console.log(
    `justETF smoke check — ${CANARIES.length} canary ISIN(s), ${REQUEST_DELAY_MS}ms inter-request delay`
  );
  const failures = [];

  for (let i = 0; i < CANARIES.length; i++) {
    const canary = CANARIES[i];
    const label = `[${canary.type}] ${canary.isin} (${canary.name})`;
    try {
      const html = await fetchProfile(canary.isin);
      const missing = checkCanary(html, canary);
      if (missing.length === 0) {
        console.log(`  \u2713 ${label}: all expected fields extracted`);
      } else {
        console.error(
          `  \u2717 ${label}: missing fields -> ${missing.join(", ")}`
        );
        failures.push({ canary, missing });
      }
    } catch (e) {
      console.error(`  \u2717 ${label}: fetch error -> ${e.message}`);
      failures.push({ canary, error: e.message });
    }
    if (i < CANARIES.length - 1) await sleep(REQUEST_DELAY_MS);
  }

  if (failures.length > 0) {
    console.error(
      `\nSmoke check FAILED (${failures.length}/${CANARIES.length} canary ISIN(s) regressed). ` +
        "This usually means justETF changed a data-testid or table structure. " +
        "Refresh the fixtures under artifacts/investment-lab/tests/fixtures/ and update the affected extractor in scripts/refresh-justetf.mjs or scripts/refresh-lookthrough.mjs."
    );

    // Surface the structured report to the notify step (issue body) and to
    // the workflow run summary. Both env vars are populated by GitHub Actions;
    // outside CI they're undefined and we just skip the writes.
    const report = buildFailureReport(failures, CANARIES.length);
    const reportPath = process.env.SMOKE_FAILURE_REPORT;
    if (reportPath) {
      try {
        writeFileSync(reportPath, report);
      } catch (e) {
        console.error(`Failed to write failure report to ${reportPath}: ${e.message}`);
      }
    }
    const summaryPath = process.env.GITHUB_STEP_SUMMARY;
    if (summaryPath) {
      try {
        appendFileSync(summaryPath, report);
      } catch (e) {
        console.error(`Failed to append step summary to ${summaryPath}: ${e.message}`);
      }
    }

    process.exit(1);
  }

  console.log(
    `\nSmoke check OK — extractors still match live justETF markup for all ${CANARIES.length} canary ISIN(s).`
  );
}

const isCli = process.argv[1] === fileURLToPath(import.meta.url);
if (isCli) {
  main().catch((e) => {
    console.error("Fatal:", e);
    process.exit(2);
  });
}

export { CANARIES, checkCanary, buildFailureReport };
