// 西東京市「ごみ・資源物収集カレンダー(テキスト版)」= 地域別 HTML ページを cache/ に取得する。
// index: https://www.city.nishitokyo.lg.jp/kurasi/gomi_recycle/gomi-calebder/gomicalender_exel/index.html
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cachedFetch } from '../../_lib/fetch.mjs';
import { BASE, AREAS, AREA_URL } from './parse.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const force = process.argv.includes('--force');

for (const n of AREAS) {
  const html = await cachedFetch(AREA_URL(n), join(HERE, 'cache', `${n}.html`), { encoding: 'utf-8', force });
  console.log(`fetched: ${n}.html (${html.length} 字)`);
}
await cachedFetch(`${BASE}/index.html`, join(HERE, 'cache', 'index.html'), { encoding: 'utf-8', force });
console.log('fetched: index.html');
