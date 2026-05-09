import { Layers } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useT } from "@/lib/i18n";
import type { ETFImplementation } from "@/lib/types";

export function bucketEtfCounts(
  etfImplementation: ReadonlyArray<Pick<ETFImplementation, "bucket">> | undefined,
): Map<string, number> {
  const counts = new Map<string, number>();
  if (!etfImplementation) return counts;
  for (const e of etfImplementation) {
    if (!e.bucket) continue;
    counts.set(e.bucket, (counts.get(e.bucket) ?? 0) + 1);
  }
  return counts;
}

export function bucketKeyFor(assetClass: string, region: string): string {
  return `${assetClass} - ${region}`;
}

interface BlendedBucketBadgeProps {
  count: number;
  testId?: string;
}

export function BlendedBucketBadge({ count, testId }: BlendedBucketBadgeProps) {
  const { t, lang } = useT();
  if (count < 2) return null;
  const tooltip = t("blendedBucket.tooltip").replace("{count}", String(count));
  const aria =
    lang === "de"
      ? `Bucket gemischt aus ${count} ETFs`
      : `Bucket blended from ${count} ETFs`;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span tabIndex={0} className="inline-flex" aria-label={aria}>
          <Badge
            variant="secondary"
            className="gap-1 px-1.5 py-0 text-[10px] font-medium leading-4"
            data-testid={testId ?? "blended-bucket-badge"}
          >
            <Layers className="h-3 w-3" aria-hidden />
            {t("blendedBucket.badge").replace("{count}", String(count))}
          </Badge>
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">{tooltip}</TooltipContent>
    </Tooltip>
  );
}
