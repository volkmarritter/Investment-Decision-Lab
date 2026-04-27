export const CHART_COLORS = [
  "hsl(var(--chart-1))",
  "hsl(var(--chart-2))",
  "hsl(var(--chart-3))",
  "hsl(var(--chart-4))",
  "hsl(var(--chart-5))",
  "hsl(var(--primary))",
];

const SUB_ASSET_COLOR = {
  equityUS:       "hsl(220, 65%, 52%)",
  equityEurope:   "hsl(150, 50%, 42%)",
  equityUK:       "hsl(355, 65%, 52%)",
  equitySwiss:    "hsl(55, 95%, 55%)",
  equityJapan:    "hsl(330, 60%, 60%)",
  equityEM:       "hsl(20, 75%, 55%)",
  equityThematic: "hsl(280, 50%, 58%)",
  equityGlobal:   "hsl(190, 60%, 48%)",
  bonds:          "hsl(210, 25%, 45%)",
  cash:           "hsl(0, 0%, 62%)",
  gold:           "hsl(35, 75%, 48%)",
  reits:          "hsl(15, 55%, 50%)",
  crypto:         "hsl(265, 65%, 62%)",
} as const;

const RULES: Array<{ test: RegExp; color: string }> = [
  { test: /(us equity|equity\s*[-–]\s*usa|us[\s-]?aktien|aktien\s*us)/i,                                color: SUB_ASSET_COLOR.equityUS },
  { test: /(swiss equity|equity\s*[-–]\s*switzerland|aktien\s*ch|schweiz)/i,                            color: SUB_ASSET_COLOR.equitySwiss },
  { test: /(uk equity|equity\s*[-–]\s*(uk|united kingdom)|aktien\s*(uk|gb))/i,                          color: SUB_ASSET_COLOR.equityUK },
  { test: /(japan equity|equity\s*[-–]\s*japan|aktien\s*japan)/i,                                       color: SUB_ASSET_COLOR.equityJapan },
  { test: /(em equity|equity\s*[-–]\s*em|emerging|schwellen)/i,                                         color: SUB_ASSET_COLOR.equityEM },
  { test: /(thematic equity|equity\s*[-–]\s*thematic|themat)/i,                                         color: SUB_ASSET_COLOR.equityThematic },
  { test: /(europe equity|equity\s*[-–]\s*europe|europ.*aktien|aktien.*europ)/i,                        color: SUB_ASSET_COLOR.equityEurope },
  { test: /(global equity|equity\s*[-–]\s*global)/i,                                                    color: SUB_ASSET_COLOR.equityGlobal },
  { test: /(crypto|digital)/i,                                                                          color: SUB_ASSET_COLOR.crypto },
  { test: /(real estate|reit|immobilien)/i,                                                             color: SUB_ASSET_COLOR.reits },
  { test: /(gold|commodit|rohstoff)/i,                                                                  color: SUB_ASSET_COLOR.gold },
  { test: /(bond|fixed income|anleihen|renten)/i,                                                       color: SUB_ASSET_COLOR.bonds },
  { test: /(cash|geldmarkt|liquid)/i,                                                                   color: SUB_ASSET_COLOR.cash },
  { test: /(equity|aktien|stock)/i,                                                                     color: SUB_ASSET_COLOR.equityGlobal },
];

function hashColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) {
    h = ((h << 5) - h + name.charCodeAt(i)) | 0;
  }
  const palette = Object.values(SUB_ASSET_COLOR);
  return palette[Math.abs(h) % palette.length];
}

export function colorForBucket(name: string): string {
  for (const r of RULES) {
    if (r.test.test(name)) return r.color;
  }
  return hashColor(name);
}

// Canonical display order for asset-class buckets across pie chart, legend,
// stacked bar and bucket table. Same convention as standard asset-allocation
// reporting: equity (by region) → fixed income → real estate → commodities →
// cash → digital assets. Lower number = shown first.
const ORDER_RULES: Array<{ test: RegExp; rank: number }> = [
  { test: /(us equity|equity\s*[-–]\s*usa|us[\s-]?aktien|aktien\s*us)/i,                                rank: 11 },
  { test: /(europe equity|equity\s*[-–]\s*europe|europ.*aktien|aktien.*europ)/i,                        rank: 12 },
  { test: /(uk equity|equity\s*[-–]\s*(uk|united kingdom)|aktien\s*(uk|gb))/i,                          rank: 13 },
  { test: /(swiss equity|equity\s*[-–]\s*switzerland|aktien\s*ch|schweiz)/i,                            rank: 14 },
  { test: /(japan equity|equity\s*[-–]\s*japan|aktien\s*japan)/i,                                       rank: 15 },
  { test: /(em equity|equity\s*[-–]\s*em|emerging|schwellen)/i,                                         rank: 16 },
  { test: /(thematic equity|equity\s*[-–]\s*thematic|themat)/i,                                         rank: 17 },
  { test: /(global equity|equity\s*[-–]\s*global)/i,                                                    rank: 18 },
  { test: /(equity\s*[-–]\s*home)/i,                                                                    rank: 19 },
  { test: /(equity|aktien|stock)/i,                                                                     rank: 20 },
  { test: /(bond|fixed income|anleihen|renten)/i,                                                       rank: 30 },
  { test: /(real estate|reit|immobilien)/i,                                                             rank: 40 },
  { test: /(gold|commodit|rohstoff)/i,                                                                  rank: 50 },
  { test: /(cash|geldmarkt|liquid)/i,                                                                   rank: 60 },
  { test: /(crypto|digital)/i,                                                                          rank: 70 },
];

export function bucketOrderKey(name: string): number {
  for (const r of ORDER_RULES) {
    if (r.test.test(name)) return r.rank;
  }
  return 99;
}

