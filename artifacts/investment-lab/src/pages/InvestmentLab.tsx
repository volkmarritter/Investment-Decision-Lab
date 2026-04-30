import { useEffect, useState } from "react";
import { ThemeToggle } from "@/components/theme-toggle";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { BuildPortfolio } from "@/components/investment/BuildPortfolio";
import { ExplainPortfolio } from "@/components/investment/ExplainPortfolio";
import { ComparePortfolios } from "@/components/investment/ComparePortfolios";
import { Methodology, VALID_SECTION_IDS as METHODOLOGY_SECTION_IDS } from "@/components/investment/Methodology";
import { BookOpen, CalendarClock, Layers, PieChart, Scale } from "lucide-react";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useT } from "@/lib/i18n";
import { DisclaimerFooter } from "@/components/investment/Disclaimer";
import { biconContactMailto } from "@/lib/brand";
import { subscribeNavigateTab } from "@/lib/explainCompare";

// Tab values used by the URL `?tab=` query parameter (Task #43). The default
// is "build", so a missing or unknown tab parameter falls back to it and the
// canonical URL for the build tab carries no query string.
const VALID_TABS = ["build", "compare", "explain", "methodology"] as const;
type TabValue = (typeof VALID_TABS)[number];

const isTabValue = (v: string | null): v is TabValue =>
  v !== null && (VALID_TABS as readonly string[]).includes(v);

