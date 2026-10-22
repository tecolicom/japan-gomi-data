// 門真市の照合。生成済み course YAML を読み直し、expandRange で収録期間を再展開して比べる。
//
// (1) PDF カレンダー — 地区別 PDF を読み直した日程 (品目名の色で読む) と全日比較する。
//     PDF は HTML とは別に組版された資料で、規則の文 (HTML) に対する独立した照合になる。粗大ごみは収録しないので除く
// (2) HTML の表の文 — 規則の文から素朴に数え直した日程と全日比較する。年末年始の休止はここには無いので、
//     その日は「YAML では休止・文では収集」と出るのが正しく、数えて報告する
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { parse as yamlParse } from 'yaml';
import { expandRange, periodDates } from '../../_lib/schedule.mjs';
import { ruleOfThreePct } from '../../_lib/verify.mjs';
import { findPython } from '../../_lib/python.mjs';
import { DISTRICTS, PERIOD, CACHE, HERE } from './sources.mjs';
import { ROWS, parseIndex, parseRule, ruleHits, parseCalendar } from './parse.mjs';

const DIR = join(HERE, '..', '..', '..', 'municipalities', 'osaka', 'kadoma', PERIOD);
const dates = periodDates(PERIOD);
const py = findPython(['pdfplumber']);
const catsOf = (keys) => [...keys].flatMap((k) => ROWS.find((r) => r.key === k).cats).sort().join();
const sections = parseIndex(readFileSync(join(CACHE, 'index.html'), 'utf8'));

let ng = 0, pdfCells = 0, textCells = 0, yearendDays = 0, ruleRows = 0;
for (const { district, course, file } of DISTRICTS) {
  const doc = yamlParse(readFileSync(join(DIR, `course-${course}.yaml`), 'utf8'));
  if (doc.metadata.period !== PERIOD) throw new Error(`course-${course}.yaml の period が ${doc.metadata.period}`);
  const got = expandRange(PERIOD, doc.rules, doc.overrides || [], doc.unknown_periods || []);
  const yaml = (d) => [...(got.get(d) || [])].sort().join();

  const pdf = JSON.parse(execFileSync(py, [join(HERE, 'extract.py'), join(CACHE, file)], { encoding: 'utf8', maxBuffer: 256 << 20 }));
  const { events } = parseCalendar(pdf, PERIOD, district);
  const rows = sections.find((s) => s.district === district).rows;
  const rules = [...rows].map(([k, t]) => [k, parseRule(t)]);
  ruleRows += rules.length;

  let mism = 0;
  for (const d of dates) {
    // (1) PDF
    pdfCells++;
    const p = catsOf(events.get(d));
    if (yaml(d) !== p) { if (++mism <= 5) console.error(`  ${course} ${d}: YAML[${yaml(d)}] PDF[${p}]`); }
    // (2) HTML の文
    textCells++;
    const t = catsOf(rules.filter(([, r]) => ruleHits(r, d)).map(([k]) => k));
    if (yaml(d) !== t) {
      const isCancel = (doc.overrides || []).some((o) => o.date === d && o.cancelled) && yaml(d) === '';
      if (isCancel) yearendDays++;
      else if (++mism <= 5) console.error(`  ${course} ${d}: YAML[${yaml(d)}] HTMLの文[${t}]`);
    }
  }
  if (mism) { ng += mism; console.error(`${course}: ${mism} 件 不一致`); }
  else console.log(`${course}: 全${dates.length}日 一致`);
}

if (ng) {
  console.error(`\nNG: 計 ${ng} 件 不一致`);
  process.exit(1);
}
console.log(`\nOK: ${DISTRICTS.length} コース`);
console.log(`  PDF カレンダー ${pdfCells} 日枠ゼロ不一致 → 95% 信頼で <${ruleOfThreePct(pdfCells)}/日枠`);
console.log(`    HTML の規則行 ${ruleRows} 行ゼロ不一致 → <${ruleOfThreePct(ruleRows)}/行 (rule of three)`);
console.log(`  HTML の表の文 ${textCells} 日枠: 一致 (年末年始の休止 ${yearendDays} 日枠は文に無く、PDF の空欄による)`);
