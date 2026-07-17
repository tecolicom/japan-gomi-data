// 調布市ごみリサイクルカレンダー(令和8年度版)のテキスト版を cache/ に取得する。
// 一次ソース: 市公式サイトの地区別テキストカレンダー(通常ページ・標準著作権)。
// index: https://www.city.chofu.lg.jp/070030/p041249.html
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CACHE = join(HERE, 'cache');
const BASE = 'https://www.city.chofu.lg.jp/documents/16365';

// 地区別(日付入り通年カレンダー) + 共通(分別ルール・年末年始等)
const FILES = {
  'r8calendar_no1.txt': `${BASE}/r8calendar_no1.txt`,
  'r8calendar_no2.txt': `${BASE}/r8calendar_no2.txt`,
  'r8calendar_no3.txt': `${BASE}/r8calendar_no3.txt`,
  'r8calendar_no4.txt': `${BASE}/r8calendar_no4.txt`,
  'r8calendar_common.txt': `${BASE}/r8calendar_p2_p3_p10~p28.txt`,
};

mkdirSync(CACHE, { recursive: true });
for (const [name, url] of Object.entries(FILES)) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch ${url} -> ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(join(CACHE, name), buf);
  console.log(`saved ${name} (${buf.length} bytes)`);
}
console.log('done. next: node build.mjs');
