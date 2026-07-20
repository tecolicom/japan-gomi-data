# shinagawa (品川区) CSV 抽出パイプライン

品川区が jig.jp ODP (オープンデータプラットフォーム) で公開する縦持ち CSV「ゴミ収集日」
(CC BY 4.0) を一次ソースに、`municipalities/tokyo/shinagawa/2026/course-*.yaml` を生成する。

```
node fetch.mjs        # ODP CSV + ODP RDF + 区公式「収集日一覧」HTML 7ページ → cache/
node --test           # パーサ単体テスト (parse.test.mjs)
node build.mjs        # cache/ → course-*.yaml (137地区 → シグネチャ畳み込みで36コース)
node verify.mjs       # 生成 YAML を一次ソース規則と通年 (令和8年度・全137地区) で機械照合
```

## ソースと 3 経路照合

同一の収集日程が 3 つの独立した表現で公開されており、build.mjs が全て突合する。

| 経路 | ソース | 解釈するもの | 実装 |
|---|---|---|---|
| A | `gomisyusyubi.csv` (cp932) | 日本語ラベル `第2木・第4木` | `parse.mjs` |
| B | `gomisyusyubi.rdf` (UTF-8) | ODP 語彙 URI `#SecondThursday` | `parse-rdf.mjs` |
| C | 公式「収集日一覧」HTML 7ページ | 現行公式表 `第2木曜日、…` | `parse-html.mjs` |

- **A × B** は同一 ODP データセットの別表現。パース経路が独立 (日本語文字列の解釈 vs URI 語彙の
  解釈) なので、一方のパースミスを他方が検出する。全 411 行 (137地区×3分類) の日程・祝日収集
  フラグが一致する。
- **C** は区が独立に編集・更新する現行の正。ODP データセットは `dcterms:modified 2015-06-03` と
  古く鮮度が疑わしいため、build.mjs が C と全突合して鮮度ガードにする。

## 収集区分と「資源」の分解

区の収集区分は 3 つ (燃やすごみ・陶器・ガラス・金属ごみ・資源)。粗大ごみは申込制で曜日表に
載らない。「資源」は複数品目を同一曜日に資源回収ステーションで回収する呼称なので、正典語彙の
6 カテゴリ (plastic / pet_bottle / glass_bottle / beverage_can / paper / hazardous) へ分解し、
同日収集を YAML anchor で表現する。古着・古布は拠点回収 (区内一律・毎月第2・4土曜) のため対象外。
詳細は `municipalities/tokyo/shinagawa/taxonomy.yaml` と `meta.yaml`。

## 罠と既知の誤り

- **ODP CSV の 1 件の誤り**: 大井6丁目の燃やすごみが「第1月・第3月」(= 同地区の陶器・ガラス・
  金属ごみの値の複写)。区公式 HTML は火・金で、隣接町も火・金。build.mjs の `KNOWN_DIVERGENCES`
  に明示し公式 HTML 側を採用する。ODP 側が変化したら build は中断する。
- **全角/半角の混在**: 収集曜日に `第２木・第４木` (全角) と `第2木・第4木` (半角) が混在。
  `_lib/jp.mjs` の `zen2han`/`normJa` が吸収する。
- **「第n<曜日>・第m<曜日>」形式**: 曜日を繰り返す品川区独自表記。`_lib` の `parseMonthlyNthJa`
  (第1,3月曜日 形式) はそのままでは使えないため `parse.mjs` の `parseCollectionDay` で専用に解く。
- **分割地区 8 組**: 同一町丁目が番地/棟/エリアで別日程に分かれる。CSV の地区名 (例
  「西大井1丁目（荏原エリア）」) と公式 HTML の番地表記 (例「4番28〜32号」) は別体系だが、日程
  署名が一意に対応するので機械的に対応づけできる (`cache/banchi-map.json` に出力)。
- **祝日収集**: 全地区が祝日も通常収集 (CSV「祝日の収集」列=○ / RDF `isCollectToPublicHoliday`
  =true)。overrides 不要。
- **年末年始**: overrides は空。令和8年度分 (2026年末〜2027年始) が未公表のため。`meta.yaml`
  の yearend_url を 2026年12月に確認して補うこと。

## 来年度更新

1. `build.mjs` の `YEAR` / `FISCAL_YEAR_JA` と出力年度、`verify.mjs` の `FY` を更新
2. `node fetch.mjs --force` で最新を取得 → build → verify (A×B×C 突合が落ちたら日程改定を疑う)
3. `KNOWN_DIVERGENCES` は毎回見直す (ODP 側が誤りを直したら build が中断して知らせる)
4. 11 月下旬〜12 月に yearend_url を確認し、年末年始 overrides を各コースへ補う
