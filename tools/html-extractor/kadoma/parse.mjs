// 門真市の一次ソースの読み取り。
//
// - parseIndex: 地区別ごみカレンダーページ (HTML) → 地区ごとの町名と、品目ごとの収集曜日の文
// - expandTowns: 町名の列挙 (「岸和田1丁目～4丁目」「北巣本町(1番～34番)」) → area 名
// - parseRule: 収集曜日の文 (「毎週火曜日・金曜日」「毎月第1・3水曜日」) → 規則
// - parseCalendar: 地区別 PDF の座標 (extract.py の出力) → 日付ごとの品目
import { DAY_TO_INDEX, parseWeeklyJa, parseMonthlyNthJa, zen2han } from '../../_lib/jp.mjs';
import { parsePeriod, nthOfMonth } from '../../_lib/schedule.mjs';

// HTML の表の品目 (行の並びは全地区共通)。cats は収録する正典語彙。粗大ごみは要予約・有料なので収録しないが、
// PDF の印との照合には使う (key で扱う)
export const ROWS = [
  { key: 'futsu', label: '普通ごみ', cats: ['burnable'] },
  { key: 'pura', label: 'プラスチック製容器包装', cats: ['plastic'] },
  { key: 'binkan', label: 'びん・缶類', cats: ['glass_bottle', 'beverage_can'] },
  { key: 'koshi', label: '古紙古布', cats: ['paper_cloth'] },
  { key: 'kogata', label: '小型ごみ', cats: ['non_burnable'] },
  { key: 'pet', label: 'ペットボトル', cats: ['pet_bottle'] },
  { key: 'sodai', label: '粗大ごみ', cats: [] },
];

// PDF の凡例 (アイコンの下の品目名) の左からの並び。HTML の品目と同じ 7 つ
export const LEGEND_ORDER = ['futsu', 'pura', 'binkan', 'koshi', 'kogata', 'pet', 'sodai'];

const stripTags = (s) => s.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ');

// HTML → [{ district, townsText, rows: Map<key, 文> }]
export function parseIndex(html) {
  const out = [];
  const re = /<h3>(?:<span[^>]*>)+([A-Z])地区(?:<\/span>)+<\/h3>([\s\S]*?)(?=<h3>|<\/article>)/g;
  for (const m of html.matchAll(re)) {
    const [, district, body] = m;
    const p = body.match(/<div class="wysiwyg">\s*<p>([\s\S]*?)<\/p>\s*<\/div>/);
    if (!p) throw new Error(`${district}地区: 町名の段落が無い`);
    const cap = body.match(/<caption>([^<]*)<\/caption>/);
    if (cap?.[1] !== `${district}地区の収集日`) throw new Error(`${district}地区: 表の見出しが「${cap?.[1]}」`);
    const rows = new Map();
    for (const [, th, td] of body.matchAll(/<th scope="row">([\s\S]*?)<\/th>\s*<td>([\s\S]*?)<\/td>/g)) {
      const row = ROWS.find((r) => r.label === stripTags(th).trim());
      if (!row) throw new Error(`${district}地区: 知らない品目「${stripTags(th).trim()}」`);
      if (rows.has(row.key)) throw new Error(`${district}地区: 品目「${row.label}」が 2 行ある`);
      rows.set(row.key, stripTags(td).trim());
    }
    for (const r of ROWS) if (!rows.has(r.key)) throw new Error(`${district}地区: 品目「${r.label}」の行が無い`);
    const h4 = body.match(/<h4>(?:<span[^>]*>)+([^<]*)(?:<\/span>)+<\/h4>/);
    out.push({ district, townsText: stripTags(p[1]), rows, calendarTitle: h4?.[1] });
  }
  return out;
}

