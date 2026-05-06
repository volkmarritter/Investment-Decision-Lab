import { useEffect, useState, useMemo } from "react";
import { createPortal } from "react-dom";
import { ThemeToggle } from "@/components/theme-toggle";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
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
import { BookOpen, Layers, Phone, PieChart, Scale } from "lucide-react";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useT } from "@/lib/i18n";
import { DisclaimerFooter } from "@/components/investment/Disclaimer";
import { biconContactMailto } from "@/lib/brand";
import {
  explainWorkspaceHasContent,
  getCompareSlotsState,
  getLastExplainWorkspace,
  subscribeCompareSlotsState,
  subscribeLastExplainWorkspace,
  subscribeNavigateTab,
} from "@/lib/explainCompare";
import { getLastBuildInput, subscribeLastBuildInput } from "@/lib/settings";

const VALID_TABS = ["build", "compare", "explain", "methodology"] as const;
type TabValue = (typeof VALID_TABS)[number];

const isTabValue = (v: string | null): v is TabValue =>
  v !== null && (VALID_TABS as readonly string[]).includes(v);

const readTabFromUrl = (): TabValue => {
  if (typeof window === "undefined") return "build";
  const t = new URLSearchParams(window.location.search).get("tab");
  if (isTabValue(t)) return t;
  const hash = window.location.hash.replace(/^#/, "");
  if (hash && METHODOLOGY_SECTION_IDS.has(hash)) return "methodology";
  return "build";
};

// Task #183 — single source of truth for the four-module nav. Both the
// desktop sticky header bar and the mobile fixed bottom bar render from
// this list so labels, icons, tooltips, subtitles and dot-indicator
// hooks stay in lockstep. `signalKey` maps each tab to one of the
// content-presence flags computed by `useNavSignals` below; tabs with
// `signalKey: null` (Methodology) never carry a dot.
type NavTabDef = {
  value: TabValue;
  icon: typeof Layers;
  labelKey: string;
  shortLabelKey: string;
  subtitleKey: string;
  signalKey: "build" | "compare" | "explain" | null;
  testid: string;
};
const NAV_TABS: ReadonlyArray<NavTabDef> = [
  {
    value: "build",
    icon: Layers,
    labelKey: "tab.build",
    shortLabelKey: "tab.build.short",
    subtitleKey: "nav.build.subtitle",
    signalKey: "build",
    testid: "nav-tab-build",
  },
  {
    value: "compare",
    icon: Scale,
    labelKey: "tab.compare",
    shortLabelKey: "tab.compare.short",
    subtitleKey: "nav.compare.subtitle",
    signalKey: "compare",
    testid: "nav-tab-compare",
  },
  {
    value: "explain",
    icon: PieChart,
    labelKey: "tab.explain",
    shortLabelKey: "tab.explain.short",
    subtitleKey: "nav.explain.subtitle",
    signalKey: "explain",
    testid: "nav-tab-explain",
  },
  {
    value: "methodology",
    icon: BookOpen,
    labelKey: "tab.methodology",
    shortLabelKey: "tab.methodology.short",
    subtitleKey: "nav.methodology.subtitle",
    signalKey: null,
    testid: "nav-tab-methodology",
  },
];

// Subscribes to the cross-tab content-presence channels in
// lib/settings.ts and lib/explainCompare.ts so the dot indicators can
// flip on/off without prop drilling. Compare's "has content" reads
// the dedicated Compare-slots channel republished by ComparePortfolios
// — a slot is "filled" when it's linked-to-Build, sourced from an
// Explain workspace, or has produced an output. Methodology has no
// content signal.
function useNavSignals(): Record<"build" | "compare" | "explain", boolean> {
  const [buildHas, setBuildHas] = useState<boolean>(
    () => getLastBuildInput() !== null,
  );
  const [explainHas, setExplainHas] = useState<boolean>(() =>
    explainWorkspaceHasContent(getLastExplainWorkspace()),
  );
  const [compareSlots, setCompareSlots] = useState(() => getCompareSlotsState());
  useEffect(
    () => subscribeLastBuildInput((v) => setBuildHas(v !== null)),
    [],
  );
  useEffect(
    () =>
      subscribeLastExplainWorkspace((ws) =>
        setExplainHas(explainWorkspaceHasContent(ws)),
      ),
    [],
  );
  useEffect(() => subscribeCompareSlotsState((s) => setCompareSlots(s)), []);
  return useMemo(
    () => ({
      build: buildHas,
      compare: compareSlots.A || compareSlots.B,
      explain: explainHas,
    }),
    [buildHas, explainHas, compareSlots],
  );
}

// Header tab bar — uses real Radix TabsTrigger (sm+ only). Lives
// inside <Tabs> so Radix wires keyboard nav and aria-selected.
function HeaderTabBar({
  signals,
  current,
}: {
  signals: Record<"build" | "compare" | "explain", boolean>;
  current: TabValue;
}) {
  const { t } = useT();
  return (
    <TabsList
      className="grid w-full max-w-3xl grid-cols-4 h-auto gap-1 p-1"
      data-testid="nav-bar-header"
    >
      {NAV_TABS.map((def, idx) => {
        const Icon = def.icon;
        const hasDot = def.signalKey !== null && signals[def.signalKey];
        const isActive = current === def.value;
        // Subtle vertical separator between adjacent tabs (rendered as a
        // ::before pseudo-element on every item except the first). Using
        // `before:` keeps the divider out of the grid track sizing so the
        // four columns stay perfectly equal-width.
        const dividerCls =
          idx === 0
            ? ""
            : "before:absolute before:left-0 before:top-1/2 before:-translate-y-1/2 before:h-5 before:w-px before:bg-border/60";
        // Inline style for the active fill — bypasses Tailwind/twMerge
        // specificity battles with the shadcn TabsTrigger defaults
        // entirely. Inline styles always win over class-based rules
        // unless something explicitly uses !important on the same
        // property, which nothing in our stack does for these.
        // Soft primary tint — matches the icon chip in the header
        // (`bg-primary/10 text-primary`) so the active tab reads as
        // "current section" without the loud full-blue fill.
        const activeStyle: React.CSSProperties | undefined = isActive
          ? {
              backgroundColor: "hsl(var(--primary) / 0.12)",
              color: "hsl(var(--primary))",
              boxShadow: "inset 0 -2px 0 0 hsl(var(--primary))",
            }
          : undefined;
        return (
          <Tooltip key={def.value}>
            <TooltipTrigger asChild>
              <TabsTrigger
                value={def.value}
                data-testid={def.testid}
                aria-label={t(def.labelKey)}
                style={activeStyle}
                className={`relative flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-2 min-w-0 px-1 sm:px-3 py-2 text-[11px] sm:text-sm whitespace-normal text-center leading-tight break-words text-muted-foreground hover:text-foreground hover:bg-muted/60 data-[state=active]:font-semibold data-[state=active]:shadow-md ${dividerCls}`}
              >
                <span className="relative inline-flex shrink-0">
                  <Icon className="h-4 w-4 shrink-0" />
                  {hasDot && (
                    <span
                      className="absolute -top-0.5 -right-1.5 h-1.5 w-1.5 rounded-full bg-primary"
                      data-testid={`nav-dot-${def.value}`}
                      aria-label="has content"
                    />
                  )}
                </span>
                <span className="flex flex-col items-center sm:items-start min-w-0">
                  {/* Short label (default); hidden once there's room for the
                      full "… Portfolio(s)" version at md+. */}
                  <span
                    className="md:hidden truncate"
                    data-testid={`nav-label-${def.value}`}
                  >
                    {t(def.shortLabelKey)}
                  </span>
                  <span
                    className="hidden md:inline truncate"
                    data-testid={`nav-label-${def.value}-full`}
                  >
                    {t(def.labelKey)}
                  </span>
                  <span
                    className="hidden lg:inline text-[10px] font-normal text-muted-foreground leading-tight"
                    data-testid={`nav-subtitle-${def.value}`}
                  >
                    {t(def.subtitleKey)}
                  </span>
                </span>
              </TabsTrigger>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="max-w-xs">
              {t(def.labelKey)} — {t(def.subtitleKey)}
            </TooltipContent>
          </Tooltip>
        );
      })}
    </TabsList>
  );
}

// Mobile bottom-nav (sm:hidden). Plain <button>s that call the same
// onSelect handler as the desktop tabs — deliberately NOT TabsTrigger
// to avoid duplicate triggers under one Radix Tabs collection (which
// produces a phantom hidden trigger that intercepts pointer-events
// and breaks tap() in mobile Playwright tests).
function MobileTabBar({
  current,
  onSelect,
  signals,
}: {
  current: TabValue;
  onSelect: (next: TabValue) => void;
  signals: Record<"build" | "compare" | "explain", boolean>;
}) {
  const { t } = useT();
  return (
    <div
      role="tablist"
      aria-label="Mobile tabs"
      className="grid grid-cols-4 h-auto w-full gap-0 p-1"
      data-testid="nav-bar-bottom"
    >
      {NAV_TABS.map((def, idx) => {
        const Icon = def.icon;
        const hasDot = def.signalKey !== null && signals[def.signalKey];
        const isActive = current === def.value;
        const dividerCls =
          idx === 0
            ? ""
            : "before:absolute before:left-0 before:top-1/2 before:-translate-y-1/2 before:h-6 before:w-px before:bg-border/60";
        // Deliberately NO Tooltip wrapper here — on touch devices Radix
        // Tooltip's first-tap-shows-tooltip behavior + the trigger's
        // pointer-event proxy can swallow the navigation tap. The
        // `aria-label` carries the same descriptive text for screen
        // readers; sighted desktop users get the subtitle in the header
        // tab bar, sighted mobile users get the visible label below the
        // icon.
        return (
          <button
            key={def.value}
            type="button"
            role="tab"
            aria-selected={isActive}
            aria-label={t(def.labelKey)}
            title={`${t(def.labelKey)} — ${t(def.subtitleKey)}`}
            data-testid={`${def.testid}-mobile`}
            onClick={() => onSelect(def.value)}
            className={`relative flex flex-col items-center justify-center gap-0.5 min-w-0 px-1 py-1.5 text-[10px] leading-tight rounded-md transition-colors ${dividerCls} ${
              isActive
                ? "bg-background text-foreground shadow-md ring-1 ring-border font-semibold"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <span className="relative inline-flex shrink-0">
              <Icon className="h-4 w-4 shrink-0" />
              {hasDot && (
                <span
                  className="absolute -top-0.5 -right-1.5 h-1.5 w-1.5 rounded-full bg-primary"
                  data-testid={`nav-dot-${def.value}-mobile`}
                  aria-label="has content"
                />
              )}
            </span>
            <span className="truncate">{t(def.shortLabelKey)}</span>
          </button>
        );
      })}
    </div>
  );
}

export default function InvestmentLab() {
  const { t, lang, setLang } = useT();

  const [tab, setTab] = useState<TabValue>(() => readTabFromUrl());

  useEffect(() => {
    const onPop = () => setTab(readTabFromUrl());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  useEffect(() => {
    return subscribeNavigateTab((next) => {
      setTab(next);
    });
  }, []);

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
    url.hash = "";
    if (url.pathname + url.search + url.hash !== window.location.pathname + window.location.search + window.location.hash) {
      window.history.pushState(null, "", url.toString());
    }
  };

  const signals = useNavSignals();

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Tabs value={tab} onValueChange={handleTabChange} className="space-y-0">
        <header className="sticky top-0 z-40 w-full border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
          <div className="container mx-auto px-4 h-16 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <div className="bg-primary/10 p-2 rounded-lg text-primary shrink-0">
                <Layers className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <h1 className="text-lg font-bold leading-none tracking-tight truncate">{t("header.title")}</h1>
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
                  <Phone className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
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
          {/* Task #183 — desktop tab bar lives inside the sticky header so
           *  the four modules are always one click away while scrolling.
           *  Hidden on mobile; the fixed bottom bar takes over there. */}
          <div className="hidden sm:block border-t border-border/60 bg-background/95">
            <div className="container mx-auto px-4 py-2 flex justify-center">
              <HeaderTabBar signals={signals} current={tab} />
            </div>
          </div>
        </header>

        {/* `pb-24 sm:pb-0` keeps content from sliding under the mobile
         *  fixed bottom bar; on sm+ the bar disappears and the padding is
         *  removed so the disclaimer footer hugs the bottom as before. */}
        <main className="container mx-auto px-4 py-8 pb-24 sm:pb-0 space-y-8">
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
        </main>

        <DisclaimerFooter />

      </Tabs>

      {/* Mobile fixed bottom nav (Task #183). Portaled to <body> so no
       *  ancestor stacking context (Tabs, Radix portals, etc.) can keep
       *  it under the main content — without the portal, mobile
       *  Playwright tap() was intercepted by long Explain content
       *  rendering in main on top of the nav. `sm:hidden` keeps it off
       *  desktop where the header bar takes over;
       *  `pb-[env(safe-area-inset-bottom)]` honors iOS home-indicator. */}
      {typeof document !== "undefined" &&
        createPortal(
          <nav
            className="sm:hidden fixed bottom-0 inset-x-0 z-40 border-t border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 pb-[env(safe-area-inset-bottom)]"
            aria-label="Primary navigation"
            style={{ isolation: "isolate" }}
          >
            <div className="px-2 pt-1">
              <MobileTabBar
                current={tab}
                onSelect={(next) => handleTabChange(next)}
                signals={signals}
              />
            </div>
          </nav>,
          document.body,
        )}

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
