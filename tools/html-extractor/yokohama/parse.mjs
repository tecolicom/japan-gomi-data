import { parse as parseHtml } from 'node-html-parser';

const DOW = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA']; // 表の曜日列順 (月〜土。日曜列は無い=収集なし)
// 市公式 HTML 自体の明白な脱字の補修 (対になる隣接行から機械的に確定できるもののみ)。
// 中区 麦田町4丁目「…（本牧通り沿い」は閉じ括弧欠け (隣の「（商店街通り沿い）」は閉じている)。
const SOURCE_TYPO_FIXES = new Map([
  ['麦田町4丁目本牧通りから山手駅側(本牧通り沿い', '麦田町4丁目本牧通りから山手駅側(本牧通り沿い)'],
]);
// NFKC は波ダッシュ (〜) をチルダにするため町名表記用に戻す
const norm = (s) => (s || '').normalize('NFKC').replace(/[\s ]+/g, '').replace(/~/g, '〜').trim();

// 1ページ (五十音別サブページ) の表 → 行配列。
// 列: 0=五十音 (グループ先頭のみ。空欄は直前を踏襲) / 1=町名 / 2..7=月〜土のセル。
// セル語彙は「燃やすごみ」「缶・びん・ペットボトル」「プラスチック資源」「なし」の閉集合。
export function parsePage(html) {
  const root = parseHtml(html);
  const rows = [];
  const excluded = [];
  for (const table of root.querySelectorAll('table')) {
    const trs = table.querySelectorAll('tr');
    if (!trs.length) continue;
    const head = trs[0].querySelectorAll('th,td').map((c) => norm(c.text));
    if (!head.some((h) => h.includes('町名'))) continue;
    if (head.length !== 8 || !head[2].includes('月曜'))
      throw new Error(`想定外のヘッダ: ${JSON.stringify(head)}`);
    let kana = '';
    for (const tr of trs.slice(1)) {
      const tds = tr.querySelectorAll('td,th').map((c) => norm(c.text));
      if (tds.length < 2) continue;
      const mk = tds[0];
      if (mk) kana = mk;
      let town = tds[1];
      if (SOURCE_TYPO_FIXES.has(town)) town = SOURCE_TYPO_FIXES.get(town);
      if (!town) continue;
      if (tds.length !== 8) { excluded.push({ town, reason: `セル数 ${tds.length}` }); continue; }
      const cells = tds.slice(2, 8);
      if (cells.some((c) => !['燃やすごみ', '缶・びん・ペットボトル', 'プラスチック資源', 'なし'].includes(c))) {
        excluded.push({ town, reason: `語彙外セル ${JSON.stringify(cells)}` });
        continue;
      }
      rows.push({ kana, town, cells });
    }
  }
  return { rows, excluded };
}

// セル列 → 週次スケジュール。燃やすごみ2日・缶びんペット1日・プラ1日の構造を検査する。
export function cellsToSchedule(cells) {
  const burn = [];
  const can = [];
  const pla = [];
  cells.forEach((c, i) => {
    if (c === '燃やすごみ') burn.push(DOW[i]);
    else if (c === '缶・びん・ペットボトル') can.push(DOW[i]);
    else if (c === 'プラスチック資源') pla.push(DOW[i]);
  });
  if (burn.length !== 2 || can.length !== 1 || pla.length !== 1)
    throw new Error(`想定外の頻度 burn=${burn} can=${can} pla=${pla}`);
  return { burnable: burn, can: can[0], plastic: pla[0] };
}
