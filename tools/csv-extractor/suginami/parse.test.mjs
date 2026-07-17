import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseWeeklyJa, parseMonthlyNthJa, parsePdfNo, parseCsvText, townBase, rowToRules, signatureKey } from './parse.mjs';

test('parseWeeklyJa: 週2/週1', () => {
  assert.deepEqual(parseWeeklyJa('水曜日・土曜日'), ['WE', 'SA']);
  assert.deepEqual(parseWeeklyJa('月曜日・木曜日'), ['MO', 'TH']);
  assert.deepEqual(parseWeeklyJa('金曜日'), ['FR']);
});

test('parseMonthlyNthJa: 第1,3 / 第2,4 形式', () => {
  assert.deepEqual(parseMonthlyNthJa('第1,3月曜日'), { occurrences: [1, 3], days: ['MO'] });
  assert.deepEqual(parseMonthlyNthJa('第2,4水曜日'), { occurrences: [2, 4], days: ['WE'] });
  assert.deepEqual(parseMonthlyNthJa('第1,3土曜日'), { occurrences: [1, 3], days: ['SA'] });
});

test('parsePdfNo', () => {
  assert.equal(parsePdfNo('/shared/garbage/12.pdf'), 12);
  assert.equal(parsePdfNo('/shared/garbage/1.pdf'), 1);
});

test('parseCsvText: 引用内カンマ (第1,3 が割れない)', () => {
  const rows = parseCsvText('"a","第1,3月曜日","c"\n');
  assert.deepEqual(rows, [['a', '第1,3月曜日', 'c']]);
});

test('townBase: 丁目除去 (全角数字も)', () => {
  assert.equal(townBase('阿佐谷北1～6丁目'), '阿佐谷北');
  assert.equal(townBase('井草4・5丁目'), '井草');
  assert.equal(townBase('和泉1丁目'), '和泉');
  assert.equal(townBase('永福1～４丁目'), '永福'); // 全角４
  assert.equal(townBase('宮前1・4・5丁目'), '宮前');
});

test('rowToRules: 同日グループは days 共有 (7 rule)', () => {
  const rules = rowToRules({
    burnable: '火曜日・金曜日', nonBurnable: '第2,4水曜日',
    binKanPla: '木曜日', paperPet: '水曜日',
  });
  assert.equal(rules.length, 7);
  const pla = rules.find((r) => r.category === 'plastic');
  const bin = rules.find((r) => r.category === 'glass_bottle');
  const can = rules.find((r) => r.category === 'beverage_can');
  const paper = rules.find((r) => r.category === 'paper');
  const pet = rules.find((r) => r.category === 'pet_bottle');
  assert.equal(pla.days, bin.days); // 同一オブジェクト → YAML anchor
  assert.equal(bin.days, can.days);
  assert.equal(paper.days, pet.days);
  assert.deepEqual(bin.days, ['TH']);
  assert.deepEqual(paper.days, ['WE']);
  assert.deepEqual(rules.find((r) => r.category === 'non_burnable'),
    { category: 'non_burnable', pattern: 'monthly_nth', occurrences: [2, 4], days: ['WE'] });
});

test('signatureKey: 同一日程は同一キー', () => {
  const a = { burnable: '水曜日・土曜日', nonBurnable: '第1,3木曜日', binKanPla: '火曜日', paperPet: '木曜日' };
  assert.equal(signatureKey(rowToRules(a)), signatureKey(rowToRules({ ...a })));
});
