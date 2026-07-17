import { parse as parseHtml } from 'node-html-parser';

const DAY = { 日: 'SU', 月: 'MO', 火: 'TU', 水: 'WE', 木: 'TH', 金: 'FR', 土: 'SA' };
// 全角空白/連続空白を単一空白へ正規化
const norm = (s) => (s || '').replace(/[　\s]+/g, ' ').trim();

// 「月曜・木曜」「金曜」等の中黒区切り曜日を配列へ。
export function parseWeekly(text) {
  return norm(text)
    .split('・')
    .map((t) => DAY[t.replace('曜', '').trim()])
    .filter(Boolean);
}

// 「第2・4回目　火曜」→ { occurrences:[2,4], days:['TU'] }
export function parseMonthlyNth(text) {
  const t = norm(text).replace(/\s+/g, '');
  const m = t.match(/^第([\d・]+)回目([日月火水木金土])曜/);
  if (!m) throw new Error(`monthly parse 失敗: "${text}"`);
  return { occurrences: m[1].split('・').map(Number), days: [DAY[m[2]]] };
}

// 1ページ内の各 table.per100 を区順の配列として返す。
// 列: 0=五十音マーカ(グループ先頭のみ) / 1=町名 / 2=普通ごみ /
//     3=空き缶等(同日4種) / 4=ミックスペーパー / 5=プラスチック資源 / 6=粗大ごみ・小物金属
export function parseTables(html) {
  const root = parseHtml(html);
  const tables = [];
  for (const table of root.querySelectorAll('table.per100')) {
    const rows = [];
    let kana = '';
    for (const tr of table.querySelectorAll('tr')) {
      const tds = tr.querySelectorAll('td');
      if (tds.length !== 7) continue; // ヘッダ (th) 行を除外
      const cell = (i) => norm(tds[i].text);
      const mk = cell(0);
      if (mk) kana = mk; // マーカは各五十音グループ先頭のみ。空欄は直前を踏襲
      rows.push({
        kana,
        town: cell(1),
        futsu: cell(2),
        canEtc: cell(3),
        mixPaper: cell(4),
        plastic: cell(5),
        sodaiKanamono: cell(6),
      });
    }
    if (rows.length) tables.push(rows);
  }
  return tables;
}
