// 中野区のごみ収集データ源泉を取得し cache/ へ保存する。
// 1. オープンデータ CSV (東京都カタログ掲載、実体は中野区データマップ wagmap.jp)
// 2. 公式「中野区全域のごみと資源の収集曜日一覧」HTML (CSV 鮮度の照合用)
// 3. 地域別ページ 19 枚を辿り、町丁目別カレンダー PDF R8-<N>.pdf 全 42 枚 (全コース照合用)
//    ※ R8-<N> の N はオープンデータ CSV の NO 列と一致する (2026-07-16 確認)
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CACHE = join(HERE, 'cache');
const CSV_URL = 'https://www2.wagmap.jp/nakanodatamap/nakanodatamap/opendatafile/map_1/CSV/opendata_550239.csv';
const BASE = 'https://www.city.tokyo-nakano.lg.jp/kurashi/gomi/syusyuyobi/';

mkdirSync(CACHE, { recursive: true });

async function fetchTo(url, file, binary = false) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  writeFileSync(join(CACHE, file), binary ? Buffer.from(await res.arrayBuffer()) : await res.text());
  console.log(`fetched ${file}`);
}

await fetchTo(CSV_URL, 'nakano.csv');
await fetchTo(BASE + 'nakanoku.html', 'nakanoku.html');
await fetchTo(BASE + 'ichiran.html', 'ichiran.html');

// 地域別目次から地域ページを辿る
const ichiran = await (await fetch(BASE + 'ichiran.html')).text();
const slugs = [...new Set([...ichiran.matchAll(/\/kurashi\/gomi\/syusyuyobi\/([a-z]+)\.html/g)]
  .map((m) => m[1]).filter((s) => !['index', 'ichiran', 'nakanoku'].includes(s)))];
console.log(`${slugs.length} region pages`);

const seen = new Map(); // R8-N → slug (重複検知)
for (const slug of slugs) {
  const html = await (await fetch(`${BASE}${slug}.html`)).text();
  writeFileSync(join(CACHE, `${slug}.html`), html);
  const pdfs = [...new Set([...html.matchAll(new RegExp(`${slug}\\.files/(R8-\\d+)\\.pdf`, 'g'))].map((m) => m[1]))];
  for (const name of pdfs) {
    if (seen.has(name)) throw new Error(`PDF 名衝突: ${name} (${seen.get(name)} と ${slug})`);
    seen.set(name, slug);
    await fetchTo(`${BASE}${slug}.files/${name}.pdf`, `${name}.pdf`, true);
  }
}
console.log(`${seen.size} PDFs total`);
