// 世田谷区のごみ収集データ源泉を取得し cache/ へ保存する。
// 1. オープンデータ CSV「資源・ごみ収集曜日一覧」(Shift-JIS, CC BY 4.0) … 一次ソース
// 2. 配布ページ 416.html … 同じ内容の HTML 表 (CSV との全行突合に使う)
// 3. カレンダー配布ページ 27859.html … 町丁目 → 対象地区 PDF (no<N>.pdf) の対応表
// 4. 町丁目別「資源とごみの収集カレンダー」PDF no1〜no41 + 共通部 all.pdf … 日付レベルの検証源
//    ※ no1〜no37 が CSV 118 行の全町丁目を覆い、no38〜no41 は大規模集合住宅 (CSV 対象外)
import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cachedFetch } from '../../_lib/fetch.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CACHE = join(HERE, 'cache');
export const CSV_URL = 'https://www.city.setagaya.lg.jp/documents/416/27-08-26.csv';
export const LIST_URL = 'https://www.city.setagaya.lg.jp/02241/416.html';
export const CAL_URL = 'https://www.city.setagaya.lg.jp/02241/27859.html';
export const PDF_BASE = 'https://www.city.setagaya.lg.jp/documents/27859/';
export const SUMMARY_PDF_URL = 'https://www.city.setagaya.lg.jp/documents/416/syusyubi.pdf';

export async function fetchAll({ force = false } = {}) {
  mkdirSync(CACHE, { recursive: true });

  // CSV は Shift-JIS
  await cachedFetch(CSV_URL, join(CACHE, 'setagaya.csv'), { encoding: null, force });
  await cachedFetch(LIST_URL, join(CACHE, 'page416.html'), { force });
  await cachedFetch(CAL_URL, join(CACHE, 'page27859.html'), { force });
  console.log('fetched CSV + 416.html + 27859.html');

  // 一覧 PDF (画像 PDF。テキスト層は 27 文字しかなく機械照合には使えないが、配布物の控えとして取得)
  await cachedFetch(SUMMARY_PDF_URL, join(CACHE, 'syusyubi.pdf'), { encoding: null, force });

  // 町丁目別カレンダー PDF (no1〜no41) と共通部
  for (let n = 1; n <= 41; n++) {
    await cachedFetch(`${PDF_BASE}no${n}.pdf`, join(CACHE, `no${n}.pdf`), { encoding: null, force });
  }
  await cachedFetch(`${PDF_BASE}all.pdf`, join(CACHE, 'all.pdf'), { encoding: null, force });
  console.log('fetched 41 calendar PDFs + all.pdf');
}

// 直接実行されたときだけ取得する (build.mjs は URL 定数のみを import する)
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await fetchAll({ force: process.argv.includes('--force') });
}
