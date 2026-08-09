// course YAML の rules/overrides → 実収集日への展開 (正典実装)。
// city.tecoli の src/lib/gomi-schedule.ts categoriesOn() と等価。
// build-ics と各 extractor の verify がこれを共有する (照合と配信で同じ解釈を保証)。

import { DAY_TO_INDEX } from './jp.mjs';

export const pad2 = (n) => String(n).padStart(2, '0');
export const isoDate = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
export const iso = (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v));
// その月 n 回目の該当曜日 (第n週ではない)
export const nthOfMonth = (d) => Math.floor((d.getDate() - 1) / 7) + 1;

// その日に収集されるカテゴリ一覧。
export function categoriesOn(date, rules, overrides) {
  const key = isoDate(date), dow = date.getDay(), occ = nthOfMonth(date);
  const weekly = new Set(), monthly = new Set();
  for (const r of rules) {
    const matchedDay = r.days?.some((d) => DAY_TO_INDEX[d] === dow);
    if (r.pattern === 'weekly' && matchedDay) weekly.add(r.category);
    else if (r.pattern === 'monthly_nth' && matchedDay && r.occurrences?.includes(occ)) monthly.add(r.category);
    else if (r.pattern === 'monthly_specific' && (r.dates || []).map(iso).includes(key)) monthly.add(r.category);
  }
  const ovs = (overrides || []).filter((o) => iso(o.date) === key);
  if (ovs.some((o) => o.cancelled)) return [];
  if (ovs.length === 0) return [...weekly, ...monthly];
  const final = new Set(weekly);
  for (const o of ovs) if (o.category) final.add(o.category);
  return [...final];
}

// 収録期間の表記 "YYYY-MM--YYYY-MM" (月単位の閉区間)。
// ディレクトリ名と course の metadata.period に同じ文字列を使う。
// 会計年度を仮定しない: 4月起点も10月起点も暦年も半期もそのまま表せる。
export const PERIOD_RE = /^(\d{4})-(\d{2})--(\d{4})-(\d{2})$/;

// "2026-04--2027-03" → { from: '2026-04', to: '2027-03' } / 不正なら null
export function parsePeriod(name) {
  const m = PERIOD_RE.exec(String(name));
  return m ? { from: `${m[1]}-${m[2]}`, to: `${m[3]}-${m[4]}` } : null;
}

// 期間の両端を Date に (end は「to の翌月 1 日」= 排他)
function periodBounds(period) {
  const p = typeof period === 'string' ? parsePeriod(period) : period;
  if (!p) throw new Error(`不正な期間表記: ${period}`);
  const [fy, fm] = p.from.split('-').map(Number);
  const [ty, tm] = p.to.split('-').map(Number);
  if (!(fy && fm && ty && tm) || `${p.to}` < `${p.from}`) throw new Error(`不正な期間: ${p.from}--${p.to}`);
  return { start: new Date(fy, fm - 1, 1), end: new Date(ty, tm, 1) };
}

// その日が unknown_periods (収集の有無が不明な区間) に入るか。
// 「休止」ではなく「一次ソースが裏付けない」の意。展開結果に載せない。
export function isUnknown(isoKey, unknownPeriods) {
  return (unknownPeriods || []).some((u) => iso(u.from) <= isoKey && isoKey <= iso(u.to));
}

// 収録期間を日毎に展開: Map<iso, string[]>
// (収集なしの日と unknown_periods 内の日は載せない)
export function expandRange(period, rules, overrides, unknownPeriods) {
  const { start, end } = periodBounds(period);
  const out = new Map();
  for (let d = new Date(start); d < end; d = new Date(d.getTime() + 86400000)) {
    const key = isoDate(d);
    if (isUnknown(key, unknownPeriods)) continue;
    const cats = categoriesOn(d, rules, overrides);
    if (cats.length) out.set(key, cats);
  }
  return out;
}

// rules の同一性キー (同一日程の町を 1 コースへ畳むのに使う)
export const signatureKey = (rules) =>
  rules.map((r) => `${r.category}:${(r.days || []).join('')}:${(r.occurrences || []).join('')}:${(r.dates || []).map(iso).join('')}`).join('|');

// 指定日のうち「その rules で収集が発生する日」だけ cancelled override を作る (年末年始休止用)
export function cancelledOverrides(rules, isoDates, note) {
  const out = [];
  for (const key of isoDates) {
    const d = new Date(key + 'T00:00:00');
    if (categoriesOn(d, rules, []).length) out.push({ date: key, cancelled: true, note });
  }
  return out;
}
