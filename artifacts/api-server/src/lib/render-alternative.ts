// ----------------------------------------------------------------------------
// render-alternative.ts
// ----------------------------------------------------------------------------
// Renders a `NewAlternativeEntry` as a bare TypeScript object literal — the
// shape that lives INSIDE a parent record's `alternatives: [ ... ]` array
// in `artifacts/investment-lab/src/lib/etfs.ts`.
//
// Differs from render-entry.ts in two ways:
//   1. No `"<key>":` prefix — alternatives are positional, not keyed.
//   2. No `E({...})` wrapper — alternatives are bare object literals; the
//      `E` helper is only applied to top-level catalog entries (it injects
//      the `kind: "etf"` discriminator that engine consumers use).
//
// Lives in its own module (vs. being a private helper inside github.ts) so:
//   1. The admin UI can ask for the same string via /api/admin/bucket-
//      alternatives/render without dragging the @octokit/rest dependency
//      into the bundle path that the unit tests load.
//   2. The PR body and the in-app "Show generated code" disclosure stay
//      byte-identical — what the operator previews is exactly what GitHub
//      will see in the file diff.
// ----------------------------------------------------------------------------

export interface NewAlternativeEntry {
  name: string;
  isin: string;
  terBps: number;
  domicile: string;
  replication: "Physical" | "Physical (sampled)" | "Synthetic";
  distribution: "Accumulating" | "Distributing";
  currency: string;
  comment: string;
  defaultExchange: "LSE" | "XETRA" | "SIX" | "Euronext";
  listings: Partial<
    Record<"LSE" | "XETRA" | "SIX" | "Euronext", { ticker: string }>
  >;
  aumMillionsEUR?: number;
  inceptionDate?: string;
}

export function renderAlternativeBlock(
  entry: NewAlternativeEntry,
  indent = "      ",
): string {
  // Defence-in-depth: even though validateAlternative whitelists exchange
  // keys, we ALSO emit them through JSON.stringify (which produces quoted
  // identifiers) so a future validation regression can't inject raw TS
  // tokens via a malicious listings key.
  const listingsParts: string[] = [];
  for (const [ex, val] of Object.entries(entry.listings)) {
    if (!val) continue;
    listingsParts.push(`${json(ex)}: { ticker: ${json(val.ticker)} }`);
  }
  const listingsLiteral = `{ ${listingsParts.join(", ")} }`;

  const optionalLines: string[] = [];
  if (entry.aumMillionsEUR !== undefined) {
    optionalLines.push(`${indent}  aumMillionsEUR: ${entry.aumMillionsEUR},`);
  }
  if (entry.inceptionDate) {
    optionalLines.push(`${indent}  inceptionDate: ${json(entry.inceptionDate)},`);
  }
  return [
    `${indent}{`,
    `${indent}  name: ${json(entry.name)},`,
    `${indent}  isin: ${json(entry.isin)},`,
    `${indent}  terBps: ${entry.terBps},`,
    `${indent}  domicile: ${json(entry.domicile)},`,
    `${indent}  replication: ${json(entry.replication)},`,
    `${indent}  distribution: ${json(entry.distribution)},`,
    `${indent}  currency: ${json(entry.currency)},`,
    `${indent}  comment: ${json(entry.comment)},`,
    `${indent}  listings: ${listingsLiteral},`,
    `${indent}  defaultExchange: ${json(entry.defaultExchange)},`,
    ...optionalLines,
    `${indent}},`,
  ].join("\n");
}

function json(v: string): string {
  return JSON.stringify(v);
}
