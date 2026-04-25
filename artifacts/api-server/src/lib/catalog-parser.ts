// ----------------------------------------------------------------------------
// catalog-parser.ts
// ----------------------------------------------------------------------------
// Reads `artifacts/investment-lab/src/lib/etfs.ts` from disk and extracts a
// summary of every entry in the `CATALOG` literal — keyed by catalog key,
// with the field values needed for the admin pane's replace-vs-add diff.
//
// We deliberately do NOT import the etfs.ts module at runtime: it pulls in
// the rest of the engine (lookthrough.ts, types, etc.) and would require
// the api-server bundle to reach across the artifact boundary. Instead we
// parse the source string with the same brace-walking approach github.ts
// already uses for safe insertion. Rationale:
//
//   - The catalog literal is small (~30 entries) and shaped in a
//     deliberately predictable way (`"<Key>": E({...})`). A focused
//     hand-written parser is easier to reason about than booting the TS
//     compiler at runtime.
//   - Listings keys are simple identifiers; field values are JSON-quoted
//     strings or numeric literals — no template strings, no expressions.
//   - If the catalog is ever rewritten in a way this parser doesn't
//     support, the unit tests fail loudly (catalog-parser.test.ts).
//
// The parsed result is cached per process; the cache key is the file
// content itself, so an in-place edit during dev triggers a re-parse on
// the next request without needing a workflow restart.
// ----------------------------------------------------------------------------

import { readFile } from "node:fs/promises";
import { getCatalogPath } from "./data-paths";

export interface CatalogEntrySummary {
  key: string;
  name: string;
  isin: string;
  terBps: number;
  domicile: string;
  replication: string;
  distribution: string;
  currency: string;
  comment: string;
  listings: Record<string, { ticker: string }>;
  defaultExchange: string;
  aumMillionsEUR?: number;
  inceptionDate?: string;
}

export type CatalogSummary = Record<string, CatalogEntrySummary>;

const CATALOG_HEADER = "const CATALOG: Record<string, ETFRecord> = {";

