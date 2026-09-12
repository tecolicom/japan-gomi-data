// 江東区: 配布シート (多言語版 PDF) + 都カタログ CSV → course YAML。
//
// meta.yaml / taxonomy.yaml は生成しない (手書きが正典)。ここが書くのは course-*.yaml だけ。
//
// 役割分担:
//   シート  … 地区割の正典 + 曜日規則 + **燃やさないごみの隔週実日付**
//   CSV     … 日本語の町名 (多言語版は簡体字・ハングル表記なので町名が取れない) + 曜日規則の照合
//
// 使い方: node fetch.mjs && EXTRACTED_AT=YYYY-MM-DD node build.mjs
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { findPython } from '../../_lib/python.mjs';
import { courseDoc, writeCourses } from '../../_lib/emit.mjs';
import { expandRange, periodDates, isUnknown } from '../../_lib/schedule.mjs';
import { parseCsv, splitAreas, csvRuleKey, sheetRuleKey, daysOf, dayIdx } from './parse.mjs';
import {
  SHEETS, PERIOD, EDITION_JA, INDEX_URL, LG_CODE, CAT_ORDER, DISTRICTS,
  GROUP_CATEGORIES, YEAREND_UNKNOWN, YEAREND_BLANK,
  DISTRICT_OVERRIDES, CSV_ROWS_REPLACED,
} from './sources.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CACHE = join(HERE, 'cache');
const OUTDIR = join(HERE, '../../../municipalities/tokyo/koto');
const DOW = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];

const EXTRACTED_AT = process.env.EXTRACTED_AT;
if (!EXTRACTED_AT) throw new Error('EXTRACTED_AT を環境変数で渡す (Date.now は使わない)');

// ---- 一次ソース: 配布シート (中国語版) ----

const py = findPython(['pdfplumber']);
const primary = SHEETS.find((s) => s.primary);
const sheet = JSON.parse(execFileSync(py, [
  join(HERE, 'extract.py'), join(CACHE, primary.file), '--lang', primary.lang,
], { encoding: 'utf8', maxBuffer: 32 << 20 })).districts;
if (sheet.length !== DISTRICTS) throw new Error(`シートから取れた地区が ${sheet.length} 個`);
const byDistrict = new Map(sheet.map((d) => [d.district, d]));

// ---- 町名: 都カタログ CSV ----

// cache には生バイトが入る (cachedFetch は復号した文字列を返すだけでファイルは触らない)。
// 都カタログのこの CSV は cp932 なので、読むたびに復号する。
const csv = parseCsv(new TextDecoder('shift_jis').decode(readFileSync(join(CACHE, 'collectionday.csv'))));
console.log(`CSV: ${csv.length} 行 / シート: ${sheet.length} 地区`);

// 検査 1: CSV とシートの曜日規則が一致するか (12 地区 × 4 品目)。
// **CSV の鮮度検査を兼ねる** — 中野区の OD は 2021 年止まりだった。
{
  let bad = 0;
  for (const r of csv) {
    if (CSV_ROWS_REPLACED.includes(r.name)) continue;  // 地区割が食い違う行 (下で置換)
    const d = byDistrict.get(r.district);
    if (!d) throw new Error(`CSV の地区 ${r.district} がシートに無い (${r.name})`);
    if (csvRuleKey(r) !== sheetRuleKey(d)) {
      console.error(`  ✗ ${r.name} (地区${r.district}): CSV ${csvRuleKey(r)} ≠ シート ${sheetRuleKey(d)}`);
      bad++;
    }
  }
  if (bad) throw new Error(`CSV とシートの曜日規則が ${bad} 行で食い違う`);
  console.log(`曜日規則の照合: ${csv.length - CSV_ROWS_REPLACED.length} 行 × 4 品目 一致`);
}

// ---- 地区割: シートを正典にする (豊洲・塩浜) ----

