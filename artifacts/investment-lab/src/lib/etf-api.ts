// ----------------------------------------------------------------------------
// etf-api.ts
// ----------------------------------------------------------------------------
// Tiny client for the public /api/etf-preview/:isin endpoint. Used by the
// Methodology "swap this bucket's ETF" dialog. No auth required — the
// endpoint returns publicly-available ETF metadata only.
// ----------------------------------------------------------------------------

function apiBase(): string {
  const env = (import.meta as { env?: Record<string, string | undefined> })
    .env;
  return env?.VITE_API_BASE_URL?.replace(/\/$/, "") ?? "";
}

export interface PublicPreviewResponse {
  isin: string;
  fields: Record<string, unknown>;
  listings: Record<string, { ticker?: string }> | null;
  policyFit: { aumOk: boolean; terOk: boolean; notes: string[] };
  sourceUrl: string;
}

export async function previewEtf(isin: string): Promise<PublicPreviewResponse> {
  const cleaned = isin.trim().toUpperCase();
  const res = await fetch(`${apiBase()}/api/etf-preview/${cleaned}`);
  if (!res.ok) {
    let body: { message?: string; error?: string } | null = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    throw new Error(
      body?.message ?? body?.error ?? `Preview failed (HTTP ${res.status})`,
    );
  }
  return (await res.json()) as PublicPreviewResponse;
}

// Task #238 — public look-through scrape, used by Explain when the
// user pastes an off-catalog manual ISIN. Returns a discriminated
// union so the caller can surface a clear error to the user when
// the scrape fails or returns incomplete data — silently dropping
// the row into the destructive "unmapped ETFs" alert is no longer
// acceptable per the task contract.
export interface ScrapedLookthroughResponse {
  isin: string;
  name?: string;
  topHoldings?: Array<{ name: string; pct: number }>;
  geo?: Record<string, number>;
  sector?: Record<string, number>;
  currency?: Record<string, number>;
  asOf: string;
  sourceUrl: string;
}

export type ScrapeLookthroughResult =
  | { ok: true; profile: ScrapedLookthroughResponse }
  | {
      ok: false;
      reason:
        | "invalid_isin"
        | "network_error"
        | "rate_limited"
        | "lookthrough_incomplete"
        | "scrape_failed";
      message: string;
    };

export async function scrapeLookthroughForIsin(
  isin: string,
): Promise<ScrapeLookthroughResult> {
  const cleaned = isin.trim().toUpperCase();
  if (!/^[A-Z]{2}[A-Z0-9]{9}\d$/.test(cleaned)) {
    return { ok: false, reason: "invalid_isin", message: "Malformed ISIN" };
  }
  let res: Response;
  try {
    res = await fetch(`${apiBase()}/api/lookthrough-scrape/${cleaned}`);
  } catch (err) {
    return {
      ok: false,
      reason: "network_error",
      message: err instanceof Error ? err.message : "Network request failed",
    };
  }
  if (res.status === 429) {
    return {
      ok: false,
      reason: "rate_limited",
      message: "Too many look-through scrape requests. Try again in a minute.",
    };
  }
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  if (!res.ok) {
    const errBody = body as { error?: string; message?: string } | null;
    if (errBody?.error === "lookthrough_incomplete") {
      return {
        ok: false,
        reason: "lookthrough_incomplete",
        message:
          errBody.message ??
          "justETF returned no geo/sector data for this ISIN.",
      };
    }
    return {
      ok: false,
      reason: "scrape_failed",
      message: errBody?.message ?? `Scrape failed (HTTP ${res.status})`,
    };
  }
  const payload = body as ScrapedLookthroughResponse | null;
  if (!payload || typeof payload !== "object") {
    return {
      ok: false,
      reason: "scrape_failed",
      message: "Empty response from scrape endpoint.",
    };
  }
  if (!payload.geo || Object.keys(payload.geo).length === 0) {
    return {
      ok: false,
      reason: "lookthrough_incomplete",
      message: "Scrape returned no geo data.",
    };
  }
  if (!payload.sector || Object.keys(payload.sector).length === 0) {
    return {
      ok: false,
      reason: "lookthrough_incomplete",
      message: "Scrape returned no sector data.",
    };
  }
  return { ok: true, profile: payload };
}