export function parseCatalogFromSource(source: string): CatalogSummary {
  const start = source.indexOf(CATALOG_HEADER);
  if (start < 0) {
    throw new Error(
      `Could not locate "${CATALOG_HEADER}" in etfs.ts source — the parser is out of date.`,
    );
  }
  const open = source.indexOf("{", start);
  const close = findMatchingClose(source, open);
  if (close < 0) {
    throw new Error("Unbalanced braces in CATALOG literal — refusing to parse.");
  }

  const body = source.slice(open + 1, close);
  const out: CatalogSummary = {};

  // Each entry begins with `"<KEY>": E({` at any depth-0 position within
  // the catalog body. We scan for that token, then walk braces (string-
  // and comment-aware) to find the matching `})` of the entry literal.
  const entryRe = /"([A-Za-z0-9_-]+)":\s*E\(\{/g;
  let m: RegExpExecArray | null;
  while ((m = entryRe.exec(body)) !== null) {
    const key = m[1];
    // Position of the `{` we just matched (the last char of `m[0]`).
    const openBrace = m.index + m[0].length - 1;
    const closeBrace = findMatchingClose(body, openBrace);
    if (closeBrace < 0) {
      throw new Error(`Unbalanced braces inside catalog entry "${key}".`);
    }
    const entryBody = body.slice(openBrace + 1, closeBrace);
    out[key] = parseEntryBody(key, entryBody);
    // Resume scanning *after* the closing `})` so a stray `E({` inside a
    // string/comment can't confuse the next iteration.
    entryRe.lastIndex = closeBrace + 1;
  }

  return out;
}

// String- and comment-aware matching-brace finder. Walks `source` from
// `openIdx` (which must point at a `{`) to the matching `}`, skipping
// over `"..."` string literals (with `\` escapes), `// line comments`,
// and `/* block comments */`. Returns -1 if no match.
//
// Why: catalog entries contain `comment` strings that the renderer emits
// via JSON.stringify; JSON does not escape `{` or `}`, so a future
// comment containing literal braces would corrupt naive depth-counting
// and cause the parser to truncate or skip entries silently.
export function findMatchingClose(source: string, openIdx: number): number {
  let depth = 0;
  let i = openIdx;
  while (i < source.length) {
    const ch = source[i];
    // String literal — opaque, including any `{`/`}` it contains.
    if (ch === '"') {
      i++;
      while (i < source.length) {
        const c = source[i];
        if (c === "\\") {
          i += 2;
          continue;
        }
        if (c === '"') {
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    // Line comment.
    if (ch === "/" && source[i + 1] === "/") {
      while (i < source.length && source[i] !== "\n") i++;
      continue;
    }
    // Block comment.
    if (ch === "/" && source[i + 1] === "*") {
      i += 2;
      while (i < source.length - 1 && !(source[i] === "*" && source[i + 1] === "/")) {
        i++;
      }
      i += 2;
      continue;
    }
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return i;
    }
    i++;
  }
  return -1;
}

function parseEntryBody(key: string, body: string): CatalogEntrySummary {
  return {
    key,
    name: stringField(body, "name") ?? "",
    isin: stringField(body, "isin") ?? "",
    terBps: numberField(body, "terBps") ?? 0,
    domicile: stringField(body, "domicile") ?? "",
    replication: stringField(body, "replication") ?? "",
    distribution: stringField(body, "distribution") ?? "",
    currency: stringField(body, "currency") ?? "",
    comment: stringField(body, "comment") ?? "",
    listings: parseListings(body),
    defaultExchange: stringField(body, "defaultExchange") ?? "",
    aumMillionsEUR: numberField(body, "aumMillionsEUR"),
    inceptionDate: stringField(body, "inceptionDate"),
  };
}

function stringField(body: string, name: string): string | undefined {
  // Match `<name>:` followed by a JSON-quoted string. The `(?:[^"\\]|\\.)*`
  // body permits escaped quotes inside the value (none in practice today
  // but cheap insurance against future edits).
  const re = new RegExp(`(?:^|[\\s,{])${name}:\\s*("(?:[^"\\\\]|\\\\.)*")`);
  const m = re.exec(body);
  if (!m) return undefined;
  try {
    return JSON.parse(m[1]) as string;
  } catch {
    return undefined;
  }
}

function numberField(body: string, name: string): number | undefined {
  const re = new RegExp(`(?:^|[\\s,{])${name}:\\s*(-?\\d+(?:\\.\\d+)?)`);
  const m = re.exec(body);
  if (!m) return undefined;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : undefined;
}

function parseListings(body: string): Record<string, { ticker: string }> {
  const out: Record<string, { ticker: string }> = {};
  const idx = body.indexOf("listings:");
  if (idx < 0) return out;
  const open = body.indexOf("{", idx);
  if (open < 0) return out;
  const close = findMatchingClose(body, open);
  if (close < 0) return out;
  const inner = body.slice(open + 1, close);
  // Match BOTH unquoted (`LSE: { ticker: "..." }`, the catalog's current
  // hand-written style) AND quoted (`"LSE": { ticker: "..." }`, what
  // renderEntryBlock emits via JSON.stringify) keys, so a renderer-built
  // entry round-trips through the parser correctly.
  const tickerRe = /"?(\w+)"?\s*:\s*\{\s*ticker:\s*"([^"]+)"\s*\}/g;
  let m: RegExpExecArray | null;
  while ((m = tickerRe.exec(inner)) !== null) {
    out[m[1]] = { ticker: m[2] };
  }
  return out;
}

// Pure helper used by both the admin UI's classifier and the server-side
// `/admin/add-isin` guard. Returns the catalog key whose ISIN collides
// with `draftIsin` under a key OTHER than `draftKey`, or null. Case- and
// whitespace-insensitive on the ISIN.
export function findDuplicateIsinKey(
  catalog: CatalogSummary,
  draftKey: string,
  draftIsin: string,
): string | null {
  const norm = draftIsin.trim().toUpperCase();
  if (!norm) return null;
  for (const [k, entry] of Object.entries(catalog)) {
    if (k === draftKey) continue;
    if (entry.isin.toUpperCase() === norm) return k;
  }
  return null;
}

// ---------------------------------------------------------------------------
// On-disk loader with content-keyed cache.
// ---------------------------------------------------------------------------

let cachedSource = "";
let cachedCatalog: CatalogSummary | null = null;

export async function loadCatalog(): Promise<CatalogSummary> {
  const path = getCatalogPath();
  const source = await readFile(path, "utf8");
  if (source === cachedSource && cachedCatalog) {
    return cachedCatalog;
  }
  const parsed = parseCatalogFromSource(source);
  cachedSource = source;
  cachedCatalog = parsed;
  return parsed;
}

export function _resetCatalogCacheForTests(): void {
  cachedSource = "";
  cachedCatalog = null;
}
