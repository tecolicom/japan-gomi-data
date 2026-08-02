// 毛呂山町: extract.py が出した cache/records.json (A/B/C地区の 日付→品目) から、
// 各品目の収集パターン(weekly / monthly_nth)を導出して course YAML を出力する。
// 品目→正典カテゴリ: 可燃=burnable / 不燃=non_burnable / 他プラ=plastic /
//   びん缶=glass_bottle+beverage_can(同日) / 有害=hazardous / 紙(布)=paper+cloth(同日) / ペット=pet_bottle。
// 毛呂山は祝日も収集(振替なし)のためパターンで表現でき、年末年始等の逸脱のみ override にする。
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { courseDoc, writeCourses } from '../../_lib/emit.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '..', '..', '..', 'municipalities', 'saitama', 'moroyama-town');
const YEAR = 2026;
const FY_JA = '令和8年度';
const EXTRACTED_AT = process.env.EXTRACTED_AT || (() => { throw new Error('EXTRACTED_AT env 必須'); })();
const PDF_BASE = 'http://www.hozenkumiai.or.jp/pdf';
const INDEX_URL = 'https://www.town.moroyama.saitama.jp/';

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

// 品目の日付配列 → { pattern, days, occurrences } パターン導出。
// 主曜日(出現>=8) を採り、各曜日が第1〜5をほぼ揃える(>=4種)なら weekly、特定第n のみなら monthly_nth。
function derivePattern(dates) {
  const byDow = new Map(); // dow -> Set(nth)
  const cntDow = new Map();
  for (const s of dates) {
    const d = parseDate(s);
    const w = d.getUTCDay();
    if (!byDow.has(w)) byDow.set(w, new Set());
    byDow.get(w).add(nthOf(d));
    cntDow.set(w, (cntDow.get(w) || 0) + 1);
  }
  const mainDows = [...cntDow.entries()].filter(([, c]) => c >= 8).map(([w]) => w).sort((a, b) => a - b);
  const weeklyDows = mainDows.filter((w) => byDow.get(w).size >= 4);
  const nthDows = mainDows.filter((w) => byDow.get(w).size < 4);
  const rules = [];
  if (weeklyDows.length) rules.push({ pattern: 'weekly', days: weeklyDows.map((w) => DOW[w]) });
  // 第n曜日は曜日ごとに occurrences をまとめる(通常1曜日)
  for (const w of nthDows) {
    const occ = [...byDow.get(w)].sort((a, b) => a - b);
    rules.push({ pattern: 'monthly_nth', days: [DOW[w]], occurrences: occ });
  }
  return { rules, mainDows, dropped: [...cntDow.entries()].filter(([, c]) => c < 8) };
}

// パターンで FY(2026-04〜2027-03)の該当日を生成 (照合・override 検出用)
function genDates(rule) {
  const out = [];
  for (let m = 0; m < 12; m++) {
    const month = (3 + m) % 12 + 1;      // 4,5,...,12,1,2,3
    const year = month >= 4 ? 2026 : 2027;
    const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
    for (let day = 1; day <= days; day++) {
      const d = new Date(Date.UTC(year, month - 1, day));
      const w = DOW[d.getUTCDay()];
      if (!rule.days.includes(w)) continue;
      if (rule.pattern === 'monthly_nth' && !rule.occurrences.includes(nthOf(d))) continue;
      out.push(d.toISOString().slice(0, 10));
    }
  }
  return out;
}

const records = JSON.parse(readFileSync(join(HERE, 'cache', 'records.json'), 'utf8'));
const docs = [];
const anomalies = [];

for (const rec of records) {
  const dist = rec.district;
  // 品目 → 日付配列
  const byItem = new Map();
  for (const [date, items] of Object.entries(rec.dates))
    for (const it of items) { if (!byItem.has(it)) byItem.set(it, []); byItem.get(it).push(date); }

  const rules = [];
  const overrideSet = new Map(); // date -> Set(category cancelled)
  for (const [item, cats] of Object.entries(ITEM_CAT)) {
    const dates = byItem.get(item) || [];
    if (!dates.length) { anomalies.push(`${dist}: ${item} が0件`); continue; }
    const { rules: itemRules, dropped } = derivePattern(dates);
    for (const [w, c] of dropped) anomalies.push(`${dist}/${item}: 少数曜日 ${DOW[w]}×${c}回 をパターンから除外`);
    // パターン日 vs 実日付 の差分 → 休止(パターンにあり実に無い)
    const actual = new Set(dates);
    const gen = new Set(itemRules.flatMap(genDates));
    const missing = [...gen].filter((d) => !actual.has(d));       // 休止候補 (パターンにあり実に無い)
    for (const d of missing) for (const c of cats) {
      if (!overrideSet.has(d)) overrideSet.set(d, new Set());
      overrideSet.get(d).add(c);
    }
    const extra = [...actual].filter((d) => !gen.has(d));          // パターン外の実収集日 (振替/臨時/誤り)
    for (const d of extra) anomalies.push(`${dist}/${item}: パターン外の実収集日 ${d}`);
    for (const r of itemRules) for (const c of cats) rules.push({ category: c, ...r });
  }
  rules.sort((a, b) => catRank(a.category) - catRank(b.category) ||
    (a.pattern < b.pattern ? -1 : 1));

  // overrides: 休止日 (category ごと cancelled)。年末年始等。
  const overrides = [];
  for (const [date, cats] of [...overrideSet.entries()].sort())
    for (const c of [...cats].sort((a, b) => catRank(a) - catRank(b)))
      overrides.push({ date, category: c, cancelled: true });

  docs.push(courseDoc({
    city: 'moroyama-town',
    course: dist,
    courseNameJa: `${dist.toUpperCase()}地区`,
    areas: [{ name: `${dist.toUpperCase()}地区` }],
    year: YEAR,
    fiscalYearJa: FY_JA,
    source: {
      source_url: INDEX_URL,
      pdf_url: `${PDF_BASE}/moroyama2026_${dist}.pdf`,
      extracted_at: EXTRACTED_AT,
      extracted_by: 'claude-opus-4-8',
      verified_by: 'Claude(埼玉西部環境保全組合の令和8年度収集カレンダーPDFを pdfplumber 座標抽出し、各品目の実収集日から曜日+第n パターンを導出。祝日も収集する運用のためパターンで表現し、パターンからの逸脱(年末年始休止)は overrides に cancelled で記録。日付は実カレンダー由来)',
    },
    rules,
    overrides,
  }));
}

const n = writeCourses(OUT, YEAR, docs);
console.log(`wrote ${n} courses (A/B/C地区) → ${OUT}/${YEAR}/`);
for (const d of docs) console.log(`  ${d.metadata.course}: rules ${d.rules.length} / overrides ${(d.overrides || []).length}`);
if (anomalies.length) { console.log('--- 逸脱/注意 ---'); anomalies.forEach((a) => console.log('  ' + a)); }
