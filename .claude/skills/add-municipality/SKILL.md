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

3. **その自治体が既に収録済みなら、本書ではなく `docs/playbook.md` §6 に従う。**
   既存データが照合の基準になるので、停止点も承認項目も本書とは別になる。
   **2026-08-21 に skip は 0 になった。** 再び 0 でなくなったら放置しない。

4. `municipalities/<pref>/<handle>/survey.yaml` があれば読む。
   **survey の記述を鵜呑みにしない。** 誤りは 3 件見つかっている。

   | survey の記述 | 実際 |
   |---|---|
   | 青梅「カレンダーは画像で抽出不可」 | 罫線がベクタで、色ベース抽出できた |
   | 三鷹「地区は 11」 | 10 (ABR の 62 町字がちょうど割れる) |
   | 国分寺「品目名が抽出でき機械可読 PDF」 | 品目は 4 種しか取れず、**もやせるごみは 0 件** |

   共通するのは**見た目や文字数で判断して中身を確かめていない**こと。
   国分寺の「11,433 字」も数字自体は正しく、中身が日付と電話番号だった。
   **「◯◯が取れる」と書いてあったら、その語で実際に grep して件数を数える。**

```bash
# 例: 品目名が本当に取れるか (0 件なら図版)
for w in もやせる もやせない 資源 ビン カン ペットボトル 新聞; do
  printf "  %-12s %s\n" "$w" "$(pdftotext <pdf> - | grep -c "$w")"
done
```

## Phase 1: ソース探索 → ここで停止する

`docs/playbook.md` §1 の優先順で探す。テキスト版カレンダー > OD CSV > サイト内 CSV >
HTML 表 > テキスト層 PDF > 画像 PDF。

PDF の方針は次の 1 コマンドで決まる。pdftotext の見た目で決めない。

```bash
python3 -c "
import pdfplumber, sys
pdf = pdfplumber.open(sys.argv[1])
for i, p in enumerate(pdf.pages):
    print(i+1, 'chars', len(p.chars), 'lines', len(p.lines), 'rects', len(p.rects), 'curves', len(p.curves))
" <pdf>
```

`chars` があって罫線もあるなら**まず `find_tables()` を試す** (日高はこれで一発だった)。
`chars` が 0 でも諦めない — 罫線が生きていれば色ベース抽出が効く (飯能・秩父広域・青梅)。
判定表は `docs/playbook.md` §1。

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
| **表として取れる PDF** (`find_tables` が効く) | `tools/pdf-extractor/hidaka/` |
| 罫線のある PDF | `tools/pdf-extractor/musashino/` |
| 文字が図版の PDF (色ベース・四隅座標を埋め込み) | `tools/pdf-extractor/ome/`、`tools/pdf-extractor/chichibu-koiki/` |
| 文字が図版の PDF (色ベース・罫線からグリッド復元) | `tools/pdf-extractor/hanno/` |
| OD CSV | `tools/csv-extractor/iruma/` |

守ること。

- `tools/_lib/` にあるものを再実装しない (`AGENTS.md` の表を見る)
- 実日付から規則を導くときは `_lib/classify.mjs` の `classifyRules()` を使う。
  events は期間を漏れなく覆い、収集なしの日は空配列で渡す
- 未対応の表記は throw する
- **一次ソースの否定表現を肯定と読まない。** 「〜は出せません」の括弧書きは先に切り離してから
  品目名を探す。東秩父村では人がここを読み落として 17 日間ぶん誤配信し、**素直に書いた機械も
  同じ誤りを再現した**。同じ品目が肯定側と否定側の両方に現れたら throw する
- **`python3` を直打ちしない。** `_lib/python.mjs` の `findPython(['pdfplumber','PIL'])` を使う。
  既定の python3 が必要なモジュールを持っているとは限らない
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
- **「不一致 0」と報告する前に、検査が効くことを確かめる。** 抽出結果を 1 日ぶん書き換えて回し、
  差分が出ることを見る。

  **改竄が空振りしていないかを先に見る。3 回踏んでいる。**

  | 空振りの原因 | 実例 |
  |---|---|
  | 生成物に存在しない日付を狙った | 飯能 |
  | BSD `sed` の `0,/re/` が効かない (GNU 拡張) | 飯能の辞典検査 |
  | 単純置換が別の箇所に当たった | 東秩父村 (「第4水曜日」の 1 件目は表でなく本文) |

```bash
# 置換したら「変わったこと」を必ず確認する
python3 -c "
s=open(F).read(); n=s.replace(OLD,NEW,1)
assert n!=s, '改竄が空振り'; open(F,'w').write(n); print('改竄した:',OLD,'->',NEW)"
```

  **「1 件消す」と「1 件足す」の両方向を試す。** 片側しか見ない検査に気づける。
  独立照合ソースが無い自治体では、代わりに「一次ソースの改訂を parse が検出するか」を
  改竄で確かめ、README に一覧で残す (東秩父村 6 通り / 鯖江 5 通り)

## Phase 4: 仕上げ

自分の extractor が `meta.yaml` / `taxonomy.yaml` を生成するか (`build.mjs` を読んで確認する) を
先に決める。生成しないなら、そのファイルは手書きが正典になる (`AGENTS.md` の不変条件を見る)。

1. `meta.yaml` の notes に運用ルール・年末年始・検証・**確率的信頼度**を書く
   (rule of three。N の数え方は `docs/opendata-sources.md`「検証の考え方」§1 を見る)
2. `taxonomy.yaml` は `schema/categories.yaml` の部分集合 + ラベル override
3. `survey.yaml` に「【収録済 YYYY-MM-DD】…」を追記する
4. **ここまでをコミットしてから**通す。`make regen` は build を実際に走らせるので、
   対象自治体に未コミットの変更があると実行を拒否する (作業を壊さないため)。

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
- **`make regen` で差分が出る** — 生成ファイルを手編集した可能性がある。作業ツリーは
  自動で戻されるので、エラーに表示された保存先の差分ファイルを見る (`git diff` では見えない)
- **`make regen` が「未コミットの変更がある」と言う** — 先にコミットするか `git stash` する。
  拒否は正しい動作で、build が作業中の変更を上書きするのを防いでいる
- **語彙が足りない** — 止めて相談する。同日収集の別品目があれば寄せるか除外で回避できることが多い
