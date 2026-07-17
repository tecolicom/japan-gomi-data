# ごみ収集オープンデータ 調査記録

新しい自治体を収録する際の「収集日程データの探し方」と、これまでの調査で分かった事実の集約。
(初出: city-tecoli `docs/superpowers/specs/2026-07-12-japan-gomi-data-design.md` §先行事例 ほか各セッションの調査。2026-07-16 にここへ集約)

## 探索の起点

1. **デジタル庁「地方公共団体のオープンデータサイト一覧」** — 47都道府県のカタログサイト URL・ライセンス・API 有無の一覧。
   同梱: [`sources/20260228_resources_opendata_lg_pref_list_02.csv`](sources/20260228_resources_opendata_lg_pref_list_02.csv) (2026-02-28 版、政府標準利用規約/CC BY 相当)
   - 配布元: https://www.digital.go.jp/resources/open_data (「オープンデータに取り組む地方公共団体資料」)
2. 対象自治体の県ポータル / 自治体カタログで「ごみ」「収集」で検索。
3. カタログに無ければ自治体公式サイトの収集曜日ページ (HTML 表 / PDF) を一次ソースにする (練馬方式)。

## 先行事例 (設計の裏付け)

- **福井県「県内17市町共同公開データ (ごみ収集日一覧)」** — 県が 17 市町分を 1 つの横断データセットとして共同公開。「都市単位でなく全自治体を一括」の実在先例。
  - https://www.pref.fukui.lg.jp/doc/dx-suishin/list_ct_gomisyusyubi.html
  - LinkData (鯖江分): https://linkdata.org/work/rdf1s2385i
- **鯖江市 + jig.jp (福野泰介)** — ごみ収集日/分別をオープンデータ化 (RDF/LinkData・CKAN・SPARQL)。データ ID 規約 `jp-<pref>-<city>-...`。
  - CKAN: https://ckan.odp.jig.jp/dataset/jp-fukui-sabae-935-odp
  - 分別 OD (鯖江・三島): https://fukuno.jig.jp/app/odp/gomiclass.html
  - データシティ鯖江: https://data.city.sabae.lg.jp/opendata-list/
- **5374 (ゴミナシ, Code for Kanazawa 系)** — 収集データをリポジトリ内 CSV で自治体ごとに展開。オープンデータの共通語は実質 CSV。
  - http://5374.jp/ / https://github.com/codeforkanazawa-org/5374
- **Code for FUKUI (code4fukui)** — 県域オープンデータを GitHub で運用 (`localgovjp` 等)。JSON/CSV 中心。
  - https://code4fukui.github.io/ / https://github.com/code4fukui/opendata_fukui

→ 「全自治体を 1 データセットに束ねる」方針と「CSV 併産で相互運用」の指針はこの先例から採った。

## 自治体別の調査メモ

### 福井県 / 鯖江市 (`fukui/sabae`, 収録済み・未検証)

- 一次ソース: 県 OD の CSV `sabaeshisyusyubi.csv` (URL は `municipalities/fukui/sabae/meta.yaml` に記載)。
- 曜日ベースの OD だけで、実際の収集日と突き合わせられる公式カレンダーが無く**独立照合できない** → README で「未検証」と明示。
- 年末年始・GW 特別収集は OD に無く、エコプラザさばえの年次 PDF から拾う (meta.yaml notes 参照)。

### 東京都カタログ (総論, 2026-07-16 調査)

- 東京都オープンデータカタログ: https://catalog.data.metro.tokyo.lg.jp/
  - **CLI (curl/WebFetch) は CloudFront に 403 で弾かれる**。ページ閲覧はブラウザで行うこと。
    リソース実体は各区ドメイン配布のことが多く、その URL さえ分かれば curl で取れる。
- 収集曜日系データセットは多くの区にあるが、**共通しているのはライセンス (CC BY 4.0, カタログ標準) だけ**。
  タイトル・スキーマ・形式・鮮度は区ごとにバラバラで、都が一括整形した共通シリーズではない。
  例: 中野「資源とごみの収集曜日一覧」CSV / 中央「ごみと資源の収集曜日」/ 品川「ごみ収集日」CSV+RDF /
  文京 XLSX+CSV / 台東「地域別収集曜日一覧」(2025 新規) / 江東 (2024) / 大田 (清掃事業所管轄付き)。
