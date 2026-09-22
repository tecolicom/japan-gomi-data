// 西東京市「ごみ・資源物収集カレンダー(テキスト版)」= 地域別 HTML ページを cache/ に取得する。
// index: https://www.city.nishitokyo.lg.jp/kurasi/gomi_recycle/gomi-calebder/gomicalender_exel/index.html
//
// **index に新旧の版が併記される**ので、EDITIONS に並べた版をすべて取る。
// 地域ページの URL は版ごとに命名が変わり不規則なので、index のリンク文言から発見する。
//
// 照合用に冊子版 PDF も取る。**テキスト層がある版だけ** (bookletText: true)。
// 無い版は画像なので落としても読めず、verify.mjs の目視転記で照合している。
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cachedFetch } from '../../_lib/fetch.mjs';
import {
  INDEX_URL, CALENDAR_INDEX_URL, EDITIONS, AREAS,
  discoverAreaUrls, discoverBookletPage, discoverBookletPdfs,
} from './parse.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CACHE = join(HERE, 'cache');
const force = process.argv.includes('--force');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// index は毎回取り直す (新しい版が載ったかをここで知る)
const index = await cachedFetch(INDEX_URL, join(CACHE, 'index.html'), { encoding: 'utf-8', force: true });
console.log(`fetched: index.html (${index.length} 字)`);

for (const e of EDITIONS) {
  const urls = discoverAreaUrls(index, e.titleEra);
  for (const n of AREAS) {
    const html = await cachedFetch(urls.get(n), join(CACHE, e.period, `${n}.html`), { encoding: 'utf-8', force });
    console.log(`fetched: ${e.period}/${n}.html (${html.length} 字) ${urls.get(n).split('/').pop()}`);
    await sleep(200);
  }
}

// ---- 照合用の冊子版 PDF ----

const calIndex = await cachedFetch(CALENDAR_INDEX_URL, join(CACHE, 'calendar-index.html'),
  { encoding: 'utf-8', force: true });
console.log(`fetched: calendar-index.html (${calIndex.length} 字)`);

for (const e of EDITIONS) {
  const page = discoverBookletPage(calIndex, e.bookletEra);
  if (!e.bookletText) {
    console.log(`skip: ${e.period} の冊子 PDF はテキスト層が無い (画像)。${page}`);
    continue;
  }
  const html = await cachedFetch(page, join(CACHE, e.period, 'booklet-index.html'), { encoding: 'utf-8', force: true });
  const pdfs = discoverBookletPdfs(html, page);
  for (const n of AREAS) {
    const buf = await cachedFetch(pdfs.get(n), join(CACHE, e.period, `booklet-${n}.pdf`), { encoding: null, force });
    console.log(`fetched: ${e.period}/booklet-${n}.pdf (${(buf.length / 1024 / 1024).toFixed(1)} MB) ${pdfs.get(n).split('/').pop()}`);
    await sleep(200);
  }
}
