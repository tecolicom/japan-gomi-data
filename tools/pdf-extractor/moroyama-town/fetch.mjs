// 毛呂山町: 埼玉西部環境保全組合の令和8年度ごみ・資源収集カレンダーPDF(A/B/C地区)を cache/ へ取得。
// extract.py がこれを pdfplumber で座標抽出する。
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
mkdirSync(join(HERE, 'cache'), { recursive: true });

for (const d of ['a', 'b', 'c']) {
  const url = `http://www.hozenkumiai.or.jp/pdf/moroyama2026_${d}.pdf`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${d}: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(join(HERE, 'cache', `moroyama2026_${d}.pdf`), buf);
  console.log(`moroyama2026_${d}.pdf: ${buf.length} bytes`);
}
console.log('取得完了。次に python3 extract.py → node build.mjs');
