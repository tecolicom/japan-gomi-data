# japan-gomi-data

日本の自治体の家庭ごみ収集カレンダーを機械可読なオープンデータとして集約するリポジトリ。
**公開ページ (カレンダー購読はこちら): https://tecolicom.github.io/japan-gomi-data/**
調査の背景と経緯は解説記事 [「ごみの日」データを東京・埼玉の 125 自治体で調べた](https://zenn.dev/tecolicom/articles/gomi-open-data-survey-125) を参照。
**収集日程**(コース×地区、収集ルール)と、それを解釈する**種別定義**を収録する。

- ライセンス: CC BY 4.0(出典を明記すれば自由に利用可)
- 収録範囲: 収集日程 + 種別定義。品目→種別の分別辞書は対象外。
- 自治体キー: **handle**(lg.jp ドメインのラベルに準拠、全国一意。規則は下記)。
  ディレクトリは都道府県で束ねる: `municipalities/<都道府県>/<handle>/`

## handle の命名規則

handle は自治体の **lg.jp ドメイン**(`<種別>.<値>.lg.jp`、J-LIS/JPRS 管理)から機械的に決める。自前では採番しない(一意性は lg.jp 側の先願主義が保証する)。

- **`<値>` をそのまま使う**。同名重複で後願側が県名を前置している場合はそれも含む。
  例: 中野区 = `city.tokyo-nakano.lg.jp` → `tokyo-nakano`(先願の長野県中野市が `city.nakano.lg.jp`)。
- **種別は `city`(市・特別区)を省略**し、それ以外は接尾辞で明示する: 町 `-town` / 村 `-vill`。
  例: 上富良野町 = `town.kamifurano.lg.jp` → `kamifurano-town`。
- **政令指定都市は市で 1 handle**(行政区は自治体ではなく lg.jp を持たない)。
  例: 川崎市 = `city.kawasaki.lg.jp` → `kawasaki`。

全国分は生成済み: **[tecolicom/city-tecoli-data](https://github.com/tecolicom/city-tecoli-data)** の
`municipalities/municipalities.yaml`(JPRS WHOIS で lg.jp 実在＋組織名を検証済みの全 1,786 自治体、CC0)。
新自治体を足すときは自分で綴りを考えず**このレジストリを引く**。

## 構造
- `docs/playbook.md` — **新自治体の収録手順書** (ソース探索の優先順・実装規約・照合とサンプリング・エージェント並行運用)
- `schema/` — JSON Schema と全国共通の種別語彙(`categories.yaml`)
- `municipalities/<都道府県>/<handle>/` — `survey.yaml`(収集日データの**公開状況サーベイ**。調査済みなら未収録でも置く) /
  `meta.yaml`(自治体メタ + 更新に必要な情報源・運用ルール) / `taxonomy.yaml` / `<年度>/course-*.yaml`
  - 都道府県ディレクトリは romaji(`hokkaido`, `saitama`, `fukui` …)。将来 47 都道府県へ拡張。
  - handle は leaf 名で全国一意。ツール(validate/build-ics/ダウンストリーム)は leaf を都市キーとして使う。
- `tools/pdf-extractor/` — PDF からの抽出パイプライン(PDF 由来の自治体用)
- `tools/html-extractor/` / `tools/csv-extractor/` — HTML 表 / オープンデータ CSV からの抽出パイプライン
- `tools/txt-extractor/` — 自治体配布のテキスト版カレンダー (日付入り通年) からの抽出パイプライン
- `tools/_lib/` — extractor 共通部品 (曜日/第n回目パース・categoriesOn 正典展開・コース畳み込み・照合と rule of three・レジストリ)。build-ics も同じ展開を使う
- `tools/_template/` — 新自治体 extractor の雛形 (コピーして使う)
- `docs/opendata-sources.md` — ごみ収集オープンデータの調査記録(新自治体収録時の探索ガイド・自治体別メモ)
- `docs/triage/` — **調査台帳データセット** (すべて生成物)。自治体ごとの収集日データ公開状況 (出典 URL・形式・粒度・
  ライセンス・「使いやすさスコア」) を集約した、それ自体が再利用可能なデータ (CC BY 4.0)。現在 埼玉63+東京62=125 自治体。
  **正典は各自治体の `municipalities/<都道府県>/<handle>/survey.yaml`** で、`<都道府県>.yaml`・`triage.csv`・`scores.csv` は
  そこから再生成する (`node scripts/triage-csv.mjs` / `node scripts/triage-score.mjs --csv docs/triage/scores.csv`)。
  スコア定義は [`docs/opendata-quality-index.md`](docs/opendata-quality-index.md)。
  調査は外部からの確認 (2026-07) で誤りがあり得る — 指摘歓迎、随時更新する。

## 収録自治体

都道府県コード順。（`municipalities/<都道府県>/<handle>/`、括弧内は handle とコース数）

### 北海道 (hokkaido)
- 上富良野町 — `kamifurano-town` (5コース)

### 埼玉県 (saitama)
- 飯能市 — `hanno` (6コース)
- 日高市 — `hidaka` (20コース)
- 入間市 — `iruma` (12コース、58地区) ※埼玉県ODの日付入り収集カレンダーCSV (PDL-1.0) 由来。市「分け出し表」PDFと全12地区で照合済み (隔週品目は実日付レベル)
- 所沢市 — `tokorozawa` (38コース、86町別PDF→87地区) ※市公式の日付入り地区別カレンダーPDF由来。通年機械照合 (87×365日 差分ゼロ) + poppler×pdfminer 2エンジン全数一致で検証
- 川口市 — `kawaguchi` (18コース、133町丁目) ※市公式の地区別カレンダーPDF (テキスト層あり・ヘッダに規則明示) 由来。同一PDF内のヘッダ規則×本体実日付グリッドを2026暦年で全日照合、相違ゼロ。暦年 (1〜12月) カレンダーで年度ではない

### 東京都 (tokyo)
- 杉並区 — `suginami` (28コース) ※区サイトの収集曜日検索 CSV 由来。地域別カレンダー PDF 全28枚と通年機械照合済み (延べ5,785日差分ゼロ)
- 中野区 — `tokyo-nakano` (25コース) ※区オープンデータ CSV 由来。町丁目別カレンダー PDF 全42枚と通年機械照合済み
- 調布市 — `chofu` (4コース) ※市配布の日付入りテキスト版カレンダー由来。全4地区×通年で機械照合済み
- 練馬区 — `nerima` (57コース)
- 品川区 — `shinagawa` (36コース、137地区) ※jig.jp ODP 縦持ちCSV (CC BY 4.0) 由来。CSV×RDF別実装+区公式HTML表+別実装通年展開の独立3経路で突合、ODP側の複写誤り1件 (大井6丁目) を検出し公式HTML側を採用
- 台東区 — `taito` (12コース、108町丁) ※区OD CSV 由来。現行の公式HTML表・区公式の整理番号①〜⑫との独立3ソース突合で不一致ゼロ。プラスチックは令和7年4月開始でCSV/HTML未反映のため区公式ページの「資源の曜日」明記を根拠に収録
- 世田谷区 — `setagaya` (37コース、118町丁目) ※区OD CSV (CC BY 4.0) 由来。公式HTML表と全行一致、区の「対象地区1〜37」と構造一致、地区別カレンダーPDF目視全数照合で不一致ゼロ。令和8年11月に収集曜日更新予定 (要再確認)
- 荒川区 — `arakawa` (129コース、番地単位2,249行→514area) ※区配布CSV由来。独立2実装+逆写像で通年展開まで不一致ゼロ、区公式HTMLとごみ系全行照合。年末年始は品目群別 (ごみ1/1〜1/3・資源12/31〜1/3)

### 神奈川県 (kanagawa)
- 横浜市 — `yokohama` (115コース、全18区1,087行) ※政令市。course slug は `<区romaji>-<n>`。市公式「ごみと資源の収集曜日」HTML (五十音別126ページ) 由来、独立2実装・独立取得の2経路で全行一致。青葉区は事務所版一覧画像と全町照合済み。全品目 weekly (月次規則なし)。日付入りカレンダーは市非公開のため日付レベル照合は不可
- 川崎市 — `kawasaki` (80コース、全7区255町名) ※政令市。course slug は `<区romaji>-<n>`。市公式の収集日一覧 HTML 由来、区別 PDF (週次/小物金属の別レイアウト表) と全町照合済み。日付入りカレンダーは市非公開のため日付レベル照合は不可

### 岡山県 (okayama)
- 岡山市 — `okayama` (81コース、844町行・小学校区89) ※政令市。市公式 kViewer (kintone公開ビュー) の records API 由来 — 待合室プロトコルを実装した api-extractor で機械取得。ブラウザ独立取得×HTTP取得の全844行突合 + パース2実装突合 + 展開整合すべて不一致ゼロ。**原簿の独立照合は不可 (kViewer が唯一の公開)** のため鯖江同様この点は未検証。資源化物=びん・缶・スプレー缶・ペット・古紙・古布の同日一括を6カテゴリに分解。areas は {name, note} 構造 (町内会単位の運用例外・地区割れの区別は note に原文保持、yomi は権威ソースが無く未付与)
- 倉敷市 — `kurashiki` (83コース、6環境センター管区) ※市公式の地区別収集日一覧PDF (テキスト層あり) 由来。市OD旧年度CSV (2019) との distinct パターン照合74/76一致 (残差2件は現行PDFが正・年度差) + pdftotext 別エンジン再抽出一致。areas は町内会級地名で読みソースが無く course_name_ja に原文保持

### 福井県 (fukui)
- 鯖江市 — `sabae` (4コース) ※**未検証**(福井県OD の曜日データ由来。実際の収集日と照合できる公式カレンダーが無い)

## 検証
`npm ci && npm test` で全データを schema + 語彙 + 相互整合で検証する。
`npm run build:ics` で全日イベントの .ics を `ics/<handle>/` へ生成する。生成物はリポジトリに含めず、GitHub Pages のデプロイ時に生成して配信する (CI はビルド成功のみ検証)。

## 出典・免責
各自治体データは公式の配布物・公開データ由来。**更新に必要な情報源は `meta.yaml` に集約**する:
`source.index_url`(公式窓口)、`source.schedule_url`(収集日程の一次ソース)、
`source.yearend_url`(年末年始・特別収集など例外日の情報源)、`notes`(可燃は休日も収集/資源は祝日休止 等の運用ルール)。
course 単位の取得メタは各 `course-*.yaml` の `metadata.source`(`pdf_url` = PDF 由来 / `source_url` = 構造化 OD 由来 / `extracted_at`)。

**検証状態**: 実際の収集日と突き合わせられる公式カレンダー(PDF 等)がある自治体は照合検証できるが、
曜日ベースのオープンデータだけで独立照合できない自治体(例: 鯖江市)は **未検証**。
検証の強度と限界 (独立照合/自己照合の区別、確率論的な信頼度の考え方) は
`docs/opendata-sources.md` の「検証の考え方」を参照。
機械変換のため誤りが残りうる。実際のごみ出しは各自治体の公式情報も併せて確認すること。
誤りに気づいた場合の報告先は各ダウンストリーム(街てこり等)の Discord などを利用のこと。

## カレンダー購読 (.ics)

各自治体・コースの収集日を全日イベントで購読できます (通知はカレンダーアプリの全日予定アラートで設定)。GitHub Pages で `text/calendar` 配信。

- URL: `https://tecolicom.github.io/japan-gomi-data/ics/<handle>/<course-slug>.ics` (ics は handle フラット)
- 購読は上記の `https` を `webcal` に置換。
- 例: 飯能 A-1 → `webcal://tecolicom.github.io/japan-gomi-data/ics/hanno/a1.ics`

course-slug は小文字化 + 最初のハイフン除去 (A-1→a1)。

- **`ics/index.csv`** — 全コースの一覧表 (build:ics が生成)。列: 団体コード / 都道府県 / handle / 自治体名 /
  コース / コース名 / 対象地区 (「；」区切り) / ICS URL。**自治体コードや町名からコースを探すにはこれを引く**。
- `ics/` を handle フラットにしているのは**公開済み ICS URL を変えないため** (購読者のカレンダーに永続登録される)。
  全国 1,741 自治体でも配信 (GitHub Pages) に支障はない。GitHub の Web UI は 1,000 エントリ超で省略表示になるが、
  探索は index.csv が担うので構造は変えない。