const rows = csv.filter((r) => !CSV_ROWS_REPLACED.includes(r.name))
  .map((r) => ({ name: r.name, district: r.district }));
{
  const missing = CSV_ROWS_REPLACED.filter((n) => !csv.some((r) => r.name === n));
  if (missing.length) {
    throw new Error(`置換対象の CSV 行が見つからない: ${missing.join(', ')} — CSV が更新された可能性がある`);
  }
  for (const o of DISTRICT_OVERRIDES) rows.push({ name: o.name, district: o.district, override: true });
  console.log(`地区割: CSV ${csv.length} 行 → ${rows.length} 行 `
    + `(${CSV_ROWS_REPLACED.join('・')} をシートの ${DISTRICT_OVERRIDES.map((o) => o.name).join('・')} で置換)`);
}

// ---- ABR 町字マスター ----

const abr = JSON.parse(readFileSync(join(CACHE, 'abr-town.json'), 'utf8')).towns;
const kanaOf = new Map();
const idOf = new Map();
const chomeOf = new Map();   // 町名 → その町が持つ丁目の一覧 (丁目が無い町は [null])
for (const t of abr) {
  if (t.kana) kanaOf.set(t.oaza, t.kana);
  idOf.set(`${t.oaza}${t.chome_number ?? ''}`, t.id);
  if (!chomeOf.has(t.oaza)) chomeOf.set(t.oaza, []);
  chomeOf.get(t.oaza).push(t.chome_number);
}
for (const v of chomeOf.values()) v.sort((a, b) => (a ?? 0) - (b ?? 0));

// CSV は丁目を持つ町でも「青海」のように町名だけで書くことがある。
// **ABR がその町に丁目を持つなら全丁目へ展開する** (1 area = 1 丁目。倉敷の教訓)。
function expandTown(a) {
  if (a.chome !== null) return [a];
  const cs = chomeOf.get(a.town);
  if (!cs) throw new Error(`ABR に無い町 "${a.town}"`);
  return cs.map((c) => ({ town: a.town, chome: c }));
}

const areasOf = new Map([...Array(DISTRICTS)].map((_, i) => [i + 1, []]));
const covered = new Set();
for (const r of rows) {
  for (const a of splitAreas(r.name).flatMap(expandTown)) {
    const key = `${a.town}${a.chome ?? ''}`;
    if (!idOf.has(key)) throw new Error(`ABR に無い町字 "${key}" (行: "${r.name}")`);
    if (covered.has(key)) throw new Error(`町字 "${key}" が 2 回出る (地区割の重複)`);
    covered.add(key);
    const kana = kanaOf.get(a.town);
    areasOf.get(r.district).push({
      name: a.chome === null ? a.town : `${a.town}${a.chome}丁目`,
      ...(kana ? { yomi: kana + (a.chome ?? '') } : {}),
      machiaza_id: `${LG_CODE}-${idOf.get(key)}`,
    });
  }
}

// 検査 2: 区の全町字を覆っているか
{
  const all = new Set(idOf.keys());
  const missing = [...all].filter((k) => !covered.has(k));
  if (missing.length) throw new Error(`収集日が公表されていない町字: ${missing.join(', ')}`);
  console.log(`町字の網羅: ABR ${all.size} 件をちょうど被覆`);
}

// ---- 規則 ----

const dates = periodDates(PERIOD);
const docs = [];

