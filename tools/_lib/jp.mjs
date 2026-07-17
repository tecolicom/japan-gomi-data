// 日本語の収集曜日表記のパーサ (全自治体共通)。
// 既存 extractor (suginami/kawasaki/nerima/tokyo-nakano) で実証済みの表記を統合。
// 新しい表記に出会ったらここへケースを足し、jp.test.mjs に実例を追加する。

export const DAY_JA = { 日: 'SU', 月: 'MO', 火: 'TU', 水: 'WE', 木: 'TH', 金: 'FR', 土: 'SA' };
export const DAY_TO_INDEX = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

// 全角数字→半角、区切り・空白の正規化。
export const zen2han = (s) => (s || '')
  .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));

export const normJa = (s) => zen2han(s)
  .replace(/[･]/g, '・').replace(/[　\s]+/g, '');

// 週次曜日: "水曜日・土曜日" / "月曜・木曜" / "月・木" / "金曜" → ['WE','SA'] など
export function parseWeeklyJa(text) {
  const days = normJa(text).split(/[・;、,\/]/)
    .map((t) => DAY_JA[t.replace(/曜日?$/, '')]).filter(Boolean);
  if (!days.length) throw new Error(`weekly parse 失敗: "${text}"`);
  return days;
}

// 月次 第n: "第1,3月曜日" (杉並) / "第2・4回目 火曜" (川崎) / "毎月1・3回目 月" 系
// → { occurrences: [1,3], days: ['MO'] }
// 意味は全都市共通で「その月 n 回目の該当曜日」(第n週ではない)。
export function parseMonthlyNthJa(text) {
  const t = normJa(text);
  const m = t.match(/^(?:毎月)?第?([\d,・]+)(?:回目)?([日月火水木金土])(?:曜日?)?$/);
  if (!m) throw new Error(`monthly_nth parse 失敗: "${text}"`);
  const occurrences = m[1].split(/[,・]/).filter(Boolean).map(Number);
  if (!occurrences.length || occurrences.some((n) => !(n >= 1 && n <= 5)))
    throw new Error(`monthly_nth parse 失敗 (回数): "${text}"`);
  return { occurrences, days: [DAY_JA[m[2]]] };
}

// 町名の正規化: 全角数字→半角、前後空白除去。それ以外は公式表記を保つ。
export const normalizeTownName = (s) => zen2han((s || '').trim());

// 町名から丁目レンジを除いた基底名 (郵便カナ読み引き用)。
// 例: 阿佐谷北1～6丁目 → 阿佐谷北 / 小倉1・2丁目 → 小倉
export const townBase = (name) =>
  normalizeTownName(name).replace(/[0-9][0-9～〜・,\s]*丁目$/, '');
