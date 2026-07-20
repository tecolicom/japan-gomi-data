import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseWeeklyJa, parseMonthlyNthJa, expandCsvAreas, expandHtmlAreas,
  parseCsvText, rowToRules, signatureKey,
} from './parse.mjs';

test('parseWeeklyJa: 単一と複数', () => {
  assert.deepEqual(parseWeeklyJa('水曜'), ['WE']);
  assert.deepEqual(parseWeeklyJa('月曜・木曜'), ['MO', 'TH']);
  assert.deepEqual(parseWeeklyJa('水曜･土曜'), ['WE', 'SA']); // 半角中黒
  assert.throws(() => parseWeeklyJa('毎日'), /weekly parse 失敗/);
});

test('parseMonthlyNthJa: 「その月のn回目」= 月内出現回数 (第n週ではない)', () => {
  assert.deepEqual(parseMonthlyNthJa('その月の1回目・3回目の土曜日'),
    { occurrences: [1, 3], days: ['SA'] });
  assert.deepEqual(parseMonthlyNthJa('その月の2回目・4回目の火曜日'),
    { occurrences: [2, 4], days: ['TU'] });
  assert.throws(() => parseMonthlyNthJa('第1・第3土曜日'), /monthly_nth parse 失敗/);
});

test('expandCsvAreas: 丁目の全列挙・丁目なし・読点ゆれ', () => {
  assert.deepEqual(expandCsvAreas('浅草1丁目・浅草2丁目'),
    [{ town: '浅草', chome: 1 }, { town: '浅草', chome: 2 }]);
  assert.deepEqual(expandCsvAreas('秋葉原'), [{ town: '秋葉原', chome: null }]);
  assert.deepEqual(expandCsvAreas('上野公園'), [{ town: '上野公園', chome: null }]);
  // 区側の入力ゆれ (根岸の行だけ読点が混じる)
  assert.deepEqual(expandCsvAreas('根岸1丁目、根岸2丁目・根岸3丁目'),
    [{ town: '根岸', chome: 1 }, { town: '根岸', chome: 2 }, { town: '根岸', chome: 3 }]);
});

test('expandHtmlAreas: 簡約表記の展開', () => {
  assert.deepEqual(expandHtmlAreas('浅草1・2丁目'),
    [{ town: '浅草', chome: 1 }, { town: '浅草', chome: 2 }]);
  assert.deepEqual(expandHtmlAreas('浅草3から7丁目'),
    [3, 4, 5, 6, 7].map((c) => ({ town: '浅草', chome: c })));
  assert.deepEqual(expandHtmlAreas('下谷1丁目'), [{ town: '下谷', chome: 1 }]);
  assert.deepEqual(expandHtmlAreas('秋葉原'), [{ town: '秋葉原', chome: null }]);
});

test('CSV と HTML の表記ゆれが同じ町丁集合に落ちる', () => {
  assert.deepEqual(
    expandCsvAreas('浅草3丁目・浅草4丁目・浅草5丁目・浅草6丁目・浅草7丁目'),
    expandHtmlAreas('浅草3から7丁目'));
});

test('parseCsvText: 空行を捨てる', () => {
  assert.deepEqual(parseCsvText('a,b\n1,2\n\n'), [['a', 'b'], ['1', '2']]);
});

test('rowToRules: 資源はプラスチックを含む同日5種、燃やさないは monthly_nth', () => {
  const rules = rowToRules({
    shigen: '水曜', burnable: '月曜・木曜', nonBurnable: 'その月の1回目・3回目の土曜日',
  });
  assert.deepEqual(rules.map((r) => r.category),
    ['burnable', 'non_burnable', 'paper', 'glass_bottle', 'beverage_can', 'pet_bottle', 'plastic']);
  // 資源系5種は同じ days 配列インスタンスを共有 (YAML anchor になり同日性が明示される)
  const shigen = rules.filter((r) => r.category !== 'burnable' && r.category !== 'non_burnable');
  assert.equal(new Set(shigen.map((r) => r.days)).size, 1);
  assert.deepEqual(shigen[0].days, ['WE']);
  const nb = rules.find((r) => r.category === 'non_burnable');
  assert.deepEqual(nb, { category: 'non_burnable', pattern: 'monthly_nth', occurrences: [1, 3], days: ['SA'] });
});

test('signatureKey: 日程が同じなら一致、違えば不一致', () => {
  const a = rowToRules({ shigen: '水曜', burnable: '月曜・木曜', nonBurnable: 'その月の1回目・3回目の土曜日' });
  const b = rowToRules({ shigen: '水曜', burnable: '月曜・木曜', nonBurnable: 'その月の2回目・4回目の土曜日' });
  assert.equal(signatureKey(a), signatureKey(a));
  assert.notEqual(signatureKey(a), signatureKey(b));
});
