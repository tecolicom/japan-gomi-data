// 倉敷市: records.json の area 文字列 (PDF「地区」セル原文の地名列挙) を
// 「1 area = 1 町名」へ分解する。横浜方式 (2026-07-24): 丁目まとめ (N丁目～M丁目) は
// 展開せず 1 area とし、構成丁目を chomes:[…] のリストで保持する (build が各丁目の
// machiaza_id を配列で付与)。番地・条件・旧呼称は note へ (name には入れない)。
//
// 規約の要点:
//  1. 前置グループラベル: 文字列先頭の Ｒ2南/北・ＪＲ東西南北 (直後の （…） を含む) は
//     この行の全 area の note に前置する (町名ではない)。
//  2. トップレベル区切り: 括弧の外の 「・」「，」半角「,」で「参照」へ分割する。
//     (括弧内の区切りは分割しない = 条件/字/町内会の列挙を保護)。
//  3. 参照の分類: 数字始まり = 直前の町の継続 (丁目の追加列挙 or 番地)。
//     日本語始まり = 新しい町 (町名 = 先頭の非数字・非空白の連続)。
//  4. 丁目まとめは展開しない: 「N丁目」「N」(裸,<100)「N～M丁目」「N丁目～M丁目」の丁目番号は
//     その町の chomes リストへ集約する。同一行内の同名町はまとめて 1 area にする
//     (name = <町>+丁目レンジ圧縮、chomes = 全構成丁目)。
//  5. note (name に入れない): 番地/号/番地レンジ (N番・N号・N～M・N番地)、道路/河川境界条件
//     (「◯◯線より東」「以南」等)、「◯◯を除く」「◯◯のみ」「◯◯の一部」、字/町内会補足、
//     前置グループラベル、旧呼称 (kyu)。原文どおり verbatim 保持。
//  6. 括弧 （…） は直前トークンの note。
//  7. 想定外の表記は throw (黙って落とさない)。

const GROUP_LABEL = /^(Ｒ2[南北]|ＪＲ[東西南北])(（[^）]*）)?[ 　]*/;

// 条件マーカー (括弧なしで町名と条件が地続きの稀なケース: 倉敷本体 行22-24,27)。
// 出現位置が最も早いマーカーで町名部と条件部を切る。
const COND_MARKERS = ['のうち', 'を除く', 'の一部', '北部', '南部', '東部', '西部',
  'より東', 'より西', 'より南', 'より北', '以東', '以西', '以南', '以北'];

const isDigit = (ch) => ch >= '0' && ch <= '9';

// 括弧の外の ・ ， , で分割 (括弧内は保護)
function splitTop(s) {
  const out = [];
  let buf = '';
  let depth = 0;
  for (const ch of s) {
    if (ch === '（') depth++;
    else if (ch === '）') depth--;
    if (depth === 0 && (ch === '・' || ch === '，' || ch === ',')) {
      if (buf.trim()) out.push(buf.trim());
      buf = '';
    } else {
      buf += ch;
    }
  }
  if (buf.trim()) out.push(buf.trim());
  if (depth !== 0) throw new Error(`括弧が閉じていない: ${JSON.stringify(s)}`);
  return out;
}

// 末尾の （…） を note として剥がす。base と parenNote を返す。
function stripTrailingParen(token) {
  const m = token.match(/^(.*?)（([^（）]*)）$/);
  if (m) return { base: m[1].trim(), parenNote: m[2].trim() };
  if (token.includes('（') || token.includes('）'))
    throw new Error(`括弧の位置が想定外: ${JSON.stringify(token)}`);
  return { base: token.trim(), parenNote: null };
}

