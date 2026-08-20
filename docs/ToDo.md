# pi-fa-merge — ToDo / セッション引き継ぎドキュメント

| 項目 | 内容 |
|------|------|
| 更新日 | 2026-08-20 |
| 最新コミット | agent-rewrite 実験(4B 直接書き直し)完了コミットまで。最新は `git log -3` で確認 |
| リポジトリ | `C:\Users\Game\MyDevEnv\wd\pi-fa-merge`(リモート: github.com/kmlaborat/pi-fa-merge) |
| インストール先 | `C:\Users\Game\MyDevEnv\.home\.pi\agent\git\github.com\kmlaborat\pi-fa-merge`(`9549fe2` まで pull 済み、`.env` は存在) |
| 前提PJ | `C:\Users\Game\MyDevEnv\wd\AnchorScope` / `AnchorEdit`(v2、`main` clean。AnchorScope はライブラリ依存。`anchoredit` バイナリ v2.0.0 はインストール済み — 修正なければ再 `cargo install` 不要) |

## プロジェクト概要

kortix-ai/fast-apply 仕様に準拠した pi 拡張。エージェントが `original_code` + `update_snippet`(コード)を渡し、fast-apply モデルがマージした結果を `anchoredit`(hash 検証付き)でファイルに直接書き込む。OpenAI 互換エンドポイント任意。runtime 依存ゼロ(Node 標準 + pi フレームワーク + typebox のみ)。

## 主要ファイル

| パス | 内容 |
|------|------|
| `extensions/index.ts` | ツール `fa_merge` + スラッシュコマンド `/reload-fa-env` + ファイル系ロジック。純粋コアは `core.ts` からの re-export |
| `extensions/core.ts` | **純粋 fast-apply コア**(pi フレームワーク非依存): `buildPrompt` / `callOpenAiCompatibleApi` / `parseOutput` / `validateStructure` / `withRetry` 等。ハーネスとテストが直接使う |
| `extensions/env.ts` | `.env` ローダー(pi-fc-search と同設計、`tests/env.test.ts` で直接テスト) |
| `tests/merge.test.ts` / `tests/env.test.ts` | 実関数の直接ユニットテスト計 59 件 |
| `harness/fetch-cases.mjs` | HF `Kortix/FastApply-dataset-v1.0` test split から層化抽出(言語×トークン帯)→ `harness/cases.json` |
| `harness/run.mts` | ベースラインハーネス: `buildPrompt`→API→`parseOutput` を直接駆動。`--case N` / `--timeout MS` 対応。結果は `harness/results/<run-id>/` |
| `harness/results/baseline-2026-08-19.md` | **ベースライン報告書**(完全一致 65% / sim≥0.95 80% / validateStructure 誤爆 25%→修正で 0 等) |
| `harness/block.mjs` | GT diff(LCS)からブロック+re-scoped snippet を機械抽出 → `cases-block.json`(末尾改行不整合・del 境界を処理。splicing 不変条件を全件で検証) |
| `harness/instructions.json` | 20 件の自然言語編集指示(手書き、コード本文なし) — mode C/D 用 |
| `harness/results/ab-experiment-2026-08-20.md` | **2軸 A/B 実験報告**(A 65% / B 45% / C 15% / D 15% EXACT、ブロックで 2 倍速・-43% tok、NL は不採用判断) |
| `harness/results/agent-rewrite-2026-08-20.md` | **agent-rewrite 実験報告**(4B 直接書き直し: 15% EXACT、B に未達。4B は reasoning モデルで `enable_thinking:false` 必須) |

`extensions/core.ts` の `callOpenAiCompatibleApi` は任意の `extraBody`(例: `chat_template_kwargs`)をリクエストに追加可能(reasoning モデル対応)。
| `docs/SPEC.md` | 契約(パラメータ・エラー種別・受け入れテスト)。実装と同期済み |
| `skills/pi-fa-merge/SKILL.md` | エージェント向けスキル |

## 確定した設計判断(勝手に変えないこと)

1. **純粋 fast-apply 意味論**: パラメータは `original_code` + `update_snippet`(v2 の `source`/`instruction` は廃止)。`update_snippet` は**自然言語ではなくコード**(変更コードのみ + 前後コンテキスト行 + `... existing code ...` 省略マーカー、最終コードの正確な部分集合)。
2. **prompt はファインチューニング学習テンプレートとバイト一致**: system("You are **an** coding assistant..."、upstream の typo を含む)/ user(インラインタグ `<code>{...}</code>` / `<update>{...}</update>`)。`buildPrompt` のテストが完全一致をアサートしている。
3. **`.env` ロード規則**(pi-fc-search 整合):
   - `FAST_APPLY_*` / `ANCHOREDIT_*` プレフィックスのキーのみ適用(他は無視+警告。`PATH=...` 等によるホストプロセス横取り防止)
   - **パッケージの `.env` が単一の信頼源 → process.env を上書き**(標準 dotenv と逆の優先順位)。理由: エージェントが env を誤変換しても `.env` の値に復帰できる
   - `import.meta.url` ベースでパッケージルートの `.env` のみ(旧実装の cwd/`__dirname` 3候補試行は廃止)
   - `.env` から削除したキーは process.env から消えない(書き込みのみ。pi 再起動でクリア)
