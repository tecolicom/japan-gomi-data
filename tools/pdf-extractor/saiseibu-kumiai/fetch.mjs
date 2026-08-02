// 埼玉西部環境保全組合: 4自治体(鶴ヶ島市・毛呂山町・鳩山町・越生町)の令和8年度カレンダーPDFを
// cache/<handle>2026_<地区>.pdf として取得する。config.json の file/districts を使う。
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CONF = JSON.parse(readFileSync(join(HERE, 'config.json'), 'utf8'));
mkdirSync(join(HERE, 'cache'), { recursive: true });

const only = process.argv[2]; // 省略時は全自治体
for (const [handle, c] of Object.entries(CONF)) {
  if (handle.startsWith('_') || (only && handle !== only)) continue;
  for (const d of c.districts) {
    const url = `http://www.hozenkumiai.or.jp/pdf/${c.file}2026_${d}.pdf`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${handle}/${d}: HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    writeFileSync(join(HERE, 'cache', `${handle}2026_${d}.pdf`), buf);
    console.log(`${handle}2026_${d}.pdf: ${buf.length} bytes`);
  }
}
