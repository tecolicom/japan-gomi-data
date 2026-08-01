// 朝霞市: 一次ソース(公式HTML「家庭ごみ収集日一覧表」)と、照合・読み補完用の
// 5374 版 area_days.csv を cache/ に取得する。build.mjs はこの2ファイルを読む。
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
mkdirSync(join(HERE, 'cache'), { recursive: true });

const TARGETS = [
  ['dust-syuusyuu.html', 'https://www.city.asaka.lg.jp/soshiki/15/dust-syuusyuu.html'],
  ['area_days.csv', 'https://raw.githubusercontent.com/publitechasaka/5374/master/data/area_days.csv'],
];

for (const [name, url] of TARGETS) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(join(HERE, 'cache', name), buf);
  console.log(`${name}: ${buf.length} bytes`);
}
console.log('取得完了。次に node fetch-yomi.mjs (ABR) → node build.mjs');
