// 調査台帳の生成: municipalities/<県>/<handle>/survey.yaml (正典) から
// docs/triage/<県>.yaml (県別ビュー) と docs/triage/triage.csv (flatten) を再生成する。
// 使い方: node scripts/triage-csv.mjs
import { readFileSync, readdirSync, writeFileSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as yamlParse, stringify as yamlStringify } from 'yaml';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const MUNI = join(ROOT, 'municipalities');
const TRIAGE = join(ROOT, 'docs/triage');
const isDir = (p) => statSync(p).isDirectory();

const byPref = new Map();
for (const pref of readdirSync(MUNI).filter((p) => isDir(join(MUNI, p)))) {
  for (const h of readdirSync(join(MUNI, pref)).filter((h) => isDir(join(MUNI, pref, h)))) {
    const sp = join(MUNI, pref, h, 'survey.yaml');
    if (!existsSync(sp)) continue;
    if (!byPref.has(pref)) byPref.set(pref, []);
    byPref.get(pref).push(yamlParse(readFileSync(sp, 'utf8')));
  }
}

const COLS = ['pref', 'code', 'handle', 'name_ja', 'population', 'status', 'source_type', 'granularity',
  'core_missing', 'difficulty', 'license', 'yearend', 'district_unit', 'district_count_approx',
  'schedule_url', 'calendar_urls', 'verify_sources', 'surveyed_at', 'notes'];
const esc = (v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
const csvRows = [];
let total = 0;
for (const [pref, list] of [...byPref.entries()].sort()) {
  list.sort((a, b) => String(a.code).localeCompare(String(b.code)));
  const header = `# ${pref} の調査台帳 (生成物 — 正典は municipalities/${pref}/<handle>/survey.yaml。編集はそちらへ)\n` +
    `# 再生成: node scripts/triage-csv.mjs / スコア: node scripts/triage-score.mjs --csv docs/triage/scores.csv\n`;
  writeFileSync(join(TRIAGE, `${pref}.yaml`), header + yamlStringify(list, { lineWidth: 110 }));
  for (const r of list) {
    csvRows.push(COLS.map((c) => {
      let v = c === 'pref' ? pref : r[c];
      if (Array.isArray(v)) v = v.join('；');
      return esc(v ?? '');
    }).join(','));
    total++;
  }
}
csvRows.sort();
writeFileSync(join(TRIAGE, 'triage.csv'), COLS.join(',') + '\n' + csvRows.join('\n') + '\n');
console.log(`generated docs/triage/{<pref>.yaml, triage.csv} (${total} municipalities)`);
