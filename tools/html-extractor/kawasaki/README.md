# 川崎市 HTML 抽出

川崎市公式「収集日一覧」(全7区・4ページ) から収集日程を抽出する。**政令市初収録**のため、コースを区ごとにグルーピングし course slug を `<区romaji>-<n>` とする。

## 手順
1. `node fetch.mjs` — 公式4ページ + 照合用カバー PDF 5枚を cache/ に取得。
2. `node --test parse.test.mjs` — パース純粋関数のテスト。
3. `node build.mjs` — cache/ から municipalities/kanagawa/kawasaki/2026/ を生成 (course-<区>-<n>.yaml)。
4. リポジトリ root で `npm test` / `npm run build:ics` で検証。

## 区とファイル

| ページ | 区 (table 順) | romaji |
| --- | --- | --- |
| 0000012570 | 川崎区 | kawasaki |
| 0000012568 | 幸区 / 中原区 | saiwai / nakahara |
| 0000012561 | 高津区 / 宮前区 | takatsu / miyamae |
| 0000012577 | 多摩区 / 麻生区 | tama / asao |

## 種別対応 (公式列 → 正典カテゴリ)
- 普通ごみ (週2) → `burnable` (label 普通ごみ)
- 空き缶・ペットボトル・空きびん・使用済み乾電池 (週1同日) → `beverage_can`+`pet_bottle`+`glass_bottle`+`hazardous` (同日、YAMLアンカーで共有)
- ミックスペーパー (週1) → `paper` (label ミックスペーパー)
- プラスチック資源 (週1) → `plastic` (label プラスチック資源)
- 粗大ごみ・小物金属 (第n・n回目 曜) → `metal` (label 小物金属、monthly_nth)。粗大ごみは事前申込制のため rules に入れず、小物金属と同日である旨を meta notes に記載。

## メモ
- **yomi は公式表の五十音マーカ (col0 の初字)** を前方補完して付与。町名の完全な読みは市が公開しておらず、推測で付すと誤りが混入するため初字のみとする (areas は公式表の掲載順=五十音順を保持)。
- 区をまたぐ同名町名は `梶ヶ谷（高津区）` のように区名で曖昧性解消 (2026年度は梶ヶ谷=高津区/宮前区の1件のみ)。
- cache/*.pdf は照合用の区別カバー PDF (曜日一覧。日付入り年間カレンダーは非公開のためデータには入れない)。
- 年末年始: 休みは日曜と 1/1〜1/3 (12/31 は収集)。overrides には 1/1〜1/3 のうち収集日に当たる日のみ反映。小物金属・粗大は別ルール (年により変動・12月確定) のため notes 参照。
