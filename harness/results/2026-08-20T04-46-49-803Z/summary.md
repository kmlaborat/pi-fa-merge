# pi-fa-merge baseline run — 2026-08-20T04-46-49-803Z

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
| 完全一致率(ファイル級) | 3/20 (15.0%) |
| 完全一致率(whitespace 無視、ファイル級) | 4/20 (20.0%) |
| 行単位の類似度平均 (Dice/LCS, 一致時 1.0) | 0.9022 |
| 中央値レイテンシ | 17243 ms |
| 総レイテンシ | 474940 ms |
| 入力推定トークン平均 | 927 |
| 出力推定トークン平均(成功分) | 915 |

## エラー内訳

- API エラー: なし
- パース/検証エラー: なし

## ケース別

| case | stratum | 結果(ファイル級) | ブロック一致 | 類似度 | latency | in~tok |
|---|---|---|---|---|---|---|
| 0 | css/medium | DIFF | DIFF | 0.571 | 3046ms | 88 |
| 1 | css/small | DIFF | DIFF | 0.930 | 18255ms | 500 |
| 2 | javascript/medium | DIFF | DIFF | 0.917 | 37611ms | 1458 |
| 3 | javascript/small | EXACT | EXACT | 1.000 | 2493ms | 82 |
| 4 | other/small | EXACT | EXACT | 1.000 | 16169ms | 630 |
| 5 | rs/large | WS_FILE | EXACT | 1.000 | 54681ms | 2273 |
| 6 | rs/medium | DIFF | DIFF | 0.976 | 63834ms | 3157 |
| 7 | sql/small | DIFF | DIFF | 0.857 | 2490ms | 79 |
| 8 | typescript/medium | DIFF | DIFF | 0.960 | 17243ms | 701 |
| 9 | typescript/small | DIFF | DIFF | 0.776 | 8487ms | 312 |
| 10 | vue/small | DIFF | DIFF | 0.968 | 13781ms | 554 |
| 11 | javascript/medium | DIFF | DIFF | 0.722 | 13106ms | 388 |
| 12 | javascript/small | DIFF | DIFF | 0.917 | 24101ms | 373 |
| 13 | other/small | DIFF | DIFF | 0.875 | 2373ms | 122 |
| 14 | rs/large | DIFF | DIFF | 0.912 | 22402ms | 954 |
| 15 | rs/medium | DIFF | DIFF | 0.943 | 57535ms | 1903 |
| 16 | sql/small | EXACT | EXACT | 1.000 | 3906ms | 188 |
| 17 | typescript/medium | DIFF | DIFF | 0.937 | 36577ms | 1247 |
| 18 | typescript/small | DIFF | DIFF | 0.829 | 2742ms | 135 |
| 19 | javascript/medium | DIFF | DIFF | 0.954 | 74108ms | 3386 |

## 注記

- `exact_match`: モデル出力が ground truth `final_code` とバイト一致
- `ws_match`: 行末空白トリム + 前後空行トリム後で一致
- `line_sim`: 行 LCS による Dice 類似度 (2*LCS/(n+m))
- ファイル書き込みは行わず、コアパイプライン (`buildPrompt` → API → `parseOutput`) のみを実測
