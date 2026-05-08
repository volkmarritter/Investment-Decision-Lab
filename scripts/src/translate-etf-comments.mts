#!/usr/bin/env node
// ----------------------------------------------------------------------------
// translate-etf-comments.mts — Task #214
// ----------------------------------------------------------------------------
// One-shot migration: AI-translates every English `comment` field in the
// INSTRUMENTS block of `etfs.ts` into German and persists the result as
// `commentDe` on the same row.
//
// Source priority:
//   - Skips rows that already have a non-empty `commentDe` unless --force.
//   - Skips rows with an empty `comment` (nothing to translate).
//
// Translation: batches of 20 to gpt-4o-mini via the Replit OpenAI
// integration proxy. Asks for a JSON array back so we can map results
// 1:1 to ISINs without parsing free-form text.
//
// Writes are performed via the same regex/upsertField helpers the
// auto-backfill uses (re-exported from backfill-comments.mjs) so the
// edit shape stays byte-identical to existing tooling.
//
// CLI:
//   pnpm --filter @workspace/scripts run translate-comments
//   FORCE=1   → re-translate rows that already have commentDe
//   DRY_RUN=1 → log what would be translated, do not write etfs.ts
//   LIMIT=N   → cap the number of rows processed (debugging)
// ----------------------------------------------------------------------------

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
// @ts-expect-error — sibling .mjs script with no .d.ts.
import { __test as backfillTest } from "../../artifacts/investment-lab/scripts/backfill-comments.mjs";

const { ROW_RE, extractField, upsertField } = backfillTest as {
  ROW_RE: RegExp;
  extractField: (body: string, key: string) => string | undefined;
  upsertField: (
    body: string,
    key: string,
    value: string,
  ) => { body: string; changed: boolean };
};

const __dirname = dirname(fileURLToPath(import.meta.url));
const ETFS_TS = resolve(
  __dirname,
  "../../artifacts/investment-lab/src/lib/etfs.ts",
);

const BATCH_SIZE = 20;
const MODEL = "gpt-4o-mini";

interface Candidate {
  isin: string;
  comment: string;
}

export function findCandidates(src: string, force: boolean): Candidate[] {
  const out: Candidate[] = [];
  for (const m of src.matchAll(ROW_RE)) {
    const isin = m[2];
    const body = m[3];
    const comment = (extractField(body, "comment") ?? "").trim();
    if (!comment) continue;
    const existingDe = (extractField(body, "commentDe") ?? "").trim();
    if (existingDe && !force) continue;
    out.push({ isin, comment });
  }
  return out;
}

const SYSTEM_PROMPT =
  "You are a professional financial translator. Translate the following short ETF descriptions from English into German. Preserve all financial terminology, ETF/index names, ticker symbols, currency codes, percentages and ISINs verbatim. Keep the same neutral, factual register and roughly the same length. Do NOT add commentary, do NOT translate proper nouns of products or indices, and do NOT change numerical values. Return STRICT JSON of the form {\"translations\":[{\"i\":<index>,\"de\":\"<german text>\"}, ...]} with one entry per input item, in the same order. No prose outside the JSON.";

export async function translateBatch(
  batch: Candidate[],
  fetcher: typeof fetch = fetch,
): Promise<Map<string, string>> {
  const baseUrl = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
  const apiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
  if (!baseUrl || !apiKey) {
    throw new Error(
      "AI_INTEGRATIONS_OPENAI_BASE_URL / AI_INTEGRATIONS_OPENAI_API_KEY not set. Run setupReplitAIIntegrations first.",
    );
  }
  const userPayload = {
    items: batch.map((c, i) => ({ i, en: c.comment })),
  };
  const res = await fetcher(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: JSON.stringify(userPayload) },
      ],
      response_format: { type: "json_object" },
      temperature: 0.2,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(
      `OpenAI chat.completions ${res.status}: ${body.slice(0, 400)}`,
    );
  }
  const json = (await res.json()) as {
    choices: { message: { content: string } }[];
  };
  const content = json.choices?.[0]?.message?.content ?? "";
  let parsed: { translations?: { i: number; de: string }[] };
  try {
    parsed = JSON.parse(content);
  } catch (err) {
    throw new Error(
      `OpenAI returned non-JSON content: ${content.slice(0, 400)} — ${(err as Error).message}`,
    );
  }
  const result = new Map<string, string>();
  for (const t of parsed.translations ?? []) {
    const candidate = batch[t.i];
    if (!candidate) continue;
    const de = (t.de ?? "").trim();
    if (de) result.set(candidate.isin, de);
  }
  return result;
}

