// 中央区: 区公式「あなたの町のごみ・資源収集曜日」HTML 表 → course YAML。
//
// meta.yaml / taxonomy.yaml は生成しない (手書きが正典)。ここが書くのは course-*.yaml だけ。
//
// 使い方: node fetch.mjs && EXTRACTED_AT=YYYY-MM-DD node build.mjs
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { foldCourses, courseDoc, writeCourses } from '../../_lib/emit.mjs';
import { expandRange, periodDates } from '../../_lib/schedule.mjs';
import { parsePage, parseDays, splitChome, areaName } from './parse.mjs';
import {
  PERIOD, EDITION_JA, INDEX_URL, LG_CODE, CAT_ORDER, AREAS_JA,
  COLUMNS, EMITTED, GROUP_CATEGORIES,
} from './sources.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CACHE = join(HERE, 'cache');
const OUTDIR = join(HERE, '../../../municipalities/tokyo/chuo');
const DOW = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];

const EXTRACTED_AT = process.env.EXTRACTED_AT;
if (!EXTRACTED_AT) throw new Error('EXTRACTED_AT を環境変数で渡す (Date.now は使わない)');

// ---- 一次ソース ----

const pages = parsePage(readFileSync(join(CACHE, 'youbi.html'), 'utf8'), AREAS_JA);
const rows = pages.flatMap((p) => p.rows.map((r) => ({ ...r, areaJa: p.areaJa })));
console.log(`HTML 表: ${pages.map((p) => `${p.areaJa} ${p.rows.length}`).join(' / ')} = ${rows.length} 行`);

// ---- ABR 町字マスター ----

const abr = JSON.parse(readFileSync(join(CACHE, 'abr-town.json'), 'utf8')).towns;
const kanaOf = new Map();
const idOf = new Map();
const chomeOf = new Map();
for (const t of abr) {
  if (t.kana) kanaOf.set(t.oaza, t.kana);
  idOf.set(`${t.oaza}${t.chome_number ?? ''}`, t.id);
  if (!chomeOf.has(t.oaza)) chomeOf.set(t.oaza, []);
  chomeOf.get(t.oaza).push(t.chome_number);
}
for (const v of chomeOf.values()) v.sort((a, b) => (a ?? 0) - (b ?? 0));

// **区のページは日本橋地域の町名から「日本橋」を省いている。**
// 表の「蛎殻町」は正式には「日本橋蛎殻町」で、住民の住所表記もそちら。
// 素の名前で引けなければ「日本橋」を前置して引き直す。どちらでも引けなければ止める。
const NIHONBASHI = '日本橋';
function officialTown(town) {
  if (chomeOf.has(town)) return town;
  const pref = NIHONBASHI + town;
  if (chomeOf.has(pref)) return pref;
  throw new Error(`ABR に無い町 "${town}" (「${pref}」でも引けない)`);
}

// ---- 行 → area ----

const built = [];
const covered = new Set();
let prefixed = 0;
for (const r of rows) {
  const town = officialTown(r.town);
  if (town !== r.town) prefixed++;
  for (const sp of splitChome(r.chome)) {
    // 丁目を持つ町なのに「全域」なら、ABR の全丁目へ展開する (1 area = 1 丁目)
    const targets = sp.chome === null && sp.banchi === null && !chomeOf.get(town).includes(null)
      ? chomeOf.get(town).map((c) => ({ chome: c, banchi: null }))
      : [sp];
    for (const t of targets) {
      const key = `${town}${t.chome ?? ''}`;
      if (!idOf.has(key)) throw new Error(`ABR に無い町字 "${key}" (行: ${r.town} ${r.chome})`);
      // 番地で割れる町字は同じ machiaza_id を複数 area が共有する (その丁目の一部)
      if (!t.banchi && covered.has(key)) throw new Error(`町字 "${key}" が 2 回出る`);
      covered.add(key);
      const kana = kanaOf.get(town);
      built.push({
        row: r,
        area: {
          name: areaName(town, t),
          ...(kana ? { yomi: kana + (t.chome ?? '') + (t.banchi ? `-${/\d+/.exec(t.banchi)[0]}` : '') } : {}),
          machiaza_id: `${LG_CODE}-${idOf.get(key)}`,
        },
      });
    }
  }
}
console.log(`区の表記に「${NIHONBASHI}」を補った町: ${prefixed} 行 / area ${built.length}`);

