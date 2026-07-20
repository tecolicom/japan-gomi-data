// 荒川区配布 CSV (gomi_YYYYMMDD.csv, cp932) のパーサ。
//
// 列: 地区,丁目,番地・号,燃やすごみ,燃やさないごみ,プラスチック,ごみ備考欄,
//     びん・缶、古紙,ペットボトル・発泡スチロール製食品用トレイ,古布,資源備考欄
//
// 「びん・缶、古紙」列は 3 カテゴリ (glass_bottle/beverage_can/paper) の同日収集を表す。
// 例外的に 1 行だけ「古紙：…、びん缶：…」の複合表記があり、古紙だけ別日になる。
import { parseWeeklyJa, parseMonthlyNthJa, normJa } from '../../_lib/jp.mjs';

export const COL = {
  district: '地区',
  chome: '丁目',
  banchi: '番地・号',
  burnable: '燃やすごみ',
  nonBurnable: '燃やさないごみ',
  plastic: 'プラスチック',
  gomiNote: 'ごみ備考欄',
  binKanPaper: 'びん・缶、古紙',
  pet: 'ペットボトル・発泡スチロール製食品用トレイ',
  cloth: '古布',
  shigenNote: '資源備考欄',
};

// 日程として展開できない表記 (集合住宅の個別回収・要問合せ・不定期・空欄)。
// rules から落とし、理由を meta.yaml notes と README に残す。
export const UNSCHEDULABLE = new Set(['個別', 'お問い合わせください', '不定期', '']);

// RFC4180 相当の最小 CSV パーサ (引用符・改行入りセル対応)。
export function parseCsv(text) {
  const src = text.replace(/^﻿/, '').replace(/\r\n/g, '\n');
  const rows = [];
  let row = [], cell = '', quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') { cell += '"'; i++; } else quoted = false;
      } else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  const [header, ...body] = rows;
  const cols = header.map((h) => h.trim());
  return body
    .filter((r) => r.some((v) => v.trim() !== ''))
    .map((r) => Object.fromEntries(cols.map((c, i) => [c, (r[i] ?? '').trim()])));
}

// 「第1・第3の金曜日」「第2・第4の木」→ _lib の parseMonthlyNthJa が読める形へ。
const toLibNth = (t) => normJa(t).replace(/第/g, '').replace(/の(?=[日月火水木金土])/g, '');

// 収集日表記 1 個 → { pattern, days, occurrences } / 展開不能なら null。
export function parseSchedule(text) {
  const t = normJa(text ?? '');
  if (UNSCHEDULABLE.has(t)) return null;
  if (/^第/.test(t)) {
    const { occurrences, days } = parseMonthlyNthJa(toLibNth(t));
    return { pattern: 'monthly_nth', days, occurrences };
  }
  if (/曜/.test(t)) return { pattern: 'weekly', days: parseWeeklyJa(t) };
  throw new Error(`未知の収集日表記: "${text}"`);
}

// 「びん・缶、古紙」列 → [{ categories:[...], sched }] の配列。
// 通常は 3 カテゴリ同日。複合表記「古紙：X、びん缶：Y」のみ分割する。
export function parseBinKanPaper(text) {
  const t = normJa(text ?? '');
  if (t.includes('：')) {
    const out = [];
    for (const part of t.split('、')) {
      const m = part.match(/^(古紙|びん缶)：(.+)$/);
      if (!m) throw new Error(`複合表記のパース失敗: "${text}"`);
      const sched = parseSchedule(m[2]);
      if (!sched) throw new Error(`複合表記に展開不能な日程: "${text}"`);
      out.push({ categories: m[1] === '古紙' ? ['paper'] : ['glass_bottle', 'beverage_can'], sched });
    }
    return out;
  }
  const sched = parseSchedule(t);
  return sched ? [{ categories: ['glass_bottle', 'beverage_can', 'paper'], sched }] : [];
}

// CSV 1 行 → rules 配列 (schema/schedule.schema.json の rules)。
// カテゴリ順は taxonomy と揃える (署名キーの安定のため固定順)。
export function rowToRules(row) {
  const rules = [];
  const push = (category, sched) => { if (sched) rules.push({ category, ...sched }); };

  push('burnable', parseSchedule(row[COL.burnable]));
  push('non_burnable', parseSchedule(row[COL.nonBurnable]));
  push('plastic', parseSchedule(row[COL.plastic]));
  for (const { categories, sched } of parseBinKanPaper(row[COL.binKanPaper])) {
    for (const c of categories) push(c, sched);
  }
  push('pet_bottle', parseSchedule(row[COL.pet]));
  push('paper_cloth', parseSchedule(row[COL.cloth]));

  if (!rules.length) throw new Error(`全カテゴリが展開不能: ${JSON.stringify(row)}`);
  // schema の rules は category→pattern→days→occurrences 順で出す
  return rules.map((r) => {
    const o = { category: r.category, pattern: r.pattern };
    if (r.days) o.days = r.days;
    if (r.occurrences) o.occurrences = r.occurrences;
    return o;
  });
}

// 展開不能だったカテゴリ名 (日本語の元表記つき) を返す。notes/README 用の集計に使う。
export function unschedulableOf(row) {
  const out = [];
  const check = (label, text) => {
    const t = normJa(text ?? '');
    if (UNSCHEDULABLE.has(t)) out.push({ label, raw: t });
  };
  check('燃やすごみ', row[COL.burnable]);
  check('燃やさないごみ', row[COL.nonBurnable]);
  check('プラスチック', row[COL.plastic]);
  check('びん・缶、古紙', row[COL.binKanPaper]);
  check('ペットボトル・トレイ', row[COL.pet]);
  check('古布', row[COL.cloth]);
  return out;
}

// 「1番」→ 1 / 「9番12号」→ null (レンジ畳み込みの対象外)
export function banchiNumber(s) {
  const m = normJa(s).match(/^(\d+)番$/);
  return m ? Number(m[1]) : null;
}
