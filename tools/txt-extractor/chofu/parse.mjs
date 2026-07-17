// 調布市ごみリサイクルカレンダー(地区別テキスト版)のパーサ。
// 各地区の r8calendar_noN.txt は「日付・曜日・品目」の日付入り通年カレンダー。
// これを (YYYY-MM-DD → [category,...]) に変換する。build と verify で共有する。

// カレンダー上の品目表記 → 正典 category (schema/categories.yaml の部分集合)。
// シュレッダー紙(シュレッダーにかけた古紙、ビンと同日収集) は paper、
// 古紙・古布(別日・週1) は paper_cloth に割り当てて区別する。
export const ITEM2CAT = {
  '燃やせるごみ': 'burnable',
  '燃やせないごみ': 'non_burnable',
  '容器包装プラスチック': 'plastic',
  '古紙・古布': 'paper_cloth',
  'カン': 'beverage_can',
  'ビン': 'glass_bottle',
  'シュレッダー紙': 'paper',
  'ペットボトル': 'pet_bottle',
  '有害': 'hazardous',
};

const WD = { '月': 1, '火': 2, '水': 3, '木': 4, '金': 5, '土': 6, '日': 0 }; // JS getDay()

const pad = (n) => String(n).padStart(2, '0');

// テキスト全体を解析し、Map<isoDate, string[]> を返す。
// 「収集なし」の日は空配列を格納する(全品目停止の明示)。
export function parseCalendar(text) {
  const events = new Map();
  let year = null, month = null;
  for (const raw of text.replace(/^﻿/, '').split(/\r?\n/)) {
    const line = raw.trimEnd();
    let m = line.match(/^令和(\d+)年\s*(\d+)月/);
    if (m) { year = 2018 + Number(m[1]); month = Number(m[2]); continue; }
    m = line.match(/^(\d+)日\t(.)曜日\s*(.*)$/);
    if (!m || month == null) continue;
    const day = Number(m[1]);
    const wd = m[2];
    const rest = m[3].trim();
    const d = new Date(year, month - 1, day);
    if (d.getDay() !== WD[wd]) {
      throw new Error(`weekday mismatch ${year}-${month}-${day}: text=${wd} actual=${d.getDay()}`);
    }
    const iso = `${year}-${pad(month)}-${pad(day)}`;
    const cats = [];
    for (const tok of rest.split(/[\s　]+/)) {
      const t = tok.trim();
      if (!t || t === '収集なし') continue;
      const cat = ITEM2CAT[t];
      if (!cat) throw new Error(`unknown item "${t}" on ${iso}`);
      cats.push(cat);
    }
    events.set(iso, cats);
  }
  return events;
}

// 会計年度の全日付 (FY開始4/1 〜 翌3/31) を iso 文字列で返す。
export function fiscalYearDates(fy) {
  const out = [];
  const start = new Date(fy, 3, 1), end = new Date(fy + 1, 3, 1);
  for (let d = new Date(start); d < end; d = new Date(d.getTime() + 86400000)) {
    out.push(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`);
  }
  return out;
}

export const DOW = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
