// Bridge between the Explain tab and the Compare tab.
//
// Two responsibilities, intentionally narrow:
//
//   1. A pub/sub channel for the *current* Explain workspace, so the Compare
//      tab can offer a "Load from Explain" button per slot that knows
//      whether there is anything to load. Mirrors the in-memory channels in
//      `settings.ts` (e.g. `setLastBuildInput`); fresh on every full page
//      reload, defensive copies at the boundary.
//
//   2. A one-shot request channel: when the user presses "Send to Compare"
//      from the Explain tab, we publish a `{ slot, workspace }` payload so
//      the Compare tab can install it into Slot A or Slot B. Compare
//      consumes the request once (`takePending…`) so a tab switch back to
//      Compare later doesn't replay an old request.
//
// A tiny `navigateToTab` helper completes the picture: ExplainPortfolio
// requests the load and then asks the parent shell to switch tabs by
// dispatching a custom event the InvestmentLab page listens for. We avoid
// passing a navigation prop down through ExplainPortfolio so the parent
// signature stays unchanged.
//
// Loose boundary types (`unknown`, `Record<string, unknown>`) keep this
// module free of import cycles with `lib/types` and the Explain workspace
// definition; consumers re-cast at the call site.

import type { ExplainWorkspace } from "./savedExplainPortfolios";
import type {
  AssetAllocation,
  ETFImplementation,
  PortfolioInput,
  PortfolioOutput,
} from "./types";
import { synthesizePersonalPortfolio } from "./personalPortfolio";
import { defaultExchangeFor } from "./exchange";
import type { Lang } from "./i18n";
import {
  ALL_BUCKET_KEYS,
  BUCKET_META_CACHE,
  getBucketKeyForIsin,
} from "./etfs";

// ---------------------------------------------------------------------------
// Channel 1: current Explain workspace
// ---------------------------------------------------------------------------

const LAST_EXPLAIN_WORKSPACE_EVENT = "idl-last-explain-workspace-changed";
let lastExplainWorkspace: ExplainWorkspace | null = null;

export function setLastExplainWorkspace(ws: ExplainWorkspace | null): void {
  if (typeof window === "undefined") return;
  lastExplainWorkspace = ws ? cloneWorkspace(ws) : null;
  window.dispatchEvent(
    new CustomEvent(LAST_EXPLAIN_WORKSPACE_EVENT, {
      detail: lastExplainWorkspace,
    }),
  );
}

export function getLastExplainWorkspace(): ExplainWorkspace | null {
  return lastExplainWorkspace ? cloneWorkspace(lastExplainWorkspace) : null;
}

export function subscribeLastExplainWorkspace(
  cb: (ws: ExplainWorkspace | null) => void,
): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = (e: Event) => {
    const detail = (e as CustomEvent).detail as ExplainWorkspace | null;
    cb(detail ? cloneWorkspace(detail) : null);
  };
  window.addEventListener(LAST_EXPLAIN_WORKSPACE_EVENT, handler);
  return () => window.removeEventListener(LAST_EXPLAIN_WORKSPACE_EVENT, handler);
}

// ---------------------------------------------------------------------------
// Channel 2: one-shot "send to compare" request
// ---------------------------------------------------------------------------

export type CompareSlotName = "A" | "B";

export interface CompareLoadRequest {
  slot: CompareSlotName;
  workspace: ExplainWorkspace;
}

const COMPARE_LOAD_EVENT = "idl-explain-to-compare-request";
let pendingRequest: CompareLoadRequest | null = null;

export function requestCompareLoadFromExplain(
  slot: CompareSlotName,
  workspace: ExplainWorkspace,
): void {
  if (typeof window === "undefined") return;
  pendingRequest = { slot, workspace: cloneWorkspace(workspace) };
  window.dispatchEvent(
    new CustomEvent(COMPARE_LOAD_EVENT, { detail: pendingRequest }),
  );
}

// Compare consumes the request once on subscription so a remount of
// ComparePortfolios (e.g. an HMR cycle) doesn't replay an old request,
// and so multi-tab switches don't keep re-firing it.
export function takePendingCompareLoadRequest(): CompareLoadRequest | null {
  const req = pendingRequest;
  pendingRequest = null;
  return req
    ? { slot: req.slot, workspace: cloneWorkspace(req.workspace) }
    : null;
}

