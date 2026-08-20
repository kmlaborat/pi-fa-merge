# pi-fa-merge baseline run — 2026-08-20T11-24-51-067Z

- Endpoint: `http://msm2.tail3eb0d5.ts.net:8081/v1`
- Model: `FastApply-7B`
- Dataset: Kortix/FastApply-dataset-v1.0 (test split, stratified sample)
- Mode: agent-rewrite
- Cases: 20

## 指標

| 指標 | 値 |
|---|---|
| API 到達成功率 | 19/20 (95.0%) |
| parseOutput/構造検証 通過率 | 19/20 (95.0%) |
| 完全一致率(ファイル級) | 1/20 (5.0%) |
| 完全一致率(whitespace 無視、ファイル級) | 1/20 (5.0%) |
| 行単位の類似度平均 (Dice/LCS, 一致時 1.0) | 0.5415 |
| 中央値レイテンシ | 24158 ms |
| 総レイテンシ | 682472 ms |
| 入力推定トークン平均 | 927 |
| 出力推定トークン平均(成功分) | 819 |

## エラー内訳

- API エラー: API_ERROR×1
- パース/検証エラー: なし

## ケース別

| case | stratum | 結果(ファイル級) | ブロック一致 | 類似度 | latency | in~tok |
|---|---|---|---|---|---|---|
| 0 | css/medium | DIFF | DIFF | 0.345 | 28383ms | 88 |
| 1 | css/small | DIFF | DIFF | 0.067 | 4776ms | 500 |
| 2 | javascript/medium | DIFF | DIFF | 0.849 | 26915ms | 1458 |
| 3 | javascript/small | EXACT | EXACT | 1.000 | 6877ms | 82 |
| 4 | other/small | DIFF | DIFF | 0.694 | 26227ms | 630 |
| 5 | rs/large | DIFF | DIFF | 0.075 | 4708ms | 2273 |
| 6 | rs/medium | DIFF | DIFF | 0.017 | 125585ms | 3157 |
| 7 | sql/small | DIFF | DIFF | 0.571 | 4483ms | 79 |
| 8 | typescript/medium | DIFF | DIFF | 0.922 | 14268ms | 701 |
| 9 | typescript/small | DIFF | DIFF | 0.840 | 10837ms | 312 |
| 10 | vue/small | DIFF | DIFF | 0.129 | 13491ms | 554 |
| 11 | javascript/medium | DIFF | DIFF | 0.500 | 38886ms | 388 |
| 12 | javascript/small | DIFF | DIFF | 0.727 | 121909ms | 373 |
| 13 | other/small | DIFF | DIFF | 0.414 | 21380ms | 122 |
| 14 | rs/large | DIFF | DIFF | 0.751 | 36541ms | 954 |
| 15 | rs/medium | DIFF | DIFF | 0.408 | 17090ms | 1903 |
| 16 | sql/small | DIFF | DIFF | 0.643 | 24158ms | 188 |
| 17 | typescript/medium | DIFF | DIFF | 0.655 | 24359ms | 1247 |
| 18 | typescript/small | DIFF | DIFF | 0.683 | 4578ms | 135 |
| 19 | javascript/medium | API_FAIL(API_ERROR) | - | - | 127021ms | 3386 |

## 注記

- `exact_match`: モデル出力が ground truth `final_code` とバイト一致
- `ws_match`: 行末空白トリム + 前後空行トリム後で一致
- `line_sim`: 行 LCS による Dice 類似度 (2*LCS/(n+m))
- ファイル書き込みは行わず、コアパイプライン (`buildPrompt` → API → `parseOutput`) のみを実測
