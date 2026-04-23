import { useState, useRef, useEffect } from "react";
import { useForm } from "react-hook-form";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip as RechartsTooltip } from "recharts";
import { AlertCircle, CheckCircle2, Info, Target, ShieldAlert, BookOpen, ArrowRight, Download, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { motion, AnimatePresence } from "framer-motion";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Separator } from "@/components/ui/separator";

import { PortfolioInput, PortfolioOutput, ValidationResult } from "@/lib/types";
import { runValidation } from "@/lib/validation";
import { buildPortfolio } from "@/lib/portfolio";
import { StressTest } from "./StressTest";

const COLORS = [
  "hsl(var(--chart-1))",
  "hsl(var(--chart-2))",
  "hsl(var(--chart-3))",
  "hsl(var(--chart-4))",
  "hsl(var(--chart-5))",
  "hsl(var(--primary))",
];

const defaultValues: PortfolioInput = {
  baseCurrency: "USD",
  riskAppetite: "Moderate",
  horizon: 10,
  targetEquityPct: 60,
  numETFs: 5,
  preferredExchange: "None",
  thematicPreference: "None",
  includeCurrencyHedging: false,
  lookThroughView: false,
  includeCrypto: false,
  includeListedRealEstate: false,
};

export function BuildPortfolio() {
  const form = useForm<PortfolioInput>({
    defaultValues,
  });

  const [output, setOutput] = useState<PortfolioOutput | null>(null);
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [hasGenerated, setHasGenerated] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const resultsRef = useRef<HTMLDivElement>(null);
  const pdfRef = useRef<HTMLDivElement>(null);

  const handleExportPDF = async () => {
    if (!pdfRef.current || !output) return;
    
    setIsExporting(true);
    try {
      const { baseCurrency, riskAppetite } = form.getValues();
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const filename = `investment-decision-lab_${baseCurrency}_${riskAppetite}_${timestamp}.pdf`;
      
      const { exportToPdf } = await import("@/lib/exportPdf");
      await exportToPdf(pdfRef.current, filename);
      toast.success("PDF exported successfully");
    } catch (error) {
      console.error(error);
      toast.error("Failed to export PDF");
    } finally {
      setIsExporting(false);
    }
  };

  const onSubmit = (data: PortfolioInput) => {
    // Coerce numeric types that might come back as strings from the form inputs
    const parsedData: PortfolioInput = {
      ...data,
      horizon: Number(data.horizon),
      targetEquityPct: Number(data.targetEquityPct),
      numETFs: Number(data.numETFs),
    };
    
    const valResult = runValidation(parsedData);
    setValidation(valResult);

    if (valResult.isValid) {
      const portOutput = buildPortfolio(parsedData);
      setOutput(portOutput);
    } else {
      setOutput(null);
    }
    
    setHasGenerated(true);
    
    setTimeout(() => {
      resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 100);
  };

  const chartData = output?.allocation.map(a => ({
    name: `${a.assetClass} - ${a.region}`,
    value: a.weight
  })) || [];

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
      {/* LEFT COLUMN: FORM */}
      <div className="lg:col-span-5 lg:sticky lg:top-24 lg:self-start lg:max-h-[calc(100vh-8rem)] overflow-y-auto pr-2 pb-8 custom-scrollbar">
        <Card>
          <CardHeader>
            <CardTitle>Portfolio Parameters</CardTitle>
            <CardDescription>Define your constraints and preferences.</CardDescription>
          </CardHeader>
          <CardContent>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="baseCurrency"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="flex items-center gap-2">
                          Base Currency
                          <Tooltip>
                            <TooltipTrigger type="button"><Info className="h-3 w-3 text-muted-foreground" /></TooltipTrigger>
                            <TooltipContent>Your primary currency for measuring returns.</TooltipContent>
                          </Tooltip>
                        </FormLabel>
                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder="Select currency" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="USD">USD</SelectItem>
                            <SelectItem value="EUR">EUR</SelectItem>
                            <SelectItem value="CHF">CHF</SelectItem>
                            <SelectItem value="GBP">GBP</SelectItem>
                          </SelectContent>
                        </Select>
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="horizon"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="flex items-center gap-2">
                          Horizon (Years)
                          <Tooltip>
                            <TooltipTrigger type="button"><Info className="h-3 w-3 text-muted-foreground" /></TooltipTrigger>
                            <TooltipContent>How long before you need to withdraw funds.</TooltipContent>
                          </Tooltip>
                        </FormLabel>
                        <FormControl>
                          <Input type="number" min={1} max={40} {...field} />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                </div>

                <FormField
                  control={form.control}
                  name="riskAppetite"
                  render={({ field }) => (
                    <FormItem className="space-y-3">
                      <FormLabel className="flex items-center gap-2">
                        Risk Appetite
                        <Tooltip>
                          <TooltipTrigger type="button"><Info className="h-3 w-3 text-muted-foreground" /></TooltipTrigger>
                          <TooltipContent>Your tolerance for portfolio drawdowns.</TooltipContent>
                        </Tooltip>
                      </FormLabel>
                      <FormControl>
                        <RadioGroup
                          onValueChange={field.onChange}
                          defaultValue={field.value}
                          className="grid grid-cols-2 gap-2"
                        >
                          {["Low", "Moderate", "High", "Very High"].map((risk) => (
                            <FormItem key={risk} className="flex items-center space-x-2 space-y-0 rounded-md border p-3">
                              <FormControl>
                                <RadioGroupItem value={risk} />
                              </FormControl>
                              <FormLabel className="font-normal cursor-pointer w-full">{risk}</FormLabel>
                            </FormItem>
                          ))}
                        </RadioGroup>
                      </FormControl>
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="targetEquityPct"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="flex justify-between items-center">
                        <span className="flex items-center gap-2">
                          Target Equity Allocation
                          <Tooltip>
                            <TooltipTrigger type="button"><Info className="h-3 w-3 text-muted-foreground" /></TooltipTrigger>
                            <TooltipContent>Percentage of portfolio allocated to stocks.</TooltipContent>
                          </Tooltip>
                        </span>
                        <span className="text-sm font-mono">{field.value}%</span>
                      </FormLabel>
                      <FormControl>
                        <div className="flex items-center gap-4">
                          <Slider
                            min={0}
                            max={100}
                            step={1}
                            value={[Number(field.value)]}
                            onValueChange={(vals) => field.onChange(vals[0])}
                            className="flex-1"
                          />
                          <Input 
                            type="number" 
                            className="w-16 font-mono text-sm" 
                            {...field} 
                            onChange={(e) => field.onChange(Number(e.target.value))}
                          />
                        </div>
                      </FormControl>
                    </FormItem>
                  )}
                />

                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="numETFs"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="flex items-center gap-2">
                          Number of ETFs
                          <Tooltip>
                            <TooltipTrigger type="button"><Info className="h-3 w-3 text-muted-foreground" /></TooltipTrigger>
                            <TooltipContent>Target number of ETFs to use (3-15).</TooltipContent>
                          </Tooltip>
                        </FormLabel>
                        <FormControl>
                          <Input type="number" min={3} max={15} {...field} />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="preferredExchange"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="flex items-center gap-2">
                          Preferred Exchange
                          <Tooltip>
                            <TooltipTrigger type="button"><Info className="h-3 w-3 text-muted-foreground" /></TooltipTrigger>
                            <TooltipContent>Filter ETFs by exchange listings where possible.</TooltipContent>
                          </Tooltip>
                        </FormLabel>
                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder="Exchange" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="None">None (Global)</SelectItem>
                            <SelectItem value="NYSE">NYSE</SelectItem>
                            <SelectItem value="LSE">LSE</SelectItem>
                            <SelectItem value="XETRA">XETRA</SelectItem>
                            <SelectItem value="SIX">SIX</SelectItem>
                          </SelectContent>
                        </Select>
                      </FormItem>
                    )}
                  />
                </div>

                <FormField
                  control={form.control}
                  name="thematicPreference"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="flex items-center gap-2">
                        Thematic Tilt (Optional)
                        <Tooltip>
                          <TooltipTrigger type="button"><Info className="h-3 w-3 text-muted-foreground" /></TooltipTrigger>
                          <TooltipContent>Add a small satellite allocation to a specific theme.</TooltipContent>
                        </Tooltip>
                      </FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Theme" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="None">None</SelectItem>
                          <SelectItem value="Technology">Technology</SelectItem>
                          <SelectItem value="Healthcare">Healthcare</SelectItem>
                          <SelectItem value="Sustainability">Sustainability</SelectItem>
                          <SelectItem value="Cybersecurity">Cybersecurity</SelectItem>
                        </SelectContent>
                      </Select>
                    </FormItem>
                  )}
                />

                <div className="space-y-4 pt-4 border-t">
                  <FormField
                    control={form.control}
                    name="includeCurrencyHedging"
                    render={({ field }) => (
                      <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3 shadow-sm">
                        <div className="space-y-0.5">
                          <FormLabel>Currency Hedging</FormLabel>
                          <FormDescription className="text-xs">Hedge foreign exposure</FormDescription>
                        </div>
                        <FormControl>
                          <Switch checked={field.value} onCheckedChange={field.onChange} />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="includeCrypto"
                    render={({ field }) => (
                      <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3 shadow-sm">
                        <div className="space-y-0.5">
                          <FormLabel>Include Crypto</FormLabel>
                          <FormDescription className="text-xs">Add a small digital asset allocation</FormDescription>
                        </div>
                        <FormControl>
                          <Switch checked={field.value} onCheckedChange={field.onChange} />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="includeListedRealEstate"
                    render={({ field }) => (
                      <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3 shadow-sm">
                        <div className="space-y-0.5">
                          <FormLabel>Listed Real Estate</FormLabel>
                          <FormDescription className="text-xs">Add a REIT allocation</FormDescription>
                        </div>
                        <FormControl>
                          <Switch checked={field.value} onCheckedChange={field.onChange} />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                </div>

                <Button type="submit" className="w-full" size="lg">
                  Generate Portfolio
                </Button>
              </form>
            </Form>
          </CardContent>
        </Card>
      </div>

      {/* RIGHT COLUMN: RESULTS */}
      <div className="lg:col-span-7 space-y-6" ref={resultsRef}>
        {!hasGenerated && (
          <div className="h-full flex flex-col items-center justify-center p-12 text-center border-2 border-dashed rounded-lg bg-muted/20">
            <Target className="h-12 w-12 text-muted-foreground mb-4 opacity-50" />
            <h3 className="text-lg font-medium">Ready to Build</h3>
            <p className="text-sm text-muted-foreground mt-2 max-w-sm">
              Configure your preferences on the left and generate a portfolio to see the detailed breakdown, rationales, and ETF implementation.
            </p>
          </div>
        )}

        {hasGenerated && validation && (
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-6"
          >
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <h2 className="text-2xl font-bold tracking-tight">Portfolio Results</h2>
              {output && validation.isValid && (
                <Button 
                  variant="outline" 
                  size="sm" 
                  onClick={handleExportPDF}
                  disabled={isExporting}
                >
                  {isExporting ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Download className="h-4 w-4 mr-2" />
                  )}
                  {isExporting ? "Generating PDF..." : "Export PDF"}
                </Button>
              )}
            </div>

            <div ref={pdfRef} className="space-y-6 bg-background">
              {/* Section 2: Validation */}
            {validation.errors.length > 0 && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>Validation Errors</AlertTitle>
                <AlertDescription>
                  <ul className="mt-2 space-y-2 text-sm">
                    {validation.errors.map((err, i) => (
                      <li key={i}>
                        <span className="font-medium">{err.message}</span>
                        <br />
                        <span className="opacity-90">{err.suggestion}</span>
                      </li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            )}

            {validation.warnings.length > 0 && validation.errors.length === 0 && (
              <Alert className="border-warning text-warning-foreground bg-warning/10">
                <ShieldAlert className="h-4 w-4 text-warning" />
                <AlertTitle className="text-warning font-semibold">Portfolio Warnings</AlertTitle>
                <AlertDescription>
                  <ul className="mt-2 space-y-2 text-sm">
                    {validation.warnings.map((warn, i) => (
                      <li key={i}>
                        <span className="font-medium text-foreground">{warn.message}</span>
                        <br />
                        <span className="text-foreground/80">{warn.suggestion}</span>
                      </li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            )}

            {validation.isValid && validation.warnings.length === 0 && (
              <Alert className="border-primary/20 bg-primary/5 text-primary">
                <CheckCircle2 className="h-4 w-4" />
                <AlertTitle>Inputs Validated</AlertTitle>
                <AlertDescription>Your inputs pass all structural coherence checks.</AlertDescription>
              </Alert>
            )}

            {output && validation.isValid && (
              <>
                {/* Section 1: Profile Summary */}
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base">Investor Profile Summary</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="flex flex-wrap gap-2">
                      <Badge variant="secondary">Currency: {form.getValues().baseCurrency}</Badge>
                      <Badge variant="secondary">Risk: {form.getValues().riskAppetite}</Badge>
                      <Badge variant="secondary">Horizon: {form.getValues().horizon} yrs</Badge>
                      <Badge variant="secondary">Target Equity: {form.getValues().targetEquityPct}%</Badge>
                      <Badge variant="outline" className="border-primary/20">{form.getValues().numETFs} ETFs</Badge>
                    </div>
                  </CardContent>
                </Card>

                {/* Section 3: Target Asset Allocation */}
                <Card>
                  <CardHeader>
                    <CardTitle>Target Asset Allocation</CardTitle>
                    <CardDescription>Optimized exposure mapping</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-6">
                    <div className="h-[200px] w-full">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie
                            data={chartData}
                            cx="50%"
                            cy="50%"
                            innerRadius={60}
                            outerRadius={80}
                            paddingAngle={2}
                            dataKey="value"
                            stroke="none"
                          >
                            {chartData.map((entry, index) => (
                              <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                            ))}
                          </Pie>
                          <RechartsTooltip 
                            formatter={(value: number) => [`${value}%`, 'Weight']}
                            contentStyle={{ borderRadius: '8px', border: '1px solid hsl(var(--border))' }}
                          />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                    
                    {/* Horizontal Stacked Bar */}
                    <div className="h-4 w-full flex rounded-full overflow-hidden">
                      {chartData.map((d, i) => (
                        <div 
                          key={i} 
                          style={{ width: `${d.value}%`, backgroundColor: COLORS[i % COLORS.length] }} 
                          title={`${d.name}: ${d.value}%`}
                          className="h-full transition-all duration-500 hover:brightness-110"
                        />
                      ))}
                    </div>

                    <div className="rounded-md border">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Asset Class</TableHead>
                            <TableHead>Region/Detail</TableHead>
                            <TableHead className="text-right">Weight</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {output.allocation.map((alloc, i) => (
                            <TableRow key={i}>
                              <TableCell className="font-medium">{alloc.assetClass}</TableCell>
                              <TableCell className="text-muted-foreground">{alloc.region}</TableCell>
                              <TableCell className="text-right font-mono">{alloc.weight.toFixed(1)}%</TableCell>
                            </TableRow>
                          ))}
                          <TableRow className="bg-muted/50 font-bold">
                            <TableCell colSpan={2}>Total</TableCell>
                            <TableCell className="text-right font-mono">100.0%</TableCell>
                          </TableRow>
                        </TableBody>
                      </Table>
                    </div>
                  </CardContent>
                </Card>

                {/* Section 5: ETF Implementation */}
                <Card>
                  <CardHeader>
                    <CardTitle>ETF Implementation</CardTitle>
                    <CardDescription>Translating targets to specific funds</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="rounded-md border">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Bucket</TableHead>
                            <TableHead>Example ETF</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {output.etfImplementation.map((etf, i) => (
                            <TableRow key={i}>
                              <TableCell>
                                <div className="font-medium">{etf.bucket}</div>
                                <div className="text-xs text-muted-foreground mt-1 max-w-[200px] line-clamp-2" title={etf.intent}>{etf.intent}</div>
                              </TableCell>
                              <TableCell>
                                <Badge variant="outline" className="mb-1">{etf.exampleETF}</Badge>
                                <div className="text-xs text-muted-foreground max-w-[200px] line-clamp-2" title={etf.rationale}>{etf.rationale}</div>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </CardContent>
                </Card>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* Section 4: Portfolio Rationale */}
                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base flex items-center gap-2">
                        <Info className="h-4 w-4" /> Rationale
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3 text-sm">
                      {output.rationale.map((r, i) => (
                        <p key={i} className="leading-relaxed text-muted-foreground">{r}</p>
                      ))}
                    </CardContent>
                  </Card>

                  {/* Section 6: Key Risks */}
                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base flex items-center gap-2">
                        <ShieldAlert className="h-4 w-4" /> Key Risks
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <ul className="space-y-2 text-sm text-muted-foreground list-disc list-inside pl-1">
                        {output.risks.map((r, i) => (
                          <li key={i}>{r}</li>
                        ))}
                      </ul>
                    </CardContent>
                  </Card>
                </div>

                {/* Section 7: Learning Insights */}
                <div className="space-y-3">
                  <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                    <BookOpen className="h-4 w-4" /> Insights
                  </h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {output.learning.map((l, i) => (
                      <Card key={i} className="bg-primary/5 border-primary/10">
                        <CardContent className="p-4 text-sm">
                          <span className="font-semibold text-primary">{l.split(':')[0]}:</span>
                          <span className="text-muted-foreground">{l.split(':')[1]}</span>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                </div>

                {/* Section 8: Scenario Stress Test */}
                <StressTest allocation={output.allocation} />
              </>
            )}
            </div>
          </motion.div>
        )}
      </div>
    </div>
  );
}
