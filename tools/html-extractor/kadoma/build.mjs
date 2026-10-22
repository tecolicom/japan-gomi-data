// 門真市: 地区別ごみカレンダーページ (HTML) + 地区別カレンダー PDF (cache/) → course YAML。
//
// 規則は HTML の表の文 (「毎週火曜日・金曜日」「毎月第1・3水曜日」) から作る。
// 同じ地区の PDF カレンダー (日付入り、品目名の色で読む) と全 365 日を突き合わせ、
// 食い違ってよいのは「PDF が空欄の年末年始の日」だけとする。その日は cancelled にする。
// それ以外の食い違いが 1 日でもあれば書き出さない。
//
// meta.yaml / taxonomy.yaml は生成しない (手書きが正典)。ここが書くのは course-*.yaml だけ。
//
// 使い方: EXTRACTED_AT=YYYY-MM-DD node build.mjs
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { expandRange, periodDates } from '../../_lib/schedule.mjs';
import { courseDoc, writeCourses } from '../../_lib/emit.mjs';
import { findPython } from '../../_lib/python.mjs';
import { INDEX_URL, DISTRICTS, PERIOD, EDITION_JA, CACHE, HERE } from './sources.mjs';
import { ROWS, parseIndex, expandTowns, parseRule, ruleHits, parseCalendar } from './parse.mjs';

const EXTRACTED_AT = process.env.EXTRACTED_AT;
if (!EXTRACTED_AT) throw new Error('EXTRACTED_AT を環境変数で渡す (Date.now は使わない)');

const OUTDIR = join(HERE, '..', '..', '..', 'municipalities', 'osaka', 'kadoma');
const LG_CODE = '272230';

// schema/categories.yaml の並び順
const CAT_ORDER = ['burnable', 'non_burnable', 'plastic', 'pet_bottle', 'beverage_can', 'glass_bottle', 'paper_cloth'];

// PDF が空欄でよい日の範囲 (年末年始)。この外で PDF と HTML が食い違えば止める
const YEAREND = { from: '2026-12-29', to: '2027-01-03' };

const VERIFIED_BY =
  'Claude(門真市「地区別ごみカレンダー」ページの表の文 (収集曜日) を規則にし、同じ地区の令和8年度カレンダーPDF ' +
  '(日付入り。品目名の色で読む) と全365日を突き合わせて一致。食い違いは年末年始にPDFが空欄の日だけで、その日を休止とした。' +
  'PDFはHTMLとは別に組版された資料で、粗大ごみの曜日も含めて照合した)';

const dates = periodDates(PERIOD);
const mdJa = (iso) => `${Number(iso.slice(5, 7))}月${Number(iso.slice(8))}日`;
const py = findPython(['pdfplumber']);
const abr = JSON.parse(readFileSync(join(CACHE, 'abr-town.json'), 'utf8')).towns;

// area 名 → area。読みと町字 ID は ABR と名前が一致したときだけ付ける。
// - 「岸和田1丁目」は ABR の 岸和田 + 丁目番号 1
// - 「北巣本町（1番～34番）」は括弧の前の名前で引く (番地で地区が分かれる町。2 つの area が同じ町字を指す)
// - 「打越」「野口」「横地」「北島」は ABR では「大字打越」などの大字。市の表記に「大字」は無いので
//   「大字」+ 名前で引き、読みの先頭の「おおあざ」は外す (打越町・北島町は別の町で、別の地区)
// - E・F 地区の市営住宅などの建物名は ABR に無い
const usedIds = new Set();
function toArea(name) {
  const m = name.match(/^(.+?)(\d+)丁目$/);
  const base = m ? m[1] : name.replace(/（[^）]*）$/, '');
  const chome = m ? Number(m[2]) : null;
  let hits = abr.filter((t) => t.oaza === base && t.chome_number === chome);
  let oaza = false;
  if (!hits.length && !m) {
    hits = abr.filter((t) => t.oaza === `大字${base}` && t.chome_number === null);
    oaza = hits.length > 0;
  }
  if (hits.length > 1) throw new Error(`ABR に「${base}」${chome ?? ''} が ${hits.length} 件`);
  const area = { name };
  if (hits.length === 1) {
    const kana = hits[0].kana;
    if (kana) area.yomi = oaza ? kana.replace(/^おおあざ/, '') : kana;
    area.machiaza_id = [`${LG_CODE}-${hits[0].id}`];
    usedIds.add(hits[0].id);
  }
  return area;
}
// 読みのある area を読みの昇順 (コードポイント順。同じ読みは丁目順のまま) に、読みの無い area はその後ろに掲載順で並べる
const sortAreas = (areas) => [
  ...areas.filter((a) => a.yomi).sort((a, b) => (a.yomi < b.yomi ? -1 : a.yomi > b.yomi ? 1 : 0)),
  ...areas.filter((a) => !a.yomi),
];

