# japan-gomi-data

日本の自治体の家庭ごみ収集カレンダーを機械可読なオープンデータとして集約するリポジトリ。
**公開ページ (カレンダー購読はこちら): https://tecolicom.github.io/japan-gomi-data/**
調査の背景と経緯は解説記事 [「ごみの日」データを東京・埼玉の 125 自治体で調べた](https://zenn.dev/tecolicom/articles/gomi-open-data-survey-125) を参照。
**収集日程**(コース×地区、収集ルール)と、それを解釈する**種別定義**を収録する。

- ライセンス: CC BY 4.0(出典を明記すれば自由に利用可)
- 収録範囲: 収集日程 + 種別定義 + **facts (読み物断片)**。品目→種別の分別辞書は対象外。
- 自治体キー: **handle**(lg.jp ドメインのラベルに準拠、全国一意。規則は下記)。
  ディレクトリは都道府県で束ねる: `municipalities/<都道府県>/<handle>/`

## はじめに

- **自分の町を追加したい** → [`CONTRIBUTING.md`](CONTRIBUTING.md)
- **エージェント (Claude Code / Codex) で作業する** → [`AGENTS.md`](AGENTS.md)
- **収録の手順と判断基準** → [`docs/playbook.md`](docs/playbook.md)

```bash
make setup && make test    # 動作確認
make help                  # コマンド一覧
```

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
- `schema/` — JSON Schema と全国共通の種別語彙(`categories.yaml`)。course の `areas` は `{name, yomi?, machiaza_id?, note?}` (1 area = 1 町名。yomi/町字ID はデジタル庁アドレス・ベース・レジストリ由来、割れ町は「町名（判別子）」で name 単独特定可。作り方は playbook §2)
- `municipalities/<都道府県>/<handle>/` — `survey.yaml`(収集日データの**公開状況サーベイ**。調査済みなら未収録でも置く) /
  `meta.yaml`(自治体メタ + 更新に必要な情報源・運用ルール) / `taxonomy.yaml` / `<収録期間>/course-*.yaml` /
  `facts.yaml`(任意。**利用者向け読み物断片** — その街のごみ収集の特徴を出典つき事実で 2〜4 文にまとめたもの。真備だけ分別が違う・可燃が月2回の集落がある 等。全国横断の比較統計は `build:stats` が `ics/stats.json` に機械導出する)
  - `<収録期間>` は `YYYY-MM--YYYY-MM` (月単位の閉区間)。**一次ソースが実際に裏付ける範囲**そのもので、会計年度とは限らない
    — 4月起点 `2026-04--2027-03` / 10月起点 `2025-10--2026-09` (西東京・東村山・武蔵村山・東大和) /
    暦年 `2026-01--2026-12` (川口) / 半期 (墨田) がいずれも同じ形で表せる。
    自治体自身の呼称 (例「令和7年度版」) は実期間とずれることがあるため `source.edition_ja` に分けて持つ。
    **この範囲の外は展開しない** (裏付けの無い日付を作らないための境界)。範囲内でも収集の有無が
    一次ソースから確定できない区間は `unknown_periods` で宣言する — 休止を書かないことは
    「収集あり」の断定になってしまうため、断定も推測もせずに欠落を記録する。
  - 都道府県ディレクトリは romaji(`hokkaido`, `saitama`, `fukui` …)。将来 47 都道府県へ拡張。
  - handle は leaf 名で全国一意。ツール(validate/build-ics/ダウンストリーム)は leaf を都市キーとして使う。
- `tools/pdf-extractor/` — PDF からの抽出パイプライン(PDF 由来の自治体用)。テキスト層があるものは pdftotext/座標抽出、日付入りカレンダー型は実日付からパターン導出 (`saiseibu-kumiai`)。罫線がベクタで入っていればグリッドを座標復元できる (`musashino`)。**文字が図版化されていて読めない PDF は、品目の塗り色で判定する色ベース抽出**:
  - `chichibu-koiki` — 雑誌型 InDesign 製で文字も座標も取れない。全PDF共通テンプレートの月グリッド四隅座標＋暦でセル位置を決め、セル領域の色で品目を当てる (6週の月の分割セルは連結成分の重心で週を振り分け)
  - `ome` — 罫線は座標で取れるが**品目名だけがアウトライン図版**。グリッドは罫線から復元し、袋アイコン3色 + 角丸ラベル9色で品目を判定する (色と寸法の組で一意。未知色は無視されるため、次年度は品目別件数の急減で配色変更に気づく運用)
- `tools/html-extractor/` / `tools/csv-extractor/` — HTML 表 / オープンデータ CSV からの抽出パイプライン
- `tools/txt-extractor/` — 自治体配布のテキスト版カレンダー (日付入り通年) からの抽出パイプライン
- `tools/_lib/` — extractor 共通部品 (曜日/第n回目パース・categoriesOn 正典展開・コース畳み込み・照合と rule of three・レジストリ)。build-ics も同じ展開を使う
- `tools/_template/` — 新自治体 extractor の雛形 (コピーして使う)

### areas の読み(yomi)・町字ID ソース

areas の `yomi` / `machiaza_id` はデジタル庁 **アドレス・ベース・レジストリ (ABR) 町字マスター**
由来 (政府標準利用規約)。各 extractor の `fetch-yomi.mjs` が県版 CSV を取得する
(`https://data.address-br.digital.go.jp/mt_town_fullset/pref/mt_town_fullset_pref<NN>.csv.zip`)。

ABR は住居表示ベースのため、横浜市の「戸塚町」「和泉町」のような**古い広域大字を持たない**ことがある。
これを補うため **日本郵便 郵便番号データ (ken_all) を第2の yomi ソースに併用**する (横浜で導入)。
ken_all の公式 zip は bot 対策でスクリプトから直接ダウンロードできない (UA 付きでも 404) ため、
**手動配置運用**とする:

1. [日本郵便の郵便番号データダウンロードページ](https://www.post.japanpost.jp/zipcode/dl/utf-zip.html)
   をブラウザで開き「最新データのダウンロード (zip形式)」= `utf_ken_all.zip` を取得
2. `tools/<extractor>/<handle>/cache/utf_ken_all.zip` に配置
3. `node fetch-yomi.mjs` を実行 (zip があれば ken_all を読み込み、無ければ ABR のみで続行)

ken_all は日本郵便が無償配布する正式データ。`machiaza_id` は ABR 専用 (ken_all に ID は無い) のため、
ken_all で補完されるのは読みのみ。cache は `.gitignore` 対象なので zip はリポジトリに含めない。
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
- 川口市 — `kawaguchi` (18コース、133町丁目) ※市公式の地区別カレンダーPDF (テキスト層あり・ヘッダに規則明示) 由来。同一PDF内のヘッダ規則×本体実日付グリッドを2026暦年で全日照合、相違ゼロ。暦年 (1〜12月) カレンダーで年度ではない
- 秩父市 — `chichibu` (43コース、43地区) ※秩父広域市町村圏組合の雑誌型カレンダーPDF (InDesign 製で文字/座標抽出不可)。品目がセル背景色で塗り分けられているのを使い、文字も日付も読まず**セルの色だけで品目を判定する色ベース抽出** (`tools/pdf-extractor/chichibu-koiki`)。収集曜日・頻度は地区で異なるため、各品目の実日付から weekly / monthly_specific を地区ごとに導出し、規則の再展開が抽出結果と一致することを自己検証
- 所沢市 — `tokorozawa` (38コース、86町別PDF→87地区) ※市公式の日付入り地区別カレンダーPDF由来。通年機械照合 (87×365日 差分ゼロ) + poppler×pdfminer 2エンジン全数一致で検証
- 飯能市 — `hanno` (6コース)
- 入間市 — `iruma` (12コース、58地区) ※埼玉県ODの日付入り収集カレンダーCSV (PDL-1.0) 由来。市「分け出し表」PDFと全12地区で照合済み (隔週品目は実日付レベル)
- 朝霞市 — `asaka` (6コース) ※市公式「ごみの出し方」HTML 由来
- 日高市 — `hidaka` (20コース)
- 鶴ヶ島市 — `tsurugashima` (4コース) ※埼玉西部環境保全組合の日付入りカレンダーPDFを座標抽出し、実収集日から曜日+第nパターンを導出 (`tools/pdf-extractor/saiseibu-kumiai`、組合共通ツール)
- 毛呂山町 — `moroyama-town` (3コース) ※埼玉西部環境保全組合 (`saiseibu-kumiai`)
- 越生町 — `ogose-town` (2コース) ※埼玉西部環境保全組合 (`saiseibu-kumiai`)
- 鳩山町 — `hatoyama-town` (2コース) ※埼玉西部環境保全組合 (`saiseibu-kumiai`)
- 横瀬町 — `yokoze-town` (3コース) ※秩父広域市町村圏組合。秩父市と同一 InDesign テンプレートのため四隅座標を流用した色ベース抽出 (`chichibu-koiki`)
- 皆野町 — `minano-town` (4コース) ※秩父広域市町村圏組合 (色ベース抽出 `chichibu-koiki`)
- 長瀞町 — `nagatoro-town` (3コース) ※秩父広域市町村圏組合 (色ベース抽出 `chichibu-koiki`)
- 小鹿野町 — `ogano-town` (8コース) ※秩父広域市町村圏組合 (色ベース抽出 `chichibu-koiki`)
- 東秩父村 — `higashichichibu-vill` (1コース) ※村公式「ごみの出し方」HTML 由来。地区割が無く全域一律1コース

### 東京都 (tokyo)
- 杉並区 — `suginami` (28コース) ※区サイトの収集曜日検索 CSV 由来。地域別カレンダー PDF 全28枚と通年機械照合済み (延べ5,785日差分ゼロ)
- 中野区 — `tokyo-nakano` (25コース) ※区オープンデータ CSV 由来。町丁目別カレンダー PDF 全42枚と通年機械照合済み
- 調布市 — `chofu` (4コース) ※市配布の日付入りテキスト版カレンダー由来。全4地区×通年で機械照合済み
- 練馬区 — `nerima` (57コース)
- 品川区 — `shinagawa` (36コース、137地区) ※jig.jp ODP 縦持ちCSV (CC BY 4.0) 由来。CSV×RDF別実装+区公式HTML表+別実装通年展開の独立3経路で突合、ODP側の複写誤り1件 (大井6丁目) を検出し公式HTML側を採用
- 台東区 — `taito` (12コース、108町丁) ※区OD CSV 由来。現行の公式HTML表・区公式の整理番号①〜⑫との独立3ソース突合で不一致ゼロ。プラスチックは令和7年4月開始でCSV/HTML未反映のため区公式ページの「資源の曜日」明記を根拠に収録
- 世田谷区 — `setagaya` (37コース、118町丁目) ※区OD CSV (CC BY 4.0) 由来。公式HTML表と全行一致、区の「対象地区1〜37」と構造一致、地区別カレンダーPDF目視全数照合で不一致ゼロ。令和8年11月に収集曜日更新予定 (要再確認)
- 荒川区 — `arakawa` (129コース、番地単位2,249行→514area) ※区配布CSV由来。独立2実装+逆写像で通年展開まで不一致ゼロ、区公式HTMLとごみ系全行照合。年末年始は品目群別 (ごみ1/1〜1/3・資源12/31〜1/3)
- 西東京市 — `nishitokyo` (8コース、22町114丁目) ※市公式「ごみ・資源物収集カレンダー(テキスト版)」の地域別HTML由来 (調布と同型の日付入り通年カレンダー)。**10月起点1年** `2025-10--2026-09`。びん類/缶の隔週交替と水曜の4週周期は weekly/monthly_nth で表せないため monthly_specific。冊子版PDFはアウトライン化でテキスト層が無いため、層化サンプリングで4ヶ月91日枠を画像から目視照合
- 武蔵野市 — `musashino` (10コース、13町51丁目) ※市公式の地区別カレンダーPDF (Illustrator製だが**本物の罫線ベクタ**を持つため座標でグリッド復元) 由来。市サイトの地区別曜日サマリ (PDFとは別に人が書いた表現) と50枠で独立照合、PDF画像の目視転記130日枠も相違ゼロ。ペットボトルは令和8年7月から隔週→毎週
- 青梅市 — `ome` (8コース、44町149町字) ※市公式の日程別カレンダーPDF由来。罫線は座標復元できるが**品目名がすべてアウトライン図版**でテキスト層に無いため、秩父広域と同じ**色ベース抽出** (袋アイコン3色 + 角丸ラベル9色) で品目を判定 (`tools/pdf-extractor/ome`)。冊子本文の頻度規則104枠と独立照合。サーベイの difficulty 4 / granularity partial は誤りで、2 / dates へ訂正した

### 神奈川県 (kanagawa)
- 横浜市 — `yokohama` (115コース、全18区1,087行) ※政令市。course slug は `<区romaji>-<n>`。市公式「ごみと資源の収集曜日」HTML (五十音別126ページ) 由来、独立2実装・独立取得の2経路で全行一致。青葉区は事務所版一覧画像と全町照合済み。全品目 weekly (月次規則なし)。日付入りカレンダーは市非公開のため日付レベル照合は不可
- 川崎市 — `kawasaki` (80コース、全7区255町名) ※政令市。course slug は `<区romaji>-<n>`。市公式の収集日一覧 HTML 由来、区別 PDF (週次/小物金属の別レイアウト表) と全町照合済み。日付入りカレンダーは市非公開のため日付レベル照合は不可

### 岡山県 (okayama)
- 岡山市 — `okayama` (81コース、844町行・小学校区89) ※政令市。市公式 kViewer (kintone公開ビュー) の records API 由来 — 待合室プロトコルを実装した api-extractor で機械取得。ブラウザ独立取得×HTTP取得の全844行突合 + パース2実装突合 + 展開整合すべて不一致ゼロ。**原簿の独立照合は不可 (kViewer が唯一の公開)** のため鯖江同様この点は未検証。資源化物=びん・缶・スプレー缶・ペット・古紙・古布の同日一括を6カテゴリに分解。areas は {name, yomi, machiaza_id, note} 構造 (yomi 99.6%・町字ID 98.8% をデジタル庁アドレス・ベース・レジストリ由来で付与、備考は note に原文保持)
- 倉敷市 — `kurashiki` (83コース、6環境センター管区) ※市公式の地区別収集日一覧PDF (テキスト層あり) 由来。市OD旧年度CSV (2019) との distinct パターン照合74/76一致 (残差2件は現行PDFが正・年度差) + pdftotext 別エンジン再抽出一致。areas は町名単位に分解した {name, yomi, machiaza_id, note} 構造 (元125行→474 area。丁目レンジは個別丁目へ展開、境界条件・旧呼称は note。yomi 95%・町字ID 94% を ABR 由来で付与)

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
- **`ics/stats.json`** — 全自治体の横断比較統計 (build:ics が生成)。品目別の収集頻度・種別呼称の異名分布
  (可燃ごみの呼び名は全国5通り 等)・収集グループ・facts の一覧。全国横断ページや読み物の裏付けデータ。
