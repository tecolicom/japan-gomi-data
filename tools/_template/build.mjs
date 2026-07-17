// 行 → course YAML。<handle>/<年度> を書き換えて使う。
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { foldCourses, courseDoc, writeCourses } from '../../_lib/emit.mjs';
import { cancelledOverrides } from '../../_lib/schedule.mjs';
// import { parseRows } from './parse.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const HANDLE = 'CHANGEME';
const PREF = 'CHANGEME';
const YEAR = 2026;
const OUT = join(HERE, `../../../municipalities/${PREF}/${HANDLE}`);
const EXTRACTED_AT = process.env.EXTRACTED_AT; // 例: EXTRACTED_AT=2026-07-17 node build.mjs
if (!EXTRACTED_AT) throw new Error('EXTRACTED_AT を環境変数で渡す (Date.now は使わない)');

// 休止日 (運用ルール調査で確定した年末年始など)
const CANCELLED = []; // 例: ['2026-12-31', '2027-01-01', '2027-01-02', '2027-01-03']

const rows = []; // parseRows(…) — 1 行 = 町 (丁目グループ) × 種別×曜日
const folded = foldCourses(rows,
  (row) => { throw new Error('rowToRules を実装'); },
  (row) => ({ name: row.town, yomi: row.yomi }));

const docs = folded.map(({ rules, areas }, i) => courseDoc({
  city: HANDLE, course: String(i + 1), areas, year: YEAR, fiscalYearJa: '令和8年度',
  source: {
    source_url: 'CHANGEME',
    extracted_at: EXTRACTED_AT,
    extracted_by: 'CHANGEME',
    verified_by: 'CHANGEME(照合方法と結果をここに)',
  },
  rules,
  overrides: cancelledOverrides(rules, CANCELLED, '年末年始休止'),
}));
console.log(`generated ${writeCourses(OUT, YEAR, docs)} courses`);
