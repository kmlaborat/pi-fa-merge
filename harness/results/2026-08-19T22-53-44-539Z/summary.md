# pi-fa-merge baseline run — 2026-08-19T22-53-44-539Z

- Endpoint: `http://msm2.tail3eb0d5.ts.net:8081/v1`
- Model: `FastApply-7B`
- Dataset: Kortix/FastApply-dataset-v1.0 (test split, stratified sample)
- Cases: 20

## 指標

| 指標 | 値 |
|---|---|
| API 到達成功率 | 20/20 (100.0%) |
| parseOutput/構造検証 通過率 | 19/20 (95.0%) |
| 完全一致率 | 13/20 (65.0%) |
| 完全一致率(whitespace 無視) | 13/20 (65.0%) |
| 行単位の類似度平均 (Dice/LCS, 一致時 1.0) | 0.9843 |
| 中央値レイテンシ | 38923 ms |
| 総レイテンシ | 877697 ms |
| 入力推定トークン平均 | 1733 |
| 出力推定トークン平均(成功分) | 1646 |

## エラー内訳

- API エラー: なし
- パース/検証エラー: STRUCTURE_MANGLE_ERROR×1

## ケース別

| case | stratum | 結果 | 類似度 | latency | in~tok |
|---|---|---|---|---|---|
| 0 | css/medium | EXACT | 1.000 | 52794ms | 1613 |
| 1 | css/small | DIFF | 0.949 | 18037ms | 494 |
| 2 | javascript/medium | DIFF | 0.956 | 46845ms | 2189 |
| 3 | javascript/small | EXACT | 1.000 | 2391ms | 95 |
| 4 | other/small | EXACT | 1.000 | 34896ms | 1700 |
| 5 | rs/large | DIFF | 0.990 | 118793ms | 4883 |
| 6 | rs/medium | EXACT | 1.000 | 68861ms | 3379 |
| 7 | sql/small | EXACT | 1.000 | 2933ms | 75 |
| 8 | typescript/medium | EXACT | 1.000 | 38923ms | 1553 |
| 9 | typescript/small | DIFF | 0.878 | 8876ms | 404 |
| 10 | vue/small | EXACT | 1.000 | 21410ms | 906 |
| 11 | javascript/medium | EXACT | 1.000 | 74093ms | 2657 |
| 12 | javascript/small | EXACT | 1.000 | 27831ms | 686 |
| 13 | other/small | EXACT | 1.000 | 22898ms | 952 |
| 14 | rs/large | DIFF | 0.979 | 129025ms | 5224 |
| 15 | rs/medium | EXACT | 1.000 | 62729ms | 1934 |
| 16 | sql/small | EXACT | 1.000 | 4094ms | 169 |
| 17 | typescript/medium | DIFF | 0.950 | 55272ms | 1954 |
| 18 | typescript/small | PARSE_FAIL(STRUCTURE_MANGLE_ERROR) | - | 2569ms | 121 |
| 19 | javascript/medium | EXACT | 1.000 | 84427ms | 3669 |

## 注記

- `exact_match`: モデル出力が ground truth `final_code` とバイト一致
- `ws_match`: 行末空白トリム + 前後空行トリム後で一致
- `line_sim`: 行 LCS による Dice 類似度 (2*LCS/(n+m))
- ファイル書き込みは行わず、コアパイプライン (`buildPrompt` → API → `parseOutput`) のみを実測