// 検査 1: 区の全町字を覆っているか
{
  const all = new Set(idOf.keys());
  const missing = [...all].filter((k) => !covered.has(k));
  if (missing.length) throw new Error(`収集日が公表されていない町字: ${missing.join(', ')}`);
  console.log(`町字の網羅: ABR ${all.size} 件をちょうど被覆`);
}

// 検査 2: 曜日セルがすべて読めるか (未対応の表記があれば parseDays が throw する)
{
  const kinds = new Set();
  for (const r of rows) for (const d of r.days) { parseDays(d); kinds.add(d); }
  console.log(`曜日セル: ${rows.length} 行 × ${COLUMNS.length} 列 = ${rows.length * COLUMNS.length} セル / 表記 ${kinds.size} 種`);
}

// ---- コースへ畳む ----
//
// **粗大ごみは申込制なので収録しない。** そのぶん「4 品目は同じで粗大だけ違う」行が
// 同じコースに畳まれる (5 品目なら 26 通りだが 4 品目では 13 通り)。
// 中央区は区が地区番号を定義していないので、規則で畳むのが正しい表現 (練馬・豊島と同型)。
// 板橋のように区が地区を定義している場合は畳んではいけない。
const folded = foldCourses(
  built,
  (b) => {
    const rules = [];
    EMITTED.forEach((group, i) => {
      const days = parseDays(b.row.days[i]).map((n) => DOW[n]);
      for (const c of GROUP_CATEGORIES[group]) rules.push({ category: c, pattern: 'weekly', days });
    });
    rules.sort((x, y) => CAT_ORDER.indexOf(x.category) - CAT_ORDER.indexOf(y.category));
    return rules;
  },
  (b) => b.area,
);
console.log(`コース ${folded.length} (粗大を含めれば ${new Set(rows.map((r) => r.days.join('|'))).size} 通り)`);

const docs = folded.map(({ rules, areas }, i) => {
  areas.sort((a, b) => {
    const p = a.yomi ?? a.name, q = b.yomi ?? b.name;
    return p < q ? -1 : p > q ? 1 : (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  });
  return courseDoc({
    city: 'chuo',
    course: String(i + 1),
    areas,
    period: PERIOD,
    source: {
      edition_ja: EDITION_JA,
      source_url: INDEX_URL,
      extracted_at: EXTRACTED_AT,
      extracted_by: 'claude-opus-5',
      verified_by:
        'Claude (区公式「あなたの町のごみ・資源収集曜日」HTML 表 56 行の機械変換。'
        + '「ごみと資源の分け方・出し方」パンフレットの外国語版 3 種 (英・中・韓) に同じ曜日表が入っており、'
        + '56 行 × 5 品目 (収録しない粗大ごみを含む) で全数照合した。'
        + '粗大ごみは申込制のため収録しない。年末年始の記述が公表資料に無いため 11 月で期間を切っている)',
    },
    rules,
  });
});

// 検査 3: 自己検証 — 展開し直すと元の曜日セルと一致するか
{
  const dates = periodDates(PERIOD);
  let checked = 0;
  for (const [i, f] of folded.entries()) {
    const sample = built.find((b) => f.areas.includes(b.area));
    const got = expandRange(PERIOD, docs[i].rules, [], []);
    for (const iso of dates) {
      const dow = DOW[(new Date(`${iso}T00:00:00`).getDay() + 6) % 7];
      const want = new Set();
      EMITTED.forEach((group, ci) => {
        if (parseDays(sample.row.days[ci]).map((n) => DOW[n]).includes(dow)) {
          for (const c of GROUP_CATEGORIES[group]) want.add(c);
        }
      });
      const have = new Set(got.get(iso) ?? []);
      const same = want.size === have.size && [...want].every((c) => have.has(c));
      if (!same) {
        throw new Error(`自己検証で不一致: course ${i + 1} ${iso} 期待 [${[...want].sort()}] 展開 [${[...have].sort()}]`);
      }
      checked++;
    }
  }
  console.log(`自己検証: ${checked} 日枠で expandRange と曜日セルが一致`);
}

for (const c of CAT_ORDER) {
  if (!docs.some((d) => d.rules.some((r) => r.category === c))) throw new Error(`品目 ${c} がどのコースにも無い`);
}

console.log(`generated ${writeCourses(OUTDIR, PERIOD, docs)} courses`);
