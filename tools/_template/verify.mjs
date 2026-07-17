// 独立ソースとの照合。expected (Map<iso, string[]>) を独立ソースから作り、生成 YAML と比較する。
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as yamlParse } from 'yaml';
import { diffYear, ruleOfThreePct } from '../../_lib/verify.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const HANDLE = 'CHANGEME';
const PREF = 'CHANGEME';
const YEAR = 2026;
const DIR = join(HERE, `../../../municipalities/${PREF}/${HANDLE}/${YEAR}`);

let patterns = 0, failed = 0;
for (const f of readdirSync(DIR).filter((f) => f.startsWith('course-'))) {
  const { metadata, rules, overrides = [] } = yamlParse(readFileSync(join(DIR, f), 'utf8'));
  const expected = new Map(); // TODO: 独立ソース (カレンダーPDF/一覧表) からこのコースの期待日程を作る
  const diffs = diffYear(YEAR, rules, overrides, expected);
  patterns += rules.length;
  if (diffs.length) { failed++; console.log(`${f}: ${diffs.length} 件不一致`, diffs.slice(0, 5)); }
  else console.log(`${f}: OK`);
}
if (failed) throw new Error(`${failed} コースで不一致`);
console.log(`OK: 全コース一致。独立項目 ${patterns} パターン ゼロ不一致 → 片側性誤り 95% 信頼で <${ruleOfThreePct(patterns)}/パターン`);