// spec 文字列 (町名を除いた残り、または継続トークンの base) を解釈。
// 返り値 { chomes:number[], note:string|null }。chomes 空 = 丁目なし。
// (丁目まとめは展開せず chomes に列挙する。)
function parseSpec(spec) {
  const s = spec.trim();
  if (s === '') return { chomes: [], note: null };
  let m;
  if ((m = s.match(/^(\d+)丁目$/))) return { chomes: [+m[1]], note: null };
  if ((m = s.match(/^(\d+)～(\d+)丁目$/)) || (m = s.match(/^(\d+)丁目～(\d+)丁目$/))) {
    const a = +m[1], b = +m[2];
    if (b < a || b - a > 30) throw new Error(`丁目レンジが不正: ${JSON.stringify(spec)}`);
    return { chomes: Array.from({ length: b - a + 1 }, (_, i) => a + i), note: null };
  }
  if ((m = s.match(/^(\d+)$/))) {
    const n = +m[1];
    if (n < 100) return { chomes: [n], note: null };      // 裸の小さい数字 = 丁目
    return { chomes: [], note: s };                        // 大きい裸数字 = 番地
  }
  if ((m = s.match(/^(\d+)丁目(.+)$/))) {                  // N丁目 + 番地補足
    return { chomes: [+m[1]], note: m[2].trim() };
  }
  return { chomes: [], note: s };                          // 番/号/レンジ/字 = 番地・条件 note
}

// 連続丁目を圧縮した表記: [3,4,5,6,7,8]→「3～8」/ [1,2,9,10]→「1・2・9・10」/ [1]→「1」。
// 長さ3以上の連番は「a～b」、長さ1・2は「・」列挙。
function compressChomes(chomes) {
  const s = [...new Set(chomes)].sort((a, b) => a - b);
  const runs = [];
  let i = 0;
  while (i < s.length) {
    let j = i;
    while (j + 1 < s.length && s[j + 1] === s[j] + 1) j++;
    runs.push(j - i >= 2 ? `${s[i]}～${s[j]}` : s.slice(i, j + 1).join('・'));
    i = j + 1;
  }
  return runs.join('・');
}