const html = readFileSync(join(CACHE, 'index.html'), 'utf8');
const sections = parseIndex(html);
if (sections.map((s) => s.district).join() !== DISTRICTS.map((d) => d.district).join()) {
  throw new Error(`案内ページの地区が ${sections.map((s) => s.district)} (sources.mjs と違う)`);
}

const docs = [];
const allNames = new Map(); // area 名 → 地区 (重複検査)
for (const { district, course, file } of DISTRICTS) {
  const sec = sections.find((s) => s.district === district);
  if (sec.calendarTitle !== `${district}地区ごみカレンダー(${EDITION_JA})`) {
    throw new Error(`${district}地区: カレンダーの見出しが「${sec.calendarTitle}」(版が変わった可能性)`);
  }
  const rowRules = new Map([...sec.rows].map(([k, t]) => [k, parseRule(t)]));

  // HTML の文の日程 (key の集合)
  const textEv = new Map(dates.map((d) => [d, new Set([...rowRules].filter(([, r]) => ruleHits(r, d)).map(([k]) => k))]));

  // PDF カレンダー
  const pdf = JSON.parse(execFileSync(py, [join(HERE, 'extract.py'), join(CACHE, file)], { encoding: 'utf8', maxBuffer: 256 << 20 }));
  const { events: pdfEv, merged } = parseCalendar(pdf, PERIOD, district);

  // 2 つの日付が入るマス (8/24・8/31 など) は、両日の HTML の日程が同じでないと照合にならない
  for (const { dates: ds } of merged) {
    const sigs = new Set(ds.map((d) => [...textEv.get(d)].sort().join()));
    if (sigs.size !== 1) throw new Error(`${district}地区: 2 日が入るマス ${ds} で、HTML の日程が日によって違う`);
  }

  // 照合: HTML と PDF の全日比較。食い違ってよいのは年末年始の「PDF が空欄」だけ
  const cancelled = [];
  for (const d of dates) {
    const t = [...textEv.get(d)].sort().join();
    const p = [...pdfEv.get(d)].sort().join();
    if (t === p) continue;
    if (p === '' && d >= YEAREND.from && d <= YEAREND.to) { cancelled.push(d); continue; }
    throw new Error(`${district}地区 ${d}: HTML[${t}] PDF[${p}]`);
  }

  const rules = [];
  for (const row of ROWS) {
    const r = rowRules.get(row.key);
    for (const category of row.cats) {
      // 配列は規則ごとに複製する (共有すると YAML にアンカー &a1 / *a1 が出る)
      rules.push(r.pattern === 'weekly'
        ? { category, pattern: 'weekly', days: [...r.days] }
        : { category, pattern: 'monthly_nth', days: [...r.days], occurrences: [...r.occurrences] });
    }
  }
  rules.sort((a, b) => CAT_ORDER.indexOf(a.category) - CAT_ORDER.indexOf(b.category));
  const overrides = cancelled.map((d) => ({
    date: d, cancelled: true, note: `${mdJa(d)}は収集なし (カレンダーで空欄。年末年始)`,
  }));

  // 再展開して、HTML の日程から休止日を除いたもの (= PDF の日程から粗大ごみを除いたもの) と全日一致するか
  const got = expandRange(PERIOD, rules, overrides, []);
  for (const d of dates) {
    const exp = cancelled.includes(d) ? [] : [...textEv.get(d)].flatMap((k) => ROWS.find((r) => r.key === k).cats);
    if ([...(got.get(d) || [])].sort().join() !== exp.sort().join()) {
      throw new Error(`${district}地区 再展開NG ${d}: got[${[...(got.get(d) || [])]}] exp[${exp}]`);
    }
  }

  const names = expandTowns(sec.townsText);
  for (const n of names) {
    if (allNames.has(n)) throw new Error(`area「${n}」が ${allNames.get(n)}地区と ${district}地区の両方にある`);
    allNames.set(n, district);
  }

  console.log(`${course}: areas ${names.length} / rules ${rules.length} / 休止 ${cancelled.join(' ')} / 照合OK`);
  docs.push(courseDoc({
    city: 'kadoma',
    course,
    courseNameJa: `${district}地区`,
    areas: sortAreas(names.map(toArea)),
    period: PERIOD,
    source: {
      edition_ja: EDITION_JA,
      source_url: INDEX_URL,
      extracted_at: EXTRACTED_AT,
      extracted_by: 'claude-opus-5-5',
      verified_by: VERIFIED_BY,
    },
    rules,
    overrides,
  }));
}

// どの地区にも出てこない ABR の町字。meta.yaml に記録してある 6 つ以外が出たら (町の新設・地区の変更) 止める
const UNLISTED = ['大字門真', '大字桑才', '大字三番', '大字薭島', '大字三ツ島官有', '大字薭島官有'];
const unused = abr.filter((t) => !usedIds.has(t.id)).map((t) => t.oaza + (t.chome_number ?? ''));
if (unused.sort().join() !== [...UNLISTED].sort().join()) {
  throw new Error(`どの地区にも無い ABR の町字が変わった: ${unused}`);
}

console.log(`generated ${writeCourses(OUTDIR, PERIOD, docs)} courses`);
