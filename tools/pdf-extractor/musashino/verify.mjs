// 武蔵野市の照合。2 経路で検証する。
//
// (1) 生成済み course YAML を読み直し、expandRange で収録期間を再展開して
//     extract.py が PDF から読んだ実日付と全日比較する (build とは別経路)。
// (2) 独立ソース照合: 市サイト本文の地区別曜日サマリ
//     (例「火曜日：【毎週】(1)古紙、古着 (2)ペットボトル【隔週】びん、缶、危険・有害ごみ」)
//     はカレンダー PDF とは別に人が書いた表現。これを機械パースして
//     「曜日 → 品目集合 + 毎週/隔週の別」を作り、抽出データと突き合わせる。
//     サマリはペットボトル毎週化 (7月〜) 後の姿を書いているので、
//     判定窓は 2026-07-06〜2026-12-25 (年末年始を含まない完全な週) に取る。
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as yamlParse } from 'yaml';
import { expandRange } from '../../_lib/schedule.mjs';
import { ruleOfThreePct } from '../../_lib/verify.mjs';
import { DISTRICTS } from './sources.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..', '..');
const PERIOD = '2026-04--2027-03';
const DIR = join(ROOT, 'municipalities', 'tokyo', 'musashino', PERIOD);
const data = JSON.parse(readFileSync(join(HERE, 'cache', 'extracted.json'), 'utf8'));

// --- (1) YAML 再展開 vs PDF 抽出結果 ---
let ng = 0, patterns = 0, dayCells = 0;
const expanded = new Map();
for (const d of DISTRICTS) {
  const doc = yamlParse(readFileSync(join(DIR, `course-${d.toUpperCase()}.yaml`), 'utf8'));
  const actual = expandRange(doc.metadata.period, doc.rules, doc.overrides || [], doc.unknown_periods || []);
  expanded.set(d, actual);
  patterns += doc.rules.length;
  const events = data[d].events;
  let mism = 0;
  for (const iso of Object.keys(events).sort()) {
    dayCells++;
    const got = [...(actual.get(iso) || [])].sort().join(',');
    const exp = [...events[iso]].sort().join(',');
    if (got !== exp) { if (++mism <= 5) console.error(`  地区${d.toUpperCase()} ${iso}: got[${got}] exp[${exp}]`); }
  }
  if (mism) { console.error(`地区${d.toUpperCase()}: ${mism}日 不一致`); ng++; }
  else console.log(`地区${d.toUpperCase()}: 全${Object.keys(events).length}日 一致 (rules ${doc.rules.length})`);
}

// --- (2) 市サイトの地区別曜日サマリとの独立照合 ---
const ITEM2CAT = [
  ['プラスチック製容器包装', 'plastic'],
  ['燃やさないごみ', 'non_burnable'],
  ['燃やすごみ', 'burnable'],
  ['危険・有害ごみ', 'hazardous'],
  ['ペットボトル', 'pet_bottle'],
  ['古紙、古着', 'paper_cloth'],
  ['びん', 'glass_bottle'],
  ['缶', 'beverage_can'],
];
const DOW_JA = { 日: 0, 月: 1, 火: 2, 水: 3, 木: 4, 金: 5, 土: 6 };

// 「【毎週】(1)古紙、古着 (2)ペットボトル【隔週】びん、缶、危険・有害ごみ」
// → { paper_cloth: 'weekly', pet_bottle: 'weekly', glass_bottle: 'biweekly', … }
function parseSummaryLine(body) {
  const out = {};
  // 【毎週】/【隔週】で区切る。先頭に印が無ければ毎週扱い
  const parts = [];
  let freq = 'weekly', buf = '';
  for (const tok of body.split(/(【毎週】|【隔週】)/)) {
    if (tok === '【毎週】') { parts.push([freq, buf]); freq = 'weekly'; buf = ''; }
    else if (tok === '【隔週】') { parts.push([freq, buf]); freq = 'biweekly'; buf = ''; }
    else buf += tok;
  }
  parts.push([freq, buf]);
  for (const [f, seg] of parts) {
    let rest = seg;
    for (const [word, cat] of ITEM2CAT) {
      if (!rest.includes(word)) continue;
      rest = rest.split(word).join('');
      if (out[cat]) throw new Error(`品目 ${cat} が同一行に重複: "${body}"`);
      out[cat] = f;
    }
    // 残りは番号付けや区切りだけのはず
    const leftover = rest.replace(/[(（]\d+[)）]|[、\s・]/g, '');
    if (leftover) throw new Error(`曜日サマリに未知の語 "${leftover}" ("${body}")`);
  }
  return out;
}

