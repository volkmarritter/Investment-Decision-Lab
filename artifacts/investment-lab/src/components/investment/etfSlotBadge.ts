// ----------------------------------------------------------------------------
// etfSlotBadge.ts
// ----------------------------------------------------------------------------
// Pure helpers for the per-slot badge rendered next to the Build tab's ETF
// picker dropdown trigger and inside its dropdown items.
//
// Three visual classes:
//   • default      → neutral (Badge variant="secondary", no extra colour)
//   • alternative  → green   (variant="outline" + emerald border + emerald text)
//   • pool         → orange  (variant="outline" + orange border  + orange text)
//
// Slot index → kind mapping mirrors the engine's slot layout
// (see lib/etfSelection.ts):
//   • slot 0                                       → default
//   • slot 1..MAX_ALTERNATIVES_PER_BUCKET          → alternative
//   • slot MAX_ALTERNATIVES_PER_BUCKET+1..total    → pool
// We don't need to know the exact alt-vs-pool boundary up front because the
// per-option `kind` discriminator on `selectableOptions` already carries it.
// Slot 0 is treated as default unconditionally so the trailing badge stays
// stable even when an option's `kind` is missing.
// ----------------------------------------------------------------------------

export type SlotKind = "default" | "alternative" | "pool";

export function getSlotKind(
  options: ReadonlyArray<{ kind?: SlotKind }>,
  slotIndex: number,
): SlotKind {
  if (slotIndex === 0) return "default";
  const k = options[slotIndex]?.kind;
  return k === "pool" ? "pool" : "alternative";
}

const BADGE_BASE = "text-[9px] px-1.5 py-0 h-4 shrink-0";

export function slotBadgeClassName(kind: SlotKind): string {
  if (kind === "pool")
    return `${BADGE_BASE} border-orange-600 text-orange-700 dark:text-orange-400`;
  if (kind === "alternative")
    return `${BADGE_BASE} border-emerald-600 text-emerald-700 dark:text-emerald-400`;
  return BADGE_BASE;
}

export function slotBadgeVariant(kind: SlotKind): "secondary" | "outline" {
  return kind === "default" ? "secondary" : "outline";
}
