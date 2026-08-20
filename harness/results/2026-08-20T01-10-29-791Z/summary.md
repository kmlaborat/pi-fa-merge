# pi-fa-merge baseline run — 2026-08-20T01-10-29-791Z

- Endpoint: `http://msm2.tail3eb0d5.ts.net:8081/v1`
- Model: `FastApply-7B`
- Dataset: Kortix/FastApply-dataset-v1.0 (test split, stratified sample)
- Mode: block-nl
- Cases: 20

## 指標

| 指標 | 値 |
|---|---|
| API 到達成功率 | 20/20 (100.0%) |
| parseOutput/構造検証 通過率 | 20/20 (100.0%) |
| 完全一致率(ファイル級) | 3/20 (15.0%) |
| 完全一致率(whitespace 無視、ファイル級) | 3/20 (15.0%) |
| 完全一致率(ブロック級) | 3/20 (15.0%) |
| 行単位の類似度平均 (Dice/LCS, 一致時 1.0) | 0.9100 |
| 中央値レイテンシ | 18335 ms |
| 総レイテンシ | 503777 ms |
| 入力推定トークン平均 | 927 |
| 出力推定トークン平均(成功分) | 908 |

## エラー内訳

- API エラー: なし
- パース/検証エラー: なし

## ケース別

| case | stratum | 結果(ファイル級) | ブロック一致 | 類似度 | latency | in~tok |
|---|---|---|---|---|---|---|
| 0 | css/medium | DIFF | DIFF | 0.667 | 2733ms | 88 |
| 1 | css/small | DIFF | DIFF | 0.930 | 18584ms | 500 |
| 2 | javascript/medium | DIFF | DIFF | 0.962 | 36194ms | 1458 |
| 3 | javascript/small | EXACT | EXACT | 1.000 | 2605ms | 82 |
| 4 | other/small | DIFF | DIFF | 0.947 | 17230ms | 630 |
| 5 | rs/large | DIFF | DIFF | 0.974 | 58881ms | 2273 |
| 6 | rs/medium | DIFF | DIFF | 0.986 | 67539ms | 3157 |
| 7 | sql/small | EXACT | EXACT | 1.000 | 2855ms | 79 |
| 8 | typescript/medium | DIFF | DIFF | 0.961 | 18335ms | 701 |
| 9 | typescript/small | DIFF | DIFF | 0.860 | 7990ms | 312 |
| 10 | vue/small | DIFF | DIFF | 0.961 | 15709ms | 554 |
| 11 | javascript/medium | DIFF | DIFF | 0.563 | 13997ms | 388 |
| 12 | javascript/small | DIFF | DIFF | 0.913 | 26004ms | 373 |
| 13 | other/small | DIFF | DIFF | 0.875 | 2432ms | 122 |
| 14 | rs/large | DIFF | DIFF | 0.887 | 24191ms | 954 |
| 15 | rs/medium | DIFF | DIFF | 0.985 | 62629ms | 1903 |
| 16 | sql/small | EXACT | EXACT | 1.000 | 4335ms | 188 |
| 17 | typescript/medium | DIFF | DIFF | 0.937 | 37537ms | 1247 |
| 18 | typescript/small | DIFF | DIFF | 0.829 | 3000ms | 135 |
| 19 | javascript/medium | DIFF | DIFF | 0.964 | 80997ms | 3386 |

## 注記

- `exact_match`: モデル出力が ground truth `final_code` とバイト一致
- `ws_match`: 行末空白トリム + 前後空行トリム後で一致
- `line_sim`: 行 LCS による Dice 類似度 (2*LCS/(n+m))
- ファイル書き込みは行わず、コアパイプライン (`buildPrompt` → API → `parseOutput`) のみを実測
