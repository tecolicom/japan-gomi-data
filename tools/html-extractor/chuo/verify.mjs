// 中央区の照合。build.mjs がやる検査 (町字の網羅・曜日セルの読み・自己検証) とは別に、
// **一次ソースの HTML 表を、別に組版された表現と突き合わせる**。
//
//   A. パンフレットとの照合 「ごみと資源の分け方・出し方」の外国語版に同じ曜日表がある。
//                           英語版・中国語版はそれぞれ別に組版されており、56 行 × 5 品目で
//                           全数比較できる。**収録しない粗大ごみも照合には使う** (無料の 5 列目)。
//   B. 版どうしの照合       英語版 ↔ 中国語版。
//   C. 生成物との照合       course YAML を収録期間の全日に展開し、HTML の曜日と突き合わせる。
//
// **鮮度の裁定は先に決めてある。** HTML (Last-Modified 2026-07-30) はパンフレット
// (令和8年1月発行) より新しいので、食い違ったら HTML を正とする。
//
// 使い方: node verify.mjs [--tamper]
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { parse as yamlParse } from 'yaml';
import { findPython } from '../../_lib/python.mjs';
import { expandRange, periodDates } from '../../_lib/schedule.mjs';
import { parsePage, parseDays, splitChome, areaName } from './parse.mjs';
import { PERIOD, AREAS_JA, PAMPHLETS, COLUMNS, EMITTED, GROUP_CATEGORIES } from './sources.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CACHE = join(HERE, 'cache');
const OUTDIR = join(HERE, '../../../municipalities/tokyo/chuo', PERIOD);
const DOW = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];
const py = findPython([]);

const pages = parsePage(readFileSync(join(CACHE, 'youbi.html'), 'utf8'), AREAS_JA);
const rows = pages.flatMap((p) => p.rows);
// HTML 側を「地域 → 曜日番号の配列」へ (5 品目ぶん)。
// **地域で突き合わせる。** パンフレットは本文の並びが京橋→月島→日本橋で HTML と違う。
const htmlAreas = Object.fromEntries(
  pages.map((p) => [p.areaJa, p.rows.map((r) => r.days.map((d) => parseDays(d)))]));

// 韓国語版は照合に使わない (理由は extract.py の docstring)
const LANGS = PAMPHLETS.filter((p) => p.lang !== 'ko');
const pamph = Object.fromEntries(LANGS.map((p) => [p.lang, JSON.parse(execFileSync(
  py, [join(HERE, 'extract.py'), join(CACHE, p.file), '--lang', p.lang],
  { encoding: 'utf8', maxBuffer: 32 << 20 })).areas]));

const courses = readdirSync(OUTDIR).filter((f) => f.startsWith('course-'))
  .map((f) => yamlParse(readFileSync(join(OUTDIR, f), 'utf8')));

const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

// ---------------------------------------------------------------------------
// A. HTML ↔ パンフレット (全数)
// ---------------------------------------------------------------------------
function checkPamphlets(html, books) {
  let diffs = 0, cells = 0;
  for (const [lang, areas] of Object.entries(books)) {
    let bad = 0;
    for (const areaJa of AREAS_JA) {
      const h = html[areaJa] ?? [];
      const p = areas[areaJa] ?? [];
      if (p.length !== h.length) {
        console.log(`  ✗ ${lang} ${areaJa}: ${p.length} 行 (HTML は ${h.length} 行)`);
        bad++;
        continue;
      }
      for (const [i, r] of p.entries()) {
        for (let c = 0; c < COLUMNS.length; c++) {
          cells++;
          if (!same(r[c], h[i][c])) {
            console.log(`  ✗ ${lang} ${areaJa} ${i + 1} 行目 ${COLUMNS[c]}: パンフ [${r[c]}] ≠ HTML [${h[i][c]}]`);
            bad++;
          }
        }
      }
    }
    console.log(`  ${bad ? '✗' : '✓'} ${lang}: 不一致 ${bad}`);
    diffs += bad;
  }
  console.log(`A. パンフレットとの照合: ${cells} セル / 不一致 ${diffs}`);
  return diffs;
}

