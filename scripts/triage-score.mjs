// GODI (ごみ収集日データ開放度指数) を triage 台帳から算出する。
// 規則は docs/opendata-quality-index.md が正典。unknown は保守値+estimated フラグ。
// 使い方: node scripts/triage-score.mjs [--csv docs/triage/godi-scores.csv]
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as yamlParse } from 'yaml';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const TRIAGE = join(ROOT, 'docs/triage');

const STRUCTURED = new Set(['csv', 'json', 'xls']);

function score(r) {
  const est = new Set();
  const notes = String(r.notes || '');
  const st = r.source_type;

  // A. 取得性 (20)
  let A;
  if (st === 'none' || !st) A = 0;
  else if (st === 'app-only') A = 5;
  else if (st === 'json' && /JS|エンドポイント|駆動/.test(notes)) { A = 10; est.add('A'); }
  else if (/CLI ?403/.test(notes)) A = 15;
  else if (r.schedule_url) A = 20;
  else { A = 10; est.add('A'); }

  // B. 機械可読性 (25)
  let B;
  if (STRUCTURED.has(st)) B = 25;
  else if (st === 'txt') B = 20;
  else if (st === 'html') { B = /音声|テキスト版/.test(notes) ? 20 : 15; }
  else if (st === 'pdf') B = 10;
  else if (st === 'image-pdf') B = 3;
  else B = 0;

  // C. 粒度 (20)
  let C;
  const g = r.granularity;
  if (g === 'dates') C = 20;
  else if (g === 'weekday-rules') C = r.yearend === 'calendar-explicit' ? 14 : 10;
  else if (g === 'partial') C = 5;
  else if (g === 'none' || st === 'none') C = 0;
  else { C = r.yearend === 'calendar-explicit' ? 14 : 10; est.add('C'); }

  // D. ライセンス (20)
  let D;
  const lic = String(r.license || 'unknown');
  if (/^(CC-BY|PDL|CC0)/i.test(lic)) D = 20;
  else if (st === 'none' || !st) D = 0;
  else if (/転載禁止|商用/.test(notes) || lic === 'proprietary') D = 5;
  else { D = 10; if (lic === 'unknown') est.add('D'); }

  // E. 検証可能性 (15)
  let E;
  const vs = (r.verify_sources || []).map(String);
  if (st === 'none') E = 0;
  else if (vs.some((v) => /course-pdf|calendar/.test(v))) E = 15;
  else if (vs.length && !vs.every((v) => v === 'app')) E = 10;
  else { E = 5; est.add('E'); }

  const total = A + B + C + D + E;
  const rank = total >= 90 ? 'S' : total >= 75 ? 'A' : total >= 60 ? 'B' : total >= 40 ? 'C' : total >= 20 ? 'D' : 'E';
  const s = { A, B, C, D, E, ...(r.godi_overrides || {}) };
  let t2 = s.A + s.B + s.C + s.D + s.E;
  // キャップ規則: 基幹品目欠落 (partial) は C 止まり、データ無し (none) は E 止まり
  if (g === 'partial') t2 = Math.min(t2, 59);
  if (g === 'none' || st === 'none' || !st) t2 = Math.min(t2, 19);
  return { ...s, total: t2, rank: t2 >= 90 ? 'S' : t2 >= 75 ? 'A' : t2 >= 60 ? 'B' : t2 >= 40 ? 'C' : t2 >= 20 ? 'D' : 'E',
           estimated: [...est].join('') || '' };
}

const rows = [];
for (const f of readdirSync(TRIAGE).filter((f) => f.endsWith('.yaml'))) {
  const pref = f.replace('.yaml', '');
  for (const r of yamlParse(readFileSync(join(TRIAGE, f), 'utf8'))) {
    const s = score(r);
    rows.push({ pref, code: r.code, handle: r.handle, name_ja: r.name_ja, population: r.population,
                source_type: r.source_type, ...s });
  }
}
rows.sort((a, b) => b.total - a.total || (b.population || 0) - (a.population || 0));

const csvIdx = process.argv.indexOf('--csv');
if (csvIdx > 0) {
  const cols = ['pref', 'code', 'handle', 'name_ja', 'population', 'source_type', 'A', 'B', 'C', 'D', 'E', 'total', 'rank', 'estimated'];
  const csv = [cols.join(','), ...rows.map((r) => cols.map((c) => r[c] ?? '').join(','))].join('\n');
  writeFileSync(process.argv[csvIdx + 1], csv + '\n');
  console.log(`wrote ${process.argv[csvIdx + 1]} (${rows.length} rows)`);
}

const dist = {};
for (const r of rows) dist[r.rank] = (dist[r.rank] || 0) + 1;
console.log('rank distribution:', dist);
for (const r of rows.slice(0, 10))
  console.log(`${String(r.total).padStart(3)} ${r.rank} ${r.name_ja} (${r.pref}) ${r.estimated ? '≈' + r.estimated : ''}`);
