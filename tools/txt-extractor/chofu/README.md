# 調布市 ごみ収集カレンダー抽出 (txt-extractor/chofu)

調布市「令和8年度版ごみリサイクルカレンダー」の**地区別テキスト版**(日付入り通年カレンダー)から
`municipalities/tokyo/chofu/` の course/meta/taxonomy を生成するパイプライン。

## 一次ソース

- 市公式「ごみリサイクルカレンダー」ページ: https://www.city.chofu.lg.jp/070030/p041249.html
- 地区別テキスト(日付入り通年カレンダー): `.../documents/16365/r8calendar_no{1..4}.txt`
  - 第1地区: 仙川町・入間町・若葉町・緑ケ丘・国領町
  - 第2地区: 西つつじケ丘・菊野台・飛田給・上石原・東つつじケ丘・富士見町・野水・西町
  - 第3地区: 深大寺東町・深大寺元町・布田・深大寺北町・深大寺南町・染地
  - 第4地区: 調布ケ丘・柴崎・多摩川・下石原・八雲台・佐須町・小島町
- 共通(分別ルール・年末年始等): `.../documents/16365/r8calendar_p2_p3_p10~p28.txt` → cache では `r8calendar_common.txt`

各テキストは「日付・曜日・品目」の行が並ぶ**日付入りカレンダーそのもの**(祝日・お盆も含め全収集日が明示)。
PDF ではなく機械可読テキストのため、中野方式(PDFカレンダーとの照合)より直接的に通年照合できる。

### ライセンス

カレンダー掲載ページは通常ページ(`Copyright (c) Chofu. All rights reserved.`)。
市のオープンデータ(CC BY 4.0)には収集日程データセットが無いため、
**収集日という事実データを抽出**して収録する(練馬・杉並と同じ整理)。

## パイプライン

```
node fetch.mjs    # 4地区txt + 共通txt を cache/ に取得
node build.mjs    # cache → course-{1..4}.yaml + meta.yaml + taxonomy.yaml、通年自己照合
node verify.mjs   # 生成YAMLを別経路で再展開し cache のカレンダーと全日比較
```

- `parse.mjs` — テキストカレンダー → `Map<isoDate, category[]>`。品目→正典categoryの対応表を持つ。
- `areas.json` — 地区→町名(+読み)。読みは日本郵便の郵便番号カナ(zipcloud経由)由来、26町=全町域。

## 抽出ロジック(build.mjs)

品目ごとに収集日を集計し、次に自動分類する:

- **weekly** — 通年その曜日を欠かさない品目(可燃・ビン・カン等の規則的品目)。
- **weekly + cancelled override** — 年末年始の全停止(12/31・1/1)だけが例外の品目。
- **monthly_specific** — 季節変動や年末年始の品目単位の移動で不規則になる品目。
  - ペットボトル / 燃やせないごみ / 有害ごみ は 7〜9月に頻度が変わる(4週2回⇔3回/1回)ため常に monthly_specific。
  - 年末年始(12/29〜30)にプラを前倒し・カン休止等の移動がある品目も monthly_specific。

分類後、`categoriesOn()`(build-ics と等価)で通年(365日)再展開し、
カレンダー実日付と**完全一致**することを build 内で自己検証する(不一致なら書き出さない)。

## 種別マッピング

| カレンダー表記 | category | 備考 |
|---|---|---|
| 燃やせるごみ | burnable | 週2 |
| 燃やせないごみ | non_burnable | 有害と同日 |
| 有害 | hazardous | 燃やせないごみと同日 |
| 容器包装プラスチック | plastic | |
| 古紙・古布 | paper_cloth | 別日・週1 |
| シュレッダー紙 | paper | ビンと同日・週1(シュレッダーにかけた古紙) |
| ビン | glass_bottle | |
| カン | beverage_can | |
| ペットボトル | pet_bottle | 7〜9月に頻度増 |

シュレッダー紙(`paper`)と古紙・古布(`paper_cloth`)は収集日が別のため区分を分けている。
