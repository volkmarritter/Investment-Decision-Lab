// ----------------------------------------------------------------------------
// Type shim for scripts/refresh-justetf.mjs (cross-artifact import).
// ----------------------------------------------------------------------------
// The api-server's preview endpoint imports the same scraping helpers the
// scheduled refresh uses, so a previewed ISIN behaves identically to the
// next scrape. The .mjs file lives in a sibling artifact and has no .d.ts;
// this shim describes only the symbols the api-server consumes.
//
// Path is intentionally relative (not via a workspace package) — the file
// is plain ESM with no build step, and a new package would just add
// indirection. esbuild bundles it into dist/index.mjs at server build time.
// ----------------------------------------------------------------------------

declare module "*scripts/lib/justetf-extract.mjs" {
  type Extractor = (html: string) => unknown;
  export const CORE_EXTRACTORS: Record<string, Extractor>;
  export const LISTINGS_EXTRACTORS: Record<string, Extractor>;
  export const PREVIEW_EXTRACTORS: Record<string, Extractor>;
  export const ALL_EXTRACTORS: Record<string, Extractor>;
  export const VENUE_MAP: Record<string, string>;
  export function parseDateLoose(s: unknown): string | undefined;
  export function lastRefreshedModeFor(mode: string): string;
  export function fetchProfile(isin: string): Promise<string>;
}
