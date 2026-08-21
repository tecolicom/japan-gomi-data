// 鯖江市の一次ソース 3 点を cache/ へ取得する。
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { cachedFetch } from '../../_lib/fetch.mjs';
import { SCHEDULE_CSV, YEAREND_PDF, HOLIDAY_CSV, CACHE, FILES } from './sources.mjs';

const force = process.argv.includes('--force');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

for (const [url, file, enc] of [
  [SCHEDULE_CSV, FILES.schedule, null],
  [HOLIDAY_CSV, FILES.holiday, null],
  [YEAREND_PDF, FILES.yearend, null],
]) {
  const buf = await cachedFetch(url, join(CACHE, file), { encoding: enc, force });
  const sha = createHash('sha256').update(buf).digest('hex').slice(0, 16);
  console.log(`fetched: ${file} (${buf.length} bytes, sha256:${sha})`);
  await sleep(300);
}
