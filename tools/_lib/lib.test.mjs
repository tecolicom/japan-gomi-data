// _lib の回帰テスト。ケースは収録済み自治体の実表記から採る。
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseWeeklyJa, parseMonthlyNthJa, townBase, normalizeTownName } from './jp.mjs';
import { categoriesOn, expandRange, parsePeriod, isUnknown, nthOfMonth, cancelledOverrides } from './schedule.mjs';
import { foldCourses, courseDoc } from './emit.mjs';
import { diffRange, ruleOfThreePct, sampleSizeFor, sampleStratified } from './verify.mjs';
import { classifyRules } from './classify.mjs';
import { periodDates } from './schedule.mjs';

test('parseWeeklyJa: 実在表記', () => {
  assert.deepEqual(parseWeeklyJa('水曜日・土曜日'), ['WE', 'SA']); // 杉並
  assert.deepEqual(parseWeeklyJa('月曜・木曜'), ['MO', 'TH']);     // 川崎
  assert.deepEqual(parseWeeklyJa('金曜'), ['FR']);                 // 川崎
  assert.deepEqual(parseWeeklyJa('月・木'), ['MO', 'TH']);         // 練馬系
  assert.deepEqual(parseWeeklyJa('土'), ['SA']);
  assert.throws(() => parseWeeklyJa('毎日'));
});

test('parseMonthlyNthJa: 実在表記', () => {
  assert.deepEqual(parseMonthlyNthJa('第1,3月曜日'), { occurrences: [1, 3], days: ['MO'] });   // 杉並
  assert.deepEqual(parseMonthlyNthJa('第2・4回目 火曜'), { occurrences: [2, 4], days: ['TU'] }); // 川崎
  assert.deepEqual(parseMonthlyNthJa('第２・４回目　火曜'), { occurrences: [2, 4], days: ['TU'] }); // 全角
  assert.deepEqual(parseMonthlyNthJa('毎月1・3回目 月'), { occurrences: [1, 3], days: ['MO'] }); // 川崎PDF下表
  assert.throws(() => parseMonthlyNthJa('第6水曜日'));
});

test('townBase / normalizeTownName', () => {
  assert.equal(townBase('阿佐谷北1～6丁目'), '阿佐谷北');
  assert.equal(townBase('小倉1・2丁目'), '小倉');
  assert.equal(townBase('浅田'), '浅田');
  assert.equal(normalizeTownName('永福１～４丁目'), '永福1～4丁目');
});

test('categoriesOn: nth は「その月 n 回目の該当曜日」', () => {
  // 2026-08-03 は 8 月 1 回目の月曜。第1・3 月曜の rules で収集あり。
  const rules = [{ category: 'metal', pattern: 'monthly_nth', occurrences: [1, 3], days: ['MO'] }];
  assert.deepEqual(categoriesOn(new Date(2026, 7, 3), rules, []), ['metal']);
  assert.deepEqual(categoriesOn(new Date(2026, 7, 10), rules, []), []); // 2 回目
  assert.equal(nthOfMonth(new Date(2026, 7, 31)), 5);
});

test('categoriesOn: overrides cancelled が優先', () => {
  const rules = [{ category: 'burnable', pattern: 'weekly', days: ['TH'] }];
  const ov = [{ date: '2027-01-01', cancelled: true }]; // 2027-01-01 は金曜ではなく…木曜? → 曜日に依らず検査
  assert.deepEqual(categoriesOn(new Date(2027, 0, 1), rules, ov), []);
});

test('parsePeriod: 期間表記', () => {
  assert.deepEqual(parsePeriod('2026-04--2027-03'), { from: '2026-04', to: '2027-03' });
  assert.deepEqual(parsePeriod('2025-10--2026-09'), { from: '2025-10', to: '2026-09' }); // 西東京 (10月起点)
  assert.deepEqual(parsePeriod('2026-01--2026-12'), { from: '2026-01', to: '2026-12' }); // 川口 (暦年)
  assert.equal(parsePeriod('2026'), null);
  assert.equal(parsePeriod('2026-04'), null);
});