- **リンク切れに注意**: 墨田区 (2015 年 CSV) は区サイト改編で 404 (HTML が返る)。カタログの鮮度表示も要確認。
- **品川区は jig.jp ODP 規約 (鯖江系) の CSV + RDF** — 特別区が ODP 系譜を採用した例。
  - http://www.city.shinagawa.tokyo.jp/ct/other000081600/gomisyusyubi.csv (cp932) / 同 `.rdf`
  - RDF は `odp.jig.jp/odp/1.0#` 語彙。CSV は縦持ち (1 行 = 分類×地区) で
    「ゴミ分類区分, 地区名, 収集曜日, **祝日の収集**, 特別に収集する日/しない日, 適用開始/終了日, 標準地域コード (LOD URI)」
    と運用ルール列まで持つ。鯖江の福井県 CSV (横持ち・種別が列) とはスキーマ別物な点に注意。
- → 東京 23 区は共通スキーマに乗れないため、**区ごとに個別対応** (練馬 = HTML 変換、中野 = CSV + HTML 照合) が前提。

### 中野区 (`tokyo/tokyo-nakano`, 収録済み)

- 収録: `municipalities/tokyo/tokyo-nakano/` (25 コース)。抽出・照合パイプラインは
  `tools/csv-extractor/tokyo-nakano/` (fetch → build → verify、下記の照合をすべて自動化済み)。

- データセット: 中野区「資源とごみの収集曜日一覧」
  - dataset: `t131148d0000000135` / resource: `2372d8ea-1d6c-4df0-b4a8-b92fabafc331`
  - https://catalog.data.metro.tokyo.lg.jp/dataset/t131148d0000000135/resource/2372d8ea-1d6c-4df0-b4a8-b92fabafc331
  - 同梱: [`sources/tokyo-nakano_opendata_550239.csv`](sources/tokyo-nakano_opendata_550239.csv) (ブラウザで取得, 2026-07-16)
  - 42 行 (町名×丁目グループ)、4 種別 (資源プラスチック / びん・缶・ペットボトル / 燃やすごみ / 陶器・ガラス・金属ごみ)。「最終確認日」は 2021-02-08。
  - ライセンス: **CC BY 4.0** (カタログページで確認済み, 2026-07-16。リソース最終更新日 2025-03-01)。
- **照合結果 (2026-07-16)**: 上記 CSV と現行公式「中野区全域のごみと資源の収集曜日一覧」HTML 表
  (https://www.city.tokyo-nakano.lg.jp/kurashi/gomi/syusyuyobi/nakanoku.html) を全 42 行×4 種別で突き合わせ、**相違ゼロ**。
  収集曜日は 2021 年から不変 → CSV を一次ソース、HTML を検証ソースにできる。
- 検証用: 地域別ページに町丁目ごとの年間カレンダー PDF (2026-04〜2027-03, 例: 中野1丁目 `nakano.files/R8-17.pdf`)。
  年末年始の品目別休止 (2025年度実績: 燃やす/プラ 12/31〜1/3、びん・缶・ペット 12/31〜1/4) もこの PDF で確認できる。
- 運用ルール: 祝日 (振替含む) も収集、休みは日曜と年末年始のみ (https://www.city.tokyo-nakano.lg.jp/faq/gomi/gomi29.html)。
  古紙・古布は区収集でなく町会等の**集団回収** (団体ごとに日程が異なる) → 収録対象外の注記が要る。
  中野二・三・五丁目に「毎日収集地域は除く」の注記あり (駅前商業地区とみられるが収集曜日ページ群に詳細記載なし)。

### 練馬区 (`tokyo/nerima`, 収録済み)

- 東京都カタログに練馬区の収集曜日 OD は見当たらず、公式「地域別収集曜日一覧」**HTML 表を機械変換** (`tools/html-extractor/nerima/`)。地域別 PDF でエッジ照合。

## 探索のコツ

- 県ポータルの共同公開 (福井方式・北海道 HARP 等) は市町村単独ページより網羅的なことがある。
- カタログ OD は**鮮度に注意** (中野区は 2021 年止まりだった)。必ず現行の公式収集曜日ページと照合してから使う。
- OD に無い運用ルール (祝日収集の有無・年末年始・特別収集) は毎回別途調べて `meta.yaml` の `notes` / `yearend_url` に残す。
