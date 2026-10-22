// みなかみ町: 地区別カレンダー PDF (cache/) → course YAML。
//
// 規則は PDF 上半分の表の文 (「毎週火・金曜」「毎月第1・3木曜」「1月は第2・4金曜」) から作る。
// 下半分の日付表には ■ ▲ 衣 の印しか無いので、その 3 種について「規則を全日展開した結果」と
// 「日付表の印」が全日一致することを build の中で確かめる (一致しなければ書き出さない)。
// 毎週の品目 (燃やせるごみ・生ごみ・プラスチック・燃やせないごみ) は日付表に印が無く、表の文だけが根拠。
//
// meta.yaml / taxonomy.yaml は生成しない (手書きが正典)。ここが書くのは course-*.yaml だけ。
//
// 使い方: EXTRACTED_AT=YYYY-MM-DD node build.mjs
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { expandRange, periodDates, categoriesOn, nthOfMonth } from '../../_lib/schedule.mjs';
import { DAY_TO_INDEX, zen2han } from '../../_lib/jp.mjs';
import { courseDoc, writeCourses } from '../../_lib/emit.mjs';
import { findPython } from '../../_lib/python.mjs';
import { PDFS, PLASTIC_NOTE_COURSE, PERIOD, EDITION_JA, INDEX_URL, CACHE, HERE } from './sources.mjs';
import { ROWS, MARK_ROW, parseTitle, parseTable, parseGrid } from './parse.mjs';

const EXTRACTED_AT = process.env.EXTRACTED_AT;
if (!EXTRACTED_AT) throw new Error('EXTRACTED_AT を環境変数で渡す (Date.now は使わない)');

const OUTDIR = join(HERE, '..', '..', '..', 'municipalities', 'gunma', 'minakami-town');
const LG_CODE = '104493';

// schema/categories.yaml の並び順
const CAT_ORDER = [
  'burnable', 'kitchen', 'non_burnable', 'plastic', 'pet_bottle', 'beverage_can',
  'glass_bottle', 'cloth', 'paper', 'hazardous',
];
// 日付表に印が付く品目 (照合できるのはこれだけ)
const MARKED_CATS = new Set(ROWS.filter((r) => Object.values(MARK_ROW).includes(r.key)).flatMap((r) => r.cats));

const VERIFIED_BY =
  'Claude(みなかみ町「ごみ収集カレンダー」令和8年度後期の地区別PDF。テキスト層から表の文 (収集曜日) を読んで規則にし、' +
  '同じPDFの日付表の印 (■かん・びん・ペットボトル / ▲電池類・蛍光管類・古紙類 / 衣 衣類) と全182日を突き合わせて一致。' +
  '毎週の品目 (燃やせるごみ・生ごみ・プラスチック・燃やせないごみ) は日付表に印が無く、表の文による自己照合のみ。独立した第2ソースは無い)';

const DOW_JA = '日月火水木金土';
const dates = periodDates(PERIOD);
const dowOf = (iso) => new Date(iso + 'T00:00:00').getDay();
const nthOf = (iso) => nthOfMonth(new Date(iso + 'T00:00:00'));
const monthOf = (iso) => Number(iso.slice(5, 7));
const mdJa = (iso) => `${monthOf(iso)}月${Number(iso.slice(8))}日`;
const uniq = (xs) => [...new Set(xs)];
const rowLabel = (row) => row.labels.join('・');

const abr = JSON.parse(readFileSync(join(CACHE, 'abr-town.json'), 'utf8')).towns;
const py = findPython(['pdfplumber']);

// 表の行ごとの日程 → その行の品目が出る日 (Map<iso, Set<category>>)。
// plasticDays を渡すとプラスチックだけをその曜日の毎週に差し替える (須田貝・青木沢の注記)
function textEvents(rowsSchedule, plasticDays) {
  const ev = new Map(dates.map((d) => [d, new Set()]));
  for (const row of ROWS) {
    const s = rowsSchedule.get(row.key);
    const cats = uniq(row.cats);
    for (const d of dates) {
      let hit;
      if (s.kind === 'weekly') {
        hit = s.days.some((w) => DAY_TO_INDEX[w] === dowOf(d)) && !s.exclude.some((x) => x.date === d);
      } else if (s.kind === 'nth') {
        const r = s.months[monthOf(d)] || s;
        hit = DAY_TO_INDEX[r.day] === dowOf(d) && r.occurrences.includes(nthOf(d));
      } else {
        hit = s.months.includes(monthOf(d)) && DAY_TO_INDEX[s.day] === dowOf(d) && s.occurrences.includes(nthOf(d));
      }
      if (hit) for (const c of cats) ev.get(d).add(c);
    }
  }
  if (plasticDays) {
    for (const d of dates) {
      ev.get(d).delete('plastic');
      if (plasticDays.some((w) => DAY_TO_INDEX[w] === dowOf(d))) ev.get(d).add('plastic');
    }
  }
  return ev;
}