test('expandRange: 期間の外へはみ出さない', () => {
  const rules = [{ category: 'burnable', pattern: 'weekly', days: ['MO', 'TH'] }];
  // 川口型: 暦年ソース。2027 年へ外挿してはならない
  const keys = [...expandRange('2026-01--2026-12', rules, []).keys()];
  assert.equal(keys[0], '2026-01-01');
  assert.equal(keys.at(-1), '2026-12-31');
  assert.equal(keys.some((k) => k.startsWith('2027')), false);
  // 会計年度型は年をまたぐ
  const fy = [...expandRange('2026-04--2027-03', rules, []).keys()];
  assert.equal(fy[0], '2026-04-02'); // 4/1 は水曜
  assert.equal(fy.at(-1), '2027-03-29');
});

test('expandRange + diffRange: 一致で差分ゼロ', () => {
  const rules = [{ category: 'burnable', pattern: 'weekly', days: ['MO', 'TH'] }];
  const P = '2026-04--2027-03';
  const expected = expandRange(P, rules, []);
  assert.equal(diffRange(P, rules, [], expected).length, 0);
  // 1 日欠けを注入すると検出される
  const broken = new Map(expected);
  broken.delete([...expected.keys()][0]);
  assert.equal(diffRange(P, rules, [], broken).length, 1);
});

test('unknown_periods: 不明区間は収集日を生成しない', () => {
  // 朝霞型: 市は「年末年始を除く」と明記するが実日付は12月に別途告知 → 断定しない
  const rules = [{ category: 'burnable', pattern: 'weekly', days: ['MO', 'TH', 'FR'] }];
  const unk = [{ from: '2026-12-30', to: '2027-01-03', reason: '年末年始の実日付は別途告知' }];
  assert.equal(isUnknown('2027-01-01', unk), true);
  assert.equal(isUnknown('2026-12-29', unk), false); // 区間の外
  const got = expandRange('2026-04--2027-03', rules, [], unk);
  for (const d of ['2026-12-30', '2026-12-31', '2027-01-01']) assert.equal(got.has(d), false);
  assert.equal(got.has('2026-12-28'), true); // 月曜。区間の直前は生成される
  assert.equal(got.has('2027-01-04'), true); // 月曜。区間の直後も生成される
  // 不明区間内の expected は照合対象外 (欠落と数えない)。
  // ソースが不明区間の収集を主張しても、こちらは生成しないので差分にしない。
  const expected = new Map(got);
  expected.set('2027-01-01', ['burnable']);
  assert.equal(diffRange('2026-04--2027-03', rules, [], expected, unk).length, 0);
  // 不明区間の外の食い違いはちゃんと検出する
  const off = new Map(got);
  off.delete('2027-01-04');
  assert.equal(diffRange('2026-04--2027-03', rules, [], off, unk).length, 1);
});

test('cancelledOverrides: 収集が発生する日だけ生成', () => {
  const rules = [{ category: 'burnable', pattern: 'weekly', days: ['FR'] }];
  // 2027-01-01 は金曜 → 対象。01-02(土)・01-03(日) は非対象。
  const ov = cancelledOverrides(rules, ['2027-01-01', '2027-01-02', '2027-01-03'], '年末年始');
  assert.deepEqual(ov.map((o) => o.date), ['2027-01-01']);
});

test('foldCourses: 同一日程を 1 コースへ', () => {
  const rows = [
    { town: 'A', d: '月・木' }, { town: 'B', d: '月・木' }, { town: 'C', d: '火・金' },
  ];
  const folded = foldCourses(rows,
    (r) => [{ category: 'burnable', pattern: 'weekly', days: parseWeeklyJa(r.d) }],
    (r) => ({ name: r.town }));
  assert.equal(folded.length, 2);
  assert.deepEqual(folded[0].areas.map((a) => a.name), ['A', 'B']);
});

test('courseDoc: metadata のフィールド順が既存収録と同じ', () => {
  const doc = courseDoc({
    city: 'x', course: '1', areas: [{ name: 'A' }], period: '2026-04--2027-03',
    source: { source_url: 'u', extracted_at: '2026-07-17', edition_ja: '令和8年度版' },
    rules: [], overrides: [],
  });
  assert.deepEqual(Object.keys(doc.metadata), ['city', 'course', 'areas', 'period', 'source']);
  // period が不正なら書き出す前に落とす (ディレクトリ名と乖離させない)
  assert.throws(() => courseDoc({ city: 'x', course: '1', period: '2026', source: {}, rules: [] }));
});