// 町名の列挙 → area 名の配列。丁目の範囲は 1 丁目ずつに展開する。番地で分かれる町は「町名（判別子）」
export function expandTowns(text) {
  const out = [];
  for (const raw of zen2han(text).split('、')) {
    const t = raw.trim();
    if (!t) throw new Error(`町名の列挙に空の項目がある: "${text}"`);
    let m;
    if ((m = t.match(/^(\D+?)(\d+)丁目～(\d+)丁目$/))) {
      const [a, b] = [Number(m[2]), Number(m[3])];
      if (!(a < b)) throw new Error(`丁目の範囲が逆: "${t}"`);
      for (let n = a; n <= b; n++) out.push(`${m[1]}${n}丁目`);
    } else if ((m = t.match(/^(\D+?)\((\d+)番～(\d+)番\)$/))) {
      out.push(`${m[1]}（${m[2]}番～${m[3]}番）`);
    } else if (/^[^\d()（）～〜・]+$/.test(t)) {
      out.push(t);
    } else {
      throw new Error(`解釈できない町名: "${t}"`);
    }
  }
  return out;
}

// 収集曜日の文 → { pattern: 'weekly', days } | { pattern: 'monthly_nth', days, occurrences }
export function parseRule(text) {
  const t = zen2han(text).trim();
  if (/^毎週[日月火水木金土]曜日(・[日月火水木金土]曜日)*$/.test(t)) {
    const body = t.replace(/^毎週/, '');
    const days = parseWeeklyJa(body);
    // parseWeeklyJa は読めない片を黙って落とすので、曜日の数を数え直す
    if (days.length !== body.split('・').length) throw new Error(`曜日を読み落とした: "${text}"`);
    return { pattern: 'weekly', days };
  }
  if (/^毎月第\d(・\d)*[日月火水木金土]曜日$/.test(t)) {
    const { occurrences, days } = parseMonthlyNthJa(t);
    return { pattern: 'monthly_nth', days, occurrences };
  }
  throw new Error(`解釈できない収集日: "${text}"`);
}

// 規則がその日に当たるか
export function ruleHits(rule, iso) {
  const d = new Date(iso + 'T00:00:00');
  if (!rule.days.some((w) => DAY_TO_INDEX[w] === d.getDay())) return false;
  return rule.pattern === 'weekly' || rule.occurrences.includes(nthOfMonth(d));
}

// ---- PDF ----

// 日番号の色 (黒・日祝の赤・土曜の青 2 種) と背景の淡色。品目名ではないので除く
const BLACK = [0.135, 0.094, 0.082];
const RED = [0.908, 0.195, 0.191];
const CREAM = [0.959, 0.942, 0.887];
const SAT_BLUE = [0, 0.645, 0.871];
const SAT_BLUE2 = [0, 0.638, 0.733];
const same = (a, b) => a.every((v, i) => Math.abs(v - b[i]) < 0.002);
const isNumberColor = (c) => same(c, BLACK) || same(c, RED) || same(c, SAT_BLUE) || same(c, SAT_BLUE2);
const dist = (a, b) => Math.hypot(...a.map((v, i) => v - b[i]));
const cx = (s) => (s.x0 + s.x1) / 2;
const cy = (s) => (s.top + s.bottom) / 2;

// マスの上端から日番号の帯までの高さ (pt)。品目名はこれより下にある (実測: 日番号 3〜12、品目名 17〜39)
const NUMBER_BAND = 14;
const MIN_GLYPHS = 8;

// 同じ字形が 0.2pt ほどずらして 2 重に描かれていることがある (C 地区の 8 月・12 月の「びん・缶類」)。
// 同じ色でほぼ同じ位置・大きさの図形を 1 つに畳む
const NEAR = 0.5;
function dedupe(shapes) {
  const out = [];
  for (const s of shapes) {
    const dup = out.some((o) => same(o.c, s.c) && Math.abs(o.x0 - s.x0) < NEAR && Math.abs(o.x1 - s.x1) < NEAR
      && Math.abs(o.top - s.top) < NEAR && Math.abs(o.bottom - s.bottom) < NEAR);
    if (!dup) out.push(s);
  }
  return out;
}

