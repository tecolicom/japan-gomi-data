// 独立照合: 生成済み course YAML を読み、categoriesOn で通年再展開して
// cache のカレンダー実日付と全日比較する(build とは別経路の検証)。
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as yamlParse } from 'yaml';
import { parseCalendar, fiscalYearDates } from './parse.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..', '..');
const OUTDIR = join(ROOT, 'municipalities', 'tokyo', 'chofu', '2026');
const FY = 2026;
const DOW_INDEX = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

function categoriesOn(iso, rules, overrides) {
  const d = new Date(iso + 'T00:00:00');
  const dw = d.getDay();
  const occ = Math.floor((d.getDate() - 1) / 7) + 1;
  const weekly = new Set(), monthly = new Set();
  for (const r of rules) {
    const matchedDay = r.days?.some((x) => DOW_INDEX[x] === dw);
    if (r.pattern === 'weekly' && matchedDay) weekly.add(r.category);
    else if (r.pattern === 'monthly_nth' && matchedDay && r.occurrences?.includes(occ)) monthly.add(r.category);
    else if (r.pattern === 'monthly_specific' && (r.dates || []).map(String).includes(iso)) monthly.add(r.category);
  }
  const ovs = (overrides || []).filter((o) => String(o.date) === iso);
  if (ovs.some((o) => o.cancelled)) return [];
  if (ovs.length === 0) return [...weekly, ...monthly];
  const final = new Set(weekly);
  for (const o of ovs) if (o.category) final.add(o.category);
  return [...final];
}

let ok = 0, ng = 0;
const fyDates = fiscalYearDates(FY);
for (const n of ['1', '2', '3', '4']) {
  const text = readFileSync(join(HERE, 'cache', `r8calendar_no${n}.txt`), 'utf8');
  const events = parseCalendar(text);
  const doc = yamlParse(readFileSync(join(OUTDIR, `course-${n}.yaml`), 'utf8'));
  let mism = 0;
  for (const d of fyDates) {
    const got = categoriesOn(d, doc.rules, doc.overrides || []).slice().sort();
    const exp = (events.get(d) || []).slice().sort();
    if (got.join(',') !== exp.join(',')) {
      mism++;
      if (mism <= 10) console.error(`  地区${n} ${d}: got[${got}] exp[${exp}]`);
    }
  }
  if (mism === 0) { console.log(`地区${n}: 全${fyDates.length}日 一致`); ok++; }
  else { console.error(`地区${n}: ${mism}日 不一致`); ng++; }
}
console.log(ng === 0 ? `\nOK: 全4地区が通年照合で完全一致` : `\nNG: ${ng}地区で不一致`);
process.exit(ng === 0 ? 0 : 1);
