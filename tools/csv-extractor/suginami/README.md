# suginami (杉並区) CSV 抽出パイプライン

区公式サイトの収集曜日検索を駆動する CSV「garbage.csv」を一次ソースに、
`municipalities/tokyo/suginami/2026/course-*.yaml` を生成する。

```
node fetch.mjs        # CSV + カレンダーPDF 28枚 + 全地域版冊子 → cache/
node --test           # パーサ単体テスト
node build.mjs        # cache/suginami.csv → course-1〜course-28.yaml (PDF番号=コース)
python3 verify.py     # [1] カレンダーPDF全28枚と通年照合 [2] 冊子P.21一覧表とCSV突合
```

## ソースと照合の構造

- **一次ソース**: 区公式の収集曜日 CSV (`documents/12125/garbage.csv`)。収集曜日の
  オープンデータは無く、これが公式ページ埋め込みの実質公開データ。52 行 (町丁目グループ)。
  列 = 五十音 / 町名 / 可燃 (週2) / 不燃 (第n,m 曜日) / びん・かん・プラ (週1) /
  古紙・ペットボトル (週1) / pdf_url。
- **コース単位 = 地域別カレンダー PDF 番号**。CSV の `pdf_url` が `/shared/garbage/<N>.pdf`
  (N=1〜28) を指す。複数の町名行が同一 PDF を共有するので `areas` に列挙する。
  build.mjs は「1 PDF = 1 収集日程」を検査し、同一 PDF 内で日程が食い違えば中断する。
- **種別対応**: 可燃=burnable / 不燃=non_burnable (monthly_nth、第n=その月 n 回目の該当曜日) /
  古紙・ペットボトル=paper+pet_bottle (同日) / びん・かん・資源プラスチック=
  glass_bottle+beverage_can+plastic (同日)。同日グループは days 配列を共有 (YAML anchor)。
- **検証ソース**:
  1. 地域別「収集カレンダー」PDF `<N>.pdf` (日付入り月間カレンダー)。`pdf_calendar.py` が
     日付×ラベルを抽出し、verify.py が全 28 コース × 通年で照合する (course-N ↔ N.pdf)。
  2. 全地域版冊子 `t2026zentiiki.pdf` P.21「収集曜日一覧」。`booklet.py` が表を抽出し
     CSV と突合する (曜日パターンの多重集合一致 + 町名+丁目キー一致)。

## PDF の罠 (pdf_calendar.py が吸収)

- ラベルは色チップでなく素のテキスト語 (可燃/不燃/古紙/ペット/びん/かん/プラ) で、
  収集日にだけ印字される (中野のような不可視ラベル問題は無い)。
- **月見出しのグリフが二重打ちの PDF がある** (12月ブロックが「1122」「月月」
  「DDeecceemmbbeerr」)。→ 月はグリフに依らず、全 PDF 共通テンプレート
  (表紙 + カレンダー2ページ、6ヶ月×2を行優先で会計年度順) の**スロット位置**から決める。
  明瞭な「<n>月」が読めた場合のみ整合検査 (警告)。日付・ラベル語は二重打ちにならない。
- **月末セルでラベルが 1 文字ずつ分解される** (「古紙」→「古」「紙」)。→ ラベル判定は
  識別文字単位 (可/不/古紙ペット/びんかプラ)。
- **右端のページタブ数字** (x≈577) がグリッド列外に載る。→ 列中心から遠い数字語は除外。
- 日付は「同じ曜日列で直上にある日付セル」に割り付ける (月末の 31 単独行が週行の間に
  挟まっても列単位なら誤らない)。杉並のグリッドは当月日のみ印字するので印字数字=当月日付。

## 冊子 P.21 照合の罠 (booklet.py が吸収)

- 収集曜日一覧は PDF 1 ページ (index 20) に町 2 列 × 各 8 列。列順は CSV と違い
  古紙・ペットが先。不燃は「第n」と曜日が別セル。
- 表下端の数行 (和田・高円寺南2〜4 等) は町名が縦書き・セル境界がずれ、pdfplumber の
  表抽出が町名/丁目ラベルを取りこぼす。→ 町名+丁目キー突合に加え、曜日パターン
  5-tuple の**多重集合一致**で全行の対応を担保する。

## 来年度更新

1. `fetch.mjs` の CSV/PDF/冊子 URL を新年度版に更新 (PDF 番号体系が変わらない前提)。
2. `build.mjs` の `YEAR_END`・`fiscal_year_ja`・`year`・出力年度ディレクトリを更新。
3. `pdf_calendar.py` の `FISCAL_MONTHS` / `fiscal_start`、`booklet.py` の `TABLE_PAGE` を確認。
4. fetch → build → verify を再実行。12 月頃に年末年始の確定告知 (meta.yaml の yearend_url) を確認。
