// 青梅市の照合。3 経路で検証する。
//
// (1) 生成済み course YAML を読み直し、expandRange で収録期間を再展開して
//     extract.py が PDF から読んだ実日付と全日比較する (build とは別経路)。
// (2) 冊子本文に文章で書かれた収集頻度規則との独立照合。カレンダー図版 (色) とは別に
//     人が書いた表現であり、抽出結果がその規則どおりかを機械判定する。
//     「第n週目」は実測すると「その月 n 回目のその曜日」を指す (本リポジトリの monthly_nth と同義)。
//     年末年始の休止でひと月ぶん周期がずれる日程があるため、休止を含む月は判定から外す
//     (外した月は件数として報告する — 黙って落とさない)。
// (3) PDF ページ画像の目視転記との照合 (色ベース抽出の取りこぼし・列ずれを押さえる)。
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as yamlParse } from 'yaml';
import { expandRange } from '../../_lib/schedule.mjs';
import { ruleOfThreePct } from '../../_lib/verify.mjs';
import { SCHEDULES } from './sources.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..', '..');
const PERIOD = '2026-04--2027-03';
const DIR = join(ROOT, 'municipalities', 'tokyo', 'ome', PERIOD);
const data = JSON.parse(readFileSync(join(HERE, 'cache', 'extracted.json'), 'utf8'));
const DISTS = Object.keys(SCHEDULES);
const ITEM2CAT = {
  '燃やすごみ': 'burnable', '燃やさないごみ': 'non_burnable', '容器包装プラスチックごみ': 'plastic',
  '新聞・折込チラシ': 'paper', '雑誌・雑紙': 'paper', 'ダンボール・飲料用紙パック': 'paper',
  '繊維類': 'cloth', 'ビン': 'glass_bottle', 'カン': 'beverage_can',
  'ペットボトル': 'pet_bottle', '有害ごみ': 'hazardous', 'ガラス': null, '陶磁器': null,
};

// --- (1) YAML 再展開 vs PDF 抽出結果 ---
let ng = 0, patterns = 0, dayCells = 0;
const expanded = new Map();
for (const d of DISTS) {
  const doc = yamlParse(readFileSync(join(DIR, `course-${d}.yaml`), 'utf8'));
  const actual = expandRange(doc.metadata.period, doc.rules, doc.overrides || [], doc.unknown_periods || []);
  expanded.set(d, actual);
  patterns += doc.rules.length;
  const events = data[d].events;
  let mism = 0;
  for (const iso of Object.keys(events).sort()) {
    dayCells++;
    const exp = [...new Set(events[iso].map((i) => ITEM2CAT[i]).filter(Boolean))].sort().join(',');
    const got = [...(actual.get(iso) || [])].sort().join(',');
    if (got !== exp) { if (++mism <= 5) console.error(`  ${d}日程 ${iso}: got[${got}] exp[${exp}]`); }
  }
  if (mism) { console.error(`${d}日程: ${mism}日 不一致`); ng++; }
  else console.log(`${d}日程: 全${Object.keys(events).length}日 一致 (rules ${doc.rules.length})`);
}

// --- (2) 冊子本文の収集頻度規則との照合 ---
// 出典: 令和8年度版カレンダー 7ページ(燃やさないごみ)・10ページ(新聞/雑誌)・
//       11ページ(ダンボール/繊維類)・12ページ(カン/ビン)・13ページ(ガラス/陶磁器)・14ページ(ペットボトル)
const NTH_RULES = {
  '新聞・折込チラシ': [1], '雑誌・雑紙': [2], 'ダンボール・飲料用紙パック': [3], '繊維類': [4],
  '燃やさないごみ': [3], 'カン': [1, 3, 5], 'ガラス': [1, 3, 5], 'ビン': [2, 4], '陶磁器': [2, 4],
};
const nthOf = (iso) => Math.floor((Number(iso.slice(8, 10)) - 1) / 7) + 1;
const dowOf = (iso) => new Date(iso + 'T00:00:00').getDay();

