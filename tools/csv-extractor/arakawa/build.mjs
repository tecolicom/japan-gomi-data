// 荒川区配布 CSV → municipalities/tokyo/arakawa/2026/course-*.yaml
//
// 1. cache/gomi.csv (2,249 行 = 地区×丁目×番地・号) を rules へ変換。
// 2. 同一日程の行をシグネチャで畳み込みコース採番 (中野・川崎と同方式)。
// 3. area 名は「南千住1丁目1〜5番」形式。丁目が丸ごと 1 コースなら「南千住1丁目」に短縮する。
// 4. 年末年始を overrides 化。ごみ系 (燃やす/燃やさない/プラ) は 1/1〜1/3、
//    資源系 (びん・缶・古紙・ペット・古布) は 12/31〜1/3 と休止幅が違う (CSV 備考欄が明示)。
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as yamlParse } from 'yaml';
import { foldCourses, courseDoc, writeCourses } from '../../_lib/emit.mjs';
import { categoriesOn } from '../../_lib/schedule.mjs';
import { parseCsv, rowToRules, unschedulableOf, banchiNumber, COL } from './parse.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '../../../municipalities/tokyo/arakawa');
const CACHE = join(HERE, 'cache');
const CSV_URL = existsSync(join(CACHE, 'source-url.txt'))
  ? readFileSync(join(CACHE, 'source-url.txt'), 'utf8').trim()
  : 'https://www.city.arakawa.tokyo.jp/documents/41480/gomi_20251216.csv';
const EXTRACTED_AT = process.env.EXTRACTED_AT || '2026-07-20'; // Date.now() 不使用 (決定的出力)
const YEAR = 2026;

const yomi = yamlParse(readFileSync(join(HERE, 'yomi.yaml'), 'utf8'));
const allRows = parseCsv(readFileSync(join(CACHE, 'gomi.csv'), 'utf8'));
console.log(`CSV ${allRows.length} 行`);

// --- 重複キー (区 CSV 側の既知の不整合) ---
// 同一「地区+丁目+番地・号」が 2 行あり資源の日程が食い違うケースが 1 件だけ実在する。
// ソースを勝手に直さない方針なので「先勝ち + 既知リストと照合」で処理し、
// リストに無い重複が出たら throw して気付けるようにする (来年度更新時のガード)。
// 判断根拠: 西尾久8丁目は 11〜50番のうち 30番を除く全番地が「第1・第3の木曜日/木曜日/第2・第4・第5の木曜日」で、
//   1 行目はこの近隣パターンと一致、2 行目 (火曜日/金曜日/金曜日) は孤立している。
//   隣接番地との整合を優先して 1 行目を採用。区への照会が必要な未解決事項として meta.yaml notes に記載。
const KNOWN_DUPLICATES = new Set(['西尾久|8丁目|44番']);
const rowKey = (r) => `${r[COL.district]}|${r[COL.chome]}|${r[COL.banchi]}`;
const seen = new Set();
const rows = [];
const dropped = [];
for (const r of allRows) {
  const k = rowKey(r);
  if (seen.has(k)) {
    if (!KNOWN_DUPLICATES.has(k)) {
      throw new Error(`未知の重複行: ${k} (CSV が更新された可能性 → 内容を確認して KNOWN_DUPLICATES を見直すこと)`);
    }
    dropped.push(r);
    continue;
  }
  seen.add(k);
  rows.push(r);
}
for (const k of KNOWN_DUPLICATES) {
  if (!dropped.some((r) => rowKey(r) === k)) {
    throw new Error(`KNOWN_DUPLICATES の ${k} が CSV に存在しない (解消された可能性 → リストから削除すること)`);
  }
}
if (dropped.length) {
  console.log(`既知の重複行 ${dropped.length} 件を先勝ちで除外: ${dropped.map(rowKey).join(', ')}`);
}

// --- 備考欄の年末年始文言が全行同一であることを確認 (文言が変わったら気付けるようにする) ---
const gomiNotes = new Set(rows.map((r) => r[COL.gomiNote]));
const shigenNotes = new Set(rows.map((r) => r[COL.shigenNote]));
const EXPECT_GOMI = '翌年１月１日から１月３日は、ごみ・プラスチックの収集・回収をしません。';
const EXPECT_SHIGEN = '１２月３１日から翌年１月３日は、資源回収をしません。';
if (gomiNotes.size !== 1 || !gomiNotes.has(EXPECT_GOMI)) {
  throw new Error(`ごみ備考欄の文言が想定外: ${[...gomiNotes].join(' / ')}`);
}
if (shigenNotes.size !== 1 || !shigenNotes.has(EXPECT_SHIGEN)) {
  throw new Error(`資源備考欄の文言が想定外: ${[...shigenNotes].join(' / ')}`);
}

// --- 年末年始 overrides ---
// ごみ系は 1/1〜1/3 休止、資源系は 12/31〜1/3 休止。
const GOMI_CATS = new Set(['burnable', 'non_burnable', 'plastic']);
const SHIGEN_CATS = new Set(['glass_bottle', 'beverage_can', 'paper', 'pet_bottle', 'paper_cloth']);
const STOPPED_ON = {
  '2026-12-31': SHIGEN_CATS,                              // 資源のみ休止 (ごみは通常収集)
  '2027-01-01': new Set([...GOMI_CATS, ...SHIGEN_CATS]),
  '2027-01-02': new Set([...GOMI_CATS, ...SHIGEN_CATS]),
  '2027-01-03': new Set([...GOMI_CATS, ...SHIGEN_CATS]),
};
const NOTE_GOMI = '年末年始休止(ごみ・プラスチック 1/1〜1/3)';
const NOTE_SHIGEN = '年末年始休止(資源 12/31〜1/3)';

