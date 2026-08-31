// 索引ページの HTML 表 (町丁目 × 曜日 + 地域番号) のパースと、町丁目の分解。
//
// この表が**地区割の正典**。各 PDF のヘッダは逆向き (地域 → 町丁目) を持つので、
// verify.mjs が両方向を突き合わせる。
import { zen2han } from '../../_lib/jp.mjs';

const TILDE = /[~～〜]/g;
export const norm = (s) => zen2han(String(s)).replace(TILDE, '～').replace(/\s+/g, '').trim();

// <td>/<th> をテキストへ。node-html-parser を使わないのは、この 1 表しか読まないため。
const cellText = (html) => norm(html.replace(/<[^>]+>/g, '|'))
  .replace(/\|+/g, '|').replace(/^\||\|$/g, '')
  .replace(/&nbsp;/g, '').replace(/&amp;/g, '&');

/**
 * 索引ページ → 行の配列。
 * 列は 地域(町丁目) / 資源 / 可燃ごみ / 不燃ごみ / 管轄の清掃事務所 / 地域別カレンダー番号。
 */
export function parseIndexTable(html) {
  const body = html.replace(/<script[\s\S]*?<\/script>/g, '');
  const table = /<table[\s\S]*?<\/table>/.exec(body);
  if (!table) throw new Error('索引ページに <table> が無い');
  const trs = table[0].match(/<tr[\s\S]*?<\/tr>/g) ?? [];
  const head = (trs[0].match(/<t[hd][\s\S]*?<\/t[hd]>/g) ?? []).map(cellText);
  const want = ['地域', '資源', '可燃ごみ', '不燃ごみ', '管轄の清掃事務所', '地域別カレンダー番号'];
  if (head.join('|') !== want.join('|')) throw new Error(`表の見出しが想定と違う: ${head.join('|')}`);

  const rows = [];
  for (const tr of trs.slice(1)) {
    const c = (tr.match(/<t[hd][\s\S]*?<\/t[hd]>/g) ?? []).map(cellText);
    if (c.length < 6) continue;
    const m = /^([東西])(\d+)/.exec(c[5]);
    if (!m) throw new Error(`地域番号が読めない: "${c[5]}" (${c[0]})`);
    rows.push({
      name: c[0],
      res: c[1], bur: c[2], non: c[3],
      office: c[4],
      area: (m[1] === '東' ? 'e' : 'w') + Number(m[2]),
    });
  }
  if (!rows.length) throw new Error('索引ページの表に行が無い');
  return rows;
}

// 「赤塚1～2丁目」  → [{town:'赤塚',chome:1},{town:'赤塚',chome:2}]
// 「赤塚1～2・6～7丁目」→ 1,2,6,7   (PDF ヘッダは範囲と列挙を混ぜる)
// 「巣鴨1・2・5丁目」 → 1,2,5
// 「相生町」        → [{town:'相生町',chome:null}]   (丁目を持たない町)
export function splitAreas(name) {
  const m = /^(.+?)((?:\d+(?:～\d+)?)(?:・\d+(?:～\d+)?)*)丁目$/.exec(name);
  if (!m) {
    if (/\d/.test(name)) throw new Error(`町丁目が「<町名><丁目>」の形でない: "${name}"`);
    return [{ town: name, chome: null }];
  }
  const [, town, spec] = m;
  const out = [];
  for (const part of spec.split('・')) {
    const r = /^(\d+)(?:～(\d+))?$/.exec(part);
    if (!r) throw new Error(`丁目の並びが読めない: "${name}"`);
    const from = Number(r[1]);
    const to = r[2] === undefined ? from : Number(r[2]);
    if (to < from) throw new Error(`丁目の範囲が逆: "${part}" (${name})`);
    for (let n = from; n <= to; n++) out.push({ town, chome: n });
  }
  const seen = out.map((x) => x.chome);
  if (new Set(seen).size !== seen.length) throw new Error(`丁目が重複: "${name}"`);
  return out;
}

// 曜日規則の比較キー。HTML「毎月2回目・4回目の金」と PDF「毎月2・4回目の金」の
// 表記ゆれを吸収して、同じ規則が同じ文字列になるようにする。
export function ruleKey({ res, bur, non }) {
  const days = (s) => norm(s).split('・').filter(Boolean).join('・');
  const m = /^毎月([\d回目・]+)の([日月火水木金土])$/.exec(norm(non));
  if (!m) throw new Error(`不燃の規則が読めない: "${non}"`);
  const occ = [...m[1].matchAll(/(\d)回目/g)].map((x) => x[1]);
  if (!occ.length) throw new Error(`不燃の回目が読めない: "${non}"`);
  return `${days(res)}|${days(bur)}|${occ.join('・')}回目の${m[2]}`;
}

// extract.py が出した PDF 側の規則を同じキーへ
export function pdfRuleKey(rules) {
  return `${rules['資源'].days.join('・')}|${rules['可燃'].days.join('・')}`
    + `|${rules['不燃'].occurrences.join('・')}回目の${rules['不燃'].days[0]}`;
}