4. **`/reload-fa-env`**: 実行時に `.env` を再読込(pi 再起動不要)。pi-fc-search は `/reload-env` なので、**衝突回避と明示性のため `reload-fa-env`**。設定は各 `fa_merge` 呼び出し時に process.env から解決されるため、再読込→次回呼び出しで反映。
5. **Windows argv 上限対策**: 1000 文字超の anchor/replacement は一時ファイル + `--anchor-file`/`--replacement-file`(installed anchoredit 2.0.0 がサポート)。`finally` でクリーンアップ。
6. **エラー種別**: 行超過は `FILE_TOO_LARGE`(VALIDATION_ERROR ではない)、retry は `ApiError.status` ベース(429/5xx。メッセージ部分一致は廃止)。
7. **成功時返却**: JSON `{success: true, updated_code}`。
8. **`parseOutput`**: 抽出コードの先頭・末尾改行を**各1行だけ**除去(`trim()` 禁止 — 意図的な空行を破壊するため)。
9. **Node >= 22.19**(pi-coding-agent の engines 要件。CI は Node 22)。

## 前回セッションの作業履歴(要約)

| コミット | 内容 |
|---|---|
| `1671b25` | テストを実装に接続(純粋関数 export + 直接テスト化) |
| `81f3c6e` | Windows argv 上限対策(一時ファイル + `-file` フラグ) |
| `0a8789b` | SPEC/README/SKILL の v2 契約同期(後に 6 で一部逆行) |
| `1525b97` | prompt を upstream 推論フォーマットに完全一致、成功時 JSON、`FILE_TOO_LARGE`、`.env`/getter/API 応答のガード |
| `ee6533e` | `ApiError` status 判定、デッドコード削除、CI 依存チェック強化、strict tsconfig、vitest.config.mts |
| `95da96b` | **fast-apply 純粋回帰**(`original_code`/`update_snippet`、学習テンプレートとバイト一致) |
| `7978738` | CI Node 20→22(pi-coding-agent が >=22.19 を要求) |
| `9549fe2` | `.env` ロードの pi-fc-search 整合 + `/reload-env` 追加(→ 次コミットで `reload-fa-env` に改名) |
| `06b43eb` | `/reload-fa-env` 改名 + この文書追加 |
| (本セッション) | ① 純粋コアを `extensions/core.ts` に抽出(pi 非依存化。index.ts は re-export で後方互換、59 テスト維持) ② 評価ハーネス `harness/` 新設 + **実測ベースライン実行**(20 件、結果 `harness/results/baseline-2026-08-19.md`) ③ e2e(anchoredit 書き込み)確認完了 ④ **validateStructure 誤爆修正**(prefix `startsWith` → 50% 存在チェック、テスト 61 件、再実行で誤爆 0/20 を確認) ⑤ README タイムアウト推奨追記 ⑥ **2軸 A/B 実験実行**(full/block × code/NL、`harness/block.mjs` 新設、結果 `harness/results/ab-experiment-2026-08-20.md`) ⑦ **agent-rewrite 実験実行**(4B 直接書き直し、thinking モデル問題の発見・対処、`extraBody` 追加、結果 `harness/results/agent-rewrite-2026-08-20.md`) |

## 実測ベースラインの結果サマリ(詳細: `harness/results/baseline-2026-08-19.md`)

