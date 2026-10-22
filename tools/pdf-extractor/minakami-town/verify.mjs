// みなかみ町の照合。生成済み course YAML を読み直し、expandRange で収録期間を再展開して比べる。
//
// (1) 日付表の印 — ■ ▲ 衣 の品目を、PDF を読み直した日付表の印 (parseGrid) と全日比較する。
//     規則は表の文から作っているので、日付表は「同じ PDF の別の表現」として働く。外部の独立ソースではない。
// (2) 表の文 — 毎週の品目 (日付表に印が無い) を、表の文の曜日と「〜を除く」から素朴に数え直して全日比較する。
//     build と同じ文を読むので自己照合にとどまる。
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { parse as yamlParse } from 'yaml';
import { expandRange, periodDates } from '../../_lib/schedule.mjs';
import { DAY_TO_INDEX } from '../../_lib/jp.mjs';
import { ruleOfThreePct } from '../../_lib/verify.mjs';
import { findPython } from '../../_lib/python.mjs';
import { PDFS, PLASTIC_NOTE_COURSE, PERIOD, CACHE, HERE } from './sources.mjs';
import { ROWS, MARK_ROW, parseTable, parseGrid } from './parse.mjs';

const DIR = join(HERE, '..', '..', '..', 'municipalities', 'gunma', 'minakami-town', PERIOD);
const dates = periodDates(PERIOD);
const dowOf = (iso) => new Date(iso + 'T00:00:00').getDay();
const py = findPython(['pdfplumber']);
const MARKED = new Set(Object.values(MARK_ROW).flatMap((k) => ROWS.find((r) => r.key === k).cats));

let ng = 0, gridCells = 0, gridRows = 0, weeklyCells = 0, courses = 0;

// plasticDays がある (注記の別 course) ときは同じ日付表をもう一度見るだけなので、日枠の数には入れない
function check(course, grid, rows, plasticDays) {
  const doc = yamlParse(readFileSync(join(DIR, `course-${course}.yaml`), 'utf8'));
  if (doc.metadata.period !== PERIOD) throw new Error(`course-${course}.yaml の period が ${doc.metadata.period}`);
  const got = expandRange(PERIOD, doc.rules, doc.overrides || [], doc.unknown_periods || []);
  courses++;
  let mism = 0;

  // (1) 日付表の印
  for (const d of dates) {
    if (!plasticDays) gridCells++;
    const exp = [...new Set((grid.get(d) || []).flatMap((mk) => ROWS.find((r) => r.key === MARK_ROW[mk]).cats))].sort().join();
    const act = (got.get(d) || []).filter((c) => MARKED.has(c)).sort().join();
    if (exp !== act) { if (++mism <= 5) console.error(`  ${course} ${d}: YAML[${act}] 日付表[${exp}]`); }
  }
  if (!plasticDays) gridRows += Object.keys(MARK_ROW).length;

  // (2) 毎週の品目
  for (const key of ['burn', 'plastic']) {
    const s = rows.get(key);
    for (const c of new Set(ROWS.find((r) => r.key === key).cats)) {
      const days = c === 'plastic' && plasticDays ? plasticDays : s.days;
      const excl = c === 'plastic' && plasticDays ? [] : s.exclude.map((x) => x.date);
      for (const d of dates) {
        weeklyCells++;
        const exp = days.some((w) => DAY_TO_INDEX[w] === dowOf(d)) && !excl.includes(d);
        const act = (got.get(d) || []).includes(c);
        if (exp !== act) { if (++mism <= 5) console.error(`  ${course} ${d} ${c}: YAML[${act}] 表の文[${exp}]`); }
      }
    }
  }

  // 生成物に余計な品目が無いか (表にある品目だけ)
  const known = new Set(ROWS.flatMap((r) => r.cats));
  for (const [d, cs] of got) for (const c of cs) if (!known.has(c)) { mism++; console.error(`  ${course} ${d}: 表に無い品目 ${c}`); }

  if (mism) { ng += mism; console.error(`${course}: ${mism} 件 不一致`); }
  else console.log(`${course}: 全${dates.length}日 一致`);
}

for (const { slug, course, file } of PDFS) {
  const doc = JSON.parse(execFileSync(py, [join(HERE, 'extract.py'), join(CACHE, file)], { encoding: 'utf8', maxBuffer: 64 << 20 }));
  const { rows, plasticNote } = parseTable(doc.words, PERIOD);
  const grid = parseGrid(doc, PERIOD);
  check(course, grid, rows, null);
  if (plasticNote) check(PLASTIC_NOTE_COURSE[slug], grid, rows, [plasticNote.day]);
}

if (ng) {
  console.error(`\nNG: 計 ${ng} 件 不一致`);
  process.exit(1);
}
console.log(`\nOK: ${courses} コース`);
console.log(`  日付表の印 (■▲衣) ${gridCells} 日枠ゼロ不一致 → <${ruleOfThreePct(gridCells)}/日枠 (同じ PDF の別表現。外部ソースではない)`);
console.log(`    表の規則行 ${gridRows} 行ゼロ不一致 → <${ruleOfThreePct(gridRows)}/行 (rule of three)`);
console.log(`  毎週の品目 ${weeklyCells} 枠ゼロ不一致 (表の文との自己照合のみ)`);
