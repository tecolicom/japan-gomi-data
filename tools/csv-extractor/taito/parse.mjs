// 台東区オープンデータ CSV / 公式 HTML 表 / 令和8年度カレンダー案内ページのパーサ。
//
// 表記のゆれ:
//   CSV   町丁名は丁目を全列挙 「浅草1丁目・浅草2丁目」。区切りは「・」だが
//         根岸の行だけ読点「、」が混じる (区側の入力ゆれ) → 両方を区切りとして扱う。
//   HTML  同じ内容を簡約表記 「浅草1・2丁目」「浅草3から7丁目」。
//   曜日   資源/燃やすごみ = 「水曜」「月曜・木曜」
//          燃やさないごみ = 「その月の1回目・3回目の土曜日」
//         ※「第n週」ではなく「その月の n 回目の該当曜日」。区の収集曜日一覧ページも
//           「その月の1回目･3回目 の 燃やさないごみ の日」と明記しており monthly_nth と同義。
import { parse as parseHtml } from 'node-html-parser';

const DAY = { 日: 'SU', 月: 'MO', 火: 'TU', 水: 'WE', 木: 'TH', 金: 'FR', 土: 'SA' };

const norm = (s) => (s || '')
  .replace(/[･]/g, '・').replace(/[　\s]/g, '');

// "水曜" / "月曜・木曜" → ['MO','TH']
export function parseWeeklyJa(text) {
  const t = norm(text);
  const days = t.split('・').map((x) => {
    const m = x.match(/^([日月火水木金土])曜日?$/);
    if (!m) throw new Error(`weekly parse 失敗: "${text}" (要素 "${x}")`);
    return DAY[m[1]];
  });
  if (!days.length) throw new Error(`weekly parse 失敗: "${text}"`);
  return days;
}

// "その月の1回目・3回目の土曜日" → {occurrences:[1,3], days:['SA']}
export function parseMonthlyNthJa(text) {
  const t = norm(text);
  const m = t.match(/^その月の(\d)回目(?:・(\d)回目)*の([日月火水木金土])曜日?$/);
  if (!m) throw new Error(`monthly_nth parse 失敗: "${text}"`);
  const occurrences = [...t.matchAll(/(\d)回目/g)].map((x) => Number(x[1]));
  if (!occurrences.length) throw new Error(`monthly_nth の回数を取得できない: "${text}"`);
  return { occurrences, days: [DAY[m[3]]] };
}

// 町丁名 → [{town, chome}] (chome は数値、丁目の無い町は null)
// CSV 形式 "浅草1丁目・浅草2丁目" / "秋葉原" / 根岸行の読点ゆれに対応。
export function expandCsvAreas(text) {
  const out = [];
  for (const part of norm(text).split(/[・、]/)) {
    if (!part) continue;
    const m = part.match(/^(.+?)(\d+)丁目$/);
    if (m) out.push({ town: m[1], chome: Number(m[2]) });
    else if (/\d/.test(part)) throw new Error(`CSV 町丁名を解釈できない: "${part}"`);
    else out.push({ town: part, chome: null });
  }
  if (!out.length) throw new Error(`CSV 町丁名が空: "${text}"`);
  return out;
}

