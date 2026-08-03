# chichibu-koiki — 秩父広域 色ベース抽出

秩父広域市町村圏組合(秩父市・横瀬・皆野・長瀞・小鹿野)の雑誌型ごみカレンダー PDF は
テキスト/座標抽出が不可(InDesign、pdfplumber `extract_words` 空)。品目がセル背景色で
塗り分けられていることを使い、**文字も日付も読まず**セルの色だけで品目を判定する。

## 仕組み

- グリッド幾何は全 PDF 共通の InDesign テンプレートなので、各月グリッド四隅の空セル座標を
  `extract.py` の `TEMPLATE`(PDF pt)に**埋め込み済み**。個々の PDF に矩形を置く必要はない。
- 暦計算で各日の(週,曜日)→セル中心を決め、セル領域の色ピクセルを数えて品目を判定
  (可燃=緑/不燃=黄/紙布=紫/カンビン=水色/ペット=茶、ピンクの施設持込は除外)。
- 6週月は最終物理行を上下半分に割る(第5週上/第6週下)。塊クラスタリングは使わない
  (週行ずれ=旧実装の12月バグを排除)。

## 地区を追加する手順

1. 秩父市サイト `/secure/22218/<NN><地区名>.pdf` を `cache/<slug>.pdf` に置く(cache は非追跡)。
2. `config.json` の `districts` に1件足す: `{course, name_ja, pdf, pdf_url, areas:[{name,yomi}]}`。
3. ビルド: `EXTRACTED_AT=YYYY-MM-DD node build.mjs`(全地区一括。writeCourses が年ディレクトリを作り直すため)。
   - `build.mjs` が抽出→自動検証(可燃=weekly月木との差分がcancelledのみ・臨時ゼロ、
     月別件数=不燃1紙布2カンビン2ペット2で全12ヶ月、同日複数品目=カンビン+ペットの斜め分割のみ)
     →course/meta/taxonomy を出力。検証NGは例外で止まる。
4. リポジトリ直下で `npm run validate` と `npm run build:ics`。

## テンプレートがずれた場合(新年度・別テンプレート)

四隅の空セルに `/Square` 矩形注釈を置いた PDF を用意し、
`python3 extract.py <PDF> --dump-template` で座標を再導出して `TEMPLATE` を差し替える。
横瀬/皆野/長瀞/小鹿野が別レイアウトなら、市町ごとに TEMPLATE を分ける。

## 単体実行

```
python3 extract.py cache/01-hinoda.pdf            # {品目:[日付...]} を JSON 出力
python3 extract.py cache/01-hinoda.pdf --dump-template   # 注釈から座標を再導出
```
