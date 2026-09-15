// 中央区「あなたの町のごみ・資源収集曜日」と照合用パンフレットを cache/ へ取得する。
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cachedFetch } from '../../_lib/fetch.mjs';
import { writeAbrTownJson } from '../../_lib/abr.mjs';
import { INDEX_URL, SORT_URL, PAMPHLET_URL, PAMPHLETS, ABR_PREF, LG_CODE } from './sources.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CACHE = join(HERE, 'cache');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const force = process.argv.includes('--force');

for (const [url, name] of [[INDEX_URL, 'youbi.html'], [SORT_URL, 'shigen.html'], [PAMPHLET_URL, 'pamphlet.html']]) {
  await cachedFetch(url, join(CACHE, name), { encoding: 'utf-8', force });
  console.log(`fetched: ${name}`);
  await sleep(300);
}

for (const p of PAMPHLETS) {
  const buf = await cachedFetch(p.url, join(CACHE, p.file), { encoding: null, force });
  console.log(`fetched: ${p.file} (${buf.length} bytes) — ${p.label}`);
  await sleep(500);
}

await writeAbrTownJson({ pref: ABR_PREF, lgPrefix: LG_CODE, cacheDir: CACHE, force, label: '中央区' });
