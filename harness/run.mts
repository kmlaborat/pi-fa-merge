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
 * Usage:
 *   npx tsx harness/run.mts                 # run all cases in cases.json
 *   npx tsx harness/run.mts --case 0 --case 3   # run specific cases only
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
const DEFAULT_ENV_FILE =
  process.env.FA_MERGE_ENV_FILE ??
  "C:\\Users\\Game\\MyDevEnv\\.home\\.pi\\agent\\git\\github.com\\kmlaborat\\pi-fa-merge\\.env";

// Load the installed package .env with the package's own rules.
try {
  const content = readFileSync(DEFAULT_ENV_FILE, "utf-8");
  const ignored = applyEnvContent(content, process.env);
  console.log(`Loaded .env from: ${DEFAULT_ENV_FILE}`);
  if (ignored.length > 0) console.log(`  (ignored non-prefixed keys: ${ignored.join(", ")})`);
} catch (e) {
  console.error(`WARNING: cannot load .env from ${DEFAULT_ENV_FILE}: ${e.message}`);
  console.error("Falling back to existing process.env values.");
}

const ENDPOINT =
  process.env.FAST_APPLY_ENDPOINT_URL ?? "https://api.fireworks.ai/inference/v1";
const MODEL = process.env.FAST_APPLY_MODEL_NAME ?? "fast-apply-7b";
const API_KEY = process.env.FAST_APPLY_API_KEY;

console.log(`Endpoint: ${ENDPOINT}`);
console.log(`Model:    ${MODEL}`);
if (!API_KEY) {
  console.error("ERROR: FAST_APPLY_API_KEY not set after .env load — aborting.");
  process.exit(1);
}

// Case selection + options
const onlyCases = new Set();
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === "--case") onlyCases.add(parseInt(argv[++i], 10));
  if (argv[i] === "--timeout") {
    // Override AFTER the .env load (harness driver may need a longer
    // timeout than the installed .env specifies for slow local models).
    process.env.FAST_APPLY_TIMEOUT = argv[++i];
  }
}
const allCases = JSON.parse(readFileSync(CASES_FILE, "utf-8"));
const cases = onlyCases.size > 0 ? allCases.filter((c) => onlyCases.has(c.case_id)) : allCases;
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

async function callWithRetry(messages) {
  let lastError = null;
  for (let attempt = 0; attempt <= MAX_API_RETRIES; attempt++) {
    try {
      return { content: await callOpenAiCompatibleApi(ENDPOINT, API_KEY, MODEL, messages), attempts: attempt + 1 };
    } catch (error) {
      lastError = error;
      if (attempt < MAX_API_RETRIES && isRetryable(error)) {
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
  const t0 = Date.now();
  const record = {
    case_id: c.case_id,
    stratum: c.stratum,
    file_name: c.file_name,
    token_count: c.token_count,
    line_count: c.line_count,
    est_input_tokens: Math.floor((c.original_code.length + c.update_snippet.length) / 4),
    latency_ms: 0,
    api_attempts: null,
    api_error: null,
    parse_error: null,
    parse_success: false,
    exact_match: false,
    ws_match: false,
    line_sim: null,
    est_output_tokens: null,
  };

  try {
    const messages = buildPrompt(c.original_code, c.update_snippet);
    const { content, attempts } = await callWithRetry(messages);
    record.api_attempts = attempts;
    record.latency_ms = Date.now() - t0;
    totalLatency += record.latency_ms;

    const parsed = parseOutput(content, c.original_code);
    if (!parsed.success) {
      record.parse_error = parsed.error;
      record.parse_details = parsed.details;
      writeFileSync(join(failDir, `${c.case_id}.raw.txt`), content, "utf-8");
    } else {
      record.parse_success = true;
      record.est_output_tokens = Math.floor(parsed.updated_code.length / 4);
      record.exact_match = parsed.updated_code === c.final_code;
      record.ws_match = normalizeWs(parsed.updated_code) === normalizeWs(c.final_code);
      record.line_sim =
        record.exact_match ? 1 : lineSimilarity(parsed.updated_code, c.final_code);
      if (!record.ws_match) {
        writeFileSync(join(failDir, `${c.case_id}.raw.txt`), parsed.updated_code, "utf-8");
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
      : record.exact_match
        ? "EXACT"
        : record.ws_match
          ? "WS_MATCH"
          : `DIFF(sim=${record.line_sim?.toFixed(3)})`;
  console.log(
    `case ${String(c.case_id).padStart(2)} [${c.stratum}] ${status} ` +
      `${record.latency_ms}ms in~${record.est_input_tokens}tok`
  );
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

const n = results.length;
const apiOk = results.filter((r) => !r.api_error);
const parsed = results.filter((r) => r.parse_success);
const exact = results.filter((r) => r.exact_match);
const ws = results.filter((r) => r.ws_match);
const sims = results
  .map((r) => r.line_sim)
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
  `- Cases: ${n}`,
  "",
  "## 指標",
  "",
  "| 指標 | 値 |",
  "|---|---|",
  `| API 到達成功率 | ${apiOk.length}/${n} (${(100 * apiOk.length / n).toFixed(1)}%) |`,
  `| parseOutput/構造検証 通過率 | ${parsed.length}/${n} (${(100 * parsed.length / n).toFixed(1)}%) |`,
  `| 完全一致率 | ${exact.length}/${n} (${(100 * exact.length / n).toFixed(1)}%) |`,
  `| 完全一致率(whitespace 無視) | ${ws.length}/${n} (${(100 * ws.length / n).toFixed(1)}%) |`,
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
  "| case | stratum | 結果 | 類似度 | latency | in~tok |",
  "|---|---|---|---|---|---|",
  ...results.map((r) => {
    const status = r.api_error
      ? `API_FAIL(${r.api_error})`
      : r.parse_error
        ? `PARSE_FAIL(${r.parse_error})`
        : r.exact_match
          ? "EXACT"
          : r.ws_match
            ? "WS_MATCH"
            : "DIFF";
    return `| ${r.case_id} | ${r.stratum} | ${status} | ${r.line_sim === null ? "-" : r.line_sim.toFixed(3)} | ${r.latency_ms}ms | ${r.est_input_tokens} |`;
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
