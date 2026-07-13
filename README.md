# japan-gomi-data

日本の自治体の家庭ごみ収集カレンダーを機械可読なオープンデータとして集約するリポジトリ。
**収集日程**(コース×地区、収集ルール)と、それを解釈する**種別定義**を収録する。

- ライセンス: CC BY 4.0(出典を明記すれば自由に利用可)
- 収録範囲: 収集日程 + 種別定義。品目→種別の分別辞書は対象外。
- 自治体キー: **handle**(lg.jp ラベル体系。市は無印、町は `-town` 等。全国一意)。
  ディレクトリは都道府県で束ねる: `municipalities/<都道府県>/<handle>/`

## 構造
- `schema/` — JSON Schema と全国共通の種別語彙(`categories.yaml`)
- `municipalities/<都道府県>/<handle>/` — `meta.yaml`(自治体メタ + 更新に必要な情報源・運用ルール) / `taxonomy.yaml` / `<年度>/course-*.yaml`
  - 都道府県ディレクトリは romaji(`hokkaido`, `saitama`, `fukui` …)。将来 47 都道府県へ拡張。
  - handle は leaf 名で全国一意。ツール(validate/build-ics/ダウンストリーム)は leaf を都市キーとして使う。
- `tools/pdf-extractor/` — PDF からの抽出パイプライン(PDF 由来の自治体用)

## 収録自治体

都道府県コード順。（`municipalities/<都道府県>/<handle>/`、括弧内は handle とコース数）

### 北海道 (hokkaido)
- 上富良野町 — `kamifurano-town` (5コース)

### 埼玉県 (saitama)
- 飯能市 — `hanno` (6コース)
- 日高市 — `hidaka` (20コース)

### 福井県 (fukui)
- 鯖江市 — `sabae` (4コース) ※**未検証**(福井県OD の曜日データ由来。実際の収集日と照合できる公式カレンダーが無い)

## 検証
`npm ci && npm test` で全データを schema + 語彙 + 相互整合で検証する。
`npm run build:ics` で全日イベントの .ics を `ics/<handle>/` へ生成する(CI がドリフトを検知)。

## 出典・免責
各自治体データは公式の配布物・公開データ由来。**更新に必要な情報源は `meta.yaml` に集約**する:
`source.index_url`(公式窓口)、`source.schedule_url`(収集日程の一次ソース)、
`source.yearend_url`(年末年始・特別収集など例外日の情報源)、`notes`(可燃は休日も収集/資源は祝日休止 等の運用ルール)。
course 単位の取得メタは各 `course-*.yaml` の `metadata.source`(`pdf_url` = PDF 由来 / `source_url` = 構造化 OD 由来 / `extracted_at`)。

**検証状態**: 実際の収集日と突き合わせられる公式カレンダー(PDF 等)がある自治体は照合検証できるが、
曜日ベースのオープンデータだけで独立照合できない自治体(例: 鯖江市)は **未検証**。
機械変換のため誤りが残りうる。実際のごみ出しは各自治体の公式情報も併せて確認すること。
誤りに気づいた場合の報告先は各ダウンストリーム(街てこり等)の Discord などを利用のこと。

## カレンダー購読 (.ics)

各自治体・コースの収集日を全日イベントで購読できます (通知はカレンダーアプリの全日予定アラートで設定)。GitHub Pages で `text/calendar` 配信。

- URL: `https://tecolicom.github.io/japan-gomi-data/ics/<handle>/<course-slug>.ics` (ics は handle フラット)
- 購読は上記の `https` を `webcal` に置換。
- 例: 飯能 A-1 → `webcal://tecolicom.github.io/japan-gomi-data/ics/hanno/a1.ics`

course-slug は小文字化 + 最初のハイフン除去 (A-1→a1)。
