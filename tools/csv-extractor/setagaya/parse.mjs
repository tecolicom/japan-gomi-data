// 世田谷区の収集曜日表記のパーサ。
//
// 一次ソース: 区オープンデータ CSV「資源・ごみ収集曜日一覧」(Shift-JIS)
//   列 = 50音, 町名, 丁目, 資源(週1回), 可燃ごみ(週2回), 不燃ごみ(月2回), ペットボトル(月2回), 管轄清掃事務所
//   例: あ,赤堤,1・3〜5,木曜日,水曜日・金曜日,2回目・4回目の月曜日,1回目・3回目の月曜日,世田谷
// 照合ソース: 同ページ (416.html) の HTML 表。同じ内容を別レイアウトで持つ。
//   CSV「水曜日・土曜日」 → HTML「水・土曜日」 / CSV「2回目・4回目の月曜日」 → HTML「2・4回目の月曜日」
//   波ダッシュも CSV=〜(U+301C) / HTML=～(U+FF5E) と揺れるため正規化する。
import { parse as parseHtml } from 'node-html-parser';
import { DAY_JA, zen2han } from '../../_lib/jp.mjs';

// 波ダッシュ・全角チルダ・空白・注記の正規化
export const norm = (s) => zen2han(s || '')
  .replace(/[〜～~]/g, '~')
  .replace(/[･]/g, '・')
  .replace(/[　\s]+/g, '')
  .trim();

// "木曜日" / "水・土曜日" / "水曜日・土曜日" → ['WE','SA']
export function parseWeekly(text) {
  const t = norm(text);
  const days = t.split('・')
    .map((x) => DAY_JA[x.replace(/曜日?$/, '')])
    .filter(Boolean);
  if (!days.length || days.length !== t.split('・').length) {
    throw new Error(`weekly parse 失敗: "${text}"`);
  }
  return days;
}

// "2回目・4回目の月曜日" (CSV) / "2・4回目の月曜日" (HTML) → {occurrences:[2,4], days:['MO']}
export function parseMonthlyNth(text) {
  const t = norm(text);
  const m = t.match(/^([\d回目・]+?)回目の([日月火水木金土])曜日?$/);
  if (!m) throw new Error(`monthly_nth parse 失敗: "${text}"`);
  const occurrences = m[1].split('・')
    .map((x) => Number(x.replace(/回目$/, '')))
    .filter((n) => Number.isInteger(n));
  if (!occurrences.length || occurrences.some((n) => !(n >= 1 && n <= 5))) {
    throw new Error(`monthly_nth parse 失敗 (回数): "${text}"`);
  }
  return { occurrences, days: [DAY_JA[m[2]]] };
}

// 丁目表記 "1・3~5" → [1,3,4,5] / "" (砧公園・駒沢公園) → []
export function parseChome(text) {
  const t = norm(text);
  if (t === '') return [];
  const out = [];
  for (const part of t.split('・')) {
    const range = part.match(/^(\d+)~(\d+)$/);
    if (range) {
      const [a, b] = [Number(range[1]), Number(range[2])];
      if (!(a < b)) throw new Error(`丁目レンジ不正: "${text}"`);
      for (let i = a; i <= b; i++) out.push(i);
    } else if (/^\d+$/.test(part)) {
      out.push(Number(part));
    } else {
      throw new Error(`丁目 parse 失敗: "${text}" (断片 "${part}")`);
    }
  }
  return out;
}

