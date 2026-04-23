import { ThemeToggle } from "@/components/theme-toggle";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BuildPortfolio } from "@/components/investment/BuildPortfolio";
import { ExplainPortfolio } from "@/components/investment/ExplainPortfolio";
import { ComparePortfolios } from "@/components/investment/ComparePortfolios";
import { Layers, PieChart, Scale } from "lucide-react";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useT } from "@/lib/i18n";
import { DisclaimerFooter } from "@/components/investment/Disclaimer";

export default function InvestmentLab() {
  const { t, lang, setLang } = useT();

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-40 w-full border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="bg-primary/10 p-2 rounded-lg text-primary">
              <Layers className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-lg font-bold leading-none tracking-tight">{t("header.title")}</h1>
              <p className="text-xs text-muted-foreground">{t("header.tagline")}</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <ToggleGroup type="single" value={lang} onValueChange={(v: any) => v && setLang(v)} size="sm">
              <ToggleGroupItem value="en" className="text-xs px-2 h-7">EN</ToggleGroupItem>
              <ToggleGroupItem value="de" className="text-xs px-2 h-7">DE</ToggleGroupItem>
            </ToggleGroup>
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        <Tabs defaultValue="build" className="space-y-8">
          <div className="flex justify-center">
            <TabsList className="grid w-full max-w-3xl grid-cols-3 h-auto gap-1 p-1">
              <TabsTrigger
                value="build"
                className="flex items-center justify-center gap-2 min-w-0 px-2 py-2 text-xs sm:text-sm whitespace-normal text-center leading-tight"
              >
                <Layers className="h-4 w-4 shrink-0" />
                <span className="truncate sm:whitespace-normal">{t("tab.build")}</span>
              </TabsTrigger>
              <TabsTrigger
                value="compare"
                className="flex items-center justify-center gap-2 min-w-0 px-2 py-2 text-xs sm:text-sm whitespace-normal text-center leading-tight"
              >
                <Scale className="h-4 w-4 shrink-0" />
                <span className="truncate sm:whitespace-normal">{t("tab.compare")}</span>
              </TabsTrigger>
              <TabsTrigger
                value="explain"
                className="flex items-center justify-center gap-2 min-w-0 px-2 py-2 text-xs sm:text-sm whitespace-normal text-center leading-tight"
              >
                <PieChart className="h-4 w-4 shrink-0" />
                <span className="truncate sm:whitespace-normal">{t("tab.explain")}</span>
              </TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="build" className="m-0 focus-visible:outline-none">
            <BuildPortfolio />
          </TabsContent>
          <TabsContent value="compare" className="m-0 focus-visible:outline-none">
            <ComparePortfolios />
          </TabsContent>
          <TabsContent value="explain" className="m-0 focus-visible:outline-none">
            <ExplainPortfolio />
          </TabsContent>
        </Tabs>
      </main>

      <DisclaimerFooter />
    </div>
  );
}
