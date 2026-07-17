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

### 杉並区 (未収録, 調査済み 2026-07-17)

- handle: **`suginami`** — city-tecoli の city 識別子規約 (`docs/design/city-identifier-url-scheme.md`, lg.jp ラベル準拠) に基づく。`city.suginami.lg.jp` の存在を DNS で確認済み (2026-07-17。`city.tokyo-suginami.lg.jp` は不存在 = 県名前置なし)。
- **収集曜日のオープンデータは無い**。東京都カタログの杉並区 (組織 t131156) は「ごみ集積所一覧」「ごみの分別方法一覧」の 2 件のみ (2026-07-17 ブラウザで確認)。LinkData `rdf1s1306i`「杉並区ごみ収集日」は旧 (応答も不安定) で使わない。
- **一次ソース候補: 区公式サイトの収集曜日検索を駆動する CSV** (公式ページ埋め込み、OD 宣言なし)
  - https://www.city.suginami.tokyo.jp/documents/12125/garbage.csv (UTF-8 BOM 付き)
  - 同梱: [`sources/suginami_garbage_20260717.csv`](sources/suginami_garbage_20260717.csv)
  - 52 行 (町名×丁目グループ)、列: 五十音 / 町名 / 可燃ごみ (週2曜日) / 不燃ごみ (「第1,3水曜日」形式) / びん・かん・プラ / 古紙・ペットボトル / **地域別カレンダー PDF の URL** (`/shared/garbage/<N>.pdf`, N=1〜28)。
  - ユニークな曜日パターンは 26。PDF は 28 地域 (複数町名行が 1 PDF を共有)。コース単位は PDF 番号に揃えると照合が 1:1 になる。
- 種別 4 区分 (2026年4月から資源プラ開始で現行区分に):
  可燃 (週2) / 不燃 (月2、第n回目=その月n回目の該当曜日) / 古紙・ペットボトル (週1同日) / びん・かん・資源プラスチック (週1同日)。
  → 正典: burnable / non_burnable / paper+pet_bottle 同日 / glass_bottle+beverage_can+plastic 同日。語彙追加は不要。
- **検証ソース**: 地域別「収集カレンダー」PDF 28 枚 (`/shared/garbage/<N>.pdf`, 2026年度版・日付入り月間カレンダー) → 中野方式の通年機械照合が可能。
  加えて全地域版冊子 P.21「ごみ・資源の収集曜日一覧」(https://www.city.suginami.tokyo.jp/documents/715/t2026zentiiki.pdf, 18MB) が全町丁目×4種別の一覧表。
- 運用ルール (冊子 P.21 記載): **祝日もお盆も通常収集**。年末年始 (12/31〜1/3) のみ休止 (休止期間を変更する場合は 12 月の広報・区 HP で告知)。粗大ごみは事前申込制・有料 (受付センター 03-5296-5300)。
- 清掃事務所は 2 管轄 (杉並清掃事務所 / 方南支所)。区指定ごみ袋なし。
- サイト利用規約: 「Copyright © City Suginami. All rights reserved.」で CC BY 等の宣言なし。練馬と同じ「事実データの抽出」整理で扱う。

### 川崎市 (未収録, 調査済み 2026-07-17)

- handle: **`kawasaki`** — lg.jp ラベル準拠 (`city.kawasaki.lg.jp` の存在を DNS で確認済み 2026-07-17)。川崎町 (宮城・福岡) とは lg.jp 側で種別/県名前置により分離される (例: `town.fukuoka-kawasaki.lg.jp`)。政令市の行政区は自治体でないため handle を持たない。
- **収集日のオープンデータは無い**。市 OD カタログ (https://www.city.kawasaki.jp/main/opendata/opendata_list.html) のごみ関連は「ごみの分別オープンデータ」(分別辞典 CSV、ごみ分別アプリページ掲載) のみ。神奈川県カタログにも収集日系は見当たらず。
- **一次ソース候補: 市公式の収集日一覧 HTML 表** (町名ごと、練馬方式で機械変換)。4 ページで全 7 区をカバー:
  - 川崎区: https://www.city.kawasaki.jp/300/page/0000012570.html (75 町名)
  - 幸区・中原区: https://www.city.kawasaki.jp/300/page/0000012568.html (35+40)
  - 高津区・宮前区: https://www.city.kawasaki.jp/300/page/0000012561.html (25+27)
  - 多摩区・麻生区: https://www.city.kawasaki.jp/300/page/0000012577.html (25+28)
  - 計 255 町名行 (丁目分割は幸区の小倉1〜5丁目・古市場1・2丁目の 2 件のみ)。区内ユニークパターン計 80 (区をまたぐ重複は未集計)。
  - 表の列: 町名 / 普通ごみ (週2曜日) / 空き缶・ペットボトル・空きびん・使用済み乾電池 (週1同日) / ミックスペーパー (週1) / プラスチック資源 (週1) / 粗大ごみ・小物金属 (「第2・4回目 火曜」形式、月2)。
  → 正典: burnable(普通ごみ) / beverage_can+pet_bottle+glass_bottle+hazardous(乾電池) 同日 / paper(ミックスペーパー) / plastic / metal(小物金属)。語彙追加は不要。粗大は申込制 (小物金属と同日収集) なので notes 扱い。
- 収集体制: 4 生活環境事業所 (川崎 / 中原=幸・中原 / 宮前=高津・宮前 / 多摩=多摩・麻生)。**政令市初収録**になるため、コース名・地域名に区の表現が要る (課題)。
- **検証ソース**: 各ページ冒頭の区別 PDF (`kawasaki(R8).pdf` / `saiwai(R8).pdf` / `nakahara(8).pdf` / `takatsumiyamae(R8).pdf` / `tamaaso(8).pdf`)。ただし内容は HTML と同じ曜日一覧で、**日付入り年間カレンダーは公開されていない** (アプリ「ごみ分別アプリ」内カレンダーのみ) → 中野式の通年日付照合は不可、HTML×PDF の曜日照合+アプリでの抜き取り確認が現実解。
- 運用ルール (FAQ https://www.city.kawasaki.jp/templates/faq/300/0000125241.html): **祝日・大型連休・お盆も通常収集**。休みは日曜と 1/1〜1/3 (12/31 まで収集する。23区より年末が 1 日長い)。粗大・小物金属のみ年末年始別ルール (2025年度実績: 12/27〜1/4 休止、受付は 12/30 まで)。
- サイト利用規約 (https://www.city.kawasaki.jp/main/site_policy/0000000027.html): 無断複製・転載禁止 (転載は事前連絡・内容非改変)。CC BY 等の宣言なし。練馬と同じ「事実データの抽出」整理で扱う。

### 練馬区 (`tokyo/nerima`, 収録済み)

- 東京都カタログに練馬区の収集曜日 OD は見当たらず、公式「地域別収集曜日一覧」**HTML 表を機械変換** (`tools/html-extractor/nerima/`)。地域別 PDF でエッジ照合。

## 探索のコツ

- 県ポータルの共同公開 (福井方式・北海道 HARP 等) は市町村単独ページより網羅的なことがある。
- カタログ OD は**鮮度に注意** (中野区は 2021 年止まりだった)。必ず現行の公式収集曜日ページと照合してから使う。
- OD に無い運用ルール (祝日収集の有無・年末年始・特別収集) は毎回別途調べて `meta.yaml` の `notes` / `yearend_url` に残す。
