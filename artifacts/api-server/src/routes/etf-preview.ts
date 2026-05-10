// ----------------------------------------------------------------------------
// etf-preview.ts (public router)
// ----------------------------------------------------------------------------
// Public, read-only ETF preview endpoint used by the Methodology tab's
// "swap this bucket's ETF" dialog. Wraps the same scraper as the admin
// preview endpoint (POST /api/admin/preview-isin) but without an auth
// gate — it returns publicly-available ETF metadata (name, TER, AUM,
// listings) and never writes to disk.
//
// Mount in routes/index.ts BEFORE the admin router so the public path
// is matched without falling through requireAdmin.
//
// Abuse controls (the upstream scraper hits justETF, so we cannot let
// this endpoint act as an open scraping proxy):
//   * Per-IP token-bucket rate limit (10 requests / 60 s burst, refill
//     1 req every 6 s). Client IP is read from req.ip which Express
//     derives from X-Forwarded-For using the trust-proxy setting —
//     never from a raw header value that a client can spoof.
//   * 8-second timeout on the underlying scrape. The AbortController is
//     signalled when the deadline fires, so the upstream fetch and any
//     pending retries are cancelled immediately rather than running to
//     completion in the background.
//   * Short in-memory TTL cache keyed by normalized ISIN (5 min).
//   * In-flight deduplication: concurrent requests for the same ISIN
//     share one upstream fetch rather than fanning out independently.
//   * Periodic eviction of stale rate-limit buckets to prevent unbounded
//     memory growth from spoofed IPs (runs every 5 min).
// All state is process-local; restarts clear it.
// ----------------------------------------------------------------------------

import { Router, type IRouter } from "express";
import { scrapePreview, PreviewError, type PreviewResult } from "../lib/etf-scrape";
import {
  scrapeLookthrough,
  type ScrapedLookthrough,
} from "../lib/lookthrough-scrape";
const router: IRouter = Router();

// ----- in-memory TTL cache --------------------------------------------------
const CACHE_TTL_MS = 5 * 60 * 1000;
const previewCache = new Map<string, { at: number; payload: unknown }>();

// ----- per-IP token bucket --------------------------------------------------
const RL_CAPACITY = 10;
const RL_REFILL_MS = 6_000; // 1 token every 6s → 10 / minute steady state
// A bucket is fully recharged after RL_CAPACITY refill intervals.
const RL_FULL_RECHARGE_MS = RL_CAPACITY * RL_REFILL_MS;
const buckets = new Map<string, { tokens: number; last: number }>();

function takeToken(ip: string): boolean {
  const now = Date.now();
  const b = buckets.get(ip) ?? { tokens: RL_CAPACITY, last: now };
  // Refill based on elapsed time.
  const refill = Math.floor((now - b.last) / RL_REFILL_MS);
  if (refill > 0) {
    b.tokens = Math.min(RL_CAPACITY, b.tokens + refill);
    b.last = now;
  }
  if (b.tokens <= 0) {
    buckets.set(ip, b);
    return false;
  }
  b.tokens -= 1;
  buckets.set(ip, b);
  return true;
}

// Evict fully-recharged bucket entries so the map cannot grow without bound
// even when an attacker cycles through many source addresses.
function evictStaleBuckets(): void {
  const now = Date.now();
  for (const [ip, b] of buckets) {
    if (b.tokens >= RL_CAPACITY && now - b.last > RL_FULL_RECHARGE_MS) {
      buckets.delete(ip);
    }
  }
}

const BUCKET_EVICTION_INTERVAL_MS = 5 * 60 * 1000;
const evictionTimer = setInterval(evictStaleBuckets, BUCKET_EVICTION_INTERVAL_MS);
evictionTimer.unref(); // Don't prevent process exit.

// ----- in-flight deduplication ----------------------------------------------
// Concurrent requests for the same ISIN share a single upstream fetch.
// The promise is removed from the map once it settles (success or error).
const inFlight = new Map<string, Promise<PreviewResult>>();

// ----- timeout wrapper with abort -------------------------------------------
const SCRAPE_TIMEOUT_MS = 8_000;

function scrapeWithDeadline(isin: string): Promise<PreviewResult> {
  const controller = new AbortController();
  const { signal } = controller;

  const timer = setTimeout(() => controller.abort(), SCRAPE_TIMEOUT_MS);

  return scrapePreview(isin, signal).then(
    (result) => {
      clearTimeout(timer);
      return result;
    },
    (err) => {
      clearTimeout(timer);
      // Translate an AbortError into a recognisable 504.
      if (signal.aborted && !(err instanceof PreviewError)) {
        throw new PreviewError(
          504,
          "upstream_timeout",
          `Upstream scrape exceeded ${SCRAPE_TIMEOUT_MS} ms`,
        );
      }
      throw err;
    },
  );
}

// ----------------------------------------------------------------------------
// Task #238 — public on-demand look-through scrape
// ----------------------------------------------------------------------------
// GET /api/lookthrough-scrape/:isin returns the justETF look-through
// data (geo + sector + currency + top holdings) for an arbitrary ISIN.
// Used by the Explain tab when the user pastes an off-catalog manual
// ISIN — without a profile, that position would silently drop out of
// every look-through aggregate. The client registers the response in
// its in-memory `RUNTIME_PROFILES` registry (see
// `lookthrough.ts#registerRuntimeLookthroughProfile`) so the next
// `buildLookthrough` call sees a usable profile and the destructive
// "unmapped ETFs" alert clears for that row.
//
// Read-only — never writes to disk, no DB, no PR. Reuses the same
// per-IP rate limiter, in-memory cache and in-flight dedup as
// /etf-preview to bound abuse of the upstream scraper.
// ----------------------------------------------------------------------------
const lookthroughCache = new Map<string, { at: number; payload: unknown }>();
const lookthroughInFlight = new Map<string, Promise<ScrapedLookthrough>>();
const LOOKTHROUGH_TIMEOUT_MS = 12_000;

