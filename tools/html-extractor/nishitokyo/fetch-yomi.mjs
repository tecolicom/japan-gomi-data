// 西東京市の町名 → 読み(yomi)・町字ID(machiaza_id): デジタル庁 ABR 町字マスター東京都版 (pref13) から
// 西東京市 (lg_code 132292) 分を cache/abr-town.json へ。build.mjs が areas の丁目展開・
// yomi 付与・machiaza_id 付与に使う (朝霞・横浜・倉敷と同型)。
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const URL = 'https://data.address-br.digital.go.jp/mt_town_fullset/pref/mt_town_fullset_pref13.csv.zip';
const LG_CODE = '132292'; // 西東京市

mkdirSync(join(HERE, 'cache'), { recursive: true });
const zipPath = join(HERE, 'cache', 'mt_town_fullset_pref13.csv.zip');
const csvPath = join(HERE, 'cache', 'mt_town_fullset_pref13.csv');
if (!existsSync(csvPath) || process.argv.includes('--force')) {
  const res = await fetch(URL);
  if (!res.ok) throw new Error(`ABR fetch: HTTP ${res.status}`);
  writeFileSync(zipPath, Buffer.from(await res.arrayBuffer()));
  execFileSync('unzip', ['-o', '-q', zipPath, '-d', join(HERE, 'cache')]);
}

const csv = readFileSync(csvPath, 'utf8');
const lines = csv.trim().split('\n');
const h = lines[0].split(',');
const col = (n) => h.indexOf(n);
const [iLg, iId, iOaza, iKana, iChNum, iStatus] =
  ['lg_code', 'machiaza_id', 'oaza_cho', 'oaza_cho_kana', 'chome_number', 'status_flg'].map(col);

const kata2hira = (s) => s.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
const byId = new Map(); // ABR は同一町字の重複行を持つので ID で uniq する
for (const line of lines.slice(1)) {
  const c = line.split(',');
  if (c[iLg] !== LG_CODE) continue;
  if (iStatus >= 0 && c[iStatus] === '0') continue; // 廃止町字は除外
  const oaza = c[iOaza];
  if (!oaza) continue;
  if (byId.has(c[iId])) continue;
  byId.set(c[iId], {
    lg: c[iLg], id: c[iId], oaza,
    kana: c[iKana] ? kata2hira(c[iKana]) : null,
    chome_number: c[iChNum] ? Number(c[iChNum]) : null,
  });
}
const towns = [...byId.values()];
writeFileSync(join(HERE, 'cache', 'abr-town.json'), JSON.stringify({ towns }, null, 1));
console.log(`ABR 西東京市 町字 ${towns.length} 件 -> cache/abr-town.json`);
