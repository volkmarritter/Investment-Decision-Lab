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
}

export type CatalogSummary = Record<string, CatalogEntrySummary>;

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
};

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
  topHoldingsAsOf: string | null;
  breakdownsAsOf: string | null;
  topHoldingCount: number;
  geoCount: number;
  sectorCount: number;
}
