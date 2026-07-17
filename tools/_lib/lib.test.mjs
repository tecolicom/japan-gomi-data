// _lib の回帰テスト。ケースは収録済み自治体の実表記から採る。
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseWeeklyJa, parseMonthlyNthJa, townBase, normalizeTownName } from './jp.mjs';
import { categoriesOn, expandFiscalYear, nthOfMonth, signatureKey, cancelledOverrides } from './schedule.mjs';
import { foldCourses, courseDoc } from './emit.mjs';
import { diffYear, ruleOfThreePct, sampleSizeFor, sampleStratified } from './verify.mjs';

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

test('expandFiscalYear + diffYear: 一致で差分ゼロ', () => {
  const rules = [{ category: 'burnable', pattern: 'weekly', days: ['MO', 'TH'] }];
  const expected = expandFiscalYear(2026, rules, []);
  assert.equal(diffYear(2026, rules, [], expected).length, 0);
  // 1 日欠けを注入すると検出される
  const broken = new Map(expected);
  broken.delete([...expected.keys()][0]);
  assert.equal(diffYear(2026, rules, [], broken).length, 1);
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
    city: 'x', course: '1', areas: [{ name: 'A' }], year: 2026, fiscalYearJa: '令和8年度',
    source: { source_url: 'u', extracted_at: '2026-07-17' },
    rules: [], overrides: [],
  });
  assert.deepEqual(Object.keys(doc.metadata), ['city', 'course', 'areas', 'year', 'fiscal_year_ja', 'source']);
});

test('verify の確率部品', () => {
  assert.equal(ruleOfThreePct(112), '2.7%');
  assert.equal(sampleSizeFor(0.05), 60);
  const s = sampleStratified([...Array(100).keys()], 10);
  assert.equal(s.length, 10);
  assert.equal(s[0], 0);
  assert.equal(s.at(-1), 99);
});
