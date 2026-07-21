// 岡山市 収集曜日セルの日本語表記パーサ。
// 4 フィールドとも同じ文法で書かれる:
//   可燃/プラ資源  = 曜日のみ (weekly)         例 "火・金" / "月" / "月・木"(犬島)
//   不燃           = 「N曜」(monthly_nth 1日)   例 "３水" / "１金"
//   資源化物       = 「N曜」「N.M曜」「N曜・M曜'」等の複合 例
//     "２．４水"(=水 第2,4) / "１火・３金"(=火第1+金第3) / "１金, １．３水"(=金第1+水第1,3) /
//     "２木・４月"(=木第2+月第4) / "２水・４水"(=水第2+水第4=水第2,4)
//
// 汎用トークナイザ: 数字を貯め、曜日字が来たら (貯めた回数集合, その曜日) を 1 項として確定して数字をリセット。
//   区切り字 (・．. , 、 空白) は読み飛ばす。曜日が来ない末尾数字・未知文字は throw (黙って落とさない)。
//   回数が空の項 = weekly の曜日。回数がある項 = monthly_nth。同一曜日の回数はマージする。

export const DAY_JA = { 日: 'SU', 月: 'MO', 火: 'TU', 水: 'WE', 木: 'TH', 金: 'FR', 土: 'SA' };
export const DAY_INDEX = { MO: 0, TU: 1, WE: 2, TH: 3, FR: 4, SA: 5, SU: 6 };
const SEP = new Set(['・', '．', '.', ',', '，', '、', '　', ' ']);

export const zen2han = (s) => (s || '')
  .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));

// テキスト -> 項配列 [{ occs:number[], day:'MO'.. }]。occs 空 = weekly の曜日。
export function parseTerms(text) {
  const t = zen2han(text);
  const terms = [];
  let occs = [];
  for (const ch of t) {
    if (ch >= '0' && ch <= '9') { occs.push(Number(ch)); continue; }
    if (DAY_JA[ch]) { terms.push({ occs: occs.slice(), day: DAY_JA[ch] }); occs = []; continue; }
    if (SEP.has(ch)) continue;
    throw new Error(`未知の文字 ${JSON.stringify(ch)} in ${JSON.stringify(text)}`);
  }
  if (occs.length) throw new Error(`曜日を伴わない数字 in ${JSON.stringify(text)}`);
  if (!terms.length) throw new Error(`曜日が無い: ${JSON.stringify(text)}`);
  for (const { occs: o } of terms)
    if (o.some((n) => n < 1 || n > 5)) throw new Error(`回数が範囲外(1-5) in ${JSON.stringify(text)}`);
  return terms;
}

// テキスト -> rule 断片配列 [{pattern, days, occurrences?}]。
// weekly は全曜日を 1 断片に、monthly は曜日ごとに回数をマージして 1 断片に。
export function parseFragments(text) {
  const terms = parseTerms(text);
  const weeklyDays = [];
  const monthlyByDay = new Map();
  for (const { occs, day } of terms) {
    if (occs.length === 0) { if (!weeklyDays.includes(day)) weeklyDays.push(day); }
    else {
      if (!monthlyByDay.has(day)) monthlyByDay.set(day, new Set());
      for (const o of occs) monthlyByDay.get(day).add(o);
    }
  }
  const frags = [];
  if (weeklyDays.length) {
    weeklyDays.sort((a, b) => DAY_INDEX[a] - DAY_INDEX[b]);
    frags.push({ pattern: 'weekly', days: weeklyDays });
  }
  // monthly は曜日を週内順に、回数昇順で安定化
  for (const day of [...monthlyByDay.keys()].sort((a, b) => DAY_INDEX[a] - DAY_INDEX[b])) {
    frags.push({ pattern: 'monthly_nth', days: [day], occurrences: [...monthlyByDay.get(day)].sort((a, b) => a - b) });
  }
  return frags;
}

// フィールドが想定パターンかを検証して断片を返す。expect: 'weekly' | 'monthly_nth'
export function fragmentsExpecting(text, expect, fieldName) {
  const frags = parseFragments(text);
  for (const f of frags)
    if (f.pattern !== expect)
      throw new Error(`${fieldName} は ${expect} を期待したが ${f.pattern} を検出: ${JSON.stringify(text)}`);
  return frags;
}
