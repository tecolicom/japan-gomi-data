// 豊島区の照合。3 系統ある。
//
//   A. 版どうしの照合   一次ソース (英中韓版) と、同じ表の別言語版 5 種を全数比較する。
//                       組版が別なので、版面を読み違えていれば食い違う。
//   B. 内部照合         一次ソースの日本語セルと英語セルを突き合わせる。
//                       「火」と "Tue." は別々に組まれているので、片方の取り違えが出る。
//   C. 保存版との照合   保存版冊子の曜日一覧 (画像 PDF・機械では読めない) を目視で全数転記し、
//                       生成した course YAML を収録期間の全日に展開して突き合わせる。
//                       **別の刊行物**なので A/B と違って真に独立した照合になる。
//
// 目視転記は BOOKLET_ROWS に固定保持する (一過性にしない)。
// 「不一致 0」を信じてよいかは --tamper で確かめる。抽出結果を 1 か所書き換えて
// 各検査が実際に落ちることを見る。消す方向と足す方向の両方を試す。
//
// 使い方: node verify.mjs [--tamper]
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { parse as yamlParse } from 'yaml';
import { findPython } from '../../_lib/python.mjs';
import { expandRange, periodDates } from '../../_lib/schedule.mjs';
import { splitAreas, cellsToRules } from './parse.mjs';
import { PRIMARY, CROSS_LANG, PERIOD } from './sources.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CACHE = join(HERE, 'cache');
const OUTDIR = join(HERE, '../../../municipalities/tokyo/toshima', PERIOD);
const py = findPython(['pdfplumber']);