// HTML 簡約表記 → [{town, chome}]
// "浅草1・2丁目" / "浅草3から7丁目" / "下谷1丁目" / "秋葉原"
export function expandHtmlAreas(text) {
  const t = norm(text);
  const m = t.match(/^(.+?)([\d・から]+)丁目$/);
  if (!m) {
    if (/\d/.test(t)) throw new Error(`HTML 町丁名を解釈できない: "${t}"`);
    return [{ town: t, chome: null }];
  }
  const [, town, spec] = m;
  const range = spec.match(/^(\d+)から(\d+)$/);
  if (range) {
    const [a, b] = [Number(range[1]), Number(range[2])];
    if (b < a) throw new Error(`丁目の範囲が逆順: "${t}"`);
    return Array.from({ length: b - a + 1 }, (_, i) => ({ town, chome: a + i }));
  }
  return spec.split('・').map((x) => {
    if (!/^\d+$/.test(x)) throw new Error(`丁目指定を解釈できない: "${t}" (要素 "${x}")`);
    return { town, chome: Number(x) };
  });
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

// オープンデータ CSV → [{index, rawName, areas, shigen, burnable, nonBurnable}]
export function parseOpenDataCsv(text) {
  const rows = parseCsvText(text);
  const header = rows[0];
  const col = (name) => {
    const i = header.indexOf(name);
    if (i < 0) throw new Error(`CSV に列 "${name}" が無い (ヘッダ変更?)`);
    return i;
  };
  const [iIdx, iName, iShigen, iBurn, iNon] =
    ['索引', '町丁名', '資源', '燃やすごみ', '燃やさないごみ'].map(col);
  return rows.slice(1).map((r) => ({
    index: r[iIdx].trim(),
    rawName: r[iName].trim(),
    areas: expandCsvAreas(r[iName]),
    shigen: r[iShigen].trim(),
    burnable: r[iBurn].trim(),
    nonBurnable: r[iNon].trim(),
  }));
}

// 公式 HTML 表「収集曜日（全体）」 → CSV と同じ行形 (索引セルの有無で列数が変わる)
export function parseOfficialHtml(html) {
  const root = parseHtml(html);
  const out = [];
  for (const tr of root.querySelectorAll('table tr')) {
    const cells = tr.querySelectorAll('th,td').map((td) => norm(td.text));
    // 索引かな付きの行は5セル、続きの行は4セル
    const c = cells.length === 5 ? cells.slice(1) : cells;
    if (c.length !== 4) continue;
    const [name, shigen, burnable, nonBurnable] = c;
    if (name === '町丁名' || !name) continue;
    out.push({ rawName: name, areas: expandHtmlAreas(name), shigen, burnable, nonBurnable });
  }
  return out;
}

// 令和8年度カレンダー案内ページ → Map<町丁キー, 整理番号>
// 表記は「浅草1から2丁目」「浅草橋全域」「秋葉原」。全域は町名まるごと。
export function parseCalendarSeiri(html) {
  const root = parseHtml(html);
  const map = new Map(); // "町|丁目" or "町|*" → 整理番号
  for (const tr of root.querySelectorAll('table tr')) {
    const cells = tr.querySelectorAll('th,td').map((td) => norm(td.text));
    const i = cells.findIndex((x) => /^\d{1,2}$/.test(x));
    if (i <= 0) continue;
    const name = cells[i - 1];
    const no = Number(cells[i]);
    if (!name || /^\d/.test(name)) continue;
    if (name.endsWith('全域')) map.set(`${name.slice(0, -2)}|*`, no);
    else for (const a of expandHtmlAreas(name)) map.set(`${a.town}|${a.chome ?? '*'}`, no);
  }
  return map;
}

export const areaKey = (a) => `${a.town}|${a.chome ?? '*'}`;

// 1 行 → rules。
// 台東区の「資源」は 古紙類 + びん・缶・ペットボトル の同日収集。
// さらに令和7年4月から区内全域でプラスチック分別回収が始まり、
// 区公式が「回収曜日は資源と同じ曜日」と明記しているためプラスチックも同日に含める。
// (CSV/HTML表はプラスチック開始前の様式のため列が無い。plastics.html が根拠)
export function rowToRules(row) {
  const shigenDays = parseWeeklyJa(row.shigen);
  const nb = parseMonthlyNthJa(row.nonBurnable);
  return [
    { category: 'burnable', pattern: 'weekly', days: parseWeeklyJa(row.burnable) },
    { category: 'non_burnable', pattern: 'monthly_nth', occurrences: nb.occurrences, days: nb.days },
    { category: 'paper', pattern: 'weekly', days: shigenDays },
    { category: 'glass_bottle', pattern: 'weekly', days: shigenDays },
    { category: 'beverage_can', pattern: 'weekly', days: shigenDays },
    { category: 'pet_bottle', pattern: 'weekly', days: shigenDays },
    { category: 'plastic', pattern: 'weekly', days: shigenDays },
  ];
}

// 収集日程の同一性キー (コース畳み込み・ソース間照合の両方に使う)
export const signatureKey = (rules) =>
  rules.map((r) => `${r.category}:${(r.days || []).join('')}:${(r.occurrences || []).join('')}`).join('|');
