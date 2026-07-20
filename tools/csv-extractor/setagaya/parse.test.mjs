import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseWeekly, parseMonthlyNth, parseChome, parseCsvText,
  parseAreaLabel, areaKey, rowAreaKey, areaName, rowToRules, norm,
} from './parse.mjs';

test('parseWeekly: CSV 形式と HTML 表形式の両方', () => {
  assert.deepEqual(parseWeekly('木曜日'), ['TH']);
  assert.deepEqual(parseWeekly('水曜日・土曜日'), ['WE', 'SA']); // CSV
  assert.deepEqual(parseWeekly('水・土曜日'), ['WE', 'SA']);     // 416.html の表
  assert.deepEqual(parseWeekly('　月・木曜日 '), ['MO', 'TH']);  // 全角空白パディング
  assert.throws(() => parseWeekly('隔週'), /weekly parse 失敗/);
});

test('parseMonthlyNth: 「n回目の×曜日」の CSV/HTML 表記ゆれ', () => {
  assert.deepEqual(parseMonthlyNth('2回目・4回目の月曜日'), { occurrences: [2, 4], days: ['MO'] }); // CSV
  assert.deepEqual(parseMonthlyNth('2・4回目の月曜日'), { occurrences: [2, 4], days: ['MO'] });     // HTML
  assert.deepEqual(parseMonthlyNth('1回目・3回目の土曜日'), { occurrences: [1, 3], days: ['SA'] });
  assert.throws(() => parseMonthlyNth('毎週月曜日'), /monthly_nth parse 失敗/);
});

test('parseChome: 列挙・レンジ・空欄 (公園)', () => {
  assert.deepEqual(parseChome('1・2'), [1, 2]);
  assert.deepEqual(parseChome('1〜3'), [1, 2, 3]);      // CSV の波ダッシュ U+301C
  assert.deepEqual(parseChome('1～3'), [1, 2, 3]);      // HTML の全角チルダ U+FF5E
  assert.deepEqual(parseChome('1・3〜5'), [1, 3, 4, 5]);
  assert.deepEqual(parseChome('1・2・5〜7'), [1, 2, 5, 6, 7]);
  assert.deepEqual(parseChome(''), []);                 // 砧公園・駒沢公園
  assert.throws(() => parseChome('全域'), /丁目 parse 失敗/);
});

test('parseAreaLabel: カレンダーページの見出しを町名+丁目に分解', () => {
  assert.deepEqual(parseAreaLabel('大蔵5～6丁目'), { town: '大蔵', chome: [5, 6] });
  assert.deepEqual(parseAreaLabel('北烏山2・4～9丁目'), { town: '北烏山', chome: [2, 4, 5, 6, 7, 8, 9] });
  assert.deepEqual(parseAreaLabel('砧公園'), { town: '砧公園', chome: [] });
});

test('areaKey: CSV 行と PDF 見出しで表記が違っても同じキーになる', () => {
  // CSV は「5・6」、カレンダーページの見出しは「5～6丁目」
  const row = { town: '大蔵', chome: '5・6' };
  assert.equal(rowAreaKey(row), areaKey(parseAreaLabel('大蔵5～6丁目')));
  assert.equal(rowAreaKey({ town: '砧公園', chome: '' }), areaKey(parseAreaLabel('砧公園')));
});

test('areaName: 表示名は CSV の丁目表記を保つ / 公園は町名のみ', () => {
  assert.equal(areaName({ town: '赤堤', chome: '1・3〜5' }), '赤堤1・3〜5丁目');
  assert.equal(areaName({ town: '砧公園', chome: '' }), '砧公園');
});

test('parseCsvText: 引用内カンマ', () => {
  assert.deepEqual(parseCsvText('"a","b,c","d"\n"1","2","3"\n'), [['a', 'b,c', 'd'], ['1', '2', '3']]);
});

test('rowToRules: 資源 (古紙・びん・缶) は days を共有し、ペットは別日の monthly_nth', () => {
  const rules = rowToRules({
    shigen: '木曜日', burnable: '水曜日・土曜日',
    nonBurnable: '2回目・4回目の月曜日', pet: '1回目・3回目の月曜日',
  });
  assert.equal(rules.length, 6);
  const paper = rules.find((r) => r.category === 'paper');
  const bin = rules.find((r) => r.category === 'glass_bottle');
  const can = rules.find((r) => r.category === 'beverage_can');
  assert.equal(paper.days, bin.days); // 同一オブジェクト → YAML anchor になる
  assert.equal(paper.days, can.days);
  assert.deepEqual(paper.days, ['TH']);

  const pet = rules.find((r) => r.category === 'pet_bottle');
  assert.equal(pet.pattern, 'monthly_nth');
  assert.deepEqual(pet.occurrences, [1, 3]);
  assert.deepEqual(pet.days, ['MO']);

  const nb = rules.find((r) => r.category === 'non_burnable');
  assert.deepEqual(nb.occurrences, [2, 4]);
  // 不燃とペットは同じ曜日の別の回 (世田谷の典型パターン)
  assert.deepEqual(nb.days, pet.days);
});

test('norm: 波ダッシュ・全角チルダ・全角数字を正規化', () => {
  assert.equal(norm('１・３〜５'), '1・3~5');
  assert.equal(norm('1・3～5'), '1・3~5');
});
