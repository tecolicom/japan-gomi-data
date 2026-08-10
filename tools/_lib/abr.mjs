// デジタル庁 アドレス・ベース・レジストリ (ABR) 町字マスターの取得 (政府標準利用規約)。
// areas の yomi / machiaza_id はここ由来。詳細は README「areas の読み・町字ID ソース」。
//
// 以前は各 extractor の fetch-yomi.mjs に同じものが 8 コピーされていた (2026-08-10 に集約)。
// 集約したのは「県版フルセット + lg_code 前方一致」の形だけ。次の 4 本は形が違うので
// 各自の実装を残している:
//   okayama   … 県版 (フルセットでない mt_town) を使う
//   kurashiki … 市区町村版 (mt_town_city332020)
//   yokohama / kawasaki … 日本郵便 ken_all を第2の読みソースとして併用する
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

export const ABR_FULLSET_PREF = (pref) =>
  `https://data.address-br.digital.go.jp/mt_town_fullset/pref/mt_town_fullset_pref${pref}.csv.zip`;

export const kata2hira = (s) => s.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));

// 県版フルセット CSV を cacheDir に用意して、その CSV のパスを返す (既にあれば再取得しない)。
export async function downloadAbr({ pref, cacheDir, force = false }) {
  mkdirSync(cacheDir, { recursive: true });
  const base = `mt_town_fullset_pref${pref}.csv`;
  const csvPath = join(cacheDir, base);
  if (existsSync(csvPath) && !force) return csvPath;
  const res = await fetch(ABR_FULLSET_PREF(pref));
  if (!res.ok) throw new Error(`ABR fetch: HTTP ${res.status}`);
  const zipPath = join(cacheDir, `${base}.zip`);
  writeFileSync(zipPath, Buffer.from(await res.arrayBuffer()));
  execFileSync('unzip', ['-o', '-q', zipPath, '-d', cacheDir]);
  return csvPath;
}

// CSV → 町字 [{ lg, id, oaza, kana, chome_number }]。
// lgPrefix は団体コードの前方一致。6 桁なら 1 自治体、短くすれば政令市の区をまとめて拾える。
// ABR は同一町字の重複行を持つので machiaza_id で uniq する。status_flg '0' (廃止) は除く。
export function parseAbrCsv(csv, lgPrefix) {
  const lines = csv.trim().split('\n');
  const h = lines[0].split(',');
  const col = (n) => h.indexOf(n);
  const [iLg, iId, iOaza, iKana, iChNum, iStatus] =
    ['lg_code', 'machiaza_id', 'oaza_cho', 'oaza_cho_kana', 'chome_number', 'status_flg'].map(col);
  if (iLg < 0 || iId < 0 || iOaza < 0) throw new Error('ABR CSV: 想定した列 (lg_code/machiaza_id/oaza_cho) が無い');

  const byId = new Map();
  for (const line of lines.slice(1)) {
    const c = line.split(',');
    if (!c[iLg]?.startsWith(lgPrefix)) continue;
    if (iStatus >= 0 && c[iStatus] === '0') continue;
    if (!c[iOaza] || byId.has(c[iId])) continue;
    byId.set(c[iId], {
      lg: c[iLg],
      id: c[iId],
      oaza: c[iOaza],
      kana: c[iKana] ? kata2hira(c[iKana]) : null,
      chome_number: c[iChNum] ? Number(c[iChNum]) : null,
    });
  }
  return [...byId.values()];
}

// 取得 → 抽出 → cache/abr-town.json 出力までの定型。fetch-yomi.mjs はこれ 1 呼び出しで済む。
export async function writeAbrTownJson({ pref, lgPrefix, cacheDir, force = false, label }) {
  const csvPath = await downloadAbr({ pref, cacheDir, force });
  const towns = parseAbrCsv(readFileSync(csvPath, 'utf8'), lgPrefix);
  writeFileSync(join(cacheDir, 'abr-town.json'), JSON.stringify({ towns }, null, 1));
  console.log(`ABR ${label ?? lgPrefix} 町字 ${towns.length} 件 -> cache/abr-town.json`);
  return towns;
}
