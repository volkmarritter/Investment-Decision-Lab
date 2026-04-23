import { AlertTriangle, TrendingDown } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { BarChart, Bar, XAxis, YAxis, Tooltip as RechartsTooltip, ResponsiveContainer, Cell, CartesianGrid } from "recharts";
import { AssetAllocation } from "@/lib/types";
import { runStressTest } from "@/lib/scenarios";

export function StressTest({ allocation }: { allocation: AssetAllocation[] }) {
  const results = runStressTest(allocation);

  const chartData = results.map(r => ({
    name: r.name.replace(/^\d{4}\s/, ""),
    total: r.total,
  }));

  return (
    <Card className="mt-6 border-destructive/20">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <AlertTriangle className="h-5 w-5 text-destructive" />
          Scenario Stress Test
        </CardTitle>
        <CardDescription>
          Deterministic historical-style shocks applied to the current allocation. Illustrative, not a forecast.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {results.map(result => {
            const isNegative = result.total < 0;
            const colorClass = isNegative ? "text-destructive" : "text-emerald-600";
            
            return (
              <Card key={result.id} className="bg-muted/30">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-semibold">{result.name}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex items-baseline gap-2">
                    <span className={`text-3xl font-mono font-bold ${colorClass}`}>
                      {result.total > 0 ? "+" : ""}{result.total.toFixed(1)}%
                    </span>
                  </div>
                  
                  <div className="w-full bg-muted rounded-full h-1.5 overflow-hidden">
                    <div 
                      className={`h-full ${isNegative ? 'bg-destructive' : 'bg-emerald-500'}`} 
                      style={{ 
                        width: `${Math.min(Math.abs(result.total), 100)}%`,
                      }} 
                    />
                  </div>

                  <Accordion type="single" collapsible className="w-full">
                    <AccordionItem value="contributions" className="border-none">
                      <AccordionTrigger className="py-1 text-xs text-muted-foreground hover:no-underline">
                        <span className="flex items-center gap-1"><TrendingDown className="h-3 w-3" /> Top Drivers</span>
                      </AccordionTrigger>
                      <AccordionContent className="pt-2 pb-0">
                        <div className="space-y-1.5">
                          {result.contributions.slice(0, 5).map((c, i) => (
                            <div key={i} className="flex justify-between text-xs">
                              <span className="truncate pr-2 text-muted-foreground" title={c.key}>{c.key}</span>
                              <span className={`font-mono ${c.contribution < 0 ? 'text-destructive' : 'text-emerald-600'}`}>
                                {c.contribution > 0 ? "+" : ""}{c.contribution.toFixed(1)}%
                              </span>
                            </div>
                          ))}
                        </div>
                      </AccordionContent>
                    </AccordionItem>
                  </Accordion>
                </CardContent>
              </Card>
            );
          })}
        </div>

        <div className="h-[250px] mt-8">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={{ top: 20, right: 0, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
              <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }} />
              <YAxis 
                axisLine={false} 
                tickLine={false} 
                tickFormatter={(val) => `${val}%`} 
                tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }} 
              />
              <RechartsTooltip 
                cursor={{ fill: 'hsl(var(--muted))' }}
                contentStyle={{ borderRadius: '8px', border: '1px solid hsl(var(--border))', backgroundColor: 'hsl(var(--background))', color: 'hsl(var(--foreground))' }}
                formatter={(value: number) => [`${value}%`, 'Portfolio Return']}
              />
              <Bar dataKey="total" radius={[4, 4, 4, 4]} maxBarSize={60}>
                {chartData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.total < 0 ? "hsl(var(--destructive))" : "hsl(var(--primary))"} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}
