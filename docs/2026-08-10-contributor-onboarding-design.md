# 貢献者オンボーディング設計 — 「自分の町のデータを作って」で回るようにする

ステータス: **採用** (2026-08-10)
目的: このリポジトリをクローンした人が、Claude Code や Codex に
「既存の町を参考にして自分の町のデータも作って」と言えば半自動で収録まで進む状態にする。

未採用の構想は `docs/drafts/` に置く。本書は採用済みの設計である。

## 背景

2026-08-10 の作業 (西東京・武蔵野・青梅の収録と、その過程で見つかった腐りの修復) で
分かったことが 2 つある。

1. **入口が無い。** `CLAUDE.md` も `AGENTS.md` も `CONTRIBUTING.md` も無く、
   実質の正典である `docs/playbook.md` へは README 29 行目の 1 行からしか辿れない。
   この日のセッションで playbook を読めたのは、申し送りが読む順を明示していたからだった。
2. **エージェントは放っておくと「それらしいが検証していないデータ」を作る。**
   人の判断が本当に要ったのは「何をもって検証とするか」の一点に集約されていた。
   抽出そのものや照合の実行はエージェントが確実にやれる。

## 決定事項

| 論点 | 決定 |
|---|---|
| 成果物の行き先 | 既定は手元。PR も出せる。**手元だけで終わる人も一級市民** |
| 人の関与点 | **Phase 1 (探索) の直後に 1 回だけ**。検証の設計を承認する |
| 貢献者の前提 | 一定以上のスキルを持つ (git・node・コマンド実行の説明は不要) |
| 出発点 | survey が無い自治体も対象。ゼロから探索する |
| 戻し方 | **PR 一本**。submodule は採らない (下記) |
| 貢献経路 | エージェント / 手書き / 自治体公式 の 3 つを対等に扱う |
| 指示ファイル | `AGENTS.md` が実体、`CLAUDE.md` は `@AGENTS.md` の 1 行 |
| 手順の置き場 | 知識は `docs/playbook.md`、進行管理は skill |

### submodule を採らない理由

`hanno-data` / `hidaka-data` に前例があるが、`hanno-data/gomi` は
2026-07-12 の「収集日程を japan-gomi-data へ移行、旧 course-*.yaml を削除」で引き払われ、
`hidaka-data/gomi` も 7/3 で止まっている。**分散から集約へ一度舵を切った実績**がある。

集約されているからこそ効く検査が実在する。2026-08-10 に見つけた
facts 出典パス切れ 33 件はリポジトリ横断では検出できず、`ics/index.csv` の行数や
`stats.json` の自治体数という「全体を舐めて数える」検査も成立しない。
`_lib` への集約 (分類器 5 コピー → 1) もリポジトリが分かれていれば不可能だった。

## ファイル構成

### 新規

| ファイル | 目安 | 中身 | 読者 |
|---|---|---|---|
| `AGENTS.md` | 80 行 | 事実と不変条件。データの単位、触ってよい場所、コマンド、禁止事項、次に読むもの | エージェント |
| `CLAUDE.md` | 1 行 | `@AGENTS.md` (公式の import 構文) | Claude Code |
| `CONTRIBUTING.md` | 60 行 | 貢献の入口。3 経路と各々の最低条件。**手元だけで使う導線を先頭に置く** | 人間 (初見) |
| `.claude/skills/add-municipality/SKILL.md` | 100 行 | 進行管理。順序・停止点・承認の取り方・完了条件・撤退条件 | Claude Code |
| `Makefile` | 40 行 | 人間向けの入口。`make help` で一覧 | 人間 |
| `scripts/new-municipality.mjs` | 80 行 | 足場生成 | 全経路 |
| `scripts/check-regen.mjs` | 60 行 | 再生成して差分ゼロを確認 | 全経路 |
| `scripts/build-coverage.mjs` | 60 行 | `docs/coverage.md` を生成 | CI |

`CLAUDE.md` は `@AGENTS.md` の 1 行にする。Claude Code が読むのは `CLAUDE.md` で
`AGENTS.md` ではないが、公式ドキュメントが「既に `AGENTS.md` を使うリポジトリでは
`CLAUDE.md` から import して両方のツールが同じ指示を読むようにせよ」と案内している
import 構文がこれ。**内容の実体は `AGENTS.md` 側だけ**なので drift しない。
symlink (`ln -s AGENTS.md CLAUDE.md`) も公式に認められた方法だが、
普通のテキストファイルで済むほうが環境依存が少ないため import を採る。

### 変更