// 罫線の座標を丸めて重複を除く (同じ線が 2 本の rect で描かれている)
function uniqSorted(vals) {
  const out = [];
  for (const v of [...vals].sort((a, b) => a - b)) if (!out.length || v - out.at(-1) > 2) out.push(v);
  return out;
}

// 凡例の品目名: アイコンの下の 1 行 (top 165〜185)。色ごとにまとめ、左から LEGEND_ORDER に当てる
function parseLegend(page) {
  const groups = new Map();
  for (const s of page.shapes) {
    if (s.top < 165 || s.bottom > 185 || s.x0 < 425) continue;
    if (isNumberColor(s.c) || same(s.c, CREAM)) continue;
    const k = s.c.join();
    if (!groups.has(k)) groups.set(k, { c: s.c, x0: s.x0, n: 0 });
    const g = groups.get(k);
    g.x0 = Math.min(g.x0, s.x0);
    g.n++;
  }
  const sorted = [...groups.values()].sort((a, b) => a.x0 - b.x0);
  if (sorted.length !== LEGEND_ORDER.length) {
    throw new Error(`凡例の品目名が ${sorted.length} 色 (${LEGEND_ORDER.length} のはず)`);
  }
  return sorted.map((g, i) => ({ key: LEGEND_ORDER[i], c: g.c, n: g.n }));
}

// 品目名の色 → key。凡例の色に最も近いものを選ぶ。凡例とマスで色が少しずれる地区がある
// (A 地区のプラ容器: 凡例 0.549,0.075,0.484 / マス 0.453,0.201,0.561) ので完全一致は要求しない。
// 2 番目に近い色との差が十分にあることを確かめる
function classify(c, legend, where) {
  const ds = legend.map((l) => ({ key: l.key, d: dist(c, l.c) })).sort((a, b) => a.d - b.d);
  if (ds[0].d > 0.25 || ds[1].d < ds[0].d * 2) {
    throw new Error(`${where}: 品目名の色 ${c} が凡例のどれとも決まらない (${ds[0].key} ${ds[0].d.toFixed(3)} / ${ds[1].key} ${ds[1].d.toFixed(3)})`);
  }
  return ds[0].key;
}

// ページ → 月の枠 6 つ (上の段から、左・右の順)。各枠は 7 列 × (見出し + 5 週)
function monthBoxes(page, where) {
  const half = page.width / 2;
  const boxes = [];
  const tops = uniqSorted(page.vlines.map((v) => v.top));
  if (tops.length !== 3) throw new Error(`${where}: 月の枠の段が ${tops.length} (3 のはず)`);
  for (const top of tops) {
    for (const side of [0, 1]) {
      const inSide = (x) => (side === 0 ? x < half : x >= half);
      const xs = uniqSorted(page.vlines.filter((v) => Math.abs(v.top - top) < 2 && inSide(v.x)).map((v) => v.x));
      const ys = uniqSorted(page.hlines.filter((h) => inSide(h.x0) && h.y > top - 2 && h.y < top + 230).map((h) => h.y));
      if (xs.length !== 8) throw new Error(`${where}: 月の枠の縦線が ${xs.length} 本 (8 のはず)`);
      if (ys.length !== 7) throw new Error(`${where}: 月の枠の横線が ${ys.length} 本 (7 のはず)`);
      boxes.push({ xs, ys });
    }
  }
  return boxes;
}

