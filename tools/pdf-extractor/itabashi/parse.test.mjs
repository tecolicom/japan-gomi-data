import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseIndexTable, splitAreas, ruleKey, pdfRuleKey, norm } from './parse.mjs';

test('splitAreas: 範囲・列挙・混在を丁目へ展開する', () => {
  assert.deepEqual(splitAreas('赤塚1～2丁目').map((a) => a.chome), [1, 2]);
  assert.deepEqual(splitAreas('巣鴨1・2・5丁目').map((a) => a.chome), [1, 2, 5]);
  // PDF ヘッダは範囲と列挙を混ぜる
  assert.deepEqual(splitAreas('赤塚1～2・6～7丁目').map((a) => a.chome), [1, 2, 6, 7]);
  assert.deepEqual(splitAreas('高島平1丁目').map((a) => a.chome), [1]);
  assert.equal(splitAreas('赤塚1～2丁目')[0].town, '赤塚');
});

test('splitAreas: 丁目を持たない町はそのまま 1 件', () => {
  assert.deepEqual(splitAreas('相生町'), [{ town: '相生町', chome: null }]);
  assert.deepEqual(splitAreas('大谷口上町'), [{ town: '大谷口上町', chome: null }]);
});

test('splitAreas: 読めない表記は throw する', () => {
  assert.throws(() => splitAreas('赤塚3～1丁目'), /範囲が逆/);
  assert.throws(() => splitAreas('赤塚1・1丁目'), /重複/);
  assert.throws(() => splitAreas('赤塚1番地'), /丁目/);
});

test('norm: 全角数字とチルダのゆれを吸収する', () => {
  assert.equal(norm('赤塚１～２丁目'), '赤塚1～2丁目');
  assert.equal(norm('赤塚1~2丁目'), '赤塚1～2丁目');
  assert.equal(norm('赤塚1〜2丁目'), '赤塚1～2丁目');
});

test('ruleKey / pdfRuleKey: HTML と PDF の表記ゆれを同じキーに寄せる', () => {
  // HTML は「毎月2回目・4回目の金」、PDF は occurrences 配列
  const html = ruleKey({ res: '水', bur: '火・木・土', non: '毎月2回目・4回目の金' });
  const pdf = pdfRuleKey({
    資源: { days: ['水'] },
    可燃: { days: ['火', '木', '土'] },
    不燃: { days: ['金'], occurrences: [2, 4] },
  });
  assert.equal(html, pdf);
  assert.equal(html, '水|火・木・土|2・4回目の金');
});

test('ruleKey: 不燃が読めなければ throw する', () => {
  assert.throws(() => ruleKey({ res: '水', bur: '火', non: '毎週金' }), /不燃/);
  assert.throws(() => ruleKey({ res: '水', bur: '火', non: '毎月の金' }), /不燃/);
});

test('parseIndexTable: 見出しが変わったら throw する', () => {
  const t = (head) => `<table><tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr>`
    + '<tr><td>相生町</td><td>水</td><td>火・木・土</td><td>毎月2回目・4回目の金</td>'
    + '<td>東清掃事務所</td><td>東6 （PDF 255.9KB）</td></tr></table>';
  const ok = ['地域', '資源', '可燃ごみ', '不燃ごみ', '管轄の清掃事務所', '地域別カレンダー番号'];
  const rows = parseIndexTable(t(ok));
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], {
    name: '相生町', res: '水', bur: '火・木・土', non: '毎月2回目・4回目の金',
    office: '東清掃事務所', area: 'e6',
  });
  assert.throws(() => parseIndexTable(t([...ok.slice(0, 5), '番号'])), /見出し/);
});

test('parseIndexTable: 地域番号が読めなければ throw する', () => {
  const html = '<table><tr><th>地域</th><th>資源</th><th>可燃ごみ</th><th>不燃ごみ</th>'
    + '<th>管轄の清掃事務所</th><th>地域別カレンダー番号</th></tr>'
    + '<tr><td>相生町</td><td>水</td><td>火</td><td>毎月2回目の金</td><td>東</td><td>南3</td></tr></table>';
  assert.throws(() => parseIndexTable(html), /地域番号/);
});
