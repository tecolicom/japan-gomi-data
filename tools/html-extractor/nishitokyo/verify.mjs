// 西東京市の照合。**収録している版をすべて**、2 経路で検証する。
//
// (1) 生成済み course YAML を読み直し、expandRange で収録期間を再展開して
//     cache の HTML カレンダー実日付と全日比較する (build とは別経路)。
//
// (2) 独立ソース照合: 冊子版カレンダー PDF との突き合わせ。**版で手段が違う。**
//
//     令和7年10月版 (2025-10--2026-09) — 冊子は Illustrator でアウトライン化されており
//       テキスト層が無い (pdffonts が空)。機械抽出できないので playbook §3 に従い
//       層化サンプリングで人が読み取った月を下の PDF_SAMPLES に転記してある。
//
//     令和8年10月版 (2026-10--2027-09) — **この版から冊子にテキスト層がある。**
//       extract-booklet.py で全 12 ヶ月を機械抽出し、全日枠を突き合わせる。
//       冊子はテキスト版 HTML とは別に組版されているので独立ソースとして働く。
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { parse as yamlParse } from 'yaml';
import { expandRange } from '../../_lib/schedule.mjs';
import { ruleOfThreePct } from '../../_lib/verify.mjs';
import { findPython } from '../../_lib/python.mjs';
import { parseCalendar, periodDates, AREAS, EDITIONS } from './parse.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..', '..');
const OUT = join(ROOT, 'municipalities', 'tokyo', 'nishitokyo');

// --- (2a) 冊子版 PDF (画像) の目視転記 ---
// **令和7年10月版だけのもの。** セル 1 つ = 1 グループを、カレンダー上の見た目
// そのままの記号で転記する:
//   B=可燃(+せん定枝) N=不燃+有害 P=ペットボトル+プラ容器包装
//   G=びん・スプレー缶・ライター+古紙・古布類  C=缶  M=金属類(+小型家電・廃食用油)
//   X=「この地域での収集はありません」/「収集はありません」
// 平日はすべて記載する (書き漏れを X と区別するため)。土日は収集なしを別途 assert。
const CODE = {
  B: ['burnable'], N: ['non_burnable', 'hazardous'], P: ['pet_bottle', 'plastic'],
  G: ['glass_bottle', 'spray_can', 'paper_cloth'], C: ['beverage_can'], M: ['metal'], X: [],
};
const PDF_SAMPLES = [
  { period: '2025-10--2026-09', area: 1, month: '2025-10', url: 'https://www.city.nishitokyo.lg.jp/kurasi/gomi_recycle/gomi-calebder/999.files/-1-070911.pdf', page: 2,
    days: '1M 2P 3B 6G 7B 8N 9P 10B 13C 14B 15X 16P 17B 20G 21B 22N 23P 24B 27C 28B 29M 30P 31B' },
  { period: '2025-10--2026-09', area: 1, month: '2025-12', url: 'https://www.city.nishitokyo.lg.jp/kurasi/gomi_recycle/gomi-calebder/999.files/-1-070911.pdf', page: 4,
    days: '1G 2B 3N 4P 5B 8C 9B 10X 11P 12B 15G 16B 17N 18P 19B 22C 23B 24M 25P 26B 29X 30B 31X' },
  { period: '2025-10--2026-09', area: 3, month: '2026-01', url: 'https://www.city.nishitokyo.lg.jp/kurasi/gomi_recycle/gomi-calebder/999.files/-3-070911.pdf', page: 5,
    days: '1X 2X 5B 6C 7N 8B 9P 12B 13G 14M 15B 16P 19B 20C 21N 22B 23P 26B 27G 28X 29B 30P' },
  { period: '2025-10--2026-09', area: 8, month: '2025-10', url: 'https://www.city.nishitokyo.lg.jp/kurasi/gomi_recycle/gomi-calebder/999.files/-8-070911.pdf', page: 2,
    days: '1N 2B 3G 6B 7P 8M 9B 10C 13B 14P 15N 16B 17G 20B 21P 22X 23B 24C 27B 28P 29N 30B 31G' },
];

let ng = 0;
const summary = [];

