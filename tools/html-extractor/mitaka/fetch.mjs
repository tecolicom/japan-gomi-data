// 三鷹市「収集日程」の地区別ページを cache/ へ取得する。
// 索引ページから「令和8年度 …」のリンクを拾い、その先の地区別 HTML を全部取る。
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cachedFetch } from '../../_lib/fetch.mjs';
import { INDEX_URL, BASE, CACHE, EDITION_JA } from './sources.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const force = process.argv.includes('--force');

const index = await cachedFetch(INDEX_URL, join(CACHE, 'index.html'), { encoding: 'utf-8', force });
console.log(`fetched: index.html (${index.length} 字)`);

// 「令和8年度　<地区名>」のリンクだけを拾う。全地区共通ページ (c_service/101) は日程を持たない
const districts = [];
for (const m of index.matchAll(/<a[^>]+href="(\/c_service\/095\/(\d+)\.html)"[^>]*>(.*?)<\/a>/gs)) {
  const label = m[3].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
  if (!label.startsWith(EDITION_JA)) continue;
  districts.push({ id: m[2], url: BASE + m[1], name: label.slice(EDITION_JA.length).trim() });
}
if (!districts.length) throw new Error('索引から地区別ページが 1 件も拾えない (ページ構成が変わった可能性)');

for (const d of districts) {
  const html = await cachedFetch(d.url, join(CACHE, `district-${d.id}.html`), { encoding: 'utf-8', force });
  console.log(`fetched: district-${d.id}.html  ${d.name} (${html.length} 字)`);
  await sleep(300);
}

writeFileSync(join(CACHE, 'districts.json'), JSON.stringify({ districts }, null, 1));
console.log(`\n地区 ${districts.length} 件 -> cache/districts.json`);
