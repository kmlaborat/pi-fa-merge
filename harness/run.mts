#!/usr/bin/env node
/**
 * run.ts — Baseline evaluation harness for pi-fa-merge.
 *
 * (TS because it imports the extension's pure functions directly; run with
 * `npx tsx harness/run.mts`.)
 *
 * Drives the fa_merge CORE pipeline directly (no file writing):
 *
 *   buildPrompt → callOpenAiCompatibleApi → parseOutput
 *
 * using the real endpoint/model from the installed package .env, against
 * the stratified sample in harness/cases.json (from the
 * Kortix/FastApply-dataset-v1.0 test split).
 *
 * Metrics per case:
 *   - latency_ms
 *   - API success / error code (MALFORMED_OUTPUT, STRUCTURE_MANGLE_ERROR, API_ERROR, ...)
 *   - exact match vs ground-truth final_code
 *   - whitespace-normalized match (per-line trailing trim + outer blank trim)
 *   - line-similarity (Dice over LCS of lines; null if too large)
 *   - estimated input/output tokens (chars/4 heuristic, same as performMerge)
 *
 * Output:
 *   harness/results/<run-id>/results.jsonl   — one record per case
 *   harness/results/<run-id>/summary.md      — aggregate metrics
 *   harness/results/<run-id>/failures/<id>.raw.txt — raw model output on failure
 *
 * Modes (--mode):
 *   full-code   <code> = full file, <update> = code snippet (default; baseline A)
 *   block-code  <code> = minimal block (header + hunks ±5), <update> = rescoped snippet (B)
 *   block-nl    <code> = minimal block, <update> = natural-language instruction (C;
 *               instructions from harness/instructions.json: {case_id: text})
 *   full-nl     <code> = full file, <update> = natural-language instruction (D)
 *
 * Block modes report two metric levels: block-level (model output vs the
 * expected block) and file-level (the block spliced back into the original
 * file vs the ground-truth full file — the metric that matters for the
 * agent-loop vision).
 *
 * Usage:
 *   npx tsx harness/run.mts --mode block-code           # all cases, mode B
 *   npx tsx harness/run.mts --case 0 --case 3           # specific cases
 *
 * Env:
 *   FA_MERGE_ENV_FILE — path to the .env to load (default: the installed
 *     package .env, which holds the real API key). Loaded with the
 *     package's own applyEnvContent rules (only FAST_APPLY_- and ANCHOREDIT_-
 *     prefixed keys, file overrides process.env).
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { applyEnvContent } from "../extensions/env.ts";
import {
  buildPrompt,
  callOpenAiCompatibleApi,
  parseOutput,
  isRetryable,
} from "../extensions/core.ts";

const here = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const CASES_FILE = join(here, "cases.json");
const CASES_BLOCK_FILE = join(here, "cases-block.json");
const INSTRUCTIONS_FILE = join(here, "instructions.json");
const DEFAULT_ENV_FILE =
  process.env.FA_MERGE_ENV_FILE ??
  "C:\\Users\\Game\\MyDevEnv\\.home\\.pi\\agent\\git\\github.com\\kmlaborat\\pi-fa-merge\\.env";

// Load the installed package .env with the package's own rules.
let ENV_CONTENT = "";
try {
  ENV_CONTENT = readFileSync(DEFAULT_ENV_FILE, "utf-8");
  const ignored = applyEnvContent(ENV_CONTENT, process.env);
  console.log(`Loaded .env from: ${DEFAULT_ENV_FILE}`);
  if (ignored.length > 0) console.log(`  (ignored non-prefixed keys: ${ignored.join(", ")})`);
} catch (e) {
  console.error(`WARNING: cannot load .env from ${DEFAULT_ENV_FILE}: ${e.message}`);
  console.error("Falling back to existing process.env values.");
}

/** Parse keys with a given prefix (e.g. "FASTCONTEXT_") from raw .env
 *  content. applyEnvContent only applies the FAST_APPLY / ANCHOREDIT
 *  prefixes; the agent-rewrite experiment needs FASTCONTEXT keys too. */
function parseEnvPrefix(content: string, prefix: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of content.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i <= 0) continue;
    const k = t.slice(0, i).trim();
    let v = t.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (k.startsWith(prefix)) out[k] = v;
  }
  return out;
}

const ENDPOINT =
  process.env.FAST_APPLY_ENDPOINT_URL ?? "https://api.fireworks.ai/inference/v1";
