// 岡山市: fetch.mjs が取得した cache/records.json (844行) を正典カテゴリの rules へ写像し、
// 同一日程を市全域で畳んで course YAML を出力する。
//
// 種別マッピング (taxonomy.yaml と一致・市公式の分別定義に基づく):
//   可燃ごみ(ドロップダウン_3)      -> burnable        (weekly)
//   不燃ごみ(ドロップダウン_4)      -> non_burnable    (monthly_nth)
//   資源化物(ドロップダウン_6)      -> 同一収集日に一括の6品目へ分解 (monthly_nth):
//       ガラスびん=glass_bottle / 空き缶=beverage_can / スプレー缶=spray_can /
//       ペットボトル=pet_bottle / 古紙=paper / 古布=cloth
//       (市公式 https://www.city.okayama.jp/kurashi/0000005214.html で構成品目を裏取り)
//   プラスチック資源(ドロップダウン_7) -> plastic       (weekly)
//
// 畳み込み: 4フィールドの日程シグネチャで市全域を畳む。小学校区(district)は行政区の下位で
//   ソースの地区単位だが行政区への対応表が公開に無いため、コース slug は okayama-<n> とし、
//   小学校区と町名は course_name_ja に人間可読で保持する (詳細は README)。
//   町丁目カナの権威ソースが repo に無く 町内会単位の備考が地区区別子のため、構造化 areas は付けない
//   (倉敷と同方針。推測でカナを作らない)。
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { foldCourses, courseDoc, writeCourses } from '../../_lib/emit.mjs';
import { fragmentsExpecting } from './parse.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..', '..');
const OUTDIR = join(ROOT, 'municipalities', 'okayama', 'okayama');
const YEAR = 2026;
const FY_JA = '令和8年度';
const EXTRACTED_AT = process.env.EXTRACTED_AT || (() => { throw new Error('EXTRACTED_AT env 必須'); })();
const EXTRACTED_BY = 'claude-opus-4-8';
const SOURCE_URL = 'https://f5d44204.viewer.kintoneapp.com/public/bba750ccc0622ed0ea1ee9803b60537753367b11af275de1ad0d1507c414d779';
const CATEGORY_URL = 'https://www.city.okayama.jp/kurashi/category/1-12-7-10-3-0-0-0-0-0.html';

// 資源化物の同日一括6品目
const RECYCLE_CATS = ['glass_bottle', 'beverage_can', 'spray_can', 'pet_bottle', 'paper', 'cloth'];
// 署名安定用のカテゴリ順
const CAT_ORDER = ['burnable', 'non_burnable', 'glass_bottle', 'beverage_can', 'spray_can',
  'pet_bottle', 'paper', 'cloth', 'plastic'];
const catRank = (c) => { const i = CAT_ORDER.indexOf(c); if (i < 0) throw new Error(`未知カテゴリ ${c}`); return i; };

// 1 行 -> rules。資源化物断片は6カテゴリで days/occurrences 配列を参照共有し YAML anchor 化する。
function toRules(rec) {
  const rules = [];
  for (const f of fragmentsExpecting(rec.burnable, 'weekly', '可燃'))
    rules.push({ category: 'burnable', pattern: f.pattern, days: f.days });
  for (const f of fragmentsExpecting(rec.nonburnable, 'monthly_nth', '不燃'))
    rules.push({ category: 'non_burnable', pattern: f.pattern, days: f.days, occurrences: f.occurrences });
  const recFrags = fragmentsExpecting(rec.recycle, 'monthly_nth', '資源化物');
  for (const cat of RECYCLE_CATS)
    for (const f of recFrags)
      rules.push({ category: cat, pattern: f.pattern, days: f.days, occurrences: f.occurrences });
  for (const f of fragmentsExpecting(rec.plastic, 'weekly', 'プラ資源'))
    rules.push({ category: 'plastic', pattern: f.pattern, days: f.days });
  // カテゴリ順で整列 (署名安定)。同カテゴリ内は断片順を保持。
  return rules
    .map((r, i) => [r, i])
    .sort((a, b) => catRank(a[0].category) - catRank(b[0].category) || a[1] - b[1])
    .map(([r]) => r);
}