// ---------------------------------------------------------------------------
// 保存版冊子 p34-35「資源回収・ごみ収集曜日一覧(50音順)」の目視転記 (2026-08-31)。
//
// documents/1053/20260403165803.pdf を 600dpi で画像化し、左表 43 行・右表 15 行を
// 人が読んで書き取ったもの。**この表には「収集なし」の欄が無い** (どの行も 4 列すべて
// 埋まっている) ので、空欄の扱いを決める必要はない。
//
// 町丁名の句読点は保存版と簡易版で揺れる (保存版「34番(14号～20号)」/
// 簡易版「34番（14～20号）」等)。照合は下の normName() で漢字と数字だけに落として行う。
// ---------------------------------------------------------------------------
const N = 'normal', D = 'downtown';
const BOOKLET_ROWS = [
  [N, '池袋1・4丁目', '火', '水', '月・木', '第1・3金'],
  [N, '池袋2丁目14番5号・8号、15番2号～3号、16番、17番、19番（要町通り沿い以外）、20番～38番、39番～40番（トキワ通り沿い以外）、42番、44番～45番（トキワ通り沿い以外）、46番、47番～78番', '火', '水', '月・木', '第1・3金'],
  [N, '池袋3丁目', '火', '水', '月・木', '第2・4金'],
  [N, '池袋本町1～4丁目', '火', '水', '月・木', '第1・3金'],
  [N, '要町1丁目1番～8番', '木', '金', '水・土', '第1・3月'],
  [N, '要町1丁目9番～49番', '木', '金', '水・土', '第2・4月'],
  [N, '要町2丁目1番～14番', '木', '金', '水・土', '第1・3月'],
  [N, '要町2丁目15番～36番', '木', '金', '水・土', '第2・4月'],
  [N, '要町3丁目1番～30番', '木', '金', '水・土', '第1・3月'],
  [N, '要町3丁目31番～59番', '木', '金', '水・土', '第2・4月'],
  [N, '上池袋1～4丁目', '土', '月', '火・金', '第2・4水'],
  [N, '北大塚1丁目1番～10番、15番（16号～21号）、34番（14号～20号）', '水', '木', '火・金', '第1・3土'],
  [N, '北大塚1丁目11番～14番、15番（1号～15号）、16番～33番、34番（1号～13号）', '土', '月', '火・金', '第1・3水'],
  [N, '北大塚2丁目', '土', '月', '火・金', '第1・3水'],
  [N, '北大塚3丁目', '土', '月', '火・金', '第2・4水'],
  [N, '駒込1～7丁目', '水', '木', '火・金', '第2・4土'],
  [N, '巣鴨1・2・5丁目', '水', '木', '火・金', '第2・4土'],
  [N, '巣鴨3・4丁目', '水', '木', '火・金', '第1・3土'],
  [N, '千川1・2丁目', '木', '金', '水・土', '第2・4月'],
  [N, '雑司が谷1～3丁目', '金', '土', '月・木', '第2・4火'],
  [N, '高田1・2丁目', '金', '土', '月・木', '第2・4火'],
  [N, '高田3丁目', '月', '火', '水・土', '第2・4木'],
  [N, '高松1～3丁目', '木', '金', '水・土', '第2・4月'],
  [N, '千早1～4丁目', '木', '金', '水・土', '第1・3月'],
  [N, '長崎1～5丁目', '月', '火', '水・土', '第1・3木'],
  [N, '長崎6丁目', '木', '金', '水・土', '第1・3月'],
  [N, '西池袋2・4丁目', '火', '水', '月・木', '第2・4金'],
  [N, '西池袋3丁目1番～19番、21番13号、33番～36番', '火', '水', '月・木', '第2・4金'],
  [N, '西池袋5丁目2番、3番、4番（要町通り沿い以外）、5番、8番（要町通り沿い以外）、9番～28番', '火', '水', '月・木', '第2・4金'],
  [N, '西巣鴨1～4丁目', '土', '月', '火・金', '第1・3水'],
  [N, '東池袋2丁目1番～48番、49番6号付近、53番9号', '金', '土', '月・木', '第1・3火'],
  [N, '東池袋3丁目1番、16番～23番', '金', '土', '月・木', '第1・3火'],
  [N, '東池袋4・5丁目', '金', '土', '月・木', '第1・3火'],
  [N, '南池袋1丁目1番～16番', '火', '水', '月・木', '第2・4金'],
  [N, '南池袋2丁目1番～21番、24番1号（シアターグリーン通り沿い）、28番～49番', '金', '土', '月・木', '第1・3火'],
  [N, '南池袋3・4丁目', '金', '土', '月・木', '第2・4火'],
  [N, '南大塚1・2丁目', '水', '木', '火・金', '第1・3土'],
  [N, '南大塚3丁目1番～24番', '水', '木', '火・金', '第1・3土'],
  [N, '南大塚3丁目25番～37番', '金', '土', '月・木', '第1・3火'],
  [N, '南大塚3丁目38番～55番', '水', '木', '火・金', '第1・3土'],
  [N, '南長崎1～3丁目', '月', '火', '水・土', '第2・4木'],
  [N, '南長崎4～6丁目', '月', '火', '水・土', '第1・3木'],
  [N, '目白1～5丁目', '月', '火', '水・土', '第2・4木'],
  // ---- 池袋駅周辺繁華街地域 (右表) ----
  [D, '池袋2丁目1番～13番、14番（5号、8号以外）、15番1号・6号、18番、19番（要町通り沿い）', '水', '火', '月・木', '第1・3金'],
  [D, '池袋2丁目39番～41番、43番～45番（すべてトキワ通り沿い）', '火', '水', '月・木', '第1・3金'],
  [D, '西池袋1丁目1番～17番', '火', '金', '水・土', '第2・4木'],
  [D, '西池袋1丁目18番～20番、26番～30番、43番、44番', '火', '金', '水・土', '第1・3月'],
  [D, '西池袋1丁目21番～25番、31番～42番', '火', '金', '水・土', '第2・4月'],
  [D, '西池袋3丁目20番～32番（21番13号以外）', '水', '火', '月・木', '第2・4金'],
  [D, '西池袋5丁目1番、4番（要町通り沿い）、8番（要町通り沿い）', '水', '火', '月・木', '第2・4金'],
  [D, '東池袋1丁目1番～7番', '木', '月', '火・金', '第1・3水'],
  [D, '東池袋1丁目8番～11番、14番～21番、29番～33番', '木', '月', '火・金', '第1・3土'],
  [D, '東池袋1丁目12番、13番、22番～28番', '木', '月', '火・金', '第2・4土'],
  [D, '東池袋1丁目34番～50番', '木', '月', '火・金', '第2・4水'],
  [D, '東池袋2丁目49番～63番（49番6号付近、53番9号は除く）', '金', '土', '月・木', '第1・3火'],
  [D, '東池袋3丁目2番～15番', '金', '土', '月・木', '第2・4火'],
  [D, '南池袋1丁目17番～29番', '金', '火', '水・土', '第1・3木'],
  [D, '南池袋2丁目22番～27番、24番1号（シアターグリーン通り沿いは除く）', '金', '火', '水・土', '第1・3木'],
].map(([section, name, ...cells]) => ({ section, name, cells }));

// 町丁名の照合キー。保存版と簡易版で句読点と「N番～M番 / N～M番」の書き方が揺れるので、
// 区切り記号を落とし、範囲記号の直前の 番/号 を落として比べる。
const normName = (s) => s
  .replace(/[、，,・（）()\s]/g, '')
  .replace(/[番号](?=～)/g, '');

const extract = (file, extra = []) => JSON.parse(execFileSync(
  py, [join(HERE, 'extract.py'), join(CACHE, file), ...extra],
  { encoding: 'utf8', maxBuffer: 32 << 20 })).records;

const primary = extract(PRIMARY.file, ['--name-x-max', String(PRIMARY.nameXMax)]);

