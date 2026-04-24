import * as React from "react";
import { Info } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

interface InfoHintProps {
  children: React.ReactNode;
  title?: string;
  side?: "top" | "right" | "bottom" | "left";
  align?: "start" | "center" | "end";
  className?: string;
  iconClassName?: string;
  ariaLabel?: string;
}

export function InfoHint({
  children,
  title,
  side = "top",
  align = "center",
  className,
  iconClassName,
  ariaLabel,
}: InfoHintProps) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "inline-flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors shrink-0 -m-1 p-1 rounded touch-manipulation",
            className,
          )}
          aria-label={ariaLabel ?? (title ? `Info: ${title}` : "More information")}
          onClick={(e) => e.stopPropagation()}
        >
          <Info className={cn("h-3.5 w-3.5", iconClassName)} />
        </button>
      </PopoverTrigger>
      <PopoverContent
        side={side}
        align={align}
        className="w-72 max-w-[calc(100vw-2rem)] text-xs leading-relaxed p-3"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        {title && <div className="font-semibold mb-1 text-sm">{title}</div>}
        <div className="text-muted-foreground">{children}</div>
      </PopoverContent>
    </Popover>
  );
}
