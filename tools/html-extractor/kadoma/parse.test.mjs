import { test } from 'node:test';
import assert from 'node:assert/strict';
import { expandTowns, parseRule, ruleHits } from './parse.mjs';

test('parseRule: 毎週 (曜日を 1 つも落とさない)', () => {
  assert.deepEqual(parseRule('毎週火曜日・金曜日'), { pattern: 'weekly', days: ['TU', 'FR'] });
  assert.deepEqual(parseRule('毎週月曜日'), { pattern: 'weekly', days: ['MO'] });
});

test('parseRule: 毎月第n', () => {
  assert.deepEqual(parseRule('毎月第1・3水曜日'), { pattern: 'monthly_nth', days: ['WE'], occurrences: [1, 3] });
  assert.deepEqual(parseRule('毎月第４水曜日'), { pattern: 'monthly_nth', days: ['WE'], occurrences: [4] });
});

test('parseRule: 知らない表記は throw', () => {
  assert.throws(() => parseRule('毎週火・金'), /解釈できない/);
  assert.throws(() => parseRule('隔週水曜日'), /解釈できない/);
  assert.throws(() => parseRule('毎週火曜日・祝日'), /解釈できない/);
});

test('ruleHits: 第n は「その月の n 回目の曜日」', () => {
  const r = parseRule('毎月第4水曜日');
  assert.equal(ruleHits(r, '2026-04-22'), true);
  assert.equal(ruleHits(r, '2026-04-29'), false); // 第5水曜
});

test('expandTowns: 丁目の範囲・番地の割れ町・大字なしの名前', () => {
  assert.deepEqual(expandTowns('岸和田1丁目～3丁目、打越 、北巣本町(1番～34番)'),
    ['岸和田1丁目', '岸和田2丁目', '岸和田3丁目', '打越', '北巣本町（1番～34番）']);
});

test('expandTowns: 知らない表記は throw', () => {
  assert.throws(() => expandTowns('岸和田1丁目・2丁目'), /解釈できない/);
  assert.throws(() => expandTowns('岸和田3丁目～1丁目'), /逆/);
  assert.throws(() => expandTowns('泉町、、柳町'), /空/);
});
