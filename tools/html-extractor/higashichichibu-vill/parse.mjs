// 「ごみの出し方」ページの表から、種別ごとの収集規則を読む。
//
// 日付入りカレンダーが無いので、**取り出すのは日付ではなく規則**である。
// 表は 1 つだけで、列は 種別 / 指定日 / 主なもの / 出し方の決まり。
//
// 未対応の表記は throw する。黙って読み飛ばすと、村が書いたのに反映されない品目が出る。
import { parseWeeklyJa, parseMonthlyNthJa, normJa, DAY_JA } from '../../_lib/jp.mjs';
import { CATEGORY_MAP, ITEM_MAP } from './sources.mjs';

const stripTags = (x) => x
  .replace(/<br\s*\/?>/gi, '\n')
  .replace(/<[^>]+>/g, '')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&#8203;|​/g, '')
  .trim();

/** 表を [{種別, 指定日, 主なもの}] に読む。resume は直前行の種別 (rowspan 対応)。 */
export function parseTable(html) {
  const tbl = html.match(/<table[\s\S]*?<\/table>/i);
  if (!tbl) throw new Error('表が見つからない (ページ構造が変わった可能性)');
  const rows = [];
  let lastKind = null;
  for (const tr of tbl[0].match(/<tr[\s\S]*?<\/tr>/gi) ?? []) {
    const cells = (tr.match(/<t[hd][\s\S]*?<\/t[hd]>/gi) ?? []).map(stripTags);
    if (!cells.length) continue;
    if (cells[0] === '種別') continue;                    // ヘッダ
    // 4 セル = 種別つき / 2 セル = 前行の種別が rowspan で続く (資源回収の第4水)
    let kind, when, items;
    if (cells.length >= 4) [kind, when, items] = cells;
    else if (cells.length === 2) { kind = lastKind; [when, items] = cells; }
    else throw new Error(`想定外のセル数 ${cells.length}: ${JSON.stringify(cells).slice(0, 120)}`);
    if (!kind) throw new Error(`種別が空: ${JSON.stringify(cells).slice(0, 120)}`);
    lastKind = kind;
    rows.push({ kind, when, items });
  }
  if (!rows.length) throw new Error('表の行が読めない');
  return rows;
}

/** 「指定日」欄から曜日規則を読む。注記 (※以降) と括弧書きは規則の外なので落とす。 */
function parseWhen(when) {
  // セル内の改行は<br>による折り返しにすぎない ("第1・2・3・5" 改行 "金曜日" のように
  // 規則の途中で切れる)。注記の ※ で切ってから、残りの改行を潰す。
  const head = when.split('※')[0].replace(/\n/g, '').replace(/[（(][^）)]*[）)]/g, '').trim();
  const t = normJa(head);
  if (/^自己搬入$/.test(t)) return null;                  // 粗大ごみ。集積所の対象外
  if (/^第/.test(t)) {
    const { occurrences, days } = parseMonthlyNthJa(t.replace(/曜日$/, '曜日'));
    return { pattern: 'monthly_nth', days, occurrences };
  }
  return { pattern: 'weekly', days: parseWeeklyJa(t) };
}

/**
 * 「指定日」欄の注記から季節限定の追加収集を読む。
 * 例: ※ペットボトルは、5・6・7・8・9・10月のみ第1水曜日でも出せる
 * → { category:'pet_bottle', months:[5..10], occurrence:1, day:'WE' }
 */
function parseSeasonalNote(when, kindCategories) {
  const note = when.split('※')[1];
  if (!note) return null;
  const t = normJa(note);
  const m = t.match(/^(.+?)は[、,]?([\d・]+)月のみ第(\d)([日月火水木金土])曜日?でも出せる/);
  if (!m) throw new Error(`未対応の注記: "${note.trim()}" (正規化後: "${t}")`);
  // 注記が指す品目を、その行の品目のうち名前が一致するものに絞る
  const target = ITEM_TO_CATEGORY(m[1]) ?? kindCategories.find((c) => c === 'pet_bottle');
  if (!target) throw new Error(`注記の対象品目が特定できない: "${m[1]}"`);
  return {
    category: target,
    months: m[2].split('・').filter(Boolean).map(Number),
    occurrence: Number(m[3]),
    day: DAY_JA[m[4]],
  };
}

