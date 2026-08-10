---
name: add-municipality
description: このリポジトリに新しい自治体のごみ収集カレンダーを収録する。ユーザーが「自分の町のデータを作って」「<市区町村名>を収録して」と言ったとき、または municipalities/ に新しい自治体を追加するときに使う。
---

# 自治体を 1 つ収録する

**知識は `docs/playbook.md` にある。本書は進行管理だけを担う。** 先に playbook を読むこと。

## 原則

- **停止するのは 1 回だけ** — Phase 1 の直後。それ以外は自分で進める。
- **推測でデータを作らない。** 撤退は失敗ではない。`survey.yaml` が 1 件増えれば台帳が育つ。
- **生成ファイルを手で編集しない。** 直したいときは生成器を直して `make regen`。

## Phase 0: 準備

1. `docs/playbook.md` を読む。
2. handle をレジストリで引く。

```bash
node -e "import('./tools/_lib/registry.mjs').then(async m => console.log(await m.lookupMunicipality('市区町村名')))"
```

3. `municipalities/<pref>/<handle>/survey.yaml` があれば読む。
   **survey の記述を鵜呑みにしない** — 2026-08-10 に青梅で
   「カレンダーは画像で抽出不可」という記述が誤りだった実例がある。

## Phase 1: ソース探索 → ここで停止する

`docs/playbook.md` §1 の優先順で探す。テキスト版カレンダー > OD CSV > サイト内 CSV >
HTML 表 > テキスト層 PDF > 画像 PDF。

PDF を「画像だから無理」と判断する前に、必ず次を実行する。

```bash
python3 -c "
import pdfplumber, sys
pdf = pdfplumber.open(sys.argv[1])
for i, p in enumerate(pdf.pages):
    print(i+1, 'words', len(p.extract_words()), 'lines', len(p.lines), 'curves', len(p.curves), 'images', len(p.images))
" <pdf>
```

判定の考え方 (罫線・塗り色で図版から読み取る方法) は `docs/playbook.md` §1 を見る。

### 停止して報告する 4 項目

調べ終えたら**実装に入らず**、次を報告して承認を得る。

1. **一次ソース** — URL・形式・収録期間・ライセンス
2. **独立照合に何を使うか** — 無ければ「無い」と明言する。
   その場合 `verified_by` に自己照合のみと書く旨も宣言する
3. **正典語彙に収まらない品目とその処理案** — 同日の別品目に寄せる / 除外 / 語彙追加の相談。
   **語彙追加は上流の判断**なので自分で決めない
4. **撤退の可能性** — 下記に当たるなら「survey だけ残して終了」を提案する

### 撤退条件

- 一次ソースが機械可読でない (画像 PDF・アプリ内のみ)
- 地区割が公開資料から確定できない
- 第三者商用アプリ (ごみスケ・さんあ〜る等) しか情報源が無い — 方針により不採用

撤退するときは `survey.yaml` に調査結果と理由を書いて終わる。

## Phase 2: 抽出

```bash
make new HANDLE=<handle> PREF=<都道府県romaji> KIND=<html|pdf|csv|txt|api>
```

手本にする既存 extractor を選ぶ。

| ソース形式 | 手本 |
|---|---|
| テキスト版カレンダー | `tools/txt-extractor/chofu/` |
| 日付入り HTML | `tools/html-extractor/nishitokyo/` |
| 罫線のある PDF | `tools/pdf-extractor/musashino/` |
| 文字が図版の PDF (色ベース) | `tools/pdf-extractor/ome/`、`tools/pdf-extractor/chichibu-koiki/` |
| OD CSV | `tools/csv-extractor/iruma/` |

守ること。

- `tools/_lib/` にあるものを再実装しない (`AGENTS.md` の表を見る)
- 実日付から規則を導くときは `_lib/classify.mjs` の `classifyRules()` を使う。
  events は期間を漏れなく覆い、収集なしの日は空配列で渡す
- 未対応の表記は throw する
- build 内で `expandRange()` 再展開が抽出実日付と完全一致することを自己検証する。
  一致しなければ書き出さない

## Phase 3: 照合

Phase 1 で宣言した独立ソースと突き合わせる。

- 機械照合できるなら全数。`_lib/verify.mjs` の `diffRange` を使う
- **高コスト (目視転記・OCR 不可) なら層化サンプリング**。
  `docs/opendata-sources.md`「検証の考え方」§5 の停止規則に従う
- **目視で読んだ結果は `verify.mjs` の `PDF_SAMPLES` に固定保持する** (同 §6)。
  一過性にしない。平日は全部書き、「収集なし」も明示する。
  サンプルは端 (年末年始・6 週ある月・隔週の位相が変わる月) を狙う

## Phase 4: 仕上げ

1. `meta.yaml` の notes に運用ルール・年末年始・検証・**確率的信頼度**を書く
   (rule of three。N の数え方は `docs/opendata-sources.md`「検証の考え方」§1 を見る)
2. `taxonomy.yaml` は `schema/categories.yaml` の部分集合 + ラベル override
3. `survey.yaml` に「【収録済 YYYY-MM-DD】…」を追記する
4. 通す。

```bash
make regen HANDLE=<handle>   # 再生成して差分ゼロ
make verify HANDLE=<handle>  # 独立照合
make test                    # 全ゲート
```

5. 完了報告: コース数・area 数 / 照合統計 (N・不一致内訳・確率的信頼度) /
   `make test` の結果 / 未解決事項。

## 詰まったとき

- **verify で差分が出る** — まず cache を疑う。一次ソースを取り直して extract からやり直す
  (2026-08-10 に所沢で、古い cache が原因の「1044 件の不一致」を踏んだ)
- **`make regen` で差分が出る** — 生成ファイルを手編集した可能性がある。`git diff` で中身を見る
- **語彙が足りない** — 止めて相談する。同日収集の別品目があれば寄せるか除外で回避できることが多い