test('verify の確率部品', () => {
  assert.equal(ruleOfThreePct(112), '2.7%');
  assert.equal(sampleSizeFor(0.05), 60);
  const s = sampleStratified([...Array(100).keys()], 10);
  assert.equal(s.length, 10);
  assert.equal(s[0], 0);
  assert.equal(s.at(-1), 99);
});

test('periodDates: 収録期間を日毎に列挙する', () => {
  const d = periodDates('2026-04--2027-03');
  assert.equal(d.length, 365);
  assert.equal(d[0], '2026-04-01');
  assert.equal(d.at(-1), '2027-03-31');
  // 10月起点も暦年も同じ形で表せる
  assert.equal(periodDates('2025-10--2026-09').length, 365);
  assert.equal(periodDates('2026-01--2026-12').length, 365);
});

test('classifyRules: 毎週は weekly、隔週は monthly_specific', () => {
  const dates = periodDates('2026-04--2027-03');
  const events = {};
  for (const d of dates) events[d] = [];
  const dow = (iso) => new Date(iso + 'T00:00:00').getDay();
  // burnable: 毎週月曜 / glass_bottle: 隔週月曜 (月内 1・3 回目)
  const mondays = dates.filter((d) => dow(d) === 1);
  for (const d of mondays) events[d].push('burnable');
  for (const d of mondays.filter((d) => [1, 3].includes(Math.floor((Number(d.slice(8)) - 1) / 7) + 1)))
    events[d].push('glass_bottle');
  const { rules, stopDays } = classifyRules({ dates, events, catOrder: ['burnable', 'glass_bottle'] });
  assert.deepEqual(rules[0], { category: 'burnable', pattern: 'weekly', days: ['MO'] });
  assert.equal(rules[1].pattern, 'monthly_specific');
  assert.equal(stopDays.length, dates.length - mondays.length);
});

test('classifyRules: 年末年始だけ欠ける品目は weekly + 休止日を返す', () => {
  const dates = periodDates('2026-04--2027-03');
  const events = {};
  for (const d of dates) events[d] = [];
  const dow = (iso) => new Date(iso + 'T00:00:00').getDay();
  const stop = new Set(['2027-01-01']);
  for (const d of dates) if (dow(d) === 5 && !stop.has(d)) events[d].push('burnable');
  const { rules, stopDays } = classifyRules({ dates, events, catOrder: ['burnable'] });
  assert.deepEqual(rules[0], { category: 'burnable', pattern: 'weekly', days: ['FR'] });
  assert.ok(stopDays.includes('2027-01-01'));
});

test('classifyRules: 隔週を「毎週+半分キャンセル」と表現しない (歯止め)', () => {
  // その曜日に「収集あり/何も無い」が交互に来る配置。歯止めが無いと weekly と誤判定する
  const dates = periodDates('2026-04--2027-03');
  const events = {};
  for (const d of dates) events[d] = [];
  const dow = (iso) => new Date(iso + 'T00:00:00').getDay();
  const weds = dates.filter((d) => dow(d) === 3);
  weds.forEach((d, i) => { if (i % 2 === 0) events[d].push('non_burnable'); });
  const strict = classifyRules({ dates, events, catOrder: ['non_burnable'] });
  assert.equal(strict.rules[0].pattern, 'monthly_specific');
  // 歯止めを外せば weekly になってしまうこと自体は確認しておく (回帰の意図を明示)
  const loose = classifyRules({ dates, events, catOrder: ['non_burnable'], stopTolerance: 1 });
  assert.equal(loose.rules[0].pattern, 'weekly');
});

// 飯能 A-2 の金曜と同じ形: 1・3 回目にペット / 2・4 回目に缶。
// 1/1 が休業でその後 1 週ずつ繰り下がり、1 月だけ 2・4 回目 (缶は 3・5 回目) になる。
function hannoA2Fridays(cat, baseOcc, janOcc) {
  const dates = periodDates('2026-04--2027-03');
  const events = Object.fromEntries(dates.map((d) => [d, []]));
  const nth = (iso) => Math.floor((Number(iso.slice(8)) - 1) / 7) + 1;
  for (const d of dates) {
    if (new Date(d + 'T00:00:00').getDay() !== 5) continue;
    const occ = d.startsWith('2027-01') ? janOcc : baseOcc;
    if (occ.includes(nth(d)) && d !== '2027-01-01') events[d].push(cat);
  }
  return { dates, events };
}