const html = readFileSync(join(HERE, 'cache', 'index.html'), 'utf8');
const summaries = new Map();
for (const m of html.matchAll(/<h2 id="group\d+">([A-J])地区[^<]*<\/h2>([\s\S]*?)<ul class="objectlink">/g)) {
  const key = m[1].toLowerCase();
  const byDow = new Map();
  for (const line of m[2].matchAll(/([日月火水木金土])曜日：([^<\n]+)/g)) {
    byDow.set(DOW_JA[line[1]], parseSummaryLine(line[2].trim()));
  }
  if (!byDow.size) throw new Error(`地区${m[1]}: 曜日サマリが取れない`);
  summaries.set(key, byDow);
}
if (summaries.size !== DISTRICTS.length) throw new Error(`曜日サマリが ${summaries.size} 地区分しか取れない`);

const WIN_FROM = '2026-07-06', WIN_TO = '2026-12-25'; // ペット毎週化後・年末年始の手前
let sumSlots = 0, sumNg = 0;
for (const d of DISTRICTS) {
  const events = data[d].events;
  const win = Object.keys(events).filter((k) => k >= WIN_FROM && k <= WIN_TO).sort();
  const dowCount = {}, hit = {};
  for (const iso of win) {
    const w = new Date(iso + 'T00:00:00').getDay();
    dowCount[w] = (dowCount[w] || 0) + 1;
    for (const c of events[iso]) (hit[w] ??= {})[c] = ((hit[w] ??= {})[c] || 0) + 1;
  }
  let mism = 0;
  for (const [w, expect] of summaries.get(d)) {
    sumSlots++;
    const got = {};
    for (const [c, n] of Object.entries(hit[w] || {})) {
      const r = n / dowCount[w];
      got[c] = r > 0.9 ? 'weekly' : (r > 0.4 && r < 0.6 ? 'biweekly' : `ratio=${r.toFixed(2)}`);
    }
    const a = JSON.stringify(Object.entries(got).sort());
    const b = JSON.stringify(Object.entries(expect).sort());
    if (a !== b) { console.error(`  曜日サマリ 地区${d.toUpperCase()} dow=${w}: got ${a} exp ${b}`); mism++; }
  }
  if (mism) { sumNg += mism; console.error(`曜日サマリ 地区${d.toUpperCase()}: ${mism}枠 不一致`); }
  else console.log(`曜日サマリ 地区${d.toUpperCase()}: ${summaries.get(d).size}枠 一致`);
}

// --- (3) PDF ページ画像の目視転記との照合 ---
// 座標抽出そのものの取りこぼし・列ずれを、同じ PDF を人が見た結果で押さえる
// (曜日サマリでは検出できない「隔週の位相」「年末年始の実日付」「6週ある月の
//  週末セル縦積み」を狙って月を選んである)。
//   B=燃やすごみ N=燃やさないごみ P=プラスチック製容器包装
//   R=古紙、古着+ペットボトル
//   S=古紙、古着+びん+缶+危険・有害ごみ (ペット隔週期の資源日)
//   T=S+ペットボトル (ペット毎週化後の資源日)  X=収集なし
// 平日はすべて記載する (書き漏れを X と区別するため)。土日は収集なしを別途 assert。
const CODE = {
  B: ['burnable'], N: ['non_burnable'], P: ['plastic'],
  R: ['paper_cloth', 'pet_bottle'],
  S: ['paper_cloth', 'glass_bottle', 'beverage_can', 'hazardous'],
  T: ['paper_cloth', 'glass_bottle', 'beverage_can', 'hazardous', 'pet_bottle'],
  X: [],
};
const PDF_SAMPLES = [
  { district: 'a', month: '2026-04', page: 2, days: '1N 2B 3P 6B 7S 8X 9B 10P 13B 14R 15N 16B 17P 20B 21S 22X 23B 24P 27B 28R 29N 30B' },
  // 5月は金曜始まりで 5/31(日) が第5行の日セル下部に入る (6週ある月)
  { district: 'a', month: '2026-05', page: 2, days: '1P 4B 5S 6X 7B 8P 11B 12R 13N 14B 15P 18B 19S 20X 21B 22P 25B 26R 27N 28B 29P' },
  // 8月は土曜始まりで 8/1(土) と 8/8 が第1行の土セルに縦積みされる (6週ある月)
  { district: 'a', month: '2026-08', page: 4, days: '3B 4R 5N 6B 7P 10B 11T 12X 13B 14P 17B 18R 19N 20B 21P 24B 25T 26X 27B 28P 31B' },
  { district: 'a', month: '2026-09', page: 4, days: '1R 2N 3B 4P 7B 8T 9X 10B 11P 14B 15R 16N 17B 18P 21B 22T 23X 24B 25P 28B 29R 30N' },
  // 年末年始 (F〜J地区は12/29に「(年末特別収集)」の添え書きがある)
  { district: 'f', month: '2026-12', page: 6, days: '1B 2P 3N 4B 7T 8B 9P 10X 11B 14R 15B 16P 17N 18B 21T 22B 23P 24X 25B 28R 29B 30X 31X' },
  { district: 'f', month: '2027-01', page: 6, days: '1X 4R 5B 6P 7N 8B 11T 12B 13P 14X 15B 18R 19B 20P 21N 22B 25T 26B 27P 28X 29B' },
];

