# 貢献の仕方

日本の自治体のごみ収集カレンダーを機械可読なオープンデータにするプロジェクトです。
**自分の町のデータを手元で使うだけでも歓迎**します。PR は出しても出さなくて構いません。

## まず動かす

```bash
make setup    # 依存を入れる
make test     # 全ゲートが通ることを確認
make ics      # .ics を生成する (ics/<handle>/<course>.ics)
```

## 自分の町を追加する

貢献の経路は 3 つあります。どれで作っても通るゲートは同じです。

### 1. エージェントに作らせる

Claude Code なら `/add-municipality`、その他のエージェントなら
`.claude/skills/add-municipality/SKILL.md` を読ませてください
(素の markdown なのでツールを問いません)。

**探索が終わった時点で一度止まり、「何を一次ソースにし、何で独立照合するか」を
提案してきます。そこだけ人が承認してください。** 以降は自動で進みます。

### 2. 手で書く

```bash
make new HANDLE=<handle> PREF=<都道府県romaji> KIND=<html|pdf|csv|txt|api>
```

足場ができます。`docs/playbook.md` が手順と判断基準です。
手本にする既存の自治体は `tools/*-extractor/` から近い形式のものを選んでください。

### 3. 自治体自身が公開する

**これが理想形です。** 自治体が `schema/schedule.schema.json` に沿った YAML を
公開してくれれば、抽出は要りません。形式についての相談は Issue でどうぞ。

## 通すべきゲート

```bash
make test                    # schema + extractor 静的検査 + ESLint + 単体テスト
make regen HANDLE=<handle>   # 再生成して差分ゼロ (PR を出すなら必須)
make verify HANDLE=<handle>  # 独立照合 (verify.mjs がある場合)
```

`make regen` は cache と一次ソースが要るので CI では回りません。**手元で必ず通してください。**
差分が出たら、まず cache を作り直してください。それでも出るなら、
生成ファイルを手で編集したか、一次ソースが更新されています。

## 守ってほしいこと

- **推測でデータを作らない。** ソースが機械可読でない・地区割に確信が持てないなら、
  作らずに `survey.yaml` だけ残してください。それでも台帳が 1 件増えます
- **生成ファイルを手で編集しない。** 生成器を直して `make regen` してください。
  どのファイルが生成物かは `AGENTS.md`「不変条件」が正典です —
  `meta.yaml` / `taxonomy.yaml` は extractor によっては生成せず、その場合は手書きが正典になります
- **語彙 (`schema/categories.yaml`) を勝手に増やさない。** 足りないと思ったら Issue で相談を
- **一次ソースの誤記を「修正」しない。** 事実として `meta.yaml` に記録してください

## PR を出す

1 自治体 1 PR にしてください。変更は次に閉じているはずです。

```
municipalities/<都道府県>/<handle>/
tools/<形式>-extractor/<handle>/
```

`schema/` や `tools/_lib/` に手を入れる必要が出たら、先に Issue で相談してください。

## ライセンス

データは CC BY 4.0 です。一次ソースのライセンスは `meta.yaml` と `survey.yaml` に記録します。
自治体サイトにライセンス表示が無い場合は「収集日という事実データの抽出」として扱っています
(`docs/opendata-sources.md` 参照)。