- `README.md` — 収録自治体リスト (49 行) を `docs/coverage.md` へ追い出す
- `docs/playbook.md` — §5 (統括者向け並行運用) のうち skill へ移る部分を削る。他は現状維持
- `schema/schedule.schema.json` — `source.provenance` 追加 / `source.confidence` 削除
- `schema/meta.schema.json` — `summary` (1 行) を必須で追加
- `scripts/check-tools.mjs` — provenance / summary の欠落検出を追加
- `package.json` — スクリプト追加

### 移動

- `docs/2026-07-16-national-scaling-draft.md` → `docs/drafts/`
- `docs/2026-07-20-meta-rule-format-draft.md` → `docs/drafts/`

メタルール草案は「rules+overrides を年度射影ではなく生成規則にする」という
**現行スキーマを否定する内容**で、未実装のまま `docs/` 直下にある。
エージェントがこれを現行方針と誤読して schema を変え始める事故を防ぐため隔離し、
冒頭に「未採用」を明記する。

## フローと承認ゲート

skill は 4 段階で進み、**停止するのは 1 回だけ**である。

```
Phase 0  handle をレジストリで引く / 既存 survey を読む       … 自動
Phase 1  ソース探索 → 【調査報告を出して停止】              … ★人が承認
Phase 2  抽出実装 → 自己照合 (再展開が実日付と一致)          … 自動
Phase 3  独立照合 → 記録                                     … 自動
Phase 4  仕上げ (meta/taxonomy/survey/facts) → make test      … 自動
```

### Phase 1 の報告に必ず含める 4 項目

1. **一次ソース** — URL・形式・収録期間・ライセンス
2. **独立照合に何を使うか** — 無ければ「無い」と明言し、`verified_by` に
   自己照合のみと書く旨を宣言する
3. **正典語彙に収まらない品目とその処理案** — 同日の別品目に寄せる / 除外 /
   語彙追加の相談。**語彙追加は上流の判断**なので貢献者に決めさせない
4. **撤退の可能性** — 機械可読でない・地区割に確信が持てないなら、
   ここで「survey だけ残して終了」を提案する

3 は 2026-08-10 の青梅 (ガラス・陶磁器が正典語彙に無い) がそのまま該当する。
4 は playbook の「推測でデータを作らない」を進行管理に落としたもので、
**収録できなくても survey が 1 件増えるなら正しい完走**とする。

### 撤退条件

次のいずれかに当たったら Phase 2 に進まず、survey.yaml だけ書いて終了する。

- 一次ソースが機械可読でない (画像 PDF・アプリ内のみ)
- 地区割 (どの町がどのコースか) が公開資料から確定できない
- 第三者商用アプリ (ごみスケ・さんあ〜る等) しか情報源が無い — 方針 2026-07-18 により不採用

## コマンド体系

`Makefile` を人間向けの入口にする。中身は npm scripts を呼ぶだけで、
実装は npm 側に置く (CI は npm を直接叩く)。

```
make help                              # ターゲット一覧
make setup                             # npm ci
make test                              # 全ゲート
make new HANDLE=ome PREF=tokyo KIND=pdf # 足場生成
make regen HANDLE=ome                  # 再生成して差分ゼロを確認
make verify HANDLE=ome                 # その自治体の verify を実行
make ics                               # .ics と stats を生成
make coverage                          # docs/coverage.md を生成
make editions                          # 次版の公開状況を確認
```

### `make new`

レジストリ (`tecolicom/city-tecoli-data`) で handle を検証し、次を用意する。

- `municipalities/<pref>/<handle>/survey.yaml` の雛形 (未収録なら)
- `tools/<kind>-extractor/<handle>/` に `_template` を展開し、handle・pref・period を埋める
- `tools/<kind>-extractor/<handle>/.gitignore` に `cache/`

2026-08-10 に西東京で手作業した部分をそのまま自動化する。

### `make regen`

**この日いちばん効いた技法の自動化**である。build を走らせて `git diff --exit-code` を見る。

- リファクタしてもデータが変わっていないことを機械で言える (この日 15 回手で実行した)
- **生成物への手編集を検出できる** — この日 3 件見つかった罠
  (調布 meta の確率的信頼度 1 行、入間 taxonomy の groups、所沢の `source.edition_ja`)

cache が要るので CI では回せない。**PR を出す前のローカルゲート**と位置づけ、
`CONTRIBUTING.md` に必須と明記する。

## schema 変更

### `source.provenance` (新規・必須)

