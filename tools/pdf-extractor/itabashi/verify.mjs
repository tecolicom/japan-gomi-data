// 板橋区の照合。build.mjs がやる検査 (規則の一致・町字の網羅・自己検証) とは別に、
// **生成物そのもの**を独立な表現と突き合わせる。
//
//   A. 地区割の双方向照合   索引ページ「町丁目 → 地域」と、各 PDF ヘッダ「地域 → 町丁目」。
//                           区が別々に書いた 2 つの対応表なので、係り先の取り違えが出る。
//   B. 日付レベルの全数照合 索引ページの曜日規則を**独立に展開**し、公開した course YAML を
//                           収録期間の全日で突き合わせる。PDF のグリッド (塗り色) と
//                           HTML の規則 (文字) は別経路なので、読み違いが出る。
//
// 「不一致 0」を信じてよいかは --tamper で確かめる。
//
// 使い方: node verify.mjs [--tamper]
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { parse as yamlParse } from 'yaml';
import { findPython } from '../../_lib/python.mjs';
import { expandRange, periodDates, isUnknown } from '../../_lib/schedule.mjs';
import { DAY_JA } from '../../_lib/jp.mjs';
import { parseIndexTable, splitAreas, ruleKey } from './parse.mjs';
import { AREAS, PERIOD, GROUP_CATEGORIES, CAT_ORDER } from './sources.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CACHE = join(HERE, 'cache');
const OUTDIR = join(HERE, '../../../municipalities/tokyo/itabashi', PERIOD);

const rows = parseIndexTable(readFileSync(join(CACHE, 'index.html'), 'utf8'));
const py = findPython(['pdfplumber']);
const pdf = JSON.parse(execFileSync(py, [
  join(HERE, 'extract.py'), ...AREAS.map((a) => join(CACHE, a.file)),
], { encoding: 'utf8', maxBuffer: 64 << 20 }));
const pdfByArea = new Map(Object.values(pdf).map((v) => [v.area, v]));

const courses = readdirSync(OUTDIR).filter((f) => f.startsWith('course-'))
  .map((f) => yamlParse(readFileSync(join(OUTDIR, f), 'utf8')));

// ---------------------------------------------------------------------------
// A. 地区割の双方向照合
// ---------------------------------------------------------------------------
function checkAreas(indexRows, pdfMap) {
  const fromHtml = new Map();   // 地域 → Set<町丁目>
  for (const r of indexRows) {
    if (!fromHtml.has(r.area)) fromHtml.set(r.area, new Set());
    for (const a of splitAreas(r.name)) fromHtml.get(r.area).add(`${a.town}${a.chome ?? ''}`);
  }
  const fromPdf = new Map();
  for (const [id, v] of pdfMap) {
    const s = new Set();
    for (const t of v.towns) for (const a of splitAreas(t)) s.add(`${a.town}${a.chome ?? ''}`);
    fromPdf.set(id, s);
  }
  let diffs = 0, compared = 0;
  for (const a of AREAS) {
    const h = fromHtml.get(a.id) ?? new Set();
    const p = fromPdf.get(a.id) ?? new Set();
    const onlyH = [...h].filter((x) => !p.has(x));
    const onlyP = [...p].filter((x) => !h.has(x));
    compared += h.size;
    if (onlyH.length || onlyP.length) {
      console.log(`  ✗ ${a.nameJa}: 索引のみ [${onlyH}] / PDF のみ [${onlyP}]`);
      diffs += onlyH.length + onlyP.length;
    }
  }
  console.log(`A. 地区割の双方向照合: ${AREAS.length} 地域 / ${compared} 町字 / 不一致 ${diffs}`);
  return diffs;
}

// ---------------------------------------------------------------------------
// B. 索引ページの曜日規則を独立に展開して course YAML と全日照合
// ---------------------------------------------------------------------------
// 索引の文字列 ("土" / "月・水・金" / "毎月1回目・3回目の木") から、
// classifyRules を通さずに直接 rules を組む。生成側と別経路にするのが要点。
function rulesFromIndexRow(r) {
  const days = (s) => s.split('・').map((c) => DAY_JA[c]).filter(Boolean);
  const m = /^毎月([\d回目・]+)の([日月火水木金土])$/.exec(r.non);
  const occ = [...m[1].matchAll(/(\d)回目/g)].map((x) => Number(x[1]));
  const out = [];
  for (const c of GROUP_CATEGORIES['可燃']) out.push({ category: c, pattern: 'weekly', days: days(r.bur) });
  for (const c of GROUP_CATEGORIES['資源']) out.push({ category: c, pattern: 'weekly', days: days(r.res) });
  for (const c of GROUP_CATEGORIES['不燃']) {
    out.push({ category: c, pattern: 'monthly_nth', days: days(r.non.slice(-1)), occurrences: occ });
  }
  return out.sort((a, b) => CAT_ORDER.indexOf(a.category) - CAT_ORDER.indexOf(b.category));
}

