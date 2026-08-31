// 板橋区: 地域別カレンダー PDF 24 本 + 索引ページの HTML 表 → course YAML。
//
// meta.yaml / taxonomy.yaml は生成しない (手書きが正典)。ここが書くのは course-*.yaml だけ。
//
// **foldCourses しない。** 24 地域の曜日規則は 15 通りしかなく 9 組が重複するので、
// 畳むと区が別物として運用している東西の地域が潰れる。区の呼称 (東N/西N) を
// そのままコースにする。
//
// 使い方: node fetch.mjs && EXTRACTED_AT=YYYY-MM-DD node build.mjs
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { findPython } from '../../_lib/python.mjs';
import { courseDoc, writeCourses } from '../../_lib/emit.mjs';
import { expandRange, periodDates, isUnknown } from '../../_lib/schedule.mjs';
import { classifyRules } from '../../_lib/classify.mjs';
import { parseIndexTable, splitAreas, ruleKey, pdfRuleKey } from './parse.mjs';
import {
  AREAS, PERIOD, EDITION_JA, LG_CODE, CAT_ORDER,
  GROUP_CATEGORIES, YEAREND_UNKNOWN, YEAREND_BLANK, TOWNS_NOT_PUBLISHED,
} from './sources.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CACHE = join(HERE, 'cache');
const OUTDIR = join(HERE, '../../../municipalities/tokyo/itabashi');

const EXTRACTED_AT = process.env.EXTRACTED_AT;
if (!EXTRACTED_AT) throw new Error('EXTRACTED_AT を環境変数で渡す (Date.now は使わない)');

// ---- 一次ソース: 24 本の PDF ----

const py = findPython(['pdfplumber']);
const pdf = JSON.parse(execFileSync(py, [
  join(HERE, 'extract.py'), ...AREAS.map((a) => join(CACHE, a.file)),
], { encoding: 'utf8', maxBuffer: 64 << 20 }));
const byArea = new Map(Object.values(pdf).map((v) => [v.area, v]));
if (byArea.size !== AREAS.length) throw new Error(`PDF から取れた地域が ${byArea.size} 個 (${AREAS.length} のはず)`);

// ---- 照合用: 索引ページの HTML 表 (地区割の正典) ----

const rows = parseIndexTable(readFileSync(join(CACHE, 'index.html'), 'utf8'));
console.log(`索引ページ: ${rows.length} 行`);

// 検査 1: HTML の曜日規則と PDF の曜日規則が一致するか (70 行 × 3 品目)
{
  let bad = 0;
  for (const r of rows) {
    const p = byArea.get(r.area);
    if (!p) throw new Error(`HTML の地域 ${r.area} に対応する PDF が無い (${r.name})`);
    if (ruleKey(r) !== pdfRuleKey(p.rules)) {
      console.error(`  ✗ ${r.name} (${r.area}): HTML ${ruleKey(r)} ≠ PDF ${pdfRuleKey(p.rules)}`);
      bad++;
    }
  }
  if (bad) throw new Error(`HTML と PDF の曜日規則が ${bad} 行で食い違う`);
  console.log(`曜日規則の照合: ${rows.length} 行 × 3 品目 = ${rows.length * 3} セル 一致`);
}

// ---- ABR 町字マスター ----

const abr = JSON.parse(readFileSync(join(CACHE, 'abr-town.json'), 'utf8')).towns;
const kanaOf = new Map();
const idOf = new Map();  // "町名" or "町名N" → machiaza_id
for (const t of abr) {
  if (t.kana) kanaOf.set(t.oaza, t.kana);
  idOf.set(`${t.oaza}${t.chome_number ?? ''}`, t.id);
}

// ---- 行 → area ----

const areasOf = new Map(AREAS.map((a) => [a.id, []]));
const covered = new Set();
for (const r of rows) {
  for (const a of splitAreas(r.name)) {
    const key = `${a.town}${a.chome ?? ''}`;
    if (!idOf.has(key)) throw new Error(`ABR に無い町字 "${key}" (索引の行: "${r.name}")`);
    if (covered.has(key)) throw new Error(`町字 "${key}" が索引に 2 回出る`);
    covered.add(key);
    const kana = kanaOf.get(a.town);
    areasOf.get(r.area).push({
      name: a.chome === null ? a.town : `${a.town}${a.chome}丁目`,
      ...(kana ? { yomi: kana + (a.chome ?? '') } : {}),
      machiaza_id: `${LG_CODE}-${idOf.get(key)}`,
    });
  }
}

// 検査 2: 区の全町字を覆っているか。
// **公表されていない 2 町だけを名指しの例外にする。** それ以外の差異は throw。
{
  const all = new Set(idOf.keys());
  const missing = [...all].filter((k) => !covered.has(k));
  const unexpected = missing.filter((k) => !TOWNS_NOT_PUBLISHED.includes(k));
  if (unexpected.length) throw new Error(`索引に無い町字: ${unexpected.join(', ')}`);
  const stale = TOWNS_NOT_PUBLISHED.filter((k) => covered.has(k));
  if (stale.length) throw new Error(`公表されない想定の町 ${stale.join(', ')} が索引に載った — 除外の根拠を見直す`);
  console.log(`町字の網羅: ABR ${all.size} 件中 ${covered.size} 件を被覆 `
    + `(区が日程を公表しない ${TOWNS_NOT_PUBLISHED.join('・')} を除く)`);
}

