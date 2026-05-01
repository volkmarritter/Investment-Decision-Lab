#!/usr/bin/env node
// ----------------------------------------------------------------------------
// inject-popular-etfs.mjs
// ----------------------------------------------------------------------------
// Reads scripts/data/popular-etfs-staged.json and splices each entry as an
// `I({ ... })` row inside the INSTRUMENTS object literal in
// src/lib/etfs.ts, immediately before the closing `};` of that object.
//
// IDEMPOTENCY: Wraps the auto-added block with explicit BEGIN/END marker
// comments. On re-run, the script removes any previous block bracketed by
// those markers before injecting a fresh one — so re-staging + re-running
// produces a clean diff.
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

const BEGIN_MARKER = "  // ----- BEGIN auto-added popular-ETFs orphans -----";
const END_MARKER = "  // ----- END auto-added popular-ETFs orphans -----";

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
    `\n=== inject-popular-etfs — ${instruments.length} staged orphan(s) ===\n`
  );

  const src = await readFile(ETFS_TS, "utf8");

  // Strip any pre-existing auto-added block bracketed by our markers.
  const beginIdx = src.indexOf(BEGIN_MARKER);
  const endIdx = src.indexOf(END_MARKER);
  let cleaned;
  let removed = 0;
  if (beginIdx !== -1 && endIdx !== -1 && endIdx > beginIdx) {
    // Include trailing newline of the END marker line.
    let tail = endIdx + END_MARKER.length;
    if (src[tail] === "\n") tail++;
    cleaned = src.slice(0, beginIdx) + src.slice(tail);
    removed = 1;
    console.log(`  removed previous auto-added block (will replace)\n`);
  } else {
    cleaned = src;
  }

  // Find INSTRUMENTS close in the cleaned source.
  const closeIdx = findInstrumentsCloseIndex(cleaned);

  // Build the auto-block.
  const today = new Date().toISOString().slice(0, 10);
  const banner =
    `  // ----------------------------------------------------------------------------\n` +
    `  // Auto-added orphan popular-ETF entries (no BUCKETS assignment).\n` +
    `  // Source: scripts/inject-popular-etfs.mjs from scripts/data/popular-etfs-staged.json\n` +
    `  // Generated: ${today}. ${instruments.length} entries.\n` +
    `  // These ISINs are recognised by getInstrumentByIsin() in the Explain\n` +
    `  // manual-entry flow but DO NOT appear in any model-portfolio bucket\n` +
    `  // dropdown (which iterates BUCKETS).\n` +
    `  // ----------------------------------------------------------------------------`;

  const entryBlocks = instruments.map((rec) => buildEntryLiteral(rec));
  const block = `\n${BEGIN_MARKER}\n${banner}\n${entryBlocks.join("\n")}\n${END_MARKER}\n`;

  // Splice in: insert before the closing `}` so the block becomes part of
  // the INSTRUMENTS literal. We expect the previous character (or whitespace
  // before it) to be the comma of the last existing entry.
  const before = cleaned.slice(0, closeIdx);
  const after = cleaned.slice(closeIdx);
  const next = before + block + after;

  if (dryRun) {
    console.log(`  DRY_RUN=1 — diff summary:`);
    console.log(`    previous block removed: ${removed === 1 ? "yes" : "no"}`);
    console.log(`    new entries: ${instruments.length}`);
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