// ---------------------------------------------------------------------------
// B. 版どうし (英語版 ↔ 中国語版)
// ---------------------------------------------------------------------------
function checkCrossLang(books) {
  const [a, b] = Object.keys(books);
  if (!b) { console.log('B. 版どうしの照合: 版が 1 つしかない'); return 0; }
  let diffs = 0, cells = 0;
  for (const areaJa of AREAS_JA) {
    const x = books[a][areaJa] ?? [], y = books[b][areaJa] ?? [];
    if (x.length !== y.length) {
      console.log(`  ✗ ${areaJa} の行数が違う: ${a}=${x.length} ${b}=${y.length}`);
      diffs++;
    }
    for (let i = 0; i < Math.min(x.length, y.length); i++) {
      for (let c = 0; c < COLUMNS.length; c++) {
        cells++;
        if (!same(x[i][c], y[i][c])) {
          console.log(`  ✗ ${areaJa} ${i + 1} 行目 ${COLUMNS[c]}: ${a} [${x[i][c]}] ≠ ${b} [${y[i][c]}]`);
          diffs++;
        }
      }
    }
  }
  console.log(`B. 版どうしの照合 (${a} ↔ ${b}): ${cells} セル / 不一致 ${diffs}`);
  return diffs;
}

// ---------------------------------------------------------------------------
// C. 生成物 ↔ HTML (収録期間の全日)
// ---------------------------------------------------------------------------
// HTML の行 + ABR から、**build とは別の実装で** 期待する area 名 → 曜日 を組み立てる。
// build の展開ロジックを import しないのが要点 (同じ誤りを二度書けば検査にならない)。
function expectedAreas(srcRows) {
  const abr = JSON.parse(readFileSync(join(CACHE, 'abr-town.json'), 'utf8')).towns;
  const byTown = new Map();
  for (const t of abr) {
    if (!byTown.has(t.oaza)) byTown.set(t.oaza, []);
    byTown.get(t.oaza).push(t.chome_number);
  }
  for (const v of byTown.values()) v.sort((a, b) => (a ?? 0) - (b ?? 0));

  const out = new Map();
  for (const r of srcRows) {
    const town = byTown.has(r.town) ? r.town
      : byTown.has(`日本橋${r.town}`) ? `日本橋${r.town}`
        : (() => { throw new Error(`ABR に無い町 "${r.town}"`); })();
    for (const sp of splitChome(r.chome)) {
      const specs = (sp.chome === null && sp.banchi === null && !byTown.get(town).includes(null))
        ? byTown.get(town).map((c) => ({ chome: c, banchi: null }))
        : [sp];
      for (const t of specs) {
        const name = areaName(town, t);
        if (out.has(name)) throw new Error(`期待 area が重複: ${name}`);
        out.set(name, r.days);
      }
    }
  }
  return out;
}

function checkExpand(srcRows, courseDocs) {
  const byArea = new Map();
  for (const doc of courseDocs) {
    for (const a of doc.metadata.areas) {
      if (byArea.has(a.name)) throw new Error(`area 名が重複: ${a.name}`);
      byArea.set(a.name, doc.rules);
    }
  }
  const want = expectedAreas(srcRows);

  // **両方向で集合を比べる。** 生成物側だけを回すと、生成物から area が消えたときに
  // ループが訪れず不一致にならない (改竄検査で実際に空振りした)。
  let diffs = 0;
  for (const n of want.keys()) {
    if (!byArea.has(n)) { console.log(`  ✗ 生成物に無い area: ${n}`); diffs++; }
  }
  for (const n of byArea.keys()) {
    if (!want.has(n)) { console.log(`  ✗ HTML から出てこない area: ${n}`); diffs++; }
  }

  const dates = periodDates(PERIOD);
  let checked = 0;
  for (const [n, days] of want) {
    const rules = byArea.get(n);
    if (!rules) continue;
    const got = expandRange(PERIOD, rules, [], []);
    for (const iso of dates) {
      const dow = DOW[(new Date(`${iso}T00:00:00`).getDay() + 6) % 7];
      const exp = new Set();
      EMITTED.forEach((group, ci) => {
        if (parseDays(days[ci]).map((x) => DOW[x]).includes(dow)) {
          for (const cat of GROUP_CATEGORIES[group]) exp.add(cat);
        }
      });
      const have = new Set(got.get(iso) ?? []);
      if (!(exp.size === have.size && [...exp].every((c) => have.has(c)))) {
        console.log(`  ✗ ${n} ${iso}: HTML [${[...exp].sort()}] ≠ 生成物 [${[...have].sort()}]`);
        diffs++;
      }
      checked++;
    }
  }
  console.log(`C. 生成物との照合: 期待 ${want.size} area / 生成物 ${byArea.size} area / ${checked} 日枠 / 不一致 ${diffs}`);
  return diffs;
}