// 1 レコード (records.json の 1 行) → area 配列 (同名町は 1 area に集約)。
// 各 area: { base, chomes:number[], note? }。build が name/yomi/machiaza_id を付与。
export function expandRow(rec) {
  let body = rec.area;
  // 船穂町 <字> の空白は大字-字の連結 (町名の一部)。ＪＲ/Ｒ2 の空白と区別するため先に連結。
  body = body.replace(/船穂町[ 　]+/g, '船穂町');
  // 方角対 (東西/南北) 直後の ・ は区切りではなく連結 (東西・寿町 = 東西寿町 = 東寿町+西寿町)。
  body = body.replace(/(東西|南北)・/g, '$1');

  // 前置グループラベル
  let groupNote = null;
  const gm = body.match(GROUP_LABEL);
  if (gm) { groupNote = gm[0].trim(); body = body.slice(gm[0].length); }

  // 行全体条件の明示裁定: 茶屋町学区の対行「茶屋町・早沖（ＪＲ東…）」「茶屋町・早沖（ＪＲ西…）」は、
  // 原文 PDF 上、末尾括弧 (ＪＲ東/西 + 町内会列挙) が行全体 (茶屋町・早沖の両方) に係る地域割り。
  // 既定則 (括弧=直前トークンの note) では茶屋町側が判別不能になるため、行全体 note へ昇格する。
  const ROW_WIDE_PAREN = [/^茶屋町・早沖[（(]/];
  if (ROW_WIDE_PAREN.some((re) => re.test(body))) {
    const m = body.match(/[（(]([^）)]*)[）)]\s*$/);
    if (m) {
      groupNote = groupNote ? `${groupNote} ${m[1].trim()}` : m[1].trim();
      body = body.slice(0, m.index);
    }
  }

  const tokens = splitTop(body);
  if (!tokens.length) throw new Error(`area が空: ${JSON.stringify(rec.area)}`);

  // 同名町を 1 group に集約 (出現順を保持)。
  const order = [];                 // town name の出現順
  const byTown = new Map();         // town -> { chomes:Set, notes:[] }
  let cur = null;                   // 現在の継続対象 group
  const townOf = (name) => {
    if (!byTown.has(name)) { byTown.set(name, { town: name, chomes: new Set(), notes: [] }); order.push(name); }
    return byTown.get(name);
  };
  const addChomes = (g, chomes) => { for (const c of chomes) g.chomes.add(c); };

  for (const token of tokens) {
    const { base, parenNote } = stripTrailingParen(token);
    if (base === '') {
      // 純粋な括弧のみ (直前の町への後置注記)
      if (!cur) throw new Error(`宙に浮いた括弧: ${JSON.stringify(token)}`);
      if (parenNote) cur.notes.push(parenNote);
      continue;
    }

    if (isDigit(base[0])) {
      // 継続 (直前の町の丁目 追加列挙 or 番地)
      if (!cur) throw new Error(`町名の無い継続トークン: ${JSON.stringify(token)} in ${JSON.stringify(rec.area)}`);
      const { chomes, note } = parseSpec(base);
      addChomes(cur, chomes);
      // 丁目のみ (note 無し) は name へ集約するだけ。番地・条件を含むなら原文 base を note に残す。
      if (note !== null || chomes.length === 0) cur.notes.push(base);
      if (parenNote) cur.notes.push(parenNote);
      continue;
    }

    // 新しい町。町名 = 先頭の非数字・非空白の連続。
    let i = 0;
    while (i < base.length && !isDigit(base[i]) && base[i] !== ' ' && base[i] !== '　') i++;
    let town = base.slice(0, i);
    const rest = base.slice(i).trim();

    // 括弧なし条件 (稀): 町名部がマーカーを含むなら分割
    let condNote = null;
    if (rest === '') {
      let best = -1;
      for (const mk of COND_MARKERS) {
        const idx = town.indexOf(mk);
        if (idx > 0 && (best < 0 || idx < best)) best = idx;
      }
      if (best >= 0) { condNote = town.slice(best); town = town.slice(0, best); }
    }
    if (!town) throw new Error(`町名が空: ${JSON.stringify(token)} in ${JSON.stringify(rec.area)}`);

    // 方角対の展開 (東西千鳥町 = 東千鳥町+西千鳥町、南北亀島町 = 南亀島町+北亀島町) と
    // 「大島と平田」= と で複数町 (条件は両町に付与)。
    let townNames = [town];
    const dp = town.match(/^(東西|南北)(.+)$/);
    if (dp) {
      const [a, b] = dp[1] === '東西' ? ['東', '西'] : ['南', '北'];
      townNames = [a + dp[2], b + dp[2]];
    } else if (town.includes('と')) {
      townNames = town.split('と').filter(Boolean);
    }

    for (const tn of townNames) {
      cur = townOf(tn);
      const { chomes, note } = parseSpec(rest);
      addChomes(cur, chomes);
      // rest が番地・条件を含む (note あり) か、丁目でも何でもない補足なら note へ (原文 rest)。
      if (rest !== '' && (note !== null || chomes.length === 0)) cur.notes.push(rest);
      if (condNote) cur.notes.push(condNote);
      if (parenNote) cur.notes.push(parenNote);
    }
  }

  // group → area オブジェクト
  const rowNotes = [];               // 全 area 共通 (前置ラベル・旧呼称)
  if (groupNote) rowNotes.push(groupNote);
  // 旧呼称 (kyu): 丁目列挙の echo (「下の町3丁目～8丁目」等、name と重複) は落とし、旧地区名だけ残す。
  if (rec.kyu) {
    const olds = splitTop(rec.kyu).filter((t) => !/\d\s*丁目/.test(t));
    if (olds.length) rowNotes.push(olds.join('・'));
  }

  const areas = [];
  for (const name of order) {
    const g = byTown.get(name);
    const chomes = [...g.chomes].sort((a, b) => a - b);
    // 単一丁目の note に残る冗長な「N丁目」接頭 (name と重複) は除去。
    let notes = g.notes;
    if (chomes.length === 1) {
      const pre = new RegExp(`^${chomes[0]}丁目`);
      notes = notes.map((n) => n.replace(pre, '').trim()).filter(Boolean);
    }
    const noteParts = [...rowNotes, ...notes].filter(Boolean);
    // note 内の重複を畳む (順序保持)
    const seen = new Set();
    const dedup = noteParts.filter((n) => (seen.has(n) ? false : (seen.add(n), true)));
    areas.push({
      base: g.town,
      chomes,
      ...(dedup.length ? { note: dedup.join('、') } : {}),
    });
  }
  return areas;
}

export { compressChomes };
