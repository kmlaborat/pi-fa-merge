#!/usr/bin/env node
/**
 * block.mjs — Derive minimal edit blocks from the dataset's ground-truth
 * diff (ToDo 2-B: block-scope experiment).
 *
 * For each case in harness/cases.json:
 *   1. Line-diff original_code -> final_code (LCS).
 *   2. Block range (final-file coordinates) = import/directive header at the
 *      top + each change hunk padded by K context lines, merged.
 *   3. block_original / block_final = the same logical region in the two
 *      files (original region = lines between the first/last unchanged
 *      anchor lines inside the block, so deleted lines are included).
 *   4. block_update = the change as a fast-apply-style snippet RESCOPEd to
 *      the block: changed lines + up to 2 context lines each side, bookend
 *      lines, gaps as `... existing code ...`.
 *
 * Guarantees: the block contains at least one unchanged (context) line, so
 * it can serve as an anchoredit anchor. Pure insertions at the top of the
 * file are anchored on the first original line after the insertion.
 *
 * Output: harness/cases-block.json (+ prints sample blocks for inspection).
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const K = 5; // context padding around each hunk

const IMPORT_RE =
  /^\s*(import\s|import$|from\s+["']|export\s+[\w{},\s*]+\bfrom\b|const\s+\w+(\s*,\s*\w+)*\s*=\s*require\(|require\(|use\s+[\w:*{"{]|#[\t ]*(include|use)\b|"use\s|\/\/|\/\*|^\s*\*)/;

/** Leading import/directive/comment header range [0, end) in final lines. */
function headerRange(lines) {
  let i = 0;
  let seenImport = false;
  while (i < lines.length) {
    const t = lines[i].trim();
    if (t === "") {
      if (seenImport) {
        i++;
        continue;
      }
      let j = i;
      while (j < lines.length && lines[j].trim() === "") j++;
      if (j < lines.length && IMPORT_RE.test(lines[j])) {
        i = j;
        continue;
      }
      break;
    }
    if (IMPORT_RE.test(lines[i])) {
      seenImport = true;
      i++;
      continue;
    }
    if (seenImport && (/^\s+/.test(lines[i]) || /[;}*,]$/.test(t))) {
      i++; // continuation of a multi-line import
      continue;
    }
    break;
  }
  let end = i;
  while (end > 0 && lines[end - 1].trim() === "") end--;
  return { start: 0, end };
}

