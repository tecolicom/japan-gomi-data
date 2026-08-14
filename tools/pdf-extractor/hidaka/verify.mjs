// 日高: PDF から抽出した収集日と、収録済みの course YAML を収録期間の全日付で突き合わせる。
//
// 収録は 2026-07 に別経路で行われ、course YAML のヘッダは「人間による目視レビューは未実施」と
// 断っている。生成器も残っていなかったため make regen の検査対象から外れていた。
// この照合はその穴を塞ぐもので、以後は抽出と YAML のどちらがずれても差分として出る。
//
// 使い方: node verify.mjs [--quiet]
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import YAML from 'yaml';
import { expandRange, periodDates } from '../../_lib/schedule.mjs';
import { COURSES, PERIOD, CACHE, ITEM2CATS } from './sources.mjs';

const CANON = join(CACHE, '..', '..', '..', '..', 'municipalities', 'saitama', 'hidaka', PERIOD);
const DAY_INDEX = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

const quiet = process.argv.includes('--quiet');
const jsonPath = join(CACHE, 'extracted.json');
if (!existsSync(jsonPath)) throw new Error(`抽出結果が無い: ${jsonPath} (先に extract.py を回す)`);
const extracted = new Map(
  JSON.parse(readFileSync(jsonPath, 'utf8')).courses.map((c) => [c.course, c]),
);

const dates = periodDates(PERIOD);
let totalSlots = 0;
let totalDiff = 0;
const bad = [];

for (const { course } of COURSES) {
  const src = extracted.get(course);
  if (!src) throw new Error(`抽出結果にコース ${course} が無い`);

  // 抽出側: 日付 -> category の集合
  const byDay = new Map();
  const add = (day, cat) => {
    if (!byDay.has(day)) byDay.set(day, new Set());
    byDay.get(day).add(cat);
  };
  for (const [item, days] of Object.entries(src.items)) {
    const cats = ITEM2CATS[item];
    if (!cats) throw new Error(`未知の品目: ${item}`);
    for (const d of days) for (const c of cats) add(d, c);
  }
  const burnableDow = new Set(src.burnable_days.map((d) => DAY_INDEX[d]));
  const closed = new Set(src.closed);
  for (const d of dates) {
    if (burnableDow.has(new Date(d + 'T00:00:00').getDay()) && !closed.has(d)) add(d, 'burnable');
  }

  const doc = YAML.parse(readFileSync(join(CANON, `course-${course}.yaml`), 'utf8'));
  const canon = expandRange(doc.metadata.period, doc.rules, doc.overrides);

  const diffs = [];
  for (const day of dates) {
    totalSlots++;
    const a = [...(byDay.get(day) || [])].sort();
    const b = [...(canon.get(day) || [])].sort();
    if (a.join(',') !== b.join(',')) diffs.push({ day, pdf: a, canon: b });
  }
  totalDiff += diffs.length;
  if (diffs.length) bad.push(course);

  console.log(`course ${course}: ${diffs.length ? '★不一致' : '一致'} (差分 ${diffs.length} 日)`);
  if (!quiet) {
    for (const d of diffs.slice(0, 10)) {
      console.log(`    ${d.day}  抽出=[${d.pdf.join('+') || 'なし'}]  収録=[${d.canon.join('+') || 'なし'}]`);
    }
    if (diffs.length > 10) console.log(`    … 他 ${diffs.length - 10} 日`);
  }
}

console.log(`\n合計 ${totalSlots} 日枠、不一致 ${totalDiff} 日 (${COURSES.length} コース × ${dates.length} 日)`);
if (totalDiff) {
  console.log('不一致があるコース:', bad.join(', '));
  process.exitCode = 1;
}
