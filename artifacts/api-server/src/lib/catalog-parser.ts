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

export interface AlternativeEntrySummary {
  // Alternatives are positional (no `key`) — they live inside the parent
  // record's `alternatives: [...]` array, addressed by slot index 1..2.
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
  // Curated alternatives operators can swap to via the per-bucket picker.
  // Capped at 2 by the catalog invariants (validateCatalog) — see etfs.ts.
  // Absent when the bucket has no curated alternatives configured.
  alternatives?: AlternativeEntrySummary[];
}

export type CatalogSummary = Record<string, CatalogEntrySummary>;

// Task #111: the catalog source split into two complementary literals:
//   • INSTRUMENTS — keyed by ISIN, master per-ETF metadata.
//   • BUCKETS    — keyed by bucket key, assignment shape
//                  { default: ISIN, alternatives: [ISIN, ...] }.
// We parse both and join them to keep producing the same
// `CatalogSummary` shape every downstream consumer (admin UI, PR
// helpers, dedup checks) already expects.
const INSTRUMENTS_HEADER =
  "const INSTRUMENTS: Record<string, InstrumentRecord> = {";
const BUCKETS_HEADER =
  "const BUCKETS: Record<string, BucketAssignment> = {";

export interface InstrumentEntrySummary {
  isin: string;
  name: string;
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

export interface BucketAssignmentSummary {
  default: string;
  alternatives: string[];
}

export function parseInstrumentsFromSource(
  source: string,
): Record<string, InstrumentEntrySummary> {
  const start = source.indexOf(INSTRUMENTS_HEADER);
  if (start < 0) {
    throw new Error(
      `Could not locate "${INSTRUMENTS_HEADER}" in etfs.ts source — the parser is out of date.`,
    );
  }
  const open = source.indexOf("{", start);
  const close = findMatchingClose(source, open);
  if (close < 0) {
    throw new Error(
      "Unbalanced braces in INSTRUMENTS literal — refusing to parse.",
    );
  }
  const body = source.slice(open + 1, close);
  const out: Record<string, InstrumentEntrySummary> = {};
  // Each entry: `"<ISIN>": I({ ... }),`
  const entryRe = /"([A-Z0-9]+)":\s*I\(\{/g;
  let m: RegExpExecArray | null;
  while ((m = entryRe.exec(body)) !== null) {
    const isin = m[1];
    const openBrace = m.index + m[0].length - 1;
    const closeBrace = findMatchingClose(body, openBrace);
    if (closeBrace < 0) {
      throw new Error(`Unbalanced braces inside INSTRUMENTS entry "${isin}".`);
    }
    const entryBody = body.slice(openBrace + 1, closeBrace);
    out[isin] = {
      isin,
      name: stringField(entryBody, "name") ?? "",
      terBps: numberField(entryBody, "terBps") ?? 0,
      domicile: stringField(entryBody, "domicile") ?? "",
      replication: stringField(entryBody, "replication") ?? "",
      distribution: stringField(entryBody, "distribution") ?? "",
      currency: stringField(entryBody, "currency") ?? "",
      comment: stringField(entryBody, "comment") ?? "",
      listings: parseListings(entryBody),
      defaultExchange: stringField(entryBody, "defaultExchange") ?? "",
      aumMillionsEUR: numberField(entryBody, "aumMillionsEUR"),
      inceptionDate: stringField(entryBody, "inceptionDate"),
    };
    entryRe.lastIndex = closeBrace + 1;
  }
  return out;
}

export function parseBucketsFromSource(
  source: string,
): Record<string, BucketAssignmentSummary> {
  const start = source.indexOf(BUCKETS_HEADER);
  if (start < 0) {
    throw new Error(
      `Could not locate "${BUCKETS_HEADER}" in etfs.ts source — the parser is out of date.`,
    );
  }
  const open = source.indexOf("{", start);
  const close = findMatchingClose(source, open);
  if (close < 0) {
    throw new Error(
      "Unbalanced braces in BUCKETS literal — refusing to parse.",
    );
  }
  const body = source.slice(open + 1, close);
  const out: Record<string, BucketAssignmentSummary> = {};
  // Each entry: `"<KEY>": B({ default: "...", alternatives: [...] }),`
  const entryRe = /"([A-Za-z0-9_-]+)":\s*B\(\{/g;
  let m: RegExpExecArray | null;
  while ((m = entryRe.exec(body)) !== null) {
    const key = m[1];
    const openBrace = m.index + m[0].length - 1;
    const closeBrace = findMatchingClose(body, openBrace);
    if (closeBrace < 0) {
      throw new Error(`Unbalanced braces inside BUCKETS entry "${key}".`);
    }
    const entryBody = body.slice(openBrace + 1, closeBrace);
    const def = stringField(entryBody, "default") ?? "";
    const alts = parseStringArrayField(entryBody, "alternatives");
    out[key] = { default: def, alternatives: alts };
    entryRe.lastIndex = closeBrace + 1;
  }
  return out;
}

// Parse `<name>: ["ISIN", "ISIN", ...]` returning the string elements.
function parseStringArrayField(body: string, name: string): string[] {
  const idx = findTopLevelFieldIndex(body, name);
  if (idx < 0) return [];
  let cursor = idx;
  if (body[cursor] === '"') {
    cursor++;
    while (cursor < body.length && body[cursor] !== '"') cursor++;
    cursor++;
  } else {
    cursor += name.length;
  }
  while (cursor < body.length && /\s/.test(body[cursor])) cursor++;
  if (body[cursor] !== ":") return [];
  cursor++;
  while (cursor < body.length && /\s/.test(body[cursor])) cursor++;
  if (body[cursor] !== "[") return [];
  const open = cursor;
  const close = findMatchingBracket(body, open);
  if (close < 0) return [];
  const inner = body.slice(open + 1, close);
  const out: string[] = [];
  const re = /"([^"]+)"/g;
  let mm: RegExpExecArray | null;
  while ((mm = re.exec(inner)) !== null) {
    out.push(mm[1]);
  }
  return out;
}

export function parseCatalogFromSource(source: string): CatalogSummary {
  const instruments = parseInstrumentsFromSource(source);
  const buckets = parseBucketsFromSource(source);
  return joinCatalog(instruments, buckets);
}

// Join the two parsed tables back into the historical CatalogSummary
// shape (per-bucket entry with its default's metadata + an
// `alternatives` array of full alternative records).
function joinCatalog(
  instruments: Record<string, InstrumentEntrySummary>,
  buckets: Record<string, BucketAssignmentSummary>,
): CatalogSummary {
  const out: CatalogSummary = {};
  for (const [key, b] of Object.entries(buckets)) {
    const def = instruments[b.default];
    if (!def) {
      // Surface as a structural error so the admin UI shows an actionable
      // message rather than silently dropping the bucket.
      throw new Error(
        `BUCKETS["${key}"].default = "${b.default}" but no INSTRUMENTS["${b.default}"] exists.`,
      );
    }
    const altSummaries: AlternativeEntrySummary[] = [];
    for (const isin of b.alternatives) {
      const alt = instruments[isin];
      if (!alt) {
        throw new Error(
          `BUCKETS["${key}"].alternatives contains "${isin}" but no INSTRUMENTS["${isin}"] exists.`,
        );
      }
      altSummaries.push({
        name: alt.name,
        isin: alt.isin,
        terBps: alt.terBps,
        domicile: alt.domicile,
        replication: alt.replication,
        distribution: alt.distribution,
        currency: alt.currency,
        comment: alt.comment,
        listings: alt.listings,
        defaultExchange: alt.defaultExchange,
        ...(alt.aumMillionsEUR !== undefined
          ? { aumMillionsEUR: alt.aumMillionsEUR }
          : {}),
        ...(alt.inceptionDate !== undefined
          ? { inceptionDate: alt.inceptionDate }
          : {}),
      });
    }
    out[key] = {
      key,
      name: def.name,
      isin: def.isin,
      terBps: def.terBps,
      domicile: def.domicile,
      replication: def.replication,
      distribution: def.distribution,
      currency: def.currency,
      comment: def.comment,
      listings: def.listings,
      defaultExchange: def.defaultExchange,
      ...(def.aumMillionsEUR !== undefined
        ? { aumMillionsEUR: def.aumMillionsEUR }
        : {}),
      ...(def.inceptionDate !== undefined
        ? { inceptionDate: def.inceptionDate }
        : {}),
      ...(altSummaries.length > 0 ? { alternatives: altSummaries } : {}),
    };
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
  // Strip the `alternatives: [...]` block before scanning the entry's
  // own scalar fields. Without this, stringField/numberField would also
  // match the alternative's `name`, `isin`, etc. and return the FIRST
  // alternative's values for the parent entry — silently corrupting the
  // catalog summary the admin pane relies on for de-dup checks.
  const { primaryBody, alternatives } = splitAlternatives(body);
  return {
    key,
    name: stringField(primaryBody, "name") ?? "",
    isin: stringField(primaryBody, "isin") ?? "",
    terBps: numberField(primaryBody, "terBps") ?? 0,
    domicile: stringField(primaryBody, "domicile") ?? "",
    replication: stringField(primaryBody, "replication") ?? "",
    distribution: stringField(primaryBody, "distribution") ?? "",
    currency: stringField(primaryBody, "currency") ?? "",
    comment: stringField(primaryBody, "comment") ?? "",
    listings: parseListings(primaryBody),
    defaultExchange: stringField(primaryBody, "defaultExchange") ?? "",
    aumMillionsEUR: numberField(primaryBody, "aumMillionsEUR"),
    inceptionDate: stringField(primaryBody, "inceptionDate"),
    ...(alternatives.length > 0 ? { alternatives } : {}),
  };
}

// Walks the entry body looking for an `alternatives: [` array. If found,
// returns the body with the array removed (so scalar field scans don't
// pick up alternative-nested fields) plus the parsed alternatives. If
// not found, returns the body unchanged with an empty array.
//
// Critical: the field lookup must be string- AND comment-aware. A naive
// `body.indexOf("alternatives:")` is fooled by an earlier occurrence
// inside a quoted comment string (e.g. `comment: "see alternatives: ..."`)
// — the function would then find no `[` after the false hit and bail out,
// silently dropping the bucket's REAL alternatives array. Because both
// the route preflight loop and `injectAlternative()`'s global ISIN-dup
// check rely on this parser, that miss would let an operator open a PR
// adding an ISIN that already exists in another bucket's alternatives,
// violating the global-uniqueness invariant. We therefore reuse the same
// string/comment-skipping walker as `findMatchingBracket` (and require
// the field name to sit at depth 0 of the entry body).
function splitAlternatives(body: string): {
  primaryBody: string;
  alternatives: AlternativeEntrySummary[];
} {
  const idx = findTopLevelFieldIndex(body, "alternatives");
  if (idx < 0) return { primaryBody: body, alternatives: [] };
  // Skip past `alternatives:` (or `"alternatives":`). The walker below
  // returns the index of the first character of the (un)quoted field
  // name. Advance past the name, the optional closing quote, and the
  // colon, then the `[` (with whitespace).
  let cursor = idx;
  if (body[cursor] === '"') {
    // Quoted field name: skip past the closing quote.
    cursor++;
    while (cursor < body.length && body[cursor] !== '"') cursor++;
    cursor++; // past closing quote
  } else {
    cursor += "alternatives".length;
  }
  // Skip whitespace then the `:`.
  while (cursor < body.length && /\s/.test(body[cursor])) cursor++;
  if (body[cursor] !== ":") return { primaryBody: body, alternatives: [] };
  cursor++;
  while (cursor < body.length && /\s/.test(body[cursor])) cursor++;
  if (body[cursor] !== "[") {
    return { primaryBody: body, alternatives: [] };
  }
  const openBracket = cursor;
  const closeBracket = findMatchingBracket(body, openBracket);
  if (closeBracket < 0) {
    return { primaryBody: body, alternatives: [] };
  }
  const arrayBody = body.slice(openBracket + 1, closeBracket);
  const alternatives = parseAlternativesArray(arrayBody);
  // Strip the entire `alternatives: [...]` (including a trailing comma if
  // present) before scanning scalar fields.
  let stripEnd = closeBracket + 1;
  if (body[stripEnd] === ",") stripEnd++;
  const primaryBody = body.slice(0, idx) + body.slice(stripEnd);
  return { primaryBody, alternatives };
}

// String- and comment-aware scanner that returns the index of a top-level
// (depth-0) field name token (`alternatives` or `"alternatives"`) inside
// `body`. Returns -1 if no such field exists. Mirrors the skip semantics
// of `findMatchingBracket` so braces/brackets inside string literals or
// `// …` / `/* … */` comments cannot fool the depth tracker.
function findTopLevelFieldIndex(body: string, name: string): number {
  let depth = 0;
  let i = 0;
  while (i < body.length) {
    const ch = body[i];
    // Skip string literals — BUT first, at depth 0 with a delimiter
    // before us, check whether this `"` opens a quoted field-name token
    // like `"alternatives":`. If it does, return the `"` index and let
    // the caller advance past the closing quote. Without this, the
    // generic string-skip below would consume the entire `"alternatives"`
    // token and we'd never match the quoted-key form (which the
    // unquoted-vs-quoted-key duality of parseListings establishes is a
    // legitimate variant in this catalog).
    if (ch === '"') {
      if (depth === 0) {
        const prev = i > 0 ? body[i - 1] : "";
        const prevOk = i === 0 || /[\s,{]/.test(prev);
        if (
          prevOk &&
          body.slice(i + 1, i + 1 + name.length) === name &&
          body[i + 1 + name.length] === '"'
        ) {
          let j = i + 1 + name.length + 1;
          while (j < body.length && /\s/.test(body[j])) j++;
          if (body[j] === ":") return i;
        }
      }
      i++;
      while (i < body.length) {
        const c = body[i];
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
    // Skip line comments.
    if (ch === "/" && body[i + 1] === "/") {
      while (i < body.length && body[i] !== "\n") i++;
      continue;
    }
    // Skip block comments.
    if (ch === "/" && body[i + 1] === "*") {
      i += 2;
      while (i < body.length - 1 && !(body[i] === "*" && body[i + 1] === "/")) {
        i++;
      }
      i += 2;
      continue;
    }
    if (ch === "{" || ch === "[" || ch === "(") {
      depth++;
      i++;
      continue;
    }
    if (ch === "}" || ch === "]" || ch === ")") {
      depth--;
      i++;
      continue;
    }
    if (depth === 0) {
      // At depth 0 — check for `name` or `"name"` followed by optional
      // whitespace and a `:`. The preceding char must be a delimiter
      // (start of body, whitespace, comma, or `{`) so we don't match
      // a substring like `nameFooalternatives:`.
      const prev = i > 0 ? body[i - 1] : "";
      const prevOk = i === 0 || /[\s,{]/.test(prev);
      if (prevOk) {
        if (
          ch === '"' &&
          body.slice(i + 1, i + 1 + name.length) === name &&
          body[i + 1 + name.length] === '"'
        ) {
          // Quoted field name — caller advances past the closing quote.
          let j = i + 1 + name.length + 1;
          while (j < body.length && /\s/.test(body[j])) j++;
          if (body[j] === ":") return i;
        } else if (body.slice(i, i + name.length) === name) {
          // Unquoted — must be followed by whitespace + `:` (after
          // checking the next char isn't an identifier continuation).
          const after = body[i + name.length];
          if (after !== undefined && !/[A-Za-z0-9_$]/.test(after)) {
            let j = i + name.length;
            while (j < body.length && /\s/.test(body[j])) j++;
            if (body[j] === ":") return i;
          }
        }
      }
    }
    i++;
  }
  return -1;
}

function parseAlternativesArray(arrayBody: string): AlternativeEntrySummary[] {
  // Each alternative is a bare object literal: `{ name: ..., isin: ..., ... }`.
  // Walk for `{` at depth-0, find the matching `}`, parse the body.
  const out: AlternativeEntrySummary[] = [];
  let i = 0;
  while (i < arrayBody.length) {
    const ch = arrayBody[i];
    if (ch === "{") {
      const close = findMatchingClose(arrayBody, i);
      if (close < 0) break;
      const innerBody = arrayBody.slice(i + 1, close);
      out.push({
        name: stringField(innerBody, "name") ?? "",
        isin: stringField(innerBody, "isin") ?? "",
        terBps: numberField(innerBody, "terBps") ?? 0,
        domicile: stringField(innerBody, "domicile") ?? "",
        replication: stringField(innerBody, "replication") ?? "",
        distribution: stringField(innerBody, "distribution") ?? "",
        currency: stringField(innerBody, "currency") ?? "",
        comment: stringField(innerBody, "comment") ?? "",
        listings: parseListings(innerBody),
        defaultExchange: stringField(innerBody, "defaultExchange") ?? "",
        aumMillionsEUR: numberField(innerBody, "aumMillionsEUR"),
        inceptionDate: stringField(innerBody, "inceptionDate"),
      });
      i = close + 1;
      continue;
    }
    i++;
  }
  return out;
}

// Bracket-aware variant of findMatchingClose for `[...]`. Reuses the
// same string- and comment-skipping logic so a `[` or `]` inside a
// comment string can't truncate the array.
function findMatchingBracket(source: string, openIdx: number): number {
  let depth = 0;
  let i = openIdx;
  while (i < source.length) {
    const ch = source[i];
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
    if (ch === "/" && source[i + 1] === "/") {
      while (i < source.length && source[i] !== "\n") i++;
      continue;
    }
    if (ch === "/" && source[i + 1] === "*") {
      i += 2;
      while (i < source.length - 1 && !(source[i] === "*" && source[i + 1] === "/")) {
        i++;
      }
      i += 2;
      continue;
    }
    if (ch === "[") depth++;
    else if (ch === "]") {
      depth--;
      if (depth === 0) return i;
    }
    i++;
  }
  return -1;
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
// `/admin/add-isin` guard. Returns a string identifying WHERE the
// `draftIsin` already lives — either a bare bucket key (when it's the
// default of that bucket) or `"<bucket> alt N"` (when it's the N-th
// alternative, 1-based) — under any bucket OTHER than `draftKey`.
// Returns null when the ISIN is unique. Case- and whitespace-insensitive.
//
// Strict global uniqueness (Task #111 Phase 2): an ISIN may appear in
// at most one bucket slot across the whole catalog, default OR
// alternative. The preview classifier uses this to flag duplicates
// before the operator opens a Pull Request — so this MUST scan
// alternatives too, not just defaults.
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
    if (entry.alternatives) {
      for (let i = 0; i < entry.alternatives.length; i++) {
        if (entry.alternatives[i].isin.toUpperCase() === norm) {
          return `${k} alt ${i + 1}`;
        }
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// On-disk loader with content-keyed cache.
// ---------------------------------------------------------------------------

let cachedSource = "";
let cachedCatalog: CatalogSummary | null = null;
let cachedInstruments: Record<string, InstrumentEntrySummary> | null = null;
let cachedBuckets: Record<string, BucketAssignmentSummary> | null = null;

export async function loadCatalog(): Promise<CatalogSummary> {
  await loadCatalogSource();
  return cachedCatalog!;
}

// Task #111: returns the parsed INSTRUMENTS table on its own (keyed by
// ISIN). Used by the Instruments sub-tab + tree-row picker dropdowns
// where the joined catalog view isn't enough — they need to see every
// instrument, including those not yet assigned to any bucket.
export async function loadInstruments(): Promise<Record<string, InstrumentEntrySummary>> {
  await loadCatalogSource();
  return cachedInstruments!;
}

// Task #111: returns the parsed BUCKETS assignment table on its own
// (keyed by bucket key). Each value is { default, alternatives[] } as
// stored in source. Used by the picker endpoints that need to compute
// which ISINs are already taken across the catalog.
export async function loadBuckets(): Promise<Record<string, BucketAssignmentSummary>> {
  await loadCatalogSource();
  return cachedBuckets!;
}

async function loadCatalogSource(): Promise<void> {
  const path = getCatalogPath();
  const source = await readFile(path, "utf8");
  if (source === cachedSource && cachedCatalog && cachedInstruments && cachedBuckets) {
    return;
  }
  cachedInstruments = parseInstrumentsFromSource(source);
  cachedBuckets = parseBucketsFromSource(source);
  cachedCatalog = joinCatalog(cachedInstruments, cachedBuckets);
  cachedSource = source;
}

// Task #111: per-ISIN usage map. For every instrument ISIN, lists the
// bucket slots (default OR alternative N) it currently occupies. An
// instrument with an empty list is "unassigned" — a candidate for the
// tree-row pickers and safe to delete from INSTRUMENTS.
export interface InstrumentUsage {
  isin: string;
  // Bucket key + role pairs where this ISIN is used. Strict-uniqueness
  // means this list will be either empty (unassigned) or single-entry
  // (one bucket slot). Stored as an array so callers can render
  // "unassigned" vs "in use by X" without an extra branch.
  usages: Array<{ bucket: string; role: "default" | "alternative"; index?: number }>;
}

export function buildInstrumentUsage(
  buckets: Record<string, BucketAssignmentSummary>,
  isin: string,
): InstrumentUsage {
  const usages: InstrumentUsage["usages"] = [];
  const norm = isin.toUpperCase();
  for (const [k, b] of Object.entries(buckets)) {
    if (b.default.toUpperCase() === norm) {
      usages.push({ bucket: k, role: "default" });
    }
    for (let i = 0; i < b.alternatives.length; i++) {
      if (b.alternatives[i].toUpperCase() === norm) {
        usages.push({ bucket: k, role: "alternative", index: i + 1 });
      }
    }
  }
  return { isin, usages };
}

export function _resetCatalogCacheForTests(): void {
  cachedSource = "";
  cachedCatalog = null;
  cachedInstruments = null;
  cachedBuckets = null;
}
