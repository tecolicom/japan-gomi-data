// 中野区オープンデータ CSV → municipalities/tokyo/tokyo-nakano/2026/course-*.yaml
//
// 1. cache/nakano.csv (オープンデータ) と cache/nakanoku.html (現行公式表) を全行照合し、
//    一致しなければ中断する (CSV の鮮度ガード。最終確認日 2021 の CSV が現行と一致することが前提)。
// 2. 同一日程の行をシグネチャで畳み込み、コース採番 (練馬と同方式)。
// 3. 年末年始 (12/31〜1/3) に当たる収集日を overrides で休止。
//    ※区の年次カレンダー PDF は 12/28 以降の最終週を空白にしており (確定告知は12月頃)、
//      ここでは前年度実績と23区標準の 12/31〜1/3 を採用する。詳細は meta.yaml notes。
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as yamlParse, stringify as yamlStringify } from 'yaml';
import { parseOpenDataCsv, parseOfficialHtml, chomeKey, rowToRules, signatureKey } from './parse.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '../../../municipalities/tokyo/tokyo-nakano');
const CSV_URL = 'https://www2.wagmap.jp/nakanodatamap/nakanodatamap/opendatafile/map_1/CSV/opendata_550239.csv';
const EXTRACTED_AT = process.env.EXTRACTED_AT || '2026-07-16'; // Date.now() 不使用 (決定的出力)

const yomi = yamlParse(readFileSync(join(HERE, 'yomi.yaml'), 'utf8'));

// --- 1) CSV と公式 HTML の全行照合 ---
const csvRows = parseOpenDataCsv(readFileSync(join(HERE, 'cache', 'nakano.csv'), 'utf8'));
const htmlRows = parseOfficialHtml(readFileSync(join(HERE, 'cache', 'nakanoku.html'), 'utf8'));
if (csvRows.length !== htmlRows.length) {
  throw new Error(`行数不一致: CSV=${csvRows.length} HTML=${htmlRows.length}`);
}
const key = (r) => `${r.town}|${chomeKey(r.chome)}`;
const htmlByKey = new Map(htmlRows.map((r) => [key(r), r]));
for (const row of csvRows) {
  const h = htmlByKey.get(key(row));
  if (!h) throw new Error(`HTML に無い行: ${key(row)}`);
  if (signatureKey(rowToRules(row)) !== signatureKey(rowToRules(h))) {
    throw new Error(`CSV と公式 HTML の日程が不一致: ${key(row)} (CSV が古い可能性 → 要調査)`);
  }
}
console.log(`CSV ${csvRows.length} 行 = 公式 HTML 全行一致`);

// --- 2) シグネチャ畳み込み ---
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

// 丁目 "1;2;4;5" → 表示名 "1・2・4・5丁目" / 全域 → 町名のみ。読みは五十音ソート用の数値尾部つき。
const areaName = (row) => row.chome === '全域' ? row.town
  : `${row.town}${chomeKey(row.chome).replaceAll(';', '・')}丁目`;
const areaYomi = (row) => {
  const base = yomi[row.town];
  if (!base) throw new Error(`yomi.yaml に無い町名: ${row.town}`);
  return row.chome === '全域' ? base : `${base}${chomeKey(row.chome).replaceAll(';', '-')}`;
};

const bySig = new Map();
const noToArea = {}; // CSV NO → area name (verify.py 用の対応表)
for (const row of csvRows) {
  const rules = rowToRules(row);
  const sig = signatureKey(rules);
  if (!bySig.has(sig)) bySig.set(sig, { rules, areas: [] });
  bySig.get(sig).areas.push({ name: areaName(row), yomi: areaYomi(row) });
  noToArea[row.no] = areaName(row);
}

// --- 3) 出力 ---
const sigs = [...bySig.keys()].sort();
mkdirSync(join(OUT, '2026'), { recursive: true });
let n = 0;
for (const sig of sigs) {
  n++;
  const { rules, areas } = bySig.get(sig);
  const doc = {
    metadata: {
      city: 'tokyo-nakano', course: String(n),
      areas: areas.sort((a, b) => a.yomi.localeCompare(b.yomi, 'ja')),
      year: 2026, fiscal_year_ja: '令和8年度',
      source: {
        source_url: CSV_URL, extracted_at: EXTRACTED_AT,
        extracted_by: 'claude-fable-5',
        verified_by: 'Claude(中野区オープンデータCSVの機械変換。現行公式HTML表と全行照合 + 町丁目別カレンダーPDF全42枚と通年機械照合)',
      },
    },
    rules,
    overrides: yearEndOverrides(rules),
  };
  writeFileSync(join(OUT, '2026', `course-${n}.yaml`), yamlStringify(doc, { lineWidth: 0 }));
}
writeFileSync(join(HERE, 'cache', 'no-to-area.json'), JSON.stringify(noToArea, null, 1));
console.log(`generated ${n} courses (${csvRows.length} 行から畳み込み)`);
