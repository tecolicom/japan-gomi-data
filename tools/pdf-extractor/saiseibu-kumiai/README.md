# 埼玉西部環境保全組合 (鶴ヶ島市・毛呂山町・鳩山町・越生町) ごみ・資源収集日 抽出

1市3町のごみ処理を担う一部事務組合「埼玉西部環境保全組合」(hozenkumiai.or.jp)が発行する
**日付入りカレンダーPDF**から、4自治体を1つの共通ツールで抽出する。各自治体・地区は同一レイアウト。

## 対象 (config.json)

| handle | 自治体 | 地区 | PDF接頭辞 |
|---|---|---|---|
| `tsurugashima` | 鶴ヶ島市 | a/b/c/d | tsurugashima |
| `moroyama-town` | 毛呂山町 | a/b/c | moroyama |
| `ogose-town` | 越生町 | a/b | ogose |
| `hatoyama-town` | 鳩山町 | a/b | hatoyama |

## 実行手順

```
node fetch.mjs [handle]                    # handle 省略で全自治体の PDF を cache/ へ
python3 extract.py <handle>                # pdfplumber で日付グリッド座標抽出 → cache/<handle>-records.json
EXTRACTED_AT=YYYY-MM-DD node build.mjs <handle>   # municipalities/saitama/<handle>/2026/ を生成
```

## 収集体系 (正典カテゴリ)

- 可燃 = `burnable` / 不燃 = `non_burnable` / 他プラ(その他容器包装プラ) = `plastic`
- びん缶(びん・かん類 同日) = `glass_bottle` + `beverage_can`
- 有害 = `hazardous` / 紙布(紙・布類 同日) = `paper` + `cloth` / ペット = `pet_bottle`

## 抽出のしくみ

**extract.py** — 1ページに12ヶ月(3列4段)。段(top)×固定列(842÷3)で月ブロックを切り、各月グリッドの
日付数字の直下(同じ曜日列・48pt以内)の品目略称を対応づける。割当は **x差(曜日列)を優先**し、同x差なら
top 最近(隣接曜日への誤配置を防ぐ)。紙・布類は「紙」「布」の2 word で入るため「紙」で代表。

**build.mjs** — 各品目の実収集日から曜日+第n パターンを導出。ある曜日が第1〜5をほぼ揃える(≥4種)なら
`weekly`、特定第n のみなら `monthly_nth`、出現8回未満の少数曜日は抽出ノイズとして除外。パターンで
令和8年度の全収集日を再生成し実日付と突合、パターンにあり実に無い日(年末年始休止)は `overrides` に
cancelled 記録、実にあってパターンに無い日は各自治体とも0件(完全再現)。

## 地区について

収集は地区(A/B/…)単位で、地区ごとに曜日が異なる。地区に含まれる町名・大字の対応表は各自治体・組合とも
非公開(カレンダーPDF内の地図のみ)のため、areas は地区名のみ。住民は配布された自地区のカレンダーで判断。

## 検証

build.mjs のパターン再展開↔実日付の突合が自己検証を兼ねる(倉敷と同型)。4自治体・全地区とも実にあって
パターンに無い日0件、逸脱は年末年始休止のみ。日付入り年間カレンダーが一次ソースなので日付レベルまで一致。

祝日は4自治体とも通常収集(振替なし)のため rules で表現でき、override は年末年始の休止に限られる。
