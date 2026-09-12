import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv, splitAreas, csvRuleKey, sheetRuleKey, daysOf, dayIdx, norm } from './parse.mjs';

const HEAD = 'じゅうしょ,住所,地区番号,資源,プラスチック,燃やすごみ,燃やさないごみ';

test('parseCsv: 1 行を読む', () => {
  const rows = parseCsv(`${HEAD}\nあおみ,青海,6,金,水,月・木,（隔週）土\n`);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], {
    yomi: 'あおみ', name: '青海', district: 6,
    res: '金', plastic: '水', burnable: '月・木', nonBurnableDay: '土',
  });
});

test('parseCsv: 読みの全角空白を落とす (「ひらの　」の実例)', () => {
  const rows = parseCsv(`${HEAD}\nひらの　,平野4丁目,11,木,火,水・土,（隔週）金\n`);
  assert.equal(rows[0].yomi, 'ひらの');
});

test('parseCsv: 想定外の形は throw する', () => {
  assert.throws(() => parseCsv('地域,資源\n青海,金\n'), /見出し/);
  assert.throws(() => parseCsv(`${HEAD}\nあおみ,青海,99,金,水,月・木,（隔週）土\n`), /地区番号/);
  // 隔週の表記が変わったら気づく (週1回化など)
  assert.throws(() => parseCsv(`${HEAD}\nあおみ,青海,6,金,水,月・木,土\n`), /燃やさないごみ/);
});

test('splitAreas: 範囲・列挙・混在を丁目へ展開する', () => {
  assert.deepEqual(splitAreas('大島1～2丁目').map((a) => a.chome), [1, 2]);
  assert.deepEqual(splitAreas('南砂1・5丁目').map((a) => a.chome), [1, 5]);
  // CSV は範囲と列挙を混ぜる
  assert.deepEqual(splitAreas('南砂2～4・6～7丁目').map((a) => a.chome), [2, 3, 4, 6, 7]);
  assert.equal(splitAreas('大島1～2丁目')[0].town, '大島');
});

test('splitAreas: 丁目を持たない町はそのまま (build が ABR の丁目へ展開する)', () => {
  assert.deepEqual(splitAreas('青海'), [{ town: '青海', chome: null }]);
  assert.deepEqual(splitAreas('海の森'), [{ town: '海の森', chome: null }]);
});

test('splitAreas: 読めない表記は throw する', () => {
  assert.throws(() => splitAreas('大島3～1丁目'), /範囲が逆/);
  assert.throws(() => splitAreas('大島1・1丁目'), /重複/);
  assert.throws(() => splitAreas('大島1番地'), /丁目/);
});

test('norm: 全角数字とチルダのゆれを吸収する', () => {
  assert.equal(norm('大島１～２丁目'), '大島1～2丁目');
  assert.equal(norm('大島1~2丁目'), '大島1～2丁目');
  assert.equal(norm('大島1〜2丁目'), '大島1～2丁目');
});

test('csvRuleKey / sheetRuleKey: CSV とシートを同じキーに寄せる', () => {
  const row = parseCsv(`${HEAD}\nあおみ,青海,6,金,水,月・木,（隔週）土\n`)[0];
  const sheet = {
    weekly: { 資源: [4], プラスチック: [2], 燃やすごみ: [0, 3] },
    biweekly_weekday: 5,
  };
  assert.equal(csvRuleKey(row), sheetRuleKey(sheet));
  assert.equal(csvRuleKey(row), '4|2|0,3|5');
});

test('csvRuleKey: 曜日が違えばキーも違う', () => {
  const a = parseCsv(`${HEAD}\nあおみ,青海,6,金,水,月・木,（隔週）土\n`)[0];
  const b = parseCsv(`${HEAD}\nあおみ,青海,6,金,水,月・木,（隔週）日\n`)[0];
  assert.notEqual(csvRuleKey(a), csvRuleKey(b));
});

test('daysOf / dayIdx: 曜日の変換', () => {
  assert.deepEqual(daysOf('月・木'), [0, 3]);
  assert.deepEqual(daysOf('土'), [5]);
  assert.equal(dayIdx('日'), 6);
  assert.throws(() => dayIdx('祝'), /曜日/);
});
