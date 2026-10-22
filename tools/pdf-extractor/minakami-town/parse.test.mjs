import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseScheduleLine } from './parse.mjs';

const P = '2026-10--2027-03';

test('parseScheduleLine: 毎週 (全角の数字・中点)', () => {
  assert.deepEqual(parseScheduleLine('毎週火・金曜', P), { type: 'weekly', days: ['TU', 'FR'] });
  assert.deepEqual(parseScheduleLine('毎週水曜', P), { type: 'weekly', days: ['WE'] });
});

test('parseScheduleLine: 除外日の年は収録期間から決まる (「を」「は」の両方がある)', () => {
  assert.deepEqual(parseScheduleLine('１月１日を除く', P), { type: 'exclude', date: '2027-01-01' });
  assert.deepEqual(parseScheduleLine('１２月３０日は除く', P), { type: 'exclude', date: '2026-12-30' });
  assert.deepEqual(parseScheduleLine('１月1日を除く', P), { type: 'exclude', date: '2027-01-01' });
});

test('parseScheduleLine: 毎月第n と その月だけの例外', () => {
  assert.deepEqual(parseScheduleLine('毎月第１・３木曜', P), { type: 'nth', occurrences: [1, 3], day: 'TH' });
  assert.deepEqual(parseScheduleLine('1月は第3・5金曜', P), { type: 'month_nth', month: 1, occurrences: [3, 5], day: 'FR' });
});

test('parseScheduleLine: 衣類の「10月と1月の第3」', () => {
  assert.deepEqual(parseScheduleLine('１０月と１月の第３水曜', P),
    { type: 'months_nth', months: [10, 1], occurrences: [3], day: 'WE' });
});

test('parseScheduleLine: 知らない表記と期間外の月は throw', () => {
  assert.throws(() => parseScheduleLine('祝日は収集しません', P), /解釈できない/);
  assert.throws(() => parseScheduleLine('5月3日を除く', P), /収録期間/);
});
