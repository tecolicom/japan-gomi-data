// 入間市 収録データの照合ツール (build とは別経路)。
//
//  (A) 自己照合: 生成済み course YAML を categoriesOn で通年再展開し、一次ソース CSV の
//      実日付と全日比較する (パースの忠実性を保証)。
//  (B) 独立照合: 市「令和8年度 分け出し表」PDF (県ODとは別発行の市リーフレット) の
//      地区別収集日程表を pdftotext で機械抽出し、地区(=コース)ごとに
//        可燃/不燃/プラの収集曜日・隔週2品目の「第n回目」と実日番号
//      を CSV 由来ルールと突き合わせる。日付レベル(隔週品目)+曜日レベル(毎週品目)。
//
//  実行: node tools/csv-extractor/iruma/verify.mjs   (要 pdftotext)
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { parse as yamlParse } from 'yaml';
import { categoriesOn, expandFiscalYear, isoDate } from '../../_lib/schedule.mjs';
import { parseIrumaCsv, BUNBETSU2CATS, splitRegion, baseName } from './parse.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..', '..');
const COURSES = join(ROOT, 'municipalities', 'saitama', 'iruma', '2026');
const FY = 2026;
const DOW = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
const WD_JA = { 月: 'MO', 火: 'TU', 水: 'WE', 木: 'TH', 金: 'FR', 土: 'SA', 日: 'SU' };
const zen2han = (s) => s.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));

// --- CSV から地域カレンダーを再構築 ---
const csv = new TextDecoder('shift_jis').decode(readFileSync(join(HERE, 'cache', 'iruma.csv')));
const rows = parseIrumaCsv(csv);
const regions = new Map(); // region -> {cal:Map<iso,Set>, byCat:Map<cat,Set>}
for (const { region, bunbetsu, iso } of rows) {
  if (!regions.has(region)) regions.set(region, { cal: new Map(), byCat: new Map() });
  const R = regions.get(region);
  if (!R.cal.has(iso)) R.cal.set(iso, new Set());
  for (const c of BUNBETSU2CATS[bunbetsu]) {
    R.cal.get(iso).add(c);
    if (!R.byCat.has(c)) R.byCat.set(c, new Set());
    R.byCat.get(c).add(iso);
  }
}
const regionBases = new Map(); // region -> Set(base town names)
for (const region of regions.keys()) {
  regionBases.set(region, new Set(splitRegion(region).map(baseName)));
}

// =============== (A) 自己照合 ===============
let selfNG = 0;
const courseRegion = new Map(); // course番号 -> region (course_name_ja で対応付け)
for (let n = 1; n <= 12; n++) {
  const doc = yamlParse(readFileSync(join(COURSES, `course-${n}.yaml`), 'utf8'));
  const region = doc.metadata.course_name_ja;
  courseRegion.set(n, region);
  const R = regions.get(region);
  if (!R) { console.error(`course-${n}: CSV に一致する地域が無い (${region})`); selfNG++; continue; }
  const exp = expandFiscalYear(FY, doc.rules, doc.overrides || []);
  // 比較
  let mism = 0;
  const keys = new Set([...exp.keys(), ...R.cal.keys()]);
  for (const k of keys) {
    const a = [...(exp.get(k) || [])].sort().join(',');
    const b = [...(R.cal.get(k) || new Set())].sort().join(',');
    if (a !== b) { mism++; if (mism <= 5) console.error(`  course-${n} ${k}: got[${a}] exp[${b}]`); }
  }
  if (mism) { console.error(`course-${n}: ${mism}日 不一致`); selfNG++; }
  else console.log(`course-${n}: 全${R.cal.size}収集日 自己照合OK`);
}
console.log(selfNG === 0 ? '(A) 自己照合: 全12コース 相違ゼロ\n' : `(A) 自己照合: ${selfNG}コースNG\n`);

// =============== (B) 分け出し表 PDF 独立照合 ===============
const PDF = join(HERE, 'verify', 'R8wakedasihyou.pdf');
if (!existsSync(PDF)) {
  console.log('(B) 分け出し表 PDF が無い (node fetch.mjs で取得) → 独立照合スキップ');
  process.exit(selfNG === 0 ? 0 : 1);
}
const pt = spawnSync('pdftotext', ['-layout', PDF, '-'], { encoding: 'utf8', maxBuffer: 1 << 24 });
if (pt.status !== 0) { console.log('(B) pdftotext 実行不可 → 独立照合スキップ'); process.exit(selfNG === 0 ? 0 : 1); }
const lines = pt.stdout.split(/\r?\n/);

