// 町名の読み (yomi) ソース取得: デジタル庁 アドレス・ベース・レジストリ (ABR) 町字マスター。
// 岡山県一括 CSV (政府標準利用規約 = CC BY 4.0 互換) から岡山市 4 区の 大字・町名→カナ を
// cache/abr-town-kana.json に落とす。build.mjs が areas[].yomi 付与に使う。
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const URL = 'https://data.address-br.digital.go.jp/mt_town/pref/mt_town_pref33.csv.zip';

const res = await fetch(URL);
if (!res.ok) throw new Error(`ABR fetch: HTTP ${res.status}`);
const buf = Buffer.from(await res.arrayBuffer());
// zip 展開 (単一エントリの stored/deflate を unzip コマンドに委ねず自前で最小展開はせず、
// node:zlib では zip コンテナを扱えないため一時ファイル経由で unzip する)
import { execFileSync } from 'node:child_process';
mkdirSync(join(HERE, 'cache'), { recursive: true });
const zipPath = join(HERE, 'cache', 'mt_town_pref33.csv.zip');
writeFileSync(zipPath, buf);
execFileSync('unzip', ['-o', '-q', zipPath, '-d', join(HERE, 'cache')]);

const { readFileSync } = await import('node:fs');
const csv = readFileSync(join(HERE, 'cache', 'mt_town_pref33.csv'), 'utf8');
const lines = csv.split('\n');
const header = lines[0].split(',');
const col = (name) => header.indexOf(name);
const iLg = col('lg_code'); const iOaza = col('oaza_cho'); const iKana = col('oaza_cho_kana');

const kata2hira = (s) => s.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
const map = {};
const conflicts = [];
for (const line of lines.slice(1)) {
  const cells = line.split(',');
  if (!cells[iLg] || !cells[iLg].startsWith('3310')) continue; // 岡山市 4 区 (331015/23/31/40)
  const oaza = cells[iOaza]; const kana = cells[iKana];
  if (!oaza || !kana) continue;
  const hira = kata2hira(kana);
  if (map[oaza] && map[oaza] !== hira) conflicts.push([oaza, map[oaza], hira]);
  map[oaza] = hira;
}
if (conflicts.length) throw new Error(`同一町名で読みが衝突: ${JSON.stringify(conflicts.slice(0, 5))}`);
writeFileSync(join(HERE, 'cache', 'abr-town-kana.json'), JSON.stringify(map, null, 1));
console.log(`ABR 岡山市 町名→かな ${Object.keys(map).length} 件 -> cache/abr-town-kana.json`);
