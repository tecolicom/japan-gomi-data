// 町名の読み (yomi) と町字ID (machiaza_id) のソース取得: デジタル庁 アドレス・ベース・
// レジストリ (ABR) 町字マスター。倉敷市 (lg_code 332020) 版 CSV から 大字・町名 の
// カナ・丁目番号・machiaza_id を cache/abr-town.json に落とす。build.mjs が areas[].yomi /
// machiaza_id 付与に使う (岡山市 tools/api-extractor/okayama と同方式)。
// 出力: { towns: [{ lg, id, oaza, kana(ひらがな), chome_number }] }
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const URL = 'https://data.address-br.digital.go.jp/mt_town/city/mt_town_city332020.csv.zip';

const res = await fetch(URL);
if (!res.ok) throw new Error(`ABR fetch: HTTP ${res.status}`);
mkdirSync(join(HERE, 'cache'), { recursive: true });
const zipPath = join(HERE, 'cache', 'mt_town_city332020.csv.zip');
writeFileSync(zipPath, Buffer.from(await res.arrayBuffer()));
execFileSync('unzip', ['-o', '-q', zipPath, '-d', join(HERE, 'cache')]);

const csv = readFileSync(join(HERE, 'cache', 'mt_town_city332020.csv'), 'utf8');
const lines = csv.trim().split('\n');
const header = lines[0].split(',');
const col = (name) => { const i = header.indexOf(name); if (i < 0) throw new Error(`ABR CSV に列 ${name} が無い`); return i; };
const [iLg, iId, iOaza, iKana, iChomeNum] =
  ['lg_code', 'machiaza_id', 'oaza_cho', 'oaza_cho_kana', 'chome_number'].map(col);

const kata2hira = (s) => s.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
const towns = [];
for (const line of lines.slice(1)) {
  const cells = line.split(',');
  const oaza = cells[iOaza];
  if (!cells[iLg] || !oaza) continue;
  towns.push({
    lg: cells[iLg],
    id: cells[iId],
    oaza,
    kana: cells[iKana] ? kata2hira(cells[iKana]) : null,
    chome_number: cells[iChomeNum] ? Number(cells[iChomeNum]) : null,
  });
}
writeFileSync(join(HERE, 'cache', 'abr-town.json'), JSON.stringify({ towns }, null, 1));
console.log(`ABR 倉敷市 町字 ${towns.length} 行 -> cache/abr-town.json`);
