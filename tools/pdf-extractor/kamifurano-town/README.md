# 上富良野町 (kamifurano-town)

年間ごみ収集カレンダー PDF (コース別・全戸配布) から `course-*.yaml` を生成する。

| | |
|---|---|
| 一次ソース | [ごみカレンダー案内ページ](https://www.town.kamifurano.hokkaido.jp/index.php?id=333) → コース別 PDF 5 枚 |
| 収録期間 | 2026-04--2027-03 (令和8年度) |
| コース | 5 (市街地 3 + 農村 2) |
| 独立照合ソース | **無い。** 日程を表す資料は各コース PDF 1 枚だけ |

## コース構成

町名で区分する (番号運用ではない)。粗大ごみの収集日は全コース共通。

- **市街地 3 コース** (赤 / 青 / 緑) — 生ごみ (週 2) を分別収集。空き缶と空きびんは別日
- **農村 2 コース** (農村東 / 農村西) — 生ごみは分別せず一般ごみへ (自家処理前提)。
  缶・びんは同一日 (グリッド上のラベルも「缶・ビン」)

## 使い方

```sh
node fetch.mjs                              # PDF 5 枚を cache/ へ
EXTRACTED_AT=$(date +%F) node build.mjs     # course-*.yaml を生成
```

**pdfplumber を持つ python が要る。** 既定の `python3` が持っていない環境があるので、
`build.mjs` は `PYTHON` 環境変数を見て、無ければ `python3.10` → `python3` → `python` の順に
`import pdfplumber` を試す。どれも駄目なら黙って進まず throw する。

```sh
PYTHON=/opt/homebrew/bin/python3.11 node build.mjs   # 明示する場合
```

## 抽出ロジック

`extract_kamifurano.py` — カレンダーグリッドを pdfplumber の語座標で解析する。

- `extract_calendar()` — 列アンカー (日〜土の左端 x) で列を、top の連続性で週行を復元し、
  各ラベルを直上の日付セルに割り当てる。月境界・年末年始の休止・「回収しません」は、
  **グリッドにラベルが無い日として自然に欠落する**
- `extract_oversized()` — 側枠「粗大ごみの収集日」を `pdftotext -layout` のテキストから
  抽出する (月ラベルが 2 つの日付の間に置かれる構造に対応)

`build.mjs` は共通部品に寄せている。規則化は `_lib/classify.mjs` の `classifyRules()`、
休止日は `_lib/schedule.mjs` の `cancelledOverrides()`、出力は `_lib/emit.mjs`。
自前の分類ロジックは持たない。

**meta.yaml / taxonomy.yaml は生成しない (手書きが正典)。** ここが書くのは `course-*.yaml` だけ。

## 検証

- **自己検証** — 生成した規則を `expandRange()` で再展開した結果が、PDF から抽出した実日付と
  完全一致することを build 内で確認する。合わなければ書き出さない
- **独立照合は無い。** 日程を表す資料が PDF 1 枚しかないため。`verify.mjs` を置いていないのは
  そのためで、検査を省いたのではない

## 履歴

- 2026-07-10 収録。当時の生成器 (`gen_yaml.py`) は旧構造 `cities/kamifurano/data/gomi/2026/`
  に書いており、**`build.mjs` 規約に乗っていなかったので `make regen` が skip し続けていた** —
  誤りが入っても機械では検出できない状態だった
- 2026-08-20 `build.mjs` を起こして regen に乗せた。**日程は 1 日も変えていない** —
  旧データと新生成物を 1825 日枠 (5 コース × 365 日) で全日照合し、不一致 0。
  照合が空振りしていないことも、抽出結果を 1 件消す/1 件足す改竄で両方向に確認した。
  共通部品 (`classifyRules` + `cancelledOverrides`) が旧 `gen_yaml.py` と同じ規則
  (rules 数・overrides 数・pattern すべて一致) を独立に導いている