// 表の行ごとの日程 → rules (例外を除いた基本形)
function toRules(rowsSchedule, plasticDays) {
  const rules = [];
  for (const row of ROWS) {
    const s = rowsSchedule.get(row.key);
    for (const category of uniq(row.cats)) {
      // 配列は規則ごとに複製する (共有すると YAML にアンカー &a1 / *a1 が出る)
      if (s.kind === 'weekly') rules.push({ category, pattern: 'weekly', days: [...s.days] });
      else if (s.kind === 'nth') rules.push({ category, pattern: 'monthly_nth', days: [s.day], occurrences: [...s.occurrences] });
      else {
        const ds = dates.filter((d) => s.months.includes(monthOf(d))
          && DAY_TO_INDEX[s.day] === dowOf(d) && s.occurrences.includes(nthOf(d)));
        if (ds.length !== s.months.length) throw new Error(`${rowLabel(row)}: ${s.months}月の日が ${ds.length} 日`);
        rules.push({ category, pattern: 'monthly_specific', dates: ds });
      }
    }
  }
  return rules
    .map((r) => (plasticDays && r.category === 'plastic' ? { ...r, days: [...plasticDays] } : r))
    .sort((a, b) => CAT_ORDER.indexOf(a.category) - CAT_ORDER.indexOf(b.category));
}

// 規則の予測と表の文の日程の差 → overrides。
// 「〜を除く」の日は cancelled。「1月は第…」の日は category override で、categoriesOn の規約により
// その日の monthly 品目を**漏れなく全部**並べる (1 つ書き忘れるとその品目が黙って消える)。
function toOverrides(rules, ev, rowsSchedule) {
  const weeklyCats = new Set(rules.filter((r) => r.pattern === 'weekly').map((r) => r.category));
  const excludeText = new Map();
  const monthText = new Map();
  for (const row of ROWS) {
    const s = rowsSchedule.get(row.key);
    if (s.kind === 'weekly') {
      for (const x of s.exclude) {
        if (!s.days.some((w) => DAY_TO_INDEX[w] === dowOf(x.date))) {
          throw new Error(`${rowLabel(row)}: 「${x.text}」は${DOW_JA[dowOf(x.date)]}曜で、収集曜日に当たらない`);
        }
        excludeText.set(x.date, [...(excludeText.get(x.date) || []), `${rowLabel(row)}は「${x.text}」`]);
      }
    } else if (s.kind === 'nth') {
      for (const [m, r] of Object.entries(s.months)) {
        monthText.set(Number(m), [...(monthText.get(Number(m)) || []), `${rowLabel(row)}は「${r.text}」`]);
      }
    }
  }
  const out = [];
  for (const d of dates) {
    const actual = [...ev.get(d)].sort();
    const predicted = categoriesOn(new Date(d + 'T00:00:00'), rules, []).slice().sort();
    if (actual.join() === predicted.join()) continue;
    if (actual.length === 0) {
      const why = excludeText.get(d) || monthText.get(monthOf(d));
      if (!why) throw new Error(`${d}: 規則では収集があるのに、表の文に理由が無い`);
      out.push({ date: d, cancelled: true, note: `${mdJa(d)}は収集なし (カレンダーの表記: ${why.join('、')})` });
      continue;
    }
    for (const c of weeklyCats) {
      if (predicted.includes(c) && !actual.includes(c)) {
        throw new Error(`${d}: 毎週の ${c} だけが欠けている (override で表せない)`);
      }
    }
    const why = monthText.get(monthOf(d));
    if (!why) throw new Error(`${d}: 規則と日程が食い違うのに、表の文に理由が無い`);
    const note = `${monthOf(d)}月は回数が通常と違う (カレンダーの表記: ${why.join('、')})`;
    for (const c of CAT_ORDER) {
      if (actual.includes(c) && !weeklyCats.has(c)) out.push({ date: d, category: c, note });
    }
  }
  return out;
}