const ITEM_TO_CATEGORY = (s) => (s.includes('ペットボトル') ? 'pet_bottle' : null);

/**
 * 「主なもの」欄から出せる品目を読む。**否定の括弧書きを肯定と取り違えない。**
 * 「（衣類やアルミ缶は出せません）」の中に現れる品目は、出せないことの明示である。
 */
export function itemCategories(items) {
  const negatives = [];
  const positive = items.replace(/[（(]([^）)]*?出せません)[）)]/g, (_, inner) => {
    negatives.push(inner);
    return '';
  });
  const excluded = new Set(
    ITEM_MAP.filter((i) => negatives.some((n) => n.includes(i.match))).map((i) => i.category));
  const included = ITEM_MAP.filter((i) => positive.includes(i.match)).map((i) => i.category);
  // 同じ品目が肯定側と否定側の両方に出たら、読み方が決まらないので止める
  for (const c of included) {
    if (excluded.has(c)) throw new Error(`品目 "${c}" が肯定と否定の両方に現れる: "${items.slice(0, 80)}"`);
  }
  return included;
}

/**
 * 同一品目の規則をまとめる。村は「資源プラ=第1・2・3・5金」「廃プラ=第4金」と
 * 別の種別として書くが、どちらも正典語彙では plastic なので合わせると毎週金になる。
 * 第 n が 1〜5 すべて揃ったときだけ weekly へ畳む。
 */
export function mergeRules(rules) {
  const byKey = new Map();
  for (const r of rules) {
    const key = `${r.category}|${r.days.join(',')}`;
    if (!byKey.has(key)) byKey.set(key, { category: r.category, days: r.days, occ: new Set(), weekly: false });
    const g = byKey.get(key);
    if (r.pattern === 'weekly') g.weekly = true;
    else for (const o of r.occurrences) g.occ.add(o);
  }
  const out = [];
  for (const g of byKey.values()) {
    if (g.weekly && g.occ.size) throw new Error(`${g.category}: weekly と monthly_nth が混在している`);
    if (g.weekly) { out.push({ category: g.category, pattern: 'weekly', days: g.days }); continue; }
    const occ = [...g.occ].sort((a, b) => a - b);
    if (occ.length === 5) out.push({ category: g.category, pattern: 'weekly', days: g.days });
    else out.push({ category: g.category, pattern: 'monthly_nth', days: g.days, occurrences: occ });
  }
  return out;
}

/** 表 → { rules, seasonal }。rules は course YAML の rules と同じ形。 */
export function parseSchedule(html) {
  const rows = parseTable(html);
  const rules = [];
  const seasonal = [];
  const seenKinds = new Set();

  for (const { kind, when, items } of rows) {
    const k = normJa(kind);
    const map = CATEGORY_MAP.find((m) => k.includes(normJa(m.match)));
    if (!map) throw new Error(`CATEGORY_MAP に無い種別 "${kind}" (語彙の追加は上流の判断)`);
    seenKinds.add(map.match);

    // 資源回収は行ごとに出せる品目が違う。「主なもの」欄から立てる。
    // **単純な文字列一致では誤る。** 第2水の欄には「（衣類やアルミ缶は出せません）」と
    // 書かれており、"衣類" も "アルミ缶" も現れるが、意味は逆である。
    // 収録時 (2026-08-03) に人がここを読み落として第2水にも衣類とアルミ缶を立てており、
    // 17 日間ぶん誤った収集日を配信した。否定の括弧書きを先に切り離す。
    const categories = map.byItems ? itemCategories(items) : map.categories;
    if (map.byItems && !categories.length) throw new Error(`資源回収の行から品目が読めない: "${items.slice(0, 60)}"`);

    const when1 = parseWhen(when);
    if (!when1) continue;                                  // 自己搬入 (粗大)
    for (const c of categories) rules.push({ category: c, ...when1 });

    const s = parseSeasonalNote(when, categories);
    if (s) seasonal.push(s);
  }

  // 表に載っているはずの種別が消えたら気づけるようにする
  for (const m of CATEGORY_MAP) {
    if (!seenKinds.has(m.match)) throw new Error(`表から種別 "${m.match}" が消えた (ページ改訂の可能性)`);
  }
  return { rules: mergeRules(rules), seasonal };
}
