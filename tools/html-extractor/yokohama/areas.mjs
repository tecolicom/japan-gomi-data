// 横浜市の HTML 町名セル文字列 → 1 つの area にパースする。
// 横浜の一次ソースは町名と番地範囲・注記が区切りなしで直結する (例「和泉町6500台」
// 「今宿1・2丁目」「戸塚町(…)※一部異なる地域あり」)。丁目まとめ (今宿1・2丁目) は
// 展開せず原文どおり 1 area とし、構成丁目を chomes: [1,2] で保持する
// (build が各丁目の machiaza_id をリストで付与)。次の規約:
//  1. 「※…」以降は運用注記 → note (先頭 ※ は範囲情報の強調なので除去のみ)。
//  2. 丁目の後に続く範囲・条件 (「10の一部…を除く」「1〜8番の一部」) は note へ。name は丁目まで。
//  3. 半角丸括弧は全角へ正規化。
//  4. base = ABR 照合用のベース大字。chomes = 構成丁目番号のリスト (丁目なしは [])。

const nfkc = (s) => s.normalize('NFKC').replace(/~/g, '〜');
const zen = (s) => s.replace(/\(/g, '（').replace(/\)/g, '）');

// 「1・2」「1〜4」「1・3・4」→ [1,2] / [1,2,3,4] / [1,3,4]
function expandChomeList(spec) {
  const out = [];
  for (const part of spec.split('・')) {
    const m = part.match(/^(\d+)〜(\d+)$/);
    if (m) { for (let i = +m[1]; i <= +m[2]; i++) out.push(i); }
    else if (/^\d+$/.test(part)) out.push(+part);
    else return null;
  }
  return out;
}

function baseTown(town) {
  let s = nfkc(town).replace(/[（(].*$/, '').replace(/※.*$/, '');
  s = s.replace(/\d.*$/, '');
  return s;
}

// row.town → { name, base, chomes, note? } (1 area)
export function parseTown(rawTown) {
  const full = nfkc(rawTown);
  let body = full;
  let note = null;
  const star = full.indexOf('※');
  if (star === 0) body = full.slice(1);
  else if (star > 0) { body = full.slice(0, star); note = full.slice(star + 1).trim() || null; }

  const mkNote = (rest) => {
    const r = zen(rest).trim();
    return [r || null, note].filter(Boolean).join(' ') || null;
  };

  // 複数丁目まとめ: <町><丁目リスト>丁目<残り> — 展開せず chomes に構成丁目を持つ
  const m = body.match(/^(.+?)(\d+(?:[・〜]\d+)+)丁目(.*)$/);
  if (m) {
    const chomes = expandChomeList(m[2]);
    if (chomes) {
      const n = mkNote(m[3]);
      return { name: zen(`${m[1]}${m[2]}丁目`), base: m[1], chomes, ...(n ? { note: n } : {}) };
    }
  }
  // 単一丁目 (+番地範囲): <町>N丁目<残り>
  const s1 = body.match(/^(.+?)(\d+)丁目(.*)$/);
  if (s1) {
    const n = mkNote(s1[3]);
    return { name: zen(`${s1[1]}${s1[2]}丁目`), base: s1[1], chomes: [+s1[2]], ...(n ? { note: n } : {}) };
  }
  // 丁目なし (素の町名 / 番地直結 / 括弧つき)
  return { name: zen(body), base: baseTown(body), chomes: [] };
}
