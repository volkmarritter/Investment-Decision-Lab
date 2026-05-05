#!/usr/bin/env node
// ----------------------------------------------------------------------------
// inject-popular-etfs.mjs
// ----------------------------------------------------------------------------
// Reads scripts/data/popular-etfs-staged.json and splices each entry as an
// `I({ ... })` row inside the INSTRUMENTS object literal in
// src/lib/etfs.ts, immediately before the closing `};` of that object.
//
// IDEMPOTENCY: On re-run, the script scans the existing INSTRUMENTS object
// for `"<ISIN>": I(` keys and skips any staged ISIN already present —
// re-running with the same staged.json is a no-op, and re-running after
// adding new staged entries only injects the new ones.
//
// Each row's TS literal is generated mechanically; we never invoke any TS
// compiler here. The fields are escaped to avoid breaking the literal:
//   - strings JSON-stringified (handles quotes, backslashes, unicode)
//   - replication / distribution emitted as bare string literals from a
//     known whitelist (so the InstrumentRecord union types check)
//   - listings emitted as inline object literals
//   - numbers emitted unquoted
//   - aumMillionsEUR / inceptionDate omitted when undefined
//
// Comments (the `comment` field) intentionally drop the seed-note metadata
// because some seed-note category labels were wrong (e.g. ISIN claimed to
// be "Hydrogen" but justETF said it's a JPM US Equity ETF). The factual
// data still comes from justETF; only the human-typed seed labels were
// unreliable.
//
// Usage (from artifacts/investment-lab):
//   node scripts/inject-popular-etfs.mjs
//   DRY_RUN=1 node scripts/inject-popular-etfs.mjs   # print diff stats only
// ----------------------------------------------------------------------------

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const ETFS_TS = resolve(ROOT, "src/lib/etfs.ts");
const STAGED_JSON = resolve(__dirname, "data/popular-etfs-staged.json");

const VALID_REPLICATION = new Set(["Physical", "Physical (sampled)", "Synthetic"]);
const VALID_DISTRIBUTION = new Set(["Accumulating", "Distributing"]);
const VALID_EXCHANGE = new Set(["LSE", "XETRA", "SIX", "Euronext"]);

function tsString(s) {
  // JSON-stringify is the safest way to produce a valid TS string literal
  // for arbitrary content (quotes, backslashes, unicode).
  return JSON.stringify(String(s ?? ""));
}

function buildListingsLiteral(listings) {
  const parts = [];
  for (const ex of ["LSE", "XETRA", "SIX", "Euronext"]) {
    const row = listings?.[ex];
    if (row && row.ticker) {
      parts.push(`${ex}: { ticker: ${tsString(row.ticker)} }`);
    }
  }
  return `{ ${parts.join(", ")} }`;
}

function buildEntryLiteral(rec) {
  if (!VALID_REPLICATION.has(rec.replication)) {
    throw new Error(`bad replication for ${rec.isin}: ${rec.replication}`);
  }
  if (!VALID_DISTRIBUTION.has(rec.distribution)) {
    throw new Error(`bad distribution for ${rec.isin}: ${rec.distribution}`);
  }
  if (!VALID_EXCHANGE.has(rec.defaultExchange)) {
    throw new Error(`bad defaultExchange for ${rec.isin}: ${rec.defaultExchange}`);
  }
  const lines = [
    `  ${tsString(rec.isin)}: I({`,
    `    name: ${tsString(rec.name)},`,
    `    isin: ${tsString(rec.isin)},`,
    `    terBps: ${Number(rec.terBps)},`,
    `    domicile: ${tsString(rec.domicile)},`,
    `    replication: ${tsString(rec.replication)},`,
    `    distribution: ${tsString(rec.distribution)},`,
    `    currency: ${tsString(rec.currency)},`,
    `    comment: ${tsString(rec.comment)},`,
    `    listings: ${buildListingsLiteral(rec.listings)},`,
    `    defaultExchange: ${tsString(rec.defaultExchange)},`,
  ];
  if (typeof rec.aumMillionsEUR === "number" && Number.isFinite(rec.aumMillionsEUR)) {
    lines.push(`    aumMillionsEUR: ${rec.aumMillionsEUR},`);
  }
  if (typeof rec.inceptionDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(rec.inceptionDate)) {
    lines.push(`    inceptionDate: ${tsString(rec.inceptionDate)},`);
  }
  lines.push(`  }),`);
  return lines.join("\n");
}

