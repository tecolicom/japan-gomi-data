// みなかみ町カレンダー PDF の読み取り (extract.py が出した語と記号の座標 → 構造)。
//
// 1 枚の PDF は上半分が「収集曜日・記号・分別区分」の表、下半分が 6 か月の日付表。
//   表      … 規則を文で書いている (「毎週火・金曜」「毎月第1・3木曜」「1月は第2・4金曜」)
//   日付表  … 月ごとの暦に ■ ▲ 衣 の印だけを打つ。毎週の品目 (●・プラ/燃やせない) には印が無い
//
// 版ごとに全体が数 pt ずれるので座標を固定しない。表の行は、品目列の語が決まった順に並ぶこと
// (生ごみ → 燃やせるごみ → プラスチック → … → 衣類) を手がかりに区切る。
import { zen2han, DAY_JA } from '../../_lib/jp.mjs';
import { parsePeriod } from '../../_lib/schedule.mjs';

// 表の行。labels は品目列に上から並ぶ語。cats は同じ並びの正典 category
export const ROWS = [
  { key: 'burn', symbol: '●', labels: ['生ごみ', '燃やせるごみ'], cats: ['kitchen', 'burnable'] },
  { key: 'plastic', symbol: null, labels: ['プラスチック', '燃やせないごみ'], cats: ['plastic', 'non_burnable'] },
  { key: 'square', symbol: '■', labels: ['かん', 'びん', 'ペットボトル'], cats: ['beverage_can', 'glass_bottle', 'pet_bottle'] },
  { key: 'triangle', symbol: '▲', labels: ['電池類', '蛍光管類', '古紙類'], cats: ['hazardous', 'hazardous', 'paper'] },
  { key: 'cloth', symbol: '衣', labels: ['衣類'], cats: ['cloth'] },
];
// 日付表の印 → その行の品目
export const MARK_ROW = { '■': 'square', '▲': 'triangle', '衣': 'cloth' };

const SYMBOLS = new Set(['●', '■', '▲', '衣']);
const WD = '日月火水木金土';

// 表の外の注記 (※) として知っているもの。知らない注記は throw する (日程に効くかもしれないので)
const KNOWN_NOTE = [/^※収集日の/, /^※指定袋には/];
// 「※須田貝・青木沢地区のプラスチックは毎週火曜日に収集します。」
const PLASTIC_NOTE = /^※(.+?)地区のプラスチックは毎週([日月火水木金土])曜日に収集します。$/;

const norm = (s) => zen2han(s).replace(/[\s　]+/g, '');

// 同じ高さの語を 1 行にまとめる (左から順に連結)
function toLines(words, tol = 2.5) {
  const sorted = [...words].sort((a, b) => a.top - b.top || a.x0 - b.x0);
  const lines = [];
  for (const w of sorted) {
    const line = lines.find((l) => Math.abs(l.top - w.top) <= tol);
    if (line) line.words.push(w);
    else lines.push({ top: w.top, words: [w] });
  }
  for (const l of lines) {
    l.words.sort((a, b) => a.x0 - b.x0);
    l.x0 = l.words[0].x0;
    l.text = l.words.map((w) => w.text).join('');
  }
  return lines;
}

// 月見出し (「１０月」…) の語。日付表の位置決めに使う。
// 字の大きさでは選べない (tsukiyono_1 は 1〜3 月の見出しが 10.6pt で日番号 11.8pt より小さい)。
// すぐ下に曜日見出しの「日」があることで見分ける
function monthHeaders(words) {
  return words.filter((w) => /^\d{1,2}月$/.test(norm(w.text))
    && words.some((s) => s.text === '日' && s.top - w.top > 3 && s.top - w.top < 25
      && s.x0 - w.x0 > -5 && s.x0 - w.x0 < 30));
}

// 日付表の下の注記。月夜野は集積所の一覧で、日程の情報は無い
const KNOWN_FOOTER = [/^※資源ごみ、古紙類、燃やせないごみの収集場所$/];

// 見出し「令和８年度 水上地区ごみ収集カレンダー 藤原・粟沢・綱子・幸知」
export function parseTitle(words) {
  const heads = words.filter((w) => /^(.+)地区ごみ収集カレンダー$/.test(w.text));
  if (heads.length !== 1) throw new Error(`見出しが ${heads.length} 個`);
  const h = heads[0];
  const district = /^(.+)地区ごみ収集カレンダー$/.exec(h.text)[1];
  const same = words.filter((w) => Math.abs(w.top - h.top) < 1.5 && w.size === h.size);
  const edition = same.filter((w) => w.x1 <= h.x0).map((w) => w.text).join('');
  const areasText = same.filter((w) => w.x0 >= h.x1).sort((a, b) => a.x0 - b.x0).map((w) => w.text).join('');
  if (!areasText) throw new Error('見出しに地区名が無い');
  return { edition, district, areasText, areaNames: areasText.split('・') };
}

