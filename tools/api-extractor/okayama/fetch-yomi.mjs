// 町名の読み (yomi) と町字ID (machiaza_id) のソース取得:
// デジタル庁 アドレス・ベース・レジストリ (ABR) 町字マスター。
// 岡山県一括 CSV (政府標準利用規約 = CC BY 4.0 互換) から岡山市 4 区分を
// cache/abr-town.json に落とす。build.mjs が areas[].yomi / machiaza_id 付与に使う。
// 出力: { towns: [{lg, id, ward, oaza, kana(ひらがな), chome_number}] }
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const URL = 'https://data.address-br.digital.go.jp/mt_town/pref/mt_town_pref33.csv.zip';

const res = await fetch(URL);
if (!res.ok) throw new Error(`ABR fetch: HTTP ${res.status}`);
mkdirSync(join(HERE, 'cache'), { recursive: true });
const zipPath = join(HERE, 'cache', 'mt_town_pref33.csv.zip');
writeFileSync(zipPath, Buffer.from(await res.arrayBuffer()));
execFileSync('unzip', ['-o', '-q', zipPath, '-d', join(HERE, 'cache')]);

const csv = readFileSync(join(HERE, 'cache', 'mt_town_pref33.csv'), 'utf8');
const lines = csv.trim().split('\n');
const header = lines[0].split(',');
const col = (name) => header.indexOf(name);
const [iLg, iId, iWard, iOaza, iKana, iChomeNum] =
  ['lg_code', 'machiaza_id', 'ward', 'oaza_cho', 'oaza_cho_kana', 'chome_number'].map(col);

const kata2hira = (s) => s.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
const towns = [];
for (const line of lines.slice(1)) {
  const cells = line.split(',');
  if (!cells[iLg] || !cells[iLg].startsWith('3310')) continue; // 岡山市 4 区
  const oaza = cells[iOaza];
  if (!oaza) continue;
  towns.push({
    lg: cells[iLg],
    id: cells[iId],
    ward: cells[iWard],
    oaza,
    kana: cells[iKana] ? kata2hira(cells[iKana]) : null,
    chome_number: cells[iChomeNum] ? Number(cells[iChomeNum]) : null,
  });
}
writeFileSync(join(HERE, 'cache', 'abr-town.json'), JSON.stringify({ towns }, null, 1));
console.log(`ABR 岡山市 町字 ${towns.length} 行 -> cache/abr-town.json`);
