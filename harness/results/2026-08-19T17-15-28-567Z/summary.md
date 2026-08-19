# pi-fa-merge baseline run — 2026-08-19T17-15-28-567Z

- Endpoint: `http://msm2.tail3eb0d5.ts.net:8081/v1`
- Model: `FastApply-7B`
- Dataset: Kortix/FastApply-dataset-v1.0 (test split, stratified sample)
- Cases: 1

## 指標

| 指標 | 値 |
|---|---|
| API 到達成功率 | 1/1 (100.0%) |
| parseOutput/構造検証 通過率 | 1/1 (100.0%) |
| 完全一致率 | 1/1 (100.0%) |
| 完全一致率(whitespace 無視) | 1/1 (100.0%) |
| 行単位の類似度平均 (Dice/LCS, 一致時 1.0) | 1.0000 |
| 中央値レイテンシ | 58071 ms |
| 総レイテンシ | 58071 ms |
| 入力推定トークン平均 | 1613 |
| 出力推定トークン平均(成功分) | 1426 |

## エラー内訳

- API エラー: なし
- パース/検証エラー: なし

## ケース別

| case | stratum | 結果 | 類似度 | latency | in~tok |
|---|---|---|---|---|---|
| 0 | css/medium | EXACT | 1.000 | 58071ms | 1613 |

## 注記

- `exact_match`: モデル出力が ground truth `final_code` とバイト一致
- `ws_match`: 行末空白トリム + 前後空行トリム後で一致
- `line_sim`: 行 LCS による Dice 類似度 (2*LCS/(n+m))
- ファイル書き込みは行わず、コアパイプライン (`buildPrompt` → API → `parseOutput`) のみを実測
