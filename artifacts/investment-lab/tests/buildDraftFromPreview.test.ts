// ----------------------------------------------------------------------------
// buildDraftFromPreview.test.ts — Task #207 round-3 regression
// ----------------------------------------------------------------------------
// Pins the contract that the fast-track / SuggestIsin add panels carry
// the `commentSource` provenance from /admin/preview-isin into the
// AddEtfRequest / AddInstrumentRequest payload sent to /admin/add-isin
// or /admin/instruments. Before this fix the value was dropped at the
// client boundary, so persisted rows ended up tagged "manual" by
// stampSourceIfMissing() and the auto-refresh skipped them on the next
// scrape.
// ----------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import {
  buildDraftFromPreview,
  mergePreviewIntoAlternativeDraft,
  blankAlternativeDraft,
} from "../src/components/admin/shared";
import type { PreviewResponse } from "../src/lib/admin-api";

function preview(
  overrides: Partial<PreviewResponse["fields"]> = {},
): PreviewResponse {
  return {
    isin: "IE00B5BMR087",
    sourceUrl: "https://example.com",
    fields: {
      name: "iShares Core S&P 500 UCITS ETF",
      terBps: 7,
      domicile: "Ireland",
      replication: "Physical",
      distribution: "Accumulating",
      currency: "USD",
      description: "Tracks the S&P 500 Index.",
      ...overrides,
    },
    listings: { LSE: { ticker: "CSPX" } },
  } as unknown as PreviewResponse;
}

describe("buildDraftFromPreview — provenance propagation", () => {
  it("forwards commentSource:'justetf' from the preview into the draft", () => {
    const draft = buildDraftFromPreview(
      preview({ commentSource: "justetf" }),
    );
    expect(draft.commentSource).toBe("justetf");
    expect(draft.comment).toContain("S&P 500");
  });

  it("forwards commentSource:'auto' verbatim", () => {
    const draft = buildDraftFromPreview(preview({ commentSource: "auto" }));
    expect(draft.commentSource).toBe("auto");
  });

  it("omits commentSource when the preview did not annotate it", () => {
    const draft = buildDraftFromPreview(preview({}));
    expect(draft.commentSource).toBeUndefined();
  });

  it("omits commentSource for unknown values (defence in depth)", () => {
    const draft = buildDraftFromPreview(
      preview({ commentSource: "bogus" as unknown as string }),
    );
    expect(draft.commentSource).toBeUndefined();
  });
});

describe("mergePreviewIntoAlternativeDraft — provenance merge", () => {
  it("inherits 'justetf' from the preview when operator hasn't typed", () => {
    const merged = mergePreviewIntoAlternativeDraft(
      blankAlternativeDraft(),
      preview({ commentSource: "justetf" }),
    );
    expect(merged.commentSource).toBe("justetf");
  });

  it("preserves an operator-typed comment AND keeps existing source", () => {
    const current = {
      ...blankAlternativeDraft(),
      comment: "Operator's own description.",
      commentSource: "manual" as const,
    };
    const merged = mergePreviewIntoAlternativeDraft(
      current,
      preview({ commentSource: "justetf" }),
    );
    expect(merged.comment).toBe("Operator's own description.");
    expect(merged.commentSource).toBe("manual");
  });

  it("does not stamp commentSource when neither preview nor draft carries one", () => {
    const merged = mergePreviewIntoAlternativeDraft(
      blankAlternativeDraft(),
      preview({}),
    );
    expect(merged.commentSource).toBeUndefined();
  });
});