let ruleSlots = 0, ruleNg = 0;
const skippedMonths = new Set();
for (const d of DISTS) {
  const events = data[d].events;
  const dates = Object.keys(events).sort();
  const stop = new Set(dates.filter((k) => events[k].length === 0));
  const byItem = new Map();
  for (const k of dates) for (const it of events[k]) {
    if (!byItem.has(it)) byItem.set(it, []);
    byItem.get(it).push(k);
  }
  let mism = 0;
  for (const [item, occ] of Object.entries(NTH_RULES)) {
    const ds = byItem.get(item) || [];
    if (!ds.length) { console.error(`  頻度規則 ${d}日程: ${item} が 0 件`); mism++; continue; }
    const dow = dowOf(ds[0]);
    // 年末年始の休止でその曜日の回が飛んだ月は周期がずれるので判定から外す
    const skip = new Set();
    for (const k of stop) if (dowOf(k) === dow) { skip.add(k.slice(0, 7)); skippedMonths.add(`${d}/${k.slice(0, 7)}`); }
    ruleSlots++;
    const got = [...new Set(ds.filter((k) => !skip.has(k.slice(0, 7))).map(nthOf))].sort((a, b) => a - b);
    if (got.join(',') !== occ.join(',')) {
      console.error(`  頻度規則 ${d}日程 ${item}: 第[${got}]回目 (冊子は第[${occ}]回目)`);
      mism++;
    }
  }
  // 冊子が明記する同日性・排他性
  const set = (it) => new Set(byItem.get(it) || []);
  const eq = (a, b) => a.size === b.size && [...a].every((x) => b.has(x));
  const checks = [
    ['ガラス', 'カン'], ['陶磁器', 'ビン'], ['有害ごみ', 'ペットボトル'],
  ];
  for (const [a, b] of checks) {
    ruleSlots++;
    if (!eq(set(a), set(b))) { console.error(`  ${d}日程: ${a} と ${b} が同日でない`); mism++; }
  }
  // 容器包装プラスチック + 燃やさないごみ = 資源日全体 (7ページの「※第1,2,4,5週目は容器包装プラスチックごみ」)
  ruleSlots++;
  const plas = set('容器包装プラスチックごみ'), nb = set('燃やさないごみ'), pet = set('ペットボトル');
  const union = new Set([...plas, ...nb]);
  if (!eq(union, pet) || [...plas].some((x) => nb.has(x))) {
    console.error(`  ${d}日程: 容プラ+燃やさない が資源日と一致しない`);
    mism++;
  }
  if (mism) { ruleNg += mism; console.error(`頻度規則 ${d}日程: ${mism}件 不一致`); }
  else console.log(`頻度規則 ${d}日程: 冊子本文の規則と一致`);
}

// --- (3) PDF ページ画像の目視転記との照合 ---
// 文字コード: b=燃やすごみ n=燃やさないごみ p=容器包装プラスチック a=古紙(新聞/雑誌/ダンボール)
//             c=繊維類 g=ビン k=カン t=ペットボトル h=有害ごみ  -=収集なし
// 平日はすべて記載する (書き漏れを - と区別するため)。土日は収集なしを別途 assert。
const LET = { b: 'burnable', n: 'non_burnable', p: 'plastic', a: 'paper', c: 'cloth',
  g: 'glass_bottle', k: 'beverage_can', t: 'pet_bottle', h: 'hazardous' };
