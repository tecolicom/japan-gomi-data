// 東秩父村: 「ごみの出し方」ページの表から course YAML を生成する。
//
// meta.yaml / taxonomy.yaml は生成しない (手書きが正典)。ここが書くのは course-*.yaml だけ。
//
// 使い方: node fetch.mjs && EXTRACTED_AT=YYYY-MM-DD node build.mjs
//
// 村全域が一律で地区割が無いため 1 コース。日付入りカレンダーが無いので、
// **抽出するのは日付ではなく規則そのもの**である。
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { periodDates, nthOfMonth } from '../../_lib/schedule.mjs';
import { courseDoc, writeCourses } from '../../_lib/emit.mjs';
import { parseSchedule } from './parse.mjs';
import { CACHE, PERIOD, EDITION_JA, SCHEDULE_URL } from './sources.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUTDIR = join(HERE, '../../../municipalities/saitama/higashichichibu-vill');

const EXTRACTED_AT = process.env.EXTRACTED_AT;
if (!EXTRACTED_AT) throw new Error('EXTRACTED_AT を環境変数で渡す (Date.now は使わない)');

// 出力順。course YAML の rules 順を決める (出力を決定的に保つため固定)
const CAT_ORDER = [
  'burnable', 'plastic', 'metal', 'hazardous', 'non_burnable',
  'pet_bottle', 'glass_bottle', 'paper', 'cloth', 'beverage_can',
];

const html = readFileSync(join(CACHE, 'gominodashikata.html'), 'utf8');
const { rules, seasonal } = parseSchedule(html);

for (const r of rules) {
  if (!CAT_ORDER.includes(r.category)) throw new Error(`CAT_ORDER に無い品目 "${r.category}"`);
}
rules.sort((a, b) => CAT_ORDER.indexOf(a.category) - CAT_ORDER.indexOf(b.category));

// 季節限定の追加収集 → overrides。
// 規則では書けない (「5〜10月だけ第1水も」を表す語彙が無い) ので日付に落とす。
const overrides = [];
for (const s of seasonal) {
  const months = new Set(s.months);
  for (const iso of periodDates(PERIOD)) {
    const d = new Date(`${iso}T00:00:00`);
    if (!months.has(d.getMonth() + 1)) continue;
    if (d.getDay() !== { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 }[s.day]) continue;
    if (nthOfMonth(d) !== s.occurrence) continue;
    overrides.push({
      date: iso,
      category: s.category,
      note: `夏季(${s.months[0]}〜${s.months[s.months.length - 1]}月)は第${s.occurrence}水曜もペットボトル収集`,
    });
  }
  if (!overrides.length) throw new Error(`季節限定の日が 1 件も作れない: ${JSON.stringify(s)}`);
}
overrides.sort((a, b) => a.date.localeCompare(b.date));

const doc = courseDoc({
  city: 'higashichichibu-vill',
  course: '1',
  areas: [{ name: '東秩父村' }],
  period: PERIOD,
  source: {
    edition_ja: EDITION_JA,
    source_url: SCHEDULE_URL,
    extracted_at: EXTRACTED_AT,
    extracted_by: 'claude-opus-5',
    verified_by:
      'Claude (村公式「ごみの出し方」ページの表から種別ごとの収集曜日を機械抽出。' +
      '村全域一律で地区割なし。資源プラ(第1・2・3・5金)と廃プラ(第4金)は正典 plastic に' +
      '統合され毎週金になる。ガラス類(第3火)は non_burnable。資源回収は第2水と第4水で' +
      '出せる品目が違い、衣類とアルミ缶は第4水のみ。ペットボトルは第3火に加え5〜10月の' +
      '第1水も収集 (overrides)。日付入りカレンダーが無いため独立照合ソースは無い)',
  },
  rules,
  overrides,
});

console.log(`rules ${rules.length} / overrides ${overrides.length}`);
console.log(`generated ${writeCourses(OUTDIR, PERIOD, [doc])} course`);
