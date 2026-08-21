// 上富良野町: コース別カレンダー PDF から course YAML を生成する。
//
// meta.yaml / taxonomy.yaml は生成しない (手書きが正典)。ここが書くのは course-*.yaml だけ。
//
// 使い方: node fetch.mjs && EXTRACTED_AT=YYYY-MM-DD node build.mjs
//
// 抽出は extract_kamifurano.py (pdfplumber) が担う。**pdfplumber を持つ python が要る** —
// 既定の python3 が持っていない環境があるので _lib/python.mjs の findPython() で探す。
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findPython } from '../../_lib/python.mjs';
import { classifyRules } from '../../_lib/classify.mjs';
import { expandRange, periodDates, cancelledOverrides } from '../../_lib/schedule.mjs';
import { courseDoc, writeCourses } from '../../_lib/emit.mjs';
import { COURSES, CACHE, PERIOD, EDITION_JA, pdfUrl, pdfFile } from './sources.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUTDIR = join(HERE, '../../../municipalities/hokkaido/kamifurano-town');
const SCRIPT = join(HERE, 'extract_kamifurano.py');

const EXTRACTED_AT = process.env.EXTRACTED_AT;
if (!EXTRACTED_AT) throw new Error('EXTRACTED_AT を環境変数で渡す (Date.now は使わない)');

const VERIFIED_BY =
  'Claude (pdfplumber で PDF から全収集日を抽出し、規則を再展開した結果と全日照合。' +
  '人間による目視レビューは未実施)';

// 品目の並び。course YAML の rules 順を決める (出力を決定的に保つため固定)
const CAT_ORDER = [
  'burnable', 'kitchen', 'plastic', 'pet_bottle', 'paper_cloth',
  'beverage_can', 'glass_bottle', 'non_burnable', 'hazardous', 'oversized',
];

const PY = findPython(['pdfplumber']);
const dates = periodDates(PERIOD);
const docs = [];

for (const c of COURSES) {
  // extract_kamifurano.py は {category: [日付...]} を stdout へ出す
  const raw = execFileSync(PY, [SCRIPT, join(CACHE, pdfFile(c))],
    { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
  const byCat = JSON.parse(raw);

  // 収集なしの日も空配列で渡す (classifyRules の要求)
  const events = Object.fromEntries(dates.map((d) => [d, []]));
  for (const [cat, ds] of Object.entries(byCat)) {
    if (!CAT_ORDER.includes(cat)) throw new Error(`${c.id}: CAT_ORDER に無い品目 "${cat}"`);
    for (const d of ds) {
      if (events[d] === undefined) throw new Error(`${c.id}: 収録期間 ${PERIOD} の外の日付 ${d} (${cat})`);
      events[d].push(cat);
    }
  }

  const { rules, stopDays } = classifyRules({ dates, events, catOrder: CAT_ORDER });
  const overrides = cancelledOverrides(rules, stopDays, '収集なし');

  // 自己検証: 生成した規則を再展開した結果が、抽出した実日付と完全一致すること。
  // 合わなければ書き出さない (AGENTS.md の不変条件)。
  const back = expandRange(PERIOD, rules, overrides);
  const diffs = [];
  for (const d of dates) {
    const got = new Set(back.get(d) ?? []), want = new Set(events[d]);
    const oy = [...got].filter((x) => !want.has(x));
    const op = [...want].filter((x) => !got.has(x));
    if (oy.length || op.length) diffs.push(`${d} 規則のみ=[${oy}] 抽出のみ=[${op}]`);
  }
  if (diffs.length) {
    throw new Error(`${c.id}: 自己検証で ${diffs.length} 件の不一致\n  ` + diffs.slice(0, 5).join('\n  '));
  }

  docs.push(courseDoc({
    city: 'kamifurano-town',
    course: c.id,
    courseNameJa: c.nameJa,
    areas: c.areas,
    period: PERIOD,
    source: {
      edition_ja: EDITION_JA,
      pdf_url: pdfUrl(c),
      extracted_at: EXTRACTED_AT,
      extracted_by: 'claude-opus-5',
      confidence: 0.9,
      verified_by: VERIFIED_BY,
    },
    rules,
    overrides,
  }));
  console.log(`${c.id} ${c.nameJa}: areas ${c.areas.length} / rules ${rules.length} / overrides ${overrides.length} 自己検証OK`);
}

console.log(`generated ${writeCourses(OUTDIR, PERIOD, docs)} courses`);
