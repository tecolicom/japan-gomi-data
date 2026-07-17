// 調布市: 地区別テキストカレンダー(cache/) → course YAML + meta.yaml + taxonomy.yaml。
//
// 各品目の収集日を「日付入りカレンダー」から機械抽出し、
//   - 通年その曜日を欠かさない品目 → weekly
//   - 年末年始のみ全停止する品目     → weekly + cancelled override
//   - 季節変動等で不規則な品目       → monthly_specific(実日付を列挙)
// に自動分類する。分類は categoriesOn() による再展開でカレンダーと完全一致することを
// build 内で自己検証する(不一致なら書き出さずエラー)。verify.mjs も同じ照合を行う。
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stringify as yamlStringify } from 'yaml';
import { parseCalendar, fiscalYearDates, DOW } from './parse.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..', '..');
const OUTDIR = join(ROOT, 'municipalities', 'tokyo', 'chofu');
const FY = 2026;

const DISTRICTS = ['1', '2', '3', '4'];
const areas = JSON.parse(readFileSync(join(HERE, 'areas.json'), 'utf8'));

// rules に並べる正典 category の順序
const CAT_ORDER = [
  'burnable', 'non_burnable', 'plastic', 'paper_cloth', 'paper',
  'glass_bottle', 'beverage_can', 'pet_bottle', 'hazardous',
];
const DOW_INDEX = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

const SOURCE_URL = (n) => `https://www.city.chofu.lg.jp/documents/16365/r8calendar_no${n}.txt`;

const dow = (iso) => new Date(iso + 'T00:00:00').getDay();

// build-ics.mjs categoriesOn() と等価な展開(この tool 用の再実装)
function categoriesOn(iso, rules, overrides) {
  const d = new Date(iso + 'T00:00:00');
  const dw = d.getDay();
  const occ = Math.floor((d.getDate() - 1) / 7) + 1;
  const weekly = new Set(), monthly = new Set();
  for (const r of rules) {
    const matchedDay = r.days?.some((x) => DOW_INDEX[x] === dw);
    if (r.pattern === 'weekly' && matchedDay) weekly.add(r.category);
    else if (r.pattern === 'monthly_nth' && matchedDay && r.occurrences?.includes(occ)) monthly.add(r.category);
    else if (r.pattern === 'monthly_specific' && (r.dates || []).includes(iso)) monthly.add(r.category);
  }
  const ovs = (overrides || []).filter((o) => o.date === iso);
  if (ovs.some((o) => o.cancelled)) return [];
  if (ovs.length === 0) return [...weekly, ...monthly];
  const final = new Set(weekly);
  for (const o of ovs) if (o.category) final.add(o.category);
  return [...final];
}

