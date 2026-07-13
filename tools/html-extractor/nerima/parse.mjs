import { parse as parseHtml } from 'node-html-parser';

const DAY = { 日: 'SU', 月: 'MO', 火: 'TU', 水: 'WE', 木: 'TH', 金: 'FR', 土: 'SA' };
// 全角/半角の中黒・空白を正規化
const norm = (s) => (s || '').replace(/[･・]/g, '・').replace(/　/g, ' ').trim();

export function parseWeekly(text) {
  return norm(text).split('・').map((t) => DAY[t.replace('曜', '').trim()]).filter(Boolean);
}

export function parseMonthlyNth(text) {
  // 例 "第1・3 月曜"。稀に空白の位置がゆれる("第1･ 3水曜" 等)ため、
  // 曜日判定前に空白位置に依存しないよう内部の空白を除去する。
  const t = norm(text).replace(/\s+/g, '');
  const m = t.match(/^第([\d・]+)([日月火水木金土])曜/);
  if (!m) throw new Error(`monthly parse 失敗: "${text}"`);
  return {
    occurrences: m[1].split('・').map(Number),
    days: [DAY[m[2]]],
  };
}

export function parseTable(html, page) {
  const root = parseHtml(html);
  const rows = [];
  for (const table of root.querySelectorAll('table.table01')) {
    for (const tr of table.querySelectorAll('tr')) {
      const tds = tr.querySelectorAll('td');
      if (tds.length < 7) continue; // ヘッダ(th)やレイアウト行を除外
      const cell = (i) => tds[i].text.replace(/\s+/g, ' ').trim();
      const a = tds[7]?.querySelector('a');
      rows.push({
        town: cell(0),
        chome: cell(1),
        burnable: cell(2),
        nonBurnable: cell(3),
        plaPaper: cell(4),
        binCan: cell(5),
        pet: cell(6),
        pdfUrl: a ? a.getAttribute('href') : null,
        page,
      });
    }
  }
  return rows;
}
