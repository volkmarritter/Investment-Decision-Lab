// ----------------------------------------------------------------------------
// MoreEtfsDialog
// ----------------------------------------------------------------------------
// Task #149 — per-bucket "extended universe" pool picker for the Build
// tab's ETF Implementation table. The inline Select keeps the curated
// default + alternatives (≤10); pool entries (≤50) live behind a
// "More ETFs (N)" button that opens this dialog.
//
// Selecting a pool entry re-uses the existing per-bucket selection
// channel (lib/etfSelection.ts): pool slots are indexed
// `altCount + 1 + poolIndex` so `setETFSelection(catalogKey, slot)`
// picks them up automatically and `getETFDetails()` resolves them to
// the right ETFRecord without any new override channel.
// ----------------------------------------------------------------------------

import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useT } from "@/lib/i18n";
import { setETFSelection } from "@/lib/etfSelection";
import type { ETFImplementation } from "@/lib/types";

type SelectableOption = ETFImplementation["selectableOptions"][number];

interface MoreEtfsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  bucket: string;
  catalogKey: string;
  // Pre-split: index into the unfiltered selectableOptions list so
  // setETFSelection() gets the right slot. Kept as the native list +
  // altCount so pool slot math stays local to this component.
  selectableOptions: ReadonlyArray<SelectableOption>;
  altCount: number;
  selectedSlot: number;
}

export function MoreEtfsDialog({
  open,
  onOpenChange,
  bucket,
  catalogKey,
  selectableOptions,
  altCount,
  selectedSlot,
}: MoreEtfsDialogProps) {
  const { t } = useT();
  const [query, setQuery] = useState("");

  // Pool entries are appended after default + alternatives in
  // selectableOptions. We surface their absolute slot (altCount+1+i)
  // so the row's selection round-trips through setETFSelection.
  const poolRows = useMemo(() => {
    const out: Array<{ option: SelectableOption; slot: number }> = [];
    selectableOptions.forEach((opt, idx) => {
      if (opt.kind === "pool") {
        out.push({ option: opt, slot: idx });
      }
    });
    return out;
  }, [selectableOptions]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return poolRows;
    return poolRows.filter(
      ({ option }) =>
        option.name.toLowerCase().includes(q) ||
        option.isin.toLowerCase().includes(q),
    );
  }, [poolRows, query]);

  function handlePick(slot: number) {
    setETFSelection(catalogKey, slot);
    onOpenChange(false);
    setQuery("");
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-lg"
        data-testid={`more-etfs-dialog-${bucket}`}
      >
        <DialogHeader>
          <DialogTitle>{t("build.impl.moreEtfs.title")}</DialogTitle>
          <DialogDescription>
            {t("build.impl.moreEtfs.desc")}
          </DialogDescription>
        </DialogHeader>
        <div className="relative">
          <Search className="absolute left-2 top-2.5 h-4 w-4 opacity-50" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("build.impl.moreEtfs.search")}
            className="pl-8 h-9"
            data-testid={`more-etfs-search-${bucket}`}
          />
        </div>
        <ScrollArea className="max-h-[360px] pr-2 -mr-2">
          <div className="space-y-1">
            {filtered.length === 0 ? (
              <div className="text-xs text-muted-foreground p-4 text-center">
                {t("build.impl.moreEtfs.empty")}
              </div>
            ) : (
              filtered.map(({ option, slot }) => {
                const isSelected = slot === selectedSlot;
                return (
                  <button
                    key={option.isin}
                    type="button"
                    onClick={() => handlePick(slot)}
                    className={
                      "w-full text-left rounded-md border px-3 py-2 hover:bg-muted/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-colors " +
                      (isSelected
                        ? "border-primary bg-primary/5"
                        : "border-border")
                    }
                    data-testid={`more-etfs-option-${bucket}-${option.isin}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex flex-col gap-0.5 min-w-0 flex-1">
                        <span className="text-xs font-medium truncate">
                          {option.name}
                        </span>
                        <span className="text-[10px] text-muted-foreground font-mono">
                          {option.isin} ·{" "}
                          {(option.terBps / 100).toFixed(2)}%{" "}
                          {t("build.impl.picker.terSuffix")}
                        </span>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        {option.distribution && (
                          <Badge
                            variant="outline"
                            className="text-[9px] px-1.5 py-0 h-4"
                          >
                            {option.distribution === "Accumulating"
                              ? t("build.impl.dist.acc")
                              : t("build.impl.dist.dist")}
                          </Badge>
                        )}
                        <Badge
                          variant="outline"
                          className="text-[9px] px-1.5 py-0 h-4 border-emerald-600 text-emerald-700 dark:text-emerald-400"
                        >
                          {t("build.impl.picker.pool")}
                        </Badge>
                      </div>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </ScrollArea>
        <div className="flex items-center justify-between gap-2">
          <span className="text-[10px] text-muted-foreground">
            {t("build.impl.moreEtfs.disclaimer")}
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
            data-testid={`more-etfs-close-${bucket}`}
          >
            {t("build.impl.moreEtfs.close")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
