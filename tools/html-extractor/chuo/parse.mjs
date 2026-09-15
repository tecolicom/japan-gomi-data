// 区公式「あなたの町のごみ・資源収集曜日」HTML 表のパース。
//
// ## `<br>` の意味が列で違う
//
// 同じ `<br>` が、曜日列では**区切り**、丁目列では**折り返し**として働く。
//
//   曜日列 … `月曜日・火曜日・水曜日<br>金曜日・土曜日`  → 5 曜日 (区切りの `・` が落ちている)
//   丁目列 … `1丁目1～<br>5番`                        → `1丁目1～5番` (ただの折り返し)
//
// 一律に扱うとどちらかが壊れるので、列ごとに変える。
import { zen2han } from '../../_lib/jp.mjs';

const DAY_IDX = { 月: 0, 火: 1, 水: 2, 木: 3, 金: 4, 土: 5, 日: 6 };
const ORDER = ['月', '火', '水', '木', '金', '土', '日'];
const TILDE = /[~～〜]/g;

export const norm = (s) => zen2han(String(s)).replace(TILDE, '～').replace(/[\s　]+/g, '').trim();

const unescape = (s) => s
  .replace(/&nbsp;/g, '').replace(/&amp;/g, '&')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');

/**
 * 曜日セル → 曜日番号の配列 (月=0 … 日=6)。
 *   「土曜日」            → [5]
 *   「水曜日・土曜日」      → [2,5]
 *   「月曜日～土曜日」      → [0,1,2,3,4,5]   (週6日。京橋等の繁華街)
 *   「月曜日・火曜日・水曜日・金曜日・土曜日」 → [0,1,2,3?] … 実際は [0,1,2,4,5]
 */
export function parseDays(cell) {
  const t = norm(cell).replace(/曜日/g, '');
  if (!t) throw new Error('曜日セルが空');
  const out = [];
  for (const part of t.split('・').filter(Boolean)) {
    const range = /^([日月火水木金土])～([日月火水木金土])$/.exec(part);
    if (range) {
      const a = ORDER.indexOf(range[1]);
      const b = ORDER.indexOf(range[2]);
      // 週をまたぐ範囲 (土～月) と日曜を含む範囲は、この区では出ない前提。
      // 出たら解釈が一意に決まらないので止める。
      if (a < 0 || b < 0) throw new Error(`曜日の範囲が読めない: "${part}"`);
      if (b <= a) throw new Error(`曜日の範囲が逆か週をまたぐ: "${part}"`);
      if (ORDER[a] === '日' || ORDER[b] === '日') throw new Error(`日曜を含む範囲: "${part}"`);
      for (let i = a; i <= b; i++) out.push(i);
      continue;
    }
    if (!(part in DAY_IDX)) throw new Error(`曜日が読めない: "${part}" (セル "${cell}")`);
    out.push(DAY_IDX[part]);
  }
  if (!out.length) throw new Error(`曜日が取れない: "${cell}"`);
  if (new Set(out).size !== out.length) throw new Error(`曜日が重複: "${cell}"`);
  return out.sort((a, b) => a - b);
}

/**
 * HTML の表 → 行の配列。rowspan を展開する。
 * **音と町名は別々に繰り越す** — 銀座の行は両方欠け、蛎殻町2丁目は音だけ欠ける。
 */