// ---------------------------------------------------------------------------
// A. 版どうしの照合
// ---------------------------------------------------------------------------
function checkCrossLang(base) {
  let diffs = 0, compared = 0;
  for (const lang of CROSS_LANG) {
    const other = extract(lang.file);
    if (other.length !== base.length) {
      console.log(`  ✗ ${lang.label}: 行数 ${other.length} (一次は ${base.length})`);
      diffs++;
      continue;
    }
    let bad = 0;
    for (const [i, r] of other.entries()) {
      const b = base[i];
      if (r.section !== b.section || r.name_head !== b.name_head
          || r.cells.join('|') !== b.cells.join('|')) {
        console.log(`  ✗ ${lang.label} ${i + 1} 行目: ${r.name_head}[${r.cells}] ≠ ${b.name_head}[${b.cells}]`);
        bad++;
      }
      compared++;
    }
    diffs += bad;
    console.log(`  ${bad ? '✗' : '✓'} ${lang.label}: ${other.length} 行 / 不一致 ${bad}`);
  }
  console.log(`A. 版どうしの照合: ${CROSS_LANG.length} 版 × ${base.length} 行 = ${compared} 行 / 不一致 ${diffs}`);
  return diffs;
}

// ---------------------------------------------------------------------------
// B. 内部照合 (日本語セル ↔ 英語セル)
// ---------------------------------------------------------------------------
const EN_DAY = { Mon: '月', Tue: '火', Wed: '水', Thu: '木', Fri: '金', Sat: '土', Sun: '日' };
const EN_DAYS = { Mondays: '月', Tuesdays: '火', Wednesdays: '水', Thursdays: '木', Fridays: '金', Saturdays: '土', Sundays: '日' };
const EN_OCC = { '1st': '1', '2nd': '2', '3rd': '3', '4th': '4', '5th': '5' };

// "Mon.andThu." → "月・木" / "1stand3rdFridays" → "第1・3金"
function enToJa(en) {
  const nth = /^(1st|2nd|3rd|4th|5th)and(1st|2nd|3rd|4th|5th)([A-Za-z]+)$/.exec(en);
  if (nth) {
    if (!EN_DAYS[nth[3]]) throw new Error(`英語セルの曜日が読めない: "${en}"`);
    return `第${EN_OCC[nth[1]]}・${EN_OCC[nth[2]]}${EN_DAYS[nth[3]]}`;
  }
  const days = en.split(/\.and|\./).filter(Boolean);
  if (days.length && days.every((d) => EN_DAY[d])) return days.map((d) => EN_DAY[d]).join('・');
  throw new Error(`英語セルが読めない: "${en}"`);
}

function checkEnglish(base) {
  let diffs = 0, compared = 0;
  for (const r of base) {
    r.cells.forEach((ja, i) => {
      const en = r.cells_en[i];
      if (!en) { console.log(`  ✗ ${r.name_head} ${i + 1} 列目: 英語セルが無い`); diffs++; return; }
      const back = enToJa(en);
      if (back !== ja) {
        console.log(`  ✗ ${r.name_head} ${i + 1} 列目: 日本語 "${ja}" ≠ 英語 "${en}" (→ "${back}")`);
        diffs++;
      }
      compared++;
    });
  }
  console.log(`B. 内部照合 (日本語 ↔ 英語): ${compared} セル / 不一致 ${diffs}`);
  return diffs;
}

// ---------------------------------------------------------------------------
// C. 保存版の目視転記 ↔ 生成物 (収録期間の全日で展開して比較)
// ---------------------------------------------------------------------------
function loadCourses() {
  const byArea = new Map(); // 正規化した area 名 → { course, rules }
  for (const f of readdirSync(OUTDIR).filter((x) => x.startsWith('course-'))) {
    const doc = yamlParse(readFileSync(join(OUTDIR, f), 'utf8'));
    for (const a of doc.metadata.areas) {
      const key = normName(a.name);
      if (byArea.has(key)) throw new Error(`area 名が重複: "${a.name}"`);
      byArea.set(key, { course: doc.metadata.course, rules: doc.rules, overrides: doc.overrides ?? [] });
    }
  }
  return byArea;
}

