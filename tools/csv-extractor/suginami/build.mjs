// 杉並区 収集曜日 CSV → municipalities/tokyo/suginami/2026/course-*.yaml
//
// 1. cache/suginami.csv (区公式の収集曜日検索を駆動する一次 CSV) を読む。
// 2. コース単位 = 地域別カレンダー PDF 番号 (pdf_url の <N>)。同一 PDF を共有する
//    複数の町名行は areas に列挙する。同一 PDF 内で日程 (signature) が食い違えば
//    中断する (1 PDF = 1 収集日程 の整合ガード。カレンダー PDF は町丁目ごとに 1 枚)。
// 3. 年末年始 (12/31〜1/3) に当たる収集日を overrides で休止。祝日・お盆は通常収集。
//    ※休止期間を変更する場合は区が 12 月に広報・区 HP で告知する (meta.yaml notes / yearend_url)。
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as yamlParse, stringify as yamlStringify } from 'yaml';
import { parseSuginamiCsv, rowToRules, signatureKey, townBase, normalizeTownName } from './parse.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '../../../municipalities/tokyo/suginami');
const CSV_URL = 'https://www.city.suginami.tokyo.jp/documents/12125/garbage.csv';
const EXTRACTED_AT = process.env.EXTRACTED_AT || '2026-07-17'; // Date.now() 不使用 (決定的出力)

const yomi = yamlParse(readFileSync(join(HERE, 'yomi.yaml'), 'utf8'));

const rows = parseSuginamiCsv(readFileSync(join(HERE, 'cache', 'suginami.csv'), 'utf8'));
console.log(`CSV ${rows.length} 行`);

// 丁目の数値部分 (読みソート用)。例: 阿佐谷北1～6丁目 → "1-6"
const chomeDigits = (name) => {
  const suf = normalizeTownName(name).replace(townBase(name), '').replace(/丁目$/, '');
  return suf.replace(/[～〜・,]/g, '-');
};
const areaYomi = (name) => {
  const base = yomi[townBase(name)];
  if (!base) throw new Error(`yomi.yaml に無い町名: ${townBase(name)} (${name})`);
  return base + chomeDigits(name);
};

// --- PDF 番号でグループ化 (= コース) ---
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

const byPdf = new Map(); // pdfNo → { rules, sig, areas: [{name, yomi}] }
for (const row of rows) {
  const rules = rowToRules(row);
  const sig = signatureKey(rules);
  if (!byPdf.has(row.pdfNo)) byPdf.set(row.pdfNo, { rules, sig, areas: [] });
  const g = byPdf.get(row.pdfNo);
  if (g.sig !== sig) {
    throw new Error(`PDF ${row.pdfNo} 内で日程が不一致: ${row.town} が他の町名と別日程 ` +
      `(1 PDF = 1 収集日程 のはず → CSV かグルーピングを要確認)`);
  }
  g.areas.push({ name: normalizeTownName(row.town), yomi: areaYomi(row.town) });
}
console.log(`${byPdf.size} コース (PDF 番号単位)`);

// --- 出力 (course-<N>.yaml、N は PDF 番号) ---
mkdirSync(join(OUT, '2026'), { recursive: true });
const nos = [...byPdf.keys()].sort((a, b) => a - b);
for (const no of nos) {
  const { rules, areas } = byPdf.get(no);
  const doc = {
    metadata: {
      city: 'suginami', course: String(no),
      areas: areas.sort((a, b) => a.yomi.localeCompare(b.yomi, 'ja')),
      year: 2026, fiscal_year_ja: '令和8年度',
      source: {
        source_url: CSV_URL,
        pdf_url: `https://www.city.suginami.tokyo.jp/shared/garbage/${no}.pdf`,
        extracted_at: EXTRACTED_AT,
        extracted_by: 'claude-opus-4-8',
        verified_by: 'Claude(杉並区公式の収集曜日 CSV の機械変換。地域別カレンダー PDF 全28枚と通年機械照合 + 全地域版冊子P.21一覧表と突合)',
      },
    },
    rules,
    overrides: yearEndOverrides(rules),
  };
  writeFileSync(join(OUT, '2026', `course-${no}.yaml`), yamlStringify(doc, { lineWidth: 0 }));
}
console.log(`generated ${nos.length} courses (course-${nos[0]}〜course-${nos[nos.length - 1]})`);
