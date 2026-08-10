// 青梅市「令和8年度版 資源物・ごみ収集カレンダー」(2026年4月〜2027年3月) を cache/ へ取得する。
// 入口: https://www.city.ome.tokyo.jp/soshiki/23/1182.html
// 市サイトは町名 × 日程(A〜H) の表で PDF を貼っており、同じ日程でも町ごとに別の
// attachment ID になっている。日程あたり 1 本を代表として取り、同一日程の別 ID が
// 本当に同一内容かを --check-dup で確認できるようにしてある。
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cachedFetch } from '../../_lib/fetch.mjs';
import { INDEX_URL, SCHEDULES, CAL_URL, CAL_FILE } from './sources.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const force = process.argv.includes('--force');

const html = await cachedFetch(INDEX_URL, join(HERE, 'cache', 'index.html'), { encoding: 'utf-8', force });
console.log(`fetched: index.html (${html.length} 字)`);

const hashes = {};
for (const [d, id] of Object.entries(SCHEDULES)) {
  const buf = await cachedFetch(CAL_URL(id), join(HERE, 'cache', CAL_FILE(d)), { encoding: null, force });
  hashes[d] = createHash('sha256').update(buf).digest('hex').slice(0, 16);
  console.log(`fetched: ${CAL_FILE(d)} <- ${id}.pdf (${buf.length} bytes, sha256:${hashes[d]})`);
  await sleep(300);
}

// 同一日程に割り当てられた別 ID が本当に同じ PDF かを抜き取りで確認する
if (process.argv.includes('--check-dup')) {
  const alt = { A: '77613', B: '77622', C: '77612', D: '77620', F: '77672', G: '77624' };
  for (const [d, id] of Object.entries(alt)) {
    const buf = await cachedFetch(CAL_URL(id), join(HERE, 'cache', `dup-${d}-${id}.pdf`), { encoding: null, force });
    const h = createHash('sha256').update(buf).digest('hex').slice(0, 16);
    console.log(`${d}日程 別ID ${id}: sha256:${h} ${h === hashes[d] ? '一致' : '★不一致'}`);
    await sleep(300);
  }
}
