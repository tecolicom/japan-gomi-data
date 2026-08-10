// 独立照合: 生成済み course YAML を読み、収録期間を再展開して
// cache のカレンダー実日付と全日比較する(build とは別経路の検証)。
//
// 展開は tools/_lib/schedule.mjs の expandRange を使う。build-ics と同じ実装を
// 共有することで「照合と配信で同じ解釈」を保証する (以前はここに categoriesOn を
// 再実装していたが、正典と挙動がずれても気づけないため取りやめた)。
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as yamlParse } from 'yaml';
import { expandRange, periodDates } from '../../_lib/schedule.mjs';
import { ruleOfThreePct } from '../../_lib/verify.mjs';
import { parseCalendar } from './parse.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..', '..');
const PERIOD = '2026-04--2027-03'; // 一次ソースが裏付ける範囲 (会計年度とは限らない)
const OUTDIR = join(ROOT, 'municipalities', 'tokyo', 'chofu', PERIOD);
const DISTRICTS = ['1', '2', '3', '4'];

const dates = periodDates(PERIOD);
let ng = 0, patterns = 0;
for (const n of DISTRICTS) {
  const text = readFileSync(join(HERE, 'cache', `r8calendar_no${n}.txt`), 'utf8');
  const events = parseCalendar(text);
  const doc = yamlParse(readFileSync(join(OUTDIR, `course-${n}.yaml`), 'utf8'));
  const actual = expandRange(doc.metadata.period, doc.rules, doc.overrides || [], doc.unknown_periods || []);
  patterns += doc.rules.length;
  let mism = 0;
  for (const d of dates) {
    const got = [...(actual.get(d) || [])].sort().join(',');
    const exp = [...(events.get(d) || [])].sort().join(',');
    if (got !== exp) {
      mism++;
      if (mism <= 10) console.error(`  地区${n} ${d}: got[${got}] exp[${exp}]`);
    }
  }
  if (mism === 0) { console.log(`地区${n}: 全${dates.length}日 一致 (rules ${doc.rules.length})`); }
  else { console.error(`地区${n}: ${mism}日 不一致`); ng++; }
}

if (ng) {
  console.error(`\nNG: ${ng}地区で不一致`);
  process.exit(1);
}
console.log(`\nOK: 全${DISTRICTS.length}地区が収録期間 ${PERIOD} で完全一致 (${dates.length * DISTRICTS.length} 日枠)。`);
console.log(`  規則パターン ${patterns} 件ゼロ不一致 → 95%信頼で <${ruleOfThreePct(patterns)}/パターン (rule of three)`);
