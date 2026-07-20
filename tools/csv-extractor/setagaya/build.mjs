// 世田谷区オープンデータ CSV → municipalities/tokyo/setagaya/2026/course-*.yaml
//
// 検証を 3 段構えで build に内蔵する (どれか 1 つでも崩れたら中断):
//   1. CSV 118 行 と 配布ページ 416.html の HTML 表 118 行 を全行突合
//      (町名・丁目・4 種別の日程・管轄清掃事務所すべて)。表記ゆれは parse.mjs が正規化。
//   2. yomi.yaml の読みの先頭かな と CSV の「50音」列 を全町名で突合 (濁音は清音行として比較)。
//   3. CSV の日程シグネチャで畳んだグループ と、区が 27859.html で配る町丁目別カレンダー PDF
//      (対象地区 no1〜no37) のグループ分けが完全に一致することを確認する。
//      → コース番号は区の「対象地区 N」をそのまま採用する (course "12" = no12.pdf = 対象地区⑫)。
//
// 年末年始: 令和8年版カレンダーは 2026-12-30・12-31 を「収集はありません」と印字している。
//   2027年始 (1/1〜1/3) は本カレンダーの収録範囲外 (2026年11月配布の次期カレンダーで確定) のため
//   overrides には入れない。詳細は meta.yaml notes を参照。
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as yamlParse } from 'yaml';
import { parse as parseHtml } from 'node-html-parser';
import { foldCourses, courseDoc, writeCourses } from '../../_lib/emit.mjs';
import { signatureKey, cancelledOverrides } from '../../_lib/schedule.mjs';
import { parseOpenDataCsv, parseOfficialHtml, rowToRules, rowKey, areaName, parseChome, norm, parseAreaLabel, areaKey, rowAreaKey } from './parse.mjs';
import { CSV_URL, LIST_URL, CAL_URL } from './fetch.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CACHE = join(HERE, 'cache');
const OUT = join(HERE, '../../../municipalities/tokyo/setagaya');
const YEAR = 2026;
const EXTRACTED_AT = process.env.EXTRACTED_AT || '2026-07-20'; // Date.now() 不使用 (決定的出力)

const yomi = yamlParse(readFileSync(join(HERE, 'yomi.yaml'), 'utf8'));

// --- 1) CSV と 416.html の全行突合 ---------------------------------------
const csvRows = parseOpenDataCsv(new TextDecoder('shift_jis').decode(readFileSync(join(CACHE, 'setagaya.csv'))));
const htmlRows = parseOfficialHtml(readFileSync(join(CACHE, 'page416.html'), 'utf8'));
if (csvRows.length !== htmlRows.length) {
  throw new Error(`行数不一致: CSV=${csvRows.length} HTML=${htmlRows.length}`);
}
const htmlByKey = new Map(htmlRows.map((r) => [rowKey(r), r]));
if (htmlByKey.size !== htmlRows.length) throw new Error('HTML 表に重複キーがある');
let fieldChecks = 0;
for (const row of csvRows) {
  const h = htmlByKey.get(rowKey(row));
  if (!h) throw new Error(`HTML 表に無い行: ${rowKey(row)}`);
  if (signatureKey(rowToRules(row)) !== signatureKey(rowToRules(h))) {
    throw new Error(`CSV と HTML 表で日程が不一致: ${rowKey(row)}`);
  }
  if (row.office !== h.office) throw new Error(`管轄清掃事務所が不一致: ${rowKey(row)}`);
  if (row.kana !== h.kana) throw new Error(`50音 が不一致: ${rowKey(row)}`);
  fieldChecks += 6; // 町名・丁目・資源・可燃・不燃・ペット
}
console.log(`[1] CSV ${csvRows.length} 行 = 416.html 表 全行一致 (照合フィールド ${fieldChecks})`);

// --- 2) yomi と CSV「50音」列の突合 ---------------------------------------
// 区の 50音 列は清音の行見出し (だいざわ→「た」, ごうとくじ→「こ」)。濁点を落として比較する。
const DAKUTEN = { が: 'か', ぎ: 'き', ぐ: 'く', げ: 'け', ご: 'こ', ざ: 'さ', じ: 'し', ず: 'す', ぜ: 'せ', ぞ: 'そ', だ: 'た', ぢ: 'ち', づ: 'つ', で: 'て', ど: 'と', ば: 'は', び: 'ひ', ぶ: 'ふ', べ: 'へ', ぼ: 'ほ', ぱ: 'は', ぴ: 'ひ', ぷ: 'ふ', ぺ: 'へ', ぽ: 'ほ' };
const seion = (c) => DAKUTEN[c] || c;
const towns = [...new Set(csvRows.map((r) => r.town))];
for (const row of csvRows) {
  const y = yomi[row.town];
  if (!y) throw new Error(`yomi.yaml に無い町名: ${row.town}`);
  if (seion(y[0]) !== seion(row.kana)) {
    throw new Error(`読みの先頭かなが CSV「50音」列と不一致: ${row.town} yomi=${y} 50音=${row.kana}`);
  }
}
for (const t of Object.keys(yomi)) {
  if (!towns.includes(t)) throw new Error(`yomi.yaml に余分な町名 (CSV に無い): ${t}`);
}
console.log(`[2] yomi.yaml ${towns.length} 町 = CSV「50音」列と整合`);

