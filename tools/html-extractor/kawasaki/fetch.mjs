// 川崎市「収集日一覧」4ページ (全7区) + 照合用の区別カバー PDF 5枚を取得しキャッシュへ保存。
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CACHE = join(HERE, 'cache');

// 収集日一覧 HTML。1ページに区の table が区順で並ぶ (per100)。
const PAGES = [
  { key: 'kawasaki', id: '0000012570' },        // 川崎区
  { key: 'saiwai-nakahara', id: '0000012568' }, // 幸区・中原区
  { key: 'takatsu-miyamae', id: '0000012561' }, // 高津区・宮前区
  { key: 'tama-asao', id: '0000012577' },        // 多摩区・麻生区
];

// 照合用の区別カバー PDF (内容は HTML と同じ曜日一覧。日付入り年間カレンダーは非公開)。
const PDF_BASE = 'https://www.city.kawasaki.jp/300/cmsfiles/contents/0000012';
const PDFS = [
  '12570/kawasaki(R8).pdf',
  '12568/saiwai(R8).pdf',
  '12568/nakahara(8).pdf',
  '12561/takatsumiyamae(R8).pdf',
  '12577/tamaaso(8).pdf',
];

mkdirSync(CACHE, { recursive: true });

for (const { key, id } of PAGES) {
  const res = await fetch(`https://www.city.kawasaki.jp/300/page/${id}.html`);
  if (!res.ok) throw new Error(`${key}: HTTP ${res.status}`);
  writeFileSync(join(CACHE, `${key}.html`), await res.text());
  console.log(`fetched ${key}.html`);
}

for (const p of PDFS) {
  const res = await fetch(`${PDF_BASE}/${p}`);
  if (!res.ok) throw new Error(`${p}: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(join(CACHE, p.split('/')[1]), buf);
  console.log(`fetched ${p.split('/')[1]}`);
}
