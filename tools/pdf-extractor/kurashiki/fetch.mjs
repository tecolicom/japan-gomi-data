// 倉敷市: 一次ソース(地区別PDF 6枚)と検証補助CSV(data eye 2019年度)の取得。
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cachedFetch } from '../../_lib/fetch.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PDFBASE = 'https://www.city.kurashiki.okayama.jp/_res/projects/default_project/_page_/001/003/660';

const SOURCES = [
  // 一次ソース: 各地区収集日一覧ページ配下の地区別PDF
  { url: `${PDFBASE}/kurashiki.pdf`, file: 'kurashiki.pdf' },
  { url: `${PDFBASE}/mizushima.pdf`, file: 'mizushima.pdf' },
  { url: `${PDFBASE}/tamashimafunao.pdf`, file: 'tamashimafunao.pdf' }, // 玉島+船穂
  { url: `${PDFBASE}/kojima.pdf`, file: 'kojima.pdf' },
  { url: `${PDFBASE}/funao.pdf`, file: 'funao.pdf' }, // 船穂(tamashimafunao と重複、検証用)
  { url: `${PDFBASE}/mabi.pdf`, file: 'mabi.pdf' },
  // 検証補助: data eye オープンデータ 平成31年度 地区別収集日 CSV(5374アプリ対応)
  { url: 'https://kurashiki.dataeye.jp/resource_download/4110', file: 'dist_collection_2019.csv' },
];

for (const s of SOURCES) {
  await cachedFetch(s.url, join(HERE, 'cache', s.file), { encoding: null, force: process.argv.includes('--force') });
  console.log('fetched:', s.file);
}
