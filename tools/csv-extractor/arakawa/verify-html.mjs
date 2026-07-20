// 検証ソース2: 区公式「ごみ収集日・プラスチック回収日」HTML 表 (一次CSVと独立な第2表現) との照合。
//
// https://www.city.arakawa.tokyo.jp/a025/recycle/shuushuubi/syusyubi.html
// この表は住所レンジ単位で 燃やすごみ / 燃やさないごみ / プラスチック の 3 種別のみを載せる
// (資源 = びん・缶・古紙・ペット・古布 は載らないので照合対象外)。
// CSV (2025-12-16 版) より新しい更新日 (2026-06-29) を持つため、CSV の鮮度ガードにもなる。
//
// 「大規模集合住宅」は表 0 の住所レンジから除外され別表 (物件名単位) になっている。
// CSV 側は番地単位なので物件名と突き合わせられない → 該当番地は照合対象から外し、件数を報告する。
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseHtml } from 'node-html-parser';
import { parseCsv, parseSchedule, COL } from './parse.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CACHE = join(HERE, 'cache');

const KANJI = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
const norm = (s) => s.replace(/\s+/g, '').replace(/（[^）]*）/g, '').replace(/※.*$/, '');
const sigOf = (s) => `${s.pattern}:${s.days.join(',')}:${(s.occurrences || []).join(',')}`;

// 「毎週月曜・木曜」→ weekly / 「1・3回目金曜」→ monthly_nth
function parseHtmlSchedule(text) {
  const t = norm(text);
  const m = t.match(/^([\d・]+)回目([日月火水木金土])曜?$/);
  if (m) return parseSchedule(`第${m[1].split('・').join('・第')}の${m[2]}曜日`);
  const w = t.match(/^毎週(.+)$/);
  if (w) return parseSchedule(w[1].split('・').map((d) => `${d.replace(/曜$/, '')}曜日`).join('・'));
  throw new Error(`HTML 表の日程を解釈できない: "${text}"`);
}

// 「荒川一丁目1から39番」「西尾久二丁目1から29・35から37番」「東尾久一丁目2番・5から37番」
// 「南千住一・六丁目」「町屋二から四丁目」→ [{district, chome, banchi:Set|null}]
function parseAreaLabel(label) {
  const t = norm(label);
  const m = t.match(/^(南千住|東尾久|西尾久|東日暮里|西日暮里|荒川|町屋)(.+?)丁目(.*)$/);
  if (!m) throw new Error(`HTML 表の地域欄を解釈できない: "${label}"`);
  const [, district, chomePart, banchiPart] = m;

  // 丁目: 「一・六」「二から四」「6」
  const chomes = [];
  const cnum = (s) => (KANJI[s] ?? Number(s));
  for (const part of chomePart.split('・')) {
    const range = part.match(/^(.+?)から(.+)$/);
    if (range) {
      for (let i = cnum(range[1]); i <= cnum(range[2]); i++) chomes.push(i);
    } else chomes.push(cnum(part));
  }
  if (chomes.some((c) => !(c >= 1 && c <= 8))) throw new Error(`丁目の解釈に失敗: "${label}"`);

  // 番地: 空なら丁目全体。「1から39番」「1・3・4番」「2番・5から37番」「1から29・35から37番」
  let banchi = null;
  if (banchiPart) {
    banchi = new Set();
    for (const part of banchiPart.replace(/番/g, '').split('・')) {
      if (!part) continue;
      const range = part.match(/^(\d+)から(\d+)$/);
      if (range) {
        for (let i = Number(range[1]); i <= Number(range[2]); i++) banchi.add(i);
      } else if (/^\d+$/.test(part)) banchi.add(Number(part));
      else throw new Error(`番地の解釈に失敗: "${label}" (${part})`);
    }
  }
  return chomes.map((c) => ({ district, chome: `${c}丁目`, banchi }));
}

// --- HTML 表 0 (住所レンジ表) を読む ---
const root = parseHtml(readFileSync(join(CACHE, 'syusyubi.html'), 'utf8'));
const tables = root.querySelectorAll('table');
const cellText = (tr) => tr.querySelectorAll('th,td').map((c) => c.text.replace(/\s+/g, ''));
const areaTable = tables[0];
const header = cellText(areaTable.querySelector('tr'));
if (!header[1]?.includes('燃やすごみ')) throw new Error(`表 0 のヘッダが想定外: ${header.join(',')}`);

