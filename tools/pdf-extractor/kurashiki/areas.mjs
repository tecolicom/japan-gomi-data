// 倉敷市: records.json の area 文字列 (PDF「地区」セル原文の地名列挙) を
// 「1 area = 1 町名 (丁目単位)」へ分解する。分解規約は README.md「area 分解規約」に対応。
//
// 規約の要点:
//  1. 前置グループラベル: 文字列先頭の Ｒ2南/北・ＪＲ東西南北 (直後の （…） を含む) は
//     この行の全 area の note に前置する (町名ではない)。
//  2. トップレベル区切り: 括弧の外の 「・」「，」半角「,」で「参照」へ分割する。
//     (括弧内の区切りは分割しない = 条件/字/町内会の列挙を保護)。
//  3. 参照の分類:
//       - 数字始まりの参照 = 直前の町の継続 (丁目の追加列挙 or 番地)。
//       - 日本語始まりの参照 = 新しい町。町名 = 先頭の非数字・非空白の連続。
//  4. 丁目の展開: 「N丁目」「N」(裸,<100)「N～M丁目」「N丁目～M丁目」は個別丁目へ展開し
//     それぞれ独立した area (name=「<町>N丁目」) にする。
//  5. 展開しない情報 = note: 番地/号/番地レンジ (N番・N号・N～M・N番地)、道路/河川境界条件
//     (「◯◯線より東」「以南」等)、「◯◯を除く」「◯◯のみ」「◯◯の一部」、字/町内会補足、
//     前置グループラベル、旧呼称 (kyu)。すべて該当 area の note に verbatim 保持。
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

// 1 レコード (records.json の 1 行) → 展開 area 配列。
// 各 area: { name, note?, base } (base = yomi 照合用のベース町名。build 側で strip)。
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

  const tokens = splitTop(body);
  if (!tokens.length) throw new Error(`area が空: ${JSON.stringify(rec.area)}`);

  const groups = [];   // { town, units:[{chome, notes[]}], townNotes[], pendingBare[] }
  let cur = null;

  // chomes をユニット化して現在グループへ追加。
  //  explicit = トークンが「丁目」語を持つ (= 列挙クラスタの確定)。
  //  parenNote (後置括弧の条件) は「丁目」列挙クラスタ全体 (先行する裸数字 + 今回分) に付与。
  //  specNote (「N丁目<番地>」の番地部) は今回のユニットのみに付与。
  const addChomes = (chomes, explicit, specNote, parenNote) => {
    const mine = chomes.map((c) => { const u = { chome: c, notes: [] }; cur.units.push(u); return u; });
    if (specNote) for (const u of mine) u.notes.push(specNote);
    if (explicit) {
      const cluster = [...cur.pendingBare, ...mine];
      cur.pendingBare = [];
      if (parenNote) for (const u of cluster) u.notes.push(parenNote);
    } else {
      cur.pendingBare.push(...mine);
      if (parenNote) for (const u of mine) u.notes.push(parenNote);
    }
  };

  for (const token of tokens) {
    const { base, parenNote } = stripTrailingParen(token);
    if (base === '') {
      // 純粋な括弧のみ (直前ユニットへの後置注記)
      if (!cur || !cur.units.length) throw new Error(`宙に浮いた括弧: ${JSON.stringify(token)}`);
      cur.units[cur.units.length - 1].notes.push(parenNote);
      continue;
    }

    if (isDigit(base[0])) {
      // 継続 (直前の町の丁目 追加列挙 or 番地)
      if (!cur) throw new Error(`町名の無い継続トークン: ${JSON.stringify(token)} in ${JSON.stringify(rec.area)}`);
      const { chomes, note } = parseSpec(base);
      if (chomes.length) {
        addChomes(chomes, /丁目/.test(base), note, parenNote);
      } else {
        // 番地 note: 直前ユニットへ (無ければ町レベル)
        const dst = cur.units.length ? cur.units[cur.units.length - 1].notes : cur.townNotes;
        if (note) dst.push(note);
        if (parenNote) dst.push(parenNote);
      }
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
      cur = { town: tn, units: [], townNotes: [], pendingBare: [] };
      groups.push(cur);
      const { chomes, note } = parseSpec(rest);
      if (chomes.length) {
        addChomes(chomes, /丁目/.test(rest), note, parenNote);
        if (condNote) for (const u of cur.units) u.notes.push(condNote);
      } else {
        if (note) cur.townNotes.push(note);
        if (parenNote) cur.townNotes.push(parenNote);
        if (condNote) cur.townNotes.push(condNote);
      }
    }
  }

  // グループ → area オブジェクト
  const areas = [];
  const rowNotes = [];               // 全 area 共通 (前置ラベル・旧呼称)
  if (groupNote) rowNotes.push(groupNote);
  if (rec.kyu) rowNotes.push(rec.kyu);

  for (const g of groups) {
    if (g.units.length) {
      for (const u of g.units) {
        const name = `${g.town}${u.chome}丁目`;
        const noteParts = [...rowNotes, ...g.townNotes, ...u.notes].filter(Boolean);
        areas.push({ name, base: g.town, chome: u.chome, ...(noteParts.length ? { note: noteParts.join('、') } : {}) });
      }
    } else {
      const noteParts = [...rowNotes, ...g.townNotes].filter(Boolean);
      areas.push({ name: g.town, base: g.town, chome: null, ...(noteParts.length ? { note: noteParts.join('、') } : {}) });
    }
  }
  return areas;
}