test('classifyRules: foldMonthlyNth は既定 off (既存 extractor の出力を変えない)', () => {
  const { dates, events } = hannoA2Fridays('pet_bottle', [1, 3], [2, 4]);
  const { rules } = classifyRules({ dates, events, catOrder: ['pet_bottle'] });
  assert.equal(rules[0].pattern, 'monthly_specific');
});

test('classifyRules: foldMonthlyNth は少数の例外月があっても monthly_nth に畳む', () => {
  const { dates, events } = hannoA2Fridays('pet_bottle', [1, 3], [2, 4]);
  const { rules } = classifyRules({ dates, events, catOrder: ['pet_bottle'], foldMonthlyNth: true });
  assert.equal(rules.length, 1);
  assert.equal(rules[0].pattern, 'monthly_nth');
  assert.deepEqual(rules[0].days, ['FR']);
  assert.deepEqual(rules[0].occurrences, [1, 3]); // 11 か月の多数決。1 月は呼び出し側が override に落とす
});

test('classifyRules: foldMonthlyNth でも食い違いが多すぎれば monthly_specific へ退避', () => {
  // 隔月で 1・3 回目 ↔ 2・4 回目 が入れ替わる形。規則 1 本では説明できない
  const dates = periodDates('2026-04--2027-03');
  const events = Object.fromEntries(dates.map((d) => [d, []]));
  const nth = (iso) => Math.floor((Number(iso.slice(8)) - 1) / 7) + 1;
  for (const d of dates) {
    if (new Date(d + 'T00:00:00').getDay() !== 5) continue;
    const occ = Number(d.slice(5, 7)) % 2 === 0 ? [1, 3] : [2, 4];
    if (occ.includes(nth(d))) events[d].push('pet_bottle');
  }
  const { rules } = classifyRules({ dates, events, catOrder: ['pet_bottle'], foldMonthlyNth: true });
  assert.equal(rules[0].pattern, 'monthly_specific');
});

test('classifyRules: foldMonthlyNth は曜日ごとに規則を分ける (直積に広げない)', () => {
  // 飯能の粗大と同じ形: 月曜 3 回目 ∪ 水曜 1 回目
  const dates = periodDates('2026-04--2027-03');
  const events = Object.fromEntries(dates.map((d) => [d, []]));
  const nth = (iso) => Math.floor((Number(iso.slice(8)) - 1) / 7) + 1;
  for (const d of dates) {
    const w = new Date(d + 'T00:00:00').getDay();
    if ((w === 1 && nth(d) === 3) || (w === 3 && nth(d) === 1)) events[d].push('oversized');
  }
  const { rules } = classifyRules({ dates, events, catOrder: ['oversized'], foldMonthlyNth: true });
  assert.equal(rules.length, 2);
  assert.deepEqual(rules.map((r) => [r.days[0], r.occurrences]), [['MO', [3]], ['WE', [1]]]);
});

test('classifyRules: catOrder に無い category は落とす', () => {
  const dates = periodDates('2026-04--2027-03');
  const events = Object.fromEntries(dates.map((d) => [d, []]));
  events['2026-04-01'] = ['unknown_cat'];
  assert.throws(() => classifyRules({ dates, events, catOrder: ['burnable'] }), /catOrder に無い/);
});

test('classifyRules: events が期間を覆っていなければ落とす', () => {
  // 土日の行を持たないカレンダー (調布) を素朴に渡すと、欠けを「収集なし」と解釈して
  // ありもしない休止日を捏造してしまう。黙って埋めずエラーにする。
  const dates = periodDates('2026-04--2027-03');
  const sparse = new Map();
  for (const d of dates) if (new Date(d + 'T00:00:00').getDay() !== 0) sparse.set(d, []);
  assert.throws(() => classifyRules({ dates, events: sparse, catOrder: ['burnable'] }),
    /events に .* が無い/);
});
