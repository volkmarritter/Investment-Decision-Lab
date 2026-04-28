// ----------------------------------------------------------------------------
// admin-api.ts
// ----------------------------------------------------------------------------
// Tiny client for /api/admin/* endpoints. Bearer token is loaded from
// sessionStorage (cleared when the tab closes) — slightly safer than
// localStorage given the token unlocks PR-creation. The user re-enters it
// on each new tab.
// ----------------------------------------------------------------------------

const TOKEN_KEY = "investment-lab.admin-token";

// Resolve API base from Vite envs. The api-server's mount prefix is `/api`.
// When running behind the workspace proxy, both artifacts are reachable on
// the same host, so a relative URL works in dev and prod.
function apiBase(): string {
  // VITE_API_BASE_URL is set in artifact.toml when the api-server is on a
  // different origin; otherwise we fall back to relative paths.
  const env = (import.meta as { env?: Record<string, string | undefined> })
    .env;
  return env?.VITE_API_BASE_URL?.replace(/\/$/, "") ?? "";
}

export function getToken(): string | null {
  try {
    return sessionStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string): void {
  try {
    sessionStorage.setItem(TOKEN_KEY, token);
  } catch {
    // sessionStorage may be unavailable in private mode — caller falls
    // back to in-memory state via React state.
  }
}

export function clearToken(): void {
  try {
    sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    // ignore
  }
}

async function call<T>(
  path: string,
  init: RequestInit & { token?: string } = {},
): Promise<T> {
  const token = init.token ?? getToken();
  const res = await fetch(`${apiBase()}/api${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers ?? {}),
    },
  });
  if (res.status === 401) {
    clearToken();
    throw new Error("Unauthorized — please re-enter the admin token.");
  }
  if (res.status === 503) {
    const body = await safeJson(res);
    throw new Error(
      body?.message ??
        "Admin pane is not configured (set ADMIN_TOKEN on the api-server).",
    );
  }
  if (!res.ok) {
    const body = await safeJson(res);
    throw new Error(body?.message ?? body?.error ?? `HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}

async function safeJson(
  res: Response,
): Promise<Record<string, string> | null> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

// ---- Endpoint shapes -------------------------------------------------------

export interface ChangeEntry {
  ts: string;
  source: string;
  isin: string;
  field: string;
  before: unknown;
  after: unknown;
}

export interface RunLogRow {
  [column: string]: string;
}

export interface FreshnessResponse {
  etfsOverrides: { lastRefreshedAt?: string; lastRefreshedMode?: string } | null;
  lookthroughOverrides: { lastRefreshedAt?: string } | null;
  schedules: Record<string, string>;
}

export interface PreviewResponse {
  isin: string;
  fields: Record<string, unknown>;
  listings: Record<string, { ticker?: string }> | null;
  policyFit: { aumOk: boolean; terOk: boolean; notes: string[] };
  sourceUrl: string;
}

export interface AddEtfRequest {
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

// Mirrors CatalogEntrySummary from artifacts/api-server/src/lib/catalog-parser.ts.
// Listings/aum/inception are optional in the static catalog source — the
// renderer fills them in from the override layer at runtime.
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
  // Curated alternatives surfaced by the per-bucket picker (2026-04-28).
  // Capped at 2 by validateCatalog. Only the /admin/bucket-alternatives
  // endpoint populates this; the regular /admin/catalog endpoint also now
  // returns it (the parser was extended) but legacy admin views ignore it.
  alternatives?: AlternativeEntrySummary[];
}

// Mirrors AlternativeEntrySummary on the server. Same shape as
// CatalogEntrySummary minus `key` (alternatives are positional) and
// minus `alternatives` (no nesting; alternatives don't have alternatives).
export interface AlternativeEntrySummary {
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

// Mirrors NewAlternativeEntry on the server. Same shape as AddEtfRequest
// minus `key`.
export interface AddBucketAlternativeRequest {
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

export const adminApi = {
  whoami: (token?: string) =>
    call<{
      ok: boolean;
      githubConfigured: boolean;
      githubOwner: string | null;
      githubRepo: string | null;
      githubBaseBranch: string;
    }>("/admin/whoami", {
      token,
    }),
  changes: (limit = 50) =>
    call<{ entries: ChangeEntry[]; total: number }>(
      `/admin/changes?limit=${limit}`,
    ),
  runLog: (limit = 20) =>
    call<{ rows: RunLogRow[]; total: number }>(`/admin/run-log?limit=${limit}`),
  freshness: () => call<FreshnessResponse>("/admin/freshness"),
  preview: (isin: string) =>
    call<PreviewResponse>("/admin/preview-isin", {
      method: "POST",
      body: JSON.stringify({ isin }),
    }),
  catalog: () => call<{ entries: CatalogSummary }>("/admin/catalog"),
  renderEntry: (entry: AddEtfRequest) =>
    call<{ code: string }>("/admin/render-entry", {
      method: "POST",
      body: JSON.stringify({ entry }),
    }),
  addIsin: (entry: AddEtfRequest) =>
    call<{ ok: boolean; prUrl: string; prNumber: number }>("/admin/add-isin", {
      method: "POST",
      body: JSON.stringify({ entry }),
    }),
  lookthroughPool: () =>
    call<{ entries: LookthroughPoolEntry[] }>("/admin/lookthrough-pool"),
  addLookthroughPoolIsin: (isin: string) =>
    call<{
      ok: boolean;
      isin: string;
      topHoldingCount: number;
      geoCount: number;
      sectorCount: number;
      asOf: string;
      sourceUrl: string;
      // PR-basiert seit 2026-04-27: der Schreibpfad öffnet einen
      // GitHub-PR statt direkt auf Disk zu schreiben (vorher ephemer +
      // unsichtbar fürs Frontend). Beide Felder sind nach erfolgreichem
      // POST garantiert vorhanden.
      prUrl: string;
      prNumber: number;
      note: string;
    }>(`/admin/lookthrough-pool/${encodeURIComponent(isin)}`, {
      method: "POST",
    }),
  // Bulk-Backfill: scannt den Katalog nach ISINs ohne Look-through-Daten
  // (weder in `overrides` noch im `pool`), scrapet jede einzeln und öffnet
  // EINEN gemeinsamen PR. Long-running (~1-2 min für 15-20 ISINs).
  backfillLookthroughPool: () =>
    call<{
      ok: boolean;
      scanned: number;
      missing: number;
      attempted: string[];
      added: string[];
      skippedAlreadyPresent: string[];
      scrapeFailures: Array<{ isin: string; reason: string }>;
      prUrl?: string;
      prNumber?: number;
    }>("/admin/backfill-lookthrough-pool", { method: "POST" }),
  // Global defaults editor (RF rates, Home-Bias, CMA). GET returns the
  // currently-shipped JSON; POST validates the payload server-side and
  // opens a GitHub PR replacing app-defaults.json. After merge + redeploy
  // the values become the ship-wide defaults for ALL users.
  getAppDefaults: () =>
    call<{ value: AppDefaultsPayload; raw: string }>("/admin/app-defaults"),
  proposeAppDefaultsPr: (value: AppDefaultsPayload, summary: string) =>
    call<{ ok: boolean; prUrl: string; prNumber: number }>(
      "/admin/app-defaults",
      {
        method: "POST",
        body: JSON.stringify({ value, summary }),
      },
    ),
  // Per-bucket curated alternatives editor (2026-04-28). Mirrors the
  // catalog/renderEntry/addIsin trio above but writes into an existing
  // bucket's `alternatives:[…]` array (creating the field if absent)
  // instead of inserting a top-level entry.
  bucketAlternatives: () =>
    call<{ entries: CatalogSummary }>("/admin/bucket-alternatives"),
  renderBucketAlternative: (parentKey: string, entry: AddBucketAlternativeRequest) =>
    call<{ code: string }>("/admin/bucket-alternatives/render", {
      method: "POST",
      body: JSON.stringify({ parentKey, entry }),
    }),
  // Adds a curated alternative under `parentKey`. The server opens TWO
  // PRs (best-effort): one against etfs.ts (always) and one against
  // lookthrough.overrides.json (only if justETF returns complete data).
  // The look-through PR is non-blocking — if scraping fails the etfs PR
  // still goes through and `lookthroughError` carries the explanation.
  addBucketAlternative: (parentKey: string, entry: AddBucketAlternativeRequest) =>
    call<{
      ok: boolean;
      prUrl: string;
      prNumber: number;
      lookthroughPrUrl?: string;
      lookthroughPrNumber?: number;
      // Distinct positive signal: the ISIN is already covered by
      // look-through data (in the curated overrides, the auto-refresh
      // pool, or the base file we PR against). No second PR was opened
      // because none was needed — render this as success, not as an
      // error/skip.
      lookthroughAlreadyPresent?: boolean;
      lookthroughAlreadyPresentSource?: "overrides" | "pool" | "base-file";
      // Genuine problems (scrape failed, scrape returned incomplete
      // data, GitHub call threw). The etfs PR still succeeded — this is
      // only about the optional second PR.
      lookthroughError?: string;
    }>(
      "/admin/bucket-alternatives",
      {
        method: "POST",
        body: JSON.stringify({ parentKey, entry }),
      },
    ),
  // Removes a curated alternative from `parentKey` via PR. The
  // per-ISIN look-through profile in lookthrough.overrides.json is
  // intentionally NOT touched — operators can re-attach the same ISIN
  // later (or reference it from a different bucket) without losing the
  // expensive scrape data.
  removeBucketAlternative: (parentKey: string, isin: string) =>
    call<{ ok: boolean; prUrl: string; prNumber: number }>(
      `/admin/bucket-alternatives/${encodeURIComponent(parentKey)}/${encodeURIComponent(isin)}`,
      { method: "DELETE" },
    ),
  // Lists currently-open PRs on the configured GitHub repo, optionally
  // scoped to a single admin flow via branch prefix:
  //   "add-lookthrough-pool/" | "add-etf/" | "update-app-defaults/" | "add-alt/"
  // Uses the REST list-pulls endpoint server-side (NOT the search API)
  // so it is unaffected by GitHub's occasional search-index lag.
  listOpenPrs: (prefix?: string) => {
    const qs = prefix ? `?prefix=${encodeURIComponent(prefix)}` : "";
    return call<{
      configured: boolean;
      prs: OpenPrInfo[];
      message?: string;
    }>(`/admin/github/prs${qs}`);
  },
};

export interface OpenPrInfo {
  number: number;
  url: string;
  title: string;
  headRef: string;
  createdAt: string;
  draft: boolean;
}

// Mirrors the validated payload shape from artifacts/api-server/src/lib/app-defaults.ts.
// Keep in sync with that file's exports.
export type AppDefaultsRfCurrency = "USD" | "EUR" | "GBP" | "CHF";
export type AppDefaultsHbCurrency = "USD" | "EUR" | "GBP" | "CHF";
export type AppDefaultsAssetKey =
  | "equity_us"
  | "equity_eu"
  | "equity_uk"
  | "equity_ch"
  | "equity_jp"
  | "equity_em"
  | "equity_thematic"
  | "bonds"
  | "cash"
  | "gold"
  | "reits"
  | "crypto";

export interface AppDefaultsPayload {
  _meta?: {
    lastUpdated?: string | null;
    lastUpdatedBy?: string | null;
    comment?: string | null;
  };
  riskFreeRates?: Partial<Record<AppDefaultsRfCurrency, number>>;
  homeBias?: Partial<Record<AppDefaultsHbCurrency, number>>;
  cma?: Partial<
    Record<AppDefaultsAssetKey, { expReturn?: number; vol?: number }>
  >;
}

export interface LookthroughPoolEntry {
  isin: string;
  // Quelle des Eintrags innerhalb von lookthrough.overrides.json:
  //   "overrides" = manuell kuratierte Baseline (Repo-eingecheckt),
  //   "pool"      = vom monatlichen Refresh-Job geschriebene Live-Daten,
  //   "both"      = ISIN existiert in beiden Sektionen (pool gewinnt
  //                 inhaltlich, weil frischer).
  source: "overrides" | "pool" | "both";
  // Offizieller ETF-Name vom justETF-Profilkopf, persistiert beim Scrape.
  // null für Pool-Einträge die vor Einführung des Name-Felds (2026-04-27)
  // geschrieben wurden — der monatliche Refresh-Job backfillt sie auf
  // dem nächsten Lauf. Für overrides-only-Einträge meist null, weil dort
  // der Katalog (etfs.ts) den Namen liefert.
  name: string | null;
  topHoldingsAsOf: string | null;
  breakdownsAsOf: string | null;
  topHoldingCount: number;
  geoCount: number;
  sectorCount: number;
}
