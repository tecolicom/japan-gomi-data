// 横浜市の町名 → 読み(yomi)・町字ID(machiaza_id) ソース取得。
// デジタル庁 ABR 町字マスター(フルセット)神奈川県版から横浜市 18 区分を cache/abr-town.json へ。
// build.mjs が areas[].yomi / machiaza_id 付与に使う (岡山・倉敷と同型)。
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const URL = 'https://data.address-br.digital.go.jp/mt_town_fullset/pref/mt_town_fullset_pref14.csv.zip';

const res = await fetch(URL);
if (!res.ok) throw new Error(`ABR fetch: HTTP ${res.status}`);
mkdirSync(join(HERE, 'cache'), { recursive: true });
const zipPath = join(HERE, 'cache', 'mt_town_fullset_pref14.csv.zip');
writeFileSync(zipPath, Buffer.from(await res.arrayBuffer()));
execFileSync('unzip', ['-o', '-q', zipPath, '-d', join(HERE, 'cache')]);

const csv = readFileSync(join(HERE, 'cache', 'mt_town_fullset_pref14.csv'), 'utf8');
const lines = csv.trim().split('\n');
const h = lines[0].split(',');
const col = (n) => h.indexOf(n);
const [iLg, iId, iWard, iOaza, iKana, iChNum, iStatus] =
  ['lg_code', 'machiaza_id', 'ward', 'oaza_cho', 'oaza_cho_kana', 'chome_number', 'status_flg'].map(col);

const kata2hira = (s) => s.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
const towns = [];
for (const line of lines.slice(1)) {
  const c = line.split(',');
  if (!c[iLg] || !c[iLg].startsWith('1410')) continue; // 横浜市 18 区
  if (iStatus >= 0 && c[iStatus] === '0') continue; // 廃止町字は除外
  const oaza = c[iOaza];
  if (!oaza) continue;
  towns.push({
    lg: c[iLg], id: c[iId], ward: c[iWard], oaza,
    kana: c[iKana] ? kata2hira(c[iKana]) : null,
    chome_number: c[iChNum] ? Number(c[iChNum]) : null,
  });
}
writeFileSync(join(HERE, 'cache', 'abr-town.json'), JSON.stringify({ towns }, null, 1));
console.log(`ABR 横浜市 町字 ${towns.length} 行 -> cache/abr-town.json`);
