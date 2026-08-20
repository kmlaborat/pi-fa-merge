# pi-fa-merge baseline run — 2026-08-20T01-19-46-167Z

- Endpoint: `http://msm2.tail3eb0d5.ts.net:8081/v1`
- Model: `FastApply-7B`
- Dataset: Kortix/FastApply-dataset-v1.0 (test split, stratified sample)
- Mode: full-nl
- Cases: 20

## 指標

| 指標 | 値 |
|---|---|
| API 到達成功率 | 20/20 (100.0%) |
| parseOutput/構造検証 通過率 | 20/20 (100.0%) |
| 完全一致率(ファイル級) | 3/20 (15.0%) |
| 完全一致率(whitespace 無視、ファイル級) | 3/20 (15.0%) |
| 行単位の類似度平均 (Dice/LCS, 一致時 1.0) | 0.9630 |
| 中央値レイテンシ | 38048 ms |
| 総レイテンシ | 879712 ms |
| 入力推定トークン平均 | 1582 |
| 出力推定トークン平均(成功分) | 1563 |

## エラー内訳

- API エラー: なし
- パース/検証エラー: なし

## ケース別

| case | stratum | 結果(ファイル級) | ブロック一致 | 類似度 | latency | in~tok |
|---|---|---|---|---|---|---|
| 0 | css/medium | DIFF | DIFF | 0.979 | 52427ms | 1448 |
| 1 | css/small | DIFF | DIFF | 0.934 | 18346ms | 501 |
| 2 | javascript/medium | DIFF | DIFF | 0.965 | 46716ms | 1827 |
| 3 | javascript/small | EXACT | EXACT | 1.000 | 2664ms | 82 |
| 4 | other/small | DIFF | DIFF | 0.980 | 34928ms | 1290 |
| 5 | rs/large | DIFF | DIFF | 0.987 | 124247ms | 4858 |
| 6 | rs/medium | DIFF | DIFF | 0.986 | 68671ms | 3187 |
| 7 | sql/small | EXACT | EXACT | 1.000 | 2891ms | 79 |
| 8 | typescript/medium | DIFF | DIFF | 0.984 | 38048ms | 1407 |
| 9 | typescript/small | DIFF | DIFF | 0.860 | 7894ms | 312 |
| 10 | vue/small | DIFF | DIFF | 0.975 | 20988ms | 752 |
| 11 | javascript/medium | DIFF | DIFF | 0.934 | 72634ms | 1900 |
| 12 | javascript/small | DIFF | DIFF | 0.926 | 26018ms | 381 |
| 13 | other/small | DIFF | DIFF | 0.988 | 23141ms | 887 |
| 14 | rs/large | DIFF | DIFF | 0.981 | 130178ms | 5168 |
| 15 | rs/medium | DIFF | DIFF | 0.985 | 62474ms | 1903 |
| 16 | sql/small | EXACT | EXACT | 1.000 | 4178ms | 188 |
| 17 | typescript/medium | DIFF | DIFF | 0.981 | 55896ms | 1844 |
| 18 | typescript/small | DIFF | DIFF | 0.829 | 2951ms | 135 |
| 19 | javascript/medium | DIFF | DIFF | 0.986 | 84422ms | 3483 |

## 注記

- `exact_match`: モデル出力が ground truth `final_code` とバイト一致
- `ws_match`: 行末空白トリム + 前後空行トリム後で一致
- `line_sim`: 行 LCS による Dice 類似度 (2*LCS/(n+m))
- ファイル書き込みは行わず、コアパイプライン (`buildPrompt` → API → `parseOutput`) のみを実測
