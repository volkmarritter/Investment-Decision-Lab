// ----------------------------------------------------------------------------
// useEtfInfo — bundle ETF metadata for an ISIN from three sources
// ----------------------------------------------------------------------------
// Used by the Explain workspace's manual-entry preview card. Consolidates:
//
//   1. catalogInstrument — synchronous lookup in the bundled catalog
//      (etfs.ts → INSTRUMENTS). Hit when the operator manually-enters an
//      ISIN that already lives in the curated catalog (rare but possible).
//
//   2. pool — synchronous lookup in the bundled lookthrough pool
//      (lookthrough.overrides.json → PROFILES). Hit when the monthly
//      refresh job has already scraped this ISIN's holdings/breakdowns.
//      This is the SAME data source that drives the look-through cards
//      for catalog ETFs, so its presence here means the manual position
//      will already feed Geo / Sector / TopHoldings / HomeBias correctly.
//
//   3. scrape — async, debounced live fetch of /api/etf-preview/:isin
//      (rate-limited to 10/min/IP server-side, 5-min in-memory TTL on
//      the server, 8s timeout per upstream scrape). Returns whatever
//      justETF currently publishes for the profile (name, currency, TER,
//      AUM, inception, replication, distribution, domicile, listings).
//      We additionally cache the resolved payload in this module so the
//      same tab doesn't re-fetch when the user toggles the form open
//      and closed.
//
// All three lookups operate on the same normalized ISIN (uppercase,
// trimmed). The hook never throws — error states surface via the
// `scrapeError` field so the preview card can render them inline.
// ----------------------------------------------------------------------------

import { useEffect, useMemo, useRef, useState } from "react";
import { getInstrumentByIsin, type InstrumentRecord } from "./etfs";
import { profileFor, type LookthroughProfile } from "./lookthrough";

// Mirrors the api-server's PreviewResult shape (see
// artifacts/api-server/src/lib/etf-scrape.ts). Re-declared here to keep
// the client free of a workspace import on the api package.
export interface EtfScrapeFields {
  name?: string;
  currency?: string;
  domicile?: string;
  terBps?: number;
  ter?: number; // some scrapers return percent (0.07) instead of bps (7)
  aumMillionsEUR?: number;
  inceptionDate?: string;
  replication?: string;
  distribution?: string;
  // The scraper attaches arbitrary additional fields under
  // PREVIEW_EXTRACTORS — we render the well-known ones and ignore others.
  [k: string]: unknown;
}

export interface EtfScrapeListing {
  exchange?: string;
  ticker?: string;
  currency?: string;
  [k: string]: unknown;
}

export interface EtfScrapeResult {
  isin: string;
  fields: EtfScrapeFields;
  listings?: EtfScrapeListing[] | unknown;
  policyFit?: { aumOk: boolean; terOk: boolean; notes: string[] };
  sourceUrl?: string;
}

export interface UseEtfInfo {
  isValidIsin: boolean;
  catalogInstrument: Readonly<InstrumentRecord> | undefined;
  pool: LookthroughProfile | null;
  scrape: EtfScrapeResult | null;
  scrapeLoading: boolean;
  // Operator-facing message when the live justETF lookup failed. Empty
  // when the lookup hasn't run yet or succeeded — UI should fall back to
  // catalog/pool data without surfacing a noisy error in that case.
  scrapeError: string | null;
}

// Module-level cache so re-mounting the form (e.g. closing and reopening
// the unassigned-positions group) doesn't re-burn the rate-limit bucket
// for ISINs we've already looked up in this tab.
const SCRAPE_CACHE = new Map<
  string,
  { at: number; ok: EtfScrapeResult } | { at: number; err: string }
>();
const SCRAPE_CACHE_TTL_MS = 10 * 60 * 1000;

const ISIN_RE = /^[A-Z]{2}[A-Z0-9]{9}\d$/;
const DEBOUNCE_MS = 500;

function apiBase(): string {
  const env = (import.meta as { env?: Record<string, string | undefined> })
    .env;
  return env?.VITE_API_BASE_URL?.replace(/\/$/, "") ?? "";
}

export function normalizeIsin(raw: string | null | undefined): string {
  return String(raw ?? "")
    .trim()
    .toUpperCase();
}

export function isValidIsin(raw: string | null | undefined): boolean {
  return ISIN_RE.test(normalizeIsin(raw));
}