function buildCourse(n) {
  const text = readFileSync(join(HERE, 'cache', `r8calendar_no${n}.txt`), 'utf8');
  const events = parseCalendar(text);
  const fyDates = fiscalYearDates(FY);

  // カレンダーの収録範囲が FY と一致するか確認
  const evDates = [...events.keys()].sort();
  if (evDates[0] !== fyDates[0] || evDates[evDates.length - 1] !== fyDates[fyDates.length - 1]) {
    throw new Error(`地区${n}: カレンダー範囲 ${evDates[0]}..${evDates.at(-1)} が FY${FY} と不一致`);
  }

  // 全停止日(収集なし = 空配列)
  const fullStop = new Set(evDates.filter((d) => events.get(d).length === 0));

  // category -> 出現日(昇順)
  const catDates = new Map();
  for (const d of evDates) for (const c of events.get(d)) {
    if (!catDates.has(c)) catDates.set(c, []);
    catDates.get(c).push(d);
  }

  const rules = [];
  const specificCats = new Set();
  for (const c of CAT_ORDER) {
    if (!catDates.has(c)) continue;
    const dates = catDates.get(c);
    const dset = new Set(dates);
    // 主要曜日 = その曜日での出現が6回以上(年末年始の単発移動を除外)
    const cnt = {};
    for (const d of dates) cnt[d] = 0; // placeholder
    const wcnt = {};
    for (const d of dates) { const w = dow(d); wcnt[w] = (wcnt[w] || 0) + 1; }
    const domWd = Object.entries(wcnt).filter(([, k]) => k >= 6).map(([w]) => Number(w)).sort();
    const weeklyExp = fyDates.filter((d) => domWd.includes(dow(d)));
    const weeklyExpSet = new Set(weeklyExp);
    const weeklyMinusStop = weeklyExp.filter((d) => !fullStop.has(d));

    const eqExact = dates.length === weeklyExp.length && dates.every((d) => weeklyExpSet.has(d));
    const eqMinusStop = dates.length === weeklyMinusStop.length && weeklyMinusStop.every((d) => dset.has(d));

    if (domWd.length && (eqExact || eqMinusStop)) {
      rules.push({ category: c, pattern: 'weekly', days: domWd.map((w) => DOW[w]) });
    } else {
      rules.push({ category: c, pattern: 'monthly_specific', dates: [...dates] });
      specificCats.add(c);
    }
  }

  // overrides: 全停止日を cancelled で明示
  const overrides = [...fullStop].sort().map((d) => ({
    date: d, cancelled: true, note: '年末年始 収集なし(市カレンダーどおり)',
  }));

  // monthly_specific 品目が全停止日に載っていないこと(cancelled との競合防止)
  for (const c of specificCats) {
    for (const d of catDates.get(c)) if (fullStop.has(d)) {
      throw new Error(`地区${n}: monthly_specific ${c} が全停止日 ${d} を含む(overrides と競合)`);
    }
  }

  // 自己検証: rules+overrides を再展開してカレンダーと完全一致するか
  for (const d of fyDates) {
    const got = categoriesOn(d, rules, overrides).slice().sort();
    const exp = (events.get(d) || []).slice().sort();
    if (got.join(',') !== exp.join(',')) {
      throw new Error(`地区${n} 照合NG ${d}: got[${got}] exp[${exp}]`);
    }
  }

  return { rules, overrides, nDays: evDates.length };
}

function courseYaml(n, built) {
  const doc = {
    metadata: {
      city: 'chofu',
      course: n,
      course_name_ja: `第${n}地区`,
      areas: areas[n],
      year: FY,
      fiscal_year_ja: '令和8年度',
      source: {
        source_url: SOURCE_URL(n),
        extracted_at: '2026-07-17',
        extracted_by: 'claude-opus-4-8',
        verified_by: 'Claude(調布市ごみリサイクルカレンダー地区別テキスト版の機械抽出。日付入り通年カレンダーとcategoriesOn再展開で全日照合し完全一致)',
      },
    },
    rules: built.rules,
    overrides: built.overrides,
  };
  return yamlStringify(doc, { lineWidth: 0 });
}

// --- 実行 ---
mkdirSync(join(OUTDIR, String(FY)), { recursive: true });
let totalDays = 0;
for (const n of DISTRICTS) {
  const built = buildCourse(n);
  totalDays += built.nDays;
  const header =
    `# 調布市 第${n}地区 ${FY}年度(令和8年度)\n` +
    `# Auto-generated by tools/txt-extractor/chofu/build.mjs\n` +
    `# Source: ${SOURCE_URL(n)} (調布市ごみリサイクルカレンダー・テキスト版)\n` +
    `# 日付入り通年カレンダーから機械抽出し、categoriesOn 再展開で全日照合済み(相違ゼロ)。\n`;
  writeFileSync(join(OUTDIR, String(FY), `course-${n}.yaml`), header + courseYaml(n, built));
  console.log(`地区${n}: rules=${built.rules.length} overrides=${built.overrides.length} 照合OK`);
}

