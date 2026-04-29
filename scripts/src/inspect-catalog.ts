
  import { readFile, writeFile } from "node:fs/promises";
  import { parseCatalogFromSource } from "../api-server/src/lib/catalog-parser";

  const ETFS = "/home/runner/workspace/artifacts/investment-lab/src/lib/etfs.ts";
  const src = await readFile(ETFS, "utf8");
  const cat = parseCatalogFromSource(src);
  const summary = {
    bucketCount: Object.keys(cat).length,
    totalIsins: 0,
    uniqueIsins: new Set<string>(),
  };
  for (const [k, e] of Object.entries(cat)) {
    summary.totalIsins++;
    summary.uniqueIsins.add(e.isin);
    for (const a of e.alternatives ?? []) {
      summary.totalIsins++;
      summary.uniqueIsins.add(a.isin);
    }
  }
  console.log(JSON.stringify({
    bucketCount: summary.bucketCount,
    totalIsins: summary.totalIsins,
    uniqueIsins: summary.uniqueIsins.size,
  }, null, 2));
  