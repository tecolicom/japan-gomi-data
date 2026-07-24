// 横浜市の HTML 町名セル文字列 → 町名単位の area 配列へ分解する。
// 横浜の一次ソースは町名と番地範囲・注記が区切りなしで直結する (例「和泉町6500台」
// 「今宿1・2丁目」「戸塚町(…)※一部異なる地域あり」)。次の規約で分解する:
//  1. 「※…」以降は運用注記 → note (先頭 ※ は範囲情報の強調なので除去のみ)。
//  2. 「<町>N・M丁目」「<町>N〜M丁目」「<町>N・M・L丁目」は個別丁目へ展開し独立 area
//     (name=「<町>N丁目」)。丁目に続く番地範囲 (「N丁目1〜8番の一部」) はその丁目の name に残す。
//  3. 半角丸括弧は全角へ正規化。括弧内の範囲・判別は name に残す。
//  4. base = ABR 照合用のベース町名 (丁目・括弧・番地・注記を除いた大字)。chome = 単一丁目番号|null。

const nfkc = (s) => s.normalize('NFKC').replace(/~/g, '〜');
const zen = (s) => s.replace(/\(/g, '（').replace(/\)/g, '）');

// 「1・2」「1〜4」「1・3・4」→ [1,2] / [1,2,3,4] / [1,3,4]
function expandChomeList(spec) {
  const out = [];
  for (const part of spec.split('・')) {
    const m = part.match(/^(\d+)〜(\d+)$/);
    if (m) { for (let i = +m[1]; i <= +m[2]; i++) out.push(i); }
    else if (/^\d+$/.test(part)) out.push(+part);
    else return null; // 想定外
  }
  return out;
}

// ベース町名: 丁目・括弧・番地・注記を除いた大字部分 (ABR 照合キー)
function baseTown(town) {
  let s = nfkc(town).replace(/[（(].*$/, '').replace(/※.*$/, '');
  s = s.replace(/\d.*$/, ''); // 最初の数字以降 (丁目・番地) を除く
  return s;
}

// row.town → [{name, base, chome, note}]
export function expandTown(rawTown) {
  const full = nfkc(rawTown);
  // 1) ※ 注記の分離
  let body = full;
  let note = null;
  const starMid = full.indexOf('※');
  if (starMid === 0) {
    body = full.slice(1); // 先頭 ※ は除去のみ (以降は範囲情報)
  } else if (starMid > 0) {
    body = full.slice(0, starMid);
    note = full.slice(starMid + 1).trim() || null;
  }

  // 丁目の後に続く範囲・条件 (「10の一部と…を除く」「1〜8番の一部」等) は note へ回す。
  // name は「<町>N丁目」に留める (居住地は丁目で特定できる。細かい範囲は note で補足)。
  const mkNote = (rest) => {
    const r = zen(rest).trim();
    return [r || null, note].filter(Boolean).join(' ') || null;
  };

  // 2) 複数丁目まとめ: <町><丁目リスト>丁目<残り>
  const m = body.match(/^(.+?)(\d+(?:[・〜]\d+)+)丁目(.*)$/);
  if (m) {
    const townBase = m[1];
    const chomes = expandChomeList(m[2]);
    const rest = m[3];
    if (chomes) {
      const n = mkNote(rest);
      return chomes.map((c) => ({
        name: zen(`${townBase}${c}丁目`),
        base: townBase,
        chome: c,
        ...(n ? { note: n } : {}),
      }));
    }
  }

  // 3) 単一丁目 (+番地範囲) : <町>N丁目<残り>
  const s1 = body.match(/^(.+?)(\d+)丁目(.*)$/);
  if (s1) {
    const n = mkNote(s1[3]);
    return [{
      name: zen(`${s1[1]}${s1[2]}丁目`),
      base: s1[1],
      chome: +s1[2],
      ...(n ? { note: n } : {}),
    }];
  }

  // 4) 丁目なし (素の町名 / 番地直結 / 括弧つき)
  return [{
    name: zen(body),
    base: baseTown(body),
    chome: null,
    ...(note ? { note } : {}),
  }];
}
