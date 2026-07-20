// 品川区パーサの単体テスト (実データに現れた全表記を網羅)。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCollectionDay, areaToRules, CATEGORY_MAP } from './parse.mjs';
import { parseHtmlDay, parseChome } from './parse-html.mjs';
import { parseDayUri } from './parse-rdf.mjs';

test('parseCollectionDay: 毎週 (単/複)', () => {
  assert.deepEqual(parseCollectionDay('土'), { pattern: 'weekly', days: ['SA'] });
  assert.deepEqual(parseCollectionDay('火・金'), { pattern: 'weekly', days: ['TU', 'FR'] });
  assert.deepEqual(parseCollectionDay('月・水・金'), { pattern: 'weekly', days: ['MO', 'WE', 'FR'] });
  assert.deepEqual(parseCollectionDay('火・木・土'), { pattern: 'weekly', days: ['TU', 'TH', 'SA'] });
});

test('parseCollectionDay: 第n (半角/全角)', () => {
  assert.deepEqual(parseCollectionDay('第2木・第4木'), { pattern: 'monthly_nth', occurrences: [2, 4], days: ['TH'] });
  assert.deepEqual(parseCollectionDay('第１月・第３月'), { pattern: 'monthly_nth', occurrences: [1, 3], days: ['MO'] });
  assert.deepEqual(parseCollectionDay('第２木・第４木'), { pattern: 'monthly_nth', occurrences: [2, 4], days: ['TH'] });
});

test('parseCollectionDay: 未知表記は throw', () => {
  assert.throws(() => parseCollectionDay(''));
  assert.throws(() => parseCollectionDay('第1火・第3月')); // 第n で曜日が複数
  assert.throws(() => parseCollectionDay('毎週火'));
});

test('parseHtmlDay: 公式 HTML 表記', () => {
  assert.deepEqual(parseHtmlDay('火曜日、金曜日'), { pattern: 'weekly', days: ['TU', 'FR'] });
  assert.deepEqual(parseHtmlDay('第2木曜日、第4木曜日'), { pattern: 'monthly_nth', occurrences: [2, 4], days: ['TH'] });
  assert.deepEqual(parseHtmlDay('第1月曜日、第3月曜日'), { pattern: 'monthly_nth', occurrences: [1, 3], days: ['MO'] });
});

test('parseChome: 複数丁目の展開', () => {
  assert.deepEqual(parseChome('1丁目、2丁目、4丁目'), [1, 2, 4]);
  assert.deepEqual(parseChome('6丁目'), [6]);
});

test('parseDayUri: ODP 語彙', () => {
  assert.deepEqual(parseDayUri('EveryTuesday'), { occurrence: null, day: 'TU' });
  assert.deepEqual(parseDayUri('SecondThursday'), { occurrence: 2, day: 'TH' });
  assert.deepEqual(parseDayUri('FourthMonday'), { occurrence: 4, day: 'MO' });
  assert.throws(() => parseDayUri('SixthMonday'));
});

test('areaToRules: 資源は 6 品目へ分解し days を共有 (同日収集)', () => {
  const byCat = {
    燃やすごみ: parseCollectionDay('火・金'),
    '陶器・ガラス・金属ごみ': parseCollectionDay('第2木・第4木'),
    資源: parseCollectionDay('土'),
  };
  const rules = areaToRules(byCat);
  assert.equal(rules.length, 1 + 1 + CATEGORY_MAP['資源'].length);
  const shigen = rules.filter((r) => CATEGORY_MAP['資源'].includes(r.category));
  assert.equal(shigen.length, 6);
  // 同日収集: 全て同一の days 参照 (YAML anchor になる)
  assert.ok(shigen.every((r) => r.days === shigen[0].days));
  assert.deepEqual(shigen[0].days, ['SA']);
  // 燃やすごみは weekly、陶器…は monthly_nth
  assert.equal(rules[0].category, 'burnable');
  assert.equal(rules[0].pattern, 'weekly');
  assert.equal(rules[1].category, 'non_burnable');
  assert.deepEqual(rules[1].occurrences, [2, 4]);
});