const MODEL = process.env.FAST_APPLY_MODEL_NAME ?? "fast-apply-7b";
const API_KEY = process.env.FAST_APPLY_API_KEY;

// Case selection + options
let MODE = "full-code";
const onlyCases = new Set();
let REWRITE_MODEL = ""; // --rewrite-model: override FASTCONTEXT_MODEL (agent-rewrite)
let REWRITE_MAX_TOKENS = 8192; // --max-tokens: completion budget (agent-rewrite)
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === "--case") onlyCases.add(parseInt(argv[++i], 10));
  if (argv[i] === "--timeout") {
    // Override AFTER the .env load (harness driver may need a longer
    // timeout than the installed .env specifies for slow local models).
    process.env.FAST_APPLY_TIMEOUT = argv[++i];
  }
  if (argv[i] === "--mode") MODE = argv[++i];
  if (argv[i] === "--rewrite-model") REWRITE_MODEL = argv[++i];
  if (argv[i] === "--max-tokens") REWRITE_MAX_TOKENS = parseInt(argv[++i], 10);
}
if (!["full-code", "block-code", "block-nl", "full-nl", "agent-rewrite"].includes(MODE)) {
  console.error(`ERROR: unknown --mode ${MODE} (expected full-code | block-code | block-nl | full-nl | agent-rewrite)`);
  process.exit(1);
}

const needsInstructions = MODE === "block-nl" || MODE === "full-nl" || MODE === "agent-rewrite";
let instructions: Record<number, string> = {};
if (needsInstructions) {
  instructions = JSON.parse(readFileSync(INSTRUCTIONS_FILE, "utf-8"));
}
const allCases = JSON.parse(
  readFileSync(MODE.includes("block") || MODE === "agent-rewrite" ? CASES_BLOCK_FILE : CASES_FILE, "utf-8")
);

// agent-rewrite mode calls a general instruct model (not fast-apply):
// block + NL instruction -> the model rewrites the whole block.
const IS_REWRITE = MODE === "agent-rewrite";
let RW_ENDPOINT = "", RW_KEY = "", RW_MODEL = "";
if (IS_REWRITE) {
  const fc = parseEnvPrefix(ENV_CONTENT, "FASTCONTEXT_");
  RW_ENDPOINT = fc.FASTCONTEXT_ENDPOINT ?? "";
  RW_KEY = fc.FASTCONTEXT_API_KEY ?? process.env.FASTCONTEXT_API_KEY ?? "";
  RW_MODEL = REWRITE_MODEL || fc.FASTCONTEXT_MODEL || "";
  if (!RW_ENDPOINT || !RW_KEY || !RW_MODEL) {
    console.error("ERROR: FASTCONTEXT_ENDPOINT/FASTCONTEXT_API_KEY/FASTCONTEXT_MODEL not found in .env");
    process.exit(1);
  }
}

if (IS_REWRITE) {
  console.log(`Endpoint: ${RW_ENDPOINT}`);
  console.log(`Model:    ${RW_MODEL} (agent-rewrite)`);
} else {
  console.log(`Endpoint: ${ENDPOINT}`);
  console.log(`Model:    ${MODEL}`);
  if (!API_KEY) {
    console.error("ERROR: FAST_APPLY_API_KEY not set after .env load — aborting.");
    process.exit(1);
  }
}
const cases = onlyCases.size > 0 ? allCases.filter((c) => onlyCases.has(c.case_id)) : allCases;
if (needsInstructions) {
  for (const c of cases) {
    if (!instructions[c.case_id]) {
      console.error(`ERROR: no natural-language instruction for case ${c.case_id} in ${INSTRUCTIONS_FILE}`);
      process.exit(1);
    }
  }
}
console.log(`Mode: ${MODE}`);
console.log(`Cases to run: ${cases.length}\n`);

// ---------------------------------------------------------------------------
// Comparison helpers
// ---------------------------------------------------------------------------

/** Normalize: CRLF→LF, trim trailing whitespace per line, trim outer blank lines. */
function normalizeWs(code) {
  const lines = code.replace(/\r\n/g, "\n").split("\n").map((l) => l.replace(/\s+$/, ""));
  while (lines.length > 0 && lines[0] === "") lines.shift();
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines.join("\n");
}

/** Replace line range [start, end] (inclusive, 0-based) of `full` with `replacement`. */
function spliceRange(full: string, start: number, end: number, replacement: string): string {
  const lines = full.replace(/\r\n/g, "\n").split("\n");
  return lines.slice(0, start).concat(replacement.split("\n")).concat(lines.slice(end + 1)).join("\n");
}

