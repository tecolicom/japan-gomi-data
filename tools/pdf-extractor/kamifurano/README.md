# 上富良野町 ごみカレンダー抽出

北海道上富良野町の年間ごみ収集カレンダーPDF (令和8年度=2026年度) から
`cities/kamifurano/data/gomi/2026/course-*.yaml` を生成するスクリプト群。

## コース構成 (5コース)

町名で区分。粗大ごみの収集日は全コース共通。

- **市街地3コース** (赤 / 青 / 緑): 生ごみ(週2)を分別収集。空き缶と空きびんは別日。
- **農村2コース** (農村東 / 農村西): 生ごみは分別せず一般ごみへ(自家処理前提)。
  缶・びんは同一日にまとめて収集(グリッド上のラベルは「缶・ビン」)。

対象地区・PDF URL は `cities/kamifurano/data/gomi/sources.yaml` を参照。

## 使い方

```sh
# 1. PDFを取得 (URLは sources.yaml)
BASE=https://www.town.kamifurano.hokkaido.jp/contents/04chomin/0420seikatsu/gomi/calendar
mkdir -p /tmp/kf && cd /tmp/kf
for f in R08_aka R08_ao R08_midori R08_higasi R08_nisi; do
  curl -sSLO "$BASE/$f.pdf"
done

# 2. YAML生成 (要 pdfplumber: pip install pdfplumber、pdftotext=poppler)
cd tools/pdf-extractor/kamifurano
python3 gen_yaml.py /tmp/kf      # cities/kamifurano/data/gomi/2026/ に書き出し
```

## 抽出ロジック

- `extract_kamifurano.py`
  - `extract_calendar()`: カレンダーグリッドを pdfplumber の語座標で解析。
    列アンカー(日〜土の左端x)で列を、top連続性で週行を復元し、各ラベルを直上の
    日付セルに割り当てる。月境界・年末年始の休止・「回収しません」は、グリッドに
    ラベルが無い日として自然に欠落する。
  - `extract_oversized()`: 側枠「粗大ごみの収集日」を pdftotext -layout のテキストから
    抽出 (月ラベルが2つの日付の間に置かれる構造に対応)。
- `gen_yaml.py`
  - 週次カテゴリ(年間>=40回)は `weekly` + `overrides`(cancelled) で、月次ローテーションは
    `monthly_specific`(明示日付) で出力。

## 検証

「生成YAML を rules+overrides で年度全日展開した結果」と「PDF抽出結果」が完全一致する
ことをラウンドトリップで確認済み (全5コース、2026-04-01〜2027-03-31)。
翌年度の更新時は、生成後に同様の突き合わせと、数週間分の目視照合を行うこと。
