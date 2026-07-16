// 中野区オープンデータ CSV / 公式 HTML 表のパーサ。
// CSV: 曜日は「木曜日」「火曜日;金曜日」「第2;第4土曜日」形式。
// HTML: 「火曜日・金曜日」「第1・第3土曜日」形式 (区切りと 第 の繰り返しがゆれる)。
import { parse as parseHtml } from 'node-html-parser';

const DAY = { 日: 'SU', 月: 'MO', 火: 'TU', 水: 'WE', 木: 'TH', 金: 'FR', 土: 'SA' };

const norm = (s) => (s || '')
  .replace(/[･・]/g, '・').replace(/　/g, '').replace(/\s+/g, '')
  .replace(/（[^）]*）/g, ''); // 「(毎日収集地域は除く)」等の注記を落とす

// "火曜日;金曜日" / "火曜日・金曜日" → ['TU','FR']
export function parseWeeklyJa(text) {
  const days = norm(text).split(/[;・]/).map((t) => DAY[t.replace(/曜日?$/, '')]).filter(Boolean);
  if (!days.length) throw new Error(`weekly parse 失敗: "${text}"`);
  return days;
}

// "第2;第4土曜日" / "第1・第3月曜日" → {occurrences: [2,4], days: ['SA']}
export function parseMonthlyNthJa(text) {
  const t = norm(text).replace(/;/g, '・');
  const m = t.match(/^第(\d)(?:・第?(\d))?([日月火水木金土])曜日?$/);
  if (!m) throw new Error(`monthly parse 失敗: "${text}"`);
  const occurrences = [Number(m[1]), ...(m[2] ? [Number(m[2])] : [])];
  return { occurrences, days: [DAY[m[3]]] };
}

// 引用符対応の素朴な CSV パーサ (全フィールド引用・引用内カンマあり)
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

// オープンデータ CSV → [{no, town, chome, plastic, binCan, burnable, nonBurnable}]
export function parseOpenDataCsv(text) {
  const rows = parseCsvText(text);
  const header = rows[0];
  const col = (name) => {
    const i = header.indexOf(name);
    if (i < 0) throw new Error(`CSV に列 "${name}" が無い (ヘッダ変更?)`);
    return i;
  };
  const [iNo, iTown, iChome, iPla, iBin, iBurn, iNon] =
    ['NO', '町名', '丁目', '資源プラスチック', 'びん,ペットボトル', '燃やすごみ', '陶器,ガラス,金属ごみ'].map(col);
  return rows.slice(1).map((r) => ({
    no: Number(r[iNo]), town: r[iTown].trim(), chome: r[iChome].trim(),
    plastic: r[iPla], binCan: r[iBin], burnable: r[iBurn], nonBurnable: r[iNon],
  }));
}

// 公式 HTML 表 → CSV と同じ行形 (照合用)。丁目は「一・二・四・五丁目」→「1;2;4;5」へ正規化。
const KANJI = { 一: '1', 二: '2', 三: '3', 四: '4', 五: '5', 六: '6', 七: '7', 八: '8', 九: '9' };
export function chomeKey(s) {
  const t = norm(s);
  if (t.includes('全域')) return '全域';
  const digits = [...t.replace(/[一二三四五六七八九]/g, (c) => KANJI[c])].filter((c) => /\d/.test(c));
  return digits.join(';');
}

export function parseOfficialHtml(html) {
  const root = parseHtml(html);
  const out = [];
  for (const tr of root.querySelectorAll('table tr')) {
    const tds = tr.querySelectorAll('td');
    if (tds.length !== 6) continue; // ヘッダ行 (th) を除外
    const [town, chome, plastic, binCan, burnable, nonBurnable] = tds.map((td) => td.text);
    out.push({ town: norm(town), chome: chomeKey(chome), plastic, binCan, burnable, nonBurnable });
  }
  return out;
}

// 1 行 → rules。びん・缶・ペットは同日収集なので days 配列を共有し YAML anchor にする。
export function rowToRules(row) {
  const binCanDays = parseWeeklyJa(row.binCan);
  const nb = parseMonthlyNthJa(row.nonBurnable);
  return [
    { category: 'burnable', pattern: 'weekly', days: parseWeeklyJa(row.burnable) },
    { category: 'non_burnable', pattern: 'monthly_nth', occurrences: nb.occurrences, days: nb.days },
    { category: 'plastic', pattern: 'weekly', days: parseWeeklyJa(row.plastic) },
    { category: 'glass_bottle', pattern: 'weekly', days: binCanDays },
    { category: 'beverage_can', pattern: 'weekly', days: binCanDays },
    { category: 'pet_bottle', pattern: 'weekly', days: binCanDays },
  ];
}

export const signatureKey = (rules) =>
  rules.map((r) => `${r.category}:${(r.days || []).join('')}:${(r.occurrences || []).join('')}`).join('|');