export function subscribeCompareLoadRequests(
  cb: (req: CompareLoadRequest) => void,
): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = (e: Event) => {
    const detail = (e as CustomEvent).detail as CompareLoadRequest | null;
    if (!detail) return;
    pendingRequest = null;
    cb({ slot: detail.slot, workspace: cloneWorkspace(detail.workspace) });
  };
  window.addEventListener(COMPARE_LOAD_EVENT, handler);
  return () => window.removeEventListener(COMPARE_LOAD_EVENT, handler);
}

// ---------------------------------------------------------------------------
// Channel 3: one-shot "send to explain" request (Build → Explain, Task #175)
// ---------------------------------------------------------------------------
//
// Mirror of channels 1 + 2 above but in the opposite direction: the Build
// tab synthesises an `ExplainWorkspace` from its current `{input, output}`
// pair via `buildToExplainWorkspace` and dispatches it here. Explain
// drains it on mount/subscription via `takePendingExplainLoadRequest` so
// a tab switch back to Build doesn't replay an old request.

export interface ExplainLoadRequest {
  workspace: ExplainWorkspace;
}

const EXPLAIN_LOAD_EVENT = "idl-build-to-explain-request";
let pendingExplainRequest: ExplainLoadRequest | null = null;

export function requestExplainLoadFromBuild(workspace: ExplainWorkspace): void {
  if (typeof window === "undefined") return;
  pendingExplainRequest = { workspace: cloneWorkspace(workspace) };
  window.dispatchEvent(
    new CustomEvent(EXPLAIN_LOAD_EVENT, { detail: pendingExplainRequest }),
  );
}

export function takePendingExplainLoadRequest(): ExplainLoadRequest | null {
  const req = pendingExplainRequest;
  pendingExplainRequest = null;
  return req ? { workspace: cloneWorkspace(req.workspace) } : null;
}

export function subscribeExplainLoadRequests(
  cb: (req: ExplainLoadRequest) => void,
): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = (e: Event) => {
    const detail = (e as CustomEvent).detail as ExplainLoadRequest | null;
    if (!detail) return;
    pendingExplainRequest = null;
    cb({ workspace: cloneWorkspace(detail.workspace) });
  };
  window.addEventListener(EXPLAIN_LOAD_EVENT, handler);
  return () => window.removeEventListener(EXPLAIN_LOAD_EVENT, handler);
}

/**
 * Convert a Build-tab `{input, output}` pair into an Explain workspace.
 * Each ETFImplementation row becomes one PersonalPosition (catalog row;
 * `manualMeta` left undefined). Empty-isin rows or zero-weight rows are
 * dropped because they are never operator-set on Build (the engine always
 * picks a concrete instrument and weight). Workspace settings are copied
 * across with the simple field rename `includeCurrencyHedging` → `hedged`;
 * `riskAppetite`, `horizon`, `baseCurrency`, `lookThroughView` are 1:1.
 */
// Build a `${assetClass} - ${region}` → bucketKey lookup so rows whose
// `catalogKey` is null (off-catalog or stale) can still be placed in the
// correct Explain bucket via their human-readable bucket label. Built
// lazily to avoid a top-level circular-import hazard with `etfs.ts`.
let _bucketLabelToKey: Record<string, string> | null = null;
function bucketLabelToKey(label: string): string | null {
  if (!_bucketLabelToKey) {
    const m: Record<string, string> = {};
    // Multiple bucket keys can share the same `${assetClass} - ${region}`
    // label when hedged / synthetic variants exist (e.g. `Equity-USA` and
    // `Equity-USA-GBP` both decode to "Equity - USA"). Prefer the plain
    // (non-hedged, non-synthetic) variant so a generic Build row lands
    // in the canonical bucket.
    for (const k of ALL_BUCKET_KEYS) {
      const meta = BUCKET_META_CACHE[k];
      if (!meta) continue;
      const label = `${meta.assetClass} - ${meta.region}`;
      const isPlain = !meta.hedged && !meta.synthetic;
      if (isPlain || !(label in m)) {
        m[label] = k;
      }
    }
    _bucketLabelToKey = m;
  }
  return _bucketLabelToKey[label] ?? null;
}