export function useEtfInfo(rawIsin: string | null | undefined): UseEtfInfo {
  const isin = useMemo(() => normalizeIsin(rawIsin), [rawIsin]);
  const valid = useMemo(() => ISIN_RE.test(isin), [isin]);

  // Synchronous lookups — these are pure reads from already-bundled data
  // and are safe to recompute on every render. `useMemo` keyed on the
  // normalized ISIN keeps reference identity stable across re-renders
  // when the parent re-renders for unrelated reasons (e.g. weight edit).
  const catalogInstrument = useMemo(
    () => (valid ? getInstrumentByIsin(isin) : undefined),
    [isin, valid],
  );
  const pool = useMemo(
    () => (valid ? profileFor(isin) : null),
    [isin, valid],
  );

  const [scrape, setScrape] = useState<EtfScrapeResult | null>(null);
  const [scrapeLoading, setScrapeLoading] = useState(false);
  const [scrapeError, setScrapeError] = useState<string | null>(null);

  // Per-effect-run epoch token. Every time the effect re-runs (because
  // the ISIN changed) we bump the epoch and capture a snapshot. Late
  // resolves from previous epochs check `epoch === epochRef.current`
  // before committing state — this closes the window where a slow
  // fetch from ISIN A can land while the row is already showing ISIN B
  // (which would otherwise paint A's master data and let the operator
  // quick-fill the wrong values into B's manualMeta).
  const epochRef = useRef(0);

  useEffect(() => {
    // Bump epoch immediately on every effect run, BEFORE the debounce
    // window opens. Any in-flight request from the previous epoch will
    // see a stale token and skip its state commit.
    const myEpoch = ++epochRef.current;

    if (!valid) {
      setScrape(null);
      setScrapeError(null);
      setScrapeLoading(false);
      return;
    }

    // Hit cache first — both success and error are cached so we don't
    // hammer the rate limiter on a known-bad ISIN either. Cache hits
    // commit synchronously, so no epoch check is needed here.
    const cached = SCRAPE_CACHE.get(isin);
    if (cached && Date.now() - cached.at < SCRAPE_CACHE_TTL_MS) {
      if ("ok" in cached) {
        setScrape(cached.ok);
        setScrapeError(null);
      } else {
        setScrape(null);
        setScrapeError(cached.err);
      }
      setScrapeLoading(false);
      return;
    }

    // Debounce the live fetch so typing characters mid-ISIN doesn't fire
    // a request per keystroke.
    setScrapeLoading(true);
    setScrapeError(null);
    setScrape(null);

    const ac = new AbortController();
    const handle = setTimeout(() => {
      void fetch(`${apiBase()}/api/etf-preview/${encodeURIComponent(isin)}`, {
        signal: ac.signal,
      })
        .then(async (res) => {
          // Body shape is { error, message } on failure, EtfScrapeResult
          // on success — either way it's a single JSON parse.
          const body = (await res.json().catch(() => null)) as
            | EtfScrapeResult
            | { error?: string; message?: string }
            | null;
          // Drop late resolves from a previous epoch (user moved on to
          // a different ISIN). We must NOT mutate SCRAPE_CACHE either,
          // because the upstream answer is still authoritative for
          // the ISIN we asked about — but we asked under a stale epoch
          // and another in-flight request is now responsible for the
          // current ISIN.
          if (myEpoch !== epochRef.current) return;
          if (!res.ok) {
            const msg =
              (body && "message" in body && body.message) ||
              (body && "error" in body && body.error) ||
              `HTTP ${res.status}`;
            SCRAPE_CACHE.set(isin, { at: Date.now(), err: String(msg) });
            setScrape(null);
            setScrapeError(String(msg));
            setScrapeLoading(false);
            return;
          }
          // Treat anything missing the `isin` field as malformed — keep
          // the success-cache pristine so we don't poison it. Use a
          // sentinel error code that the component translates per-locale
          // rather than baking a German string into the hook.
          if (!body || typeof body !== "object" || !("isin" in body)) {
            const msg = "ETF_PREVIEW_MALFORMED";
            SCRAPE_CACHE.set(isin, { at: Date.now(), err: msg });
            setScrape(null);
            setScrapeError(msg);
            setScrapeLoading(false);
            return;
          }
          const ok = body as EtfScrapeResult;
          SCRAPE_CACHE.set(isin, { at: Date.now(), ok });
          setScrape(ok);
          setScrapeError(null);
          setScrapeLoading(false);
        })
        .catch((err) => {
          // AbortError from our own AbortController is expected on
          // unmount / ISIN change — never surface it to the user.
          if (err && (err as { name?: string }).name === "AbortError") return;
          if (myEpoch !== epochRef.current) return;
          const msg = err instanceof Error ? err.message : String(err);
          // Don't cache transport-level errors — they're often transient
          // (network blip, server restart) and we want the user's next
          // edit to retry.
          setScrape(null);
          setScrapeError(msg);
          setScrapeLoading(false);
        });
    }, DEBOUNCE_MS);

    return () => {
      clearTimeout(handle);
      ac.abort();
    };
  }, [isin, valid]);

  return {
    isValidIsin: valid,
    catalogInstrument,
    pool,
    scrape,
    scrapeLoading,
    scrapeError,
  };
}
