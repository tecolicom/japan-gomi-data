# 朝霞市 (埼玉県) ごみ収集日 抽出

- **handle**: `asaka` / **code**: 11227 / **収録**: 6 コース・38 地区
- **一次ソース**: 朝霞市公式「家庭ごみ収集日一覧表」<https://www.city.asaka.lg.jp/soshiki/15/dust-syuusyuu.html>
  (HTML 表。区域と 資源 / プラスチック資源=燃やせないごみ / 燃やすごみ の 3 曜日列)
- **照合・読み補完**: 市民団体 Publitech ASAKA の 5374 版 `area_days.csv`
  (<https://github.com/publitechasaka/5374>、36 行、地区×4 分別、読み併記あり)

## 実行手順

```
node fetch.mjs        # 公式HTML + 5374 CSV を cache/ へ
node fetch-yomi.mjs   # ABR 町字マスター埼玉県版(pref11) の朝霞市分を cache/abr-town.json へ
EXTRACTED_AT=YYYY-MM-DD node build.mjs   # municipalities/saitama/asaka/2026/ を生成
node verify.mjs       # 公式HTML と 5374 CSV の全地区照合
```

## 収集体系

全域が朝霞市クリーンセンター単一・全品目 weekly。正典カテゴリへの対応:

- 燃やすごみ (週2) = `burnable`
- プラスチック資源 (週1・容器包装プラのみ。製品プラは燃やすごみ) = `plastic`
- 燃やせないごみと有害ごみ (週1・プラと同曜日) = `non_burnable` + `hazardous`
- 資源 (週1・同日一括) = `glass_bottle` + `beverage_can` + `pet_bottle` + `paper` + `cloth`
  (びん・缶・ペットボトル・古紙・古布)

## なぜ HTML が一次で CSV は補助か

5374 `area_days.csv` は機械可読で読みも付くが、**大字溝沼の東上線北側区分と自衛隊(朝霞駐屯地)を欠く**
(CSV 36 地区 / HTML 38 地区)。日程の欠落を避けるため公式 HTML を一次とし、CSV は読み補完と照合に使う。

## area 分解規約 (build.mjs `parseArea`)

- 先頭「大字」接頭辞と別名併記「岡・大字岡」の後半を base から除く
- 丁目 (N丁目 / N～M丁目) は元表記を name に保持し、machiaza_id 照合用に展開
- 番地・河川/道路/鉄道境界条件 (「7番の一部(黒目川左岸)」「東上線北側」「東武東上線南側」) と
  「◯◯の一部」は note へ。全角数字は半角へ正規化
- 割れ area (同名が境界で別コース: 溝沼・膝折町2丁目・浜崎) は note の判別子を name に昇格

## yomi・machiaza_id

- **yomi**: 5374 CSV の読み併記由来 37/38 (丁目細分や CSV に無い地区は同一大字の読みで補完。
  自衛隊のみ ABR・CSV とも読みが無く未付与)
- **machiaza_id**: ABR 町字マスター埼玉県版 (lg 11227) 由来 25/38。ABR が住居表示ベースのため
  大字行を持たない農村部大字 (上内間木・下内間木・宮戸・台・根岸)・大字割れ (大字浜崎/溝沼)・
  自衛隊は付与なし (推測しない)

## 境界表記について

同じ区域を公式 HTML は「黒目川右岸/左岸」「東武東上線 北側/南側」、5374 CSV は「黒目川の東/西」で
表す。指す区域と日程が一致することを確認済みで、name には一次ソース(HTML)の表現を採用した。

## 検証

`verify.mjs` が公式 HTML と 5374 CSV の 4 分別×曜日を全地区照合する。CSV と共通の地区は完全一致。
CSV が欠く 2 区分(大字溝沼 東上線北側・自衛隊)は HTML を採用。日付入り年間カレンダーは市非公開のため
日付レベルの独立照合は不可。