- データ: HF `Kortix/FastApply-dataset-v1.0` **test** split から層化 20 件(Python は元データセットにほぼ無く不包含)。
- モデル: FastApply-7B(ローカル OpenAI 互換エンドポイント。実 `.env`)。
- **完全一致 13/20 (65%)、sim≥0.95 まで 16/20 (80%)、MALFORMED 0 件**。
- 実モデルエラー 4/20(挿入欠落・別関数本体生成・コメント削除)。`... existing code ...` 省略と 4k tok 超の入力で相関。
- **`validateStructure` の prefix 必須チェックが誤爆 5/20 (25%)** — 先頭(import 等)を正当に変更するケースで `startsWith` 検証が誤って失敗し、GT と完全一致の出力を `STRUCTURE_MANGLE_ERROR` で拒否。pipeline 成功率を 80%→55% に圧縮。
- ローカルモデルは 4k tok 超で 60〜130s → `FAST_APPLY_TIMEOUT` 既定 60s では TIMEOUT 7/20。ローカル運用は 180s+ 推奨(README に追記済み)。
- 自然言語 A/B(次項)の比較基準 = 上記数値(モデルレベルは 2.5 修正で不変)。
- **2.5 修正後の再実行**(同一 20 件、`harness/results/2026-08-19T22-53-44-539Z/`): 誤爆 **0/20**、pipeline 成功率 **19/20 (95%)**、正当拒否 1 件のみ(case 18: docstring 削除)。詳細はベースライン報告書の「修正後検証」節。

## 次のやること(優先度順)

### 1. ~~実測ベースライン~~ — **完了 (2026-08-20)** ⭐
報告: `harness/results/baseline-2026-08-19.md`。以下は当初の計画(記録用)。

目的: 純粋 fast-apply(分布内)の精度を定量し、自然言語実験の比較基準にする。

- **評価ハーネス設計**
  - ケース: upstream データセット `Kortix/FastApply-dataset-v1.0`(HF)から 10〜30 件抽出(TS/Python 混合、サイズ帯を混ぜる)。`original_code` / `update_snippet` / `final_code`(ground truth)の3列で構成
  - 実行: 実 `.env` のエンドポイントに対して `fa_merge` の中核(`buildPrompt` → `callOpenAiCompatibleApi` → `parseOutput`)を直接駆動(ファイル書き込みは不要)
  - 指標: 完全一致率(whitespace 無視も併記)、行単位一致率、`parseOutput`/構造検証通過率、MALFORMED/STRUCTURE_MANGLE の内訳、レイテンシ、推定トークン
  - ハーネスの置き場所候補: `harness/`(pi-fc-search が同様の構成: `run.mjs` / `results/`)
- **baseline 計測 → 結果を `harness/results/` に保存**
- 副産物: 実エンドポイント + anchoredit 書き込みのエンドツーエンド初回確認

### 2. ~~スコープ × 指示 2軸 A/B 実験~~ — **完了 (2026-08-20)**
**報告: `harness/results/ab-experiment-2026-08-20.md`**。要点:
- **A(全文+コード) 65% EXACT / B(ブロック+コード) 45% / C(ブロック+NL) 15% / D(全文+NL) 15%**(ファイル級完全一致、同一 20 件)
- ブロック渡し: EXACT は下がるが sim≥0.95 は 85% で不変。**レイテンシ 2 倍速、入出力トークン -43%**。失敗の中心は「挿入位置のズレ」(省略マーカー+繰り返し構造行)。
- **自然言語指示は決定的に劣る**(全文スコープでも 15%) → fast-apply への NL は採用しない判断材料。
- ブロック抽出(`harness/block.mjs`): GT diff から機械抽出、splicing 不変条件を全件で検証済み。データセットの末尾改行不整合(15/20)への対処含む。
- 以下は当初の設計(記録用):
  - **背景**: 小規模 agentic モデル(InternScience/Agents-A1-4B 級)に編集能力付与。4B が「編集する部分(ブロック)+ 変えたい内容」を生成 → fast-apply → anchoredit 書換。
  - ブロック = import 直前までの先頭ヘッダー + 各変更 hunk ± 5 行。指標はブロック級 + splicing 後のファイル級。

### 5. 4B agentic モデルとのエンドツーエンド(**次の着手先**) ⭐
- **Agents-A1-4B は serve 済み**(`FASTCONTEXT_*`、llama-swap + `Agents-A1-4B-Q8_0.gguf`、FastApply と同一ホスト)
- **第一実測(agent-rewrite: 4B がブロック+NL から直接書き直し)は完了** → 報告 `harness/results/agent-rewrite-2026-08-20.md`。
  - EXACT 3/20 (15%)、sim≥0.95 8/20 (40%)、avgSim 0.902 → **B(block+code via fast-apply: 45%/85%)に未達**。NL 系(C/D)とほぼ同水準
  - 失敗プロファイル: ① 空行等のフォーマット差(機能は正しい、例: case 7) ② 挿入位置誤り ③ ファイル idiom 未踏襲(例: `@apply` 不使用)
  - **重要: 4B は reasoning モデル**。thinking 有効だと `content` 空・TTFT 数分(タイムアウト地獄)→ `chat_template_kwargs:{enable_thinking:false}` で計測。thinking on は未計測の重要変数
  - core.ts の `callOpenAiCompatibleApi` に `extraBody` を追加済み(本ツール化でもそのまま使える)
