import type { ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { useAdminT } from "@/lib/admin-i18n";

export function AdvancedDisclosure({
  label,
  testid,
  children,
  defaultOpen = false,
}: {
  label?: string;
  testid?: string;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  const { t } = useAdminT();
  const heading = label ?? t({ de: "Erweitert", en: "Advanced" });
  return (
    <details
      className="group rounded-md border border-border bg-muted/20 px-3 py-2"
      data-testid={testid}
      {...(defaultOpen ? { open: true } : {})}
    >
      <summary className="cursor-pointer text-sm font-medium text-muted-foreground hover:text-foreground flex items-center gap-2 list-none">
        <ChevronDown className="h-3.5 w-3.5 transition-transform group-open:rotate-0 -rotate-90" />
        {heading}
      </summary>
      <div className="mt-3 space-y-2">{children}</div>
    </details>
  );
}
