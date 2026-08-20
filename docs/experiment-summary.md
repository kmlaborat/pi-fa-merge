# 実験総括:pi-fa-merge のモデル駆動ブロック編集への道(2026-08-19 〜 08-20)

> 本セッションの全実験・発見・設計判断の総括。詳細は
> `harness/results/baseline-2026-08-19.md` / `ab-experiment-2026-08-20.md` /
> `agent-rewrite-2026-08-20.md`(4 ラウンド)を参照。

## 1. 出発点(元の目標)

小さい agentic モデル(InternScience/Agents-A1-4B)にコード編集能力を持たせる:
「**ブロック + 自然言語指示** → 書き直されたブロック」を返し、`anchoredit`
(hash 検証付き)でファイルに書く。pi 拡張 **pi-fa-merge**(fast-apply 仕様の
merge ツール)の枠組み(anchoredit 書換経路・ブロック抽出・評価指標)を
モデル非依存な土台として再利用できるかの検証が主轴になった。

## 2. 地盤整備

- **core.ts 抽出**: fast-apply パイプラインを pi フレームワーク非依存の純粋
  コアとして分離(`buildPrompt` / `callOpenAiCompatibleApi` / `parseOutput` /
  `validateStructure` / `withRetry` 等)。ハーネスとテストが直接利用
- **評価ハーネス**(`harness/`): HF FastApply-dataset の層別 20 事例 +
  ブロック抽出器(LCS hunk、splicing 不変量で GT 再構成 20/20 検証)+
  複数モードのランナー(`--mode` / `--case` / `--timeout` / `--rewrite-*`)
- **validateStructure 誤爆修正**: 接頭辞の完全一致チェックを「プレフィックス行
  の 50% 以上存在(トリム後)」へ。誤爆 5/20→0/20、パイプライン成功 55%→95%
- **テスト 64 件、CI 常時緑、全コミット push 済み**

## 3. 実験の全体像(同一 20 ブロックで比較)

| ラベル | 構成 | EXACT | WS 以上 | sim≥0.95 | avgSim |
|---|---|---|---|---|---|
| **A** | 全文+**コード snippet** → FastApply-7B | **13/20 (65%)** | 13/20 | 85% | 0.984 |
| **B** | ブロック+**コード snippet** → FastApply-7B | 9/20 (45%) | 15/20 (75%) | **85%** | 0.975 |
| C | ブロック+**NL 指示** → FastApply-7B | 3/20 (15%) | 3/20 | 50% | 0.910 |
| D | 全文+**NL 指示** → FastApply-7B | 3/20 (15%) | 3/20 | 75% | 0.963 |
| E0 | ブロック+NL → **4B**(thinking off) | 3/20 (15%) | 4/20 | 40% | 0.902 |
| E1 | ブロック+NL → **4B-Instruct**(専用テンプレート) | 2/20 (10%) | 3/20 | 40% | 0.881 |
| E2 | ブロック+NL → **4B-Thinking** | — | — | — | **実測不能**(下記) |
| E3 | ブロック+NL → **maple-preview-2bit**(mlx-lm) | 1/20 (5%) | 1/20 | 5% | 0.542 |
| E4 | ブロック+NL → **FastApply-7B**(instruct として) | 0/20 (0%) | 1/20 | 25% | 0.838 |

(A/B/C/D: `ab-experiment-2026-08-20.md`、E0: agent-rewrite 第 1 ラウンド、
E1/E2: 第 2 ラウンド、E3: 第 3 ラウンド、E4: 第 4 ラウンド)

## 4. 得られた結論

### 設計判断(データで確定)

1. **fast-apply には NL を渡さない**(C/D: EXACT 15%)。指示は agent が
   **コード snippet** に変換して渡すのが正解
2. **ブロック単位は有効だが trade-off 付き**(B): EXACT は 65%→45% に下がるが
   sim≥0.95 は 85% で不変、**レイテンシ半分・トークン -43%**
3. **「別モデルに直接書かせる」経路(rewrite)は現状、snippet 経路(B)に
   勝てない**。E0〜E4 すべて B に未達
4. **用途適合がすべてを決める**: FastApply-7B は自らの訓練タスク(merge)では
   最強(45%)だが、そのまま rewrite に使わせると 4B 以下(0%/0.838)。
   推論で評判だった maple-preview も **2bit 量子化で反復デジュネレーション**
   (348 行 Rust で `inline_globals2` を数百回繰り返すループ+無意味 import)

