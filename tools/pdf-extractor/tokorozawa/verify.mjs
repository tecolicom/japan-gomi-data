// 独立照合: 生成済み course YAML を読み、categoriesOn で通年 (2026-04-01〜2027-03-31)
// 再展開して、各 PDF (町) の抽出カレンダー実日付と全日比較する。差分ゼロを機械証明。
// build とは別経路 (_lib/schedule.mjs の categoriesOn を共有) で検証する。
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as yamlParse } from 'yaml';
import { expandFiscalYear } from '../../_lib/schedule.mjs';
import { diffYear, ruleOfThreePct } from '../../_lib/verify.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..', '..');
const OUTDIR = join(ROOT, 'municipalities', 'saitama', 'tokorozawa', '2026');
const FY = 2026;

const extracted = JSON.parse(readFileSync(join(HERE, 'cache', 'extracted.json'), 'utf8'));
const manifest = JSON.parse(readFileSync(join(HERE, 'manifest.json'), 'utf8'));
const labelToFile = new Map(); // area name -> pdf file (丁目つきラベルは分割前で照合)
for (const m of manifest) labelToFile.set(m.label, m.file);

// course YAML を読み、area 名 → 所属 course doc を作る
const docs = readdirSync(OUTDIR).filter((f) => f.endsWith('.yaml'))
  .map((f) => yamlParse(readFileSync(join(OUTDIR, f), 'utf8')));

// area 名 → PDF ファイルの対応 (manifest の label を、で分割したもの)
const areaToFile = new Map();
for (const m of manifest) {
  for (const nm of m.label.split('、').map((s) => s.trim()).filter(Boolean)) areaToFile.set(nm, m.file);
}

let totalDays = 0, mism = 0, checkedTowns = 0;
const patternCount = { weekly: 0, monthly_nth: 0, monthly_specific: 0 };
for (const doc of docs) {
  for (const r of doc.rules) patternCount[r.pattern]++;
  // このコースの各 area について、対応 PDF の抽出結果と照合
  for (const area of doc.metadata.areas) {
    const file = areaToFile.get(area.name);
    if (!file) throw new Error(`area 対応PDF不明: ${area.name}`);
    const cal = extracted[file];
    const expected = new Map(Object.entries(cal).map(([d, cats]) => [d, cats]));
    const diffs = diffYear(FY, doc.rules, doc.overrides || [], expected);
    checkedTowns++;
    totalDays += 365;
    if (diffs.length) {
      mism += diffs.length;
      console.error(`NG course-${doc.metadata.course} ${area.name} (${file}): ${diffs.length}件`);
      for (const d of diffs.slice(0, 5)) console.error(`   ${d.date} missing[${d.missing}] extra[${d.extra}]`);
    }
  }
}

// パターン数 = 独立な誤り単位 (course×種別の rule 本数)
const nPatterns = docs.reduce((a, d) => a + d.rules.length, 0);
console.log(`照合: ${docs.length} courses / ${checkedTowns} town-instances / 各365日`);
console.log(`rule 本数: ${nPatterns} (weekly ${patternCount.weekly}, monthly_nth ${patternCount.monthly_nth}, monthly_specific ${patternCount.monthly_specific})`);
if (mism === 0) {
  console.log(`OK: 全 town-instance が通年照合で完全一致 (差分ゼロ)`);
  console.log(`rule of three: N=${nPatterns} パターン ゼロ不一致 → 片側性誤り率 95%信頼上限 <${ruleOfThreePct(nPatterns)}/パターン`);
  process.exit(0);
} else {
  console.error(`NG: ${mism} 件の不一致`);
  process.exit(1);
}