function findInstrumentsCloseIndex(src) {
  // Locate the line `};` that closes the INSTRUMENTS Record object literal.
  // We anchor on the opening declaration and walk forward, counting braces
  // (string-aware) to find the matching close.
  const openMatch = src.match(/const INSTRUMENTS:\s*Record<string,\s*InstrumentRecord>\s*=\s*\{/);
  if (!openMatch) throw new Error("Could not locate `const INSTRUMENTS = {` declaration");
  let i = openMatch.index + openMatch[0].length; // first char after the opening brace
  let depth = 1;
  let inStr = null;
  let inLine = false;
  let inBlock = false;
  while (i < src.length && depth > 0) {
    const ch = src[i];
    const prev = src[i - 1];
    if (inLine) {
      if (ch === "\n") inLine = false;
      i++;
      continue;
    }
    if (inBlock) {
      if (ch === "/" && prev === "*") inBlock = false;
      i++;
      continue;
    }
    if (inStr) {
      if (ch === "\\") {
        i += 2;
        continue;
      }
      if (ch === inStr) inStr = null;
      i++;
      continue;
    }
    if (ch === "/" && src[i + 1] === "/") {
      inLine = true;
      i += 2;
      continue;
    }
    if (ch === "/" && src[i + 1] === "*") {
      inBlock = true;
      i += 2;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      inStr = ch;
      i++;
      continue;
    }
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return i; // index of the closing brace
    }
    i++;
  }
  throw new Error("Could not find matching close brace for INSTRUMENTS");
}

async function main() {
  const dryRun = process.env.DRY_RUN === "1";
  const staged = JSON.parse(await readFile(STAGED_JSON, "utf8"));
  const instruments = staged.instruments || [];
  console.log(
    `\n=== inject-popular-etfs — ${instruments.length} staged entry(ies) ===\n`
  );

  const src = await readFile(ETFS_TS, "utf8");

  // Idempotency: skip ISINs already present in INSTRUMENTS.
  const existingIsins = new Set(
    (src.match(/^\s*"([A-Z]{2}[A-Z0-9]{9}\d)":\s*I\(/gm) || []).map((m) =>
      m.match(/"([A-Z]{2}[A-Z0-9]{9}\d)"/)[1]
    )
  );
  const toInject = instruments.filter((rec) => !existingIsins.has(rec.isin));
  const skipped = instruments.length - toInject.length;
  if (skipped > 0) {
    console.log(`  ${skipped} ISIN(s) already in INSTRUMENTS — will skip`);
  }
  if (toInject.length === 0) {
    console.log(`  nothing to inject — exiting`);
    return;
  }

  const closeIdx = findInstrumentsCloseIndex(src);

  const entryBlocks = toInject.map((rec) => buildEntryLiteral(rec));
  const block = `\n${entryBlocks.join("\n")}\n`;

  // Splice in: insert before the closing `}` so the block becomes part of
  // the INSTRUMENTS literal. We expect the previous character (or whitespace
  // before it) to be the comma of the last existing entry.
  const before = src.slice(0, closeIdx);
  const after = src.slice(closeIdx);
  const next = before + block + after;

  if (dryRun) {
    console.log(`  DRY_RUN=1 — diff summary:`);
    console.log(`    new entries: ${toInject.length} (skipped ${skipped})`);
    console.log(`    src bytes: ${src.length} → ${next.length} (Δ ${next.length - src.length})`);
    return;
  }
  await writeFile(ETFS_TS, next, "utf8");
  console.log(`  wrote ${ETFS_TS}`);
  console.log(`  total ISINs after inject: ${(next.match(/^\s*"[A-Z]{2}[A-Z0-9]{9}\d":\s*I\(/gm) || []).length}`);
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
