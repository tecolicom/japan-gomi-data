# 新自治体 extractor テンプレート

新しい自治体を収録するときは、このディレクトリを `tools/<形式>-extractor/<handle>/` にコピーして埋める。
手順の全体は [`docs/playbook.md`](../../docs/playbook.md)、共通部品は [`tools/_lib/`](../_lib/) を参照。

```
fetch.mjs        一次ソース取得 (cachedFetch。cache/ は .gitignore 済み)
parse.mjs        ソース → 行 (町×種別×曜日)。表記パースは _lib/jp.mjs を使う
parse.test.mjs   実データの断片を使った回帰テスト (node --test)
build.mjs        行 → course YAML (foldCourses / courseDoc / writeCourses / cancelledOverrides)
verify.mjs       独立ソースとの照合 (expandFiscalYear / diffYear / ruleOfThreePct)
```

- `EXTRACTED_AT` は環境変数で渡す (`Date.now()` は使わない — 再現性のため)。
- パースに失敗する表記は黙って読み飛ばさず throw する (握りつぶし禁止)。
- 照合結果 (件数・不一致・確率的信頼度) は `municipalities/<県>/<handle>/meta.yaml` の notes に記録。