// taxonomy.yaml
const taxonomy = {
  categories: [
    'burnable', 'non_burnable', 'plastic', 'paper_cloth', 'paper',
    'glass_bottle', 'beverage_can', 'pet_bottle', 'hazardous',
  ],
  overrides: {
    burnable: { label: '燃やせるごみ' },
    non_burnable: { label: '燃やせないごみ' },
    plastic: { label: '容器包装プラスチック', short: '容プラ' },
    paper_cloth: { label: '古紙・古布' },
    paper: { label: 'シュレッダー紙', short: 'シュレッダー' },
    glass_bottle: { label: 'ビン' },
    beverage_can: { label: 'カン' },
  },
};
const taxHeader =
  '# 調布市。公式区分(ごみリサイクルカレンダー):\n' +
  '#   燃やせるごみ / 燃やせないごみ / 容器包装プラスチック / 古紙・古布 /\n' +
  '#   シュレッダー紙 / ビン / カン / ペットボトル / 有害ごみ\n' +
  '# シュレッダー紙(シュレッダーにかけた古紙)はビンと同日に週1収集され、\n' +
  '# 別日・週1の古紙・古布(paper_cloth)とは収集日が異なるため paper として分離。\n';
writeFileSync(join(OUTDIR, 'taxonomy.yaml'), taxHeader + yamlStringify(taxonomy, { lineWidth: 0 }));

// meta.yaml
const meta = {
  handle: 'chofu',
  name_ja: '調布市',
  region_ja: '東京都',
  code: '13208',
  source: {
    index_url: 'https://www.city.chofu.lg.jp/kurashi/gomirecycle/index.html',
    schedule_url: 'https://www.city.chofu.lg.jp/070030/p041249.html',
    yearend_url: 'https://www.city.chofu.lg.jp/kurashi/gomirecycle/index.html',
  },
  notes: [
    '一次ソース: 市公式「令和8年度版ごみリサイクルカレンダー」地区別テキスト版(第1〜第4地区)。日付入りの通年カレンダーで、祝日・お盆も含め全収集日が明示されている。',
    'ライセンス: カレンダー掲載ページは通常ページ(Copyright (c) Chofu. All rights reserved.)。市のオープンデータ(CC BY 4.0)には収集日程データセットは無く、収集日という事実データを抽出して収録している(練馬・杉並と同じ整理)。',
    '市内を4地区に分割。26町(調布市全町域=郵便番号一覧と完全一致)が丁目分割・重複なく各地区へ割り当てられる。',
    '祝日(振替休日含む)・お盆も通常どおり収集。休みは日曜と年末年始のみ。',
    'ペットボトルと燃やせないごみ(有害ごみ)は7〜9月に収集頻度が変わる(ペット: 通常4週2回→7〜9月4週3回、燃やせないごみ・有害: 通常4週2回→7〜9月4週1回)。このため両者は weekly でなく monthly_specific(実日付列挙)で収録。燃やせないごみと有害ごみは常に同日。',
    'シュレッダー紙(paper)はビン(glass_bottle)と同日に週1収集。古紙・古布(paper_cloth)は別日に週1収集で、両者は別区分。',
    '年末年始は市カレンダー上「12/31・1/1が収集なし」で、12/29〜12/30は品目を絞って収集(例: 火曜のカン休止・プラを12/30へ前倒し等)。この移動・停止はカレンダー実日付どおりに反映済み(overrides の cancelled は12/31・1/1、移動品目は monthly_specific 側で処理)。次年度は市の新カレンダー公開後に再取得のこと。',
    '検証(2026-07-17): 地区別テキストカレンダー(第1〜第4地区)を機械抽出し、rules+overrides を categoriesOn で通年(2026-04-01〜2027-03-31)再展開して全日照合、相違ゼロ。町名の地区割当は日本郵便の全26町域と完全一致、読みは郵便番号カナ由来。',
  ],
};
const metaHeader = '';
writeFileSync(join(OUTDIR, 'meta.yaml'), metaHeader + yamlStringify(meta, { lineWidth: 0 }));

console.log(`\nwrote meta.yaml, taxonomy.yaml, 4 courses. 総収録日数(4地区計)=${totalDays}`);