for (const ed of EDITIONS) {
  const DIR = join(OUT, ed.period);
  const dates = periodDates(ed.period);
  const [fy, fm] = ed.period.split('--')[0].split('-').map(Number);
  console.log(`\n=== ${ed.period} (${ed.editionJa}) ===`);

  // --- (1) YAML 再展開 vs HTML カレンダー ---
  let patterns = 0, dayCells = 0;
  const expanded = new Map(); // 地域番号 → Map<iso, category[]>
  for (const n of AREAS) {
    const doc = yamlParse(readFileSync(join(DIR, `course-${n}.yaml`), 'utf8'));
    if (doc.metadata.period !== ed.period) {
      throw new Error(`course-${n}.yaml の period が ${doc.metadata.period} (${ed.period} のはず)`);
    }
    const actual = expandRange(doc.metadata.period, doc.rules, doc.overrides || [], doc.unknown_periods || []);
    expanded.set(n, actual);
    patterns += doc.rules.length;
    // build と同じく先頭の月を渡す。月見出しの年がずれている版があり、
    // ずれは曜日グリッドの一致を確かめたうえでのみ補正される (parse.mjs 参照)。
    const { events, yearShift } = parseCalendar(
      readFileSync(join(HERE, 'cache', ed.period, `${n}.html`), 'utf8'),
      { expectFirst: { year: fy, month: fm } });
    let mism = 0;
    for (const d of dates) {
      dayCells++;
      const got = [...(actual.get(d) || [])].sort().join(',');
      const exp = [...(events.get(d) || [])].sort().join(',');
      if (got !== exp) { if (++mism <= 5) console.error(`  地域${n} ${d}: got[${got}] exp[${exp}]`); }
    }
    if (mism) { console.error(`地域${n}: ${mism}日 不一致`); ng += mism; }
    else console.log(`地域${n}: 全${dates.length}日 一致 (rules ${doc.rules.length}${yearShift ? ', 月見出しの年を補正' : ''})`);
  }

  // --- (2) 冊子版 PDF との独立照合 ---
  let indepCells = 0, indepNg = 0, indepHow;

  if (ed.bookletText) {
    // 全数機械照合。冊子は HTML とは別に組版されている
    indepHow = '冊子版PDF(テキスト層)との全数照合';
    const py = findPython(['pdfplumber']);
    const script = join(HERE, 'extract-booklet.py');
    for (const n of AREAS) {
      const pdf = join(HERE, 'cache', ed.period, `booklet-${n}.pdf`);
      if (!existsSync(pdf)) throw new Error(`${pdf} が無い。先に node fetch.mjs を実行する`);
      const got = JSON.parse(execFileSync(py, [script, pdf], { encoding: 'utf8', maxBuffer: 64 << 20 })).events;
      const actual = expanded.get(n);
      let mism = 0;
      for (const d of dates) {
        if (!(d in got)) throw new Error(`冊子照合 地域${n}: ${d} が冊子側に無い`);
        indepCells++;
        const a = [...(actual.get(d) || [])].sort().join(',');
        const b = [...got[d]].sort().join(',');
        if (a !== b) { if (++mism <= 5) console.error(`  冊子照合 地域${n} ${d}: YAML[${a}] 冊子[${b}]`); }
      }
      // 冊子が収録期間の外まで持っていないか (12 ヶ月ちょうどのはず)
      const extra = Object.keys(got).filter((d) => !dates.includes(d));
      if (extra.length) throw new Error(`冊子照合 地域${n}: 収録期間外の日付 ${extra.slice(0, 3).join(',')} …`);
      if (mism) { indepNg += mism; console.error(`冊子照合 地域${n}: ${mism}件 不一致`); }
      else console.log(`冊子照合 地域${n}: 全${dates.length}日 一致`);
    }
  } else {
    // 層化サンプリング (冊子が画像で機械抽出できない版)
    indepHow = '冊子版PDF(画像)の目視転記との層化サンプリング照合';
    for (const s of PDF_SAMPLES.filter((x) => x.period === ed.period)) {
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
        indepCells++;
        const exp = [...table.get(d)].sort().join(',');
        const got = [...(actual.get(iso) || [])].sort().join(',');
        if (got !== exp) { console.error(`  PDF照合 地域${s.area} ${iso}: got[${got}] exp[${exp}]`); mism++; }
      }
      if (mism) { indepNg += mism; console.error(`PDF照合 地域${s.area} ${s.month}: ${mism}件 不一致`); }
      else console.log(`PDF照合 地域${s.area} ${s.month} (p.${s.page}): 一致`);
    }
    if (!indepCells) throw new Error(`${ed.period}: 目視転記 (PDF_SAMPLES) が 1 件も無い`);
  }

  ng += indepNg;
  summary.push({ ed, patterns, dayCells, indepCells, indepHow });
}

if (ng) {
  console.error(`\nNG: 計 ${ng} 件 不一致`);
  process.exit(1);
}
console.log('\nOK');
for (const s of summary) {
  console.log(`  ${s.ed.period}: 全${AREAS.length}地域 完全一致 (${s.dayCells} 日枠)`);
  console.log(`    規則パターン ${s.patterns} 件ゼロ不一致 → 95%信頼で <${ruleOfThreePct(s.patterns)}/パターン (rule of three)`);
  console.log(`    ${s.indepHow} ${s.indepCells} 日枠ゼロ不一致 → <${ruleOfThreePct(s.indepCells)}/日枠`);
}
