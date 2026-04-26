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
//     1 req every 6 s).
//   * 8-second timeout on the underlying scrape (raceable).
//   * Short in-memory TTL cache keyed by normalized ISIN (5 min).
// All state is process-local; restarts clear it.
// ----------------------------------------------------------------------------

import { Router, type IRouter } from "express";
import { scrapePreview, PreviewError } from "../lib/etf-scrape";

const router: IRouter = Router();

// ----- in-memory TTL cache --------------------------------------------------
const CACHE_TTL_MS = 5 * 60 * 1000;
const previewCache = new Map<string, { at: number; payload: unknown }>();

// ----- per-IP token bucket --------------------------------------------------
const RL_CAPACITY = 10;
const RL_REFILL_MS = 6_000; // 1 token every 6s → 10 / minute steady state
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

// ----- timeout wrapper ------------------------------------------------------
const SCRAPE_TIMEOUT_MS = 8_000;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(
      () =>
        reject(
          new PreviewError(
            504,
            "upstream_timeout",
            `Upstream scrape exceeded ${ms} ms`,
          ),
        ),
      ms,
    );
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

router.get("/etf-preview/:isin", async (req, res) => {
  // Use the first hop in X-Forwarded-For if present (Replit proxy), else
  // fall back to the connection address.
  const ip =
    (req.headers["x-forwarded-for"]?.toString().split(",")[0]?.trim() ||
      req.ip ||
      req.socket.remoteAddress ||
      "unknown");

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

  try {
    const result = await withTimeout(
      scrapePreview(req.params.isin),
      SCRAPE_TIMEOUT_MS,
    );
    previewCache.set(cacheKey, { at: Date.now(), payload: result });
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
