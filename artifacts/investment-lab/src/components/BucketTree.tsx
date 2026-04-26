// ----------------------------------------------------------------------------
// BucketTree.tsx
// ----------------------------------------------------------------------------
// Reusable, tree-shaped browser of the ETF catalog. Used by:
//   - Admin pane: each leaf copies its key into the catalog-key form input.
//   - Methodology tab: each leaf gets an "Override" button to swap the
//     underlying ETF locally (per-browser).
//
// The component is presentational — callers own the open/closed state and
// supply a `onLeafClick` (Admin's copy-to-form behaviour) and/or a
// `renderLeafAction` (Methodology's per-leaf action button).
// ----------------------------------------------------------------------------

import { ChevronDown, ChevronRight } from "lucide-react";
import type { CatalogSummary } from "@/lib/admin-api";

export interface BucketLeaf {
  key: string;
  name: string;
}

export interface BucketGroup {
  assetClass: string;
  label: string;
  entries: BucketLeaf[];
}

// Splits each catalog key on the first "-" and groups by the prefix.
// Within each group, entries are sorted alphabetically by full key — this
// naturally clusters variants together (e.g. Equity-USA, Equity-USA-CHF,
// Equity-USA-EUR, Equity-USA-Synthetic). Asset-class labels are humanised
// by inserting spaces before internal capitals (DigitalAssets → "Digital
// Assets", FixedIncome → "Fixed Income", RealEstate → "Real Estate").
export function groupCatalogByAssetClass(
  catalog: CatalogSummary | null,
): BucketGroup[] {
  if (!catalog) return [];
  const byClass = new Map<string, BucketLeaf[]>();
  for (const [key, entry] of Object.entries(catalog)) {
    const assetClass = key.split("-")[0] || "Other";
    const list = byClass.get(assetClass) ?? [];
    list.push({ key, name: entry.name });
    byClass.set(assetClass, list);
  }
  const groups: BucketGroup[] = [];
  for (const [assetClass, entries] of byClass) {
    entries.sort((a, b) => a.key.localeCompare(b.key));
    groups.push({
      assetClass,
      label: assetClass.replace(/([a-z])([A-Z])/g, "$1 $2"),
      entries,
    });
  }
  groups.sort((a, b) => a.label.localeCompare(b.label));
  return groups;
}

interface BucketTreeProps {
  groups: BucketGroup[];
  expanded: Set<string>;
  onToggleClass: (assetClass: string) => void;
  // Optional click handler on the leaf label itself (Admin uses this to
  // copy the key into the form). When omitted the label renders as a
  // non-interactive span.
  onLeafClick?: (leaf: BucketLeaf) => void;
  // Optional right-aligned per-leaf slot (Methodology uses this for the
  // "Override" / "Reset" buttons). Receives the leaf so the caller can
  // key per-bucket state.
  renderLeafAction?: (leaf: BucketLeaf) => React.ReactNode;
  // Optional badge slot rendered after the leaf name (e.g. "overridden").
  renderLeafBadge?: (leaf: BucketLeaf) => React.ReactNode;
  leafTitle?: string;
}

export function BucketTree({
  groups,
  expanded,
  onToggleClass,
  onLeafClick,
  renderLeafAction,
  renderLeafBadge,
  leafTitle,
}: BucketTreeProps) {
  return (
    <ul className="space-y-1" role="tree">
      {groups.map((g) => {
        const isOpen = expanded.has(g.assetClass);
        return (
          <li key={g.assetClass} role="treeitem" aria-expanded={isOpen}>
            <button
              type="button"
              onClick={() => onToggleClass(g.assetClass)}
              className="flex w-full items-center gap-2 rounded px-2 py-1 text-sm hover:bg-muted/50 focus:outline-none focus:ring-2 focus:ring-primary/40"
              data-testid={`tree-class-${g.assetClass}`}
            >
              {isOpen ? (
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              ) : (
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              )}
              <span className="font-medium">{g.label}</span>
              <span className="text-xs text-muted-foreground">
                {g.entries.length} bucket{g.entries.length === 1 ? "" : "s"}
              </span>
            </button>
            {isOpen && (
              <ul
                role="group"
                className="ml-3 mt-1 mb-2 border-l border-border pl-4 space-y-0.5"
              >
                {g.entries.map((e) => (
                  <li
                    key={e.key}
                    role="treeitem"
                    className="flex items-center justify-between gap-2 text-sm leading-snug"
                    data-testid={`bucket-row-${e.key}`}
                  >
                    {onLeafClick ? (
                      <button
                        type="button"
                        onClick={() => onLeafClick(e)}
                        className="text-left rounded px-1.5 py-0.5 hover:bg-muted/60 focus:outline-none focus:ring-2 focus:ring-primary/40"
                        title={leafTitle ?? "Click to copy this catalog key"}
                      >
                        <span className="font-mono text-xs text-primary">
                          {e.key}
                        </span>
                        <span className="text-muted-foreground"> — </span>
                        <span>{e.name}</span>
                        {renderLeafBadge?.(e)}
                      </button>
                    ) : (
                      <span className="px-1.5 py-0.5">
                        <span className="font-mono text-xs text-primary">
                          {e.key}
                        </span>
                        <span className="text-muted-foreground"> — </span>
                        <span>{e.name}</span>
                        {renderLeafBadge?.(e)}
                      </span>
                    )}
                    {renderLeafAction && (
                      <span className="shrink-0">{renderLeafAction(e)}</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </li>
        );
      })}
    </ul>
  );
}

// Small helper above the tree: lets the user expand or collapse all
// asset-class nodes at once instead of clicking through each chevron.
export function BucketTreeBulkToggle({
  groups,
  expanded,
  onChange,
}: {
  groups: BucketGroup[];
  expanded: Set<string>;
  onChange: (next: Set<string>) => void;
}) {
  const allOpen = groups.length > 0 && expanded.size === groups.length;
  const handle = () => {
    if (allOpen) {
      onChange(new Set());
    } else {
      onChange(new Set(groups.map((g) => g.assetClass)));
    }
  };
  return (
    <button
      type="button"
      onClick={handle}
      className="text-xs text-primary hover:underline whitespace-nowrap"
      data-testid="button-tree-bulk-toggle"
    >
      {allOpen ? "Collapse all" : "Expand all"}
    </button>
  );
}
