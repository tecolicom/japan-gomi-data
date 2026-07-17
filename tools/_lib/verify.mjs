// 照合の共通部品: 期待日程との比較・確率的信頼度 (rule of three)・サンプリング。
// 方法論は docs/opendata-sources.md「検証の考え方 (確率論的な信頼度)」を参照。
import { expandFiscalYear } from './schedule.mjs';

// 生成 course と「独立ソース由来の期待日程」を通年比較する。
// expected: Map<iso, string[]> (カテゴリ集合。順序不問) / 返り値: 不一致の一覧
export function diffYear(fy, rules, overrides, expected) {
  const actual = expandFiscalYear(fy, rules, overrides);
  const keys = new Set([...actual.keys(), ...expected.keys()]);
  const diffs = [];
  for (const k of [...keys].sort()) {
    const a = new Set(actual.get(k) || []), e = new Set(expected.get(k) || []);
    const miss = [...e].filter((c) => !a.has(c));
    const extra = [...a].filter((c) => !e.has(c));
    if (miss.length || extra.length) diffs.push({ date: k, missing: miss, extra });
  }
  return diffs;
}

// rule of three: N 独立項目ゼロ不一致 → 95% 信頼での片側性誤り率上限。
// N は「1 つの誤りで壊れる最小単位」(パターン=course×種別、表の行など) で数えること。
// 展開後の日枠数を N にすると相関試行の過大評価になる。
export const ruleOfThree = (n) => 3 / n;
export const ruleOfThreePct = (n) => `${(300 / n).toPrecision(2)}%`;

// 目標上限 p* に必要なサンプル数 (照合が高コストな場合の打ち切り用)
export const sampleSizeFor = (pStar) => Math.ceil(3 / pStar);

// 決定的な層化サンプリング (Date.now/Math.random 不使用・再現可能)。
// items から n 件: 先頭・末尾 (表の端) を必ず含め、残りを等間隔に取る。
export function sampleStratified(items, n) {
  if (items.length <= n) return [...items];
  const picked = new Set([0, items.length - 1]);
  const step = (items.length - 1) / (n - 1);
  for (let i = 1; i < n - 1; i++) picked.add(Math.round(i * step));
  return [...picked].sort((a, b) => a - b).map((i) => items[i]);
}
