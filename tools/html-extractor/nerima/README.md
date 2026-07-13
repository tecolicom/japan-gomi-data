# 練馬区 HTML 抽出

練馬区「地域別収集曜日一覧」(50音順7ページ)から収集日程を抽出する。

## 手順
1. `node fetch.mjs` — 公式7ページ+index を cache/ に取得。
2. `node --test parse.test.mjs` — パース純粋関数のテスト。
3. `node build.mjs` — cache/ + yomi.yaml から municipalities/tokyo/nerima/ を生成。
4. リポジトリ root で `npm test` / `npm run build:ics` で検証。

## メモ
- yomi.yaml は町名→読みの手当て表(要人手レビュー)。
- 各行8列目の PDF は地域別カレンダー(エッジ照合用、データには入れない)。