// 期間内で月 m の年を決める (収録期間は 12 か月以内なので一意)
function yearOf(period, m) {
  const { from, to } = parsePeriod(period);
  const [fy, fm] = from.split('-').map(Number);
  const [ty] = to.split('-').map(Number);
  for (let y = fy; y <= ty; y++) {
    const ym = `${y}-${String(m).padStart(2, '0')}`;
    if (ym >= from && ym <= to) return y;
  }
  throw new Error(`${m}月は収録期間 ${period} の外 (${fm}月始まり)`);
}
const isoOf = (y, m, d) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
const nths = (s) => s.split('・').map(Number);

// 「収集曜日」列の 1 行を解釈する。知らない表記は throw
export function parseScheduleLine(raw, period) {
  const t = norm(raw);
  let m;
  if ((m = /^毎週([日月火水木金土](?:・[日月火水木金土])*)曜$/.exec(t))) {
    return { type: 'weekly', days: m[1].split('・').map((c) => DAY_JA[c]) };
  }
  if ((m = /^(\d{1,2})月(\d{1,2})日[をは]除く$/.exec(t))) {
    const mo = Number(m[1]);
    return { type: 'exclude', date: isoOf(yearOf(period, mo), mo, Number(m[2])) };
  }
  if ((m = /^毎月第(\d(?:・\d)*)([日月火水木金土])曜$/.exec(t))) {
    return { type: 'nth', occurrences: nths(m[1]), day: DAY_JA[m[2]] };
  }
  if ((m = /^(\d{1,2})月は第(\d(?:・\d)*)([日月火水木金土])曜$/.exec(t))) {
    return { type: 'month_nth', month: Number(m[1]), occurrences: nths(m[2]), day: DAY_JA[m[3]] };
  }
  if ((m = /^(\d{1,2})月と(\d{1,2})月の第(\d)([日月火水木金土])曜$/.exec(t))) {
    return { type: 'months_nth', months: [Number(m[1]), Number(m[2])], occurrences: [Number(m[3])], day: DAY_JA[m[4]] };
  }
  throw new Error(`収集曜日の表記を解釈できない: "${raw}"`);
}

// 行ごとの収集曜日の文 → その行の日程の定義
//   weekly … { kind: 'weekly', days, exclude: [{ date, text }] }
//   nth    … { kind: 'nth', day, occurrences, months: { [m]: { day, occurrences, text } } }
//   months … { kind: 'months', months, day, occurrences }
function rowSchedule(row, lines, period) {
  const parsed = lines.map((l) => ({ ...parseScheduleLine(l.text, period), text: norm(l.text) }));
  const of = (type) => parsed.filter((p) => p.type === type);
  const only = (types) => {
    const bad = parsed.filter((p) => !types.includes(p.type));
    if (bad.length) throw new Error(`${row.labels.join('・')}: この行に来ない表記 "${bad[0].text}"`);
  };
  if (row.key === 'burn' || row.key === 'plastic') {
    only(['weekly', 'exclude']);
    if (of('weekly').length !== 1) throw new Error(`${row.labels.join('・')}: 毎週の表記が ${of('weekly').length} 個`);
    return { kind: 'weekly', days: of('weekly')[0].days, exclude: of('exclude').map(({ date, text }) => ({ date, text })) };
  }
  if (row.key === 'square' || row.key === 'triangle') {
    only(['nth', 'month_nth']);
    if (of('nth').length !== 1) throw new Error(`${row.labels.join('・')}: 毎月の表記が ${of('nth').length} 個`);
    const { day, occurrences } = of('nth')[0];
    const months = {};
    for (const p of of('month_nth')) {
      if (months[p.month]) throw new Error(`${row.labels.join('・')}: ${p.month}月の例外が 2 つある`);
      months[p.month] = { day: p.day, occurrences: p.occurrences, text: p.text };
    }
    return { kind: 'nth', day, occurrences, months };
  }
  only(['months_nth']);
  if (parsed.length !== 1) throw new Error(`衣類: 表記が ${parsed.length} 個`);
  const { months, day, occurrences } = parsed[0];
  return { kind: 'months', months, day, occurrences };
}

