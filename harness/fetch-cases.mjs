#!/usr/bin/env node
/**
 * fetch-cases.mjs — Download the Kortix/FastApply-dataset-v1.0 test split
 * from the HuggingFace datasets-server API and build a stratified sample
 * of evaluation cases for the baseline harness.
 *
 * Stratification: language (by file extension) × token-size band
 * (small <1000 / medium 1000-4000 / large >4000). Deterministic selection
 * (first N rows per stratum in dataset order).
 *
 * Only rows with status == "correct" (valid ground truth) are sampled.
 *
 * Usage:
 *   node harness/fetch-cases.mjs [N]     # N defaults to 20
 *
 * Output:
 *   harness/cases.json                   # the sampled cases
 *   harness/tmp/test-rows.json           # raw cache of all test rows
 */

import { writeFileSync, readFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const N = parseInt(process.argv[2] ?? "20", 10);
const CACHE = join(here, "tmp", "test-rows.json");
const OUT = join(here, "cases.json");

const API =
  "https://datasets-server.huggingface.co/rows" +
  "?dataset=Kortix%2FFastApply-dataset-v1.0&config=default&split=test";

async function fetchAllRows() {
  if (existsSync(CACHE)) {
    console.log(`Using cached rows: ${CACHE}`);
    return JSON.parse(readFileSync(CACHE, "utf-8"));
  }
  const rows = [];
  let offset = 0;
  for (;;) {
    const url = `${API}&offset=${offset}&length=100`;
    console.log(`Fetching ${url} ...`);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`datasets-server error: ${res.status} ${res.statusText}`);
    const data = await res.json();
    for (const r of data.rows) rows.push(r.row);
    offset += data.rows.length;
    if (data.rows.length < 100 || rows.length >= data.num_rows_total) break;
  }
  mkdirSync(join(here, "tmp"), { recursive: true });
  writeFileSync(CACHE, JSON.stringify(rows, null, 1), "utf-8");
  return rows;
}

function langOf(fileName) {
  const ext = (fileName ?? "").split(".").pop()?.toLowerCase() ?? "";
  if (ext === "py") return "python";
  if (["ts", "tsx"].includes(ext)) return "typescript";
  if (["js", "jsx", "mjs"].includes(ext)) return "javascript";
  if (["rs", "go", "java", "rb", "c", "cpp", "h"].includes(ext)) return ext;
  return ext || "other";
}

function bandOf(tokenCount) {
  const t = Number(tokenCount) || 0;
  if (t < 1000) return "small";
  if (t <= 4000) return "medium";
  return "large";
}

const rows = await fetchAllRows();
console.log(`Total test rows: ${rows.length}`);

const valid = rows.filter(
  (r) => r.status === "correct" && typeof r.final_code === "string" && r.final_code.length > 0
);
console.log(`Rows with status=correct and final_code: ${valid.length}`);

// Group into strata: language × band
const strata = new Map();
for (const r of valid) {
  const key = `${langOf(r["File Name"])}/${bandOf(r["Token Count"])}`;
  if (!strata.has(key)) strata.set(key, []);
  strata.get(key).push(r);
}

// Deterministic round-robin over strata (sorted keys) taking 1 row at a time
const keys = [...strata.keys()].sort();
const picked = [];
const perStratum = new Map(keys.map((k) => [k, 0]));
while (picked.length < N) {
  let added = false;
  for (const k of keys) {
    if (picked.length >= N) break;
    const i = perStratum.get(k);
    if (i < strata.get(k).length) {
      picked.push(strata.get(k)[i]);
      perStratum.set(k, i + 1);
      added = true;
    }
  }
  if (!added) break; // all strata exhausted
}

const cases = picked.map((r, i) => ({
  case_id: i,
  file_name: r["File Name"],
  lang: langOf(r["File Name"]),
  token_count: Number(r["Token Count"]) ?? null,
  line_count: Number(r["Line Count"]) ?? null,
  stratum: `${langOf(r["File Name"])}/${bandOf(r["Token Count"])}`,
  original_code: r.original_code,
  update_snippet: r.update_snippet,
  final_code: r.final_code,
}));

writeFileSync(OUT, JSON.stringify(cases, null, 1), "utf-8");

// Print a compact manifest
const byStratum = new Map();
for (const c of cases) byStratum.set(c.stratum, (byStratum.get(c.stratum) ?? 0) + 1);
console.log(`\nSampled ${cases.length} cases → ${OUT}`);
for (const [k, v] of [...byStratum.entries()].sort()) console.log(`  ${k}: ${v}`);
