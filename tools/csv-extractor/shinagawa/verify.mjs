// 生成した course YAML を、一次ソースの規則から独立に組み立てた期待日程と通年照合する。
//
// build.mjs が使う _lib/schedule.mjs (categoriesOn/expandFiscalYear) には依存せず、
// ここでは素朴な日次ループで期待日程を作る。両者が一致すれば
// 「規則の解釈」と「YAML への書き出し」の双方が正しいと言える。
//
// 照合するのは 137 地区 × 令和8年度 (2026-04-01〜2027-03-31) の全日。
//   期待側: CSV の収集曜日 (+ 公式 HTML 由来の既知訂正) を直接展開
//   実際側: 生成された course-*.yaml の rules を展開
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as yamlParse } from 'yaml';
import { loadCsv, loadHtmlPages } from './fetch.mjs';
import { parseShinagawaCsv, CATEGORY_MAP } from './parse.mjs';
import { parseShinagawaHtml } from './parse-html.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const COURSE_DIR = join(HERE, '../../../municipalities/tokyo/shinagawa/2026');
const FY = 2026;
const DAY_INDEX = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

const pad = (n) => String(n).padStart(2, '0');
const isoOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

// 年度の全日を列挙 (2026-04-01 〜 2027-03-31)
function fiscalDays() {
  const out = [];
  for (let d = new Date(FY, 3, 1); d < new Date(FY + 1, 3, 1); d = new Date(d.getTime() + 86400000)) out.push(new Date(d));
  return out;
}

// 素朴な展開: 「その月の n 回目の該当曜日」を日付から直接数える (nth = ceil(日付/7))
function expand(rules) {
  const map = new Map();
  for (const d of fiscalDays()) {
    const dow = d.getDay();
    const nth = Math.ceil(d.getDate() / 7);
    const cats = [];
    for (const r of rules) {
      if (!r.days.some((x) => DAY_INDEX[x] === dow)) continue;
      if (r.pattern === 'weekly') cats.push(r.category);
      else if (r.pattern === 'monthly_nth' && r.occurrences.includes(nth)) cats.push(r.category);
      else if (r.pattern !== 'weekly' && r.pattern !== 'monthly_nth') throw new Error(`未対応 pattern: ${r.pattern}`);
    }
    if (cats.length) map.set(isoOf(d), cats.sort());
  }
  return map;
}

// ---- 期待側: CSV (+ 公式 HTML の既知訂正) から地区ごとの rules を組む ----
const csvRows = parseShinagawaCsv(await loadCsv());
const htmlRows = parseShinagawaHtml(await loadHtmlPages());

const byArea = new Map();
for (const r of csvRows) {
  if (!byArea.has(r.area)) byArea.set(r.area, {});
  byArea.get(r.area)[r.category] = r.day;
}
// 大井6丁目の燃やすごみは ODP 側の誤り。公式 HTML の値 (火・金) を期待値とする (build.mjs と同じ判断)。
{
  const h = htmlRows.find((r) => r.town === '大井' && r.chome === 6);
  if (!h) throw new Error('公式 HTML に大井6丁目が無い');
  byArea.get('大井6丁目')['燃やすごみ'] = h.days['燃やすごみ'];
}

const expected = new Map(); // 地区名 → Map<iso, cats[]>
for (const [area, byCat] of byArea) {
  const rules = [];
  for (const [ja, cats] of Object.entries(CATEGORY_MAP)) {
    for (const category of cats) rules.push({ category, ...byCat[ja] });
  }
  expected.set(area, expand(rules));
}

// ---- 実際側: 生成された course YAML ----
const actual = new Map(); // 地区名 → Map<iso, cats[]>
const files = readdirSync(COURSE_DIR).filter((f) => f.endsWith('.yaml')).sort();
let overrideCount = 0;
for (const file of files) {
  const doc = yamlParse(readFileSync(join(COURSE_DIR, file), 'utf8'));
  overrideCount += (doc.overrides || []).length;
  const days = expand(doc.rules);
  for (const a of doc.metadata.areas) {
    if (actual.has(a.name)) throw new Error(`地区が複数コースに重複: ${a.name}`);
    actual.set(a.name, days);
  }
}

// ---- 照合 ----
let diffAreas = 0, diffDays = 0;
for (const [area, exp] of expected) {
  const act = actual.get(area);
  if (!act) { console.log(`YAML に無い地区: ${area}`); diffAreas++; continue; }
  const keys = new Set([...exp.keys(), ...act.keys()]);
  let bad = 0;
  for (const k of [...keys].sort()) {
    const e = (exp.get(k) || []).join(','), a = (act.get(k) || []).join(',');
    if (e !== a) { if (bad < 3) console.log(`  ${area} ${k}: 期待[${e}] 実際[${a}]`); bad++; }
  }
  if (bad) { diffAreas++; diffDays += bad; }
}
for (const area of actual.keys()) if (!expected.has(area)) { console.log(`一次ソースに無い地区: ${area}`); diffAreas++; }

const totalDays = [...expected.values()].reduce((s, m) => s + m.size, 0);
console.log(`コース ${files.length} / 地区 ${expected.size} / 収集日枠 ${totalDays} 件 (令和8年度 通年)`);
console.log(`overrides 合計 ${overrideCount} 件`);
console.log(`不一致: 地区 ${diffAreas} / 日 ${diffDays}`);
if (diffAreas || diffDays) process.exit(1);
console.log('OK: 生成 YAML の展開結果は一次ソースの規則と全地区・通年で一致');