const PDF_SAMPLES = [
  { d: 'A', month: '2026-04', page: 20,
    days: '1:pakth 2:b 3:- 6:b 7:- 8:pagth 9:b 10:- 13:b 14:- 15:nakth 16:b 17:- 20:b 21:- 22:pcgth 23:b 24:- 27:b 28:- 29:pkth 30:b' },
  { d: 'A', month: '2026-05', page: 20,
    days: '1:- 4:b 5:- 6:pakth 7:b 8:- 11:b 12:- 13:pagth 14:b 15:- 18:b 19:- 20:nakth 21:b 22:- 25:b 26:- 27:pcgth 28:b 29:-' },
  { d: 'B', month: '2026-04', page: 20,
    days: '1:a 2:b 3:- 6:b 7:pkth 8:a 9:b 10:- 13:b 14:pgth 15:a 16:b 17:- 20:b 21:nkth 22:c 23:b 24:- 27:b 28:pgth 29:- 30:b' },
  { d: 'B', month: '2026-05', page: 20,
    days: '1:- 4:b 5:pkth 6:a 7:b 8:- 11:b 12:pgth 13:a 14:b 15:- 18:b 19:nkth 20:a 21:b 22:- 25:b 26:pgth 27:c 28:b 29:-' },
];

let pdfCells = 0, pdfNg = 0;
for (const s of PDF_SAMPLES) {
  const [y, m] = s.month.split('-').map(Number);
  const dim = new Date(y, m, 0).getDate();
  const table = new Map();
  for (const tok of s.days.trim().split(/\s+/)) {
    const t = /^(\d{1,2}):([a-z-]+)$/.exec(tok);
    if (!t) throw new Error(`転記の書式エラー "${tok}" (${s.month} ${s.d}日程)`);
    const cats = t[2] === '-' ? [] : [...t[2]].map((ch) => {
      if (!LET[ch]) throw new Error(`未知の記号 "${ch}" (${tok})`);
      return LET[ch];
    });
    table.set(Number(t[1]), cats);
  }
  const actual = expanded.get(s.d);
  let mism = 0;
  for (let dd = 1; dd <= dim; dd++) {
    const iso = `${y}-${String(m).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
    const dow = new Date(y, m - 1, dd).getDay();
    if (dow === 0 || dow === 6) {
      if (table.has(dd)) throw new Error(`${iso}: 土日に転記がある`);
      if ((actual.get(iso) || []).length) { console.error(`  PDF目視 ${s.d} ${iso}: 土日に収集`); mism++; }
      continue;
    }
    if (!table.has(dd)) throw new Error(`${iso}: 平日の転記が欠けている (- も明記すること)`);
    pdfCells++;
    const exp = [...table.get(dd)].sort().join(',');
    const got = [...(actual.get(iso) || [])].sort().join(',');
    if (got !== exp) { console.error(`  PDF目視 ${s.d}日程 ${iso}: got[${got}] exp[${exp}]`); mism++; }
  }
  if (mism) { pdfNg += mism; console.error(`PDF目視 ${s.d}日程 ${s.month}: ${mism}件 不一致`); }
  else console.log(`PDF目視 ${s.d}日程 ${s.month} (p.${s.page}): 一致`);
}

if (ng || ruleNg || pdfNg) {
  console.error(`\nNG: PDF再展開 ${ng}日程 / 頻度規則 ${ruleNg}件 / PDF目視 ${pdfNg}件`);
  process.exit(1);
}
console.log(`\nOK: 全${DISTS.length}日程が収録期間 ${PERIOD} で完全一致 (${dayCells} 日枠)。`);
console.log(`  規則パターン ${patterns} 件ゼロ不一致 → 95%信頼で <${ruleOfThreePct(patterns)}/パターン (rule of three)`);
console.log(`  冊子本文の頻度規則との独立照合 ${ruleSlots} 枠ゼロ不一致 → <${ruleOfThreePct(ruleSlots)}/枠`);
console.log(`    (年末年始の休止で周期がずれる 日程×月 ${skippedMonths.size} 件は第n回目の判定から除外: ${[...skippedMonths].sort().join(' ')})`);
console.log(`  PDFページ画像の目視転記との照合 ${pdfCells} 日枠ゼロ不一致 → <${ruleOfThreePct(pdfCells)}/日枠`);
