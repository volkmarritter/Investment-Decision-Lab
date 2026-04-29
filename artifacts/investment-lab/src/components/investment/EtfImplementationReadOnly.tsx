import { Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useT } from "@/lib/i18n";
import type { ETFImplementation } from "@/lib/types";
import { EtfImplementationCommentCell } from "./EtfImplementationCommentCell";
import { ETFSnapshotFreshness } from "./SnapshotFreshness";

interface Props {
  etfs: ETFImplementation[];
  testIdPrefix?: string;
  onIsinClick?: (etf: ETFImplementation) => void;
}

export function EtfImplementationReadOnly({ etfs, testIdPrefix = "compare-etf", onIsinClick }: Props) {
  const { t } = useT();

  if (!etfs || etfs.length === 0) {
    return (
      <p className="text-sm text-muted-foreground italic">
        {t("compare.implementation.empty")}
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <div className="rounded-md border overflow-x-auto">
        <Table className="text-xs">
          <TableHeader>
            <TableRow>
              <TableHead className="whitespace-nowrap">{t("build.impl.col.assetClass")}</TableHead>
              <TableHead className="whitespace-nowrap text-right">{t("build.impl.col.weight")}</TableHead>
              <TableHead className="whitespace-nowrap">{t("build.impl.col.name")}</TableHead>
              <TableHead className="whitespace-nowrap font-mono">{t("build.impl.col.isin")}</TableHead>
              <TableHead className="whitespace-nowrap">{t("build.impl.col.ticker")}</TableHead>
              <TableHead className="whitespace-nowrap text-right">{t("build.impl.col.ter")}</TableHead>
              <TableHead className="whitespace-nowrap">{t("build.impl.col.domicile")}</TableHead>
              <TableHead className="whitespace-nowrap">{t("build.impl.col.replication")}</TableHead>
              <TableHead className="whitespace-nowrap">{t("build.impl.col.distribution")}</TableHead>
              <TableHead className="whitespace-nowrap">{t("build.impl.col.currency")}</TableHead>
              <TableHead className="min-w-[220px] max-w-[320px]">{t("build.impl.col.comment")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {etfs.map((etf, i) => {
              const hasAlternatives = !!etf.catalogKey && etf.selectableOptions.length > 1;
              const isAlternative = hasAlternatives && etf.selectedSlot > 0;
              return (
                <TableRow key={i} data-testid={`${testIdPrefix}-row-${etf.bucket}`}>
                  <TableCell>
                    <div className="font-medium flex items-center gap-1.5 flex-wrap">
                      {etf.assetClass}
                      {etf.isManualOverride && (
                        <Badge
                          variant="secondary"
                          className="text-[9px] px-1.5 py-0 h-4"
                          data-testid={`${testIdPrefix}-custom-badge-${etf.bucket}`}
                        >
                          {t("build.impl.manual.badge")}
                        </Badge>
                      )}
                    </div>
                    <div className="text-[10px] text-muted-foreground mt-0.5">
                      {etf.bucket.split(" - ")[1] ?? ""}
                    </div>
                  </TableCell>
                  <TableCell className="text-right font-mono">{etf.weight.toFixed(1)}%</TableCell>
                  <TableCell className="font-medium">
                    <div className="flex flex-col gap-0.5 min-w-0">
                      <span>{etf.exampleETF}</span>
                      {hasAlternatives && (
                        <Badge
                          variant={isAlternative ? "outline" : "secondary"}
                          className="text-[9px] px-1.5 py-0 h-4 self-start"
                          data-testid={`${testIdPrefix}-slot-badge-${etf.bucket}`}
                        >
                          {isAlternative
                            ? `${t("build.impl.picker.alt")} ${etf.selectedSlot}`
                            : t("build.impl.picker.default")}
                        </Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="font-mono whitespace-nowrap p-0">
                    {onIsinClick ? (
                      <button
                        type="button"
                        onClick={() => onIsinClick(etf)}
                        className="inline-flex items-center gap-1 px-2 py-1.5 -mx-2 -my-1.5 rounded hover:bg-muted/60 hover:text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-colors text-left"
                        data-testid={`${testIdPrefix}-isin-button-${etf.bucket}`}
                        title={t("build.impl.isin.openDetails")}
                        aria-label={`${t("build.impl.isin.openDetails")} — ${etf.isin}`}
                      >
                        <span>{etf.isin}</span>
                        <Search className="h-3 w-3 opacity-60 shrink-0" />
                      </button>
                    ) : (
                      <span className="px-2">{etf.isin}</span>
                    )}
                  </TableCell>
                  <TableCell className="font-mono whitespace-nowrap">
                    {etf.ticker}
                    {etf.exchange && etf.exchange !== "—" && (
                      <span className="text-muted-foreground"> ({etf.exchange})</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right font-mono">{(etf.terBps / 100).toFixed(2)}%</TableCell>
                  <TableCell className="whitespace-nowrap">{etf.domicile}</TableCell>
                  <TableCell className="whitespace-nowrap">{etf.replication}</TableCell>
                  <TableCell className="whitespace-nowrap">
                    {etf.distribution === "Accumulating"
                      ? t("build.impl.dist.acc")
                      : t("build.impl.dist.dist")}
                  </TableCell>
                  <TableCell className="font-mono">{etf.currency}</TableCell>
                  <TableCell className="text-muted-foreground min-w-[220px] max-w-[320px]">
                    {/* Curated `comment` always wins. When the catalog row
                        left the field blank (typically a look-through-only
                        ETF), fall back to the same auto-generated description
                        used in the Build tab's implementation table, the
                        look-through dialog, the ETF details popup and the
                        detailed PDF report so Compare doesn't render a blank
                        cell for those rows. Rendering is delegated to
                        <EtfImplementationCommentCell> so the fallback
                        behaviour stays pinned by the existing component-level
                        vitest. */}
                    <EtfImplementationCommentCell etf={etf} />
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
      <p className="text-[10px] text-muted-foreground italic">
        {t("build.impl.disclaimer")}
      </p>
      <ETFSnapshotFreshness />
    </div>
  );
}
