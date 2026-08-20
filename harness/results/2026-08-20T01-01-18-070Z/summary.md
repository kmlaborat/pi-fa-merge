# pi-fa-merge baseline run — 2026-08-20T01-01-18-070Z

- Endpoint: `http://msm2.tail3eb0d5.ts.net:8081/v1`
- Model: `FastApply-7B`
- Dataset: Kortix/FastApply-dataset-v1.0 (test split, stratified sample)
- Mode: block-code
- Cases: 20

## 指標

| 指標 | 値 |
|---|---|
| API 到達成功率 | 20/20 (100.0%) |
| parseOutput/構造検証 通過率 | 20/20 (100.0%) |
| 完全一致率(ファイル級) | 9/20 (45.0%) |
| 完全一致率(whitespace 無視、ファイル級) | 15/20 (75.0%) |
| 完全一致率(ブロック級) | 15/20 (75.0%) |
| 行単位の類似度平均 (Dice/LCS, 一致時 1.0) | 0.9749 |
| 中央値レイテンシ | 18186 ms |
| 総レイテンシ | 509107 ms |
| 入力推定トークン平均 | 1016 |
| 出力推定トークン平均(成功分) | 909 |

## エラー内訳

- API エラー: なし
- パース/検証エラー: なし

## ケース別

| case | stratum | 結果(ファイル級) | ブロック一致 | 類似度 | latency | in~tok |
|---|---|---|---|---|---|---|
| 0 | css/medium | DIFF | DIFF | 0.757 | 3192ms | 90 |
| 1 | css/small | WS_FILE | EXACT | 1.000 | 18186ms | 565 |
| 2 | javascript/medium | WS_FILE | EXACT | 1.000 | 38180ms | 1602 |
| 3 | javascript/small | EXACT | EXACT | 1.000 | 2606ms | 104 |
| 4 | other/small | EXACT | EXACT | 1.000 | 17062ms | 815 |
| 5 | rs/large | WS_FILE | EXACT | 1.000 | 59216ms | 2307 |
| 6 | rs/medium | WS_FILE | EXACT | 1.000 | 67804ms | 3299 |
| 7 | sql/small | EXACT | EXACT | 1.000 | 2970ms | 100 |
| 8 | typescript/medium | DIFF | DIFF | 0.865 | 18841ms | 818 |
| 9 | typescript/small | EXACT | EXACT | 1.000 | 9409ms | 458 |
| 10 | vue/small | DIFF | DIFF | 0.977 | 16736ms | 604 |
| 11 | javascript/medium | EXACT | EXACT | 1.000 | 17473ms | 661 |
| 12 | javascript/small | WS_FILE | EXACT | 1.000 | 27557ms | 655 |
| 13 | other/small | EXACT | EXACT | 1.000 | 2551ms | 116 |
| 14 | rs/large | WS_FILE | EXACT | 1.000 | 23410ms | 1039 |
| 15 | rs/medium | DIFF | DIFF | 0.931 | 59412ms | 1954 |
| 16 | sql/small | EXACT | EXACT | 1.000 | 4148ms | 198 |
| 17 | typescript/medium | DIFF | DIFF | 0.969 | 35522ms | 1298 |
| 18 | typescript/small | EXACT | EXACT | 1.000 | 2878ms | 141 |
| 19 | javascript/medium | EXACT | EXACT | 1.000 | 81954ms | 3494 |

## 注記

- `exact_match`: モデル出力が ground truth `final_code` とバイト一致
- `ws_match`: 行末空白トリム + 前後空行トリム後で一致
- `line_sim`: 行 LCS による Dice 類似度 (2*LCS/(n+m))
- ファイル書き込みは行わず、コアパイプライン (`buildPrompt` → API → `parseOutput`) のみを実測
