import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as yamlParse, stringify as yamlStringify } from 'yaml';
import { parseTable, parseWeekly, parseMonthlyNth } from './parse.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '../../../municipalities/tokyo/nerima');
const PAGES = ['a', 'ka', 'sa', 'ta', 'na', 'ha', 'maya'];
const INDEX_URL = 'https://www.city.nerima.tokyo.jp/kurashi/gomi/wakekata/ichiran/index.html';
const EXTRACTED_AT = process.env.EXTRACTED_AT || '2026-07-13'; // Date.now() 不使用

const yomi = yamlParse(readFileSync(join(HERE, 'yomi.yaml'), 'utf8'));

// 号棟等の数値/記号を含む丁目表記を読みの後ろに正規化して付す(五十音ソート用)。
const chomeYomiTail = (chome) =>
  chome === '全域' ? '' : chome.replace(/[０-９]/g, (d) => '０１２３４５６７８９'.indexOf(d))
    .replace(/丁目|番|号棟?|号/g, '-').replace(/[・～]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');

function rowToRules(row) {
  const rules = [];
  rules.push({ category: 'burnable', pattern: 'weekly', days: parseWeekly(row.burnable) });
  const nb = parseMonthlyNth(row.nonBurnable);
  rules.push({ category: 'non_burnable', pattern: 'monthly_nth', occurrences: nb.occurrences, days: nb.days });
  const pp = parseWeekly(row.plaPaper);
  rules.push({ category: 'plastic', pattern: 'weekly', days: pp });
  rules.push({ category: 'paper_cloth', pattern: 'weekly', days: pp });
  const bc = parseWeekly(row.binCan);
  rules.push({ category: 'glass_bottle', pattern: 'weekly', days: bc });
  rules.push({ category: 'beverage_can', pattern: 'weekly', days: bc });
  rules.push({ category: 'pet_bottle', pattern: 'weekly', days: parseWeekly(row.pet) });
  return rules;
}

const signatureKey = (rules) =>
  rules.map((r) => `${r.category}:${(r.days || []).join('')}:${(r.occurrences || []).join('')}`).join('|');

// 年末年始 4 日のうち、当該 rules で収集が発生する日のみ cancelled
const DAY_TO_INDEX = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };
const YEAR_END = ['2026-12-31', '2027-01-01', '2027-01-02', '2027-01-03'];
function yearEndOverrides(rules) {
  const out = [];
  for (const iso of YEAR_END) {
    const d = new Date(iso + 'T00:00:00');
    const dow = d.getDay(), occ = Math.floor((d.getDate() - 1) / 7) + 1;
    const collects = rules.some((r) =>
      (r.days || []).some((x) => DAY_TO_INDEX[x] === dow) &&
      (r.pattern === 'weekly' || (r.pattern === 'monthly_nth' && r.occurrences.includes(occ))));
    if (collects) out.push({ date: iso, cancelled: true, note: '年末年始休止(12/31〜1/3)' });
  }
  return out;
}

// 1) 全行収集 → シグネチャでコース畳み込み
const bySig = new Map(); // sig -> { rules, areas: [] }
for (const p of PAGES) {
  const rows = parseTable(readFileSync(join(HERE, 'cache', `${p}_gyochiiki.html`), 'utf8'), p);
  for (const row of rows) {
    const rules = rowToRules(row);
    const sig = signatureKey(rules);
    if (!bySig.has(sig)) bySig.set(sig, { rules, areas: [] });
    const name = row.chome === '全域' ? row.town : `${row.town}${row.chome}`;
    const tail = chomeYomiTail(row.chome);
    bySig.get(sig).areas.push({ name, yomi: (yomi[row.town] || row.town) + (tail ? tail : '') });
  }
}

// 2) 安定順にコース採番(シグネチャ文字列でソート)
const sigs = [...bySig.keys()].sort();
mkdirSync(join(OUT, '2026'), { recursive: true });
let n = 0;
for (const sig of sigs) {
  n++;
  const { rules, areas } = bySig.get(sig);
  const nb = rules.find((r) => r.category === 'non_burnable');
  const name_ja =
    `可燃${rules.find((r)=>r.category==='burnable').days.map(dJa).join('')}` +
    `・不燃第${nb.occurrences.join('・')}${dJa(nb.days[0])}` +
    `・プラ古紙${rules.find((r)=>r.category==='plastic').days.map(dJa).join('')}` +
    `・缶${rules.find((r)=>r.category==='beverage_can').days.map(dJa).join('')}` +
    `・ペット${rules.find((r)=>r.category==='pet_bottle').days.map(dJa).join('')}`;
  const doc = {
    metadata: {
      city: 'nerima', course: String(n), course_name_ja: name_ja,
      areas: areas.sort((a, b) => a.yomi.localeCompare(b.yomi, 'ja')),
      year: 2026, fiscal_year_ja: '令和8年度',
      source: {
        source_url: INDEX_URL, extracted_at: EXTRACTED_AT,
        extracted_by: 'claude-opus-4-8',
        verified_by: 'Claude(練馬区公式「地域別収集曜日一覧」HTML表の機械変換。エッジは地域別PDFでスポット照合)',
      },
    },
    rules,
    overrides: yearEndOverrides(rules),
  };
  writeFileSync(join(OUT, '2026', `course-${n}.yaml`), yamlStringify(doc, { lineWidth: 0 }));
}
console.log(`generated ${n} courses`);

function dJa(x){return {SU:'日',MO:'月',TU:'火',WE:'水',TH:'木',FR:'金',SA:'土'}[x];}