export function buildToExplainWorkspace(
  input: PortfolioInput,
  output: PortfolioOutput,
): ExplainWorkspace {
  const positions = output.etfImplementation
    .filter((row) => !!row.isin && row.weight > 0)
    .map((row) => {
      // Prefer the engine-provided catalog key. When absent (off-catalog
      // or stale row), fall back to a label match against the catalog.
      // Last resort: ISIN→bucket lookup. Empty string means "Unassigned"
      // group in the Explain tree.
      let bucketKey = row.catalogKey ?? "";
      if (!bucketKey && row.bucket) {
        bucketKey = bucketLabelToKey(row.bucket) ?? "";
      }
      if (!bucketKey && row.isin) {
        bucketKey = getBucketKeyForIsin(row.isin) ?? "";
      }
      return { isin: row.isin, bucketKey, weight: row.weight };
    });
  return {
    v: 1,
    baseCurrency: input.baseCurrency,
    riskAppetite: input.riskAppetite,
    horizon: input.horizon,
    hedged: input.includeCurrencyHedging,
    lookThroughView: input.lookThroughView,
    positions,
  };
}

// ---------------------------------------------------------------------------
// Tab navigation helper
// ---------------------------------------------------------------------------
//
// InvestmentLab keeps tab state in sync with `?tab=`. To request a
// programmatic tab change from a child component without threading a
// callback through props, we push the URL ourselves and emit a custom
// event the page listens for. The page's existing `popstate` listener
// stays untouched.

const NAVIGATE_TAB_EVENT = "idl-navigate-tab";

export function navigateToTab(
  tab: "build" | "compare" | "explain" | "methodology",
  sectionHash?: string,
): void {
  if (typeof window === "undefined") return;
  let hashChanged = false;
  try {
    const url = new URL(window.location.href);
    if (tab === "build") {
      url.searchParams.delete("tab");
    } else {
      url.searchParams.set("tab", tab);
    }
    // Default behaviour: clear any stale section hash so e.g. switching
    // from Methodology back to Build doesn't leave `#tail-realism`
    // hanging in the URL. Callers that want to land on a specific
    // Methodology section pass `sectionHash` (without the leading `#`).
    const nextHash = sectionHash ? `#${sectionHash}` : "";
    url.hash = nextHash;
    if (
      url.pathname + url.search + url.hash !==
      window.location.pathname + window.location.search + window.location.hash
    ) {
      hashChanged = window.location.hash !== nextHash;
      window.history.pushState(null, "", url.toString());
    }
  } catch {
    /* ignore — the listener still picks up the event below */
  }
  window.dispatchEvent(new CustomEvent(NAVIGATE_TAB_EVENT, { detail: tab }));
  // Methodology's section accordion is driven by a `hashchange` listener;
  // pushState does NOT fire that event automatically, so we emit it here
  // when a section hash was requested. Without this, the tab would flip
  // to Methodology but the targeted accordion wouldn't open.
  if (sectionHash && hashChanged) {
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  }
}

export function subscribeNavigateTab(
  cb: (tab: "build" | "compare" | "explain" | "methodology") => void,
): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = (e: Event) => {
    const detail = (e as CustomEvent).detail;
    if (
      detail === "build" ||
      detail === "compare" ||
      detail === "explain" ||
      detail === "methodology"
    ) {
      cb(detail);
    }
  };
  window.addEventListener(NAVIGATE_TAB_EVENT, handler);
  return () => window.removeEventListener(NAVIGATE_TAB_EVENT, handler);
}

// ---------------------------------------------------------------------------
// Workspace -> Compare-slot conversion
// ---------------------------------------------------------------------------

export interface ExplainSlotPortfolio {
  input: PortfolioInput;
  output: PortfolioOutput;
}

