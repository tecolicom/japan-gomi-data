// 日付入りカレンダー (実収集日の列) → 収集規則の推定。
//
// 「日付入り通年カレンダーを持つ自治体」の extractor が共通して要る処理で、
// 以前は chofu / nishitokyo / musashino / ome に同じものが 4 つコピーされ、
// しかも下の stopTolerance の有無で挙動がずれていた (2026-08-10 に集約)。
//
// 判定は品目ごとに:
//   1. 主要曜日 (その曜日での出現が dominantMin 回以上) を求める
//   2. 「収録期間のその曜日すべて」と実収集日が一致 → weekly
//   3. 「そこから全休止日を除いたもの」と一致し、欠けが stopTolerance 以内 → weekly
//      (年末年始のような例外的休止は overrides の cancelled で表せる)
//   4. どちらでもない → monthly_specific (実日付列挙)
//
// monthly_nth は扱わない。実日付があるなら monthly_specific で厳密に表せるうえ、
// 年末年始の休止で周期がずれる自治体では monthly_nth が成立しないため
// (入間だけは OD 由来で monthly_nth に畳む独自実装を持つ — tools/csv-extractor/iruma)。

const DOW = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
const dowOf = (iso) => new Date(iso + 'T00:00:00').getDay();

// dates: 収録期間の全日付 (iso 昇順) / events: Map<iso, category[]> または {iso: category[]}
// catOrder: rules に並べる正典 category の順序 (ここに無い category は例外)
// dominantMin: その曜日での出現が何回以上なら「主要曜日」とみなすか。
//   単発の移動収集を主要曜日と誤認しないための下限。
// stopTolerance: weekly と認めるのに許す「休止で欠けた回数」の割合の上限。
//   隔週や月1回のリズム (欠け 50〜90%) を「毎週 + 大半をキャンセル」と
//   表現してしまわないための歯止め。
// events は dates を漏れなく覆っていること。収集なしの日は空配列で明示する。
// 「キーが無い日」を収集なしと解釈すると、土日を行として持たないカレンダー (調布) で
// 休止日を大量に捏造してしまうため、欠けは黙って埋めずに落とす。
export function classifyRules({ dates, events, catOrder, dominantMin = 6, stopTolerance = 0.1 }) {
  const at = (iso) => (events instanceof Map ? events.get(iso) : events[iso]);
  for (const d of dates) {
    if (at(d) === undefined) {
      throw new Error(`classifyRules: events に ${d} が無い (収集なしの日も空配列で渡すこと)`);
    }
  }
  const stopDays = dates.filter((d) => at(d).length === 0);
  const stop = new Set(stopDays);

  const catDates = new Map();
  for (const d of dates) {
    for (const c of at(d)) {
      if (!catOrder.includes(c)) throw new Error(`classifyRules: catOrder に無い category "${c}" (${d})`);
      if (!catDates.has(c)) catDates.set(c, []);
      catDates.get(c).push(d);
    }
  }

  const rules = [];
  for (const c of catOrder) {
    if (!catDates.has(c)) continue;
    const ds = catDates.get(c), dset = new Set(ds);

    const wcnt = {};
    for (const d of ds) wcnt[dowOf(d)] = (wcnt[dowOf(d)] || 0) + 1;
    const domWd = Object.entries(wcnt)
      .filter(([, k]) => k >= dominantMin).map(([w]) => Number(w)).sort();

    const weeklyExp = dates.filter((d) => domWd.includes(dowOf(d)));
    const minusStop = weeklyExp.filter((d) => !stop.has(d));
    const eqExact = ds.length === weeklyExp.length && weeklyExp.every((d) => dset.has(d));
    const eqMinusStop = ds.length === minusStop.length && minusStop.every((d) => dset.has(d))
      && weeklyExp.length - minusStop.length <= weeklyExp.length * stopTolerance;

    rules.push(domWd.length && (eqExact || eqMinusStop)
      ? { category: c, pattern: 'weekly', days: domWd.map((w) => DOW[w]) }
      : { category: c, pattern: 'monthly_specific', dates: [...ds] });
  }

  return { rules, stopDays };
}
