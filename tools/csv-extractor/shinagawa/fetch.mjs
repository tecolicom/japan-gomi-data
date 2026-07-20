// 品川区のごみ収集データ源泉を取得し cache/ へ保存する。
// jig.jp ODP (オープンデータプラットフォーム) が同一データを 2 表現で配信している:
//   1. gomisyusyubi.csv — 縦持ち CSV (cp932)。1 行 = 分類 × 地区。日程は日本語ラベル ("第2木・第4木")。
//   2. gomisyusyubi.rdf — RDF/XML (UTF-8)。日程は ODP 語彙の URI (#SecondThursday 等) で意味づけ。
// 日本語ラベル経由 (CSV) と URI 経由 (RDF) は表現も解析経路も独立なため、
// build.mjs が両者を突合して抽出の健全性を検証する (parse-rdf.mjs は rdfs:label を読まない)。
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cachedFetch } from '../../_lib/fetch.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CACHE = join(HERE, 'cache');

export const CSV_URL = 'http://www.city.shinagawa.tokyo.jp/ct/other000081600/gomisyusyubi.csv';
export const RDF_URL = 'http://www.city.shinagawa.tokyo.jp/ct/other000081600/gomisyusyubi.rdf';
export const CSV_PATH = join(CACHE, 'gomisyusyubi.csv');
export const RDF_PATH = join(CACHE, 'gomisyusyubi.rdf');

// 3 つめの独立ソース: 区公式「ごみ・資源収集日一覧」HTML (五十音別 7 ページ)。
// ODP データセットは dcterms:modified 2015-06-03 と古いため、現行公式表との
// 突合が鮮度ガードになる (実際に 1 件の ODP 側誤りをこれで検出した。README 参照)。
export const HTML_BASE = 'https://www.city.shinagawa.tokyo.jp/PC/kankyo/kankyo-gomi/gomi-kateigomi/wastedayslist/';
export const HTML_PAGES = ['list_a', 'list_ka', 'list_ta', 'list_na', 'list_ha', 'list_ma', 'list_ya'];

// CSV は cp932、RDF・HTML は UTF-8。
export const loadCsv = (force = false) => cachedFetch(CSV_URL, CSV_PATH, { encoding: 'shift_jis', force });
export const loadRdf = (force = false) => cachedFetch(RDF_URL, RDF_PATH, { encoding: 'utf-8', force });
export const loadHtmlPages = async (force = false) => {
  const out = [];
  for (const name of HTML_PAGES) {
    out.push({ name, html: await cachedFetch(`${HTML_BASE}${name}.html`, join(CACHE, `${name}.html`), { force }) });
  }
  return out;
};

if (import.meta.url === `file://${process.argv[1]}`) {
  const force = process.argv.includes('--force');
  const csv = await loadCsv(force);
  const rdf = await loadRdf(force);
  const pages = await loadHtmlPages(force);
  console.log(`csv: ${csv.length} chars → ${CSV_PATH}`);
  console.log(`rdf: ${rdf.length} chars → ${RDF_PATH}`);
  console.log(`html: ${pages.length} pages → cache/list_*.html`);
}
