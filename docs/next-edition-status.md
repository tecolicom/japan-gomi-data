# 次の版の公開状況

収録済み自治体の一次ソースを機械的に見に行き、現行 `period` の次の版へのリンクが
出ているかを判定したもの。**自動収録はしない** — 人が見に行く候補の一覧。
判定は「次の年 (西暦 / 令和) を含み、かつカレンダーらしい語か PDF であるリンク」の有無。
誤検出はありうるので、リンクを開いて確認すること。

生成: `node scripts/check-new-editions.mjs`。いつ状態が変わったかは、このファイルの
git 履歴が記録になる (公開時期の実測値がここに貯まる)。

## 確認できず — 要点検

ページが取れない。移転・削除の可能性があるので**未公開と混同しない**。 (1 自治体)

- **iruma** (saitama) — 収録 `2026-04--2027-03` (2027-03 末) / 現行 令和8年度
  - HTTP 403 — https://opendata.pref.saitama.lg.jp/resource_download/1494

## 監視先がページでない — 要設定

監視先が CSV / PDF / テキスト等でリンクを持たないため、次の版が出ても検出できない。survey.yaml の `schedule_url` を、そのファイルが置かれている**案内ページ**に直すこと。 (13 自治体)

- **arakawa** (tokyo) — 収録 `2026-04--2027-03` (2027-03 末) / 現行 令和8年度
  - text/csv — https://www.city.arakawa.tokyo.jp/documents/41480/gomi_20251216.csv
- **chofu** (tokyo) — 収録 `2026-04--2027-03` (2027-03 末) / 現行 令和8年度
  - text/plain — https://www.city.chofu.lg.jp/documents/16365/r8calendar_no1.txt
- **hatoyama-town** (saitama) — 収録 `2026-04--2027-03` (2027-03 末) / 現行 令和8年度
  - application/pdf — https://www.town.hatoyama.saitama.jp/data/doc/1773387112_doc_50_0.pdf
- **hidaka** (saitama) — 収録 `2026-04--2027-03` (2027-03 末) / 現行 令和8年度
  - application/pdf — https://www.city.hidaka.lg.jp/material/files/group/13/reiwa8nendogominitteihyou.pdf
- **kamifurano-town** (hokkaido) — 収録 `2026-04--2027-03` (2027-03 末) / 現行 令和8年度
  - application/pdf — https://www.town.kamifurano.hokkaido.jp/contents/04chomin/0420seikatsu/gomi/calendar/R08_aka.pdf
- **moroyama-town** (saitama) — 収録 `2026-04--2027-03` (2027-03 末) / 現行 令和8年度
  - application/pdf — http://www.hozenkumiai.or.jp/pdf/moroyama2026_a.pdf
- **ogose-town** (saitama) — 収録 `2026-04--2027-03` (2027-03 末) / 現行 令和8年度
  - application/pdf — http://www.hozenkumiai.or.jp/pdf/ogose2026_a.pdf
- **sabae** (fukui) — 収録 `2026-04--2027-03` (2027-03 末) / 現行 令和8年度
  - text/csv — https://www.pref.fukui.lg.jp/doc/dx-suishin/list_ct_gomisyusyubi_d/fil/sabaeshisyusyubi.csv
- **shinagawa** (tokyo) — 収録 `2026-04--2027-03` (2027-03 末) / 現行 令和8年度
  - text/csv — http://www.city.shinagawa.tokyo.jp/ct/other000081600/gomisyusyubi.csv
- **suginami** (tokyo) — 収録 `2026-04--2027-03` (2027-03 末) / 現行 令和8年度
  - text/csv — https://www.city.suginami.tokyo.jp/documents/12125/garbage.csv
- **taito** (tokyo) — 収録 `2026-04--2027-03` (2027-03 末) / 現行 令和8年度
  - text/csv — https://www.city.taito.lg.jp/kusei/online/opendata/koutu/gomibunbetuitiran.files/tiikibetusyuusyuuyoubiitiran.csv
- **tokyo-nakano** (tokyo) — 収録 `2026-04--2027-03` (2027-03 末) / 現行 令和8年度
  - text/comma-separated-values — https://www2.wagmap.jp/nakanodatamap/nakanodatamap/opendatafile/map_1/CSV/opendata_550239.csv
- **tsurugashima** (saitama) — 収録 `2026-04--2027-03` (2027-03 末) / 現行 令和8年度
  - リンク無し — https://www.city.tsurugashima.lg.jp/page/page003533.html

## 未検出

次の版はまだ見当たらない。 (19 自治体)

- **asaka** (saitama) — 収録 `2026-04--2027-03` (2027-03 末) / 現行 令和8年度
  - 探した年: 2027 / 令和9 — https://www.city.asaka.lg.jp/soshiki/15/dust-syuusyuu.html
