// 日高: PDF から抽出した収集日 (cache/extracted.json) から course YAML を生成する。
//
// meta.yaml / taxonomy.yaml / facts.yaml は生成しない (手書きが正典)。書くのは course-*.yaml だけ。
//
// 使い方: EXTRACTED_AT=YYYY-MM-DD node build.mjs
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { expandRange, periodDates, cancelledOverrides } from '../../_lib/schedule.mjs';
import { courseDoc, writeCourses } from '../../_lib/emit.mjs';
import { classifyRules } from '../../_lib/classify.mjs';
import { COURSES, PERIOD, EDITION_JA, CACHE, HERE, PDF_URL, ITEM2CATS, CAT_ORDER } from './sources.mjs';

const EXTRACTED_AT = process.env.EXTRACTED_AT;
if (!EXTRACTED_AT) throw new Error('EXTRACTED_AT を環境変数で渡す (Date.now は使わない)');

const OUTDIR = join(HERE, '..', '..', '..', 'municipalities', 'saitama', 'hidaka');
const DAY_INDEX = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

const VERIFIED_BY =
  'Claude(日高市「ごみ収集日程表」令和8年度の全20コース年間日程表PDFから、' +
  'pdfplumber の表抽出でコース別の実日付を取得。expandRange 再展開で全365日を自己照合し、' +
  '20コース×365日=7300日枠を収録済みデータと全数照合)';

const jsonPath = join(CACHE, 'extracted.json');
if (!existsSync(jsonPath)) throw new Error(`抽出結果が無い: ${jsonPath} (先に extract.py を回す)`);
const extracted = new Map(
  JSON.parse(readFileSync(jsonPath, 'utf8')).courses.map((c) => [c.course, c]),
);

const dates = periodDates(PERIOD);
const docs = [];

for (const { course, areas } of COURSES) {
  const src = extracted.get(course);
  if (!src) throw new Error(`抽出結果にコース ${course} が無い`);

  // 収録期間の全日付を覆う events を作る (収集なしの日も空配列で明示する)
  const events = Object.fromEntries(dates.map((d) => [d, []]));
  const put = (day, cat) => {
    if (!(day in events)) throw new Error(`${course}: 収録期間外の日付 ${day}`);
    if (!events[day].includes(cat)) events[day].push(cat);
  };
  for (const [item, days] of Object.entries(src.items)) {
    const cats = ITEM2CATS[item];
    if (!cats) throw new Error(`${course}: 未知の品目 "${item}"`);
    for (const d of days) for (const c of cats) put(d, c);
  }
  const burnableDow = new Set(src.burnable_days.map((d) => DAY_INDEX[d]));
  const closed = new Set(src.closed);
  for (const d of dates) {
    if (burnableDow.has(new Date(d + 'T00:00:00').getDay()) && !closed.has(d)) put(d, 'burnable');
  }

  const { rules, stopDays } = classifyRules({ dates, events, catOrder: CAT_ORDER });
  const overrides = cancelledOverrides(
    rules, [...stopDays].sort(), '施設の定期点検のため可燃ごみの収集なし(市の日程表どおり)',
  );

  // 市が収集しない品目は、規則が空でも「収集しない」という事実を残す。
  // classifyRules は収集日が 1 日も無い category を rules に載せないので、ここで補う。
  for (const [item, note] of Object.entries(src.item_notes)) {
    const cats = ITEM2CATS[item];
    for (const cat of cats) {
      const existing = rules.find((r) => r.category === cat);
      if (existing) {
        existing.note = note; // 一部の区だけ収集しない場合 (course 13 の下鹿山区)
      } else {
        rules.push({ category: cat, pattern: 'monthly_specific', dates: [], note });
      }
    }
  }
  rules.sort((a, b) => CAT_ORDER.indexOf(a.category) - CAT_ORDER.indexOf(b.category));

  // 自己検証: rules + overrides を再展開して抽出した実日付と全日一致するか
  const actual = expandRange(PERIOD, rules, overrides, []);
  for (const d of dates) {
    const exp = [...events[d]].sort().join(',');
    const got = [...(actual.get(d) || [])].sort().join(',');
    if (got !== exp) throw new Error(`${course} 照合NG ${d}: got[${got}] exp[${exp}]`);
  }
  for (const d of actual.keys()) if (!(d in events)) throw new Error(`${course}: 期間外の展開日 ${d}`);

  docs.push(
    courseDoc({
      city: 'hidaka',
      course,
      areas,
      period: PERIOD,
      source: {
        edition_ja: EDITION_JA,
        source_url: PDF_URL,
        extracted_at: EXTRACTED_AT,
        extracted_by: 'claude-opus-5',
        verified_by: VERIFIED_BY,
      },
      rules,
      overrides,
    }),
  );
  console.log(`course ${course}: areas ${areas.length} / rules ${rules.length} / overrides ${overrides.length} 照合OK`);
}

console.log(`generated ${writeCourses(OUTDIR, PERIOD, docs)} courses`);
