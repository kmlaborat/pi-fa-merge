# pi-fa-merge baseline run — 2026-08-20T12-02-12-036Z

- Endpoint: `http://msm2.tail3eb0d5.ts.net:8081/v1`
- Model: `FastApply-7B`
- Dataset: Kortix/FastApply-dataset-v1.0 (test split, stratified sample)
- Mode: agent-rewrite
- Cases: 20

## 指標

| 指標 | 値 |
|---|---|
| API 到達成功率 | 20/20 (100.0%) |
| parseOutput/構造検証 通過率 | 20/20 (100.0%) |
| 完全一致率(ファイル級) | 0/20 (0.0%) |
| 完全一致率(whitespace 無視、ファイル級) | 1/20 (5.0%) |
| 行単位の類似度平均 (Dice/LCS, 一致時 1.0) | 0.8384 |
| 中央値レイテンシ | 18266 ms |
| 総レイテンシ | 483041 ms |
| 入力推定トークン平均 | 927 |
| 出力推定トークン平均(成功分) | 809 |

## エラー内訳

- API エラー: なし
- パース/検証エラー: なし

## ケース別

| case | stratum | 結果(ファイル級) | ブロック一致 | 類似度 | latency | in~tok |
|---|---|---|---|---|---|---|
| 0 | css/medium | DIFF | DIFF | 0.526 | 3032ms | 88 |
| 1 | css/small | DIFF | DIFF | 0.923 | 19351ms | 500 |
| 2 | javascript/medium | DIFF | DIFF | 0.912 | 41270ms | 1458 |
| 3 | javascript/small | DIFF | DIFF | 0.919 | 2582ms | 82 |
| 4 | other/small | DIFF | DIFF | 0.941 | 18266ms | 630 |
| 5 | rs/large | DIFF | DIFF | 0.094 | 7400ms | 2273 |
| 6 | rs/medium | DIFF | DIFF | 0.977 | 72122ms | 3157 |
| 7 | sql/small | WS_FILE | WS | 0.750 | 2778ms | 79 |
| 8 | typescript/medium | DIFF | DIFF | 0.956 | 19177ms | 701 |
| 9 | typescript/small | DIFF | DIFF | 0.860 | 8302ms | 312 |
| 10 | vue/small | DIFF | DIFF | 0.961 | 15568ms | 554 |
| 11 | javascript/medium | DIFF | DIFF | 0.722 | 15810ms | 388 |
| 12 | javascript/small | DIFF | DIFF | 0.875 | 27648ms | 373 |
| 13 | other/small | DIFF | DIFF | 0.824 | 2410ms | 122 |
| 14 | rs/large | DIFF | DIFF | 0.842 | 26278ms | 954 |
| 15 | rs/medium | DIFF | DIFF | 0.979 | 66627ms | 1903 |
| 16 | sql/small | DIFF | DIFF | 0.938 | 4425ms | 188 |
| 17 | typescript/medium | DIFF | DIFF | 0.993 | 39991ms | 1247 |
| 18 | typescript/small | DIFF | DIFF | 0.829 | 2947ms | 135 |
| 19 | javascript/medium | DIFF | DIFF | 0.946 | 87057ms | 3386 |

## 注記

- `exact_match`: モデル出力が ground truth `final_code` とバイト一致
- `ws_match`: 行末空白トリム + 前後空行トリム後で一致
- `line_sim`: 行 LCS による Dice 類似度 (2*LCS/(n+m))
- ファイル書き込みは行わず、コアパイプライン (`buildPrompt` → API → `parseOutput`) のみを実測
