// 江東区の照合。build.mjs がやる検査 (CSV との曜日規則照合・町字の網羅・自己検証) とは別に、
// **生成物そのもの**を独立な表現と突き合わせる。
//
//   A. 版どうしの照合   中国語版 ↔ 韓国語版。同じ表を別々に組版してあるので、
//                       版面の読み違いが出る。曜日規則と隔週の全日付を突き合わせる。
//   B. 日本語版との照合 日本語版 (8omote.pdf) は chars 0 の画像 PDF で機械では読めない。
//                       400dpi で画像化して目視転記し、生成物と突き合わせる。
//                       **別の版面**なので A より独立性が強い。
//
// 目視転記は JA_SHEET に固定保持する (一過性にしない)。転記したのは
//   ① 12 地区 × 4 品目の曜日規則 (48 セル)
//   ② 12 月・1 月の隔週日付 — **年末年始の端**を狙う (playbook §6「サンプルは端を狙う」)。
//      12 地区中 5 地区がこの 2 か月で 1 回抜けるので、抜けの有無がそのまま検査になる。
//
// 使い方: node verify.mjs [--tamper]
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { parse as yamlParse } from 'yaml';
import { findPython } from '../../_lib/python.mjs';
import { expandRange, isUnknown, periodDates } from '../../_lib/schedule.mjs';
import { SHEETS, PERIOD, GROUP_CATEGORIES, DISTRICTS } from './sources.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CACHE = join(HERE, 'cache');
const OUTDIR = join(HERE, '../../../municipalities/tokyo/koto', PERIOD);
const py = findPython(['pdfplumber']);
const DOW = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];

const extract = (s) => JSON.parse(execFileSync(
  py, [join(HERE, 'extract.py'), join(CACHE, s.file), '--lang', s.lang],
  { encoding: 'utf8', maxBuffer: 32 << 20 })).districts;

const sheets = Object.fromEntries(SHEETS.map((s) => [s.lang, extract(s)]));
const courses = readdirSync(OUTDIR).filter((f) => f.startsWith('course-'))
  .map((f) => yamlParse(readFileSync(join(OUTDIR, f), 'utf8')));

// ---------------------------------------------------------------------------
// 日本語版 (画像 PDF) の目視転記 (2026-09-12、400dpi で画像化して読み取り)
//
// [地区, 資源, プラスチック, 燃やすごみ, 隔週, 12月の日, 1月の日]
// 曜日は日本語 1 文字。燃やすごみは週 2 回なので 2 文字。
// ---------------------------------------------------------------------------
const JA_SHEET = [
  [1, '土', '木', '火金', '月', [14, 28], [11, 25]],
  [2, '月', '金', '水土', '火', [1, 15], [12, 26]],
  [3, '火', '土', '月木', '水', [2, 16], [13, 27]],
  [4, '水', '月', '火金', '木', [3, 17], [14, 28]],
  [5, '木', '火', '水土', '金', [4, 18], [15, 29]],
  [6, '金', '水', '月木', '土', [5, 19], [16, 30]],
  [7, '土', '木', '火金', '月', [7, 21], [4, 18]],
  [8, '月', '金', '水土', '火', [8, 22], [5, 19]],
  [9, '火', '土', '月木', '水', [9, 23], [6, 20]],
  [10, '水', '月', '火金', '木', [10, 24], [7, 21]],
  [11, '木', '火', '水土', '金', [11, 25], [8, 22]],
  [12, '金', '水', '月木', '土', [12, 26], [9, 23]],
];
const JA_DAY = { 月: 0, 火: 1, 水: 2, 木: 3, 金: 4, 土: 5, 日: 6 };
const idxOf = (s) => [...s].map((c) => {
  if (!(c in JA_DAY)) throw new Error(`目視転記の曜日が読めない: "${c}"`);
  return JA_DAY[c];
});

