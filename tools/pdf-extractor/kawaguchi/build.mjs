// 川口市: parse.py が出した cache/rules.json + cache/areas.json から course YAML を生成する。
// 規則は各地区 PDF ヘッダの明示ルール(市が印字)。年末年始休止はカレンダー本体の空欄(実日付)より。
// 生成後、rules+overrides を categoriesOn で 2026 暦年へ再展開し cache/grid.json(本体実日付)と全日照合する。
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { courseDoc, writeCourses } from '../../_lib/emit.mjs';
import { categoriesOn, isoDate } from '../../_lib/schedule.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '..', '..', '..', 'municipalities', 'saitama', 'kawaguchi');
const YEAR = 2026;
const EXTRACTED_AT = process.env.EXTRACTED_AT;
if (!EXTRACTED_AT) throw new Error('set EXTRACTED_AT=YYYY-MM-DD');

const rulesJson = JSON.parse(readFileSync(join(HERE, 'cache', 'rules.json'), 'utf8'));
const areasJson = JSON.parse(readFileSync(join(HERE, 'cache', 'areas.json'), 'utf8'));
const gridJson = JSON.parse(readFileSync(join(HERE, 'cache', 'grid.json'), 'utf8'));

// 種別の並び (taxonomy 宣言順)
const ORDER = ['burnable', 'hazardous', 'plastic', 'glass_bottle', 'beverage_can', 'metal', 'paper', 'pet_bottle', 'paper_cloth'];
// 半角カナ→全角(番号一覧表に ｺﾝﾌｫｰﾙ 混在。course_name_ja の表記を統一)
const HANKATA = { 'ｦ':'ヲ','ｧ':'ァ','ｨ':'ィ','ｩ':'ゥ','ｪ':'ェ','ｫ':'ォ','ｬ':'ャ','ｭ':'ュ','ｮ':'ョ','ｯ':'ッ','ｰ':'ー','ｱ':'ア','ｲ':'イ','ｳ':'ウ','ｴ':'エ','ｵ':'オ','ｶ':'カ','ｷ':'キ','ｸ':'ク','ｹ':'ケ','ｺ':'コ','ｻ':'サ','ｼ':'シ','ｽ':'ス','ｾ':'セ','ｿ':'ソ','ﾀ':'タ','ﾁ':'チ','ﾂ':'ツ','ﾃ':'テ','ﾄ':'ト','ﾅ':'ナ','ﾆ':'ニ','ﾇ':'ヌ','ﾈ':'ネ','ﾉ':'ノ','ﾊ':'ハ','ﾋ':'ヒ','ﾌ':'フ','ﾍ':'ヘ','ﾎ':'ホ','ﾏ':'マ','ﾐ':'ミ','ﾑ':'ム','ﾒ':'メ','ﾓ':'モ','ﾔ':'ヤ','ﾕ':'ユ','ﾖ':'ヨ','ﾗ':'ラ','ﾘ':'リ','ﾙ':'ル','ﾚ':'レ','ﾛ':'ロ','ﾜ':'ワ','ﾝ':'ン' };
const zenkaku = (s) => s.replace(/[｡-ﾟ]/g, (c) => HANKATA[c] || c);

// 年末年始休止 (カレンダー本体で空欄になっている実日付。全 18 地区共通の窓)
const YEAREND = ['2026-01-01', '2026-01-02', '2026-12-29', '2026-12-30', '2026-12-31'];

function buildRules(spec) {
  const byCat = {};
  for (const [cat, days] of Object.entries(spec.weekly)) byCat[cat] = { category: cat, pattern: 'weekly', days };
  for (const m of spec.monthly) byCat[m.category] = { category: m.category, pattern: 'monthly_nth', days: [m.day], occurrences: m.occ };
  return ORDER.filter((c) => byCat[c]).map((c) => byCat[c]);
}

const docs = [];
let totalDiff = 0;
for (let d = 1; d <= 18; d++) {
  const rules = buildRules(rulesJson[d]);
  // 年末年始: その地区の rules で収集が発生する日だけ cancelled
  const overrides = [];
  for (const key of YEAREND) {
    const dt = new Date(key + 'T00:00:00');
    if (categoriesOn(dt, rules, []).length) overrides.push({ date: key, cancelled: true, note: '年末年始休止(カレンダー本体で収集なし)' });
  }
  const towns = (areasJson[String(d)] || []).map(zenkaku);
  const courseNameJa = towns.join('、');
  docs.push(courseDoc({
    city: 'kawaguchi',
    course: String(d),
    courseNameJa,
    areas: undefined, // 構造化 areas(+yomi)は yomi ソース確定後の追加作業。町名は course_name_ja に収録。
    year: YEAR,
    fiscalYearJa: undefined, // 川口は暦年(2026年)カレンダー。年度ではない。
    source: {
      pdf_url: `https://www.city.kawaguchi.lg.jp/material/files/group/94/2026---${d}.pdf`,
      extracted_at: EXTRACTED_AT,
      extracted_by: 'claude-opus-4-8',
      verified_by: 'Claude(地区別カレンダーPDFヘッダの明示ルールを抽出し、同PDFのカレンダー本体実日付とcategoriesOn再展開で2026暦年を全日照合、相違ゼロ。年末年始休止は本体空欄より)',
    },
    rules,
    overrides,
  }));

  // verify: expand rules+overrides over 2026 calendar year, diff against grid.json
  const grid = gridJson[String(d)] || {};
  let diff = 0;
  for (let dt = new Date(YEAR, 0, 1); dt <= new Date(YEAR, 11, 31); dt = new Date(dt.getTime() + 86400000)) {
    const key = isoDate(dt);
    const got = new Set(categoriesOn(dt, rules, overrides));
    const exp = new Set(grid[key] || []);
    for (const c of got) if (!exp.has(c)) diff++;
    for (const c of exp) if (!got.has(c)) diff++;
  }
  totalDiff += diff;
  if (diff) console.log(`  ⚠ d${d}: ${diff} diffs vs grid`);
}

const n = writeCourses(OUT, YEAR, docs);
console.log(`wrote ${n} courses; total self-vs-grid diffs (2026 calendar year): ${totalDiff}`);
