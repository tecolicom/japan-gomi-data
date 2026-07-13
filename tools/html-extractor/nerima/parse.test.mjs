import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseWeekly, parseMonthlyNth, parseTable } from './parse.mjs';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = dirname(fileURLToPath(import.meta.url));

test('parseWeekly: 中黒区切り', () => {
  assert.deepEqual(parseWeekly('水曜･土曜'), ['WE', 'SA']);
  assert.deepEqual(parseWeekly('火曜'), ['TU']);
});

test('parseMonthlyNth', () => {
  assert.deepEqual(parseMonthlyNth('第1･3 月曜'), { occurrences: [1, 3], days: ['MO'] });
  assert.deepEqual(parseMonthlyNth('第2･4 木曜'), { occurrences: [2, 4], days: ['TH'] });
});

test('parseTable: は行 羽沢 全域の行を拾う', () => {
  const html = readFileSync(join(HERE, 'cache/ha_gyochiiki.html'), 'utf8');
  const rows = parseTable(html, 'ha');
  const hazawa = rows.find((r) => r.town === '羽沢' && r.chome === '全域');
  assert.ok(hazawa, '羽沢 全域 が見つかる');
  assert.equal(hazawa.burnable, '水曜･土曜');
  assert.equal(hazawa.nonBurnable, '第1･3 月曜');
  assert.equal(hazawa.pet, '火曜');
  assert.match(hazawa.pdfUrl, /hazawa.*R8\.pdf$/);
});
