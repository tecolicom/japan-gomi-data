// 朝霞市の町名 → 読み(yomi)・町字ID(machiaza_id): デジタル庁 ABR 町字マスター埼玉県版 (pref11) から
// 朝霞市 (lg_code 11227*) 分を cache/abr-town.json へ。build.mjs が areas[].machiaza_id 付与と
// yomi 補完に使う (横浜・倉敷と同型)。朝霞は 5374 CSV 側に yomi があるため ken_all 補完は不要。
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const URL = 'https://data.address-br.digital.go.jp/mt_town_fullset/pref/mt_town_fullset_pref11.csv.zip';

const res = await fetch(URL);
if (!res.ok) throw new Error(`ABR fetch: HTTP ${res.status}`);
mkdirSync(join(HERE, 'cache'), { recursive: true });
const zipPath = join(HERE, 'cache', 'mt_town_fullset_pref11.csv.zip');
writeFileSync(zipPath, Buffer.from(await res.arrayBuffer()));
execFileSync('unzip', ['-o', '-q', zipPath, '-d', join(HERE, 'cache')]);

const csv = readFileSync(join(HERE, 'cache', 'mt_town_fullset_pref11.csv'), 'utf8');
const lines = csv.trim().split('\n');
const h = lines[0].split(',');
const col = (n) => h.indexOf(n);
const [iLg, iId, iOaza, iKana, iChNum, iStatus] =
  ['lg_code', 'machiaza_id', 'oaza_cho', 'oaza_cho_kana', 'chome_number', 'status_flg'].map(col);

const kata2hira = (s) => s.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
const towns = [];
for (const line of lines.slice(1)) {
  const c = line.split(',');
  if (!c[iLg] || !c[iLg].startsWith('11227')) continue; // 朝霞市
  if (iStatus >= 0 && c[iStatus] === '0') continue; // 廃止町字は除外
  const oaza = c[iOaza];
  if (!oaza) continue;
  towns.push({
    lg: c[iLg], id: c[iId], oaza,
    kana: c[iKana] ? kata2hira(c[iKana]) : null,
    chome_number: c[iChNum] ? Number(c[iChNum]) : null,
  });
}
writeFileSync(join(HERE, 'cache', 'abr-town.json'), JSON.stringify({ towns }, null, 1));
console.log(`ABR 朝霞市 町字 ${towns.length} 行 -> cache/abr-town.json`);
