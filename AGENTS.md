# AGENTS.md

日本の自治体のごみ収集カレンダーを機械可読なオープンデータ (CC BY 4.0) として集約するリポジトリ。

- 人間向けの入口: `CONTRIBUTING.md`
- **用語の定義: `docs/glossary.md`** (course と地区、照合と自己検証と regen、文書の呼び方)
- 収録の手順と判断基準: `docs/playbook.md`
- 進行管理 (Claude Code): `.claude/skills/add-municipality/SKILL.md`
- 検証の考え方: `docs/opendata-sources.md`「検証の考え方 (確率論的な信頼度)」

## データの単位

```
municipalities/<都道府県romaji>/<handle>/
  survey.yaml            収集日データの公開状況サーベイ (収録前の調査記録。収録後も残す)
  meta.yaml              自治体メタ + 更新に必要な情報源 + 運用ルール + 検証記録
  taxonomy.yaml          その自治体の種別語彙 (schema/categories.yaml の部分集合)
  facts.yaml             任意。利用者向けの読み物断片 (出典必須)
  bunbetsu-jiten.yaml    任意。品目辞典 (品目名 → 出し方)。日程とは別の資料
  <収録期間>/course-*.yaml  日程本体
```

- **`bunbetsu-jiten.yaml` を収録期間ディレクトリに置かない。** `emit.mjs` の
  `writeCourses()` が `<outDir>/<期間>/` を `rmSync` してから書き出すので、build のたびに
  消える。辞典は資料の版 (「令和8年4月修正」) で変わるもので、日程の収録期間とは無関係。
- 辞典の `category` は **2 つの正典**のどちらかに属する。`schema/categories.yaml` (収集種別)
  か `schema/disposal.yaml` (処分可否 = 収集しない / 持ち込みのみ / 別ページ参照)。
  **混ぜない** — 処分可否を `categories.yaml` に足すと、日程を読む全利用者に
  「どのコースも決して収集しない種別」が見える。
- **辞典はリポジトリの CC BY 4.0 に自動では乗らない。** 日程は事実なので著作権が及ばないが、
  辞典は品目の選択・配列と note の文言が自治体の著作物になりうる。許諾が確認できない自治体の
  辞典には `source.license` と `license_note` を必ず書く (飯能が実例)。

- **handle** は自分で綴りを考えず、必ずレジストリで引く (`tools/_lib/registry.mjs`)。
- **収録期間** は `YYYY-MM--YYYY-MM`。**一次ソースが実際に裏付ける範囲**であって会計年度ではない。
  4月起点・10月起点・暦年・半期がいずれも同じ形で表せる。**この範囲の外は展開しない。**
- **course** = 同一日程のまとまり。**area** = 1 町名 (丁目単位)。

## コマンド

```
make help                 ターゲット一覧
make test                 全ゲート (schema + extractor 静的検査 + ESLint + 単体テスト)
make new HANDLE=.. PREF=.. KIND=..  新自治体の足場
make regen HANDLE=..      再生成して差分ゼロを確認 (PR 前に必須)
make verify HANDLE=..     その自治体の verify を実行
make ics                  .ics と stats を生成
```

## 不変条件

守らないと壊れるもの。

- **推測でデータを作らない。** ソースが機械可読でない・地区割に確信が持てないなら、
  作らずに `survey.yaml` だけ残して終わる。それは失敗ではなく正しい完走。
- **未対応の表記は throw する。** 黙って読み飛ばさない。
- **`Date.now()` を使わない。** 日付は環境変数 (`EXTRACTED_AT`) で渡す。出力を決定的に保つため。
- **生成ファイルを手で編集しない。** その extractor が実際に出力しているファイルは
  build が作るので、直したいときは生成器を直して `make regen` する。
  `course-*.yaml` は全 extractor が生成するが、`meta.yaml` / `taxonomy.yaml` は
  生成しない extractor もある (`tools/_template/build.mjs` を含む) — その場合はそのファイルが
  手書きの正典であり、`make regen` の比較対象にも入らない。迷ったら生成器 (`build.mjs`) を読んで
  そのファイルを書いているか確認する。
  (2026-08-10 に手編集が 3 件見つかり、再生成で消えるところだった)
- **`git add -A` を使わない。** 同一作業ツリーを別セッションが使うことがある。
  コミットは必ずファイルを指定する。
- **語彙を勝手に増やさない。** `schema/categories.yaml` に無い品目が出たら、
  同日収集の別品目に寄せるか除外し、**上流に相談する**。判断を貢献者側で完結させない。
- **ソースを「修正」しない。** 一次ソースの誤記は直さず、事実として `meta.yaml` に記録する。

## 触ってよい場所

1 自治体を収録するとき、書き込みは次に閉じる。

```
tools/<形式>-extractor/<handle>/
municipalities/<都道府県>/<handle>/
```

`schema/` `docs/` `tools/_lib/` `.github/` と他自治体は上流の担当範囲。
変更が要るなら提案に留める。

## 共通部品

再実装しない。`tools/_lib/` にある。

| 部品 | 提供 |
|---|---|
| `schedule.mjs` | 収集日展開の正典 (`categoriesOn` / `expandRange` / `periodDates` / `cancelledOverrides`) |
| `classify.mjs` | 実日付 → weekly / monthly_specific の自動分類 |
| `emit.mjs` | コース畳み込みと course YAML 出力 (フィールド順を統一) |
| `abr.mjs` | ABR 町字マスター取得 (yomi / machiaza_id) |
| `jp.mjs` | 曜日・第n回目の日本語パース、町名正規化 |
| `verify.mjs` | 期間 diff、rule of three、層化サンプリング |
| `fetch.mjs` | キャッシュつき取得 |
| `registry.mjs` | 全国自治体レジストリの参照 |

`build-ics` と各 verify が `schedule.mjs` を共有することで
「照合と配信で同じ解釈」を保証している。ここを自前で書き直さない。
