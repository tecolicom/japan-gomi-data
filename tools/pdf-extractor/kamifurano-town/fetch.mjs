// 上富良野町のコース別ごみ収集カレンダー PDF (5 コース) を cache/ へ取得する。
// 入口: https://www.town.kamifurano.hokkaido.jp/index.php?id=333
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { cachedFetch } from '../../_lib/fetch.mjs';
import { COURSES, CACHE, pdfUrl, pdfFile } from './sources.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const force = process.argv.includes('--force');

for (const c of COURSES) {
  const buf = await cachedFetch(pdfUrl(c), join(CACHE, pdfFile(c)), { encoding: null, force });
  const sha = createHash('sha256').update(buf).digest('hex').slice(0, 16);
  console.log(`fetched: ${pdfFile(c)} (${c.nameJa}, ${buf.length} bytes, sha256:${sha})`);
  await sleep(300);
}
