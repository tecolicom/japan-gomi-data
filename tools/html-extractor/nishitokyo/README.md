# 西東京市 ごみ収集カレンダー抽出 (html-extractor/nishitokyo)

西東京市「ごみ・資源物収集カレンダー(テキスト版)」の**地域別 HTML ページ**(日付入り通年カレンダー)から
`municipalities/tokyo/nishitokyo/` の course/meta/taxonomy を生成するパイプライン。

## 一次ソース

- 案内ページ (index): `https://www.city.nishitokyo.lg.jp/kurasi/gomi_recycle/gomi-calebder/gomicalender_exel/index.html`
- 地域別ページ: `.../gomicalender_exel/{N}{N}{N}.html` (N=1..8 → `111.html` 〜 `888.html`)
- **収録期間 2025年10月〜2026年9月**。西東京市のカレンダーは会計年度ではなく **10月起点の1年**で、
  これが一次ソースの裏付ける範囲そのもの。次版 (令和8年10月〜令和9年9月・例年9月中旬公開) が出たら
  `2026-10--2027-09/` として別途収録する (週次ルールで期間外へ延長はしない)。
- 検証用の冊子版カレンダー PDF: `https://www.city.nishitokyo.lg.jp/kurasi/gomi_recycle/gomi-calebder/999.html`
  → `999.files/-{1..8}-070911.pdf` (地域別) / `-9-070911kyoutuu.pdf` (共通)

### ライセンス

ライセンス明示なしの通常ページ。市のオープンデータに収集日程データセットは無いため、
**収集日という事実データを抽出**して収録する (練馬・杉並・調布と同じ整理)。

### 地域8 の title 元号誤記

`888.html` のページ title だけが「令和6年10月から令和7年9月まで」となっているが、
本文の月見出しは他地域と同じ 2025年10月〜2026年9月で、冊子版 PDF も 2025年10月始まり。
**ソースは修正せず**、事実として meta.yaml の notes に記録している。

## パイプライン

```
node fetch.mjs                        # 地域別HTML 8本 + index を cache/ へ
node fetch-yomi.mjs                   # ABR 町字マスター(pref13)から西東京市114町字を cache/abr-town.json へ
EXTRACTED_AT=YYYY-MM-DD node build.mjs # cache → course-{1..8}.yaml + meta.yaml + taxonomy.yaml (自己照合つき)
node verify.mjs                       # 生成YAMLの再展開照合 + 冊子版PDFサンプル照合
```

## HTML の構造 (parse.mjs)

```html
<h2 id="cms...">2025年10月</h2>
<table class="table01">
  <tr><th>日曜</th>…<th>土曜</th></tr>   <!-- 必ず7セル -->
  <tr><td> </td>…<td>1</td>…</tr>        <!-- 日番号行 -->
  <tr><td>休み</td><td>金属類<br>小型家電<br>廃食用油</td>…</tr>  <!-- 内容行 -->
  …                                       <!-- 以降 交互 -->
</table>
```

- 月ブロックは `<h2>YYYY年M月</h2>` + 直後の table で 12 ヶ月分。
- 日番号行と内容行が交互、どの行も 7 セル。セル内の複数品目は `<br>` 区切り。
- 空セル (`&nbsp;`) は月外。`休み` は土日、`収集なし` は平日の休止日。
- パーサは曜日ヘッダと実曜日の一致・各月の日数・未知品目を assert する (握りつぶさない)。

## 抽出ロジック (build.mjs)

品目ごとに収集日を集計して自動分類する:

- **weekly (+ cancelled override)** — 可燃ごみ (週2)、ペットボトル+プラスチック容器包装類 (週1)。
  年末年始の停止日だけが例外なので `overrides` の cancelled で落とす。
- **monthly_specific** — 隔週・4週周期のため weekly / monthly_nth では表せない品目:
  - びん・スプレー缶・ライター + 古紙・古布類 と 缶 は**同じ曜日で隔週交替**
  - 水曜は **4週周期**「不燃ごみ・有害ごみ → 金属類 → 不燃ごみ・有害ごみ → 収集なし」

分類後 `expandRange()` で収録期間 (365日) を再展開し、カレンダー実日付と**完全一致**することを
build 内で自己検証する (不一致なら書き出さない)。

## 種別マッピング

| カレンダー表記 | category | 備考 |
|---|---|---|
| 可燃ごみ | burnable | 週2 |
| せん定枝・落ち葉・草・おむつ | burnable | 可燃と常に同日。独立ルールは作らない |
| 不燃ごみ | non_burnable | 有害と同日 |
| 有害ごみ・危険物 | hazardous | 不燃と同日 |
| プラスチック容器包装類 | plastic | ペットボトルと同日 |
| ペットボトル | pet_bottle | |
| びん・スプレー缶・ライター | glass_bottle + spray_can | 1セル1品目。ライターは spray_can に同梱 (語彙なし) |
| 古紙・古布類（衣類等） | paper_cloth | びん類と同日 |
| 缶 | beverage_can | びん類と同じ曜日で隔週交替 |
| 金属類 | metal | |
| 小型家電 | metal | 金属類と常に同一セル・同日 (所沢・東秩父の先例) |
| 廃食用油 | — | 正典語彙に無く、金属類と常に同日のため未収録 (鯖江の先例) |

語彙外品目はいずれも他品目と同日収集なので、**日程情報の欠落はゼロ**。原文は taxonomy.yaml の
コメント・`groups` と meta.yaml の notes に残している。

## areas

22町114丁目。**1 area = 1 丁目**に展開する (playbook の規約)。

- 地域→町名の対応は各ページの `<title>` (例「1　田無町、西原町、芝久保町5丁目（…）」) を一次とし、
  丁目の実在・読み・町字IDはデジタル庁 ABR 町字マスター東京都版 (`lg_code=132292`) から引く。
- 丁目で割れるのは **芝久保町** (5丁目 / 1〜4丁目) と **谷戸町** (1・2丁目 / 3丁目) のみ。
- build は 8 地域の割当が ABR の全 114 町字を**重複・欠落なく分割する**ことを検査する。

## 照合 (verify.mjs)

1. 生成済み course YAML を読み直し `expandRange` で再展開 → cache の HTML と全 2920 日枠を比較。
2. 冊子版カレンダー PDF との独立照合。この PDF は Illustrator でアウトライン化されており
   **テキスト層が無い** (`pdffonts` が空) ため機械抽出できない。playbook §3 に従い層化サンプリングで
   画像から読み取った 4 ヶ月 (地域1の2025年10月・2025年12月、地域3の2026年1月、地域8の2025年10月 = 91日枠)
   を `PDF_SAMPLES` に転記して比較する。年末年始を含む端の月を優先的に選んでいる。