### 運用・インフラの発見(本ツール化に直結)

5. **4B は reasoning モデル**: thinking 有効だと思考が token 予算を食い
   `content` 空・TTFT 数分(1 件 20 分超のタイムアウト地獄)。専用
   チャットテンプレートモデル(Instruct/Thinking)で解決。Thinking 版は
   最小ケース(8 行 SQL)で**思考 32k トークンを超過**し content 空 =
   実用上不可(モデル自体は健全: 2+2 検査で正常、ループなし)
6. **llama-swap は non-streaming 応答を ~300s で遮断**(306s で
   `fetch failed` が再現、2 回)。ストリーミングはチャンクがアイドルをリセットし
   370〜778s 生存 → core.ts に **SSE ストリーミング**
   (`CallOptions { stream }` + `readStreamedContent`)を追加、rewrite モードは
   常時ストリーミング
7. **mlx-lm はキー不要・高速**(小プロンプト ~1s、~60 tok/s)→ ハーネスに
   `--rewrite-endpoint` / `--rewrite-key` / `--rewrite-model` / `--max-tokens`
   フラグを追加し、`.env` 変更なしで任意のエンドポイントを計測可能に
8. llama-swap の `/models` は `unloaded` 状態を返し初回リクエストで GGUF を
   ロード(数秒)。共有 GPU 故に TTFT は 13s〜90s+ と変動

### 失敗プロファイルの知見

9. rewrite 系の「ミス」の多くは**機能としては正しく空白差だけ**(空行・行末
   スペースの継承)。**byte-exact ではなく ws 一致以上が実用上の成功に近い**
10. 残る実質エラーは ① 挿入位置の誤り ② ファイル idiom 未踏襲
    (例: `@apply` を使わず素の CSS) ③ 大ブロックの截断
    (E4 case 5: 305 行ブロックで出力 14 行で停止)

## 5. 到達した設計(次の実装の方針)

```
[ 4B agent(頭脳) ]  →  ファイルを読んで「どのブロックをどう直すか」判断
        │
        ├─ 小ブロック: 自分でブロックを書き直す (E1 経路)
        └─ 大ブロック/精密編集: コード snippet を書く (B 経路)
                ↓
        [ FastApply-7B(merger) ] → マージ
                ↓
        [ anchoredit(hash 検証) ] → ファイル書換
```

- pi-fa-merge は「**モデル駆動ブロックエディタ**」に拡張: merge バックエンド
  (FastApply-7B)+ rewrite バックエンド(任意の instruct モデル)の 2 戦略
- 「その部分だけ別モデルで書く」という構想は、この分業で着地する

## 6. 残タスク

| # | 内容 | 優先度 |
|---|---|---|
| 1 | **agent が fa_merge 引数を生成する構成の実証**(B の agent 版 — 上の方針の中核) | **高** |
| 2 | **プロンプト強化検証**(few-shot・idiom 踏襲・フォーマット指定)で rewrite 精度を B に近づけられるか | 中 |
| 3 | リリース 3.0.0(バージョン bump・CHANGELOG・tag) | 中 |
| 4 | lint | 低 |

## 7. 再現メモ

```bash
# fast-apply 系(A/B/C/D)
npx tsx harness/run.mts --mode full-code|block-code|block-nl|full-nl --timeout 180000
# rewrite 系
npx tsx harness/run.mts --mode agent-rewrite --rewrite-model Agents-A1-4B-Instruct --timeout 300000
npx tsx harness/run.mts --mode agent-rewrite --rewrite-endpoint http://msm2.tail3eb0d5.ts.net:8082/v1 --rewrite-model maple-preview-2bit-mlx --timeout 600000
npx tsx harness/run.mts --mode agent-rewrite --rewrite-endpoint http://msm2.tail3eb0d5.ts.net:8081/v1 --rewrite-model FastApply-7B --timeout 600000
```

- 前提: インストール先 `.env` の `FAST_APPLY_*`(fast-apply 系)と
  `FASTCONTEXT_*`(4B 系)。mlx-lm は `.env` 不要
- 結果は `harness/results/<runId>/` に保存(コミット済み)
