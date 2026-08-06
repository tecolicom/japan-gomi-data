# chichibu-koiki — 秩父広域 色ベース抽出

秩父広域市町村圏組合(秩父市・横瀬・皆野・長瀞・小鹿野)の雑誌型ごみカレンダー PDF は
テキスト/座標抽出が不可(InDesign 製、pdfplumber `extract_words` 空)。品目がセル背景色で
塗り分けられていることを使い、**文字も日付も読まず**セルの色だけで品目を判定する。
5市町 61 地区を1ツールで収録する(`config.json` の `municipalities` で自治体を束ねる)。

## 仕組み (extract.py)

- グリッド幾何は全 PDF 共通の InDesign テンプレートなので、各月グリッド四隅の空セル座標を
  `TEMPLATE`(PDF pt)に**埋め込み済み**。個々の PDF に矩形を置く必要はない。
- `pdftoppm` でレンダし、暦計算で各日の(週,曜日)→セル中心を決め、セル領域の色ピクセルを
  数えて品目を判定(可燃=緑 / 不燃=黄 / 紙布=紫 / カンビン=水色 / ペット=茶。ピンクの
  クリーンサンデー・施設持込は集積所収集でないので除外)。塊クラスタリングは使わない
  (週行ずれ=旧実装の 12 月バグを排除)。
- **6 週ある月 (5・8 月)** は最終物理行が週5(上)・週6(下)の2週分。単純な上下半分では、
  分割セル内にさらに複数品目が上下2段で入るケース (長瀞 8/24 = 可燃+ペット) の薄い色帯を
  取りこぼす。そこで最終行だけ**セル領域内の連結成分(blob)を検出し、重心の y 位置で
  週5/週6 に振り分ける** (`split_row_items`)。週6 の日が無い列は全高セル扱い。

## 日程パターンと areas (build.mjs)

- 収集頻度・曜日は地区で異なる(可燃 = 月木/火金/水土、山間は少頻度)。パターンは固定せず、
  各品目の実日付から導出する: weekly が綺麗に当てはまれば `weekly` + 休止の cancelled
  override、そうでなければ `monthly_specific`(実日付)。
- **自己検証**: 生成した規則を会計年度で再展開し、色ベース抽出の実日付集合と品目カテゴリ
  ごとに完全一致することを確認する(不一致は例外で停止)。可燃休止日が各群の年末年始1日
  だけに収束するかも点検の目安になる。
- **areas** (playbook §2 準拠) も `config.json` の `municipalities.<handle>.districts[].areas`
  に正典として持ち、build.mjs がそのまま course へ転記する。連結地区名は1町名に分割し、
  デジタル庁 ABR 町字マスター(pref11)由来の yomi/machiaza_id を付与済み。割れ町(同一町名が
  複数コース)の判別子は name でなく **note** に持たせ、name は純粋な町名に保つ。

## 自治体・地区を追加する手順

1. カレンダー PDF を `cache/<name>.pdf` に置く(cache は `.gitignore`。年度を PDF ヘッダで確認)。
2. `config.json` の `municipalities.<handle>` (無ければ新設: name_ja/code/source_index/districts)
   に `districts` を1件足す: `{course, name_ja, pdf, pdf_url, areas:[{name, yomi?, machiaza_id?, note?}]}`。
3. ビルド: `EXTRACTED_AT=YYYY-MM-DD node build.mjs <handle>`(handle 省略で全自治体)。
   自治体単位で `<年度>/` を作り直すので、その自治体の全地区が一括ビルドされる。
4. リポジトリ直下で `npm run validate` と `npm run build:ics`。
5. 目視サンプル: 数地区の 4 月・(6 週の) 8 月あたりをレンダして画像と突き合わせる。

## テンプレートがずれた場合 (新年度・別テンプレート)

四隅の空セルに `/Square` 矩形注釈を置いた PDF を用意し、
`python3 extract.py <PDF> --dump-template` で座標を再導出して `TEMPLATE` を差し替える。
(秩父広域5市町は全て同一テンプレートで、01 日野田町の注釈から確定した座標を流用している。)

## 単体実行

```
python3 extract.py cache/01.pdf                 # {品目:[日付...]} を JSON 出力
python3 extract.py cache/01.pdf --dump-template  # /Square 注釈から四隅座標を再導出
```