// ---- 実収集日 → 規則 ----

const dates = periodDates(PERIOD);
const docs = [];
let totalEvents = 0;

for (const a of AREAS) {
  const p = byArea.get(a.id);
  const areas = areasOf.get(a.id);
  if (!areas.length) throw new Error(`地域 ${a.nameJa} に町丁目が 1 つも無い`);

  // events: 収録期間の全日。収集なしの日も空配列で渡す (classifyRules の要求)
  const events = new Map(dates.map((d) => [d, []]));
  for (const [iso, groups] of Object.entries(p.events)) {
    if (!events.has(iso)) throw new Error(`${a.nameJa}: 収録期間外の日付 ${iso}`);
    const cats = groups.flatMap((g) => {
      if (!GROUP_CATEGORIES[g]) throw new Error(`未知の区分 "${g}" (${a.nameJa} ${iso})`);
      return GROUP_CATEGORIES[g];
    });
    events.set(iso, cats);
    totalEvents += groups.length;
  }

  const { rules, stopDays } = classifyRules({
    dates, events, catOrder: CAT_ORDER, foldMonthlyNth: true,
  });

  // 検査 3: 規則が生む収集日のうちカレンダーが空にしているのは年末年始だけか。
  // ここが崩れたら「規則で表せない例外」が他にもあるということなので止める。
  const blanks = stopDays.filter((d) => {
    const would = expandRange(`${d.slice(0, 7)}--${d.slice(0, 7)}`, rules, [], []);
    return would.has(d);
  });
  const outside = blanks.filter((d) => !YEAREND_BLANK.includes(d));
  if (outside.length) {
    throw new Error(`${a.nameJa}: 年末年始 (${YEAREND_BLANK.join(',')}) 以外に規則から欠ける日がある: ${outside.join(',')}`);
  }

  docs.push(courseDoc({
    city: 'itabashi',
    course: a.id,
    courseNameJa: a.nameJa,
    areas: areas.sort((x, y) => {
      const p1 = x.yomi ?? x.name, p2 = y.yomi ?? y.name;
      return p1 < p2 ? -1 : p1 > p2 ? 1 : (x.name < y.name ? -1 : x.name > y.name ? 1 : 0);
    }),
    period: PERIOD,
    source: {
      edition_ja: EDITION_JA,
      source_url: a.url,
      extracted_at: EXTRACTED_AT,
      extracted_by: 'claude-opus-5',
      verified_by:
        'Claude (板橋区「地域別 資源回収・ごみ収集曜日カレンダー(令和8年度版)」の地域別 PDF 24 本から、'
        + 'カレンダー本体の塗りセルで実収集日を抽出し規則化した。'
        + '同 PDF がテキスト層に持つ曜日規則と、索引ページの HTML 表 (町丁目 70 行 × 3 品目) の'
        + '両方に照合して不一致 0。年末年始は区が確定を留保しているため unknown_periods とした)',
    },
    rules,
    unknownPeriods: [YEAREND_UNKNOWN],
  }));
}

console.log(`コース ${docs.length} / area ${covered.size} / のべ収集日 ${totalEvents}`);

// 検査 4: 自己検証 — 生成した rules を展開し直すと抽出した実日付と一致するか。
// unknown_periods の中は展開されないので、比較対象からも外す。
{
  let checked = 0;
  for (const doc of docs) {
    const p = byArea.get(doc.metadata.course);
    const got = expandRange(PERIOD, doc.rules, [], doc.unknown_periods);
    const want = new Map();
    for (const [iso, groups] of Object.entries(p.events)) {
      if (isUnknown(iso, doc.unknown_periods)) continue;
      want.set(iso, [...new Set(groups.flatMap((g) => GROUP_CATEGORIES[g]))].sort());
    }
    for (const iso of dates) {
      if (isUnknown(iso, doc.unknown_periods)) continue;
      const w = (want.get(iso) ?? []).join(',');
      const h = [...(got.get(iso) ?? [])].sort().join(',');
      if (w !== h) throw new Error(`自己検証で不一致: ${doc.metadata.course_name_ja} ${iso} PDF[${w}] ≠ 展開[${h}]`);
      checked++;
    }
  }
  console.log(`自己検証: ${checked} 日枠で expandRange と PDF の実日付が一致`);
}

for (const c of CAT_ORDER) {
  if (!docs.some((d) => d.rules.some((r) => r.category === c))) throw new Error(`品目 ${c} がどのコースにも無い`);
}
console.log(`generated ${writeCourses(OUTDIR, PERIOD, docs)} courses`);