/** Dice similarity over LCS of lines: 2*LCS/(n+m). Null if n*m is too large. */
function lineSimilarity(a, b) {
  const la = a.replace(/\r\n/g, "\n").split("\n");
  const lb = b.replace(/\r\n/g, "\n").split("\n");
  const n = la.length, m = lb.length;
  if (n === 0 && m === 0) return 1;
  if (n === 0 || m === 0) return 0;
  if (n * m > 9_000_000) return null; // too large — skip
  // LCS DP with Uint32Array rows
  let prev = new Uint32Array(m + 1);
  let cur = new Uint32Array(m + 1);
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      cur[j] = la[i - 1] === lb[j - 1]
        ? prev[j - 1] + 1
        : Math.max(prev[j], cur[j - 1]);
    }
    [prev, cur] = [cur, prev];
  }
  const lcs = prev[m];
  return 2 * lcs / (n + m);
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

const MAX_API_RETRIES = 3;
const INITIAL_DELAY_MS = 1000;

async function callWithRetry(messages, endpoint, key, model, opts?: { retryTimeout?: boolean; extraBody?: Record<string, unknown>; stream?: boolean }) {
  let lastError = null;
  for (let attempt = 0; attempt <= MAX_API_RETRIES; attempt++) {
    try {
      return { content: await callOpenAiCompatibleApi(endpoint, key, model, messages, opts?.extraBody, { stream: opts?.stream }), attempts: attempt + 1 };
    } catch (error) {
      lastError = error;
      const retryable = isRetryable(error) ||
        (opts?.retryTimeout === true && (error as Error).name === "AbortError");
      if (attempt < MAX_API_RETRIES && retryable) {
        const delay = INITIAL_DELAY_MS * 2 ** attempt;
        console.log(`    retry ${attempt + 1} after ${delay}ms (${error.message})`);
        await new Promise((r) => setTimeout(r, delay));
      } else {
        break;
      }
    }
  }
  throw lastError;
}

const runId = new Date().toISOString().replace(/[:.]/g, "-");
const outDir = join(here, "results", runId);
const failDir = join(outDir, "failures");
mkdirSync(failDir, { recursive: true });

const results = [];
let totalLatency = 0;

