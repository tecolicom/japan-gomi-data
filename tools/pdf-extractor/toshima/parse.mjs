// extract.py の JSON → 町丁名の分解と rules 化。
//
// 表の 1 行は 2 種類ある。
//   a. 丁目だけの行     「池袋1・4丁目」「駒込1～7丁目」 → 丁目ごとの area に**分解する**
//   b. 番地つきの行     「要町1丁目1番～8番」            → 1 行 = 1 area (判別子が name に入る)
// 分解するのは倉敷の教訓 (下流は居住町名の特定に areas を使うので塊のままだと引けない)。
// b は同じ丁目が複数コースに割れているので、名前から判別子を落としてはいけない。
import { parseWeeklyJa, parseMonthlyNthJa } from '../../_lib/jp.mjs';
import { COLUMNS, CAT_ORDER } from './sources.mjs';

// 「<町名><丁目リスト>丁目」だけの行 (番地が付かない)
const PLAIN_RE = /^(?<town>[^0-9]+?)(?<chome>[0-9]+(?:[・～][0-9]+)*)丁目$/;
// 番地つきの行。先頭の「<町名><n>丁目」だけ取る
const HEAD_RE = /^(?<town>[^0-9]+?)(?<chome>[0-9]+)丁目/;

// "1・4" → [1,4] / "1～7" → [1,2,3,4,5,6,7]
function chomeList(spec) {
  const out = [];
  for (const part of spec.split('・')) {
    const m = /^([0-9]+)(?:～([0-9]+))?$/.exec(part);
    if (!m) throw new Error(`丁目の並びが読めない: "${spec}"`);
    const from = Number(m[1]);
    const to = m[2] === undefined ? from : Number(m[2]);
    if (to < from) throw new Error(`丁目の範囲が逆: "${part}"`);
    for (let n = from; n <= to; n++) out.push(n);
  }
  if (new Set(out).size !== out.length) throw new Error(`丁目が重複: "${spec}"`);
  return out;
}

// 町丁名 → [{ name, town, chome, banchi }]
// banchi は「その丁目の一部」を表す文字列 (無ければ null)。
export function splitAreas(name) {
  const plain = PLAIN_RE.exec(name);
  if (plain) {
    const { town, chome } = plain.groups;
    return chomeList(chome).map((n) => ({ name: `${town}${n}丁目`, town, chome: n, banchi: null }));
  }
  const head = HEAD_RE.exec(name);
  if (!head) throw new Error(`町丁名が「<町名><n>丁目…」の形でない: "${name}"`);
  const { town, chome } = head.groups;
  return [{ name, town, chome: Number(chome), banchi: name.slice(head[0].length) }];
}

// 並べ替え用の読み。町名のかな + 丁目 + 最初の番地番号 (荒川の先例に合わせる)。
export function areaYomi(kana, area) {
  if (!kana) return null;
  const first = area.banchi ? /[0-9]+/.exec(area.banchi) : null;
  return `${kana}${area.chome}${first ? `-${first[0]}` : ''}`;
}

// 曜日セル 4 つ → rules。1 列が複数カテゴリに対応する列は days 配列を共有させる
// (YAML anchor になり「同じ日に出す」ことが生成物の上で明示される)。
export function cellsToRules(cells) {
  if (cells.length !== COLUMNS.length) throw new Error(`列数が ${cells.length} (${COLUMNS.length} のはず)`);
  const rules = [];
  cells.forEach((cell, i) => {
    const col = COLUMNS[i];
    if (col.pattern === 'weekly') {
      const days = parseWeeklyJa(cell);
      for (const category of col.categories) rules.push({ category, pattern: 'weekly', days });
    } else {
      const { occurrences, days } = parseMonthlyNthJa(cell);
      for (const category of col.categories) {
        rules.push({ category, pattern: 'monthly_nth', occurrences, days });
      }
    }
  });
  for (const r of rules) {
    if (!CAT_ORDER.includes(r.category)) throw new Error(`CAT_ORDER に無い品目 "${r.category}"`);
  }
  rules.sort((a, b) => CAT_ORDER.indexOf(a.category) - CAT_ORDER.indexOf(b.category));
  return rules;
}

// 番地の記述 → 番の範囲。「、」で区切るが括弧の中では切らない。
//
//   "1番～13番、14番（5号、8号以外）、15番1号"
//     → [{1-13 限定なし}, {14-14 限定あり}, {15-15 限定あり}]
//
// **限定の有無を持つのが要点。** 豊島区は同じ番を「4番（要町通り沿い）」と
// 「4番（要町通り沿い以外）」のように号や通り沿いで割っており、番だけ見ると必ず重なる。
// 重なりが問題になるのは**どちらにも限定が付いていないとき**だけ。
export function banchiItems(banchi) {
  const items = [];
  const unparsed = [];
  let depth = 0, buf = '';
  const flush = () => {
    const tok = buf.trim();
    buf = '';
    if (!tok) return;
    const range = /^([0-9]+)番?～([0-9]+)番(.*)$/.exec(tok);
    const single = /^([0-9]+)番(.*)$/.exec(tok);
    if (range) items.push({ from: +range[1], to: +range[2], qualified: range[3] !== '' });
    else if (single) items.push({ from: +single[1], to: +single[1], qualified: single[2] !== '' });
    else unparsed.push(tok);
  };
  for (const ch of banchi) {
    if (ch === '（') depth++;
    else if (ch === '）') depth--;
    if (ch === '、' && depth === 0) flush();
    else buf += ch;
  }
  flush();
  return { items, unparsed };
}

// 2 つの番地記述のうち「どちらにも限定が付いていないのに番が重なる」組を返す。
export function bareOverlaps(a, b) {
  const out = [];
  for (const x of a.items) {
    if (x.qualified) continue;
    for (const y of b.items) {
      if (y.qualified) continue;
      if (x.from <= y.to && y.from <= x.to) out.push([x.from, x.to, y.from, y.to]);
    }
  }
  return out;
}

// 同じ日に別の品目が重ならないことの確認。
// 「金属・陶器・ガラスごみ」(monthly_nth) が他の列の曜日と重なると、
// その日は 2 種類が同時に出ることになる。豊島区の表ではそれが起きる組み合わせが
// 実在する (例: 燃やすごみ 月・木 と 第1・3木) ので**禁止はしない**が、
// 重なりの有無を数えて build のログに出し、黙って通さない。
export function overlapCount(rules) {
  const weeklyDays = new Set();
  for (const r of rules) if (r.pattern === 'weekly') for (const d of r.days) weeklyDays.add(d);
  let n = 0;
  for (const r of rules) {
    if (r.pattern !== 'monthly_nth') continue;
    for (const d of r.days) if (weeklyDays.has(d)) n++;
  }
  return n;
}