function checkBooklet(rows) {
  const byArea = loadCourses();
  const dates = periodDates(PERIOD);
  let diffs = 0, checkedDays = 0, checkedAreas = 0;
  const seen = new Set();

  for (const row of rows) {
    let want;
    try {
      want = expandRange(PERIOD, cellsToRules(row.cells), [], []);
    } catch (e) {
      console.log(`  ✗ ${row.name}: 転記した曜日が読めない (${e.message})`);
      diffs++;
      continue;
    }
    for (const a of splitAreas(row.name)) {
      const key = normName(a.name);
      const got = byArea.get(key);
      if (!got) {
        console.log(`  ✗ 生成物に無い area: "${a.name}" (保存版 "${row.name}")`);
        diffs++;
        continue;
      }
      seen.add(key);
      checkedAreas++;
      const have = expandRange(PERIOD, got.rules, got.overrides, []);
      for (const iso of dates) {
        const w = [...(want.get(iso) ?? [])].sort().join(',');
        const h = [...(have.get(iso) ?? [])].sort().join(',');
        if (w !== h) {
          console.log(`  ✗ ${a.name} ${iso}: 保存版 [${w}] ≠ 生成物 [${h}] (course ${got.course})`);
          diffs++;
        }
        checkedDays++;
      }
    }
  }
  for (const key of byArea.keys()) {
    if (!seen.has(key)) { console.log(`  ✗ 保存版に無い area: "${key}"`); diffs++; }
  }
  console.log(`C. 保存版との全数照合: ${checkedAreas} area × ${dates.length} 日 = ${checkedDays} 日枠 / 不一致 ${diffs}`);
  return diffs;
}

// ---------------------------------------------------------------------------

const tamper = process.argv.includes('--tamper');

if (!tamper) {
  const total = checkCrossLang(primary) + checkEnglish(primary) + checkBooklet(BOOKLET_ROWS);
  console.log(total === 0 ? '\n照合: すべて一致' : `\n照合: 不一致 ${total} 件`);
  if (total) process.exit(1);
} else {
  // 改竄検査。**狙った場所が本当に変わったかを先に確かめる** (空振りを 3 回踏んでいる)。
  console.log('=== 改竄検査: 各検査が実際に落ちることを確かめる ===\n');
  const clone = (x) => JSON.parse(JSON.stringify(x));
  let failures = 0;
  const expectFail = (label, n) => {
    console.log(`${n > 0 ? '✓' : '✗'} ${label}: 不一致 ${n} 件${n > 0 ? '' : ' ← 検査が効いていない'}\n`);
    if (n === 0) failures++;
  };

  // 1) 一次ソースの曜日を 1 つ変える → A と B が落ちるはず
  {
    const t = clone(primary);
    const before = t[0].cells[2];
    t[0].cells[2] = before === '月・木' ? '火・金' : '月・木';
    if (t[0].cells[2] === before) throw new Error('改竄が空振り');
    console.log(`[1] 一次ソース 1 行目 3 列目を "${before}" → "${t[0].cells[2]}" に改竄`);
    expectFail('  A. 版どうしの照合', checkCrossLang(t));
    expectFail('  B. 内部照合', checkEnglish(t));
  }
  // 2) 一次ソースの行を 1 つ落とす → A が落ちるはず
  {
    const t = clone(primary).slice(1);
    if (t.length !== primary.length - 1) throw new Error('改竄が空振り');
    console.log(`[2] 一次ソースの 1 行目を削除 (${primary.length} → ${t.length} 行)`);
    expectFail('  A. 版どうしの照合', checkCrossLang(t));
  }
  // 3) 目視転記の曜日を 1 つ変える (消す方向) → C が落ちるはず
  {
    const t = clone(BOOKLET_ROWS);
    const before = t[4].cells[0];
    t[4].cells[0] = '日';
    if (t[4].cells[0] === before) throw new Error('改竄が空振り');
    console.log(`[3] 目視転記 5 行目 1 列目を "${before}" → "日" に改竄 (収集日をずらす)`);
    expectFail('  C. 保存版との全数照合', checkBooklet(t));
  }
  // 4) 目視転記に第n を足す (足す方向) → C が落ちるはず
  {
    const t = clone(BOOKLET_ROWS);
    const before = t[10].cells[3];
    t[10].cells[3] = '第1・2・3・4水';
    if (t[10].cells[3] === before) throw new Error('改竄が空振り');
    console.log(`[4] 目視転記 11 行目 4 列目を "${before}" → "第1・2・3・4水" に改竄 (収集日を増やす)`);
    expectFail('  C. 保存版との全数照合', checkBooklet(t));
  }
  // 5) 目視転記の行を 1 つ落とす → C が「保存版に無い area」で落ちるはず
  {
    const t = clone(BOOKLET_ROWS).filter((_, i) => i !== 15);
    if (t.length !== BOOKLET_ROWS.length - 1) throw new Error('改竄が空振り');
    console.log(`[5] 目視転記の 16 行目 (駒込1～7丁目) を削除`);
    expectFail('  C. 保存版との全数照合', checkBooklet(t));
  }

  console.log(failures === 0
    ? '改竄検査: 5 通りすべてで検査が反応した'
    : `改竄検査: ${failures} 通りで検査が反応しなかった`);
  if (failures) process.exit(1);
}