const expected = new Map(); // "地区|丁目|番地番号" → rules 3 種
let labelCount = 0;
for (const tr of areaTable.querySelectorAll('tr').slice(1)) {
  const c = cellText(tr);
  if (c.length < 4) continue;
  labelCount++;
  const rules = {
    burnable: parseHtmlSchedule(c[1]),
    non_burnable: parseHtmlSchedule(c[2]),
    plastic: parseHtmlSchedule(c[3]),
  };
  for (const { district, chome, banchi } of parseAreaLabel(c[0])) {
    if (banchi === null) expected.set(`${district}|${chome}`, rules);
    else for (const b of banchi) expected.set(`${district}|${chome}|${b}`, rules);
  }
}
console.log(`公式HTML表: ${labelCount} 地域行 → ${expected.size} キー`);

// 大規模集合住宅は表 0 の住所レンジから明示的に除外され (「大規模集合住宅は除く」)、
// 別表 (物件名単位) に載る。物件名と番地の対応は公表されていないので 1:1 照合はできないが、
// 「その番地の日程が別表のどれかの物件と一致するか」は確認できる。
const bldgSig = new Map();
let bldgCount = 0;
for (const t of tables.slice(1)) {
  for (const tr of t.querySelectorAll('tr').slice(1)) {
    const c = cellText(tr);
    if (c.length < 4) continue;
    bldgCount++;
    const k = ['burnable', 'non_burnable', 'plastic']
      .map((_, i) => sigOf(parseHtmlSchedule(c[i + 1]))).join('|');
    bldgSig.set(k, (bldgSig.get(k) || []).concat(c[0]));
  }
}
console.log(`大規模集合住宅の別表: ${bldgCount} 物件 / ${bldgSig.size} 種の日程パターン`);

// --- CSV 全行と照合 ---
// 表 0 と一致しない行は、大規模集合住宅の別表で説明できるかを二段目で判定する。
// それでも説明できない行だけを「未解決」として報告する。
// 既知の未解決 (区への照会が必要): 南千住3丁目41番3~5号・41番6号。
// この 2 行は隣接する 41番1・2号 (水土/木) と 41番7号 (火金/水) の組み合わせを入れ替えた
// 日程で、別表の 30 物件のどれとも一致しない。別表が汐入地区の全物件を網羅していない可能性が高い。
// 一次ソース (CSV) を正として出力し、未解決事項として meta.yaml notes に記録する。
const KNOWN_UNEXPLAINED = new Set(['南千住3丁目41番3~5号', '南千住3丁目41番6号']);

const rows = parseCsv(readFileSync(join(CACHE, 'gomi.csv'), 'utf8'));
let checked = 0, uncovered = 0, byArea = 0, byBuilding = 0;
const unexplained = [];
for (const r of rows) {
  const district = r[COL.district], chome = r[COL.chome];
  const bnum = Number((r[COL.banchi].match(/^(\d+)番/) || [])[1]);
  const exp = expected.get(`${district}|${chome}|${bnum}`) ?? expected.get(`${district}|${chome}`);
  if (!exp) { uncovered++; continue; }
  checked++;
  const got = {
    burnable: parseSchedule(r[COL.burnable]),
    non_burnable: parseSchedule(r[COL.nonBurnable]),
    plastic: parseSchedule(r[COL.plastic]),
  };
  const CATS = ['burnable', 'non_burnable', 'plastic'];
  if (CATS.every((k) => sigOf(exp[k]) === sigOf(got[k]))) { byArea++; continue; }

  const hit = bldgSig.get(CATS.map((k) => sigOf(got[k])).join('|'));
  const name = `${district}${chome}${r[COL.banchi]}`;
  if (hit) {
    byBuilding++;
    continue; // 大規模集合住宅の別表と一致 → 表 0 から除外されている行として説明がつく
  }
  unexplained.push(`${name}: HTML表=${CATS.map((k) => sigOf(exp[k])).join('|')} CSV=${CATS.map((k) => sigOf(got[k])).join('|')}`);
}

console.log(`\n照合: CSV ${rows.length} 行中 ${checked} 行を突合 (表 0 の住所レンジ外 ${uncovered} 行は対象外)`);
console.log(`  住所レンジ表と一致: ${byArea} 行`);
console.log(`  大規模集合住宅の別表で説明: ${byBuilding} 行`);
console.log(`  未解決: ${unexplained.length} 行`);
for (const m of unexplained) console.log(`    - ${m}`);

const surprise = unexplained.filter((m) => !KNOWN_UNEXPLAINED.has(m.split(':')[0]));
if (surprise.length) {
  console.log(`\nNG: 既知リストに無い未解決が ${surprise.length} 行 (CSV か HTML が更新された可能性)`);
  process.exitCode = 1;
} else {
  console.log(`\nOK: 未解決はすべて既知の ${KNOWN_UNEXPLAINED.size} 行のみ`);
}