// ---------------------------------------------------------------------------
// A. 版どうしの照合
// ---------------------------------------------------------------------------
function checkCrossLang(base, others) {
  let diffs = 0, compared = 0;
  for (const [lang, other] of Object.entries(others)) {
    if (other.length !== base.length) {
      console.log(`  ✗ ${lang}: 地区数 ${other.length} (${base.length} のはず)`);
      diffs++;
      continue;
    }
    let bad = 0;
    for (const [i, o] of other.entries()) {
      const b = base[i];
      // 韓国語版は「燃やすごみ」の見出し語が拾えないので、共通する項目だけ比べる
      const keys = Object.keys(o.weekly).filter((k) => k in b.weekly);
      for (const k of keys) {
        compared++;
        if (o.weekly[k].join(',') !== b.weekly[k].join(',')) {
          console.log(`  ✗ ${lang} 地区${o.district} ${k}: [${o.weekly[k]}] ≠ [${b.weekly[k]}]`);
          bad++;
        }
      }
      compared++;
      if (o.biweekly_weekday !== b.biweekly_weekday) {
        console.log(`  ✗ ${lang} 地区${o.district} 隔週: ${o.biweekly_weekday} ≠ ${b.biweekly_weekday}`);
        bad++;
      }
      compared += o.dates.length;
      if (o.dates.join(',') !== b.dates.join(',')) {
        console.log(`  ✗ ${lang} 地区${o.district} 日付が違う (${o.dates.length} vs ${b.dates.length} 件)`);
        bad++;
      }
    }
    console.log(`  ${bad ? '✗' : '✓'} ${lang}: 地区 ${other.length} / 不一致 ${bad}`);
    diffs += bad;
  }
  console.log(`A. 版どうしの照合: ${compared} 項目 / 不一致 ${diffs}`);
  return diffs;
}

// ---------------------------------------------------------------------------
// B. 日本語版の目視転記 ↔ 生成物
// ---------------------------------------------------------------------------
function checkJaSheet(rows, courseDocs) {
  const byId = new Map(courseDocs.map((d) => [Number(d.metadata.course), d]));
  let diffs = 0, cells = 0, dateCells = 0;
  for (const [n, res, pla, bur, bi, dec, jan] of rows) {
    const doc = byId.get(n);
    if (!doc) { console.log(`  ✗ 生成物に地区${n} が無い`); diffs++; continue; }
    const rules = Object.fromEntries(doc.rules.map((r) => [r.category, r]));
    // 曜日規則 3 品目 (代表カテゴリで見る。同じ group の他カテゴリは build が同じ days を入れる)
    for (const [want, cat] of [[res, GROUP_CATEGORIES['資源'][0]], [pla, 'plastic'], [bur, 'burnable']]) {
      cells++;
      const got = (rules[cat]?.days ?? []).join(',');
      const exp = idxOf(want).map((i) => DOW[i]).join(',');
      if (got !== exp) { console.log(`  ✗ 地区${n} ${cat}: 目視 [${exp}] ≠ 生成物 [${got}]`); diffs++; }
    }
    // 隔週の曜日 (monthly_specific の全日付がその曜日か)
    cells++;
    const wd = idxOf(bi)[0];
    const nb = rules['non_burnable']?.dates ?? [];
    const wrong = nb.filter((d) => (new Date(`${d}T00:00:00`).getDay() + 6) % 7 !== wd);
    if (wrong.length) { console.log(`  ✗ 地区${n} 隔週の曜日が違う日: ${wrong.slice(0, 3)}`); diffs++; }
    // 12 月・1 月の日付 (年末年始の端)
    for (const [ym, days] of [['2026-12', dec], ['2027-01', jan]]) {
      const got = nb.filter((d) => d.startsWith(ym)).map((d) => Number(d.slice(8)));
      dateCells += days.length;
      if (got.join(',') !== days.join(',')) {
        console.log(`  ✗ 地区${n} ${ym}: 目視 [${days}] ≠ 生成物 [${got}]`);
        diffs++;
      }
    }
  }
  console.log(`B. 日本語版の目視転記との照合: ${cells} セル + ${dateCells} 日付 / 不一致 ${diffs}`);
  return diffs;
}

