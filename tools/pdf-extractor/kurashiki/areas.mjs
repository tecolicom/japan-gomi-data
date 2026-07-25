// 倉敷市: records.json の area 文字列 (PDF「地区」セル原文の地名列挙) を area 配列へ分解する。
// 横浜方式 (2026-07-24): 丁目まとめ (N丁目～M丁目) は展開せず 1 area とし、構成丁目を
// chomes:[…] リストで保持する (build が各丁目の machiaza_id を配列で付与)。
//
// 丁目まとめ/リストの area 化ルール:
//  - 番地割れ (「N番…」) を持つ丁目がある複数丁目の町: 丁目ごとに別 area へ分割し、各丁目の
//    番地だけを note に載せる (レンジ有無に関わらず。例 下の町1/2/9/10丁目、
//    上の町 = 1丁目(11～14番)+2～4丁目(全域) → 1/2/3/4丁目に分割)。
//  - 番地割れの無い複数丁目 (連続レンジ全域 / 共通条件のみ): 1 area・chomes 配列
//    (例 下の町3～8丁目が全域なら 1 area、神田3・4丁目)。
//  番地/号/番地レンジ・道路河川境界条件・字/町内会補足・旧呼称 (kyu) は note へ (name には入れない)。
//
// 規約の要点:
//  1. 前置グループラベル: 先頭の Ｒ2南/北・ＪＲ東西南北 (直後の （…） を含む) は町名でなく行 note。
//  2. トップレベル区切り: 括弧の外の 「・」「，」半角「,」で「参照」へ分割 (括弧内は保護)。
//  3. 参照の分類: 数字始まり = 直前の町の継続 (丁目追加 or 番地)。日本語始まり = 新しい町。
//  4. 括弧 （…） は直前トークンの note。想定外の表記は throw (黙って落とさない)。

const GROUP_LABEL = /^(Ｒ2[南北]|ＪＲ[東西南北])(（[^）]*）)?[ 　]*/;

// 条件マーカー (括弧なしで町名と条件が地続きの稀なケース: 倉敷本体 行22-24,27)。
const COND_MARKERS = ['のうち', 'を除く', 'の一部', '北部', '南部', '東部', '西部',
  'より東', 'より西', 'より南', 'より北', '以東', '以西', '以南', '以北'];

