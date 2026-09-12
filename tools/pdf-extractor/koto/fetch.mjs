// 江東区「令和8年度版 地区別 資源回収・ごみ収集日一覧」と都カタログ CSV を cache/ へ取得する。
// 入口: https://www.city.koto.lg.jp/388010/kurashi/gomi/kate/43735.html
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cachedFetch } from '../../_lib/fetch.mjs';
import { writeAbrTownJson } from '../../_lib/abr.mjs';
import { INDEX_URL, SORT_URL, CSV_URL, SHEETS, SHEET_JA, ABR_PREF, LG_CODE } from './sources.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CACHE = join(HERE, 'cache');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const force = process.argv.includes('--force');

for (const [url, name] of [[INDEX_URL, 'index.html'], [SORT_URL, 'sigen.html']]) {
  await cachedFetch(url, join(CACHE, name), { encoding: 'utf-8', force });
  console.log(`fetched: ${name}`);
  await sleep(300);
}

// 都カタログの CSV は cp932
await cachedFetch(CSV_URL, join(CACHE, 'collectionday.csv'), { encoding: 'shift_jis', force });
console.log('fetched: collectionday.csv');
await sleep(300);

for (const s of [...SHEETS, SHEET_JA]) {
  const buf = await cachedFetch(s.url, join(CACHE, s.file), { encoding: null, force });
  console.log(`fetched: ${s.file} (${buf.length} bytes) — ${s.label}`);
  await sleep(300);
}

await writeAbrTownJson({ pref: ABR_PREF, lgPrefix: LG_CODE, cacheDir: CACHE, force, label: '江東区' });
