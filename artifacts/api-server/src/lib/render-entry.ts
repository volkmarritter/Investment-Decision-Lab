// ----------------------------------------------------------------------------
// render-entry.ts
// ----------------------------------------------------------------------------
// Renders a `NewEtfEntry` as the literal `"<key>": E({...})` TypeScript
// block that gets inserted into `artifacts/investment-lab/src/lib/etfs.ts`.
//
// Lives in its own module (vs. being a private helper inside github.ts) so:
//   1. The admin UI can ask for the same string via /api/admin/render-entry
//      without dragging the @octokit/rest dependency into the bundle path
//      that the unit tests load.
//   2. The PR body and the in-app "Show generated code" disclosure stay
//      byte-identical — what the operator previews is exactly what GitHub
//      will see in the file diff.
// ----------------------------------------------------------------------------

export interface NewEtfEntry {
  key: string;
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

export function renderEntryBlock(entry: NewEtfEntry, indent = "  "): string {
  // Defence-in-depth: even though validateEntry whitelists exchange keys,
  // we ALSO emit them through JSON.stringify (which produces quoted
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
    `${indent}${json(entry.key)}: E({`,
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
    `${indent}}),`,
  ].join("\n");
}

function json(v: string): string {
  return JSON.stringify(v);
}