// 上半分の表 → { rows: Map<key, schedule>, notes: [※注記], plasticNote? }
export function parseTable(words, period) {
  const gridTop = Math.min(...monthHeaders(words).map((w) => w.top));
  const upper = words.filter((w) => w.top < gridTop - 5);

  const syms = upper.filter((w) => SYMBOLS.has(w.text));
  const dot = syms.filter((w) => w.text === '●');
  if (dot.length !== 1) throw new Error(`表の ● が ${dot.length} 個`);
  const symX = dot[0].x0;

  // 品目列: 記号列のすぐ右。並び順そのものを検査する
  const allLabels = ROWS.flatMap((r) => r.labels);
  const labelWords = upper
    .filter((w) => allLabels.includes(w.text) && w.x0 > symX + 15 && w.x0 < symX + 90)
    .sort((a, b) => a.top - b.top);
  const got = labelWords.map((w) => w.text);
  if (got.join(',') !== allLabels.join(',')) {
    throw new Error(`品目列の並びが想定と違う: ${got.join(',')}`);
  }
  // 行の上端・下端 = 隣の行の品目語との中点
  let i = 0;
  const bands = ROWS.map((r) => {
    const ws = labelWords.slice(i, i + r.labels.length);
    i += r.labels.length;
    return { row: r, first: ws[0].top, last: ws[ws.length - 1].top };
  });
  bands.forEach((b, k) => {
    b.lo = k === 0 ? b.first - 12 : (bands[k - 1].last + b.first) / 2;
    b.hi = k === bands.length - 1 ? b.last + 12 : (b.last + bands[k + 1].first) / 2;
  });
  const bandOf = (top) => bands.find((b) => top >= b.lo && top < b.hi);

  // 記号列: 各行に決まった記号が 1 つ (水曜の行だけ記号なし)
  for (const b of bands) {
    const here = syms.filter((w) => w.x0 < symX + 15 && w.top >= b.lo && w.top < b.hi).map((w) => w.text);
    const want = b.row.symbol ? [b.row.symbol] : [];
    if (here.join() !== want.join()) {
      throw new Error(`${b.row.labels.join('・')} の記号が [${here}] (想定 [${want}])`);
    }
  }

  // 収集曜日列: 記号列より左
  const schedWords = upper.filter((w) => w.x0 < symX - 20 && bandOf(w.top) && !w.text.startsWith('※'));
  const rows = new Map();
  for (const b of bands) {
    const lines = toLines(schedWords.filter((w) => bandOf(w.top) === b));
    if (!lines.length) throw new Error(`${b.row.labels.join('・')}: 収集曜日が無い`);
    rows.set(b.row.key, rowSchedule(b.row, lines, period));
  }

  // ※ の注記 (表の左半分。右側の搬入施設の注記は対象外)
  const notes = toLines(upper.filter((w) => w.x0 < 700))
    .filter((l) => l.text.startsWith('※')).map((l) => l.text);
  let plasticNote = null;
  for (const n of notes) {
    if (KNOWN_NOTE.some((re) => re.test(n))) continue;
    const m = PLASTIC_NOTE.exec(n);
    if (m && !plasticNote) {
      plasticNote = { text: n, areaNames: m[1].split('・'), day: DAY_JA[m[2]] };
      continue;
    }
    throw new Error(`知らない注記: "${n}"`);
  }
  return { rows, notes, plasticNote };
}

