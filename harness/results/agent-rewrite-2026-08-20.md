# agent-rewrite 実験:4B がブロックを直接書き直す(A/B/C/D の延伸、2026-08-20)

## 目的

「fast-apply に NL を持たせず、**別のモデルに書き換えを担当させる**」構成の検証:
`Agents-A1-4B`(instruct/thinking モデル)に「ブロック + 自然言語指示」を与え、**書き直されたブロック全文**を直接生成させる。fast-apply はこのループには使わない。

## 設定

- 同一 20 ブロック(`cases-block.json`)+ 同一 NL 指示(`instructions.json`)
- モデル: `Agents-A1-4B-Q8_0.gguf`(llama-swap、FastApply-7B と同一ホスト)
- プロンプト: 簡易な editor プロンプト(「ブロックを指示に従い書き直し、書き直し後のブロックのみを返せ」)。few-shot なし
- **重要発見: Agents-A1-4B は reasoning モデル**。`reasoning_content` に思考を吐き、thinking 有効だと思考が token 上限を食って `content` が空・TTFT 数分になる(300s タイムアウト × リトライで 1 件 20 分超過)。`chat_template_kwargs: {enable_thinking: false}` で無効化して計測(このフラグは llama.cpp 系 serve の対応次第)
- ハーネス: `run.mts --mode agent-rewrite`(core.ts に `extraBody` パラメータ追加で `chat_template_kwargs`/`max_tokens` を渡せるようにした — 本ツール化してもそのまま使える)
- 結果: `results/2026-08-20T04-46-49-803Z/`

## 結果(全モード比較、同一 20 件)

| | A 全文+コード(FA) | B ブロック+コード(FA) | C ブロック+NL(FA) | D 全文+NL(FA) | **E 4B 直接書き直し** |
|---|---|---|---|---|---|
| ファイル級 EXACT | 13/20 (65%) | 9/20 (45%) | 3/20 (15%) | 3/20 (15%) | **3/20 (15%)** |
| ファイル級 WS 以上 | 13/20 | 15/20 (75%) | 3/20 | 3/20 | **4/20 (20%)** |
| sim ≥ 0.95 | 17/20 (85%) | 17/20 (85%) | 10/20 (50%) | 15/20 (75%) | **8/20 (40%)** |
| sim 平均 | 0.984 | 0.975 | 0.910 | 0.963 | **0.902** |
| 中央値レイテンシ | 38.9s | 18.2s | 18.3s | 38.0s | 17.2s |
| 途中省略(`...`)出力 | — | 0 | 0 | 0 | 0 |

(FA = FastApply-7B。E のレイテンシは thinking off 前提)

## 発見事項

1. **4B の直接書き直しは「機能としては近い」がバイト一致には遠い**: 代表例 case 7(SQL)は指示どおりの 3 文を正しく生成したのに、GT 文間の**空行だけ無い**ために sim 0.857 / ファイル級 diff。実際の編集ループではこれで機能は正しい。一方 case 0(CSS)は**挿入位置の誤り**+**ファイルの idiom 未踏襲**(`@apply` を使わず素の CSS)という実質エラー。
2. **E ≈ C/D(NL 系)の水準、B より下**: 4B の簡易プロンプトでのブロック書き直し(avgSim 0.902)は、fast-apply に NL を渡す場合(C: 0.910 / D: 0.963)とほぼ同水準。つまり「別モデルに書かせた」ことで NL 経路の精度は上がっておらず、**コード snippet 経路(B)がまだ最有力**である。
3. **thinking の有無は未計測の重要変数**: thinking off で速度/安定性を確保した代わりに推論品質を犠牲にしている。thinking on + 大きな max_tokens + 長いタイムアウトなら精度が上がる可能性はある(今回は 1 件 20 分超のタイムアウトで実測不能)。
4. **プロンプトが素**: few-shot なし・指示は 1〜2 文。4B に fair な評価にはない。
5. **運用メモ**: llama-swap(GGUF Q8_0)は `/models` は 69ms で応答するが生成は共有 GPU の負荷で変動(TTFT 13s〜90s+)。thinking モデルの chat API は `chat_template_kwargs.enable_thinking` でないと実用上扱えない。