```
official   自治体自身が公開した機械可読データをそのまま収録した
extracted  第三者が一次ソースから機械抽出した
manual     人が一次ソースを読んで手で書いた
```

目的は「**自治体が最初から yaml を出してくれる**」という理想への到達を
数えられるようにすること。`official` の件数がこのプロジェクトの到達度になる。
既存 895 コースは `extracted` を一括投入する。

### `source.confidence` (削除)

0〜1 の数値。上富良野だけが使っており実質死んでいる。
確からしさは `meta.yaml` notes の「確率的信頼度」で言語化する運用が定着しており、
二重管理になっている。

### `meta.yaml` の `summary` (新規・必須)

1 行。`docs/coverage.md` の生成に使う。貢献者は notes を書くついでに 1 行書く。

## README の収録リストを生成物にする

現状、貢献のたびに人が README の 49 行のリストを手で直す。
これは 2026-08-10 に見つけた「生成物への手編集」と同じ腐り方をする構造で、
実際この日も 3 市分を手で追記した。

- `meta.yaml` の `summary` から `scripts/build-coverage.mjs` が `docs/coverage.md` を生成
- README は「収録自治体は `docs/coverage.md`」の 1 行にする
- **`make test` が coverage.md の陳腐化を検出する** (生成し直して差分が出たら失敗)

CI が bot コミットする方式 (`next-edition-status.md` の前例) ではなく陳腐化検査にする。
コミット権限を CI に与えず、貢献者の手元で完結するため。

## 実装の分割

2 段に分ける。段ごとに `make test` と `make regen` が通ることを確認してから次へ進む。

**第 1 段: 入口と足場** (schema を触らない)
`AGENTS.md` / `CLAUDE.md` / `CONTRIBUTING.md` / skill / `Makefile` /
`scripts/new-municipality.mjs` / `scripts/check-regen.mjs` / 草案の移動 / playbook §5 の整理。
既存データに一切触らないので、失敗しても巻き戻しやすい。

**第 2 段: schema と生成物**
`provenance` / `confidence` / `summary` / `docs/coverage.md` / README の縮小。
既存 895 コースと 33 自治体に手が入るため、順序を守る:

1. 全 course に `provenance: extracted` を、全 meta に `summary` を投入する
   (生成器側を先に直し、`make regen` で反映する — 手で YAML を書き換えない)
2. 反映を確認してから schema を「必須」に変える
3. `check-tools` に欠落検出を足す
4. `confidence` を削除する (上富良野の生成器から外し、`make regen` で反映)

逆順にすると、必須化した瞬間に全自治体が `make test` で落ちて作業が進まなくなる。

## 受け入れ基準

1. `CLAUDE.md` / `AGENTS.md` / `CONTRIBUTING.md` / skill / `Makefile` が存在し、
   `make help` がターゲット一覧を出す
2. `make new HANDLE=... PREF=... KIND=...` が足場を作り、その直後に `make test` が通る
3. `make regen HANDLE=<既存>` が全収録済み自治体で差分ゼロを返す
   (cache がある自治体に限る。無ければスキップし、その旨を出力する)
4. `make coverage` が `docs/coverage.md` を生成し、`make test` が陳腐化を検出する
5. 全 895 コースに `provenance` が入り、`confidence` が消え、`check-tools` が欠落を検出する
6. 既存の verify 9 本と `npm test` が通り、**生成データに差分が無い**

## 非目標

- Windows での動作確認 (Makefile と shell 前提のため)
- CI での build/verify 実行 (cache と一次ソース取得が要るため。ローカルゲートに留める)
- submodule / 分散リポジトリ運用
- 語彙 (`schema/categories.yaml`) の自動追加 — 上流の判断として残す
- 探索フェーズの完全自動化 — 承認ゲートを置く前提を崩さない

## 残るリスク

- **skill は Claude Code 固有**である。Codex は `.claude/skills/` を自動探索しないため、
  `AGENTS.md` から場所を明示して「収録するならこの手順書を読め」と誘導する。
  中身は素の markdown なのでツールを問わず読める。
- **`make regen` は cache に依存する**。この日の所沢のように cache が古いと
  「不一致」と出るが、それはリポジトリの欠陥ではない。
  差分が出たら「まず cache を作り直す」を `CONTRIBUTING.md` に明記する。
- **provenance の追加は全生成器に追従を要求する**。この日 `edition_ja` が所沢の
  source 整形で落ちていたのと同じ事故が起きうるため、`check-tools` の検出と
  `make regen` の全自治体実行を受け入れ基準に含めてある。