// 行のラベル: 町名 (+備考は括弧で原文保持)
const rowLabel = (r) => (r.note && r.note.trim() ? `${r.town}（${r.note.trim()}）` : r.town);

const payload = JSON.parse(readFileSync(join(HERE, 'cache', 'records.json'), 'utf8'));
const records = [...payload.records].sort((a, b) => Number(a.id) - Number(b.id));

// 市全域を日程シグネチャで畳む。areas は行(小学校区+町名+備考)を保持。
const folded = foldCourses(records, toRules, (r) => r);

// 出現順(最初の行の id)でコース番号を安定化
folded.sort((a, b) => Number(a.areas[0].id) - Number(b.areas[0].id));

// 年末年始のうち複数年実績で不変の部分のみ反映 (詳細は meta.yaml notes):
//   市告知 (Wayback 令和2/4/5年度) は「年末は12/29または12/30まで・年始は1/4から」で、
//   共通する不変部分は 12/31〜1/3 休止。12/30 は年により収集する年としない年がある。
//   休止日に当たる地区の振替は毎年12月の「年末年始収集日変更一覧」PDF で告知されるため未反映。
//   2026年度の実効休止日は 12/31(木)・1/1(金) のみ (1/2土・1/3日は元々収集なし、
//   12/31 は第5木曜のため monthly_nth は非該当 = weekly 該当分のみ)。
const DAY_TO_INDEX = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };
function yearEndOverrides(rules) {
  const out = [];
  for (const iso of ['2026-12-31', '2027-01-01', '2027-01-02', '2027-01-03']) {
    const d = new Date(iso + 'T00:00:00');
    const occ = Math.floor((d.getDate() - 1) / 7) + 1;
    const hit = rules.some((r) => (r.days || []).some((x) => DAY_TO_INDEX[x] === d.getDay()) &&
      (r.pattern === 'weekly' || (r.pattern === 'monthly_nth' && r.occurrences.includes(occ))));
    if (hit) out.push({ date: iso, cancelled: true, note: '年末年始休止(12/31〜1/3。令和2・4・5年度の市告知に共通する不変部分。振替は12月の変更一覧で要確認)' });
  }
  return out;
}

const docs = folded.map((c, i) => {
  // course_name_ja: 小学校区ごとに町名(備考)を束ねる
  const byDist = new Map();
  for (const r of c.areas) {
    if (!byDist.has(r.district)) byDist.set(r.district, []);
    byDist.get(r.district).push(rowLabel(r));
  }
  const courseNameJa = [...byDist.entries()].map(([d, ts]) => `${d}: ${ts.join('／')}`).join(' ｜ ');
  return courseDoc({
    city: 'okayama',
    course: `okayama-${i + 1}`,
    courseNameJa,
    areas: undefined,
    year: YEAR,
    fiscalYearJa: FY_JA,
    source: {
      source_url: SOURCE_URL,
      extracted_at: EXTRACTED_AT,
      extracted_by: EXTRACTED_BY,
      verified_by: 'Claude(市公式 kViewer「収集曜日一覧」records API を機械取得。API取得×ブラウザ取得の2経路で全844行突合一致、JS/Python 2実装でパース突合一致。資源化物の構成品目は市公式分別ページで裏取り。日付入り年間カレンダー・原簿の独立照合は kViewer が唯一の公開のため不可)',
    },
    rules: c.rules,
    overrides: yearEndOverrides(c.rules),
  });
});

const n = writeCourses(OUTDIR, YEAR, docs);
console.log(`wrote ${n} courses (from ${records.length} rows) -> ${OUTDIR}/${YEAR}/`);
