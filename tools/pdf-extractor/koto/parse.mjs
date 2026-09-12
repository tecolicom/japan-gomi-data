// 都カタログ CSV のパースと町丁目の分解。
//
// CSV は**日本語の町名の出どころ**であり、曜日規則の照合相手でもある。
// ただし**地区割の正典ではない** — 現行版シートと豊洲・塩浜で食い違う (sources.mjs 参照)。
import { zen2han } from '../../_lib/jp.mjs';

const TILDE = /[~～〜]/g;
export const norm = (s) => zen2han(String(s)).replace(TILDE, '～').replace(/[\s　]+/g, '').trim();

const HEADER = ['じゅうしょ', '住所', '地区番号', '資源', 'プラスチック', '燃やすごみ', '燃やさないごみ'];

/** 都カタログ CSV → 行の配列。 */
export function parseCsv(text) {
  const lines = text.replace(/\r/g, '').split('\n').filter((l) => l.trim());
  const head = lines[0].split(',').map((s) => norm(s));
  if (head.join('|') !== HEADER.join('|')) throw new Error(`CSV の見出しが想定と違う: ${head.join('|')}`);
  const rows = [];
  for (const line of lines.slice(1)) {
    const c = line.split(',');
    if (c.length < 7) throw new Error(`列数が ${c.length} の行: "${line}"`);
    const district = Number(norm(c[2]));
    if (!(district >= 1 && district <= 12)) throw new Error(`地区番号が範囲外: "${c[2]}" (${c[1]})`);
    const nb = /^（隔週）([日月火水木金土])$/.exec(norm(c[6]));
    if (!nb) throw new Error(`燃やさないごみが「（隔週）<曜日>」の形でない: "${c[6]}" (${c[1]})`);
    rows.push({
      // 「ひらの　」のように読みに全角空白が混じる行がある
      yomi: norm(c[0]),
      name: norm(c[1]),
      district,
      res: norm(c[3]),
      plastic: norm(c[4]),
      burnable: norm(c[5]),
      nonBurnableDay: nb[1],
    });
  }
  if (!rows.length) throw new Error('CSV に行が無い');
  return rows;
}

// 「大島1～2丁目」→ [{town:'大島',chome:1},{town:'大島',chome:2}]
// 「南砂2～4・6～7丁目」→ 2,3,4,6,7   (範囲と列挙の混在)
// 「青海」→ [{town:'青海',chome:null}]   (丁目を持たない町)
export function splitAreas(name) {
  const m = /^(.+?)((?:\d+(?:～\d+)?)(?:・\d+(?:～\d+)?)*)丁目$/.exec(name);
  if (!m) {
    if (/\d/.test(name)) throw new Error(`町丁目が「<町名><丁目>」の形でない: "${name}"`);
    return [{ town: name, chome: null }];
  }
  const [, town, spec] = m;
  const out = [];
  for (const part of spec.split('・')) {
    const r = /^(\d+)(?:～(\d+))?$/.exec(part);
    if (!r) throw new Error(`丁目の並びが読めない: "${name}"`);
    const from = Number(r[1]);
    const to = r[2] === undefined ? from : Number(r[2]);
    if (to < from) throw new Error(`丁目の範囲が逆: "${part}" (${name})`);
    for (let n = from; n <= to; n++) out.push({ town, chome: n });
  }
  const seen = out.map((x) => x.chome);
  if (new Set(seen).size !== seen.length) throw new Error(`丁目が重複: "${name}"`);
  return out;
}

const DAY_IDX = { 月: 0, 火: 1, 水: 2, 木: 3, 金: 4, 土: 5, 日: 6 };
export const dayIdx = (c) => {
  if (!(c in DAY_IDX)) throw new Error(`曜日が読めない: "${c}"`);
  return DAY_IDX[c];
};
export const daysOf = (s) => norm(s).split('・').filter(Boolean).map(dayIdx);

/** CSV 行 → 曜日規則の比較キー (シート側と同じ形に揃える)。 */
export function csvRuleKey(row) {
  return [daysOf(row.res).join(','), daysOf(row.plastic).join(','),
    daysOf(row.burnable).join(','), String(dayIdx(row.nonBurnableDay))].join('|');
}

/** extract.py が出したシート側 → 同じキー。 */
export function sheetRuleKey(d) {
  return [d.weekly['資源'].join(','), d.weekly['プラスチック'].join(','),
    (d.weekly['燃やすごみ'] ?? []).join(','), String(d.biweekly_weekday)].join('|');
}
