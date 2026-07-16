import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseWeeklyJa, parseMonthlyNthJa, parseCsvText, chomeKey, rowToRules, signatureKey } from './parse.mjs';

test('parseWeeklyJa: CSV/HTML 両形式', () => {
  assert.deepEqual(parseWeeklyJa('木曜日'), ['TH']);
  assert.deepEqual(parseWeeklyJa('火曜日;金曜日'), ['TU', 'FR']);
  assert.deepEqual(parseWeeklyJa('火曜日・金曜日'), ['TU', 'FR']);
  assert.deepEqual(parseWeeklyJa('火曜日・金曜日　　　'), ['TU', 'FR']); // 公式 HTML の全角空白パディング
});

test('parseMonthlyNthJa: CSV/HTML 両形式', () => {
  assert.deepEqual(parseMonthlyNthJa('第2;第4土曜日'), { occurrences: [2, 4], days: ['SA'] });
  assert.deepEqual(parseMonthlyNthJa('第1・第3月曜日'), { occurrences: [1, 3], days: ['MO'] });
  assert.deepEqual(parseMonthlyNthJa('第2・第4土曜日　　　　'), { occurrences: [2, 4], days: ['SA'] });
});

test('parseCsvText: 引用内カンマ', () => {
  const rows = parseCsvText('"a","b,c","d"\n"1","2","3"\n');
  assert.deepEqual(rows, [['a', 'b,c', 'd'], ['1', '2', '3']]);
});

test('chomeKey: 漢数字/算用数字/全域の正規化', () => {
  assert.equal(chomeKey('一・二・四・五丁目'), '1;2;4;5');
  assert.equal(chomeKey('1;2;4;5'), '1;2;4;5');
  assert.equal(chomeKey('全域'), '全域');
  assert.equal(chomeKey('二・三・五丁目（毎日収集地域は除く）'), '2;3;5');
});

test('rowToRules: びん・缶・ペットは days を共有', () => {
  const rules = rowToRules({
    burnable: '火曜日;金曜日', nonBurnable: '第2;第4土曜日',
    plastic: '木曜日', binCan: '金曜日',
  });
  assert.equal(rules.length, 6);
  const bin = rules.find((r) => r.category === 'glass_bottle');
  const can = rules.find((r) => r.category === 'beverage_can');
  const pet = rules.find((r) => r.category === 'pet_bottle');
  assert.equal(bin.days, can.days); // 同一オブジェクト → YAML anchor
  assert.equal(bin.days, pet.days);
  assert.deepEqual(bin.days, ['FR']);
  assert.deepEqual(rules.find((r) => r.category === 'non_burnable'),
    { category: 'non_burnable', pattern: 'monthly_nth', occurrences: [2, 4], days: ['SA'] });
});

test('signatureKey: 同一日程は同一キー', () => {
  const row = { burnable: '水曜日;土曜日', nonBurnable: '第2;第4木曜日', plastic: '金曜日', binCan: '火曜日' };
  assert.equal(signatureKey(rowToRules(row)), signatureKey(rowToRules({ ...row })));
});