## 設計への示唆(ToDo 5 へ)

- **「別モデルに書かせる」枠組み自体は成立**(本 PJ の anchoredit 書換経路・ブロック抽出・指標はそのまま流用。E はその実証)
- ただし現状の 4B + 簡易プロンプトでは **B(block+code via fast-apply)に勝てない**。次に測るべき変数(費用順):
  1. 4B に thinking on(推論品質)を許容する運用 — タイムアウト/max_tokens を大きくして少数ケースで精度確認
  2. プロンプト強化(few-shot 例、idiom 踏襲の明示、空行/フォーマットの指定)
  3. 4B が「ブロック全文」ではなく「コード snippet」を書く構成(= B の agent 版。fast-apply が merger に戻る)
- 3 が機能すれば、PJ は「agent が snippet を書く → fast-apply がマージ → anchoredit が書く」+「agent が直接書き直す」の**2 戦略持ち**になり、モデルの強さで動的選択できる(= ユーザーの「その部分だけ別モデル」の構想の着地点)

---

# 第 2 ラウンド:専用チャットテンプレートモデル(2026-08-20 午後)

ユーザーが同一エンドポイントに 2 つのモデル名を用意: **`Agents-A1-4B-Instruct`**(CoT 無効テンプレート)と **`Agents-A1-4B-Thinking`**(CoT 有効テンプレート)。`chat_template_kwargs` 不要で CoT を制御。

## 結果

| | EXACT | WS 以上 | sim≥0.95 | avgSim |
|---|---|---|---|---|
| B block+コード(FA) | 9/20 (45%) | 15/20 (75%) | 17/20 (85%) | 0.975 |
| **E0 4B + thinking off(前回)** | 3/20 (15%) | 4/20 (20%) | 8/20 (40%) | 0.902 |
| **E1 Agents-A1-4B-Instruct(全 20)** | **2/20 (10%)** | **3/20 (15%)** | **8/20 (40%)** | **0.881** |
| **E2 Agents-A1-4B-Thinking** | — | — | — | **実用上不可**(下記) |

- E1 の結果ディレクトリ: `results/2026-08-20T09-13-30-289Z/`
- **E1 ≈ E0**(avgSim 0.881 vs 0.902、ケースごとの差 >0.02 は 0.7 の 2 件だけで互いに相殺)。専用 Instruct テンプレートは前回の `enable_thinking:false` と同等であることを確認
- **Thinking は実測不能**: 最小ケース(8 行 SQL)で **32768 トークンを思考だけで使い切っても content 空**(約 13 分、45 tok/s で思考のみ継続)。健全性チェック(「2+2?」)では思考 487 字で正答・ループなし → モデルの破損ではなく、**このコード編集タスクで思考長が実用予算を 3 桁超えで超過**

## 副次発見(重要・運用メモ)

1. **llama-swap は non-streaming の応答を ~300s で遮断**: 306s で `fetch failed` が再現(2 回)。ストリーミングだと 370〜778s まで生存(チャンクがアイドルをリセット)。
2. 対応: `callOpenAiCompatibleApi` に **SSE ストリーミング**(第 6 引数 `CallOptions { stream }`)を追加。rewrite モードは常にストリーミング使用。slow ローカルモデルの long generation で必携(テスト 61 件維持、CI 緑)。
3. llama-swap の `/models` はモデルを `unloaded` 状態として返し、初回リクエストでロード(GGUF スワップに数秒)

## 再現

```bash
# Instruct(推奨・全件 ~10 分)
npx tsx harness/run.mts --mode agent-rewrite --rewrite-model Agents-A1-4B-Instruct --timeout 300000
# Thinking(実測不能:最小ケースで思考 32k tok 超過。記録のため)
npx tsx harness/run.mts --mode agent-rewrite --rewrite-model Agents-A1-4B-Thinking --case 7 --max-tokens 32768 --timeout 1800000
# 前提: インストール先 .env に FASTCONTEXT_ENDPOINT/API_KEY
```
