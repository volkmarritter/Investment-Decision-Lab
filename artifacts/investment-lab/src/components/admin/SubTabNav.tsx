// SubTabNav — route-driven tab strip used inside Catalog and Operations.

import { Link, useLocation } from "wouter";

export type SubTab = {
  to: string;
  label: string;
  testid: string;
};

export function SubTabNav({
  tabs,
  testid,
}: {
  tabs: SubTab[];
  testid: string;
}) {
  const [location] = useLocation();
  // Active = tab.to is a prefix of current location, longest match wins.
  const ranked = tabs
    .map((t) => ({
      tab: t,
      score: location === t.to || location === `${t.to}/` ? t.to.length + 1
        : location.startsWith(`${t.to}/`) ? t.to.length
        : 0,
    }))
    .sort((a, b) => b.score - a.score);
  const activeTo = ranked[0]?.score ? ranked[0].tab.to : tabs[0]?.to;

  return (
    <nav
      role="tablist"
      data-testid={testid}
      className="flex flex-wrap gap-1 border-b border-border"
    >
      {tabs.map((t) => {
        const active = t.to === activeTo;
        return (
          <Link
            key={t.to}
            href={t.to}
            role="tab"
            aria-selected={active}
            data-testid={t.testid}
            data-active={active ? "true" : "false"}
            className={[
              "px-3 py-2 text-sm rounded-t-md border-b-2 transition-colors",
              active
                ? "border-primary text-primary font-medium"
                : "border-transparent text-muted-foreground hover:text-foreground hover:border-muted",
            ].join(" ")}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
