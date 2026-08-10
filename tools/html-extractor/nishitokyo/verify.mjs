// 西東京市の照合。2 経路で検証する。
//
// (1) 生成済み course YAML を読み直し、expandRange で収録期間を再展開して
//     cache の HTML カレンダー実日付と全日比較する (build とは別経路)。
// (2) 独立ソース照合: 冊子版カレンダー PDF (999.html の -N-070911.pdf) との突き合わせ。
//     この PDF は Illustrator でアウトライン化されておりテキスト層が無い (pdffonts が空)
//     ため機械抽出できない。playbook §3 に従い層化サンプリングで人が読み取った月を
//     下の PDF_SAMPLES に転記し、生成データと比較する。
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as yamlParse } from 'yaml';
import { expandRange } from '../../_lib/schedule.mjs';
import { ruleOfThreePct } from '../../_lib/verify.mjs';
import { parseCalendar, periodDates, AREAS } from './parse.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..', '..');
const PERIOD = '2025-10--2026-09';
const DIR = join(ROOT, 'municipalities', 'tokyo', 'nishitokyo', PERIOD);
const dates = periodDates(PERIOD);

// --- (1) YAML 再展開 vs HTML カレンダー ---
let ng = 0, patterns = 0, dayCells = 0;
const expanded = new Map(); // 地域番号 → Map<iso, category[]>
for (const n of AREAS) {
  const doc = yamlParse(readFileSync(join(DIR, `course-${n}.yaml`), 'utf8'));
  const actual = expandRange(doc.metadata.period, doc.rules, doc.overrides || [], doc.unknown_periods || []);
  expanded.set(n, actual);
  patterns += doc.rules.length;
  const events = parseCalendar(readFileSync(join(HERE, 'cache', `${n}.html`), 'utf8'));
  let mism = 0;
  for (const d of dates) {
    dayCells++;
    const got = [...(actual.get(d) || [])].sort().join(',');
    const exp = [...(events.get(d) || [])].sort().join(',');
    if (got !== exp) { if (++mism <= 5) console.error(`  地域${n} ${d}: got[${got}] exp[${exp}]`); }
  }
  if (mism) { console.error(`地域${n}: ${mism}日 不一致`); ng++; }
  else console.log(`地域${n}: 全${dates.length}日 一致 (rules ${doc.rules.length})`);
}

// --- (2) 冊子版 PDF (画像) の目視転記との照合 ---
// セル 1 つ = 1 グループ。カレンダー上の見た目そのままの記号で転記する:
//   B=可燃(+せん定枝) N=不燃+有害 P=ペットボトル+プラ容器包装
//   G=びん・スプレー缶・ライター+古紙・古布類  C=缶  M=金属類(+小型家電・廃食用油)
//   X=「この地域での収集はありません」/「収集はありません」
// 平日はすべて記載する (書き漏れを X と区別するため)。土日は収集なしを別途 assert。
const CODE = {
  B: ['burnable'], N: ['non_burnable', 'hazardous'], P: ['pet_bottle', 'plastic'],
  G: ['glass_bottle', 'spray_can', 'paper_cloth'], C: ['beverage_can'], M: ['metal'], X: [],
};
const PDF_SAMPLES = [
  { area: 1, month: '2025-10', url: 'https://www.city.nishitokyo.lg.jp/kurasi/gomi_recycle/gomi-calebder/999.files/-1-070911.pdf', page: 2,
    days: '1M 2P 3B 6G 7B 8N 9P 10B 13C 14B 15X 16P 17B 20G 21B 22N 23P 24B 27C 28B 29M 30P 31B' },
  { area: 1, month: '2025-12', url: 'https://www.city.nishitokyo.lg.jp/kurasi/gomi_recycle/gomi-calebder/999.files/-1-070911.pdf', page: 4,
    days: '1G 2B 3N 4P 5B 8C 9B 10X 11P 12B 15G 16B 17N 18P 19B 22C 23B 24M 25P 26B 29X 30B 31X' },
  { area: 3, month: '2026-01', url: 'https://www.city.nishitokyo.lg.jp/kurasi/gomi_recycle/gomi-calebder/999.files/-3-070911.pdf', page: 5,
    days: '1X 2X 5B 6C 7N 8B 9P 12B 13G 14M 15B 16P 19B 20C 21N 22B 23P 26B 27G 28X 29B 30P' },
  { area: 8, month: '2025-10', url: 'https://www.city.nishitokyo.lg.jp/kurasi/gomi_recycle/gomi-calebder/999.files/-8-070911.pdf', page: 2,
    days: '1N 2B 3G 6B 7P 8M 9B 10C 13B 14P 15N 16B 17G 20B 21P 22X 23B 24C 27B 28P 29N 30B 31G' },
];

let pdfCells = 0, pdfNg = 0;
for (const s of PDF_SAMPLES) {
  const [y, m] = s.month.split('-').map(Number);
  const dim = new Date(y, m, 0).getDate();
  const table = new Map();
  for (const tok of s.days.trim().split(/\s+/)) {
    const t = /^(\d{1,2})([BNPGCMX])$/.exec(tok);
    if (!t) throw new Error(`転記の書式エラー "${tok}" (${s.month} 地域${s.area})`);
    table.set(Number(t[1]), CODE[t[2]]);
  }
  const actual = expanded.get(s.area);
  let mism = 0;
  for (let d = 1; d <= dim; d++) {
    const iso = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const dow = new Date(y, m - 1, d).getDay();
    if (dow === 0 || dow === 6) { // 土日は収集なし
      if (table.has(d)) throw new Error(`${iso}: 土日に転記がある`);
      if ((actual.get(iso) || []).length) { console.error(`  PDF照合 地域${s.area} ${iso}: 土日に収集 [${actual.get(iso)}]`); mism++; }
      continue;
    }
    if (!table.has(d)) throw new Error(`${iso}: 平日の転記が欠けている (X も明記すること)`);
    pdfCells++;
    const exp = [...table.get(d)].sort().join(',');
    const got = [...(actual.get(iso) || [])].sort().join(',');
    if (got !== exp) { console.error(`  PDF照合 地域${s.area} ${iso}: got[${got}] exp[${exp}]`); mism++; }
  }
  if (mism) { pdfNg += mism; console.error(`PDF照合 地域${s.area} ${s.month}: ${mism}件 不一致`); }
  else console.log(`PDF照合 地域${s.area} ${s.month} (p.${s.page}): 一致`);
}

if (ng || pdfNg) {
  console.error(`\nNG: HTML再展開 ${ng}地域 / PDF照合 ${pdfNg}件 不一致`);
  process.exit(1);
}
console.log(`\nOK: 全${AREAS.length}地域が収録期間 ${PERIOD} で完全一致 (${dayCells} 日枠)。`);
console.log(`  規則パターン ${patterns} 件ゼロ不一致 → 95%信頼で <${ruleOfThreePct(patterns)}/パターン (rule of three)`);
console.log(`  冊子版PDF(画像)との独立照合 ${pdfCells} 日枠ゼロ不一致 → <${ruleOfThreePct(pdfCells)}/日枠`);
