// 倉敷市 自己照合: records.json → rules(build と同じ写像) を categoriesOn で
// FY2026 通年展開し、各コースが元レコードの weekly/第n パターンを忠実に再現するか確認。
// (パース忠実性の担保。ソース独立照合は verify_csv.py が data eye CSV と行う。)
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as yamlParse } from 'yaml';
import { expandFiscalYear, nthOfMonth } from '../../_lib/schedule.mjs';
import { DAY_TO_INDEX } from '../../_lib/jp.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUTDIR = join(HERE, '..', '..', '..', 'municipalities', 'okayama', 'kurashiki', '2026');
const FY = 2026;
const DOW = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

// コース YAML → {category: {weeklyDays:Set, nth:Set("occ|DAY")}} を通年展開から復元
function realized(doc) {
  const cal = expandFiscalYear(FY, doc.rules, doc.overrides || []);
  const out = {};
  for (const [iso, cats] of cal) {
    const d = new Date(iso + 'T00:00:00');
    const dow = DOW[d.getDay()], occ = nthOfMonth(d);
    for (const c of cats) {
      (out[c] ||= { days: new Set(), nth: new Set() });
      out[c].days.add(dow);
      out[c].nth.add(`${occ}|${dow}`);
    }
  }
  return out;
}

// ルール宣言そのものから期待パターンを作る
function declared(rules) {
  const out = {};
  for (const r of rules) {
    (out[r.category] ||= { weekly: null, nth: new Set() });
    if (r.pattern === 'weekly') out[r.category].weekly = new Set(r.days);
    else if (r.pattern === 'monthly_nth')
      for (const o of r.occurrences) for (const dd of r.days) out[r.category].nth.add(`${o}|${dd}`);
  }
  return out;
}

let courses = 0, mismatch = 0;
for (const f of readdirSync(OUTDIR).filter((x) => x.endsWith('.yaml'))) {
  const doc = yamlParse(readFileSync(join(OUTDIR, f), 'utf8'));
  courses++;
  const rz = realized(doc);
  const dc = declared(doc.rules);
  for (const [cat, d] of Object.entries(dc)) {
    const r = rz[cat];
    if (!r) { console.error(`✗ ${f}: ${cat} が通年展開に現れない`); mismatch++; continue; }
    if (d.weekly) {
      // weekly: 展開された曜日集合が宣言と一致
      const got = [...r.days].sort().join(',');
      const exp = [...d.weekly].sort().join(',');
      // weekly は nth を持たないので days で比較
      if (got !== exp) { console.error(`✗ ${f}: ${cat} weekly 曜日 ${got} != ${exp}`); mismatch++; }
    } else {
      const got = [...r.nth].sort().join(';');
      const exp = [...d.nth].sort().join(';');
      if (got !== exp) { console.error(`✗ ${f}: ${cat} nth ${got} != ${exp}`); mismatch++; }
    }
  }
}
console.log(`自己照合: ${courses} コース展開, 不一致 ${mismatch}`);
if (mismatch) process.exit(1);