function checkDates(indexRows, courseDocs) {
  const byId = new Map(courseDocs.map((d) => [d.metadata.course, d]));
  const dates = periodDates(PERIOD);
  const byArea = new Map();
  for (const r of indexRows) {
    if (!byArea.has(r.area)) byArea.set(r.area, r);
    else if (ruleKey(byArea.get(r.area)) !== ruleKey(r)) {
      console.log(`  ✗ ${r.area}: 索引の中で規則が食い違う (${byArea.get(r.area).name} と ${r.name})`);
    }
  }
  let diffs = 0, checked = 0;
  for (const [id, r] of byArea) {
    const doc = byId.get(id);
    if (!doc) { console.log(`  ✗ 生成物に無いコース: ${id}`); diffs++; continue; }
    const want = expandRange(PERIOD, rulesFromIndexRow(r), [], doc.unknown_periods);
    const have = expandRange(PERIOD, doc.rules, [], doc.unknown_periods);
    for (const iso of dates) {
      if (isUnknown(iso, doc.unknown_periods)) continue;
      const w = [...(want.get(iso) ?? [])].sort().join(',');
      const h = [...(have.get(iso) ?? [])].sort().join(',');
      if (w !== h) { console.log(`  ✗ ${doc.metadata.course_name_ja} ${iso}: 索引 [${w}] ≠ 生成物 [${h}]`); diffs++; }
      checked++;
    }
  }
  const perArea = dates.filter((d) => !isUnknown(d, courseDocs[0]?.unknown_periods)).length;
  console.log(`B. 索引の規則との日付レベル全数照合: ${byArea.size} 地域 × ${perArea} 日 = ${checked} 日枠 / 不一致 ${diffs}`);
  return diffs;
}

// ---------------------------------------------------------------------------

const tamper = process.argv.includes('--tamper');

if (!tamper) {
  const total = checkAreas(rows, pdfByArea) + checkDates(rows, courses);
  console.log(total === 0 ? '\n照合: すべて一致' : `\n照合: 不一致 ${total} 件`);
  if (total) process.exit(1);
} else {
  console.log('=== 改竄検査: 各検査が実際に落ちることを確かめる ===\n');
  const clone = (x) => JSON.parse(JSON.stringify(x));
  let failures = 0;
  const expectFail = (label, n) => {
    console.log(`${n > 0 ? '✓' : '✗'} ${label}: 不一致 ${n} 件${n > 0 ? '' : ' ← 検査が効いていない'}\n`);
    if (n === 0) failures++;
  };
  // 1) 索引の町丁目を別の地域へ付け替える → A が落ちるはず
  {
    const t = clone(rows);
    const i = t.findIndex((r) => r.area === 'w1');
    const before = t[i].area;
    t[i].area = 'w2';
    if (t[i].area === before) throw new Error('改竄が空振り');
    console.log(`[1] 索引の「${t[i].name}」を ${before} → ${t[i].area} に付け替え`);
    expectFail('  A. 地区割の双方向照合', checkAreas(t, pdfByArea));
  }
  // 2) PDF ヘッダの町名を 1 つ落とす → A が落ちるはず
  {
    const t = new Map([...pdfByArea].map(([k, v]) => [k, clone(v)]));
    const before = t.get('e1').towns.length;
    t.get('e1').towns.pop();
    if (t.get('e1').towns.length === before) throw new Error('改竄が空振り');
    console.log(`[2] PDF 東1 のヘッダ町名を 1 つ削除 (${before} → ${t.get('e1').towns.length})`);
    expectFail('  A. 地区割の双方向照合', checkAreas(rows, t));
  }
  // 3) 索引の曜日を書き換える (収集日をずらす) → B が落ちるはず
  {
    const t = clone(rows);
    const i = t.findIndex((r) => r.area === 'e1');
    const before = t[i].bur;
    t[i].bur = '月・水・金';
    if (t[i].bur === before) throw new Error('改竄が空振り');
    console.log(`[3] 索引の 東1 の可燃を "${before}" → "${t[i].bur}" に改竄`);
    expectFail('  B. 日付レベル全数照合', checkDates(t, courses));
  }
  // 4) 生成物の第n を増やす (収集日を足す) → B が落ちるはず
  {
    const t = clone(courses);
    const doc = t.find((d) => d.metadata.course === 'w1');
    const rule = doc.rules.find((r) => r.pattern === 'monthly_nth');
    const before = [...rule.occurrences];
    rule.occurrences = [1, 2, 3, 4];
    if (String(rule.occurrences) === String(before)) throw new Error('改竄が空振り');
    console.log(`[4] 生成物 西1 の不燃を 第${before} → 第${rule.occurrences} に改竄`);
    expectFail('  B. 日付レベル全数照合', checkDates(rows, t));
  }
  // 5) 生成物のコースを 1 つ落とす → B が落ちるはず
  {
    const t = clone(courses).filter((d) => d.metadata.course !== 'e12');
    if (t.length !== courses.length - 1) throw new Error('改竄が空振り');
    console.log(`[5] 生成物から東12 を削除 (${courses.length} → ${t.length} コース)`);
    expectFail('  B. 日付レベル全数照合', checkDates(rows, t));
  }
  console.log(failures === 0
    ? '改竄検査: 5 通りすべてで検査が反応した'
    : `改竄検査: ${failures} 通りで検査が反応しなかった`);
  if (failures) process.exit(1);
}