// 下半分の日付表 → Map<iso, 印の配列>。暦との整合 (日数・曜日) を全部 assert する
export function parseGrid(doc, period) {
  const { words, marks } = doc;
  const heads = monthHeaders(words);
  const { from, to } = parsePeriod(period);
  const wantMonths = [];
  for (let d = new Date(`${from}-01T00:00:00`); ; d.setMonth(d.getMonth() + 1)) {
    const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    if (ym > to) break;
    wantMonths.push(d.getMonth() + 1);
  }
  const gotMonths = heads.map((w) => Number(norm(w.text).replace('月', '')));
  if ([...gotMonths].sort((a, b) => a - b).join() !== [...wantMonths].sort((a, b) => a - b).join()) {
    throw new Error(`日付表の月が [${gotMonths}] (収録期間は [${wantMonths}])`);
  }

  // 日付表より下の ※ 注記。ここから下は日付表ではない
  const gridTop = Math.min(...heads.map((w) => w.top));
  const footer = toLines(words.filter((w) => w.top > gridTop && w.x0 < 700))
    .filter((l) => l.text.startsWith('※'));
  for (const l of footer) {
    if (!KNOWN_FOOTER.some((re) => re.test(l.text))) throw new Error(`日付表の下に知らない注記: "${l.text}"`);
  }

  const out = new Map();
  const usedMarks = new Set();
  for (const h of heads) {
    const month = Number(norm(h.text).replace('月', ''));
    const year = yearOf(period, month);
    const below = [...heads, ...footer].filter((o) => o.top > h.top + 20).map((o) => o.top);
    const yMax = below.length ? Math.min(...below) - 5 : Infinity;

    // 曜日見出し 日〜土
    const wdh = words
      .filter((w) => WD.includes(w.text) && w.text.length === 1 && w.top > h.top && w.top < h.top + 25
        && w.x0 > h.x0 - 20 && w.x0 < h.x0 + 290)
      .sort((a, b) => a.x0 - b.x0);
    if (wdh.map((w) => w.text).join('') !== WD) throw new Error(`${month}月: 曜日見出しが "${wdh.map((w) => w.text).join('')}"`);
    const cx = wdh.map((w) => (w.x0 + w.x1) / 2);
    const colOf = (x, tol) => {
      const k = cx.reduce((best, c, j) => (Math.abs(c - x) < Math.abs(cx[best] - x) ? j : best), 0);
      return Math.abs(cx[k] - x) <= tol ? k : -1;
    };
    const xLo = cx[0] - 18, xHi = cx[6] + 18;
    const yLo = wdh[0].top + 5;
    const inBlock = (o) => o.top > yLo && o.top < yMax && (o.x0 + o.x1) / 2 > xLo && (o.x0 + o.x1) / 2 < xHi;

    // 日番号
    const cells = []; // { top, col, day }
    for (const w of words.filter(inBlock)) {
      const t = norm(w.text);
      if (/^\d{1,2}$/.test(t)) {
        const col = colOf((w.x0 + w.x1) / 2, 12);
        if (col < 0) throw new Error(`${month}月: 日番号 ${t} の列が決まらない (x=${w.x0})`);
        cells.push({ top: w.top, col, day: Number(t) });
      } else if (!/^[■▲衣]+$/.test(t)) {
        throw new Error(`${month}月の日付表に知らない語 "${w.text}"`);
      }
    }
    const dim = new Date(year, month, 0).getDate();
    const days = cells.map((c) => c.day).sort((a, b) => a - b);
    if (days.join() !== Array.from({ length: dim }, (_, k) => k + 1).join()) {
      throw new Error(`${month}月: 日番号が 1..${dim} になっていない (${days.length} 個)`);
    }
    for (const c of cells) {
      const dow = new Date(year, month - 1, c.day).getDay();
      if (dow !== c.col) throw new Error(`${year}-${month}-${c.day}: ${WD[c.col]}曜の列にある (暦では${WD[dow]}曜)`);
      out.set(isoOf(year, month, c.day), []);
    }

    // 印: 同じ列で、すぐ上の日番号の日に付ける
    for (const mk of marks.filter(inBlock)) {
      if (mk.ch === '●') throw new Error(`${month}月の日付表に ● がある`);
      const col = colOf((mk.x0 + mk.x1) / 2, 14);
      if (col < 0) throw new Error(`${month}月: 印 ${mk.ch} の列が決まらない (x=${mk.x0})`);
      const above = cells.filter((c) => c.col === col && mk.top - c.top > 3 && mk.top - c.top < 22);
      if (above.length !== 1) throw new Error(`${month}月: 印 ${mk.ch} (x=${mk.x0}, top=${mk.top}) の日が決まらない`);
      const key = isoOf(year, month, above[0].day);
      if (out.get(key).includes(mk.ch)) throw new Error(`${key}: 印 ${mk.ch} が 2 つある`);
      out.get(key).push(mk.ch);
      usedMarks.add(mk);
    }
  }
  // 日付表のどこにも属さない ■ ▲ (表の外に打たれた印) は凡例以外に無いはず
  const stray = marks.filter((mk) => mk.ch !== '●' && mk.top > gridTop && !usedMarks.has(mk));
  if (stray.length) throw new Error(`日付表の外に印がある: ${stray.map((m) => `${m.ch}@${m.x0},${m.top}`).join(' ')}`);
  return out;
}
