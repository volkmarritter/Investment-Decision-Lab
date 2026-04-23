import { ThemeToggle } from "@/components/theme-toggle";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BuildPortfolio } from "@/components/investment/BuildPortfolio";
import { ExplainPortfolio } from "@/components/investment/ExplainPortfolio";
import { ComparePortfolios } from "@/components/investment/ComparePortfolios";
import { Layers, PieChart, Scale } from "lucide-react";

export default function InvestmentLab() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-40 w-full border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="bg-primary/10 p-2 rounded-lg text-primary">
              <Layers className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-lg font-bold leading-none tracking-tight">Investment Decision Lab</h1>
              <p className="text-xs text-muted-foreground">Professional portfolio construction & analysis</p>
            </div>
          </div>
          <div>
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        <Tabs defaultValue="build" className="space-y-8">
          <div className="flex justify-center">
            <TabsList className="grid w-full max-w-2xl grid-cols-3">
              <TabsTrigger value="build" className="flex items-center gap-2">
                <Layers className="h-4 w-4" />
                Build Portfolio
              </TabsTrigger>
              <TabsTrigger value="compare" className="flex items-center gap-2">
                <Scale className="h-4 w-4" />
                Compare Portfolios
              </TabsTrigger>
              <TabsTrigger value="explain" className="flex items-center gap-2">
                <PieChart className="h-4 w-4" />
                Explain My Portfolio
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
    </div>
  );
}
