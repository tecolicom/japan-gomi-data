// 品川区公式「ごみ・資源収集日一覧」HTML (五十音別 7 ページ) のパーサ (経路 C: 現行公式表)。
//
// ODP データセットは dcterms:modified が 2015-06-03 と古いため、現行公式表との突合で鮮度を担保する。
// 表の列構成はページによって 2 種類ある:
//   5 列: 町名 | 丁目 | 燃やすごみ | 陶器・ガラス・金属 | 資源
//   6 列: 町名 | 丁目 | 番地・号   | 燃やすごみ | 陶器・ガラス・金属 | 資源
// 丁目セルは "1丁目、2丁目、4丁目" のように複数丁目をまとめる (CSV は 1 丁目 1 行)。
// 曜日表記は "火曜日、金曜日" / "第2木曜日、第4木曜日" (CSV の "火・金" とは別表記)。
import { parse as parseHtml } from 'node-html-parser';
import { DAY_JA, normJa } from '../../_lib/jp.mjs';

const CAT_BY_HEADER = {
  燃やすごみ: '燃やすごみ',
  '陶器・ガラス・金属': '陶器・ガラス・金属ごみ', // 表見出しは末尾「ごみ」なし
  '陶器・ガラス・金属ごみ': '陶器・ガラス・金属ごみ',
  資源: '資源',
};

const cellText = (el) => el.text.replace(/ /g, ' ').replace(/　/g, ' ').trim();

// "火曜日、金曜日" → {pattern:'weekly', days:['TU','FR']}
// "第2木曜日、第4木曜日" → {pattern:'monthly_nth', occurrences:[2,4], days:['TH']}
export function parseHtmlDay(text) {
  const parts = normJa(text).split(/[、,]/).map((s) => s.trim()).filter(Boolean);
  if (!parts.length) throw new Error(`HTML 収集曜日が空`);

  if (parts.every((p) => /^第\d[日月火水木金土]曜日?$/.test(p))) {
    const occurrences = [], days = new Set();
    for (const p of parts) { occurrences.push(Number(p[1])); days.add(DAY_JA[p[2]]); }
    if (days.size !== 1) throw new Error(`HTML 第n で曜日が複数: "${text}"`);
    return { pattern: 'monthly_nth', occurrences: [...new Set(occurrences)].sort((a, b) => a - b), days: [...days] };
  }
  if (parts.every((p) => /^[日月火水木金土]曜日?$/.test(p))) {
    return { pattern: 'weekly', days: parts.map((p) => DAY_JA[p[0]]) };
  }
  throw new Error(`HTML 収集曜日パース失敗: "${text}"`);
}

// "1丁目、2丁目、4丁目" → [1,2,4]
export function parseChome(text) {
  const nums = [...normJa(text).matchAll(/(\d+)丁目/g)].map((m) => Number(m[1]));
  if (!nums.length) throw new Error(`丁目パース失敗: "${text}"`);
  return nums;
}

// HTML 群 → [{town, chome, banchi, days:{燃やすごみ|陶器…|資源}}] (丁目は展開済み)
export function parseShinagawaHtml(pages) {
  const out = [];
  for (const { name, html } of pages) {
    const root = parseHtml(html);
    for (const table of root.querySelectorAll('table')) {
      // 見出し行から列位置を決める (5 列 / 6 列の両方に対応)
      let cols = null;
      for (const tr of table.querySelectorAll('tr')) {
        const cells = tr.querySelectorAll('th, td');
        const texts = cells.map(cellText);

        if (!cols) {
          if (texts[0] === '町名' && texts[1] === '丁目') {
            cols = { town: 0, chome: 1, banchi: texts[2] === '番地・号' ? 2 : null, cats: {} };
            texts.forEach((t, i) => { if (CAT_BY_HEADER[t]) cols.cats[CAT_BY_HEADER[t]] = i; });
            const missing = ['燃やすごみ', '陶器・ガラス・金属ごみ', '資源'].filter((c) => cols.cats[c] === undefined);
            if (missing.length) throw new Error(`${name}: 表見出しに ${missing.join(',')} が無い (${texts.join('|')})`);
          }
          continue;
        }
        if (texts.length < 5) continue; // 注記行など

        const banchiRaw = cols.banchi === null ? '' : texts[cols.banchi];
        const banchi = /^[（(]?空欄[）)]?$/.test(banchiRaw) ? '' : banchiRaw;
        const days = {};
        for (const [cat, i] of Object.entries(cols.cats)) days[cat] = parseHtmlDay(texts[i]);
        for (const chome of parseChome(texts[cols.chome])) {
          out.push({ page: name, town: normJa(texts[cols.town]), chome, banchi, days });
        }
      }
    }
  }
  if (!out.length) throw new Error('HTML から 1 行も取れなかった (ページ構造の変更?)');
  return out;
}
