// 一次ソースの取得。URL と保存名をここに列挙する。
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cachedFetch } from '../../_lib/fetch.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

const SOURCES = [
  // { url: 'https://…', file: 'schedule.csv', encoding: 'utf-8' }, // cp932 なら 'shift_jis'
];

for (const s of SOURCES) {
  await cachedFetch(s.url, join(HERE, 'cache', s.file), { encoding: null, force: process.argv.includes('--force') });
  console.log('fetched:', s.file);
}
