import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseWeekly, parseMonthlyNth, parseTables } from './parse.mjs';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = dirname(fileURLToPath(import.meta.url));

test('parseWeekly: 中黒区切り2曜日と単一曜日', () => {
  assert.deepEqual(parseWeekly('月曜・木曜'), ['MO', 'TH']);
  assert.deepEqual(parseWeekly('水曜・土曜'), ['WE', 'SA']);
  assert.deepEqual(parseWeekly('金曜'), ['FR']);
});

test('parseMonthlyNth: 第n・n回目 曜', () => {
  assert.deepEqual(parseMonthlyNth('第1・3回目　月曜'), { occurrences: [1, 3], days: ['MO'] });
  assert.deepEqual(parseMonthlyNth('第2・4回目　火曜'), { occurrences: [2, 4], days: ['TU'] });
});

test('parseTables: 川崎区は1区・浅田の行を正しく拾う', () => {
  const html = readFileSync(join(HERE, 'cache/kawasaki.html'), 'utf8');
  const tables = parseTables(html);
  assert.equal(tables.length, 1, '川崎区ページは table 1つ');
  assert.equal(tables[0].length, 75, '川崎区は75町名');
  const asada = tables[0].find((r) => r.town === '浅田');
  assert.ok(asada, '浅田 が見つかる');
  assert.equal(asada.kana, 'あ');
  assert.equal(asada.futsu, '月曜・木曜');
  assert.equal(asada.canEtc, '金曜');
  assert.equal(asada.mixPaper, '火曜');
  assert.equal(asada.plastic, '土曜');
  assert.equal(asada.sodaiKanamono, '第2・4回目 火曜');
});

test('parseTables: 2区ページは区順に2 table (幸区35・中原区40)', () => {
  const html = readFileSync(join(HERE, 'cache/saiwai-nakahara.html'), 'utf8');
  const tables = parseTables(html);
  assert.equal(tables.length, 2);
  assert.equal(tables[0].length, 35, '幸区35町名');
  assert.equal(tables[1].length, 40, '中原区40町名');
  // 五十音マーカの前方補完 (グループ2行目以降は直前を踏襲)
  assert.ok(tables[0].every((r) => r.kana.length > 0), 'yomi(初字)が全行に付く');
});