- 次の検証(費用順):
  1. 4B thinking on(max_tokens/タイムアウト拡大、少数ケース)で推論品質の寄与を確認
  2. プロンプト強化(few-shot、idiom 踏襲、フォーマット指定)
  3. **4B がコード snippet を書く構成**(= B の agent 版、fast-apply が merger に復帰)→ 成功すれば「snippet 経路 + 直接書き直し経路」の 2 戦略 PJ に
- 未着手: 「4B が fa_merge 引数を生成」のハーネスモード(引数生成を評価)

### 2.5. ~~validateStructure の誤爆修正~~ — **完了 (2026-08-20)** ⭐
- 実測データで閾値を設計: 誤爆 5 件の prefix 行存在率は 75〜100%、実エラー(docstring 削除)は 0% → **`startsWith` を「非空 prefix 行の 50% 以上が出力に(行トリムして)存在」に緩和**(`extensions/core.ts`)。
- 単体テスト 59→61 件(正当な先頭編集・署名変更を受理する回帰テスト 2 件追加)。SPEC.md の検証記述も同期。
- **同一 20 件の再実行で検証**: 誤爆 0/20(従来 5/20)、pipeline 成功率 19/20 (95%)、正当拒否は case 18 のみ。case 9/14(中間欠落・別関数生成)は存在率 100% で検出不能(構造検証の役割は「壊滅的 mangling ガード」に収束)。
- 副次対応: README に「ローカルモデル運用は `FAST_APPLY_TIMEOUT=180000`+ 推奨」を追記。

### 3. リリース準備(破壊的変更)
- `source`/`instruction` → `original_code`/`update_snippet` は破壊的 → version `2.0.0` → **`3.0.0`** + git tag
- CHANGELOG 作成(上記作業履歴 + `/reload-fa-env` 改名)
- README の version 表記など整合確認

### 4. 軽微項(任意)
- lint の実導入(現在 `npm run lint` は placeholder。README/CI では非ブロッキングと明記済み)
- ~~構造検証の閾値チューニング~~ → **2.5 に昇格済み(誤爆を実測で確認)**

## 注意事項 / 実務メモ

- **拡張コードの変更は pi セッション再起動で反映**(pi 拡張はセッション開始時にロード)。`/reload-fa-env` は `.env` 再読込のみで、コード反映にはならない。
- **実測の環境メモ**: エンドポイントはローカル GPU の FastApply-7B(`.env` 参照)。1 レクエスト 3〜130s。ハーネスは `npx tsx harness/run.mts` で起動し、`.env` は**インストール先**のものを `applyEnvContent` で読み込む(リポジトリ側 `.env` は存在しない)。`--timeout` で上書き可。
- **HF datasets-server はレート制限あり**(429)。全行取得はキャッシュ `harness/tmp/test-rows.json` を再利用(`fetch-cases.mjs` が自動利用)。
- `.env`(インストール先)に実 API キーがある — コミットしないこと(`.gitignore` 済み)。実測(ToDo 1)で使う。
- `docs/refactoring-plan-v2.md` は gitignore 済みのローカル文書で、**内容(v2 の自然言語設計)は 95da96b で撤回済み**。新しい判断材料にはしないこと。
- fast-apply 仕様の一次情報は `https://github.com/kortix-ai/fast-apply`(README の推論プロンプト + `notebooks/Fine-Tuning__FastApply-7B-Instruct.ipynb` の `formatting_prompts_func` が学習データ形式の正体。README と学習テンプレートで "a/an coding" が微妙に違うが、**学習テンプレート側(an)に合わせる**)。
- anchoredit CLI(本セッションで実証): anchor 文字列が `-` で始まると clap がフラグと誤認する — 編集ツールで扱うときは anchor を非ダッシュ文字で始めるか `-file` フラグを使う。
- 成功/失敗の CI 確認は `curl https://api.github.com/repos/kmlaborat/pi-fa-merge/actions/runs?per_page=1` でポーリング可能(ログ本体は未認証では取得不可。ジョブの steps conclusion まで見られる)。
- **`harness/tmp/` は gitignore 済み**(生データキャッシュ 2.4MB、probe スクリプト)。コミットする成果物は `cases.json` / `run.mts` / `fetch-cases.mjs` / `results/` のみ。
- **`extensions/core.ts` 抽出の意味**: `index.ts` は `@earendil-works/pi-coding-agent` を import するため、Node 標準 ESM では解決不能(その package.json は `import` エクスポートのみで `require` 不可、且つリポジトリ root に `"type": "module"` が無い)。ハーネス/スクリプトは **`core.ts` を直接 import すること**(pi 非依存)。