// 可燃曜日ヘッダ (月・水・金 / 火・木・土) でブロック分割
const headerIdx = [];
lines.forEach((l, i) => { if (/^\s*[月火水木金土](・[月火水木金土])+\s*$/.test(l.trim())) headerIdx.push(i); });
if (headerIdx.length !== 12) console.log(`  警告: 可燃ヘッダ ${headerIdx.length} 個 (12 のはず)`);

const nums = (l) => (l.match(/(\d+)日/g) || []).map((x) => parseInt(x));
// 日付列より前にある「単独1文字の曜日トークン」を拾う (町名や番地の数字に惑わされない)。
const wdCells = (l) => {
  const pre = zen2han(l).split(/\d+日/)[0];
  return pre.split(/[\s　]+/).filter((t) => t.length === 1 && WD_JA[t]).map((t) => WD_JA[t]);
};
const occOf = (l) => { const mm = zen2han(l).match(/第\s*([\d])\s*・\s*([\d])/); return mm ? [parseInt(mm[1]), parseInt(mm[2])] : null; };
// 大字/ヶ・ケ を正規化したベース名
const normBase = (b) => b.replace(/^大字/, '').replace(/ヶ/g, 'ケ');
const MONTHS = [4, 5, 6, 7, 8, 9, 10, 11, 12, 1, 2, 3];
const toIso = (mi, day) => { const m = MONTHS[mi]; const y = m >= 4 ? 2026 : 2027; return `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`; };
const datesFrom = (firstNums, secondNums) => { // 2本の日番号行 → ISO 集合 (な し=欠番はスキップ)
  const s = new Set();
  for (let mi = 0; mi < 12; mi++) { if (firstNums[mi] != null) s.add(toIso(mi, firstNums[mi])); if (secondNums[mi] != null) s.add(toIso(mi, secondNums[mi])); }
  return s;
};
// 「な し」を欠番として 12 個に整列: 行内の 日番号 と な し の出現順で埋める
const alignRow = (l) => {
  const toks = zen2han(l).replace(/な\s*し/g, 'なし').match(/(\d+日|なし)/g) || [];
  const arr = toks.map((t) => t === 'なし' ? null : parseInt(t));
  // 先頭に月列がずれる場合があるため、12 個に満たなければ null 詰め
  while (arr.length < 12) arr.unshift(null);
  return arr.slice(-12);
};