/** LCS line diff -> ops: {t:'eq',o,f} | {t:'del',o} | {t:'ins',f} */
function diffLines(a, b) {
  const n = a.length, m = b.length;
  const dp = [];
  for (let i = 0; i <= n; i++) dp.push(new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const ops = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { ops.push({ t: "eq", o: i, f: j }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { ops.push({ t: "del", o: i }); i++; }
    else { ops.push({ t: "ins", f: j }); j++; }
  }
  while (i < n) { ops.push({ t: "del", o: i }); i++; }
  while (j < m) { ops.push({ t: "ins", f: j }); j++; }
  return ops;
}

const cases = JSON.parse(readFileSync(join(here, "cases.json"), "utf-8"));
const out = [];

for (const c of cases) {
  // Trim trailing blank lines BEFORE diffing: the dataset is inconsistent
  // about the final newline (originals usually keep one, finals drop it),
  // and LCS would otherwise phantom-match the trailing blank against an
  // interior blank, scattering fake changes. The tail difference is handled
  // explicitly below (folded into the block only when it reaches EOF).
  const aFull = c.original_code.replace(/\r\n/g, "\n").split("\n");
  const bFull = c.final_code.replace(/\r\n/g, "\n").split("\n");
  let ta = aFull.length - 1;
  while (ta >= 0 && aFull[ta].trim() === "") ta--;
  let tb = bFull.length - 1;
  while (tb >= 0 && bFull[tb].trim() === "") tb--;
  const a = aFull.slice(0, ta + 1);
  const b = bFull.slice(0, tb + 1);
  const tailA = aFull.length - a.length; // removed trailing blanks
  const tailB = bFull.length - b.length;
  const ops = diffLines(a, b);
  const n = a.length, m = b.length;

  // Change positions in final coordinates: insertions, plus pure deletions
  // projected to the final line before them (a deleted line occupies the gap
  // between its neighboring unchanged lines). R must cover ALL change hunks,
  // otherwise splicing the expected block back cannot reproduce the GT.
  const changeF = [];
  let prevEqF = 0;
  for (const op of ops) {
    if (op.t === "eq") prevEqF = op.f;
    else if (op.t === "ins") changeF.push(op.f);
    else changeF.push(prevEqF); // del
  }
  changeF.sort((x, y) => x - y);
  const header = headerRange(b);

  // Pad each run of consecutive change positions by K context lines.
  const runs = [];
  for (const f of changeF) {
    const last = runs[runs.length - 1];
    if (last && f <= last.end + K) last.end = f;
    else runs.push({ start: f, end: f });
  }
  for (const r of runs) {
    r.start = Math.max(0, r.start - K);
    r.end = Math.min(m - 1, r.end + K);
  }

  // Merge header + runs into [r0, r1] (final coordinates).
  let r0 = m - 1, r1 = 0;
  const spans = [...runs];
  if (header.end > 0) spans.push({ start: 0, end: header.end - 1 });
  for (const s of spans) { r0 = Math.min(r0, s.start); r1 = Math.max(r1, s.end); }
  if (changeF.length === 0) {
    console.log(`case ${c.case_id}: no changes, skipping`);
    continue;
  }

  // Contiguous op window whose final lines are exactly b[r0..r1]. Boundary
  // deletions (which own no final line) are pulled into the window so that
  // block_original contains every original line the block replaces.
  function opWindow() {
    let i0 = ops.findIndex((op) => (op.t === "eq" || op.t === "ins") && op.f >= r0);
    let i1 = ops.length - 1 - [...ops].reverse().findIndex((op) => (op.t === "eq" || op.t === "ins") && op.f <= r1);
    while (i0 > 0 && ops[i0 - 1].t === "del") i0--;
    while (i1 < ops.length - 1 && ops[i1 + 1].t === "del") i1++;
    return [i0, i1];
  }

  // Ensure the block contains at least one unchanged (anchor) line, and a
  // minimum size.
  let [i0, i1] = opWindow();
  const hasEq = (lo, hi) => ops.slice(lo, hi + 1).some((op) => op.t === "eq");
  if (!hasEq(i0, i1)) {
    const afterIdx = ops.findIndex((op) => op.t === "eq" && op.f > r1);
    const beforeIdx = [...ops].reverse().findIndex((op) => op.t === "eq" && op.f < r0);
    if (afterIdx !== -1) r1 = ops[afterIdx].f;
    else if (beforeIdx !== -1) r0 = ops[ops.length - 1 - beforeIdx].f;
    [i0, i1] = opWindow();
  }
  while (i1 - i0 + 1 < 3 && (r0 > 0 || r1 < m - 1)) {
    if (r1 < m - 1) r1 = Math.min(m - 1, r1 + 1);
    if (r0 > 0) r0 = Math.max(0, r0 - 1);
    [i0, i1] = opWindow();
  }

  // Both sides of the block come from the SAME op window, so splicing
  // block_final over [g0, g1] reproduces the ground truth by construction.
  const win = ops.slice(i0, i1 + 1);
  let g0 = win[0].t === "del" ? win[0].o : win.find((op) => op.t !== "ins").o;
  let g1 = [...win].reverse().find((op) => op.t === "eq" || op.t === "del").o;
  let block_original = win.filter((op) => op.t !== "ins").map((op) => a[op.o]).join("\n");
  let block_final = win.filter((op) => op.t !== "del").map((op) => b[op.f]).join("\n");
  const reachesEof = r1 === m - 1;

  // Rescope the update snippet to the block (trimmed coordinates).
  const changedF = new Set(win.filter((op) => op.t === "ins").map((op) => op.f));
  const eqByF = new Map(ops.filter((op) => op.t === "eq").map((op) => [op.f, op.o]));
  const include = new Set([r0, r1]);
  for (const f of changedF) {
    include.add(f); // the changed/added line itself
    for (let d = -2; d <= 2; d++) {
      if (eqByF.has(f + d)) include.add(f + d);
    }
  }
  const upd = [];
  let emitted = false, gap = false;
  for (let f = r0; f <= r1; f++) {
    if (include.has(f)) {
      upd.push(b[f]);
      emitted = true;
      gap = false;
    } else if (emitted) {
      if (!gap) { upd.push("... existing code ..."); gap = true; }
    }
  }
  const block_update = upd.join("\n");

  // Fold the trailing-blank difference into the block when it reaches EOF:
  // the spliced file must then reproduce the GT's exact tail.
  if (reachesEof && (tailA > 0 || tailB > 0)) {
    block_original = block_original + "\n".repeat(tailA);
    block_final = block_final + "\n".repeat(tailB);
    g1 = aFull.length - 1;
    r1 = bFull.length - 1;
  }

  out.push({
    case_id: c.case_id,
    stratum: c.stratum,
    file_name: c.file_name,
    lang: c.lang,
    original_code: c.original_code,
    final_code: c.final_code,
    block_original,
    block_final,
    block_update,
    orig_start: g0,
    orig_end: g1,
    final_start: r0,
    final_end: r1,
    block_lines: r1 - r0 + 1,
    full_lines: bFull.length,
    full_span: g0 === 0 && g1 === aFull.length - 1 && r0 === 0 && r1 === bFull.length - 1,
    changed_lines: win.filter((op) => op.t !== "eq").length,
  });
}

writeFileSync(join(here, "cases-block.json"), JSON.stringify(out, null, 1), "utf-8");

// Summary
let fullSpan = 0;
for (const r of out) if (r.full_span) fullSpan++;
console.log(`Wrote ${out.length} block cases -> cases-block.json`);
console.log(`Block covers FULL file for ${fullSpan}/${out.length} cases (no savings there).`);
for (const r of out) {
  console.log(
    `case ${String(r.case_id).padStart(2)} [${r.stratum}] block=${r.block_lines}/${r.full_lines} lines, changed=${r.changed_lines}${r.full_span ? " (FULL SPAN)" : ""}`
  );
}

// Print one sample for visual inspection (first case with a real block).
const sample = out.find((r) => !r.full_span && r.block_lines < 60) ?? out[0];
console.log(`\n===== SAMPLE case ${sample.case_id} =====`);
console.log("--- block_original ---");
console.log(sample.block_original.slice(0, 800));
console.log("--- block_update ---");
console.log(sample.block_update.slice(0, 800));
console.log("--- block_final ---");
console.log(sample.block_final.slice(0, 800));