// ---------------------------------------------------------------------------

const tamper = process.argv.includes('--tamper');

if (!tamper) {
  const total = checkPamphlets(htmlAreas, pamph) + checkCrossLang(pamph) + checkExpand(rows, courses);
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
  // 1) HTML の曜日を 1 つ変える → A が落ちるはず
  {
    const t = clone(htmlAreas);
    const before = [...t['京橋地域'][0][0]];
    t['京橋地域'][0][0] = [0, 1];
    if (same(t['京橋地域'][0][0], before)) throw new Error('改竄が空振り');
    console.log(`[1] HTML 京橋地域 1 行目の燃やすごみを [${before}] → [${t['京橋地域'][0][0]}] に改竄`);
    expectFail('  A. パンフレットとの照合', checkPamphlets(t, pamph));
  }
  // 2) パンフの行を 1 つ落とす (消す方向) → A が落ちるはず
  {
    const t = { en: clone(pamph.en), zh: clone(pamph.zh) };
    const n0 = t.en['京橋地域'].length;
    t.en['京橋地域'] = t.en['京橋地域'].slice(1);
    if (t.en['京橋地域'].length !== n0 - 1) throw new Error('改竄が空振り');
    console.log(`[2] 英語版 京橋地域の 1 行目を削除 (${n0} → ${t.en['京橋地域'].length})`);
    expectFail('  A. パンフレットとの照合', checkPamphlets(htmlAreas, t));
  }
  // 3) 中国語版の粗大ごみを変える (収録しない列でも検査は効く) → B が落ちるはず
  {
    const t = { en: clone(pamph.en), zh: clone(pamph.zh) };
    const before = [...t.zh['京橋地域'][5][4]];
    t.zh['京橋地域'][5][4] = [6];
    if (same(t.zh['京橋地域'][5][4], before)) throw new Error('改竄が空振り');
    console.log(`[3] 中国語版 京橋地域 6 行目の粗大ごみを [${before}] → [${t.zh['京橋地域'][5][4]}] に改竄`);
    expectFail('  B. 版どうしの照合', checkCrossLang(t));
  }
  // 4) 生成物の曜日を 1 つ足す → C が落ちるはず
  {
    const t = clone(courses);
    const doc = t.find((d) => d.metadata.course === '1');
    const r = doc.rules.find((x) => x.category === 'burnable');
    const before = [...r.days];
    r.days = [...r.days, 'SU'];
    if (same(r.days, before)) throw new Error('改竄が空振り');
    console.log(`[4] 生成物 course 1 の燃やすごみに SU を追加 [${before}] → [${r.days}]`);
    expectFail('  C. 生成物との照合', checkExpand(rows, t));
  }
  // 5) 生成物から area を 1 つ落とす (消す方向) → C が落ちるはず
  {
    const t = clone(courses);
    const doc = t.find((d) => d.metadata.areas.length > 1);
    const before = doc.metadata.areas.length;
    const dropped = doc.metadata.areas.pop().name;
    if (doc.metadata.areas.length === before) throw new Error('改竄が空振り');
    console.log(`[5] 生成物 course ${doc.metadata.course} から area「${dropped}」を削除`);
    expectFail('  C. 生成物との照合', checkExpand(rows, t));
  }
  console.log(failures === 0
    ? '改竄検査: 5 通りすべてで検査が反応した'
    : `改竄検査: ${failures} 通りで検査が反応しなかった`);
  if (failures) process.exit(1);
}
