import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv, parseSchedule, parseBinKanPaper, rowToRules, banchiNumber, COL } from './parse.mjs';

test('parseCsv: ヘッダと行を辞書化する', () => {
  const rows = parseCsv('a,b\n1,2\n3,4\n');
  assert.deepEqual(rows, [{ a: '1', b: '2' }, { a: '3', b: '4' }]);
});

test('parseCsv: 引用符入りセル', () => {
  assert.deepEqual(parseCsv('a,b\n"x,y","he said ""hi"""\n'), [{ a: 'x,y', b: 'he said "hi"' }]);
});

test('parseSchedule: 週次', () => {
  assert.deepEqual(parseSchedule('月曜日・木曜日'), { pattern: 'weekly', days: ['MO', 'TH'] });
  assert.deepEqual(parseSchedule('水曜日'), { pattern: 'weekly', days: ['WE'] });
});

test('parseSchedule: 第n (「の」入り・第の繰り返し)', () => {
  assert.deepEqual(parseSchedule('第1・第3の金曜日'),
    { pattern: 'monthly_nth', days: ['FR'], occurrences: [1, 3] });
  assert.deepEqual(parseSchedule('第1・第3・第5の木曜日'),
    { pattern: 'monthly_nth', days: ['TH'], occurrences: [1, 3, 5] });
  assert.deepEqual(parseSchedule('第4の月曜日'),
    { pattern: 'monthly_nth', days: ['MO'], occurrences: [4] });
});

test('parseSchedule: 「曜日」省略形 (第2・第4の木)', () => {
  assert.deepEqual(parseSchedule('第2・第4の木'),
    { pattern: 'monthly_nth', days: ['TH'], occurrences: [2, 4] });
});

test('parseSchedule: 展開不能表記は null', () => {
  for (const t of ['個別', 'お問い合わせください', '不定期', '']) {
    assert.equal(parseSchedule(t), null, t);
  }
});

test('parseSchedule: 未知表記は throw (黙って落とさない)', () => {
  assert.throws(() => parseSchedule('隔週の月曜日'));
});

test('parseBinKanPaper: 通常は3カテゴリ同日', () => {
  assert.deepEqual(parseBinKanPaper('第1・第3の月曜日'), [{
    categories: ['glass_bottle', 'beverage_can', 'paper'],
    sched: { pattern: 'monthly_nth', days: ['MO'], occurrences: [1, 3] },
  }]);
});

test('parseBinKanPaper: 複合表記は古紙とびん缶を分離', () => {
  assert.deepEqual(parseBinKanPaper('古紙：第2・第4の土曜日、びん缶：月曜日'), [
    { categories: ['paper'], sched: { pattern: 'monthly_nth', days: ['SA'], occurrences: [2, 4] } },
    { categories: ['glass_bottle', 'beverage_can'], sched: { pattern: 'weekly', days: ['MO'] } },
  ]);
});

test('parseBinKanPaper: 展開不能なら空配列', () => {
  assert.deepEqual(parseBinKanPaper('個別'), []);
});

const ROW = {
  [COL.district]: '南千住', [COL.chome]: '1丁目', [COL.banchi]: '1番',
  [COL.burnable]: '月曜日・木曜日', [COL.nonBurnable]: '第1・第3の金曜日', [COL.plastic]: '水曜日',
  [COL.binKanPaper]: '土曜日', [COL.pet]: '土曜日', [COL.cloth]: '土曜日',
};

test('rowToRules: 実データ 1 行 (南千住1丁目1番)', () => {
  assert.deepEqual(rowToRules(ROW), [
    { category: 'burnable', pattern: 'weekly', days: ['MO', 'TH'] },
    { category: 'non_burnable', pattern: 'monthly_nth', days: ['FR'], occurrences: [1, 3] },
    { category: 'plastic', pattern: 'weekly', days: ['WE'] },
    { category: 'glass_bottle', pattern: 'weekly', days: ['SA'] },
    { category: 'beverage_can', pattern: 'weekly', days: ['SA'] },
    { category: 'paper', pattern: 'weekly', days: ['SA'] },
    { category: 'pet_bottle', pattern: 'weekly', days: ['SA'] },
    { category: 'cloth', pattern: 'weekly', days: ['SA'] },
  ]);
});

test('rowToRules: 展開不能セルは rules から落ちる', () => {
  const r = rowToRules({ ...ROW, [COL.cloth]: '', [COL.binKanPaper]: '個別' });
  assert.deepEqual(r.map((x) => x.category), ['burnable', 'non_burnable', 'plastic', 'pet_bottle']);
});

test('banchiNumber: 「N番」のみ数値化、「N番M号」は null', () => {
  assert.equal(banchiNumber('12番'), 12);
  assert.equal(banchiNumber('9番12号'), null);
});
