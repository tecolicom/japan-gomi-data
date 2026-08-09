// 行 → course YAML。<handle>/<収録期間> を書き換えて使う。
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { foldCourses, courseDoc, writeCourses } from '../../_lib/emit.mjs';
import { cancelledOverrides } from '../../_lib/schedule.mjs';
// import { parseRows } from './parse.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const HANDLE = 'CHANGEME';
const PREF = 'CHANGEME';
// 収録期間 = 一次ソースが実際に裏付ける範囲。会計年度と決めつけないこと。
// 例: 4月起点 '2026-04--2027-03' / 10月起点 '2025-10--2026-09' / 暦年 '2026-01--2026-12'
// この範囲の外は展開されない (裏付けの無い日付を作らないための境界)。
const PERIOD = '2026-04--2027-03';
const OUT = join(HERE, `../../../municipalities/${PREF}/${HANDLE}`);
const EXTRACTED_AT = process.env.EXTRACTED_AT; // 例: EXTRACTED_AT=2026-07-17 node build.mjs
if (!EXTRACTED_AT) throw new Error('EXTRACTED_AT を環境変数で渡す (Date.now は使わない)');

// 休止日 (一次ソースが実日付で示している年末年始など)
const CANCELLED = []; // 例: ['2026-12-31', '2027-01-01', '2027-01-02', '2027-01-03']

// 収集の有無が一次ソースから確定できない区間。
// 「年末年始は別途告知」型のソースはここに書く。書かないと収集ありの断定になる。
const UNKNOWN = []; // 例: [{ from: '2026-12-30', to: '2027-01-03', reason: '…', source_url: '…' }]

const rows = []; // parseRows(…) — 1 行 = 町 (丁目グループ) × 種別×曜日
const folded = foldCourses(rows,
  (row) => { throw new Error('rowToRules を実装'); },
  (row) => ({ name: row.town, yomi: row.yomi }));

const docs = folded.map(({ rules, areas }, i) => courseDoc({
  city: HANDLE, course: String(i + 1), areas, period: PERIOD,
  source: {
    // 自治体自身の刊行物名。期間の説明には使わない (元号年と実期間はずれることがある)
    edition_ja: 'CHANGEME(例: 令和8年度版)',
    source_url: 'CHANGEME',
    extracted_at: EXTRACTED_AT,
    extracted_by: 'CHANGEME',
    verified_by: 'CHANGEME(照合方法と結果をここに)',
  },
  rules,
  overrides: cancelledOverrides(rules, CANCELLED, '年末年始休止'),
  unknownPeriods: UNKNOWN,
}));
console.log(`generated ${writeCourses(OUT, PERIOD, docs)} courses`);