export function parseTable(tableHtml) {
  const trs = tableHtml.match(/<tr[\s\S]*?<\/tr>/g) ?? [];
  if (!trs.length) throw new Error('表に <tr> が無い');

  const head = [...trs[0].matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/g)]
    .map((m) => norm(unescape(m[1].replace(/<[^>]+>/g, ''))));
  const want = ['音', '町名', '丁目', '燃やすごみ', '燃やさないごみ', 'プラマーク', '資源', '粗大ごみ'];
  if (head.join('|') !== want.join('|')) throw new Error(`表の見出しが想定と違う: ${head.join('|')}`);

  // rowspan を格子へ展開する。carry[col] = { html, left }
  const carry = [];
  const rows = [];
  for (const tr of trs.slice(1)) {
    const cells = [...tr.matchAll(/<t[hd]([^>]*)>([\s\S]*?)<\/t[hd]>/g)]
      .map((m) => ({ attrs: m[1], html: m[2] }));
    const line = [];
    let ci = 0;
    for (let col = 0; col < want.length; col++) {
      if (carry[col] && carry[col].left > 0) {
        line.push(carry[col].html);
        carry[col].left -= 1;
        continue;
      }
      if (ci >= cells.length) throw new Error(`列が足りない行: ${tr.slice(0, 80)}`);
      const c = cells[ci++];
      const rs = /rowspan="(\d+)"/.exec(c.attrs);
      if (rs && Number(rs[1]) > 1) carry[col] = { html: c.html, left: Number(rs[1]) - 1 };
      line.push(c.html);
    }
    if (ci !== cells.length) throw new Error(`列が余る行 (${cells.length} セル): ${tr.slice(0, 80)}`);

    // 列ごとに <br> の扱いを変える
    const text = (html, br) => norm(unescape(html.replace(/<br\s*\/?>/gi, br).replace(/<[^>]+>/g, '')));
    const [on, town, chome, ...rest] = line;
    rows.push({
      on: text(on, ''),
      town: text(town, ''),
      chome: text(chome, ''),          // 折り返し → 詰める
      days: rest.map((h) => text(h, '・')),  // 区切り → ・ を補う
    });
  }
  if (!rows.length) throw new Error('表にデータ行が無い');
  return rows;
}

/** ページ全体 → 地域ごとの行 [{ areaJa, rows }]。 */
export function parsePage(html, areasJa) {
  const body = html.replace(/<script[\s\S]*?<\/script>/g, '');
  const tables = body.match(/<table[\s\S]*?<\/table>/g) ?? [];
  if (tables.length !== areasJa.length) {
    throw new Error(`表が ${tables.length} 枚 (${areasJa.length} 枚のはず)`);
  }
  return tables.map((t, i) => ({ areaJa: areasJa[i], rows: parseTable(t) }));
}

/**
 * 丁目セル → area の並び。
 *   「全域」        → [{ chome: null, banchi: null }]     (町全体)
 *   「1丁目」       → [{ chome: 1 }]
 *   「1～2丁目」     → [{ chome: 1 }, { chome: 2 }]
 *   「2丁目1～14番」  → [{ chome: 2, banchi: '1～14番' }]
 *   「1～2番、7～21番」→ [{ chome: null, banchi: '1～2番、7～21番' }]  (丁目の無い町の番地割れ)
 *   ""            → [{ chome: null, banchi: null }]     (浜離宮庭園)
 */
export function splitChome(cell) {
  const t = norm(cell);
  if (t === '' || t === '全域') return [{ chome: null, banchi: null }];

  // 丁目 + 番地
  const withBan = /^(\d+)丁目(.+番)$/.exec(t);
  if (withBan) return [{ chome: Number(withBan[1]), banchi: withBan[2] }];

  // 丁目の範囲・列挙
  const chomeOnly = /^((?:\d+(?:～\d+)?)(?:・\d+(?:～\d+)?)*)丁目$/.exec(t);
  if (chomeOnly) {
    const out = [];
    for (const part of chomeOnly[1].split('・')) {
      const r = /^(\d+)(?:～(\d+))?$/.exec(part);
      const from = Number(r[1]);
      const to = r[2] === undefined ? from : Number(r[2]);
      if (to < from) throw new Error(`丁目の範囲が逆: "${cell}"`);
      for (let n = from; n <= to; n++) out.push({ chome: n, banchi: null });
    }
    const seen = out.map((x) => x.chome);
    if (new Set(seen).size !== seen.length) throw new Error(`丁目が重複: "${cell}"`);
    return out;
  }

  // 丁目を持たない町の番地割れ (小伝馬町の「1～2番、7～21番」)。
  // 「N番」か「N～M番」を「、」で並べた形だけを認める。
  if (/^\d+(?:～\d+)?番(?:、\d+(?:～\d+)?番)*$/.test(t)) return [{ chome: null, banchi: t }];

  throw new Error(`丁目セルが読めない: "${cell}"`);
}

/** area の表示名。番地で割れる町は判別子を name に残す (横浜・板橋の規約)。 */
export function areaName(town, { chome, banchi }) {
  if (chome === null && banchi === null) return town;
  if (chome === null) return `${town}${banchi}`;
  return banchi ? `${town}${chome}丁目${banchi}` : `${town}${chome}丁目`;
}

/** 行 → 照合キー (5 品目ぶんの曜日)。粗大を含む。 */
export const ruleKey = (days) => days.map((d) => parseDays(d).join(',')).join('|');
