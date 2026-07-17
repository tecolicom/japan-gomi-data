// 杉並区のごみ収集データ源泉を取得し cache/ へ保存する。
// 1. 区公式サイトの収集曜日検索を駆動する CSV (garbage.csv、OD 宣言なし・UTF-8 BOM 付き)
// 2. 地域別「ごみ・資源の収集カレンダー」PDF 全 28 枚 (/shared/garbage/<N>.pdf, N=1〜28、
//    日付入り月間カレンダー 2026年度版。CSV の pdf_url がこの N を指す)。全コース照合用。
// 3. 全地域版冊子 (t2026zentiiki.pdf, 約18MB)。P.21「収集曜日一覧」を CSV と突き合わせる補助照合用。
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CACHE = join(HERE, 'cache');
const CSV_URL = 'https://www.city.suginami.tokyo.jp/documents/12125/garbage.csv';
const PDF_BASE = 'https://www.city.suginami.tokyo.jp/shared/garbage/';
const BOOKLET_URL = 'https://www.city.suginami.tokyo.jp/documents/715/t2026zentiiki.pdf';
const PDF_COUNT = 28;

mkdirSync(CACHE, { recursive: true });

async function fetchTo(url, file, binary = false) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  writeFileSync(join(CACHE, file), binary ? Buffer.from(await res.arrayBuffer()) : await res.text());
  console.log(`fetched ${file}`);
}

await fetchTo(CSV_URL, 'suginami.csv');
for (let n = 1; n <= PDF_COUNT; n++) {
  await fetchTo(`${PDF_BASE}${n}.pdf`, `${n}.pdf`, true);
}
await fetchTo(BOOKLET_URL, 't2026zentiiki.pdf', true);
console.log(`done: CSV + ${PDF_COUNT} calendar PDFs + booklet`);
