// 飯能: 色ベース抽出の結果 (cache/extracted-*.json) から course YAML を生成する。
//
// meta.yaml / taxonomy.yaml は生成しない (手書きが正典)。ここが書くのは course-*.yaml だけ。
//
// 使い方: EXTRACTED_AT=YYYY-MM-DD node build.mjs
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { expandRange, periodDates, cancelledOverrides } from '../../_lib/schedule.mjs';
import { courseDoc, writeCourses } from '../../_lib/emit.mjs';
import { classifyRules } from '../../_lib/classify.mjs';
import { COURSES, PERIOD, EDITION_JA, CACHE, HERE, PDF_URL, PDF_FILE } from './sources.mjs';

const EXTRACTED_AT = process.env.EXTRACTED_AT;
if (!EXTRACTED_AT) throw new Error('EXTRACTED_AT を環境変数で渡す (Date.now は使わない)');

const OUTDIR = join(HERE, '..', '..', '..', 'municipalities', 'saitama', 'hanno');

// extract.py の品目名 → 正典 category
const ITEM2CAT = {
  可燃: 'burnable',
  不燃: 'non_burnable',
  プラ: 'plastic',
  ペット: 'pet_bottle',
  飲料缶: 'beverage_can',
  びん: 'glass_bottle',
  紙布: 'paper_cloth',
  有害: 'hazardous',
  粗大: 'oversized',
};

// schema/categories.yaml の並び順
const CAT_ORDER = [
  'burnable', 'non_burnable', 'plastic', 'pet_bottle', 'beverage_can',
  'glass_bottle', 'paper_cloth', 'hazardous', 'oversized',
];

const VERIFIED_BY =
  'Claude(飯能市「家庭ごみ収集カレンダー」令和8年度のコース別PDFの色ベース抽出。' +
  'テキスト層が無くコース名も日番号もアウトライン図版のため、罫線から復元したグリッドと暦で' +
  '決めたセル領域の塗り色だけで品目を判定。expandRange 再展開で全365日を自己照合し、' +
  '6コース×365日=2190日枠を PDF 画像の目視転記と全数照合)';

const dates = periodDates(PERIOD);
const docs = [];

for (const { course, slug, nameJa, areas } of COURSES) {
  const jsonPath = join(CACHE, `extracted-${PDF_FILE(slug).replace(/\.pdf$/, '')}.json`);
  if (!existsSync(jsonPath)) throw new Error(`抽出結果が無い: ${jsonPath} (先に extract.py を回す)`);
  const { items } = JSON.parse(readFileSync(jsonPath, 'utf8'));

  // 収録期間の全日付を覆う events を作る (収集なしの日も空配列で明示する)
  const events = Object.fromEntries(dates.map((d) => [d, []]));
  for (const [nameItem, days] of Object.entries(items)) {
    const cat = ITEM2CAT[nameItem];
    if (!cat) throw new Error(`${course}: 未知の品目 "${nameItem}"`);
    for (const d of days) {
      if (!(d in events)) throw new Error(`${course}: 収録期間外の日付 ${d}`);
      if (!events[d].includes(cat)) events[d].push(cat);
    }
  }

  const { rules, stopDays } = classifyRules({ dates, events, catOrder: CAT_ORDER });
  const overrides = cancelledOverrides(rules, [...stopDays].sort(), '年末年始 収集なし(市カレンダーどおり)');

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
      city: 'hanno',
      course,
      courseNameJa: nameJa,
      areas,
      period: PERIOD,
      source: {
        edition_ja: EDITION_JA,
        source_url: PDF_URL(slug),
        extracted_at: EXTRACTED_AT,
        extracted_by: 'claude-opus-5',
        verified_by: VERIFIED_BY,
      },
      rules,
      overrides,
    }),
  );
  console.log(`${course} ${nameJa}: areas ${areas.length} / rules ${rules.length} / overrides ${overrides.length} 照合OK`);
}

console.log(`generated ${writeCourses(OUTDIR, PERIOD, docs)} courses`);
