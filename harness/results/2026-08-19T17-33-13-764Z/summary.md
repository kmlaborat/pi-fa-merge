# pi-fa-merge baseline run — 2026-08-19T17-33-13-764Z

- Endpoint: `http://msm2.tail3eb0d5.ts.net:8081/v1`
- Model: `FastApply-7B`
- Dataset: Kortix/FastApply-dataset-v1.0 (test split, stratified sample)
- Cases: 7

## 指標

| 指標 | 値 |
|---|---|
| API 到達成功率 | 7/7 (100.0%) |
| parseOutput/構造検証 通過率 | 4/7 (57.1%) |
| 完全一致率 | 2/7 (28.6%) |
| 完全一致率(whitespace 無視) | 2/7 (28.6%) |
| 行単位の類似度平均 (Dice/LCS, 一致時 1.0) | 0.9851 |
| 中央値レイテンシ | 74269 ms |
| 総レイテンシ | 593791 ms |
| 入力推定トークン平均 | 3386 |
| 出力推定トークン平均(成功分) | 2622 |

## エラー内訳

- API エラー: なし
- パース/検証エラー: STRUCTURE_MANGLE_ERROR×3

## ケース別

| case | stratum | 結果 | 類似度 | latency | in~tok |
|---|---|---|---|---|---|
| 5 | rs/large | DIFF | 0.990 | 118942ms | 4883 |
| 6 | rs/medium | PARSE_FAIL(STRUCTURE_MANGLE_ERROR) | - | 68900ms | 3379 |
| 11 | javascript/medium | EXACT | 1.000 | 74269ms | 2657 |
| 14 | rs/large | PARSE_FAIL(STRUCTURE_MANGLE_ERROR) | - | 129087ms | 5224 |
| 15 | rs/medium | EXACT | 1.000 | 62796ms | 1934 |
| 17 | typescript/medium | DIFF | 0.950 | 55293ms | 1954 |
| 19 | javascript/medium | PARSE_FAIL(STRUCTURE_MANGLE_ERROR) | - | 84504ms | 3669 |

## 注記

- `exact_match`: モデル出力が ground truth `final_code` とバイト一致
- `ws_match`: 行末空白トリム + 前後空行トリム後で一致
- `line_sim`: 行 LCS による Dice 類似度 (2*LCS/(n+m))
- ファイル書き込みは行わず、コアパイプライン (`buildPrompt` → API → `parseOutput`) のみを実測
