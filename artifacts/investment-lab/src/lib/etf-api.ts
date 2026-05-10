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
