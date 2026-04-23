export interface ParsedPositionRow {
  assetClass: string;
  region: string;
  weight: number;
}

export interface CsvParseResult {
  rows: ParsedPositionRow[];
  errors: string[];
  warnings: string[];
}

const CANONICAL_ASSET_CLASSES = [
  "Equities",
  "Bonds",
  "Cash",
  "Commodities",
  "Listed Real Estate",
  "Crypto",
];

export function parsePositionsCsv(text: string): CsvParseResult {
  const result: CsvParseResult = { rows: [], errors: [], warnings: [] };
  
  if (!text || !text.trim()) {
    result.errors.push("No content provided.");
    return result;
  }

  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
  
  if (lines.length === 0) {
    result.errors.push("No valid rows found.");
    return result;
  }

  const headerLine = lines[0];
  const commaCount = (headerLine.match(/,/g) || []).length;
  const semiCount = (headerLine.match(/;/g) || []).length;
  const delimiter = semiCount > commaCount ? ";" : ",";

  const splitRow = (row: string) => {
    // Simple split for now, assuming no quotes are used for escaping delimiters
    return row.split(delimiter).map(cell => cell.trim());
  };

  const headers = splitRow(headerLine).map(h => h.toLowerCase().replace(/%/g, '').trim());
  
  const assetClassIdx = headers.findIndex(h => h === "asset class" || h === "assetclass");
  const regionIdx = headers.findIndex(h => h === "region");
  const weightIdx = headers.findIndex(h => h === "weight" || h === "weight percentage");

  if (assetClassIdx === -1 || regionIdx === -1 || weightIdx === -1) {
    result.errors.push(`Missing required columns. Found: ${headers.join(", ")}. Expected: Asset Class, Region, Weight.`);
    return result;
  }

  for (let i = 1; i < lines.length; i++) {
    if (result.rows.length >= 50) {
      result.warnings.push(`Row ${i + 1} and beyond ignored (max 50 rows allowed).`);
      break;
    }

    const cells = splitRow(lines[i]);
    if (cells.length <= Math.max(assetClassIdx, regionIdx, weightIdx)) {
      result.warnings.push(`Row ${i + 1}: Not enough columns, skipping.`);
      continue;
    }

    const rawAssetClass = cells[assetClassIdx];
    const rawRegion = cells[regionIdx];
    const rawWeight = cells[weightIdx];

    if (!rawAssetClass || !rawRegion || !rawWeight) {
      result.warnings.push(`Row ${i + 1}: Missing data in required columns, skipping.`);
      continue;
    }

    let parsedWeightStr = rawWeight.replace(/%/g, "").trim();
    if (parsedWeightStr.includes(",") && !parsedWeightStr.includes(".")) {
      parsedWeightStr = parsedWeightStr.replace(",", ".");
    }
    const weight = Number(parsedWeightStr);

    if (isNaN(weight)) {
      result.errors.push(`Row ${i + 1}: Invalid weight '${rawWeight}'. Must be a number.`);
      continue; // errors are blocking, but let's accumulate them
    }

    let assetClass = rawAssetClass;
    const match = CANONICAL_ASSET_CLASSES.find(c => c.toLowerCase() === rawAssetClass.toLowerCase());
    if (match) {
      assetClass = match;
    } else {
      result.warnings.push(`Row ${i + 1}: unknown asset class '${rawAssetClass}'. Keep as-is.`);
    }

    result.rows.push({
      assetClass,
      region: rawRegion,
      weight,
    });
  }

  if (result.rows.length === 0 && result.errors.length === 0) {
    result.errors.push("No valid data rows found.");
  }

  return result;
}