interface RunOptions {
  force?: boolean;
  dryRun?: boolean;
  limit?: number;
  fetcher?: typeof fetch;
  log?: Pick<Console, "log" | "warn">;
}

export async function translateCatalogComments(opts: RunOptions = {}): Promise<{
  scanned: number;
  translated: number;
  skipped: number;
  failed: number;
}> {
  const log = opts.log ?? console;
  const src = await readFile(ETFS_TS, "utf8");
  const all = findCandidates(src, opts.force === true);
  const candidates =
    typeof opts.limit === "number" && opts.limit > 0
      ? all.slice(0, opts.limit)
      : all;

  if (candidates.length === 0) {
    log.log?.("translate-etf-comments: no rows need translation.");
    return { scanned: 0, translated: 0, skipped: 0, failed: 0 };
  }
  log.log?.(
    `translate-etf-comments: ${candidates.length} row(s) to translate (batch=${BATCH_SIZE}).`,
  );

  let next = src;
  let translated = 0;
  let failed = 0;
  for (let start = 0; start < candidates.length; start += BATCH_SIZE) {
    const batch = candidates.slice(start, start + BATCH_SIZE);
    log.log?.(
      `  batch ${start / BATCH_SIZE + 1}/${Math.ceil(candidates.length / BATCH_SIZE)} (${batch.length} item(s))`,
    );
    let map: Map<string, string>;
    try {
      map = await translateBatch(batch, opts.fetcher);
    } catch (err) {
      log.warn?.(
        `  ! batch failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      failed += batch.length;
      continue;
    }
    for (const c of batch) {
      const de = map.get(c.isin);
      if (!de) {
        log.warn?.(`    ! ${c.isin}: missing translation in response`);
        failed++;
        continue;
      }
      const rowRe = new RegExp(
        `( {2}"${c.isin}":\\s*I\\(\\{)([\\s\\S]*?)(\\n {2}\\}\\),)`,
      );
      const rowMatch = next.match(rowRe);
      if (!rowMatch) {
        log.warn?.(`    ! ${c.isin}: row vanished mid-run`);
        failed++;
        continue;
      }
      const [, head, body, tail] = rowMatch;
      const r = upsertField(body, "commentDe", de);
      if (!r.changed) {
        log.log?.(`    · ${c.isin}: unchanged`);
        continue;
      }
      next = next.replace(rowRe, `${head}${r.body}${tail}`);
      translated++;
      log.log?.(`    ✓ ${c.isin}`);
    }
  }

  if (opts.dryRun) {
    log.log?.("DRY_RUN — not writing etfs.ts.");
  } else if (translated > 0) {
    await writeFile(ETFS_TS, next, "utf8");
    log.log?.(
      `translate-etf-comments: wrote ${translated} commentDe field(s) to etfs.ts.`,
    );
  }

  return {
    scanned: candidates.length,
    translated,
    skipped: candidates.length - translated - failed,
    failed,
  };
}

const isCli = process.argv[1] === fileURLToPath(import.meta.url);
if (isCli) {
  const limitEnv = process.env.LIMIT
    ? Number.parseInt(process.env.LIMIT, 10)
    : undefined;
  translateCatalogComments({
    force: process.env.FORCE === "1",
    dryRun: process.env.DRY_RUN === "1",
    limit: Number.isFinite(limitEnv) ? limitEnv : undefined,
  })
    .then((r) => {
      console.log(
        `Done. scanned=${r.scanned} translated=${r.translated} failed=${r.failed} skipped=${r.skipped}.`,
      );
      process.exit(r.failed > r.translated ? 1 : 0);
    })
    .catch((e) => {
      console.error("Fatal:", e);
      process.exit(2);
    });
}