// ---------------------------------------------------------------------------
// C. 生成物を収録期間の全日へ展開して、抽出結果と突き合わせる
// ---------------------------------------------------------------------------
function checkExpand(base, courseDocs) {
  const byId = new Map(courseDocs.map((d) => [Number(d.metadata.course), d]));
  const all = periodDates(PERIOD);
  let diffs = 0, checked = 0;
  for (const d of base) {
    const doc = byId.get(d.district);
    if (!doc) { console.log(`  ✗ 生成物に地区${d.district} が無い`); diffs++; continue; }
    const got = expandRange(PERIOD, doc.rules, [], doc.unknown_periods);
    const nb = new Set(d.dates);
    // **収録期間の全日を回す。** 生成物が出した日だけを回すと、生成物から日付が
    // 消えたときにループが訪れず不一致にならない (改竄検査で実際に空振りした)。
    for (const iso of all) {
      if (isUnknown(iso, doc.unknown_periods)) continue;
      const hasNb = (got.get(iso) ?? []).includes('non_burnable');
      if (hasNb !== nb.has(iso)) {
        console.log(`  ✗ 地区${d.district} ${iso}: 燃やさないごみ 展開=${hasNb} シート=${nb.has(iso)}`);
        diffs++;
      }
      checked++;
    }
  }
  console.log(`C. 展開と抽出結果の突合: ${checked} 日枠 / 不一致 ${diffs}`);
  return diffs;
}

// ---------------------------------------------------------------------------

const tamper = process.argv.includes('--tamper');
const base = sheets.zh;
const others = Object.fromEntries(Object.entries(sheets).filter(([k]) => k !== 'zh'));

if (base.length !== DISTRICTS) throw new Error(`地区が ${base.length} 個`);

if (!tamper) {
  const total = checkCrossLang(base, others) + checkJaSheet(JA_SHEET, courses) + checkExpand(base, courses);
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
  // 1) 韓国語版の曜日を 1 つ変える → A が落ちるはず
  {
    const t = { ko: clone(others.ko) };
    const before = t.ko[0].weekly['資源'][0];
    t.ko[0].weekly['資源'][0] = (before + 1) % 7;
    if (t.ko[0].weekly['資源'][0] === before) throw new Error('改竄が空振り');
    console.log(`[1] 韓国語版 地区1 の資源を ${before} → ${t.ko[0].weekly['資源'][0]} に改竄`);
    expectFail('  A. 版どうしの照合', checkCrossLang(base, t));
  }
  // 2) 韓国語版の日付を 1 つ落とす (消す方向) → A が落ちるはず
  {
    const t = { ko: clone(others.ko) };
    const before = t.ko[2].dates.length;
    t.ko[2].dates.splice(5, 1);
    if (t.ko[2].dates.length === before) throw new Error('改竄が空振り');
    console.log(`[2] 韓国語版 地区3 の日付を 1 つ削除 (${before} → ${t.ko[2].dates.length})`);
    expectFail('  A. 版どうしの照合', checkCrossLang(base, t));
  }
  // 3) 目視転記の曜日を変える → B が落ちるはず
  {
    const t = clone(JA_SHEET);
    const before = t[5][1];
    t[5][1] = '日';
    if (t[5][1] === before) throw new Error('改竄が空振り');
    console.log(`[3] 目視転記 地区6 の資源を "${before}" → "日" に改竄`);
    expectFail('  B. 日本語版との照合', checkJaSheet(t, courses));
  }
  // 4) 目視転記の 12 月に年末年始の日を足す (足す方向) → B が落ちるはず
  {
    const t = clone(JA_SHEET);
    const before = [...t[1][5]];
    t[1][5] = [1, 15, 29];   // 地区2 は 12/29 が抜けているのが正
    if (String(t[1][5]) === String(before)) throw new Error('改竄が空振り');
    console.log(`[4] 目視転記 地区2 の 12 月に 29 日を追加 [${before}] → [${t[1][5]}]`);
    expectFail('  B. 日本語版との照合', checkJaSheet(t, courses));
  }
  // 5) 生成物の隔週日付を 1 つ削る → C が落ちるはず
  {
    const t = clone(courses);
    const doc = t.find((d) => d.metadata.course === '9');
    const r = doc.rules.find((x) => x.category === 'non_burnable');
    const before = r.dates.length;
    r.dates.splice(3, 1);
    if (r.dates.length === before) throw new Error('改竄が空振り');
    console.log(`[5] 生成物 地区9 の燃やさないごみを 1 日削除 (${before} → ${r.dates.length})`);
    expectFail('  C. 展開と抽出結果の突合', checkExpand(base, t));
  }
  console.log(failures === 0
    ? '改竄検査: 5 通りすべてで検査が反応した'
    : `改竄検査: ${failures} 通りで検査が反応しなかった`);
  if (failures) process.exit(1);
}