function scrapeLookthroughWithDeadline(isin: string): Promise<ScrapedLookthrough> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      reject(
        new PreviewError(
          504,
          "upstream_timeout",
          `Look-through scrape exceeded ${LOOKTHROUGH_TIMEOUT_MS} ms`,
        ),
      );
    }, LOOKTHROUGH_TIMEOUT_MS);
    scrapeLookthrough(isin).then(
      (r) => {
        clearTimeout(t);
        resolve(r);
      },
      (err) => {
        clearTimeout(t);
        reject(err);
      },
    );
  });
}

router.get("/lookthrough-scrape/:isin", async (req, res) => {
  const ip = req.ip ?? req.socket.remoteAddress ?? "unknown";
  if (!takeToken(ip)) {
    res.status(429).json({
      error: "rate_limited",
      message: "Too many look-through scrape requests. Try again in a minute.",
    });
    return;
  }
  const cacheKey = String(req.params.isin || "").toUpperCase();
  if (!/^[A-Z]{2}[A-Z0-9]{9}\d$/.test(cacheKey)) {
    res.status(400).json({ error: "invalid_isin", message: "Malformed ISIN." });
    return;
  }
  const cached = lookthroughCache.get(cacheKey);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    res.json(cached.payload);
    return;
  }
  let pending = lookthroughInFlight.get(cacheKey);
  if (!pending) {
    pending = scrapeLookthroughWithDeadline(cacheKey).then(
      (r) => {
        lookthroughCache.set(cacheKey, { at: Date.now(), payload: r });
        lookthroughInFlight.delete(cacheKey);
        return r;
      },
      (err) => {
        lookthroughInFlight.delete(cacheKey);
        throw err;
      },
    );
    lookthroughInFlight.set(cacheKey, pending);
  }
  try {
    const result = await pending;
    // Task #238: hard-block scrape responses that don't carry the
    // minimum geo + sector — without those the client-side runtime
    // PROFILES merge would still drop the position into "unmapped".
    // 422 lets the client surface a clear pre-add failure instead of
    // silently registering an empty profile.
    const haveGeoSector =
      !!result.geo && Object.keys(result.geo).length > 0 &&
      !!result.sector && Object.keys(result.sector).length > 0;
    if (!haveGeoSector) {
      res.status(422).json({
        error: "lookthrough_incomplete",
        message: `justETF lieferte keine Geo-/Sektor-Daten für ${cacheKey}. Position kann nicht ohne Look-through-Profil zur Analyse hinzugefügt werden.`,
        isin: cacheKey,
        scraped: {
          hasGeo: !!result.geo && Object.keys(result.geo).length > 0,
          hasSector: !!result.sector && Object.keys(result.sector).length > 0,
          hasTopHoldings: !!result.topHoldings && result.topHoldings.length > 0,
          hasCurrency: !!result.currency,
        },
      });
      return;
    }
    // Task #238 round 4 — this public endpoint is strictly read-only.
    // We deliberately do NOT persist the scraped profile from here:
    // a public, unauthenticated route must never gain a write side
    // effect onto the curated catalog (would be an admin-boundary
    // bypass; see threat_model.md "Elevation of Privilege"). Persisting
    // off-catalog ISINs into the pool is an explicit operator action via
    // the admin route (POST /api/admin/lookthrough-pool, requireAdmin).
    res.json(result);
  } catch (err) {
    if (err instanceof PreviewError) {
      res.status(err.status).json({ error: err.code, message: err.message });
      return;
    }
    res.status(500).json({
      error: "internal",
      message: err instanceof Error ? err.message : "Unknown error",
    });
  }
});

router.get("/etf-preview/:isin", async (req, res) => {
  // req.ip is computed by Express from X-Forwarded-For using the
  // trust-proxy setting (app.set("trust proxy", 1) in app.ts). This
  // prevents clients from minting fresh buckets by supplying an
  // arbitrary leftmost X-Forwarded-For value.
  const ip = req.ip ?? req.socket.remoteAddress ?? "unknown";

  if (!takeToken(ip)) {
    res.status(429).json({
      error: "rate_limited",
      message: "Too many preview requests. Try again in a minute.",
    });
    return;
  }

  const cacheKey = String(req.params.isin || "").toUpperCase();
  const cached = previewCache.get(cacheKey);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    res.json(cached.payload);
    return;
  }

  // Deduplicate: attach to an in-flight request for this ISIN if one
  // already exists, otherwise start a new one.
  let pending = inFlight.get(cacheKey);
  if (!pending) {
    pending = scrapeWithDeadline(cacheKey).then(
      (result) => {
        previewCache.set(cacheKey, { at: Date.now(), payload: result });
        inFlight.delete(cacheKey);
        return result;
      },
      (err) => {
        inFlight.delete(cacheKey);
        throw err;
      },
    );
    inFlight.set(cacheKey, pending);
  }

  try {
    const result = await pending;
    res.json(result);
  } catch (err) {
    if (err instanceof PreviewError) {
      res.status(err.status).json({ error: err.code, message: err.message });
      return;
    }
    res.status(500).json({
      error: "internal",
      message: err instanceof Error ? err.message : "Unknown error",
    });
  }
});

export default router;
