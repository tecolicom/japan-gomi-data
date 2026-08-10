// 武蔵野市「【令和8年度(2026年度)版】ごみと資源の収集カレンダー」の PDF を cache/ へ取得する。
// 入口: https://www.city.musashino.lg.jp/gomi_kankyo/gomi/gomi_shushubi/1053782.html
//   - 収集カレンダー (日付入り通年・A4横7ページ) 2026{a..j}-1.pdf  ※ c と e だけ 2026{c,e}-1-1.pdf
//   - 収集日一覧表 (検証用)                      2026{a..j}-2.pdf
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cachedFetch } from '../../_lib/fetch.mjs';
import { INDEX_URL, BASE, DISTRICTS, CAL_PDF, LIST_PDF } from './sources.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const force = process.argv.includes('--force');

await cachedFetch(INDEX_URL, join(HERE, 'cache', 'index.html'), { encoding: 'utf-8', force });
console.log('fetched: index.html');

for (const d of DISTRICTS) {
  for (const name of [CAL_PDF(d), LIST_PDF(d)]) {
    const buf = await cachedFetch(`${BASE}/${name}`, join(HERE, 'cache', name), { encoding: null, force });
    console.log(`fetched: ${name} (${buf.length} bytes)`);
    await sleep(300);
  }
}