// 引用符対応の素朴な CSV パーサ
export function parseCsvText(text) {
  const rows = [];
  let row = [], field = '', inQ = false;
  const src = text.replace(/^﻿/, '');
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQ) {
      if (c === '"') { if (src[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += c;
    } else if (c === '"') inQ = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((f) => f !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); if (row.some((f) => f !== '')) rows.push(row); }
  return rows;
}

const COLS = ['50音', '町名', '丁目', '資源（週1回）', '可燃ごみ（週2回）', '不燃ごみ（月2回）', 'ペットボトル（月2回）', '管轄清掃事務所'];

// オープンデータ CSV → 行配列。1 行目はタイトル行なので読み飛ばす。
export function parseOpenDataCsv(text) {
  const rows = parseCsvText(text);
  // タイトル行 (「資源・ごみ収集日（…）」) を飛ばしてヘッダ行を探す
  const hi = rows.findIndex((r) => norm(r[0]) === '50音');
  if (hi < 0) throw new Error('CSV にヘッダ行 (50音…) が無い');
  const header = rows[hi].map(norm);
  const want = COLS.map(norm);
  if (header.length !== want.length || want.some((w, i) => header[i] !== w)) {
    throw new Error(`CSV のヘッダが想定と違う (列構成変更?): ${header.join(',')}`);
  }
  return rows.slice(hi + 1).map((r, i) => {
    if (r.length !== COLS.length) throw new Error(`CSV ${hi + 2 + i} 行目: 列数 ${r.length} (期待 ${COLS.length})`);
    const [kana, town, chome, shigen, burnable, nonBurnable, pet, office] = r.map((x) => x.trim());
    return { kana: norm(kana), town: norm(town), chome: norm(chome), shigen, burnable, nonBurnable, pet, office: norm(office) };
  });
}

// 416.html の「資源・ごみ収集日一覧（○行）」表群 → CSV と同じ行形 (照合用)
export function parseOfficialHtml(html) {
  const root = parseHtml(html);
  const out = [];
  for (const table of root.querySelectorAll('table.datatable')) {
    const head = table.querySelectorAll('th').map((th) => norm(th.text));
    // 一覧表 (8 列) 以外 (町名索引表など) は無視
    if (head.length !== 8 || head[0] !== '50音' || head[1] !== '町名') continue;
    for (const tr of table.querySelectorAll('tr')) {
      const tds = tr.querySelectorAll('td');
      if (tds.length !== 8) continue;
      const [kana, town, chome, shigen, burnable, nonBurnable, pet, office] = tds.map((td) => td.text);
      out.push({
        kana: norm(kana), town: norm(town), chome: norm(chome),
        shigen, burnable, nonBurnable, pet, office: norm(office),
      });
    }
  }
  if (!out.length) throw new Error('416.html から一覧表を抽出できなかった (ページ構造変更?)');
  return out;
}

// 世田谷区の 4 区分 → 正典語彙。
//   資源 (週1回)   = 古紙 + ガラスびん + 缶 … 同日収集 (カレンダー凡例 P12-13 で確認)
//   可燃ごみ (週2) = burnable
//   不燃ごみ (月2) = non_burnable
//   ペットボトル   = pet_bottle (資源とは別日)
export function rowToRules(row) {
  const shigenDays = parseWeekly(row.shigen);          // 古紙・びん・缶は同日 → days を共有 (YAML anchor)
  const nb = parseMonthlyNth(row.nonBurnable);
  const pet = parseMonthlyNth(row.pet);
  return [
    { category: 'burnable', pattern: 'weekly', days: parseWeekly(row.burnable) },
    { category: 'non_burnable', pattern: 'monthly_nth', occurrences: nb.occurrences, days: nb.days },
    { category: 'paper', pattern: 'weekly', days: shigenDays },
    { category: 'glass_bottle', pattern: 'weekly', days: shigenDays },
    { category: 'beverage_can', pattern: 'weekly', days: shigenDays },
    { category: 'pet_bottle', pattern: 'monthly_nth', occurrences: pet.occurrences, days: pet.days },
  ];
}

// 行の同一性キー (CSV↔HTML 突合用。町名+丁目)
export const rowKey = (row) => `${row.town}|${parseChome(row.chome).join('・')}`;

// カレンダー配布ページ (27859.html) のリンク見出し → {town, chome[]}。
// 「大蔵5~6丁目」「北烏山2・4~9丁目」「砧公園」など。CSV 側とは丁目の表記が揺れる
// (CSV「5・6」/ PDF 見出し「5~6」) ため、丁目は展開した数値列で突き合わせる。
export function parseAreaLabel(label) {
  const t = norm(label);
  const m = t.match(/^(.+?)((?:\d+[・~])*\d+)丁目$/);
  if (!m) return { town: t, chome: [] };
  return { town: m[1], chome: parseChome(m[2]) };
}

// 町丁目の同一性キー (CSV 行 / PDF 見出し のどちらからでも同じ値になる)
export const areaKey = ({ town, chome }) => `${town}|${[...chome].sort((a, b) => a - b).join('・')}`;
export const rowAreaKey = (row) => areaKey({ town: row.town, chome: parseChome(row.chome) });

// 表示名: 「赤堤1・3〜5丁目」/ 丁目なし (砧公園) は町名のみ。
// 27859.html のカレンダー PDF 見出しと同じ表記になる。
export const areaName = (row) => {
  const c = parseChome(row.chome);
  return c.length ? `${row.town}${row.chome.replace(/~/g, '〜')}丁目` : row.town;
};
