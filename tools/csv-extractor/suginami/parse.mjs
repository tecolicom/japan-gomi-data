// 杉並区 収集曜日 CSV (garbage.csv) のパーサ。
// 列: 五十音 / 町名 / 可燃ごみ / 不燃ごみ / びん・かん・プラ / 古紙・ペットボトル / pdf_txt / pdf_url
//   可燃ごみ            "水曜日・土曜日"  (週2、weekly)
//   不燃ごみ            "第1,3月曜日"     (月2、monthly_nth。第 n = その月 n 回目の該当曜日)
//   びん・かん・プラ    "金曜日"          (週1、weekly) → glass_bottle + beverage_can + plastic 同日
//   古紙・ペットボトル  "月曜日"          (週1、weekly) → paper + pet_bottle 同日
//   pdf_url            "/shared/garbage/<N>.pdf" (N=地域別カレンダー番号。コース単位)

const DAY = { 日: 'SU', 月: 'MO', 火: 'TU', 水: 'WE', 木: 'TH', 金: 'FR', 土: 'SA' };

// 全角数字→半角。曜日区切りは ・ ; 、 に対応。
const norm = (s) => (s || '')
  .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
  .replace(/[･]/g, '・').replace(/　/g, '').replace(/\s+/g, '');

// "水曜日・土曜日" / "金曜日" → ['WE','SA'] / ['FR']
export function parseWeeklyJa(text) {
  const days = norm(text).split(/[・;、]/).map((t) => DAY[t.replace(/曜日?$/, '')]).filter(Boolean);
  if (!days.length) throw new Error(`weekly parse 失敗: "${text}"`);
  return days;
}

// "第1,3月曜日" / "第2,4土曜日" → {occurrences:[1,3], days:['MO']}
// 杉並は「第<n1>,<n2><曜>曜日」形式 (第 は 1 回、回数はカンマ区切り)。
export function parseMonthlyNthJa(text) {
  const t = norm(text);
  const m = t.match(/^第([\d,・]+)([日月火水木金土])曜日?$/);
  if (!m) throw new Error(`monthly parse 失敗: "${text}"`);
  const occurrences = m[1].split(/[,・]/).filter(Boolean).map(Number);
  if (!occurrences.length) throw new Error(`monthly parse 失敗 (回数なし): "${text}"`);
  return { occurrences, days: [DAY[m[2]]] };
}

// "/shared/garbage/12.pdf" → 12
export function parsePdfNo(url) {
  const m = (url || '').match(/\/(\d+)\.pdf\b/);
  if (!m) throw new Error(`pdf_url から番号を取得できない: "${url}"`);
  return Number(m[1]);
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

// garbage.csv → [{town, burnable, nonBurnable, binKanPla, paperPet, pdfNo}]
export function parseSuginamiCsv(text) {
  const rows = parseCsvText(text);
  const header = rows[0];
  const col = (name) => {
    const i = header.indexOf(name);
    if (i < 0) throw new Error(`CSV に列 "${name}" が無い (ヘッダ変更?)`);
    return i;
  };
  const [iTown, iBurn, iNon, iBinKanPla, iPaperPet, iUrl] =
    ['町名', '可燃ごみ', '不燃ごみ', 'びん・かん・プラ', '古紙・ペットボトル', 'pdf_url'].map(col);
  return rows.slice(1).map((r) => ({
    town: normalizeTownName(r[iTown]),
    burnable: r[iBurn], nonBurnable: r[iNon],
    binKanPla: r[iBinKanPla], paperPet: r[iPaperPet],
    pdfNo: parsePdfNo(r[iUrl]),
  }));
}

// 町名の全角数字を半角へ (例: 永福1～４丁目 → 永福1～4丁目)。ほかは原文どおり。
export function normalizeTownName(s) {
  return (s || '').trim().replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
}

// 町名から丁目部分を除いた基底名 (読み引き用)。例: 阿佐谷北1～6丁目 → 阿佐谷北
export function townBase(name) {
  return normalizeTownName(name).replace(/[0-9][0-9～〜・,\s]*丁目$/, '');
}

// 1 行 → rules。同日収集グループは days 配列を共有し YAML anchor 化する。
// 順序: 可燃 / 不燃 / (資源プラ・びん・かん 同日) / (古紙・ペット 同日)。
export function rowToRules(row) {
  const nb = parseMonthlyNthJa(row.nonBurnable);
  const resDays = parseWeeklyJa(row.binKanPla);     // びん・かん・資源プラスチック 同日
  const paperDays = parseWeeklyJa(row.paperPet);    // 古紙・ペットボトル 同日
  return [
    { category: 'burnable', pattern: 'weekly', days: parseWeeklyJa(row.burnable) },
    { category: 'non_burnable', pattern: 'monthly_nth', occurrences: nb.occurrences, days: nb.days },
    { category: 'plastic', pattern: 'weekly', days: resDays },
    { category: 'glass_bottle', pattern: 'weekly', days: resDays },
    { category: 'beverage_can', pattern: 'weekly', days: resDays },
    { category: 'paper', pattern: 'weekly', days: paperDays },
    { category: 'pet_bottle', pattern: 'weekly', days: paperDays },
  ];
}

export const signatureKey = (rules) =>
  rules.map((r) => `${r.category}:${(r.days || []).join('')}:${(r.occurrences || []).join('')}`).join('|');