- **chichibu** (saitama) — 収録 `2026-04--2027-03` (2027-03 末) / 現行 令和8年度
  - 探した年: 2027 / 令和9 — https://www.city.chichibu.lg.jp/9098.html
- **hanno** (saitama) — 収録 `2026-04--2027-03` (2027-03 末) / 現行 令和8年度
  - 探した年: 2027 / 令和9 — https://www.city.hanno.lg.jp/soshikikarasagasu/kankyokeizaibu/cleancenter/4/893.html
- **higashichichibu-vill** (saitama) — 収録 `2026-04--2027-03` (2027-03 末) / 現行 令和8年度
  - 探した年: 2027 / 令和9 — https://www.vill.higashichichibu.saitama.jp/soshiki/05/gominodashikata.html
- **kawaguchi** (saitama) — 収録 `2026-01--2026-12` (2026-12 末)
  - 探した年: 2027 / 令和9 — https://www.city.kawaguchi.lg.jp/soshiki/01100/040/4/2/3488.html
- **kawasaki** (kanagawa) — 収録 `2026-04--2027-03` (2027-03 末) / 現行 令和8年度
  - 探した年: 2027 / 令和9 — https://www.city.kawasaki.jp/300/page/0000012577.html
- **kurashiki** (okayama) — 収録 `2026-04--2027-03` (2027-03 末) / 現行 令和8年度
  - 探した年: 2027 / 令和9 — https://www.city.kurashiki.okayama.jp/kurashi/kankyo/1003645/1013690/1003647/1003660.html
- **minano-town** (saitama) — 収録 `2026-04--2027-03` (2027-03 末) / 現行 令和8年度
  - 探した年: 2027 / 令和9 — https://www.town.minano.saitama.jp/section/seikatu/265/
- **musashino** (tokyo) — 収録 `2026-04--2027-03` (2027-03 末) / 現行 令和8年度(2026年度)版
  - 探した年: 2027 / 令和9 — https://www.city.musashino.lg.jp/gomi_kankyo/gomi/gomi_shushubi/1053782.html
- **nagatoro-town** (saitama) — 収録 `2026-04--2027-03` (2027-03 末) / 現行 令和8年度
  - 探した年: 2027 / 令和9 — https://www.town.nagatoro.saitama.jp/life/%E3%81%94%E3%81%BF%E3%82%AB%E3%83%AC%E3%83%B3%E3%83%80%E3%83%BC/
- **nerima** (tokyo) — 収録 `2026-04--2027-03` (2027-03 末) / 現行 令和8年度
  - 探した年: 2027 / 令和9 — https://www.city.nerima.tokyo.jp/kurashi/gomi/wakekata/ichiran/index.html
- **nishitokyo** (tokyo) — 収録 `2025-10--2026-09` (2026-09 末) / 現行 令和7年10月〜令和8年9月版
  - 探した年: 2026 / 令和9 — https://www.city.nishitokyo.lg.jp/kurasi/gomi_recycle/gomi-calebder/gomicalender_exel/index.html
- **ogano-town** (saitama) — 収録 `2026-04--2027-03` (2027-03 末) / 現行 令和8年度
  - 探した年: 2027 / 令和9 — https://www.town.ogano.lg.jp/kurashi-tetsuzuki/kankyou-gomi-suidou/gomicalendar/
- **okayama** (okayama) — 収録 `2026-04--2027-03` (2027-03 末) / 現行 令和8年度
  - 探した年: 2027 / 令和9 — https://www.city.okayama.jp/kurashi/category/1-12-7-10-3-0-0-0-0-0.html
- **ome** (tokyo) — 収録 `2026-04--2027-03` (2027-03 末) / 現行 令和8年度版
  - 探した年: 2027 / 令和9 — https://www.city.ome.tokyo.jp/soshiki/23/1182.html
- **setagaya** (tokyo) — 収録 `2025-12--2026-12` (2026-12 末) / 現行 令和8年版
  - 探した年: 2027 / 令和9 — https://www.city.setagaya.lg.jp/02241/416.html
- **tokorozawa** (saitama) — 収録 `2026-04--2027-03` (2027-03 末) / 現行 令和8年度
  - 探した年: 2027 / 令和9 — https://www.city.tokorozawa.saitama.jp/kurashi/gomi/nittei/index.html
- **yokohama** (kanagawa) — 収録 `2026-04--2027-03` (2027-03 末) / 現行 令和8年度
  - 探した年: 2027 / 令和9 — https://www.city.yokohama.lg.jp/kurashi/sumai-kurashi/gomi-recycle/gomi/shushuyobi/aoba/index.html
- **yokoze-town** (saitama) — 収録 `2026-04--2027-03` (2027-03 末) / 現行 令和8年度
  - 探した年: 2027 / 令和9 — https://www.town.yokoze.saitama.jp/kurashi/gomi-recycle/1042

