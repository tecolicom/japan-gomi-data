# japan-gomi-data

日本の自治体の家庭ごみ収集カレンダーを機械可読なオープンデータとして集約するリポジトリ。
**収集日程**(コース×地区、収集ルール)と、それを解釈する**種別定義**を収録する。

- ライセンス: CC BY 4.0(出典を明記すれば自由に利用可)
- 収録範囲: 収集日程 + 種別定義。品目→種別の分別辞書は対象外。
- 自治体キー: `municipalities/<handle>/`(handle は lg.jp ラベル体系。町は `-town` 等)

## 構造
- `schema/` — JSON Schema と全国共通の種別語彙(`categories.yaml`)
- `municipalities/<handle>/` — `meta.yaml` / `taxonomy.yaml` / `<年度>/course-*.yaml`
- `tools/pdf-extractor/` — PDF からの抽出パイプライン

## 検証
`npm ci && npm test` で全データを schema + 語彙 + 相互整合で検証する。

## 出典・免責
各自治体データは公式配布物(PDF 等)由来。原典は各 `course-*.yaml` の `metadata.source` を参照。
機械抽出のため誤りが残りうる。実際のごみ出しは各自治体の公式情報も併せて確認すること。