let pdfCells = 0, pdfNg = 0;
for (const s of PDF_SAMPLES) {
  const [y, m] = s.month.split('-').map(Number);
  const dim = new Date(y, m, 0).getDate();
  const table = new Map();
  for (const tok of s.days.trim().split(/\s+/)) {
    const t = /^(\d{1,2})([BNPRSTX])$/.exec(tok);
    if (!t) throw new Error(`転記の書式エラー "${tok}" (${s.month} 地区${s.district})`);
    table.set(Number(t[1]), CODE[t[2]]);
  }
  const actual = expanded.get(s.district);
  let mism = 0;
  for (let dd = 1; dd <= dim; dd++) {
    const iso = `${y}-${String(m).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
    const dow = new Date(y, m - 1, dd).getDay();
    if (dow === 0 || dow === 6) {
      if (table.has(dd)) throw new Error(`${iso}: 土日に転記がある`);
      if ((actual.get(iso) || []).length) { console.error(`  PDF目視 地区${s.district.toUpperCase()} ${iso}: 土日に収集 [${actual.get(iso)}]`); mism++; }
      continue;
    }
    if (!table.has(dd)) throw new Error(`${iso}: 平日の転記が欠けている (X も明記すること)`);
    pdfCells++;
    const exp = [...table.get(dd)].sort().join(',');
    const got = [...(actual.get(iso) || [])].sort().join(',');
    if (got !== exp) { console.error(`  PDF目視 地区${s.district.toUpperCase()} ${iso}: got[${got}] exp[${exp}]`); mism++; }
  }
  if (mism) { pdfNg += mism; console.error(`PDF目視 地区${s.district.toUpperCase()} ${s.month}: ${mism}件 不一致`); }
  else console.log(`PDF目視 地区${s.district.toUpperCase()} ${s.month} (p.${s.page}): 一致`);
}

// ペットボトルが 6月まで隔週・7月から毎週であること (市サイト脚注の独立確認)
let petNg = 0;
for (const d of DISTRICTS) {
  const events = data[d].events;
  const span = (from, to) => {
    const ks = Object.keys(events).filter((k) => k >= from && k <= to);
    const days = ks.filter((k) => events[k].includes('pet_bottle'));
    const dow = new Date(days[0] + 'T00:00:00').getDay();
    const slots = ks.filter((k) => new Date(k + 'T00:00:00').getDay() === dow).length;
    return days.length / slots;
  };
  const before = span('2026-04-01', '2026-06-30'), after = span('2026-07-06', '2026-12-25');
  const ok = before > 0.4 && before < 0.6 && after > 0.9;
  if (!ok) { console.error(`  ペット頻度 地区${d.toUpperCase()}: 4-6月 ${before.toFixed(2)} / 7月〜 ${after.toFixed(2)}`); petNg++; }
}
console.log(petNg ? `ペットボトル頻度: ${petNg}地区 不一致` : 'ペットボトル頻度: 全10地区で「6月まで隔週・7月から毎週」を確認');

if (ng || sumNg || petNg || pdfNg) {
  console.error(`\nNG: PDF再展開 ${ng}地区 / 曜日サマリ ${sumNg}枠 / PDF目視 ${pdfNg}件 / ペット頻度 ${petNg}地区`);
  process.exit(1);
}
console.log(`\nOK: 全${DISTRICTS.length}地区が収録期間 ${PERIOD} で完全一致 (${dayCells} 日枠)。`);
console.log(`  規則パターン ${patterns} 件ゼロ不一致 → 95%信頼で <${ruleOfThreePct(patterns)}/パターン (rule of three)`);
console.log(`  市サイト曜日サマリとの独立照合 ${sumSlots} 枠ゼロ不一致 → <${ruleOfThreePct(sumSlots)}/枠`);
console.log(`  PDFページ画像の目視転記との照合 ${pdfCells} 日枠ゼロ不一致 → <${ruleOfThreePct(pdfCells)}/日枠`);
