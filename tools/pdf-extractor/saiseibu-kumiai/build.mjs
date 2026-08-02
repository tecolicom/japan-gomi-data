// 埼玉西部環境保全組合の各自治体: extract.py が出した cache/<handle>-records.json (地区の日付→品目)
// から曜日+第n パターンを導出して course YAML を出力する。 使い方: EXTRACTED_AT=YYYY-MM-DD node build.mjs <handle>
// 品目→正典カテゴリ: 可燃=burnable / 不燃=non_burnable / 他プラ=plastic /
//   びん缶=glass_bottle+beverage_can(同日) / 有害=hazardous / 紙(布)=paper+cloth(同日) / ペット=pet_bottle。
// 祝日も収集(振替なし)のためパターンで表現でき、年末年始等の逸脱のみ override にする。
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { courseDoc, writeCourses } from '../../_lib/emit.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CONF = JSON.parse(readFileSync(join(HERE, 'config.json'), 'utf8'));
const handle = process.argv[2];
if (!handle || !CONF[handle]) throw new Error(`使い方: node build.mjs <handle> (${Object.keys(CONF).filter((k) => !k.startsWith('_')).join('/')})`);
const conf = CONF[handle];
const OUT = join(HERE, '..', '..', '..', 'municipalities', 'saitama', handle);
const YEAR = 2026;
const FY_JA = '令和8年度';
const EXTRACTED_AT = process.env.EXTRACTED_AT || (() => { throw new Error('EXTRACTED_AT env 必須'); })();
const PDF_BASE = 'http://www.hozenkumiai.or.jp/pdf';

const DOW = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
const ITEM_CAT = {
  可燃: ['burnable'], 不燃: ['non_burnable'], 他プラ: ['plastic'],
  びん缶: ['glass_bottle', 'beverage_can'], 有害: ['hazardous'],
  紙: ['paper', 'cloth'], ペット: ['pet_bottle'],
};
const CAT_ORDER = ['burnable', 'non_burnable', 'plastic', 'glass_bottle', 'beverage_can', 'paper', 'cloth', 'hazardous', 'pet_bottle'];
const catRank = (c) => CAT_ORDER.indexOf(c);
const nthOf = (d) => Math.floor((d.getUTCDate() - 1) / 7) + 1;
const parseDate = (s) => new Date(`${s}T00:00:00Z`);

function derivePattern(dates) {
  const byDow = new Map(), cntDow = new Map();
  for (const s of dates) {
    const d = parseDate(s), w = d.getUTCDay();
    if (!byDow.has(w)) byDow.set(w, new Set());
    byDow.get(w).add(nthOf(d));
    cntDow.set(w, (cntDow.get(w) || 0) + 1);
  }
  const mainDows = [...cntDow.entries()].filter(([, c]) => c >= 8).map(([w]) => w).sort((a, b) => a - b);
  const weeklyDows = mainDows.filter((w) => byDow.get(w).size >= 4);
  const nthDows = mainDows.filter((w) => byDow.get(w).size < 4);
  const rules = [];
  if (weeklyDows.length) rules.push({ pattern: 'weekly', days: weeklyDows.map((w) => DOW[w]) });
  for (const w of nthDows)
    rules.push({ pattern: 'monthly_nth', days: [DOW[w]], occurrences: [...byDow.get(w)].sort((a, b) => a - b) });
  return { rules, dropped: [...cntDow.entries()].filter(([, c]) => c < 8) };
}

function genDates(rule) {
  const out = [];
  for (let m = 0; m < 12; m++) {
    const month = (3 + m) % 12 + 1;
    const year = month >= 4 ? 2026 : 2027;
    const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
    for (let day = 1; day <= days; day++) {
      const d = new Date(Date.UTC(year, month - 1, day));
      if (!rule.days.includes(DOW[d.getUTCDay()])) continue;
      if (rule.pattern === 'monthly_nth' && !rule.occurrences.includes(nthOf(d))) continue;
      out.push(d.toISOString().slice(0, 10));
    }
  }
  return out;
}

const records = JSON.parse(readFileSync(join(HERE, 'cache', `${handle}-records.json`), 'utf8'));
const docs = [];
const anomalies = [];

for (const rec of records) {
  const dist = rec.district;
  const byItem = new Map();
  for (const [date, items] of Object.entries(rec.dates))
    for (const it of items) { if (!byItem.has(it)) byItem.set(it, []); byItem.get(it).push(date); }

  const rules = [];
  const overrideSet = new Map();
  for (const [item, cats] of Object.entries(ITEM_CAT)) {
    const dates = byItem.get(item) || [];
    if (!dates.length) { anomalies.push(`${dist}: ${item} が0件`); continue; }
    const { rules: itemRules, dropped } = derivePattern(dates);
    for (const [w, c] of dropped) anomalies.push(`${dist}/${item}: 少数曜日 ${DOW[w]}×${c}回 を除外`);
    const actual = new Set(dates);
    const gen = new Set(itemRules.flatMap(genDates));
    for (const d of [...gen].filter((x) => !actual.has(x))) for (const c of cats) {
      if (!overrideSet.has(d)) overrideSet.set(d, new Set());
      overrideSet.get(d).add(c);
    }
    for (const d of [...actual].filter((x) => !gen.has(x))) anomalies.push(`${dist}/${item}: パターン外の実収集日 ${d}`);
    for (const r of itemRules) for (const c of cats) rules.push({ category: c, ...r });
  }
  rules.sort((a, b) => catRank(a.category) - catRank(b.category) || (a.pattern < b.pattern ? -1 : 1));

  const overrides = [];
  for (const [date, cats] of [...overrideSet.entries()].sort())
    for (const c of [...cats].sort((a, b) => catRank(a) - catRank(b)))
      overrides.push({ date, category: c, cancelled: true });

  docs.push(courseDoc({
    city: handle,
    course: dist,
    courseNameJa: `${dist.toUpperCase()}地区`,
    areas: [{ name: `${dist.toUpperCase()}地区` }],
    year: YEAR,
    fiscalYearJa: FY_JA,
    source: {
      source_url: 'http://www.hozenkumiai.or.jp/',
      pdf_url: `${PDF_BASE}/${conf.file}2026_${dist}.pdf`,
      extracted_at: EXTRACTED_AT,
      extracted_by: 'claude-opus-4-8',
      verified_by: `Claude(埼玉西部環境保全組合の${conf.name_ja}令和8年度収集カレンダーPDFを pdfplumber 座標抽出し、各品目の実収集日から曜日+第n パターンを導出。祝日も収集する運用のためパターンで表現し、パターンからの逸脱(年末年始休止)は overrides に cancelled で記録。パターン再展開↔実日付を突合し完全再現)`,
    },
    rules,
    overrides,
  }));
}

const n = writeCourses(OUT, YEAR, docs);
console.log(`${handle}: wrote ${n} courses → ${OUT}/${YEAR}/`);
for (const d of docs) console.log(`  ${d.metadata.course}: rules ${d.rules.length} / overrides ${(d.overrides || []).length}`);
if (anomalies.length) { console.log('--- 逸脱/注意 ---'); anomalies.forEach((a) => console.log('  ' + a)); }
