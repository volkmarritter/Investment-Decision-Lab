// SectionHeader — title + description + optional primary action.

import type { ReactNode } from "react";

export function SectionHeader({
  title,
  description,
  primaryAction,
  testid,
}: {
  title: string;
  description: string;
  primaryAction?: ReactNode;
  testid?: string;
}) {
  return (
    <header
      className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 pb-2 border-b border-border"
      data-testid={testid}
    >
      <div className="space-y-1 min-w-0">
        <h2 className="text-xl font-semibold leading-tight">{title}</h2>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      {primaryAction && (
        <div className="flex-shrink-0">{primaryAction}</div>
      )}
    </header>
  );
}
