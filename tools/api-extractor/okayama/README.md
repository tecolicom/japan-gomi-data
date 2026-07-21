# 岡山市 (okayama) ごみ収集日 抽出パイプライン

岡山県岡山市 (code 33100、政令指定都市)。市公式「令和6年3月からの収集曜日一覧表」= **kViewer**
(Cybozu kintone の公開ビュー) の records API を一次ソースに、81 コースの course YAML を生成する。
市サイト直下に地区別の PDF/CSV/HTML 表は無く、この kViewer が唯一の公開一覧。

## 形式

- 一次ソース: kintone 公開ビュー (kViewer) の records API。全 844 行 = 小学校区(121区) × 町名。
- 収集区分: 可燃ごみ(weekly) / 不燃ごみ(monthly_nth) / 資源化物(monthly_nth) / プラスチック資源(weekly)。
  「第n」は全都市共通で「その月 n 回目の該当曜日」(第n週ではない)。
- 資源化物 = ガラスびん・空き缶・スプレー缶・ペットボトル・古紙・古布 の同日一括
  (市公式 https://www.city.okayama.jp/kurashi/0000005214.html で裏取り)。6カテゴリの同日収集へ分解。
- 粒度: 曜日 + 第n。日付入り通年カレンダーは市が非公開のため日付レベル照合は不可。
- 地区単位は小学校区。政令市4行政区(北・中・東・南)への対応表が公開に無いため区別 slug は付けず、
  slug=`okayama-<n>`、小学校区・町名・備考は course_name_ja に人間可読で保持。町丁目カナの権威ソースが
  repo に無いため構造化 areas(name+yomi)は付けない(playbook: 推測でカナを作らない。倉敷先例)。

## kViewer 取得プロトコル (fetch.mjs)

待合室が無効(`waitingRoomEnabled:false`)な間の直叩き経路。混雑で待合室が有効化された場合は
`wr-api/request_order` のポーリングが要る(fetch.mjs は /waiting/ 誘導や token 失敗を検知して明示中断)。

1. `POST /wr-api/assign_request_order` `{subdomain,code}` → `requestId`
2. `POST /wr-api/generate_token` `{requestId,subdomain,code}` → JWT (60秒有効)。
   requestId 反映まで数百ms要るので 500ms 間隔でポーリング。
3. `GET /public/<code>?_viewAccessToken=<JWT>&_viewRef=` → Set-Cookie でセッション確立
4. `GET /public/internal/api/records/<code>/<page>` (Cookie 送付、20件/ページ、page=1..43)

礼儀: ページ間 300ms 間隔(`accessLimitPerMinute=300` に十分収まる)。

## 実行

```sh
EXTRACTED_AT=YYYY-MM-DD node fetch.mjs    # kViewer records API → cache/records.json (844行)
EXTRACTED_AT=YYYY-MM-DD node build.mjs    # course YAML を municipalities/okayama/okayama/2026/ へ
EXTRACTED_AT=YYYY-MM-DD node verify.mjs   # (1)2取得突合 (2)JS署名書出し (3)展開整合
python3 verify_parse.py                   # (2)パース独立2実装(Python)で全844行×4フィールド突合
```

依存: Node の標準 fetch のみ(外部パッケージ不要)。`cache/browser-records.json` は別経路(ブラウザUI)の
独立取得コピーで、fetch.mjs 取得との2経路突合(検証(1))に使う。

## 検証 (2026-07-22)

- **(1) 独立2取得**: fetch.mjs(records API) × ブラウザ取得(cache/browser-records.json)を全844行×8フィールド突合 → 不一致 0。
- **(2) パース独立2実装**: JS(parse.mjs, 逐次トークナイズ) × Python(verify_parse.py, 別実装) で全844行×4フィールド=3376署名突合 → 不一致 0。
- **(3) 畳み込み+展開整合**: 全844行を rules 化しシグネチャで81コースへ写像、各コースを FY2026 通年展開して元行の weekly/第n を完全再現 → 不一致 0。
- 表記の異体(`2水・4水`≡`2.4水`、`1火.3金`≡`1火・3金`、`2月.4木`≡`2月・4木` 等)はパーサが正規化し、85 の生シグネチャが 81 コースへ収斂。
- **原簿(市内部データ)の独立照合は不可**: kViewer が唯一の公開のため(鯖江と同じ『未検証』扱い)。検出できない残余は kViewer 表現と原簿が共有する誤りのみ。

## 注意

- records の `$id` は 1〜868 で欠番24(kintone 削除痕。ユニーク844、totalCount=844 と一致)。
- 移行期の資源化物「当面古紙古布ペットボトルのみ」や町内会単位の資源化物日上書きは備考にあるが、
  粒度が町内会級で権威ある地区割ソースが無いため構造化せず、該当行の course_name_ja に備考原文を保持。
- 祝日・振替は通常収集、休みは土日・年末年始。年末年始は12月告知型(実日付未公開)のため override は作らない。
- キャッシュ(`cache/`)は成果物ではないので `.gitignore` 済(ローカル)。ルート `.gitignore` にも
  `tools/api-extractor/okayama/cache/` の追加を推奨(統括者へ報告)。
