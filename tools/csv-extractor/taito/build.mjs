// 台東区オープンデータ CSV → municipalities/tokyo/taito/2026/course-*.yaml
//
// 検証は独立3ソースで行い、どれか1つでも食い違えば中断する:
//   (1) オープンデータ CSV (一次)        … 令和4年3月公開
//   (2) 公式 HTML 表「収集曜日（全体）」 … 現行。CSV の鮮度ガード
//   (3) 令和8年度カレンダー案内の整理番号 … 区公式のコース分け。畳み込み結果と一致すべき
//
// コース番号は区公式の「整理番号」(1〜12) をそのまま採用する。
// 年末年始: 区の令和8年度カレンダーが「※年末年始は収集日を変更する場合があります。
// 12月の広報たいとうや台東区ホームページなどでご確認ください」と明示し、日程未確定。
// 推測でoverridesを作らない (playbook §1「推測でデータを作らない」)。
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as yamlParse, stringify as yamlStringify } from 'yaml';
import {
  parseOpenDataCsv, parseOfficialHtml, parseCalendarSeiri,
  rowToRules, signatureKey, areaKey,
} from './parse.mjs';
import { CSV_URL } from './urls.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '../../../municipalities/tokyo/taito');
const EXTRACTED_AT = process.env.EXTRACTED_AT || '2026-07-20'; // Date.now() 不使用 (決定的出力)

const read = (f) => readFileSync(join(HERE, 'cache', f), 'utf8');
const yomi = yamlParse(readFileSync(join(HERE, 'yomi.yaml'), 'utf8'));

const csvRows = parseOpenDataCsv(read('taito.csv'));
const htmlRows = parseOfficialHtml(read('shushubi_zentai.html'));
const seiri = parseCalendarSeiri(read('R8calendar.html'));

// --- 検証(1) 読みの自己検査: CSV「索引」列のかなと yomi の1文字目が一致するか ---
for (const row of csvRows) {
  const town = row.areas[0].town;
  const y = yomi[town];
  if (!y) throw new Error(`yomi.yaml に無い町名: ${town}`);
  if (y[0] !== row.index) throw new Error(`読みが索引と不一致: ${town} 索引=${row.index} 読み=${y}`);
}

// --- 検証(2) CSV × 公式 HTML 表 を全行突合 ---
if (csvRows.length !== htmlRows.length) {
  throw new Error(`行数不一致: CSV=${csvRows.length} HTML=${htmlRows.length}`);
}
const htmlByArea = new Map();
for (const r of htmlRows) for (const a of r.areas) htmlByArea.set(areaKey(a), r);

let checkedAreas = 0;
for (const row of csvRows) {
  const sig = signatureKey(rowToRules(row));
  for (const a of row.areas) {
    const h = htmlByArea.get(areaKey(a));
    if (!h) throw new Error(`公式 HTML 表に無い町丁: ${areaKey(a)} (CSV 行「${row.rawName}」)`);
    if (signatureKey(rowToRules(h)) !== sig) {
      throw new Error(`CSV と公式 HTML 表の日程が不一致: ${areaKey(a)} (CSV が古い可能性 → 要調査)`);
    }
    checkedAreas++;
  }
}
// 逆方向 (HTML にあって CSV に無い町丁) も検出する
const csvAreaKeys = new Set(csvRows.flatMap((r) => r.areas.map(areaKey)));
for (const k of htmlByArea.keys()) {
  if (!csvAreaKeys.has(k)) throw new Error(`CSV に無い町丁が公式 HTML 表にある: ${k}`);
}
console.log(`検証(2) CSV ${csvRows.length}行 / ${checkedAreas}町丁 = 公式HTML表 全一致`);

// --- 畳み込み (同一日程の町丁を1コースへ) ---
const bySig = new Map();
for (const row of csvRows) {
  const rules = rowToRules(row);
  const sig = signatureKey(rules);
  if (!bySig.has(sig)) bySig.set(sig, { rules, areas: [] });
  const g = bySig.get(sig);
  for (const a of row.areas) {
    g.areas.push({
      name: a.chome === null ? a.town : `${a.town}${a.chome}丁目`,
      yomi: a.chome === null ? yomi[a.town] : `${yomi[a.town]}${a.chome}`,
      key: areaKey(a),
    });
  }
}

// --- 検証(3) 畳み込み結果 × 区公式カレンダーの整理番号 ---
// 同一シグネチャのグループが、区の整理番号ちょうど1つに対応することを確認する
// (グループ分けが区公式のコース分けと完全一致 = 畳み込みが正しい強い証拠)
const sigToNo = new Map();
for (const [sig, g] of bySig) {
  const nos = new Set(g.areas.map((a) => {
    const [town, ch] = a.key.split('|');
    const no = seiri.get(a.key) ?? seiri.get(`${town}|*`);
    if (no === undefined) throw new Error(`カレンダー案内に整理番号が無い町丁: ${a.key}`);
    return no;
  }));
  if (nos.size !== 1) {
    throw new Error(`同一日程グループが複数の整理番号にまたがる: ${[...nos].join(',')} (${g.areas.map((a) => a.name).join('、')})`);
  }
  const no = [...nos][0];
  if (sigToNo.has(no)) throw new Error(`整理番号 ${no} が複数の日程グループに対応する`);
  sigToNo.set(no, sig);
}
if (sigToNo.size !== bySig.size) throw new Error('整理番号とグループが1対1でない');
console.log(`検証(3) 日程グループ ${bySig.size}件 = 区公式カレンダーの整理番号 ${sigToNo.size}件 に1対1対応`);

// --- 出力 (コース番号 = 区公式の整理番号) ---
mkdirSync(join(OUT, '2026'), { recursive: true });
const nos = [...sigToNo.keys()].sort((a, b) => a - b);
for (const no of nos) {
  const { rules, areas } = bySig.get(sigToNo.get(no));
  const doc = {
    metadata: {
      city: 'taito',
      course: String(no),
      areas: areas
        .map(({ name, yomi }) => ({ name, yomi }))
        .sort((a, b) => a.yomi.localeCompare(b.yomi, 'ja')),
      year: 2026,
      fiscal_year_ja: '令和8年度',
      source: {
        source_url: CSV_URL,
        extracted_at: EXTRACTED_AT,
        extracted_by: 'claude-opus-4-5',
        verified_by: 'Claude(台東区オープンデータCSVの機械変換。現行公式HTML表と全39行/108町丁を突合 + 令和8年度カレンダーの整理番号12区分と1対1一致)',
      },
    },
    rules,
  };
  writeFileSync(join(OUT, '2026', `course-${no}.yaml`), yamlStringify(doc, { lineWidth: 0 }));
}
const areaTotal = [...bySig.values()].reduce((n, g) => n + g.areas.length, 0);
console.log(`generated ${nos.length} courses / ${areaTotal} 町丁 (CSV ${csvRows.length}行から畳み込み)`);
