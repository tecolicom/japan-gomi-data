// 東秩父村「ごみの出し方」ページを cache/ へ取得する。
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { cachedFetch } from '../../_lib/fetch.mjs';
import { SCHEDULE_URL, CACHE } from './sources.mjs';

const force = process.argv.includes('--force');
const html = await cachedFetch(SCHEDULE_URL, join(CACHE, 'gominodashikata.html'),
  { encoding: 'utf-8', force });
const sha = createHash('sha256').update(html).digest('hex').slice(0, 16);
console.log(`fetched: gominodashikata.html (${html.length} 字, sha256:${sha})`);
