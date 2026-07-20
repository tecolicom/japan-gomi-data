// 横浜市「ごみと資源の収集曜日」区別ページ (18区・五十音別サブページ) を取得しキャッシュへ保存。
// 区 index からサブページ URL を発見する方式 (サブページ名は区ごとに不規則: a-e / kagyou / naka-youbi-wa 等)。
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WARDS, BASE } from './wards.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CACHE = join(HERE, 'cache');
mkdirSync(CACHE, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.text();
}

let total = 0;
for (const { romaji } of WARDS) {
  const index = await get(`${BASE}/${romaji}/index.html`);
  writeFileSync(join(CACHE, `${romaji}__index.html`), index);
  const subs = [...new Set(
    [...index.matchAll(new RegExp(`href="[^"]*?shushuyobi/${romaji}/([a-z0-9-]+)\\.html"`, 'g'))]
      .map((m) => m[1]).filter((s) => s !== 'index'),
  )].sort();
  if (!subs.length) throw new Error(`${romaji}: サブページが見つからない`);
  for (const sub of subs) {
    await sleep(200);
    writeFileSync(join(CACHE, `${romaji}__${sub}.html`), await get(`${BASE}/${romaji}/${sub}.html`));
    total++;
  }
  console.log(`${romaji}: ${subs.length} pages`);
  await sleep(200);
}
console.log(`fetched ${total} subpages (18 wards)`);
