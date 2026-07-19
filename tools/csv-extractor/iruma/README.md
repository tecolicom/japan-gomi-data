# 入間市 (埼玉県) ごみ収集日程 抽出

一次ソース: **埼玉県オープンデータポータル「入間市ごみ収集日程」CSV**
(resource 1494 / dataset 274、ライセンス PDL-1.0)。
日付入りの通年収集カレンダー(縦持ち、2026-04-01〜2027-03-31)。

## パイプライン

```
node tools/csv-extractor/iruma/fetch.mjs     # cache/iruma.csv (県OD) + verify/R8wakedasihyou.pdf (市 分け出し表) を取得
node tools/csv-extractor/iruma/build.mjs     # → municipalities/saitama/iruma/ に course/meta/taxonomy を生成
node tools/csv-extractor/iruma/verify.mjs    # 自己照合 + 分け出し表PDFとの独立照合 (要 pdftotext)
```

`EXTRACTED_AT` を env で渡すと `source.extracted_at` を固定できる (既定 2026-07-19、`Date.now()` 不使用)。

## データの特徴と罠

- **文字コードは Shift_JIS** (survey の「UTF-8」は誤り)。build/verify は `TextDecoder('shift_jis')` で読む。
- **ヘッダの列名順と実データの列順が食い違う**: ヘッダは「…年月日, 収集分別区分」だが実データは
  「…収集分別区分, 年月日」。列名でなく**位置**で解釈する。
- 末尾に空行 (`,,,,,`) が多数付く → 全フィールド空の行は捨てる。
- 収集地域は「扇台3～6丁目、久保稲荷3～5丁目、…、大字扇町屋1217・1219番地」等のフリーテキスト。
  括弧 `（）` 内の `、` では区切らず、番地継続 (数字始まりフラグメント) は直前町名へ結合して分割する。

## 規則化

日付入りカレンダーから通年の実日付を読み、`weekly` / `monthly_nth` を推定して規則+overrides に畳む。
- 可燃ごみ(毎週3日) / プラスチックごみ(毎週) / 不燃ごみ(毎週) → `weekly`
- ビン・缶・ペットボトル・有害ごみ(隔週・4品目同日) / 古布・紙類(隔週)
  → `monthly_nth` (その月 第n回目の該当曜日、occurrences=[1,3] または [2,4])
- 全12地域 × 全品目が weekly/monthly_nth で成立 (`monthly_specific` への退避なし)。

年末年始 (地域により 12/29〜1/2 の該当日) は CSV では休止=データ欠落。全品目収集なしの日を
`cancelled` override で明示する。`build.mjs` は rules+overrides を `categoriesOn` で通年再展開し、
CSV の実日付と完全一致することを書き出し前に自己検証する (不一致なら throw)。

## 検証

- **自己照合**: 生成 course YAML を再展開し CSV 実日付と全12地域で照合 → 相違ゼロ。
- **独立照合**: 市「令和8年度 分け出し表」PDF (県ODとは別発行の市リーフレット) の地区別収集日程表を
  `pdftotext -layout` で抽出し、全12地区で
  可燃/不燃/プラの収集曜日 + 隔週2品目の第n回目**実日番号**を照合 → 全一致。
  隔週品目は PDF が実日付を載せるため**日付レベル**の独立照合になる。

読み (yomi.yaml): ベース町名47件は日本郵便の郵便番号カナ由来。向原団地のみ郵便町名でなく
通例読み「むかいはらだんち」(要確認)。