// --- 3) シグネチャ畳み込み と 区のカレンダー PDF グループ分けの一致確認 ------
// 27859.html: <a href="/documents/27859/no<N>.pdf">赤堤1・3～5丁目（PDF：3,023KB）</a>
const calHtml = readFileSync(join(CACHE, 'page27859.html'), 'utf8');
const pdfGroups = new Map(); // no → Set<町丁目キー>
const pdfLabels = new Map(); // 町丁目キー → PDF 側の見出し (差分表示用)
for (const a of parseHtml(calHtml).querySelectorAll('a')) {
  const m = (a.getAttribute('href') || '').match(/\/documents\/27859\/no(\d+)\.pdf$/);
  if (!m) continue;
  const label = norm(a.text).replace(/（PDF：[\d,]+KB）$/, '').replace(/\(PDF:[\d,]+KB\)$/, '');
  const no = Number(m[1]);
  const key = areaKey(parseAreaLabel(label));
  if (!pdfGroups.has(no)) pdfGroups.set(no, new Set());
  pdfGroups.get(no).add(key);
  pdfLabels.set(key, label);
}
if (pdfGroups.size !== 41) throw new Error(`カレンダー PDF の数が想定外: ${pdfGroups.size} (期待 41)`);

// no38〜41 は大規模集合住宅の個別日程 (CSV の町丁目一覧には現れない) → 対象外
const townGroups = new Map([...pdfGroups].filter(([no]) => no <= 37));
const coveredByPdf = new Set([...townGroups.values()].flatMap((s) => [...s]));
const csvAreas = new Set(csvRows.map(rowAreaKey));
for (const a of csvAreas) if (!coveredByPdf.has(a)) throw new Error(`カレンダー PDF に無い町丁目: ${a}`);
for (const a of coveredByPdf) if (!csvAreas.has(a)) throw new Error(`CSV に無い町丁目 (PDF 側): ${pdfLabels.get(a)}`);

// CSV を日程シグネチャで畳む
const folded = foldCourses(csvRows, rowToRules, (row) => row);
// 畳んだ各グループが、ちょうど 1 つの PDF グループと集合として一致することを要求する
const pdfByArea = new Map();
for (const [no, set] of townGroups) for (const a of set) pdfByArea.set(a, no);
const courses = [];
for (const g of folded) {
  const nos = new Set(g.areas.map((r) => pdfByArea.get(rowAreaKey(r))));
  if (nos.size !== 1) {
    throw new Error(`同一日程のグループが複数の対象地区にまたがる: ${[...nos]} / ${g.areas.map(areaName)}`);
  }
  const no = [...nos][0];
  if (townGroups.get(no).size !== g.areas.length) {
    throw new Error(`対象地区 ${no}: PDF ${townGroups.get(no).size} 町丁目 ≠ 同一日程 ${g.areas.length} 町丁目`);
  }
  courses.push({ no, rules: g.rules, rows: g.areas });
}
if (courses.length !== 37) throw new Error(`コース数が対象地区数と不一致: ${courses.length} (期待 37)`);
courses.sort((a, b) => a.no - b.no);
console.log(`[3] 日程シグネチャ ${courses.length} 群 = 区のカレンダー PDF「対象地区」1〜37 と完全一致`);

// --- 4) 出力 -------------------------------------------------------------
// 令和8年版カレンダーが黄色地で「収集はありません」と印字する年末休止日は 12/31 のみ。
// 12/30 は通常収集 (対象地区 6・7・8 等は 12/30 水曜に可燃ごみを収集する) で、
// 一部の地区の 12/30 欄にある「収集はありません」は
// 「その曜日に当たるが n 回目に該当しない」空欄の注記であって休止日ではない (PDF 目視で確認)。
// 2027年始 (1/1〜1/3) は本カレンダーの収録範囲外 → overrides に入れない (meta.yaml notes 参照)。
const YEAR_END = ['2026-12-31'];
const YEAR_END_NOTE = '年末休止 (令和8年版カレンダー印字)';

const areaOf = (row) => {
  const chome = parseChome(row.chome);
  const base = yomi[row.town];
  return { name: areaName(row), yomi: chome.length ? `${base}${chome.join('-')}` : base };
};

const docs = courses.map(({ no, rules, rows }) => courseDoc({
  city: 'setagaya',
  course: String(no),
  courseNameJa: `対象地区${no}`,
  areas: rows.map(areaOf).sort((a, b) => a.yomi.localeCompare(b.yomi, 'ja')),
  year: YEAR,
  fiscalYearJa: '令和8年度',
  source: {
    source_url: CSV_URL,
    pdf_url: `https://www.city.setagaya.lg.jp/documents/27859/no${no}.pdf`,
    extracted_at: EXTRACTED_AT,
    extracted_by: 'claude-opus-4-5',
    verified_by: 'Claude(区オープンデータCSVの機械変換。配布ページHTML表と全行突合 + 町丁目別カレンダーPDF 37枚と日付レベル目視照合)',
  },
  rules,
  overrides: cancelledOverrides(rules, YEAR_END, YEAR_END_NOTE),
}));

mkdirSync(OUT, { recursive: true });
const n = writeCourses(OUT, YEAR, docs);
// 検証用: 対象地区 → 町丁目 の対応表
writeFileSync(join(CACHE, 'course-areas.json'),
  JSON.stringify(Object.fromEntries(courses.map((c) => [c.no, c.rows.map(areaName)])), null, 1));
console.log(`generated ${n} courses (${csvRows.length} 町丁目 → ${n} コース)`);
