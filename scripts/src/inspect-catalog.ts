import { readFile } from "node:fs/promises";

const ETFS = "artifacts/investment-lab/src/lib/etfs.ts";

async function main(): Promise<void> {
  const src = await readFile(ETFS, "utf8");

  const instrumentMatches = src.match(/^\s{2}"([A-Z]{2}[A-Z0-9]{9}\d)":\s*I\(/gm) ?? [];
  const bucketMatches = src.match(/^\s{2}"([^"]+)":\s*B\(\{/gm) ?? [];
  const defaultMatches = Array.from(
    src.matchAll(/default:\s*"([A-Z]{2}[A-Z0-9]{9}\d)"/g),
    (m) => m[1],
  );
  const altMatches = Array.from(
    src.matchAll(/alternatives:\s*\[([^\]]*)\]/g),
  ).flatMap((m) =>
    Array.from(m[1].matchAll(/"([A-Z]{2}[A-Z0-9]{9}\d)"/g), (mm) => mm[1]),
  );

  const allUsedIsins = [...defaultMatches, ...altMatches];
  const dupes = allUsedIsins.filter(
    (isin, i, arr) => arr.indexOf(isin) !== i,
  );

  console.log(
    JSON.stringify(
      {
        instrumentRows: instrumentMatches.length,
        bucketRows: bucketMatches.length,
        defaultsAssigned: defaultMatches.length,
        alternativesAssigned: altMatches.length,
        totalAssignments: allUsedIsins.length,
        crossBucketDuplicates: Array.from(new Set(dupes)),
      },
      null,
      2,
    ),
  );
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