for (const c of cases) {
  // Per-mode inputs and expectations. In full-code mode the "block" is the
  // whole file, so block-level and file-level metrics coincide.
  const isFull = MODE === "full-code" || MODE === "full-nl";
  const originalCode = isFull ? c.original_code : c.block_original;
  const updateSnippet = IS_REWRITE
    ? instructions[c.case_id]
    : isFull
      ? MODE === "full-nl" ? instructions[c.case_id] : c.update_snippet
      : MODE === "block-code" ? c.block_update : instructions[c.case_id];
  const expectedBlock = isFull ? c.final_code : c.block_final;
  // Prompt: fast-apply template (byte-exact) for merge modes, plain editor
  // prompt for agent-rewrite (general instruct model).
  const messages = IS_REWRITE
    ? [
        { role: "system" as const, content: "You are an expert code editor. You rewrite code blocks to exactly implement the given instruction." },
        { role: "user" as const, content: `Rewrite the following code block to implement the instruction.
- Preserve the block's structure, order, comments, and indentation, except where the instruction changes them.
- Return ONLY the complete rewritten block. No explanations, no code fences, no ellipses or placeholders.

<code>
${originalCode}
</code>

Instruction: ${updateSnippet}` },
      ]
    : buildPrompt(originalCode, updateSnippet);

  const t0 = Date.now();
  const record = {
    mode: MODE,
    model: IS_REWRITE ? RW_MODEL : MODEL,
    case_id: c.case_id,
    stratum: c.stratum,
    file_name: c.file_name,
    block_lines: c.block_lines ?? c.line_count,
    est_input_tokens: Math.floor((originalCode.length + updateSnippet.length) / 4),
    latency_ms: 0,
    api_attempts: null,
    api_error: null,
    parse_error: null,
    parse_success: false,
    exact_block: false,
    ws_block: false,
    sim_block: null,
    exact_file: false,
    ws_file: false,
    est_output_tokens: null,
  };

  try {
    const { content, attempts } = await callWithRetry(
      messages,
      IS_REWRITE ? RW_ENDPOINT : ENDPOINT,
      IS_REWRITE ? RW_KEY : API_KEY,
      IS_REWRITE ? RW_MODEL : MODEL,
      // The Thinking variant spends thousands of tokens on
      // reasoning_content before answering (probe: 4096 tokens on a
      // trivial prompt), so it needs a large --max-tokens and a long
      // --timeout. Timeouts are retried (the endpoint is flaky on the
      // shared GPU); fast-apply modes keep the original semantics.
      {
        retryTimeout: IS_REWRITE,
        // CoT is controlled by the chat template (model names
        // Agents-A1-4B-Instruct / -Thinking), so only the completion
        // budget is passed here.
        extraBody: IS_REWRITE ? { max_tokens: REWRITE_MAX_TOKENS } : undefined,
        // Streaming keeps the connection alive past the server's ~300s
        // non-streaming cutoff (required for the Thinking variant's
        // long generations).
        stream: IS_REWRITE,
      }
    );
    record.api_attempts = attempts;
    record.latency_ms = Date.now() - t0;
    totalLatency += record.latency_ms;

    // agent-rewrite: the model returns the block directly (no fast-apply
    // tag contract). Light cleanup only: code fences + one outer newline.
    let parsedCode: string | null = null;
    if (IS_REWRITE) {
      let out = content;
      const fence = out.match(/^```[^\n]*\n?([\s\S]*?)\n?```$/);
      if (fence) out = fence[1];
      if (out.startsWith("\n")) out = out.slice(1);
      if (out.endsWith("\n")) out = out.slice(0, -1);
      record.rewrite_has_ellipsis = /(^|\n)\s*\.\.\.\s*(existing|code)?\s*(\n|$)|…/m.test(out);
      parsedCode = out;
      record.parse_success = true;
    } else {
      const parsed = parseOutput(content, originalCode);
      if (!parsed.success) {
        record.parse_error = parsed.error;
        record.parse_details = parsed.details;
        writeFileSync(join(failDir, `${c.case_id}.raw.txt`), content, "utf-8");
      } else {
        parsedCode = parsed.updated_code;
      }
    }
    if (record.parse_success) {
      const code = parsedCode!;
      record.est_output_tokens = Math.floor(code.length / 4);
      // Block-level metrics: model output vs expected block.
      record.exact_block = code === expectedBlock;
      record.ws_block = normalizeWs(code) === normalizeWs(expectedBlock);
      record.sim_block =
        record.exact_block ? 1 : lineSimilarity(code, expectedBlock);
      // File-level metrics: splice the model's block back into the original
      // file and compare with the ground-truth full file.
      const fullOut = isFull
        ? code
        : spliceRange(c.original_code, c.orig_start, c.orig_end, code);
      record.exact_file = fullOut === c.final_code;
      record.ws_file = normalizeWs(fullOut) === normalizeWs(c.final_code);
      if (!record.ws_block) {
        writeFileSync(join(failDir, `${c.case_id}.raw.txt`), code, "utf-8");
      }
    }
  } catch (e) {
    record.latency_ms = Date.now() - t0;
    totalLatency += record.latency_ms;
    record.api_error = e.name === "AbortError" ? "TIMEOUT" : "API_ERROR";
    record.api_error_message = e.message;
  }

  results.push(record);
  const status = record.api_error
    ? `API_FAIL(${record.api_error})`
    : record.parse_error
      ? `PARSE_FAIL(${record.parse_error})`
      : record.exact_file
        ? "EXACT"
        : record.ws_file
          ? "WS_FILE"
          : `DIFF(sim=${record.sim_block?.toFixed(3)}${isFull ? "" : ",file=" + (record.ws_file ? "ws" : "diff")})`;
  console.log(
    `case ${String(c.case_id).padStart(2)} [${c.stratum}] ${status} ` +
      `${record.latency_ms}ms in~${record.est_input_tokens}tok (block ${record.block_lines}L)`
  );
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

const n = results.length;
const apiOk = results.filter((r) => !r.api_error);
const parsed = results.filter((r) => r.parse_success);
const exact = results.filter((r) => r.exact_file);
const ws = results.filter((r) => r.ws_file);
const exactBlock = results.filter((r) => r.exact_block);
const sims = results
  .map((r) => r.sim_block)
  .filter((s) => s !== null && s !== undefined);
const avgSim = sims.length > 0 ? sims.reduce((a, b) => a + b, 0) / sims.length : null;
const parseErrors = {};
for (const r of results) {
  if (r.parse_error) parseErrors[r.parse_error] = (parseErrors[r.parse_error] ?? 0) + 1;
}
const apiErrors = {};
for (const r of results) {
  if (r.api_error) apiErrors[r.api_error] = (apiErrors[r.api_error] ?? 0) + 1;
}
const latencies = results.map((r) => r.latency_ms).sort((a, b) => a - b);
const medianLatency =
  n > 0 ? latencies[Math.floor(n / 2)] : 0;

writeFileSync(join(outDir, "results.jsonl"), results.map((r) => JSON.stringify(r)).join("\n") + "\n", "utf-8");

const summary = [
  `# pi-fa-merge baseline run — ${runId}`,
  "",
  `- Endpoint: \`${ENDPOINT}\`` ,
  `- Model: \`${MODEL}\``,
  `- Dataset: Kortix/FastApply-dataset-v1.0 (test split, stratified sample)`,
  `- Mode: ${MODE}`,
  `- Cases: ${n}`,
  "",
  "## 指標",
  "",
  "| 指標 | 値 |",
  "|---|---|",
  `| API 到達成功率 | ${apiOk.length}/${n} (${(100 * apiOk.length / n).toFixed(1)}%) |`,
  `| parseOutput/構造検証 通過率 | ${parsed.length}/${n} (${(100 * parsed.length / n).toFixed(1)}%) |`,
  `| 完全一致率(ファイル級) | ${exact.length}/${n} (${(100 * exact.length / n).toFixed(1)}%) |`,
  `| 完全一致率(whitespace 無視、ファイル級) | ${ws.length}/${n} (${(100 * ws.length / n).toFixed(1)}%) |`,
  ...(MODE.includes("block") ? [`| 完全一致率(ブロック級) | ${exactBlock.length}/${n} (${(100 * exactBlock.length / n).toFixed(1)}%) |`] : []),
  `| 行単位の類似度平均 (Dice/LCS, 一致時 1.0) | ${avgSim === null ? "n/a" : avgSim.toFixed(4)} |`,
  `| 中央値レイテンシ | ${medianLatency} ms |`,
  `| 総レイテンシ | ${totalLatency} ms |`,
  `| 入力推定トークン平均 | ${Math.round(results.reduce((a, r) => a + r.est_input_tokens, 0) / n)} |`,
  `| 出力推定トークン平均(成功分) | ${parsed.length ? Math.round(parsed.reduce((a, r) => a + (r.est_output_tokens ?? 0), 0) / parsed.length) : "n/a"} |`,
  "",
  "## エラー内訳",
  "",
  `- API エラー: ${Object.keys(apiErrors).length === 0 ? "なし" : Object.entries(apiErrors).map(([k, v]) => `${k}×${v}`).join(", ")}`,
  `- パース/検証エラー: ${Object.keys(parseErrors).length === 0 ? "なし" : Object.entries(parseErrors).map(([k, v]) => `${k}×${v}`).join(", ")}`,
  "",
  "## ケース別",
  "",
  "| case | stratum | 結果(ファイル級) | ブロック一致 | 類似度 | latency | in~tok |",
  "|---|---|---|---|---|---|---|",
  ...results.map((r) => {
    const status = r.api_error
      ? `API_FAIL(${r.api_error})`
      : r.parse_error
        ? `PARSE_FAIL(${r.parse_error})`
        : r.exact_file
          ? "EXACT"
          : r.ws_file
            ? "WS_FILE"
            : "DIFF";
    const blockCol = r.parse_success
      ? (r.exact_block ? "EXACT" : r.ws_block ? "WS" : "DIFF")
      : "-";
    return `| ${r.case_id} | ${r.stratum} | ${status} | ${blockCol} | ${r.sim_block === null ? "-" : r.sim_block.toFixed(3)} | ${r.latency_ms}ms | ${r.est_input_tokens} |`;
  }),
  "",
  "## 注記",
  "",
  "- `exact_match`: モデル出力が ground truth `final_code` とバイト一致",
  "- `ws_match`: 行末空白トリム + 前後空行トリム後で一致",
  "- `line_sim`: 行 LCS による Dice 類似度 (2*LCS/(n+m))",
  "- ファイル書き込みは行わず、コアパイプライン (`buildPrompt` → API → `parseOutput`) のみを実測",
  "",
].join("\n");

writeFileSync(join(outDir, "summary.md"), summary, "utf-8");
console.log(`\nResults written to: ${outDir}`);
