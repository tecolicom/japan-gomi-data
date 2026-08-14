// 日高市「ごみ収集日程表」(令和8年度) を cache/ へ取得する。
// 全 20 コースが 1 本の PDF に載る (全戸配布のものと同じ版)。
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { cachedFetch } from '../../_lib/fetch.mjs';
import { INDEX_URL, PDF_URL, PDF_FILE, CACHE } from './sources.mjs';

const force = process.argv.includes('--force');

const html = await cachedFetch(INDEX_URL, join(CACHE, 'index.html'), { encoding: 'utf-8', force });
console.log(`fetched: index.html (${html.length} 字)`);

const buf = await cachedFetch(PDF_URL, join(CACHE, PDF_FILE), { encoding: null, force });
const sha = createHash('sha256').update(buf).digest('hex').slice(0, 16);
console.log(`fetched: ${PDF_FILE} (${buf.length} bytes, sha256:${sha})`);
