import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDays, parseTable, splitChome, areaName, norm } from './parse.mjs';

test('parseDays: 単一・複数・範囲', () => {
  assert.deepEqual(parseDays('土曜日'), [5]);
  assert.deepEqual(parseDays('水曜日・土曜日'), [2, 5]);
  // 京橋・銀座・日本橋1〜3丁目・八重洲の繁華街は週6日
  assert.deepEqual(parseDays('月曜日～土曜日'), [0, 1, 2, 3, 4, 5]);
  // 日本橋人形町2丁目1〜14番の週5日 (範囲でも 2 日でもない)
  assert.deepEqual(parseDays('月曜日・火曜日・水曜日・金曜日・土曜日'), [0, 1, 2, 4, 5]);
});

test('parseDays: 読めない表記は throw する', () => {
  assert.throws(() => parseDays(''), /空/);
  assert.throws(() => parseDays('祝日'), /曜日が読めない/);
  assert.throws(() => parseDays('土曜日～月曜日'), /逆か週をまたぐ/);
  assert.throws(() => parseDays('日曜日～水曜日'), /逆か週をまたぐ/);
  assert.throws(() => parseDays('月曜日・月曜日'), /重複/);
});

test('parseTable: rowspan を音と町名で別々に繰り越す', () => {
  const html = '<table>'
    + '<tr><th>音</th><th>町名</th><th>丁目</th><th>燃やすごみ</th><th>燃やさないごみ</th>'
    + '<th>プラマーク</th><th>資源</th><th>粗大ごみ</th></tr>'
    + '<tr><td rowspan="3">き</td><td>京橋</td><td>全域</td><td>月曜日～土曜日</td><td>金曜日</td>'
    + '<td>火曜日</td><td>火曜日</td><td>火曜日</td></tr>'
    // 銀座は音も町名も rowspan で欠ける
    + '<tr><td rowspan="2">銀座</td><td>1～2丁目</td><td>月曜日～土曜日</td><td>月曜日</td>'
    + '<td>木曜日</td><td>木曜日</td><td>木曜日</td></tr>'
    + '<tr><td>3～4丁目</td><td>月曜日～土曜日</td><td>土曜日</td><td>水曜日</td><td>水曜日</td><td>木曜日</td></tr>'
    + '</table>';
  const rows = parseTable(html);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map((r) => [r.on, r.town, r.chome]),
    [['き', '京橋', '全域'], ['き', '銀座', '1～2丁目'], ['き', '銀座', '3～4丁目']]);
});

test('parseTable: <br> の意味が列で違う', () => {
  const html = '<table>'
    + '<tr><th>音</th><th>町名</th><th>丁目</th><th>燃やすごみ</th><th>燃やさないごみ</th>'
    + '<th>プラマーク</th><th>資源</th><th>粗大ごみ</th></tr>'
    + '<tr><td>ほ</td><td>本町</td><td>1丁目1～<br> 5番</td>'
    + '<td>月曜日・火曜日・水曜日<br> 金曜日・土曜日</td>'
    + '<td>火曜日</td><td>土曜日</td><td>金曜日</td><td>金曜日</td></tr></table>';
  const r = parseTable(html)[0];
  assert.equal(r.chome, '1丁目1～5番');                  // 折り返し → 詰める
  assert.deepEqual(parseDays(r.days[0]), [0, 1, 2, 4, 5]); // 区切り → ・ を補う
});

test('parseTable: 見出しが変わったら throw する', () => {
  const html = '<table><tr><th>町名</th><th>燃やすごみ</th></tr>'
    + '<tr><td>明石町</td><td>水曜日</td></tr></table>';
  assert.throws(() => parseTable(html), /見出し/);
});

test('splitChome: 全域・丁目・番地割れ', () => {
  assert.deepEqual(splitChome('全域'), [{ chome: null, banchi: null }]);
  assert.deepEqual(splitChome(''), [{ chome: null, banchi: null }]);      // 浜離宮庭園
  assert.deepEqual(splitChome('1丁目'), [{ chome: 1, banchi: null }]);
  assert.deepEqual(splitChome('1～2丁目').map((x) => x.chome), [1, 2]);
  assert.deepEqual(splitChome('2丁目1～14番'), [{ chome: 2, banchi: '1～14番' }]);
  // 丁目を持たない町の番地割れ (小伝馬町)
  assert.deepEqual(splitChome('1～2番、7～21番'), [{ chome: null, banchi: '1～2番、7～21番' }]);
});

test('splitChome: 読めない表記は throw する', () => {
  assert.throws(() => splitChome('2～1丁目'), /範囲が逆/);
  assert.throws(() => splitChome('1・1丁目'), /重複/);
  assert.throws(() => splitChome('一部地域'), /読めない/);
});

test('areaName: 番地で割れる町は判別子を name に残す', () => {
  assert.equal(areaName('湊', { chome: 3, banchi: null }), '湊3丁目');
  assert.equal(areaName('日本橋人形町', { chome: 2, banchi: '1～14番' }), '日本橋人形町2丁目1～14番');
  assert.equal(areaName('日本橋小伝馬町', { chome: null, banchi: '3～6番' }), '日本橋小伝馬町3～6番');
  assert.equal(areaName('浜離宮庭園', { chome: null, banchi: null }), '浜離宮庭園');
});

test('norm: 全角数字とチルダのゆれを吸収する', () => {
  assert.equal(norm('１～２丁目'), '1～2丁目');
  assert.equal(norm('1~2丁目'), '1～2丁目');
});
