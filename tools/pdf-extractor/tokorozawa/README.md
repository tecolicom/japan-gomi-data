# 所沢市 ごみ収集カレンダー 抽出パイプライン

埼玉県所沢市 (handle: `tokorozawa`, code 11208) の地区別収集カレンダー PDF 群から
course YAML を生成する。一次ソースは市公式サイトの町別 PDF (日付入り通年カレンダー・テキスト層あり)。

## ソース

- 入口: https://www.city.tokorozawa.saitama.jp/kurashi/gomi/nittei/index.html
- 頭文字別 8 ページ (あ行/か・き/く・け・こ/さ行/た・な行/は行/ま行/や・わ行) に町別 PDF が並ぶ。
- `manifest.json` = 上記 HTML から抽出した町別 PDF 一覧 (file / url / letter / label)。全 86 枚。
- 各 PDF は Excel LTSC 製・A4横 2 ページ。1 ページ 6 ヶ月 (3 列×2 行)、2 ページで会計年度 12 ヶ月
  (2026-04〜2027-03)。収集日にだけ品目ラベルが印字される。テキスト層は健全 (隠し OCR・CID 化けなし)。
- `yomi.yaml` = 町名→読み(ひらがな)。日本郵便「郵便番号一覧(所沢市)」のカナ由来 (独立 yomi ソース)。

## パイプライン

```sh
node fetch.mjs                    # manifest の 86 PDF を cache/pdf/ へ (cachedFetch・逐次)
python3 extract.py                # 全 PDF → cache/extracted.json ({file:{isodate:[cats]}})
python3 cross_poppler.py          # 独立エンジン(poppler)で再抽出し extracted.json と全日突合
EXTRACTED_AT=2026-07-19 node build.mjs   # rules 推定 + コース畳み込み + course YAML 出力
node verify.mjs                   # categoriesOn 通年再展開で全 town-instance を全日照合
```

- `extract.py` (pdfplumber/pdfminer): 月ブロックを「N月」ヘッダで切り、曜日ヘッダ+日付グリッドを
  座標クラスタで復元、品目ラベル文字を「同列で直上の日付セル」に割付。ラベルは月末セルで 1 文字ずつに
  分解されるため識別文字単位で判定 (杉並と同じ癖)。
- `build.mjs`: 町ごとに weekly / monthly_nth / monthly_specific を機械推定。1 月は元日休みで品目サイクルが
  1 週ずれる曜日があり、規則に一致しない品目は実日付 (monthly_specific) に落ちる。年末年始休止 (町により
  12/29 or 12/30〜1/3) は cancelled override。同一日程の町を 1 コースに畳む (署名一致)。
- 品目→カテゴリ: 燃やせるごみ=burnable / 容プラ=plastic / ペットボトル=pet_bottle /
  破砕・有害(同日)=non_burnable+hazardous / びん・缶・スプレー(同日)=glass_bottle+beverage_can /
  新・雑・段=paper / 小型家電・古着古布(同日)=metal+paper_cloth。

## 検証 (2026-07-19)

- 自己照合: 87 town-instance × 365 日で抽出カレンダーと全日一致 (差分ゼロ)。
- 独立エンジン照合: 全 86 PDF を poppler(pdftotext) と pdfminer(pdfplumber) の 2 エンジンで抽出し全日一致。
- 視覚照合: 層化サンプル (荒幡・三ケ島・青葉台の全ページ、年末年始と 1 月変則を含む) を PDF 実描画と目視突合。
- コース畳み込みは PDF 自身の地区見出し (例「北野、北野新町、小手指町五丁目、小手指元町地区」) と一致。

## 出力

`municipalities/saitama/tokorozawa/2026/course-*.yaml` (38 コース・87 area)。
`cache/` は再生成可能なため非追跡 (.gitignore)。
