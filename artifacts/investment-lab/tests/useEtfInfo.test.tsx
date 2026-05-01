// @vitest-environment jsdom
// ----------------------------------------------------------------------------
// useEtfInfo.test.tsx
// ----------------------------------------------------------------------------
// Locks in the stale-resolve guarantee for the manual-entry preview hook.
//
// Why this exists
// ---------------
// The hook fires a debounced /api/etf-preview/:isin lookup whenever the
// ISIN typed into a manual-entry row passes the format regex. If the
// operator types ISIN A and then quickly switches to ISIN B before A's
// fetch resolves, the LATE A response must NOT update the visible state
// — otherwise the preview card would briefly paint A's master data
// while the row is showing B, and the operator's "Use these values"
// click could write A's name/currency/TER into B's manualMeta.
//
// We pin the contract:
//   1. Switching ISIN mid-flight: late response from the previous ISIN
//      is dropped (epoch token mismatch + AbortController cancel).
//   2. Final committed scrape state belongs to the LAST ISIN typed.
// ----------------------------------------------------------------------------

import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useEtfInfo } from "../src/lib/useEtfInfo";

type FetchInput = Parameters<typeof fetch>[0];
type FetchInit = Parameters<typeof fetch>[1];

interface PendingRequest {
  isin: string;
  resolve: (body: unknown) => void;
  reject: (err: unknown) => void;
  signal: AbortSignal | undefined;
}

let pending: PendingRequest[] = [];
const originalFetch = globalThis.fetch;

function makeMockFetch() {
  return vi.fn(async (input: FetchInput, init?: FetchInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const m = /\/api\/etf-preview\/([A-Z0-9]+)/.exec(url);
    const isin = m ? m[1] : "";
    return new Promise<Response>((resolve, reject) => {
      const onAbort = () => {
        const err = new Error("aborted");
        (err as { name: string }).name = "AbortError";
        reject(err);
      };
      init?.signal?.addEventListener("abort", onAbort);
      pending.push({
        isin,
        resolve: (body: unknown) =>
          resolve(
            new Response(JSON.stringify(body), {
              status: 200,
              headers: { "content-type": "application/json" },
            }),
          ),
        reject,
        signal: init?.signal ?? undefined,
      });
    });
  });
}

beforeEach(() => {
  pending = [];
  globalThis.fetch = makeMockFetch() as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

const ISIN_A = "IE00B4L5Y983";
const ISIN_B = "LU0290355717";

describe("useEtfInfo — stale-resolve race", () => {
  it("drops a late response from the previous ISIN when the user switches mid-flight", async () => {
    const { result, rerender } = renderHook(({ isin }) => useEtfInfo(isin), {
      initialProps: { isin: ISIN_A },
    });

    // Wait past the 500ms debounce so fetch fires for A.
    await act(async () => {
      await wait(600);
    });
    expect(pending).toHaveLength(1);
    expect(pending[0].isin).toBe(ISIN_A);
    const reqA = pending[0];

    // Operator types ISIN B before A resolves. New effect must bump the
    // epoch token so A's late resolve is ignored.
    await act(async () => {
      rerender({ isin: ISIN_B });
    });

    // The cleanup AbortController fires on rerender; reqA's signal is
    // now aborted. Resolve A anyway — under the buggy (pre-epoch)
    // implementation this would commit A's payload onto a row that now
    // shows B. With the fix in place, both the AbortError swallow AND
    // the epoch-mismatch guard catch it.
    await act(async () => {
      reqA.resolve({
        isin: ISIN_A,
        fields: {
          name: "iShares Core MSCI World",
          currency: "USD",
          terBps: 20,
        },
      });
      await wait(20);
    });

    // No commit yet for B (still inside its own debounce window).
    // Scrape state is null and error is null — the swallowed AbortError
    // and the dropped late-A payload must not have leaked through.
    expect(result.current.scrape).toBeNull();
    expect(result.current.scrapeError).toBeNull();
    expect(result.current.scrapeLoading).toBe(true);

    // Wait past B's debounce so its fetch fires.
    await act(async () => {
      await wait(600);
    });
    // Pending may include the aborted A entry that was already resolved
    // earlier — find B's pending request rather than indexing by length.
    const reqB = pending.find((p) => p.isin === ISIN_B);
    expect(reqB).toBeDefined();

    await act(async () => {
      reqB!.resolve({
        isin: ISIN_B,
        fields: { name: "Lyxor Core MSCI Japan", currency: "EUR" },
      });
      await wait(20);
    });

    // Final committed state must belong to ISIN B, never the late A.
    expect(result.current.scrapeLoading).toBe(false);
    expect(result.current.scrape?.isin).toBe(ISIN_B);
    expect(result.current.scrape?.fields.name).toBe("Lyxor Core MSCI Japan");
    expect(result.current.scrapeError).toBeNull();
  });
});
