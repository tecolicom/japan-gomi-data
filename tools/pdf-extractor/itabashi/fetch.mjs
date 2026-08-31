// 板橋区「地域別 資源回収・ごみ収集曜日カレンダー(令和8年度版)」を cache/ へ取得する。
// 入口: https://www.city.itabashi.tokyo.jp/tetsuduki/gomi/kaishu/1038152.html
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cachedFetch } from '../../_lib/fetch.mjs';
import { writeAbrTownJson } from '../../_lib/abr.mjs';
import { INDEX_URL, SORT_URL, AREAS, ABR_PREF, LG_CODE } from './sources.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CACHE = join(HERE, 'cache');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const force = process.argv.includes('--force');

for (const [url, name] of [[INDEX_URL, 'index.html'], [SORT_URL, 'bunbetsu.html']]) {
  await cachedFetch(url, join(CACHE, name), { encoding: 'utf-8', force });
  console.log(`fetched: ${name}`);
  await sleep(300);
}

for (const a of AREAS) {
  const buf = await cachedFetch(a.url, join(CACHE, a.file), { encoding: null, force });
  console.log(`fetched: ${a.file} (${buf.length} bytes) — ${a.nameJa}`);
  await sleep(300);
}

await writeAbrTownJson({ pref: ABR_PREF, lgPrefix: LG_CODE, cacheDir: CACHE, force, label: '板橋区' });
