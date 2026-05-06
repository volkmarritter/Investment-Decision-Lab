// Task #156 — small picker over INSTRUMENTS whose role is "unassigned"
// (registered in the catalog but not slotted into any bucket). Used by
// the Explain tab's "Manually entered (off-catalog)" rows so the user
// can attach metadata from a known instrument with one click instead of
// retyping name/currency/TER. ISINs already used elsewhere in the
// workspace are excluded so the same instrument can't be picked twice.
//
// Free-form ISIN typing (the existing `<Input>` next to this picker)
// continues to work for true off-catalog ISINs the user owns.

import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { listUnassignedInstruments, type InstrumentRecord } from "@/lib/etfs";
import { useT } from "@/lib/i18n";

export interface UnassignedInstrumentPickerProps {
  excludeIsins: ReadonlySet<string>;
  /**
   * The ISIN currently sitting in this row, if any. Always allowed in the
   * candidate list even when present in `excludeIsins` — same row-aware
   * pattern as `IsinPicker` (only OTHER rows' ISINs are blocked).
   */
  currentIsin?: string;
  onPick: (record: Readonly<InstrumentRecord>) => void;
  testId?: string;
}

export function UnassignedInstrumentPicker({
  excludeIsins,
  currentIsin,
  onPick,
  testId,
}: UnassignedInstrumentPickerProps) {
  const { t } = useT();
  const [open, setOpen] = useState(false);

  const all = useMemo(() => listUnassignedInstruments(), []);
  const candidates = useMemo(
    () => all.filter((r) => !excludeIsins.has(r.isin) || r.isin === currentIsin),
    [all, excludeIsins, currentIsin],
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-9 px-2 shrink-0"
          aria-label={t("explain.manual.unassigned.label")}
          data-testid={testId}
        >
          <Search className="h-3.5 w-3.5 mr-1" />
          <span className="text-xs">{t("explain.manual.unassigned.label")}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[420px] max-w-[calc(100vw-2rem)] p-0"
        align="start"
      >
        <Command
          filter={(itemValue, search) =>
            itemValue.toLowerCase().includes(search.toLowerCase()) ? 1 : 0
          }
        >
          <CommandInput
            placeholder={t("explain.manual.unassigned.search")}
            data-testid={testId ? `${testId}-search` : undefined}
          />
          <CommandList className="max-h-[320px]">
            <CommandEmpty>{t("explain.manual.unassigned.empty")}</CommandEmpty>
            {candidates.map((r) => (
              <CommandItem
                key={r.isin}
                value={`${r.isin}|${r.name}|${r.currency}|${r.domicile}`}
                onSelect={() => {
                  onPick(r);
                  setOpen(false);
                }}
                data-testid={`unassigned-option-${r.isin}`}
              >
                <div className="flex flex-col gap-0.5 min-w-0 flex-1">
                  <span className="text-xs font-medium truncate">{r.name}</span>
                  <span className="text-[11px] text-muted-foreground font-mono">
                    {r.isin} · {r.currency} · {(r.terBps / 100).toFixed(2)}% TER
                  </span>
                </div>
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