for (let n = 1; n <= DISTRICTS; n++) {
  const d = byDistrict.get(n);
  const areas = areasOf.get(n);
  if (!areas.length) throw new Error(`地区${n} に町丁目が 1 つも無い`);

  // 検査 3: 隔週の日付が 14 日刻みで、外れるのは年末年始の分だけか。
  // ここが崩れたら「規則で表せない例外」が他にもあるということなので止める。
  const ds = d.dates;
  for (let i = 0; i < ds.length - 1; i++) {
    const gap = (new Date(ds[i + 1]) - new Date(ds[i])) / 86400000;
    if (gap === 14) continue;
    if (gap !== 28) throw new Error(`地区${n}: ${ds[i]}→${ds[i + 1]} が ${gap} 日 (14 か 28 のはず)`);
    const skipped = new Date(new Date(ds[i]).getTime() + 14 * 86400000).toISOString().slice(0, 10);
    if (!YEAREND_BLANK.includes(skipped)) {
      throw new Error(`地区${n}: 年末年始 (${YEAREND_BLANK.join(',')}) 以外の ${skipped} が抜けている`);
    }
  }
  for (const iso of ds) {
    if (new Date(`${iso}T00:00:00`).getDay() !== (d.biweekly_weekday + 1) % 7) {
      throw new Error(`地区${n}: ${iso} が隔週の曜日と違う`);
    }
  }

  // 週次 3 品目は曜日規則、燃やさないごみは隔週なので実日付列挙。
  // 隔週は weekly でも monthly_nth でも表せない (月内 n 回目が月をまたいでずれる)。
  const rules = [];
  for (const [group, cats] of Object.entries(GROUP_CATEGORIES)) {
    if (group === '燃やさないごみ') {
      for (const c of cats) rules.push({ category: c, pattern: 'monthly_specific', dates: [...ds] });
    } else {
      const days = d.weekly[group].map((i) => DOW[i]);
      for (const c of cats) rules.push({ category: c, pattern: 'weekly', days });
    }
  }
  rules.sort((a, b) => CAT_ORDER.indexOf(a.category) - CAT_ORDER.indexOf(b.category));

  docs.push(courseDoc({
    city: 'koto',
    course: String(n),
    courseNameJa: `${n}地区`,
    areas: areas.sort((x, y) => {
      const p = x.yomi ?? x.name, q = y.yomi ?? y.name;
      return p < q ? -1 : p > q ? 1 : (x.name < y.name ? -1 : x.name > y.name ? 1 : 0);
    }),
    period: PERIOD,
    source: {
      edition_ja: EDITION_JA,
      source_url: INDEX_URL,
      extracted_at: EXTRACTED_AT,
      extracted_by: 'claude-opus-5',
      verified_by:
        'Claude (区配布シート「令和8年度版 地区別 資源回収・ごみ収集日一覧」の多言語版 PDF から、'
        + '12 地区の曜日規則と燃やさないごみの隔週実日付を機械抽出した。日本語版は画像 PDF で読めない。'
        + '都カタログ CSV (CC BY 4.0) と 12 地区 × 4 品目で照合し、中国語版と韓国語版の突合、'
        + '日本語版画像の目視でも確認した。ただし**豊洲・塩浜の地区割は CSV と食い違い、'
        + '現行版であるシートを採った** (meta.yaml に記録)。'
        + '年末年始は区が確定を留保しているため unknown_periods とした)',
    },
    rules,
    unknownPeriods: [YEAREND_UNKNOWN],
  }));
}

console.log(`コース ${docs.length} / area ${covered.size}`);

// 検査 4: 自己検証 — 生成した rules を展開し直すと抽出結果と一致するか。
{
  let checked = 0;
  for (const doc of docs) {
    const d = byDistrict.get(Number(doc.metadata.course));
    const got = expandRange(PERIOD, doc.rules, [], doc.unknown_periods);
    const nb = new Set(d.dates);
    const weeklyDays = {};
    for (const [group, cats] of Object.entries(GROUP_CATEGORIES)) {
      if (group === '燃やさないごみ') continue;
      for (const c of cats) weeklyDays[c] = d.weekly[group].map((i) => DOW[i]);
    }
    for (const iso of dates) {
      if (isUnknown(iso, doc.unknown_periods)) continue;
      const dow = DOW[(new Date(`${iso}T00:00:00`).getDay() + 6) % 7];
      const want = new Set();
      for (const [c, days] of Object.entries(weeklyDays)) if (days.includes(dow)) want.add(c);
      if (nb.has(iso)) for (const c of GROUP_CATEGORIES['燃やさないごみ']) want.add(c);
      const have = new Set(got.get(iso) ?? []);
      const same = want.size === have.size && [...want].every((c) => have.has(c));
      if (!same) {
        throw new Error(`自己検証で不一致: ${doc.metadata.course_name_ja} ${iso} `
          + `期待 [${[...want].sort()}] 展開 [${[...have].sort()}]`);
      }
      checked++;
    }
  }
  console.log(`自己検証: ${checked} 日枠で expandRange と抽出結果が一致`);
}

for (const c of CAT_ORDER) {
  if (!docs.some((d) => d.rules.some((r) => r.category === c))) throw new Error(`品目 ${c} がどのコースにも無い`);
}
if (daysOf('月・木').length !== 2 || dayIdx('日') !== 6) throw new Error('parse の曜日変換が壊れている');

console.log(`generated ${writeCourses(OUTDIR, PERIOD, docs)} courses`);