// 印刷された地区名 → area。読みと町字 ID は ABR の大字と名前が完全一致したときだけ付ける。
// 「後閑（上河原地区）」のような括弧書きは、括弧の前の名前で引く (playbook の割れ町)
function toArea(name) {
  const base = name.replace(/（[^）]*）$/, '');
  const hits = abr.filter((t) => t.oaza === base);
  if (hits.length > 1) throw new Error(`ABR に「${base}」が ${hits.length} 件`);
  const area = { name };
  if (hits.length === 1) {
    if (hits[0].kana) area.yomi = hits[0].kana;
    area.machiaza_id = [`${LG_CODE}-${hits[0].id}`];
  }
  return area;
}
// 読みのある area を読みの昇順 (コードポイント順) に、読みの無い area はその後ろに印刷順で並べる
const sortAreas = (areas) => [
  ...areas.filter((a) => a.yomi).sort((a, b) => (a.yomi < b.yomi ? -1 : a.yomi > b.yomi ? 1 : 0)),
  ...areas.filter((a) => !a.yomi),
];

function makeCourse({ course, courseNameJa, areaNames, rowsSchedule, grid, url, plasticDays }) {
  const ev = textEvents(rowsSchedule, plasticDays);

  // 照合 1: 表の文の日程 (■▲衣 の品目だけ) と日付表の印が全日一致するか
  for (const d of dates) {
    const fromGrid = uniq((grid.get(d) || []).flatMap((mk) => ROWS.find((r) => r.key === MARK_ROW[mk]).cats)).sort();
    const fromText = [...ev.get(d)].filter((c) => MARKED_CATS.has(c)).sort();
    if (fromGrid.join() !== fromText.join()) {
      throw new Error(`${course} ${d}: 日付表[${fromGrid}] 表の文[${fromText}]`);
    }
  }

  const rules = toRules(rowsSchedule, plasticDays);
  const overrides = toOverrides(rules, ev, rowsSchedule);

  // 照合 2: rules + overrides を再展開して表の文の日程と全日一致するか
  const actual = expandRange(PERIOD, rules, overrides, []);
  for (const d of dates) {
    const exp = [...ev.get(d)].sort().join();
    const got = [...(actual.get(d) || [])].sort().join();
    if (got !== exp) throw new Error(`${course} 再展開NG ${d}: got[${got}] exp[${exp}]`);
  }

  console.log(`${course} ${courseNameJa}: areas ${areaNames.length} / rules ${rules.length} / overrides ${overrides.length} 照合OK`);
  return courseDoc({
    city: 'minakami-town',
    course,
    courseNameJa,
    areas: sortAreas(areaNames.map(toArea)),
    period: PERIOD,
    source: {
      edition_ja: EDITION_JA,
      source_url: url,
      extracted_at: EXTRACTED_AT,
      extracted_by: 'claude-opus-5-5',
      verified_by: VERIFIED_BY,
    },
    rules,
    overrides,
  });
}

const html = readFileSync(join(CACHE, 'index.html'), 'utf8');
if (!html.includes('令和8年度後期')) throw new Error(`案内ページ ${INDEX_URL} に「令和8年度後期」が無い (版が変わった可能性)`);

const docs = [];
for (const { slug, course, url, file } of PDFS) {
  const doc = JSON.parse(execFileSync(py, [join(HERE, 'extract.py'), join(CACHE, file)], { encoding: 'utf8', maxBuffer: 64 << 20 }));
  const title = parseTitle(doc.words);
  if (zen2han(title.edition) !== '令和8年度') {
    throw new Error(`${slug}: 見出しの年度が「${title.edition}」`);
  }
  const { rows, plasticNote } = parseTable(doc.words, PERIOD);
  const grid = parseGrid(doc, PERIOD);

  docs.push(makeCourse({ course, courseNameJa: title.areasText, areaNames: title.areaNames, rowsSchedule: rows, grid, url }));

  if (plasticNote) {
    // 注記の地区だけプラスチックの曜日が違う。注記が言うのはプラスチックだけなので、燃やせないごみは元のまま。
    // 「12月30日は除く」は水曜の文なので、火曜のプラスチックには掛けない (一次ソースに書かれていない)
    const subCourse = PLASTIC_NOTE_COURSE[slug];
    if (!subCourse) throw new Error(`${slug}: 注記「${plasticNote.text}」の course が sources.mjs に無い`);
    docs.push(makeCourse({
      course: subCourse, courseNameJa: plasticNote.areaNames.join('・'), areaNames: plasticNote.areaNames,
      rowsSchedule: rows, grid, url, plasticDays: [plasticNote.day],
    }));
  }
}

console.log(`generated ${writeCourses(OUTDIR, PERIOD, docs)} courses`);
