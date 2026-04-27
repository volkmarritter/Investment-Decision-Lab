export const CHART_COLORS = [
  "hsl(var(--chart-1))",
  "hsl(var(--chart-2))",
  "hsl(var(--chart-3))",
  "hsl(var(--chart-4))",
  "hsl(var(--chart-5))",
  "hsl(var(--primary))",
];

const ASSET_CLASS_COLOR: Record<string, string> = {
  equity: CHART_COLORS[0],
  fixedIncome: CHART_COLORS[1],
  realEstate: CHART_COLORS[2],
  commodities: CHART_COLORS[3],
  crypto: CHART_COLORS[4],
  cash: CHART_COLORS[5],
};

const RULES: Array<{ test: RegExp; color: string }> = [
  { test: /(^|[\s\-_])(crypto|digital)/i, color: ASSET_CLASS_COLOR.crypto },
  { test: /(real estate|reit|immobilien)/i, color: ASSET_CLASS_COLOR.realEstate },
  { test: /(gold|commodit|rohstoff)/i, color: ASSET_CLASS_COLOR.commodities },
  { test: /(cash|geldmarkt|liquid)/i, color: ASSET_CLASS_COLOR.cash },
  { test: /(bond|fixed income|anleihen|renten)/i, color: ASSET_CLASS_COLOR.fixedIncome },
  { test: /(equity|aktien|stock)/i, color: ASSET_CLASS_COLOR.equity },
];

function hashColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) {
    h = ((h << 5) - h + name.charCodeAt(i)) | 0;
  }
  return CHART_COLORS[Math.abs(h) % CHART_COLORS.length];
}

export function colorForBucket(name: string): string {
  for (const r of RULES) {
    if (r.test.test(name)) return r.color;
  }
  return hashColor(name);
}
