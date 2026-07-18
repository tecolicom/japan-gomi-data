// 調査台帳 (docs/triage/*.yaml) を 1 枚の CSV に flatten する。
// 使い方: node scripts/triage-csv.mjs   → docs/triage/triage.csv を再生成
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as yamlParse } from 'yaml';

const TRIAGE = join(fileURLToPath(new URL('.', import.meta.url)), '../docs/triage');
const COLS = ['pref', 'code', 'handle', 'name_ja', 'population', 'status', 'source_type', 'granularity',
  'core_missing', 'difficulty', 'license', 'yearend', 'district_unit', 'district_count_approx',
  'schedule_url', 'calendar_urls', 'verify_sources', 'surveyed_at', 'notes'];
const esc = (v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
const rows = [];
for (const f of readdirSync(TRIAGE).filter((f) => f.endsWith('.yaml'))) {
  for (const r of yamlParse(readFileSync(join(TRIAGE, f), 'utf8'))) {
    rows.push(COLS.map((c) => {
      let v = c === 'pref' ? f.replace('.yaml', '') : r[c];
      if (Array.isArray(v)) v = v.join('；');
      return esc(v ?? '');
    }).join(','));
  }
}
rows.sort();
writeFileSync(join(TRIAGE, 'triage.csv'), COLS.join(',') + '\n' + rows.join('\n') + '\n');
console.log(`wrote docs/triage/triage.csv (${rows.length} rows)`);
