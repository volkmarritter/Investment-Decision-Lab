import type { AssetAllocation } from "@/lib/types";
import {
  summarizeAllocationByGroup,
  type AllocationGroup,
} from "@/lib/allocationGroups";
import { useT } from "@/lib/i18n";

const GROUP_COLOR: Record<AllocationGroup, string> = {
  Cash: "hsl(var(--chart-1))",
  Bonds: "hsl(var(--chart-2))",
  Equities: "hsl(var(--chart-3))",
  Satellites: "hsl(var(--chart-4))",
};

const GROUP_LABEL_KEY: Record<AllocationGroup, string> = {
  Cash: "groups.cash",
  Bonds: "groups.bonds",
  Equities: "groups.equities",
  Satellites: "groups.satellites",
};

interface Props {
  allocation: ReadonlyArray<AssetAllocation>;
  testIdPrefix?: string;
}

export function AllocationGroupSummary({ allocation, testIdPrefix }: Props) {
  const { t } = useT();
  const summary = summarizeAllocationByGroup(allocation);

  return (
    <div
      className="grid grid-cols-2 sm:grid-cols-4 gap-2"
      role="list"
      aria-label={t("groups.summary.aria")}
      data-testid={testIdPrefix ? `${testIdPrefix}-group-summary` : "group-summary"}
    >
      {summary.map(({ group, weight }) => (
        <div
          key={group}
          role="listitem"
          className="flex items-center gap-2 rounded-md border bg-muted/30 px-3 py-2"
          data-testid={
            testIdPrefix
              ? `${testIdPrefix}-group-summary-${group.toLowerCase()}`
              : `group-summary-${group.toLowerCase()}`
          }
        >
          <span
            aria-hidden
            className="inline-block h-2.5 w-2.5 rounded-sm shrink-0"
            style={{ backgroundColor: GROUP_COLOR[group] }}
          />
          <span className="text-xs text-muted-foreground truncate">
            {t(GROUP_LABEL_KEY[group])}
          </span>
          <span className="ml-auto text-sm font-semibold tabular-nums">
            {weight.toFixed(1)}%
          </span>
        </div>
      ))}
    </div>
  );
}
