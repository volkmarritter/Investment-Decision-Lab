import { useState } from "react";
import { useForm, useFieldArray } from "react-hook-form";
import { Plus, Trash2, AlertTriangle, CheckCircle, XCircle, Upload, Download } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Separator } from "@/components/ui/separator";

import { ExplainAnalysis, ExplainPosition, RiskAppetite, BaseCurrency } from "@/lib/types";
import { analyzePortfolio } from "@/lib/explain";
import { ImportCsvDialog } from "./ImportCsvDialog";
import { ParsedPositionRow } from "@/lib/csvImport";

interface ExplainFormValues {
  baseCurrency: BaseCurrency;
  riskAppetite: RiskAppetite;
  positions: ExplainPosition[];
}

const defaultValues: ExplainFormValues = {
  baseCurrency: "USD",
  riskAppetite: "Moderate",
  positions: [
    { assetClass: "Equity", region: "USA", weight: 40 },
    { assetClass: "Equity", region: "Europe", weight: 20 },
    { assetClass: "Fixed Income", region: "Global", weight: 30 },
    { assetClass: "Cash", region: "USD", weight: 10 },
  ],
};

export function ExplainPortfolio() {
  const [analysis, setAnalysis] = useState<ExplainAnalysis | null>(null);
  const [importDialogOpen, setImportDialogOpen] = useState(false);

  const form = useForm<ExplainFormValues>({
    defaultValues,
  });

  const { fields, append, remove, replace } = useFieldArray({
    control: form.control,
    name: "positions",
  });

  const handleDownloadTemplate = () => {
    const csvContent = "Asset Class,Region,Weight\nEquities,USA,40\nEquities,Europe,20\nBonds,Global,40";
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute("download", "portfolio_template.csv");
    link.style.visibility = "hidden";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleImport = (rows: ParsedPositionRow[], isAppend: boolean) => {
    const newPositions = rows.map(r => ({
      assetClass: r.assetClass,
      region: r.region,
      weight: r.weight
    }));
    
    if (isAppend) {
      append(newPositions);
    } else {
      replace(newPositions);
    }
    toast.success(`Imported ${rows.length} positions`);
  };

  const onSubmit = (data: ExplainFormValues) => {
    // Coerce weights to numbers
    const parsedPositions = data.positions.map(p => ({
      ...p,
      weight: Number(p.weight)
    }));
    
    const result = analyzePortfolio(parsedPositions, data.riskAppetite, data.baseCurrency);
    setAnalysis(result);
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
      <div>
        <Card>
          <CardHeader>
            <CardTitle>Current Portfolio</CardTitle>
            <CardDescription>Input your existing holdings to test for coherence.</CardDescription>
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
                        <FormLabel>Base Currency</FormLabel>
                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder="Currency" />
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
                    name="riskAppetite"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Stated Risk Profile</FormLabel>
                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder="Risk Profile" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="Low">Low</SelectItem>
                            <SelectItem value="Moderate">Moderate</SelectItem>
                            <SelectItem value="High">High</SelectItem>
                            <SelectItem value="Very High">Very High</SelectItem>
                          </SelectContent>
                        </Select>
                      </FormItem>
                    )}
                  />
                </div>

                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <FormLabel className="text-base">Positions</FormLabel>
                    <div className="flex gap-2">
                      <Button 
                        type="button" 
                        variant="outline" 
                        size="sm" 
                        onClick={handleDownloadTemplate}
                        className="h-8 text-xs"
                      >
                        <Download className="mr-2 h-3 w-3" /> Template
                      </Button>
                      <Button 
                        type="button" 
                        variant="outline" 
                        size="sm" 
                        onClick={() => setImportDialogOpen(true)}
                        className="h-8 text-xs"
                      >
                        <Upload className="mr-2 h-3 w-3" /> Import CSV
                      </Button>
                      <Button 
                        type="button" 
                        variant="outline" 
                        size="sm" 
                        onClick={() => append({ assetClass: "Equity", region: "USA", weight: 0 })}
                        className="h-8 text-xs"
                      >
                        <Plus className="mr-2 h-3 w-3" /> Add Row
                      </Button>
                    </div>
                  </div>
                  
                  <div className="rounded-md border overflow-hidden">
                    <Table>
                      <TableHeader className="bg-muted/50">
                        <TableRow>
                          <TableHead>Asset Class</TableHead>
                          <TableHead>Region/Detail</TableHead>
                          <TableHead className="w-24">Weight %</TableHead>
                          <TableHead className="w-12"></TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        <AnimatePresence initial={false}>
                          {fields.map((field, index) => (
                            <motion.tr 
                              key={field.id}
                              initial={{ opacity: 0, height: 0 }}
                              animate={{ opacity: 1, height: "auto" }}
                              exit={{ opacity: 0, height: 0 }}
                              transition={{ duration: 0.2 }}
                              className="group"
                            >
                              <TableCell className="p-2">
                                <FormField
                                  control={form.control}
                                  name={`positions.${index}.assetClass`}
                                  render={({ field: inputField }) => (
                                    <Input {...inputField} className="h-8 text-sm" placeholder="e.g. Equity" />
                                  )}
                                />
                              </TableCell>
                              <TableCell className="p-2">
                                <FormField
                                  control={form.control}
                                  name={`positions.${index}.region`}
                                  render={({ field: inputField }) => (
                                    <Input {...inputField} className="h-8 text-sm" placeholder="e.g. USA" />
                                  )}
                                />
                              </TableCell>
                              <TableCell className="p-2">
                                <FormField
                                  control={form.control}
                                  name={`positions.${index}.weight`}
                                  render={({ field: inputField }) => (
                                    <Input {...inputField} type="number" className="h-8 text-sm font-mono text-right" placeholder="0" />
                                  )}
                                />
                              </TableCell>
                              <TableCell className="p-2 text-center">
                                <Button 
                                  type="button" 
                                  variant="ghost" 
                                  size="icon" 
                                  onClick={() => remove(index)}
                                  className="h-8 w-8 text-muted-foreground hover:text-destructive opacity-50 group-hover:opacity-100 transition-opacity"
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </TableCell>
                            </motion.tr>
                          ))}
                        </AnimatePresence>
                      </TableBody>
                    </Table>
                  </div>
                </div>

                <Button type="submit" className="w-full">
                  Analyze Portfolio
                </Button>
              </form>
            </Form>
          </CardContent>
        </Card>
      </div>

      <ImportCsvDialog
        open={importDialogOpen}
        onOpenChange={setImportDialogOpen}
        onImport={handleImport}
      />

      <div>
        <AnimatePresence mode="wait">
          {analysis ? (
            <motion.div 
              key="analysis"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              className="space-y-6"
            >
              <Card className="overflow-hidden border-2">
                <div className={`h-2 w-full ${
                  analysis.verdict === "Coherent" ? "bg-primary" : 
                  analysis.verdict === "Needs Attention" ? "bg-warning" : "bg-destructive"
                }`} />
                <CardHeader>
                  <div className="flex justify-between items-start">
                    <div>
                      <CardTitle>Diagnosis: {analysis.verdict}</CardTitle>
                      <CardDescription>Portfolio structural check</CardDescription>
                    </div>
                    {analysis.verdict === "Coherent" && <CheckCircle className="h-8 w-8 text-primary" />}
                    {analysis.verdict === "Needs Attention" && <AlertTriangle className="h-8 w-8 text-warning" />}
                    {analysis.verdict === "Inconsistent" && <XCircle className="h-8 w-8 text-destructive" />}
                  </div>
                </CardHeader>
                <CardContent className="space-y-6">
                  
                  <div className="flex items-center justify-between p-4 bg-muted/30 rounded-lg">
                    <span className="font-medium">Total Allocation</span>
                    <div className="flex items-center gap-3">
                      <span className={`font-mono text-lg ${Math.abs(analysis.sum - 100) > 0.5 ? 'text-destructive font-bold' : ''}`}>
                        {analysis.sum.toFixed(1)}%
                      </span>
                      {Math.abs(analysis.sum - 100) <= 0.5 && <Badge variant="outline" className="text-primary border-primary/20">Valid</Badge>}
                    </div>
                  </div>

                  {analysis.errors.length > 0 && (
                    <div className="space-y-3">
                      <h4 className="text-sm font-semibold flex items-center gap-2 text-destructive">
                        <XCircle className="h-4 w-4" /> Critical Issues
                      </h4>
                      <ul className="space-y-2">
                        {analysis.errors.map((err, i) => (
                          <li key={i} className="text-sm bg-destructive/10 text-destructive-foreground px-3 py-2 rounded-md border border-destructive/20">
                            {err}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {analysis.warnings.length > 0 && (
                    <div className="space-y-3">
                      <h4 className="text-sm font-semibold flex items-center gap-2 text-warning">
                        <AlertTriangle className="h-4 w-4" /> Findings
                      </h4>
                      <ul className="space-y-2">
                        {analysis.warnings.map((warn, i) => (
                          <li key={i} className="text-sm bg-warning/10 text-warning-foreground px-3 py-2 rounded-md border border-warning/20">
                            {warn}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {analysis.errors.length === 0 && analysis.warnings.length === 0 && (
                    <div className="p-4 bg-primary/5 rounded-lg border border-primary/10 text-sm text-muted-foreground">
                      This portfolio appears structurally sound. It adds up to 100%, avoids excessive single-region concentration, maintains defensive assets, and matches your stated risk profile.
                    </div>
                  )}
                  
                </CardContent>
              </Card>
            </motion.div>
          ) : (
            <div className="h-full flex flex-col items-center justify-center p-12 text-center border-2 border-dashed rounded-lg bg-muted/20 min-h-[400px]">
              <AlertTriangle className="h-12 w-12 text-muted-foreground mb-4 opacity-50" />
              <h3 className="text-lg font-medium">Awaiting Input</h3>
              <p className="text-sm text-muted-foreground mt-2 max-w-sm">
                Enter your positions on the left to scan for concentration risks, missing diversifiers, and alignment with your risk profile.
              </p>
            </div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
