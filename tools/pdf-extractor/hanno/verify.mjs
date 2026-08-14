// 飯能: 色ベース抽出の結果 (cache/extracted-*.json) と、収録済みの course YAML を
// 収録期間の全日付で突き合わせる。
//
// この照合には 2 つの役目がある。
//
// 1. 独立検証。course YAML は 2026-04 に別の経路で作られた手書きの正典で、その後
//    2026-08-14 に第 5 週の読み違い 2 件を人手で直した。ピクセルだけを見る抽出が
//    同じ日付集合を出すなら、その修正が正しかったことの独立な裏づけになる。
// 2. 回帰検査。以後は extract.py と course YAML のどちらがずれても差分として出る。
//
// 使い方: node verify.mjs [--quiet]
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import YAML from 'yaml';
import { expandRange, periodDates } from '../../_lib/schedule.mjs';
import { COURSES, PERIOD, CACHE, PDF_FILE } from './sources.mjs';

const CANON = join(CACHE, '..', '..', '..', '..', 'municipalities', 'saitama', 'hanno', PERIOD);

// extract.py が出す品目名 -> schema/categories.yaml の category
const CATEGORY = {
  可燃: 'burnable',
  プラ: 'plastic',
  ペット: 'pet_bottle',
  粗大: 'oversized',
  不燃: 'non_burnable',
  有害: 'hazardous',
  飲料缶: 'beverage_can',
  紙布: 'paper_cloth',
  びん: 'glass_bottle',
};

const quiet = process.argv.includes('--quiet');
const courseFile = (course) => join(CANON, `course-${course}.yaml`);

let totalSlots = 0;
let totalDiff = 0;
const summary = [];

for (const { course, slug } of COURSES) {
  const jsonPath = join(CACHE, `extracted-${PDF_FILE(slug).replace(/\.pdf$/, '')}.json`);
  if (!existsSync(jsonPath)) throw new Error(`抽出結果が無い: ${jsonPath} (先に extract.py を回す)`);
  const { items, closed: extractedClosed } = JSON.parse(readFileSync(jsonPath, 'utf8'));

  // 抽出結果: 日付 -> category の集合
  const extracted = new Map();
  for (const [nameJa, dates] of Object.entries(items)) {
    const cat = CATEGORY[nameJa];
    if (!cat) throw new Error(`未知の品目名: ${nameJa} (CATEGORY に無い)`);
    for (const d of dates) {
      if (!extracted.has(d)) extracted.set(d, new Set());
      extracted.get(d).add(cat);
    }
  }

  // 収録済み YAML: 日付 -> category の集合
  const doc = YAML.parse(readFileSync(courseFile(course), 'utf8'));
  const canon = expandRange(doc.metadata.period, doc.rules, doc.overrides);

  // 休業日 (PDF の赤字「休業」) が cancelled override として残っているか。
  // 日程には影響しない日もあるので expandRange の比較では捕まらない。
  const closedInDoc = (doc.overrides || []).filter((o) => o.cancelled).map((o) => String(o.date)).sort();
  const closedInPdf = [...(extractedClosed || [])].sort();
  if (closedInDoc.join(',') !== closedInPdf.join(',')) {
    console.log(`${course}: ★休業日が不一致  YAML=[${closedInDoc}]  PDF=[${closedInPdf}]`);
    totalDiff++;
  }

  const diffs = [];
  for (const day of periodDates(PERIOD)) {
    totalSlots++;
    const a = [...(extracted.get(day) || [])].sort();
    const b = [...(canon.get(day) || [])].sort();
    if (a.join(',') !== b.join(',')) diffs.push({ day, extracted: a, canon: b });
  }
  totalDiff += diffs.length;
  summary.push({ course, diffs });

  const mark = diffs.length ? '★不一致' : '一致';
  console.log(`${course} ${doc.metadata.course_name_ja}: ${mark} (差分 ${diffs.length} 日)`);
  if (!quiet) {
    for (const d of diffs.slice(0, 20)) {
      console.log(`    ${d.day}  抽出=[${d.extracted.join('+') || 'なし'}]  収録=[${d.canon.join('+') || 'なし'}]`);
    }
    if (diffs.length > 20) console.log(`    … 他 ${diffs.length - 20} 日`);
  }
}

console.log(`\n合計 ${totalSlots} 日枠、不一致 ${totalDiff} 日 (${COURSES.length} コース × ${periodDates(PERIOD).length} 日)`);
if (totalDiff) {
  console.log('不一致があるコース:', summary.filter((s) => s.diffs.length).map((s) => s.course).join(', '));
  process.exitCode = 1;
}