let pdfBlocks = 0, pdfOK = 0, pdfNG = 0;
const details = [];
for (let bi = 0; bi < headerIdx.length; bi++) {
  const start = headerIdx[bi];
  const end = bi + 1 < headerIdx.length ? headerIdx[bi + 1] : lines.length;
  const block = lines.slice(start, end);
  const kanenWd = (block[0].match(/[月火水木金土]/g) || []).map((c) => WD_JA[c]);
  // ブロック内: 日番号を持つ4行 と 「第n・m」マーカー2個 を役割別に仕分ける。
  //  番号行の役割: 3曜日セル→gobuSecond / 有害ごみ→bikanSecond / ビン・缶→bikanFirst / 残り→gobuFirst
  //  マーカー: ビンを含む→bikanOcc / 含まない→gobuOcc (マーカーと番号が別行の版に対応)
  const numRows = [], occMarks = [];
  const bases = new Set();
  for (const raw of block.slice(1)) {
    const l = raw;
    const hasNum = nums(l).length >= 6;
    const isOcc = /第\s*[\d０-９]\s*・\s*[\d０-９]/.test(zen2han(l));
    const hasBikan = /ビン・?缶/.test(l);
    const hasHaigai = /有害ごみ/.test(l);
    const cells = wdCells(l);
    if (isOcc) occMarks.push({ occ: occOf(l), bikan: hasBikan });
    if (hasNum) numRows.push({ row: alignRow(l), cells, hasBikan, hasHaigai });
    // 町名ベース抽出: 日付列より前の部分から品目/条件語を除いて町名候補を拾う
    const pre = zen2han(l).split(/\d+日|第\s*\d/)[0]
      .replace(/古布・紙類|ビン・?缶|ペットボトル|有害ごみ|以外の地区|除く|お休み|までは|収集を/g, '')
      .replace(/（.*?）/g, '').replace(/✂/g, '');
    for (const part of pre.split(/[・、\s　]+/)) {
      const p = part.trim(); if (!p || p.length < 2 || !/[一-龠ァ-ヶ]/.test(p)) continue;
      const b = normBase(baseName(p)); if (b && b.length >= 2) bases.add(b);
    }
  }
  const tripleRow = numRows.find((r) => r.cells.length === 3);
  const gobuSecond = tripleRow?.row, tripleWd = tripleRow?.cells;
  const bikanSecond = numRows.find((r) => r.hasHaigai)?.row;
  const bikanFirst = numRows.find((r) => r.hasBikan)?.row;
  const gobuFirst = numRows.find((r) => r !== tripleRow && !r.hasHaigai && !r.hasBikan)?.row;
  const gobuOcc = (occMarks.find((m) => !m.bikan) || {}).occ;
  const bikanOcc = (occMarks.find((m) => m.bikan) || {}).occ;
  if (!gobuOcc || !bikanOcc || !tripleWd || !gobuFirst || !gobuSecond || !bikanFirst || !bikanSecond) {
    console.error(`  ブロック#${bi + 1}: 解析不足 (numRows=${numRows.length} occ=${occMarks.length}) skip`); pdfNG++; continue;
  }
  // 町名ベースの Jaccard 類似で CSV 地域にマッチ (同名町の重複地区を分離)
  let best = null, bestScore = -1;
  for (const [region, rb] of regionBases) {
    const rbn = new Set([...rb].map(normBase));
    let inter = 0; for (const b of bases) if (rbn.has(b)) inter++;
    const uni = new Set([...bases, ...rbn]).size;
    const j = uni ? inter / uni : 0;
    if (j > bestScore) { bestScore = j; best = region; }
  }
  const R = regions.get(best);
  pdfBlocks++;
  // 期待値 (CSV由来)
  const wdOf = (cat) => { const ds = [...(R.byCat.get(cat) || [])]; return DOW[new Date(ds[0] + 'T00:00:00').getDay()]; };
  const burnableWd = [...new Set([...R.byCat.get('burnable')].map((d) => DOW[new Date(d + 'T00:00:00').getDay()]))].sort();
  const csvGobu = R.byCat.get('paper_cloth');
  const csvBikan = R.byCat.get('glass_bottle');
  // PDF値
  const pdfGobu = datesFrom(gobuSecond, gobuFirst); // 順不同で集合化
  const pdfBikan = datesFrom(bikanSecond, bikanFirst);
  const setEq = (a, b) => a.size === b.size && [...a].every((x) => b.has(x));
  const checks = {
    kanenWd: JSON.stringify([...kanenWd].sort()) === JSON.stringify(burnableWd),
    nonBurnWd: tripleWd[0] === wdOf('non_burnable'),
    plasticWd: tripleWd[1] === wdOf('plastic'),
    gobuDates: setEq(pdfGobu, csvGobu),
    bikanDates: setEq(pdfBikan, csvBikan),
  };
  const allOK = Object.values(checks).every(Boolean);
  if (allOK) pdfOK++; else pdfNG++;
  details.push({ bi: bi + 1, region: best, score: bestScore, checks, allOK,
    gobuDiff: allOK ? 0 : [...csvGobu].filter((x) => !pdfGobu.has(x)).length + [...pdfGobu].filter((x) => !csvGobu.has(x)).length,
    bikanDiff: allOK ? 0 : [...csvBikan].filter((x) => !pdfBikan.has(x)).length + [...pdfBikan].filter((x) => !csvBikan.has(x)).length });
}

console.log('(B) 分け出し表 PDF 独立照合:');
for (const d of details) {
  const flags = Object.entries(d.checks).map(([k, v]) => `${k}=${v ? '○' : '×'}`).join(' ');
  console.log(`  ブロック#${d.bi} → [${d.region.slice(0, 16)}…] ${d.allOK ? 'OK' : 'NG'} ${flags}` +
    (d.allOK ? '' : ` (古布差${d.gobuDiff}/ビン缶差${d.bikanDiff})`));
}
console.log(`\n照合: ${pdfOK}/${pdfBlocks} ブロック 完全一致, NG=${pdfNG}`);
console.log(selfNG === 0 && pdfNG === 0 ? 'RESULT: OK (自己照合ゼロ差 + PDF独立照合 全一致)' : `RESULT: 要確認 (self NG=${selfNG}, pdf NG=${pdfNG})`);
process.exit(selfNG === 0 && pdfNG === 0 ? 0 : 1);
