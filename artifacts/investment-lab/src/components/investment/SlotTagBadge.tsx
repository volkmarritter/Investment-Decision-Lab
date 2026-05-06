import { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useT } from "@/lib/i18n";
import {
  slotBadgeClassName,
  slotBadgeVariant,
  type SlotKind,
} from "./etfSlotBadge";

interface SlotTagBadgeProps {
  kind: SlotKind;
  label: ReactNode;
  testId?: string;
}

export function SlotTagBadge({ kind, label, testId }: SlotTagBadgeProps) {
  const { t } = useT();
  const tooltipKey =
    kind === "default"
      ? "slotTag.tooltip.default"
      : kind === "alternative"
        ? "slotTag.tooltip.alternative"
        : "slotTag.tooltip.pool";
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span tabIndex={0} className="inline-flex">
          <Badge
            variant={slotBadgeVariant(kind)}
            className={slotBadgeClassName(kind)}
            data-testid={testId}
          >
            {label}
          </Badge>
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">{t(tooltipKey)}</TooltipContent>
    </Tooltip>
  );
}