const isDigit = (ch) => ch >= '0' && ch <= '9';
// 番地割れ note か (先頭が数字 = 「N番」「N番～M番」「N番地」等)。道路番号 (国道430号線) や
// 条件 (以南) は先頭が数字でないので除外される。
const isBanchi = (n) => /^[0-9０-９]/.test(n);

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
// 返り値 { chomes:number[], note:string|null, isRange:boolean }。chomes 空 = 丁目なし。
function parseSpec(spec) {
  const s = spec.trim();
  if (s === '') return { chomes: [], note: null, isRange: false };
  let m;
  if ((m = s.match(/^(\d+)丁目$/))) return { chomes: [+m[1]], note: null, isRange: false };
  if ((m = s.match(/^(\d+)～(\d+)丁目$/)) || (m = s.match(/^(\d+)丁目～(\d+)丁目$/))) {
    const a = +m[1], b = +m[2];
    if (b < a || b - a > 30) throw new Error(`丁目レンジが不正: ${JSON.stringify(spec)}`);
    return { chomes: Array.from({ length: b - a + 1 }, (_, i) => a + i), note: null, isRange: true };
  }
  if ((m = s.match(/^(\d+)$/))) {
    const n = +m[1];
    if (n < 100) return { chomes: [n], note: null, isRange: false };  // 裸の小さい数字 = 丁目
    return { chomes: [], note: s, isRange: false };                    // 大きい裸数字 = 番地
  }
  if ((m = s.match(/^(\d+)丁目(.+)$/))) {                              // N丁目 + 番地補足
    return { chomes: [+m[1]], note: m[2].trim(), isRange: false };
  }
  return { chomes: [], note: s, isRange: false };                      // 番/号/レンジ/字 = 番地・条件
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

// 1 レコード (records.json の 1 行) → area 配列。
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
  // 末尾括弧 (ＪＲ東/西 + 町内会列挙) が行全体に係る地域割り。既定則では茶屋町側が判別不能に
  // なるため行全体 note へ昇格する。
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

  // 同名町を 1 group に集約 (出現順を保持)。丁目ごとの note (chomeNotes) と町レベル note を分けて持つ。
  const order = [];                 // town name の出現順
  const byTown = new Map();         // town -> group
  let cur = null;                   // 現在の継続対象 group
  const townOf = (name) => {
    if (!byTown.has(name)) {
      byTown.set(name, { town: name, chomes: new Set(), chomeNotes: new Map(), townNotes: [], hasRange: false, lastChome: null });
      order.push(name);
    }
    return byTown.get(name);
  };
  const noteOnChome = (g, c, n) => { if (n) { if (!g.chomeNotes.has(c)) g.chomeNotes.set(c, []); g.chomeNotes.get(c).push(n); } };
  // note を「今のトークンの丁目」があればそこへ、無ければ直前丁目 (lastChome) へ、それも無ければ町へ。
  const noteHere = (g, chomes, n) => {
    if (!n) return;
    if (chomes.length) for (const c of chomes) noteOnChome(g, c, n);
    else if (g.lastChome !== null) noteOnChome(g, g.lastChome, n);
    else g.townNotes.push(n);
  };

  for (const token of tokens) {
    const { base, parenNote } = stripTrailingParen(token);
    if (base === '') {
      // 純粋な括弧のみ (直前の町/丁目への後置注記)
      if (!cur) throw new Error(`宙に浮いた括弧: ${JSON.stringify(token)}`);
      noteHere(cur, [], parenNote);
      continue;
    }

    if (isDigit(base[0])) {
      // 継続 (直前の町の丁目追加 or 番地)
      if (!cur) throw new Error(`町名の無い継続トークン: ${JSON.stringify(token)} in ${JSON.stringify(rec.area)}`);
      const { chomes, note, isRange } = parseSpec(base);
      if (isRange) cur.hasRange = true;
      for (const c of chomes) cur.chomes.add(c);
      if (chomes.length) cur.lastChome = chomes[chomes.length - 1];
      noteHere(cur, chomes, note);
      noteHere(cur, chomes, parenNote);
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
      // 「のうち」は接続語 (「平田のうち山陽本線より北」= 平田の、山陽本線より北) なので note に残さない。
      if (best >= 0) { condNote = town.slice(best).replace(/^のうち/, ''); town = town.slice(0, best); }
    }
    if (!town) throw new Error(`町名が空: ${JSON.stringify(token)} in ${JSON.stringify(rec.area)}`);

    // 方角対の展開 (東西千鳥町 = 東千鳥町+西千鳥町) と「大島と平田」= と で複数町 (条件は両町へ)。
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
      const { chomes, note, isRange } = parseSpec(rest);
      if (isRange) cur.hasRange = true;
      for (const c of chomes) cur.chomes.add(c);
      if (chomes.length) cur.lastChome = chomes[chomes.length - 1];
      noteHere(cur, chomes, note);
      noteHere(cur, chomes, condNote);
      noteHere(cur, chomes, parenNote);
    }
  }

  // 行レベル note (前置ラベル・旧呼称)。旧呼称 (kyu) は丁目列挙の echo (name と重複) を落とす。
  const rowNotes = [];
  if (groupNote) rowNotes.push(groupNote);
  if (rec.kyu) {
    const olds = splitTop(rec.kyu).filter((t) => !/\d\s*丁目/.test(t));
    if (olds.length) rowNotes.push(olds.join('・'));
  }
  const dedup = (arr) => { const s = new Set(); return arr.filter(Boolean).filter((n) => (s.has(n) ? false : (s.add(n), true))); };

  const areas = [];
  for (const name of order) {
    const g = byTown.get(name);
    const chomes = [...g.chomes].sort((a, b) => a - b);

    if (chomes.length === 0) {
      // 丁目なしの素の町 (番地・字は townNotes)
      const note = dedup([...rowNotes, ...g.townNotes]).join('、');
      areas.push({ base: g.town, chomes: [], ...(note ? { note } : {}) });
      continue;
    }

    // 番地割れを持つ丁目がある複数丁目の町は丁目ごとに分割 (レンジ有無に関わらず)。
    // レンジ (2～4丁目) と番地割れ丁目 (1丁目=11～14番) が混在する町でも、番地割れ丁目の
    // 番地が 1 area 内で潰れて「どの丁目の番地か」読めなくなるのを防ぐ。番地割れの無い丁目は
    // note なしの素の丁目 area になる (例 上の町 → 1丁目(11～14番)/2丁目/3丁目/4丁目)。
    const hasPerChomeBanchi = chomes.some((c) => (g.chomeNotes.get(c) || []).some(isBanchi));
    if (chomes.length > 1 && hasPerChomeBanchi) {
      for (const c of chomes) {
        const note = dedup([...rowNotes, ...g.townNotes, ...(g.chomeNotes.get(c) || [])]).join('、');
        areas.push({ base: g.town, chomes: [c], ...(note ? { note } : {}) });
      }
      continue;
    }

    // 1 area (レンジ or 番地割れの無い複数丁目)。丁目別 note は丁目番号を接頭して合流 (番地のみ接頭)。
    const merged = [];
    for (const c of chomes) {
      const cn = g.chomeNotes.get(c) || [];
      if (!cn.length) continue;
      // 番地 (先頭数字) は「c丁目」を一度だけ接頭。条件 (国道…以南 等) はそのまま。
      const banchi = cn.filter(isBanchi);
      const conds = cn.filter((n) => !isBanchi(n));
      if (banchi.length) merged.push((chomes.length > 1 ? `${c}丁目` : '') + banchi.join('、'));
      for (const cd of conds) merged.push(cd);
    }
    const note = dedup([...rowNotes, ...g.townNotes, ...merged]).join('、');
    areas.push({ base: g.town, chomes, ...(note ? { note } : {}) });
  }
  return areas;
}

export { compressChomes };
