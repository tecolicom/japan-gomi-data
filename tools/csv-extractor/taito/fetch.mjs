// 台東区のごみ収集データ源泉を取得し cache/ へ保存する。
// 1. オープンデータ CSV「地域別収集曜日一覧」(Shift_JIS, CC BY 4.0) — 一次ソース
// 2. 公式 HTML 表「収集曜日（全体）」 — 独立検証源 (CSV が令和4年公開のため鮮度ガードに使う)
// 3. 令和8年度「資源とごみ出しカレンダー」案内ページ — 町丁→整理番号 (区公式のコース番号)。
//    第3の独立検証源であり、コース採番の根拠でもある。
// 4. プラスチック案内ページ — 「回収曜日は資源と同じ曜日」の根拠 (令和7年4月〜区内全域)
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CSV_URL, HTML_URL, CALENDAR_URL, PLASTIC_URL } from './urls.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CACHE = join(HERE, 'cache');

mkdirSync(CACHE, { recursive: true });

// CSV は Shift_JIS。TextDecoder('shift_jis') で UTF-8 に正規化して保存する。
async function fetchTo(url, file, encoding = 'utf-8') {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const buf = new Uint8Array(await res.arrayBuffer());
  const text = new TextDecoder(encoding).decode(buf);
  if (text.includes('�')) throw new Error(`${file}: 文字化け (encoding=${encoding} が不正?)`);
  writeFileSync(join(CACHE, file), text);
  console.log(`fetched ${file} (${text.length} chars)`);
}

await fetchTo(CSV_URL, 'taito.csv', 'shift_jis');
await fetchTo(HTML_URL, 'shushubi_zentai.html');
await fetchTo(CALENDAR_URL, 'R8calendar.html');
await fetchTo(PLASTIC_URL, 'plastics.html');