function yearEndOverrides(rules) {
  const out = [];
  for (const [iso, stopped] of Object.entries(STOPPED_ON)) {
    const cats = categoriesOn(new Date(`${iso}T00:00:00`), rules, []);
    if (!cats.length) continue;
    const hit = cats.filter((c) => stopped.has(c));
    if (!hit.length) continue;
    const note = hit.every((c) => SHIGEN_CATS.has(c)) && !hit.some((c) => GOMI_CATS.has(c))
      ? NOTE_SHIGEN : NOTE_GOMI;
    if (hit.length === cats.length) {
      out.push({ date: iso, cancelled: true, note });          // その日の収集が全滅 → 日単位で休止
    } else {
      // 一部カテゴリのみ休止 (12/31 に ごみ と 資源 が重なる場合)。schema の category 付き override。
      for (const c of hit) out.push({ date: iso, category: c, cancelled: true, note: NOTE_SHIGEN });
    }
  }
  return out;
}

// --- area 名 ---
// 丁目が丸ごと同一コースなら「南千住1丁目」、そうでなければ番地を連番畳み込みして
// 「南千住1丁目1〜5番」「南千住1丁目7番」。「9番12号」形式は畳まずそのまま列挙する。
const chomeTotal = new Map(); // "地区|丁目" → CSV 上の行数
for (const r of rows) {
  const k = `${r[COL.district]}|${r[COL.chome]}`;
  chomeTotal.set(k, (chomeTotal.get(k) || 0) + 1);
}
const townYomi = (town) => {
  const y = yomi[town];
  if (!y) throw new Error(`yomi.yaml に無い地区名: ${town}`);
  return y;
};
const chomeNum = (chome) => Number(chome.replace('丁目', ''));

// 同一 (地区,丁目) の行群 → 表示名の配列
function namesForChome(town, chome, members) {
  if (members.length === chomeTotal.get(`${town}|${chome}`)) return [`${town}${chome}`];
  const nums = members.map((r) => banchiNumber(r[COL.banchi]));
  const plain = nums.filter((n) => n !== null).sort((a, b) => a - b);
  const others = members.filter((r) => banchiNumber(r[COL.banchi]) === null)
    .map((r) => r[COL.banchi]).sort();
  const out = [];
  for (let i = 0; i < plain.length;) {
    let j = i;
    while (j + 1 < plain.length && plain[j + 1] === plain[j] + 1) j++;
    out.push(i === j ? `${town}${chome}${plain[i]}番` : `${town}${chome}${plain[i]}〜${plain[j]}番`);
    i = j + 1;
  }
  for (const b of others) out.push(`${town}${chome}${b}`);
  return out;
}

function areasFor(members) {
  const byChome = new Map();
  for (const r of members) {
    const k = `${r[COL.district]}|${r[COL.chome]}`;
    if (!byChome.has(k)) byChome.set(k, []);
    byChome.get(k).push(r);
  }
  const areas = [];
  for (const [k, group] of byChome) {
    const [town, chome] = k.split('|');
    const first = banchiNumber(group[0][COL.banchi]);
    for (const name of namesForChome(town, chome, group)) {
      const m = name.match(/(\d+)(?:〜\d+)?番/);
      areas.push({ name, yomi: `${townYomi(town)}${chomeNum(chome)}-${m ? m[1] : (first ?? 0)}` });
    }
  }
  return areas.sort((a, b) => a.yomi.localeCompare(b.yomi, 'ja'));
}

// --- 畳み込み → 出力 ---
// foldCourses は toArea(row) が 1 area を返す前提なので、ここでは行そのものを持たせて後で area 化する。
const folded = foldCourses(rows, rowToRules, (r) => r);
console.log(`${rows.length} 行 → ${folded.length} コース`);

const docs = folded.map(({ rules, areas: members }, i) => courseDoc({
  city: 'arakawa',
  course: String(i + 1),
  areas: areasFor(members),
  year: YEAR,
  fiscalYearJa: '令和8年度',
  source: {
    source_url: CSV_URL,
    extracted_at: EXTRACTED_AT,
    extracted_by: 'claude-opus-4.8',
    verified_by: 'Claude(荒川区配布CSVの機械変換。別実装(Python)で全2,249行を独立パースし生成YAMLと通年照合)',
  },
  rules,
  overrides: yearEndOverrides(rules),
}));

mkdirSync(OUT, { recursive: true });
writeCourses(OUT, YEAR, docs);

// verify.py が使う行→コース対応表
const rowToCourse = [];
folded.forEach(({ areas: members }, i) => {
  for (const r of members) {
    rowToCourse.push({ district: r[COL.district], chome: r[COL.chome], banchi: r[COL.banchi], course: i + 1 });
  }
});
writeFileSync(join(CACHE, 'row-to-course.json'), JSON.stringify(rowToCourse, null, 1));

// --- 集計ログ ---
const unsched = new Map();
for (const r of rows) for (const u of unschedulableOf(r)) {
  const k = `${u.label}: ${u.raw || '(空欄)'}`;
  unsched.set(k, (unsched.get(k) || 0) + 1);
}
console.log(`生成 ${docs.length} コース / area ${docs.reduce((n, d) => n + d.metadata.areas.length, 0)} 件`);
console.log('展開不能セル (rules から除外):');
for (const [k, n] of [...unsched].sort((a, b) => b[1] - a[1])) console.log(`  ${n.toString().padStart(4)}  ${k}`);
const partial = docs.filter((d) => (d.overrides || []).some((o) => o.category)).length;
console.log(`12/31 にごみと資源が重なりカテゴリ別 override になったコース: ${partial}`);
