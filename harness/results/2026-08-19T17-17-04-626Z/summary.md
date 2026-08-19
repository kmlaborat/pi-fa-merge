# pi-fa-merge baseline run — 2026-08-19T17-17-04-626Z

- Endpoint: `http://msm2.tail3eb0d5.ts.net:8081/v1`
- Model: `FastApply-7B`
- Dataset: Kortix/FastApply-dataset-v1.0 (test split, stratified sample)
- Cases: 20

## 指標

| 指標 | 値 |
|---|---|
| API 到達成功率 | 13/20 (65.0%) |
| parseOutput/構造検証 通過率 | 7/20 (35.0%) |
| 完全一致率 | 6/20 (30.0%) |
| 完全一致率(whitespace 無視) | 6/20 (30.0%) |
| 行単位の類似度平均 (Dice/LCS, 一致時 1.0) | 0.9937 |
| 中央値レイテンシ | 42267 ms |
| 総レイテンシ | 738314 ms |
| 入力推定トークン平均 | 1733 |
| 出力推定トークン平均(成功分) | 724 |

## エラー内訳

- API エラー: TIMEOUT×7
- パース/検証エラー: STRUCTURE_MANGLE_ERROR×6

## ケース別

| case | stratum | 結果 | 類似度 | latency | in~tok |
|---|---|---|---|---|---|
| 0 | css/medium | EXACT | 1.000 | 52479ms | 1613 |
| 1 | css/small | PARSE_FAIL(STRUCTURE_MANGLE_ERROR) | - | 21351ms | 494 |
| 2 | javascript/medium | DIFF | 0.956 | 51769ms | 2189 |
| 3 | javascript/small | EXACT | 1.000 | 4325ms | 95 |
| 4 | other/small | PARSE_FAIL(STRUCTURE_MANGLE_ERROR) | - | 39018ms | 1700 |
| 5 | rs/large | API_FAIL(TIMEOUT) | - | 60007ms | 4883 |
| 6 | rs/medium | API_FAIL(TIMEOUT) | - | 60005ms | 3379 |
| 7 | sql/small | EXACT | 1.000 | 5156ms | 75 |
| 8 | typescript/medium | PARSE_FAIL(STRUCTURE_MANGLE_ERROR) | - | 42267ms | 1553 |
| 9 | typescript/small | PARSE_FAIL(STRUCTURE_MANGLE_ERROR) | - | 11110ms | 404 |
| 10 | vue/small | EXACT | 1.000 | 23207ms | 906 |
| 11 | javascript/medium | API_FAIL(TIMEOUT) | - | 60007ms | 2657 |
| 12 | javascript/small | PARSE_FAIL(STRUCTURE_MANGLE_ERROR) | - | 34388ms | 686 |
| 13 | other/small | EXACT | 1.000 | 25211ms | 952 |
| 14 | rs/large | API_FAIL(TIMEOUT) | - | 60008ms | 5224 |
| 15 | rs/medium | API_FAIL(TIMEOUT) | - | 60015ms | 1934 |
| 16 | sql/small | EXACT | 1.000 | 5017ms | 169 |
| 17 | typescript/medium | API_FAIL(TIMEOUT) | - | 60008ms | 1954 |
| 18 | typescript/small | PARSE_FAIL(STRUCTURE_MANGLE_ERROR) | - | 2964ms | 121 |
| 19 | javascript/medium | API_FAIL(TIMEOUT) | - | 60002ms | 3669 |

## 注記

- `exact_match`: モデル出力が ground truth `final_code` とバイト一致
- `ws_match`: 行末空白トリム + 前後空行トリム後で一致
- `line_sim`: 行 LCS による Dice 類似度 (2*LCS/(n+m))
- ファイル書き込みは行わず、コアパイプライン (`buildPrompt` → API → `parseOutput`) のみを実測
