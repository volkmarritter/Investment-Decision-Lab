import { useMemo, useState } from "react";
import { Coins, TrendingDown, Wallet } from "lucide-react";
import { LineChart, Line, XAxis, YAxis, Tooltip as RechartsTooltip, ResponsiveContainer, CartesianGrid, Legend } from "recharts";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AssetAllocation, ETFImplementation } from "@/lib/types";
import { estimateFees } from "@/lib/fees";
import { parseDecimalInput } from "@/lib/manualWeights";

interface FeeEstimatorProps {
  allocation: AssetAllocation[];
  horizonYears: number;
  baseCurrency: string;
  hedged?: boolean;
  /**
   * Per-bucket ETF implementations from the BuildPortfolio table. When
   * supplied, the Fee Estimator reads each bucket's actual TER from the
   * picked ETF instead of the asset-class default — switching an ETF in
   * the per-bucket picker now updates Blended TER, Annual Fee and the
   * 30-year drag chart immediately.
   */
  etfImplementations?: ReadonlyArray<ETFImplementation>;
}

// Format an integer with US-style thousand separators ("100,000"). We use
// en-US to match the existing currency display below (`Intl.NumberFormat
// "en-US"` for $100,000 / CHF 100,000 etc.) so the input and the result
// cards read the same way.
//
// In this scheme `,` is ALWAYS the thousand separator and `.` is ALWAYS the
// decimal separator — same convention as the en-US currency formatter.
// We strip apostrophes/spaces/commas as group separators, then re-group
// the integer part. The decimal portion (and partial mid-typing states
// like "100,000." or "100,000.5") is preserved as-is.
//
// Trade-off: a user typing the European decimal "100000,50" would have
// the comma swallowed by the de-grouping pass and end up with 10000050.
// For an "Investment Amount" field this is acceptable — operators type
// large integers, not centimes; the manualWeights audit comment already
// notes parseDecimalInput is the comma-decimal-friendly path for the
// fields where mid-edit cents matter (per-bucket weight, μ/σ overrides,
// risk-free rate). The cost of supporting comma-decimal here would be a
// formatter that can't tell "5,5" (decimal) from "5,500" (thousand) until
// 4+ digits arrive, which produces visible jumps mid-typing.
export function formatThousandsLive(raw: string): string {
  // Drop every grouping character: spaces, ASCII/curly apostrophes, and
  // commas. After this, the only separator left is `.` (decimal).
  const stripped = raw.replace(/[\s',’]/g, "");
  if (stripped === "" || stripped === "-" || stripped === "+") return stripped;
  // Allowed shape: optional sign, digits, optional decimal dot, optional digits.
  const match = stripped.match(/^([+-]?)(\d*)(\.?)(\d*)$/);
  if (!match) return raw;
  const [, sign, intPart, sep, decPart] = match;
  const intFormatted = intPart === ""
    ? ""
    : new Intl.NumberFormat("en-US", { useGrouping: true }).format(
        Number(intPart),
      );
  return `${sign}${intFormatted}${sep}${decPart}`;
}

export function FeeEstimator({
  allocation,
  horizonYears,
  baseCurrency,
  hedged,
  etfImplementations,
}: FeeEstimatorProps) {
  // Raw text buffer is the source of truth so mobile users on Swiss/German/
  // French keyboards can type either "100000" or "100000,50". The numeric
  // value used by the engine is derived via parseDecimalInput (accepts dot
  // *and* comma decimals, returns null on garbage). See the audit comment in
  // src/lib/manualWeights.ts for the full list of inputs touched by this fix.
  // Initial value seeded already-formatted ("100,000") to match the live-
  // formatting applied on every keystroke — otherwise the very first render
  // would show a bare "100000" which then jumps when the user starts typing.
  const [amountDraft, setAmountDraft] = useState<string>(() =>
    formatThousandsLive("100000"),
  );
  const investmentAmount = useMemo(() => {
    // Strip thousand separators (commas, spaces, Swiss apostrophes) before
    // parsing — parseDecimalInput's whitelist regex only knows digits +
    // optional dot/comma decimal separator and would otherwise reject the
    // grouped value "100,000". Same convention as `formatThousandsLive`:
    // `,` is a thousand separator, `.` is the decimal separator.
    const cleaned = amountDraft.replace(/[\s',’]/g, "");
    return parseDecimalInput(cleaned, { min: 0 }) ?? 0;
  }, [amountDraft]);

  const results = estimateFees(allocation, horizonYears, investmentAmount, {
    hedged: hedged && baseCurrency !== "USD",
    etfImplementations,
  });

  const formatCurrency = (value: number) => {
    const compact = value > 1000000;
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: baseCurrency,
      notation: compact ? "compact" : "standard",
      maximumFractionDigits: compact ? 1 : 0,
    }).format(value);
  };

  const chartData = results.projection.map(p => ({
    year: `Year ${p.year}`,
    "After Fees": Math.round(p.afterFees),
    "Zero Fee Baseline": Math.round(p.zeroFee),
  }));

  return (
    <Card className="mt-6 border-primary/20">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Wallet className="h-5 w-5 text-primary" />
          Fee Estimator
        </CardTitle>
        <CardDescription>
          Blended ETF cost and projected drag over the investment horizon. Illustrative TERs.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex flex-col sm:flex-row items-start sm:items-end gap-4 max-w-sm">
          <div className="space-y-2 w-full">
            <Label htmlFor="investment-amount">Investment Amount</Label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm font-medium">
                {baseCurrency}
              </span>
              <Input
                id="investment-amount"
                type="text"
                inputMode="decimal"
                enterKeyHint="done"
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                className="pl-12 font-mono"
                value={amountDraft}
                onChange={(e) =>
                  setAmountDraft(formatThousandsLive(e.target.value))
                }
                data-testid="input-fee-investment-amount"
              />
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card className="bg-muted/30">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Coins className="h-4 w-4 text-muted-foreground" /> Blended TER
              </CardTitle>
            </CardHeader>
            <CardContent>
              <span className="text-2xl font-mono font-bold">
                {results.blendedTerPct.toFixed(2)}% <span className="text-sm text-muted-foreground font-sans font-normal">/ yr</span>
              </span>
            </CardContent>
          </Card>
          
          <Card className="bg-muted/30">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Wallet className="h-4 w-4 text-muted-foreground" /> Annual Fee
              </CardTitle>
            </CardHeader>
            <CardContent>
              <span className="text-2xl font-mono font-bold">
                {formatCurrency(results.annualFee)} <span className="text-sm text-muted-foreground font-sans font-normal">/ yr</span>
              </span>
            </CardContent>
          </Card>

          <Card className="bg-muted/30">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <TrendingDown className="h-4 w-4 text-muted-foreground" /> Projected Drag
              </CardTitle>
            </CardHeader>
            <CardContent>
              <span className="text-2xl font-mono font-bold text-destructive">
                {results.feeDragPct.toFixed(1)}% <span className="text-sm text-muted-foreground font-sans font-normal">of final value</span>
              </span>
            </CardContent>
          </Card>
        </div>

        <div className="rounded-md border overflow-hidden">
          <Table>
            <TableHeader className="bg-muted/50">
              <TableRow>
                <TableHead>Bucket</TableHead>
                <TableHead className="text-right">Weight</TableHead>
                <TableHead className="text-right">TER (bps)</TableHead>
                <TableHead className="text-right">Contribution (bps)</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {results.breakdown.map((row) => (
                <TableRow key={row.key}>
                  <TableCell className="font-medium text-sm">{row.key}</TableCell>
                  <TableCell className="text-right font-mono text-sm">{row.weight.toFixed(1)}%</TableCell>
                  <TableCell className="text-right font-mono text-sm">{row.terBps}</TableCell>
                  <TableCell className="text-right font-mono text-sm">{(row.contributionBps).toFixed(1)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        <div className="h-[300px] mt-8">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 20, right: 20, left: 20, bottom: 20 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
              <XAxis 
                dataKey="year" 
                axisLine={false} 
                tickLine={false} 
                tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }} 
              />
              <YAxis 
                axisLine={false} 
                tickLine={false} 
                tickFormatter={(val) => new Intl.NumberFormat("en-US", { notation: "compact", compactDisplay: "short" }).format(val)} 
                tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }} 
                width={60}
              />
              <RechartsTooltip 
                formatter={(value: number) => [formatCurrency(value), undefined]}
                contentStyle={{ borderRadius: '8px', border: '1px solid hsl(var(--border))', backgroundColor: 'hsl(var(--background))', color: 'hsl(var(--foreground))' }}
              />
              <Legend wrapperStyle={{ paddingTop: '20px' }} />
              <Line 
                type="monotone" 
                dataKey="Zero Fee Baseline" 
                stroke="hsl(var(--muted-foreground))" 
                strokeWidth={2}
                strokeDasharray="5 5"
                dot={false}
                activeDot={{ r: 6 }}
              />
              <Line 
                type="monotone" 
                dataKey="After Fees" 
                stroke="hsl(var(--primary))" 
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 6 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
        
        <p className="text-xs text-muted-foreground text-center pt-4">
          Illustrative only. Real ETF TERs vary; trading, FX, and platform costs are not included.
        </p>
      </CardContent>
    </Card>
  );
}
