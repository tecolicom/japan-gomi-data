// 豊島区「資源回収・ごみ収集曜日一覧」の一次ソースと照合用ソースを cache/ へ取得する。
// 入口: https://www.city.toshima.lg.jp/gomi-fl/foreignlanguage.html (外国語版の配布ページ)
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cachedFetch } from '../../_lib/fetch.mjs';
import { writeAbrTownJson } from '../../_lib/abr.mjs';
import { LANDING_URL, YEAREND_PAGE_URL, PRIMARY, CROSS_LANG, BOOKLET, ABR_PREF, LG_CODE } from './sources.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CACHE = join(HERE, 'cache');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const force = process.argv.includes('--force');

for (const [url, name] of [[LANDING_URL, 'foreignlanguage.html'], [YEAREND_PAGE_URL, 'yearend.html']]) {
  await cachedFetch(url, join(CACHE, name), { encoding: 'utf-8', force });
  console.log(`fetched: ${name}`);
  await sleep(300);
}

for (const s of [PRIMARY, ...CROSS_LANG, BOOKLET]) {
  const buf = await cachedFetch(s.url, join(CACHE, s.file), { encoding: null, force });
  console.log(`fetched: ${s.file} (${buf.length} bytes) — ${s.label}`);
  await sleep(300);
}

await writeAbrTownJson({ pref: ABR_PREF, lgPrefix: LG_CODE, cacheDir: CACHE, force, label: '豊島区' });