const readTabFromUrl = (): TabValue => {
  if (typeof window === "undefined") return "build";
  const t = new URLSearchParams(window.location.search).get("tab");
  if (isTabValue(t)) return t;
  // Fallback: when the URL has no `?tab=` parameter but does carry a hash
  // that names a known Methodology section, route to the Methodology tab
  // so short-form share links like `/#tail-realism` still land on the
  // right tab. Methodology's own hashchange listener then opens and
  // scrolls to the targeted section.
  const hash = window.location.hash.replace(/^#/, "");
  if (hash && METHODOLOGY_SECTION_IDS.has(hash)) return "methodology";
  return "build";
};

export default function InvestmentLab() {
  const { t, lang, setLang } = useT();

  // Controlled tab state synced with the URL `?tab=` query parameter
  // (Task #43). Initialised from the URL so deep-links like
  // `/?tab=methodology#tail-realism` land on the right tab on first paint —
  // which in turn lets Methodology's hashchange/scroll logic find a visible
  // (not `hidden`) panel to scroll into view.
  const [tab, setTab] = useState<TabValue>(() => readTabFromUrl());

  // Browser back / forward navigation. `popstate` fires for both query and
  // hash changes; we only care about the query side here. Methodology owns
  // its own `hashchange` listener so the two concerns stay decoupled.
  useEffect(() => {
    const onPop = () => setTab(readTabFromUrl());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // Cross-component navigation: ExplainPortfolio's "Send to Compare"
  // button (and any future similar shortcut) calls `navigateToTab` from
  // `lib/explainCompare`, which pushes the URL and emits this event so
  // the controlled tab state stays in sync without threading callbacks
  // down through every tab panel.
  useEffect(() => {
    return subscribeNavigateTab((next) => {
      setTab(next);
    });
  }, []);

  // Welcome dialog (Task #96). Opens shortly after the app shell mounts so
  // first-time visitors understand the auto-generated example portfolio in
  // the Build tab is a demo and they're free to change inputs and build
  // their own. Pops on every fresh load for now — "show only once"
  // persistence is intentionally out of scope. Slight delay lets the page
  // paint and the auto-generate effect run before the modal takes focus.
  const [welcomeOpen, setWelcomeOpen] = useState(false);
  useEffect(() => {
    const id = window.setTimeout(() => setWelcomeOpen(true), 400);
    return () => window.clearTimeout(id);
  }, []);

  const handleTabChange = (next: string) => {
    if (!isTabValue(next) || next === tab) return;
    setTab(next);
    const url = new URL(window.location.href);
    if (next === "build") {
      url.searchParams.delete("tab");
    } else {
      url.searchParams.set("tab", next);
    }
    // Switching tabs always clears any section hash — the new tab does not
    // have one, and keeping a stale `#tail-realism` would be confusing if
    // the user later reloads.
    url.hash = "";
    if (url.pathname + url.search + url.hash !== window.location.pathname + window.location.search + window.location.hash) {
      window.history.pushState(null, "", url.toString());
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-40 w-full border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container mx-auto px-4 h-16 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <div className="bg-primary/10 p-2 rounded-lg text-primary shrink-0">
              <Layers className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <h1 className="text-lg font-bold leading-none tracking-tight truncate">{t("header.title")}</h1>
              {/* Tagline row carries both the lab tagline AND a discreet
                * BICon attribution. The attribution is hidden on very small
                * viewports so the title doesn't get crowded; the persistent
                * "Talk to us" pill on the right and the footer attribution
                * row keep the brand surface present on mobile. */}
              <p className="text-xs text-muted-foreground flex items-center gap-1.5 leading-snug">
                <span className="truncate">{t("header.tagline")}</span>
                <span
                  className="hidden md:inline-flex items-center gap-1 text-muted-foreground/70 shrink-0"
                  aria-label={t("header.bicon.attribution.aria")}
                  data-testid="bicon-header-attribution"
                >
                  <span aria-hidden="true">·</span>
                  <span>{t("header.bicon.attribution")}</span>
                </span>
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 sm:gap-4 shrink-0">
            {/* Persistent "Talk to us" CTA — full label on sm+, icon + short
              * label on mobile. Uses a mailto: with a pre-filled subject so
              * inbound leads from the showcase are recognisable. */}
            <Button
              asChild
              variant="outline"
              size="sm"
              className="hidden sm:flex h-8 px-2.5 sm:px-3 text-xs gap-1.5"
              data-testid="bicon-cta-header"
            >
              <a
                href={biconContactMailto(lang)}
                aria-label={t("header.bicon.cta.aria")}
              >
                <CalendarClock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span className="hidden sm:inline whitespace-nowrap">{t("header.bicon.cta")}</span>
                <span className="sm:hidden whitespace-nowrap">{t("header.bicon.cta.short")}</span>
              </a>
            </Button>
            <ToggleGroup type="single" value={lang} onValueChange={(v: any) => v && setLang(v)} size="sm">
              <ToggleGroupItem value="en" className="text-xs px-2 h-7">EN</ToggleGroupItem>
              <ToggleGroupItem value="de" className="text-xs px-2 h-7">DE</ToggleGroupItem>
            </ToggleGroup>
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        <Tabs value={tab} onValueChange={handleTabChange} className="space-y-8">
          <div className="flex justify-center">
            <TabsList className="grid w-full max-w-3xl grid-cols-4 h-auto gap-1 p-1">
              <TabsTrigger
                value="build"
                className="flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-2 min-w-0 px-1 sm:px-3 py-2 text-[11px] sm:text-sm whitespace-normal text-center leading-tight break-words"
              >
                <Layers className="h-4 w-4 shrink-0" />
                <span>{t("tab.build")}</span>
              </TabsTrigger>
              <TabsTrigger
                value="compare"
                className="flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-2 min-w-0 px-1 sm:px-3 py-2 text-[11px] sm:text-sm whitespace-normal text-center leading-tight break-words"
              >
                <Scale className="h-4 w-4 shrink-0" />
                <span>{t("tab.compare")}</span>
              </TabsTrigger>
              <TabsTrigger
                value="explain"
                className="flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-2 min-w-0 px-1 sm:px-3 py-2 text-[11px] sm:text-sm whitespace-normal text-center leading-tight break-words"
              >
                <PieChart className="h-4 w-4 shrink-0" />
                <span>{t("tab.explain")}</span>
              </TabsTrigger>
              <TabsTrigger
                value="methodology"
                className="flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-2 min-w-0 px-1 sm:px-3 py-2 text-[11px] sm:text-sm whitespace-normal text-center leading-tight break-words"
              >
                <BookOpen className="h-4 w-4 shrink-0" />
                <span>{t("tab.methodology")}</span>
              </TabsTrigger>
            </TabsList>
          </div>

          {/* forceMount keeps each tab panel mounted across tab switches so
           *  the user's generated portfolio (and any in-flight form state)
           *  is preserved when navigating away and back. Radix sets the
           *  `hidden` attribute on inactive panels, so they take no space. */}
          <TabsContent value="build" forceMount className="m-0 focus-visible:outline-none data-[state=inactive]:hidden">
            <BuildPortfolio />
          </TabsContent>
          <TabsContent value="compare" forceMount className="m-0 focus-visible:outline-none data-[state=inactive]:hidden">
            <ComparePortfolios />
          </TabsContent>
          <TabsContent value="explain" forceMount className="m-0 focus-visible:outline-none data-[state=inactive]:hidden">
            <ExplainPortfolio />
          </TabsContent>
          <TabsContent value="methodology" forceMount className="m-0 focus-visible:outline-none data-[state=inactive]:hidden">
            <Methodology />
          </TabsContent>
        </Tabs>
      </main>

      <DisclaimerFooter />

      {/* Welcome dialog (Task #96) — explains the auto-generated example
       *  portfolio and reassures the user they're free to change inputs.
       *  Fully dismissible: close button, Esc, click-outside (handled by
       *  the underlying Radix Dialog primitive). */}
      <Dialog open={welcomeOpen} onOpenChange={setWelcomeOpen}>
        <DialogContent
          closeLabel={t("welcome.close")}
          data-testid="welcome-dialog"
        >
          <DialogHeader>
            <DialogTitle>{t("welcome.title")}</DialogTitle>
            <DialogDescription>{t("welcome.body")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              onClick={() => setWelcomeOpen(false)}
              data-testid="welcome-dialog-dismiss"
            >
              {t("welcome.dismiss")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
