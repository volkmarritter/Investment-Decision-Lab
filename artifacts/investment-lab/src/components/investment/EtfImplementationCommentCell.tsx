// ----------------------------------------------------------------------------
// EtfImplementationCommentCell
// ----------------------------------------------------------------------------
// Inline cell renderer for the Build tab's ETF Implementation table.
//
// The catalog row's curated `comment` always wins. When the catalog row
// left the field blank (typically a look-through-only ETF such as the
// Xtrackers MSCI World IT fund, IE00BM67HT60), we fall back to the same
// auto-generated description used in the ETF details dialog so operators
// scanning the implementation table can read the per-ETF summary inline
// without having to click into each row's detail dialog. The
// "auto-generated from look-through data" hint label keeps the curated
// and machine-assembled cases visually distinguishable at a glance.
//
// This component intentionally renders only the *contents* of the table
// cell (no <TableCell> wrapper, no styling classes that depend on the
// "compact" layout state) so that BuildPortfolio can keep owning the cell
// width / overflow rules while a small component-level vitest can mount
// the fallback in isolation. See `tests/etfImplementationCommentCell.test.tsx`.
// ----------------------------------------------------------------------------

import { describeEtf } from "@/lib/etfDescription";
import { profileFor } from "@/lib/lookthrough";
import { useT } from "@/lib/i18n";
import type { ETFImplementation } from "@/lib/types";

interface EtfImplementationCommentCellProps {
  etf: Pick<
    ETFImplementation,
    | "comment"
    | "exampleETF"
    | "isin"
    | "bucket"
    | "domicile"
    | "distribution"
    | "currency"
  >;
}

export function EtfImplementationCommentCell({
  etf,
}: EtfImplementationCommentCellProps) {
  const { t, lang } = useT();

  if (etf.comment && etf.comment.trim()) {
    return <>{etf.comment}</>;
  }

  const auto = describeEtf({
    name: etf.exampleETF,
    profile: profileFor(etf.isin),
    catalog: {
      domicile: etf.domicile,
      distribution: etf.distribution,
      currency: etf.currency,
    },
  });
  if (!auto) return null;

  return (
    <div
      className="space-y-1"
      data-testid={`etf-impl-auto-description-${etf.bucket}`}
    >
      <div className="italic">{lang === "de" ? auto.de : auto.en}</div>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground/70 not-italic">
        {t("etf.details.autoDescriptionHint")}
      </div>
    </div>
  );
}