/**
 * Synthesize a Compare-slot-ready `{ input, output }` pair from an Explain
 * workspace. The output uses the same `AssetAllocation`/`ETFImplementation`
 * shape Build emits (because `synthesizePersonalPortfolio` already does the
 * bucket roll-up), so all downstream Compare cards (PortfolioMetrics,
 * MonteCarloSimulation, FeeEstimator, GeoExposureMap, …) can consume it
 * unchanged.
 *
 * The derived `PortfolioInput` is intentionally minimal: it only carries
 * the fields the deep-dive cards on Compare actually read (baseCurrency,
 * horizon, includeCurrencyHedging, lookThroughView, etc.). The rest are
 * filled with safe defaults — the form column for an Explain-sourced slot
 * is replaced by a summary card, so these placeholder values are never
 * round-tripped through the Build engine.
 */
export function explainWorkspaceToSlotPortfolio(
  workspace: ExplainWorkspace,
  lang: Lang = "en",
): ExplainSlotPortfolio {
  const synth = synthesizePersonalPortfolio(
    // Task #174 — Cash sentinel rows have no ISIN by design but must
    // still contribute their weight to the slot's allocation, otherwise
    // a Cash-only or Cash-mixed Explain workspace silently loses its
    // cash slice when handed off to Compare. Mirror the same inclusion
    // rule used by Explain's own synthesizer call.
    workspace.positions.filter(
      (p) =>
        p.weight > 0 && (!!p.isin || p.bucketKey === "Cash"),
    ),
    workspace.baseCurrency,
    lang,
  );
  // Compute equity-style weight for the derived input so any downstream
  // sanity check that reads `targetEquityPct` lands close to reality.
  let equityPct = 0;
  for (const a of synth.allocation) {
    if (
      a.assetClass === "Equity" ||
      a.assetClass === "Real Estate" ||
      a.assetClass === "Digital Assets"
    ) {
      equityPct += a.weight;
    }
  }
  const allocation: AssetAllocation[] = synth.allocation.map((a) => ({ ...a }));
  const etfImplementation: ETFImplementation[] = synth.etfImplementation.map(
    (e) => ({ ...e }),
  );

  const input: PortfolioInput = {
    baseCurrency: workspace.baseCurrency,
    riskAppetite: workspace.riskAppetite,
    horizon: workspace.horizon,
    targetEquityPct: Math.round(equityPct),
    numETFs: etfImplementation.length || 1,
    numETFsMin: etfImplementation.length || 1,
    preferredExchange: defaultExchangeFor(workspace.baseCurrency),
    thematicPreference: "None",
    includeCurrencyHedging: workspace.hedged,
    includeSyntheticETFs: false,
    lookThroughView: workspace.lookThroughView,
    includeCrypto: false,
    includeListedRealEstate: false,
    includeCommodities: false,
  };

  const output: PortfolioOutput = {
    allocation,
    etfImplementation,
    rationale: [],
    risks: [],
    learning: [],
  };

  return { input, output };
}

/**
 * True when this workspace has at least one fully-specified position with
 * non-zero weight. The "Send to Compare" / "Load from Explain" buttons key
 * off this — there's nothing to compare against an empty workspace.
 */
export function explainWorkspaceHasContent(
  workspace: ExplainWorkspace | null,
): boolean {
  if (!workspace) return false;
  // Task #174 — a Cash sentinel row (bucketKey === "Cash", no ISIN)
  // is a fully-specified position too, even though it has no ISIN.
  return workspace.positions.some(
    (p) => p.weight > 0 && (!!p.isin || p.bucketKey === "Cash"),
  );
}

// ---------------------------------------------------------------------------
// internals
// ---------------------------------------------------------------------------

function cloneWorkspace(ws: ExplainWorkspace): ExplainWorkspace {
  return {
    v: 1,
    baseCurrency: ws.baseCurrency,
    riskAppetite: ws.riskAppetite,
    horizon: ws.horizon,
    hedged: ws.hedged,
    lookThroughView: ws.lookThroughView,
    positions: ws.positions.map((p) => ({
      isin: p.isin,
      bucketKey: p.bucketKey,
      weight: p.weight,
      ...(p.cashCurrency ? { cashCurrency: p.cashCurrency } : {}),
      ...(p.manualMeta ? { manualMeta: { ...p.manualMeta } } : {}),
    })),
  };
}
