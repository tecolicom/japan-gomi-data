// 飯能市のコース別ごみ収集カレンダー PDF (6 コース) を cache/ へ取得する。
// 入口: https://www.city.hanno.lg.jp/soshikikarasagasu/kankyokeizaibu/cleancenter/4/893.html
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { cachedFetch } from '../../_lib/fetch.mjs';
import { INDEX_URL, PDF_URL, PDF_FILE, COURSES, CACHE } from './sources.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const force = process.argv.includes('--force');

const html = await cachedFetch(INDEX_URL, join(CACHE, 'index.html'), { encoding: 'utf-8', force });
console.log(`fetched: index.html (${html.length} 字)`);

for (const { course, slug } of COURSES) {
  const buf = await cachedFetch(PDF_URL(slug), join(CACHE, PDF_FILE(slug)), { encoding: null, force });
  const sha = createHash('sha256').update(buf).digest('hex').slice(0, 16);
  console.log(`fetched: ${PDF_FILE(slug)} (${course}, ${buf.length} bytes, sha256:${sha})`);
  await sleep(300);
}
