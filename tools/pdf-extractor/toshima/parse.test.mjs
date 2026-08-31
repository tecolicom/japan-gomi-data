import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitAreas, areaYomi, cellsToRules, banchiItems, bareOverlaps, overlapCount } from './parse.mjs';

test('splitAreas: 丁目だけの行は丁目ごとに分解する', () => {
  assert.deepEqual(splitAreas('池袋1・4丁目').map((a) => a.name), ['池袋1丁目', '池袋4丁目']);
  assert.deepEqual(splitAreas('駒込1～7丁目').map((a) => a.name),
    ['駒込1丁目', '駒込2丁目', '駒込3丁目', '駒込4丁目', '駒込5丁目', '駒込6丁目', '駒込7丁目']);
  assert.deepEqual(splitAreas('巣鴨1・2・5丁目').map((a) => a.name), ['巣鴨1丁目', '巣鴨2丁目', '巣鴨5丁目']);
  assert.deepEqual(splitAreas('高田3丁目').map((a) => a.name), ['高田3丁目']);
  // 町名にひらがなが混じっても町名側で切れる
  assert.deepEqual(splitAreas('雑司が谷1～3丁目').map((a) => a.name),
    ['雑司が谷1丁目', '雑司が谷2丁目', '雑司が谷3丁目']);
});

test('splitAreas: 番地つきの行は分解せず 1 area のまま (判別子を name に残す)', () => {
  const a = splitAreas('要町1丁目9番～49番');
  assert.equal(a.length, 1);
  assert.equal(a[0].name, '要町1丁目9番～49番');
  assert.equal(a[0].town, '要町');
  assert.equal(a[0].chome, 1);
  assert.equal(a[0].banchi, '9番～49番');
});

test('splitAreas: 丁目の直後が数字でも町名と丁目を取り違えない', () => {
  const a = splitAreas('池袋2丁目14番5号・8号、15番2号～3号');
  assert.equal(a[0].town, '池袋');
  assert.equal(a[0].chome, 2);
  assert.equal(a[0].banchi, '14番5号・8号、15番2号～3号');
});

test('splitAreas: 読めない町丁名は throw する', () => {
  assert.throws(() => splitAreas('池袋駅周辺繁華街地域'), /丁目/);
  assert.throws(() => splitAreas('1番～8番'), /丁目/);
});

test('areaYomi: 丁目と最初の番地を読みの後ろに付ける', () => {
  assert.equal(areaYomi('いけぶくろ', { chome: 1, banchi: null }), 'いけぶくろ1');
  assert.equal(areaYomi('かなめちょう', { chome: 1, banchi: '9番～49番' }), 'かなめちょう1-9');
});

test('cellsToRules: 4 列 → 同日は days を共有する', () => {
  const rules = cellsToRules(['火', '水', '月・木', '第1・3金']);
  const by = Object.fromEntries(rules.map((r) => [r.category, r]));
  assert.deepEqual(by.burnable, { category: 'burnable', pattern: 'weekly', days: ['MO', 'TH'] });
  assert.deepEqual(by.non_burnable,
    { category: 'non_burnable', pattern: 'monthly_nth', occurrences: [1, 3], days: ['FR'] });
  // びん・かん・ペットは同じ days オブジェクトを共有 (YAML anchor になる)
  assert.equal(by.glass_bottle.days, by.beverage_can.days);
  assert.equal(by.glass_bottle.days, by.pet_bottle.days);
  assert.equal(by.plastic.days, by.paper_cloth.days);
  assert.notEqual(by.glass_bottle.days, by.plastic.days);
  // 並びは CAT_ORDER
  assert.deepEqual(rules.map((r) => r.category),
    ['burnable', 'non_burnable', 'plastic', 'paper_cloth', 'glass_bottle', 'beverage_can', 'pet_bottle']);
});

test('cellsToRules: 読めない曜日は throw する', () => {
  assert.throws(() => cellsToRules(['火', '水', '月・木']), /列数/);
  assert.throws(() => cellsToRules(['火', '水', '月・木', '毎週金']), /monthly_nth/);
  assert.throws(() => cellsToRules(['祝', '水', '月・木', '第1・3金']), /weekly/);
});

test('banchiItems: 括弧の中の読点では切らない / 限定の有無を持つ', () => {
  const { items, unparsed } = banchiItems('1番～13番、14番（5号、8号以外）、15番1号');
  assert.deepEqual(items, [
    { from: 1, to: 13, qualified: false },
    { from: 14, to: 14, qualified: true },
    { from: 15, to: 15, qualified: true },
  ]);
  assert.deepEqual(unparsed, []);
});

test('banchiItems: 「N～M番」形も範囲として読む', () => {
  const { items } = banchiItems('1～10番、15番（16号～21号）、34番（14号～20号）');
  assert.deepEqual(items, [
    { from: 1, to: 10, qualified: false },
    { from: 15, to: 15, qualified: true },
    { from: 34, to: 34, qualified: true },
  ]);
});

test('banchiItems: 番として読めない断片は unparsed に落とす (一次ソースの誤記が出る)', () => {
  // 簡易版は「15番1号、6号18番」と読点が落ちている (保存版は「15番1号・6号，18番」)
  const { unparsed } = banchiItems('1番～13番、14番（5号、8号以外）、15番1号、6号18番、19番（要町通り沿い）');
  assert.deepEqual(unparsed, ['6号18番']);
});

test('bareOverlaps: 限定つきの重なりは見逃し、限定なしの重なりだけ拾う', () => {
  // 号で割ってある正当な重なり
  const a = banchiItems('1番～10番、15番（16号～21号）');
  const b = banchiItems('11番～14番、15番（1号～15号）');
  assert.deepEqual(bareOverlaps(a, b), []);
  // どちらにも限定が無い重なり = 係り先の取り違え
  const c = banchiItems('1番～10番');
  const d = banchiItems('8番～20番');
  assert.deepEqual(bareOverlaps(c, d), [[1, 10, 8, 20]]);
});

test('overlapCount: monthly_nth が weekly と同じ曜日に来る数を数える', () => {
  assert.equal(overlapCount(cellsToRules(['火', '水', '月・木', '第1・3金'])), 0);
  // 金属陶器ガラスが燃やすごみと同じ木曜に来る作り物のケース
  assert.equal(overlapCount(cellsToRules(['火', '水', '月・木', '第1・3木'])), 1);
});
