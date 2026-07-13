// 練馬区「地域別収集曜日一覧」7ページ + index を取得しキャッシュへ保存。
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = 'https://www.city.nerima.tokyo.jp/kurashi/gomi/wakekata/ichiran/';
const PAGES = ['a', 'ka', 'sa', 'ta', 'na', 'ha', 'maya'];
const CACHE = join(HERE, 'cache');

mkdirSync(CACHE, { recursive: true });
for (const key of [...PAGES.map((p) => `${p}_gyochiiki`), 'index']) {
  const res = await fetch(BASE + `${key}.html`);
  if (!res.ok) throw new Error(`${key}: HTTP ${res.status}`);
  writeFileSync(join(CACHE, `${key}.html`), await res.text());
  console.log(`fetched ${key}.html`);
}