// extract.py の出力 → Map<iso, Set<key>>。
// 月の並びは、1 ページ目が収録期間の最初の 6 か月、2 ページ目が残りの 6 か月 (上の段から左・右)。
// 日付のマスは暦から決める (日曜始まり、5 週。6 週目の日は 5 週目の同じ曜日のマスに 2 つ並ぶ —
// 2026 年 8 月の「24/31」など)。日番号は図形なので読めないが、「日付のあるマスにだけ日番号の図形がある」ことを
// 確かめて、月の並びと曜日の位置がずれていないことを保証する。
export function parseCalendar(doc, period, where) {
  const p = parsePeriod(period);
  if (!p) throw new Error(`不正な period: ${period}`);
  if (doc.pages.length !== 2) throw new Error(`${where}: ${doc.pages.length} ページ (2 のはず)`);
  const [fy, fm] = p.from.split('-').map(Number);
  const months = [];
  for (let i = 0; i < 12; i++) {
    const m0 = fm - 1 + i;
    months.push({ y: fy + Math.floor(m0 / 12), m: (m0 % 12) + 1 });
  }
  if (`${months[11].y}-${String(months[11].m).padStart(2, '0')}` !== p.to) {
    throw new Error(`${where}: 収録期間 ${period} が 12 か月でない (PDF は 12 か月)`);
  }

  const events = new Map();
  const merged = []; // 2 つの日付が入るマス
  const glyphCounts = new Map(); // key → Set(字形の数)。報告用
  doc.pages.forEach((page, pi) => {
    const legend = parseLegend(page);
    const boxes = monthBoxes(page, `${where} p${pi + 1}`);
    boxes.forEach((box, bi) => {
      const { y, m } = months[pi * 6 + bi];
      const first = new Date(y, m - 1, 1).getDay();
      const last = new Date(y, m, 0).getDate();
      const cells = new Map(); // "row,col" → [iso]
      for (let d = 1; d <= last; d++) {
        const idx = first + d - 1;
        const row = Math.min(Math.floor(idx / 7), 4);
        const key = `${row},${idx % 7}`;
        const iso = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        cells.set(key, [...(cells.get(key) || []), iso]);
      }
      for (let row = 0; row < 5; row++) {
        for (let col = 0; col < 7; col++) {
          const [x0, x1] = [box.xs[col], box.xs[col + 1]];
          const [top, bottom] = [box.ys[row + 1], box.ys[row + 2]];
          const inCell = page.shapes.filter((s) => cx(s) > x0 && cx(s) < x1 && cy(s) > top && cy(s) < bottom);
          const dates = cells.get(`${row},${col}`) || [];
          const cw = `${where} ${y}-${m} ${row + 1}週${'日月火水木金土'[col]}`;
          const numbers = inCell.filter((s) => s.top - top < NUMBER_BAND && isNumberColor(s.c));
          if (dates.length && !numbers.length) throw new Error(`${cw}: 日付 ${dates} のマスに日番号が無い`);
          if (!dates.length && numbers.length) throw new Error(`${cw}: 日付の無いマスに日番号がある`);
          if (!dates.length && inCell.some((s) => !same(s.c, CREAM))) {
            throw new Error(`${cw}: 日付の無いマスに図形がある`);
          }
          const groups = new Map();
          for (const s of dedupe(inCell.filter((s) => s.top - top >= NUMBER_BAND && !isNumberColor(s.c)))) {
            const k = classify(s.c, legend, cw);
            groups.set(k, (groups.get(k) || 0) + 1);
          }
          for (const [k, n] of groups) glyphCounts.set(k, (glyphCounts.get(k) || new Set()).add(n));
          if (dates.length > 1) merged.push({ dates, keys: [...groups.keys()] });
          for (const iso of dates) events.set(iso, new Set(groups.keys()));
        }
      }
    });
  });
  // 品目名は最も短い「古紙・古布」でも 10 個の図形でできている。それより少ない色の塊は品目名ではない
  // (アイコンの一部などを品目と読み違えていないことの確認)。数はマスによって 1 つ前後する
  // (E 地区の 6/3 の「小型ごみ」は 14、ほかは 13) ので、一致までは求めない
  for (const [k, ns] of glyphCounts) {
    if (Math.min(...ns) < MIN_GLYPHS) throw new Error(`${where}: 品目名「${k}」の図形が ${Math.min(...ns)} 個しかないマスがある`);
  }
  return { events, merged, glyphCounts };
}
