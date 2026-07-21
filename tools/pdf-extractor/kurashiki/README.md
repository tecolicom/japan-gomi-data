# 倉敷市 (kurashiki) ごみ収集日 抽出パイプライン

岡山県倉敷市 (code 33202)。市公式「各地区収集日一覧」配下の**地区別PDF 6枚**を一次ソースに、
83コースの course YAML を生成する。収集は6つの環境センター管区(倉敷/水島/玉島/児島/船穂/真備)に分かれ、
真備地区のみ分別が細分化されている(西日本豪雨後の再編)。

## 形式

- 一次ソース: 罫線グリッドのPDF表(テキスト層健全)。縦マージセルは pdfplumber の cell 幾何で検出し上方向フィル。
- 粒度: 曜日 + 第n回目(その月 n 回目の該当曜日)。日付入り通年カレンダーは市が非公開のため日付レベル照合は不可。
- 収録単位: 学区→地区(町内会)。境界条件つきフリーテキストで、日本郵便の町名より細かい。
  権威ある読み(yomi)ソースが該当しないため構造化 areas は付けず、地区名は course_name_ja に原文保持。

## 実行

```sh
node fetch.mjs                 # 6 PDF + 検証用 data eye CSV を cache/ へ取得
python3 extract.py             # cache/records.json (地区ゾーンごとの weekly/第n)
EXTRACTED_AT=YYYY-MM-DD node build.mjs   # course YAML を municipalities/okayama/kurashiki/2026/ へ
node verify.mjs                # 自己照合(categoriesOn 通年再展開 == 抽出)
python3 verify_csv.py          # 独立照合(data eye 平成31年度CSVと曜日/第n)
python3 cross_engine.py        # エンジン非依存(pdfplumber vs pdftotext, 真備・船穂)
```

依存: Python `pdfplumber`、`pdftotext`(poppler)。

## 検証 (2026-07-21)

- **自己照合**: 83コースを FY2026 通年再展開しパターン完全再現(不一致ゼロ)。
- **独立ソース照合**: data eye「平成31年度 地区別収集日」CSV(別年度・別グルーピング)と distinct スケジュール
  パターン集合で 水島16/16・玉島(船穂含む)20/20・児島16/16 が完全一致、倉敷22/24。
  倉敷の残差2件は現行PDFが正(中島(※)学区の2019→現行の資源曜日変更 ほか。詳細は meta.yaml)。
- **エンジン非依存**: CSV非対象の真備・船穂を pdftotext -layout で再抽出し pdfplumber と完全一致(真備6/6・船穂4/4)。

## 注意

- `tamashimafunao.pdf` は玉島+船穂を同梱。build/extract では玉島を同PDFから、船穂は `funao.pdf` から取り(重複回避)。
- `cross_engine.py` の値トークン判定は地名に含まれる曜日漢字(「柳井原・水江」の水 等)を除外するため、
  数字・曜日・区切りのみのトークンに限定している。
- 年末年始・祝日運用は一次ソースに実日付の明示が無い(真備は12月広報告知型)。override は作らない。
- キャッシュ(`cache/`)は成果物ではないので `.gitignore` 追加を推奨(統括者へ報告)。
