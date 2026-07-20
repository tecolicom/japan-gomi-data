import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePage, cellsToSchedule } from './parse.mjs';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = dirname(fileURLToPath(import.meta.url));

test('parsePage: 神奈川区あ〜えページの行と五十音前方補完', () => {
  const html = readFileSync(join(HERE, 'cache/kanagawa__a-e.html'), 'utf8');
  const { rows, excluded } = parsePage(html);
  assert.equal(excluded.length, 0);
  assert.ok(rows.length >= 10);
  const aoki = rows.find((r) => r.town === '青木町');
  assert.ok(aoki, '青木町 が見つかる');
  assert.equal(aoki.kana, 'あ');
  assert.deepEqual(aoki.cells, ['燃やすごみ', '缶・びん・ペットボトル', 'なし', 'プラスチック資源', '燃やすごみ', 'なし']);
  // 五十音マーカはグループ2行目以降も直前を踏襲
  const asahigaoka = rows.find((r) => r.town === '旭ヶ丘');
  assert.equal(asahigaoka.kana, 'あ');
});

test('parsePage: 南区は行ページの非公開町 (平楽) を除外リストに回す', () => {
  const html = readFileSync(join(HERE, 'cache/minami__hagyou.html'), 'utf8');
  const { excluded } = parsePage(html);
  assert.deepEqual(excluded.map((e) => e.town), ['平楽']);
});

test('cellsToSchedule: 週2+1+1 の構造を検査する', () => {
  const s = cellsToSchedule(['燃やすごみ', '缶・びん・ペットボトル', 'なし', 'プラスチック資源', '燃やすごみ', 'なし']);
  assert.deepEqual(s, { burnable: ['MO', 'FR'], can: 'TU', plastic: 'TH' });
  assert.throws(() => cellsToSchedule(['燃やすごみ', 'なし', 'なし', 'なし', 'なし', 'なし']));
});
