// 飯能: 色ベース抽出の結果 (cache/extracted-*.json) から course YAML を生成する。
//
// meta.yaml / taxonomy.yaml は生成しない (手書きが正典)。ここが書くのは course-*.yaml だけ。
//
// 使い方: EXTRACTED_AT=YYYY-MM-DD node build.mjs
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { expandRange, periodDates, categoriesOn, nthOfMonth } from '../../_lib/schedule.mjs';
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

const CAT_JA = Object.fromEntries(Object.entries(ITEM2CAT).map(([ja, cat]) => [cat, ja]));
const DOW_JA = '日月火水木金土';

// 規則と実日付の食い違いを overrides に落とす。
//
// categoriesOn は「category override がある日は monthly 系の規則を丸ごと捨て、weekly と
// override の category だけを残す」という規約なので、差し替える日はその日の monthly 品目を
// **漏れなく全部** 並べる必要がある (1 つ書き忘れるとその品目が黙って消える)。
function buildOverrides(rules, events, course, closed) {
  const weeklyCats = new Set(rules.filter((r) => r.pattern === 'weekly').map((r) => r.category));
  const out = [];
  for (const day of dates) {
    const at = new Date(day + 'T00:00:00');
    const actual = [...events[day]].sort();
    const predicted = categoriesOn(at, rules, []).slice().sort();
    if (actual.join(',') === predicted.join(',')) continue;

    if (actual.length === 0) {
      // 規則が予測するのに収集が無い = 休んだ日。PDF に「休業」表示があるはず
      if (!closed.includes(day)) {
        throw new Error(`${course} ${day}: 収集が消えているのに「休業」表示が無い`);
      }
      continue; // cancelled は下でまとめて入れる
    }
    // weekly の品目が欠ける日は cancelled でしか表せない。全休止でないのに欠けるのは想定外
    for (const c of weeklyCats) {
      if (predicted.includes(c) && !actual.includes(c)) {
        throw new Error(`${course} ${day}: weekly の ${c} だけが欠けている (override で表せない)`);
      }
    }
    const wasJa = predicted.filter((c) => !weeklyCats.has(c)).map((c) => CAT_JA[c]).join('・');
    const note = `年始休業による繰り下げ (${nthOfMonth(at)}回目の${DOW_JA[at.getDay()]}曜は通常${wasJa || '収集なし'})`;
    for (const c of CAT_ORDER) {
      if (actual.includes(c) && !weeklyCats.has(c)) out.push({ date: day, category: c, note });
    }
  }
  // PDF が「休業」と書いた日を全部 cancelled にする。休業日はコースによって違う
  // (12/29 は A 系が休業・B 系は可燃を収集)。規則がその日に収集を予測しない場合も
  // 入れる — 日程は変わらないが、「市が休んだ日」がデータに残る。これが無いと
  // 利用者から見て年末年始に市が休むこと自体が読み取れない。
  for (const day of closed) {
    if (events[day].length) throw new Error(`${course} ${day}: 「休業」表示なのに収集がある`);
    out.push({ date: day, cancelled: true, note: '年末年始 休業(市カレンダーの表示どおり)' });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

const dates = periodDates(PERIOD);

// --- 1 周目: コースごとの events と rules を決める ---
const built = [];

for (const { course, slug, nameJa, areas } of COURSES) {
  const jsonPath = join(CACHE, `extracted-${PDF_FILE(slug).replace(/\.pdf$/, '')}.json`);
  if (!existsSync(jsonPath)) throw new Error(`抽出結果が無い: ${jsonPath} (先に extract.py を回す)`);
  const { items, closed } = JSON.parse(readFileSync(jsonPath, 'utf8'));

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

  const { rules } = classifyRules({ dates, events, catOrder: CAT_ORDER, foldMonthlyNth: true });
  built.push({ course, slug, nameJa, areas, events, rules, closed });
}

// --- 2 周目: overrides を作って course YAML を組み立てる ---
const docs = [];

for (const { course, slug, nameJa, areas, events, rules, closed } of built) {
  const overrides = buildOverrides(rules, events, course, closed);

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
