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
// monthly_nth は既定では扱わない。実日付があるなら monthly_specific で厳密に表せるためで、
// 「年末年始の休止で周期がずれる自治体では monthly_nth が成立しない」という理由も添えていた。
//
// 後者は 2026-08-14 に飯能で反証された。周期がずれるのは 1 月の 2 コースだけで、
// 残り 10 か月 × 4 コースは暦どおりの nth で成立する。少数の例外を override に落とせば
// monthly_nth で表せる。そして monthly_specific には無視できない欠点があった:
//
//   **休業の情報が落ちる。** cancelledOverrides() は「その規則で収集が発生する日」しか
//   cancelled を作らない。monthly_specific では休業日は実日付リストから抜けるだけなので、
//   「休んだ」のか「元々収集がない」のかが復元できない。実際、飯能 A-3 の 1/1 休業が
//   生成物から消えた。docs/drafts/2026-07-20-meta-rule-format-draft.md の 3 層モデルは
//   「年次パラメータ = 休業期間」を入力にする構想なので、この欠落は将来にも効く。
//
// そこで foldMonthlyNth: true で nth 畳み込みを有効にできるようにした。**既定は false** で、
// 既存 extractor の出力は 1 文字も変わらない。入間は OD 由来の独自実装を build 側に持つが
// (tools/csv-extractor/iruma)、同じ判定なのでいずれこちらへ寄せられる。

import { nthOfMonth } from './schedule.mjs';

const DOW = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
const dowOf = (iso) => new Date(iso + 'T00:00:00').getDay();
const nthOf = (iso) => nthOfMonth(new Date(iso + 'T00:00:00'));
const monthOf = (iso) => iso.slice(0, 7);

// その曜日の実収集日から「月内 n 回目」の集合を多数決で決める。
// 年末年始の繰り下げのように一部の月だけずれる場合、少数派は override へ落とす前提。
function majorityNth(ds) {
  const byMonth = new Map();
  for (const d of ds) {
    if (!byMonth.has(monthOf(d))) byMonth.set(monthOf(d), new Set());
    byMonth.get(monthOf(d)).add(nthOf(d));
  }
  const tally = new Map();
  for (const set of byMonth.values()) {
    const key = [...set].sort((a, b) => a - b).join(',');
    tally.set(key, (tally.get(key) || 0) + 1);
  }
  const best = [...tally.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
  return best.split(',').map(Number);
}

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
// foldMonthlyNth: weekly にならなかった品目を monthly_nth へ畳むか (既定 false = 従来どおり)。
// nthDeviationMax: 畳むときに許す「規則と実日付の食い違い日数」の上限 (曜日ごと)。
//   超えたら monthly_specific へ退避する。年末年始の繰り下げ程度 (数日) を通し、
//   規則がそもそも合っていない品目や抽出の系統誤りを override に化けさせないための歯止め。
//   食い違った日を override に落とすのは呼び出し側の責任 (ここは rules を決めるだけ)。
export function classifyRules({
  dates, events, catOrder, dominantMin = 6, stopTolerance = 0.1,
  foldMonthlyNth = false, nthDeviationMax = 6,
}) {
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

    if (domWd.length && (eqExact || eqMinusStop)) {
      rules.push({ category: c, pattern: 'weekly', days: domWd.map((w) => DOW[w]) });
      continue;
    }

    // monthly_nth 候補。曜日ごとに別の規則へ分ける。
    // 1 本にまとめると days × occurrences の直積に広がってしまう
    // (飯能の粗大 = 月曜 3 回目 ∪ 水曜 1 回目 を [MO,WE]×[1,3] にすると 4 通りに増える)。
    if (foldMonthlyNth) {
      const byDow = new Map();
      for (const d of ds) {
        if (!byDow.has(dowOf(d))) byDow.set(dowOf(d), []);
        byDow.get(dowOf(d)).push(d);
      }
      const cand = [];
      let deviation = 0;
      for (const [w, wds] of [...byDow.entries()].sort((a, b) => a[0] - b[0])) {
        const occ = majorityNth(wds);
        const exp = dates.filter((d) => dowOf(d) === w && occ.includes(nthOf(d)));
        const wset = new Set(wds), eset = new Set(exp);
        deviation += exp.filter((d) => !wset.has(d)).length + wds.filter((d) => !eset.has(d)).length;
        cand.push({ category: c, pattern: 'monthly_nth', days: [DOW[w]], occurrences: occ });
      }
      if (deviation <= nthDeviationMax) {
        rules.push(...cand);
        continue;
      }
    }

    rules.push({ category: c, pattern: 'monthly_specific', dates: [...ds] });
  }

  return { rules, stopDays };
}
