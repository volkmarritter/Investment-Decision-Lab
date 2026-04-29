// AdminLayout — header + sidebar shell shared by every /admin section.

import type { ReactNode } from "react";
import { Link, useLocation } from "wouter";
import {
  BarChart3,
  BookOpen,
  Layers,
  LogOut,
  Settings,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";
import { LangToggle } from "@/components/lang-toggle";
import { useAdminT } from "@/lib/admin-i18n";

type NavItem = {
  to: string;
  testid: string;
  icon: LucideIcon;
  de: string;
  en: string;
  matchPrefix?: string;
};

const NAV: NavItem[] = [
  {
    to: "/admin",
    testid: "link-admin-overview",
    icon: BarChart3,
    de: "Übersicht",
    en: "Overview",
  },
  {
    to: "/admin/catalog",
    testid: "link-admin-catalog",
    icon: Layers,
    de: "Katalog",
    en: "Catalog",
    matchPrefix: "/admin/catalog",
  },
  {
    to: "/admin/defaults",
    testid: "link-admin-defaults",
    icon: Settings,
    de: "Defaults",
    en: "Defaults",
    matchPrefix: "/admin/defaults",
  },
  {
    to: "/admin/operations",
    testid: "link-admin-operations",
    icon: Wrench,
    de: "Betrieb",
    en: "Operations",
    matchPrefix: "/admin/operations",
  },
  {
    to: "/admin/docs",
    testid: "link-admin-docs",
    icon: BookOpen,
    de: "Doku",
    en: "Docs",
    matchPrefix: "/admin/docs",
  },
];

export function AdminLayout({
  onSignOut,
  children,
}: {
  onSignOut: () => void;
  children: ReactNode;
}) {
  const { t } = useAdminT();
  const [location] = useLocation();

  const isActive = (item: NavItem): boolean => {
    if (item.matchPrefix) return location.startsWith(item.matchPrefix);
    return location === item.to || location === `${item.to}/`;
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-40 w-full border-b border-border bg-background/95 backdrop-blur">
        <div className="container mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="bg-primary/10 p-2 rounded-lg text-primary">
              <Layers className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-lg font-bold leading-none tracking-tight">
                {t({ de: "Admin", en: "Admin" })}
              </h1>
              <p className="text-xs text-muted-foreground">
                {t({
                  de: "Investment Decision Lab — Operator-Bereich",
                  en: "Investment Decision Lab — Operator console",
                })}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <LangToggle />
            <ThemeToggle />
            <Button
              variant="outline"
              size="sm"
              onClick={onSignOut}
              data-testid="button-admin-signout"
            >
              <LogOut className="h-4 w-4 mr-1" />{" "}
              {t({ de: "Abmelden", en: "Sign out" })}
            </Button>
          </div>
        </div>
      </header>

      <div className="container mx-auto px-4 py-6 grid grid-cols-1 md:grid-cols-[16rem_1fr] gap-6">
        <aside aria-label="Admin sections" data-testid="admin-sidebar">
          <nav className="md:sticky md:top-20 space-y-1">
            {NAV.map((item) => {
              const Icon = item.icon;
              const active = isActive(item);
              return (
                <Link
                  key={item.to}
                  href={item.to}
                  data-testid={item.testid}
                  data-active={active ? "true" : "false"}
                  className={[
                    "flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors",
                    active
                      ? "bg-primary/10 text-primary font-medium"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground",
                  ].join(" ")}
                >
                  <Icon className="h-4 w-4" />
                  <span>{t({ de: item.de, en: item.en })}</span>
                </Link>
              );
            })}
          </nav>
        </aside>
        <main className="min-w-0 space-y-6">{children}</main>
      </div>
    </div>
  );
}
