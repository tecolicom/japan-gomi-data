// 入間市: 一次ソース(県OD CSV)と検証ソース(市 分け出し表 PDF)を cache/ へ取得。
// CSV は cp932 のまま保存 (build 側で TextDecoder('shift_jis') する)。
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cachedFetch } from '../../_lib/fetch.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const force = process.argv.includes('--force');

const targets = [
  ['https://opendata.pref.saitama.lg.jp/resource_download/1494', join(HERE, 'cache', 'iruma.csv')],
  ['https://www.city.iruma.saitama.jp/material/files/group/21/R8wakedasihyou.pdf', join(HERE, 'verify', 'R8wakedasihyou.pdf')],
];
for (const [url, path] of targets) {
  await cachedFetch(url, path, { encoding: null, force }); // Buffer 保存 (エンコーディング変換しない)
  console.log(`fetched ${url} -> ${path}`);
}
