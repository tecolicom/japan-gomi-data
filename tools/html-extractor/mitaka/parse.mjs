// 三鷹市: 地区別 HTML → 曜日規則 / 地区名 → 町丁目。
//
// 表記の実例は README を見よ。ここは純粋なパースだけで、取得も出力もしない
// (parse.test.mjs でこの 2 つを直接テストする)。
import { parseMonthlyNthJa } from '../../_lib/jp.mjs';
import { ITEM2CATS } from './sources.mjs';

const DOW_JA2EN = { 日: 'SU', 月: 'MO', 火: 'TU', 水: 'WE', 木: 'TH', 金: 'FR', 土: 'SA' };
const norm = (s) => s.replace(/[　\s]+/g, ' ').trim();

// --- 曜日規則の表 ---

// 「ごみ・資源物の収集日程」テーブルを取り出す。市のページは caption が
// 「収集日程」と「収集日」で揺れている (095677 だけ後者) ので前方一致で拾う。
export function extractScheduleTable(html) {
  for (const tb of html.match(/<table[\s\S]*?<\/table>/g) || []) {
    const cap = tb.match(/<caption[^>]*>([\s\S]*?)<\/caption>/);
    if (!cap || !norm(cap[1].replace(/<[^>]+>/g, '')).startsWith('ごみ・資源物の収集日')) continue;
    const rows = [];
    for (const tr of tb.match(/<tr[\s\S]*?<\/tr>/g) || []) {
      const cells = (tr.match(/<t[hd][\s\S]*?<\/t[hd]>/g) || [])
        .map((c) => norm(c.replace(/<[^>]+>/g, ' ')));
      if (cells.length === 2) rows.push(cells);
    }
    return rows;
  }
  throw new Error('「ごみ・資源物の収集日程」テーブルが見つからない');
}

// 「プラスチック類 有害ごみ 第1・3 燃やせないごみ」→
//   [{cats:['plastic'],occ:null},{cats:['hazardous'],occ:null},{cats:['non_burnable'],occ:[1,3]}]
// 「第n・m」は**直後の 1 品目だけ**に掛かる (「第1・3 空きびん・缶 第2・4 ペットボトル」が成り立つため)。
export function parseItems(text, where = '') {
  const out = [];
  let occ = null;
  for (const seg of norm(text).split(/(第[\d・]+)\s*/).filter((s) => s && s.trim())) {
    const m = seg.match(/^第[\d・]+$/);
    if (m) {
      // 「第1・3」→ occurrences。曜日は表の行が持つのでダミーの曜日を付けて _lib のパーサに渡す
      occ = parseMonthlyNthJa(`${seg}月`).occurrences;
      continue;
    }
    for (const item of seg.split(' ').filter(Boolean)) {
      const cats = ITEM2CATS[item];
      if (!cats) throw new Error(`${where}: 未知の品目 "${item}" (ITEM2CATS に無い)`);
      out.push({ cats, occ });
      occ = null;
    }
  }
  if (occ) throw new Error(`${where}: 「第n」の後に品目が無い`);
  if (!out.length) throw new Error(`${where}: 品目が 1 つも読めない: ${text}`);
  return out;
}

// 表 → [{day:'MO', items:[{cats,occ}]}]
export function parseSchedule(rows, where = '') {
  const out = [];
  for (const [head, body] of rows) {
    const m = head.match(/^([日月火水木金土])曜日$/);
    if (!m) continue; // ヘッダ行 (「曜日」「ごみ・資源物の種類」)
    out.push({ day: DOW_JA2EN[m[1]], items: parseItems(body, `${where} ${head}`) });
  }
  if (!out.length) throw new Error(`${where}: 曜日の行が 1 つも読めない`);
  return out;
}

// --- 地区名 → 町丁目 ---

// 「大沢3丁目・深大寺全域・井口全域・野崎2・3丁目地区」
//   → [{oaza:'大沢',chome:3},{oaza:'深大寺',chome:1..3},…]
// 「・」は町の区切りにも丁目の区切りにも使われる (「野崎2・3丁目」)。
// 町名で始まらない断片は直前の町の続きとして読む。
export function parseDistrictAreas(name, towns, where = '') {
  const oazaList = [...new Set(towns.map((t) => t.oaza))].sort((a, b) => b.length - a.length);
  const label = name.replace(/地区$/, '').trim();
  const out = [];
  let cur = null;

  for (const raw of label.split('・')) {
    let seg = raw.trim();
    const hit = oazaList.find((o) => seg.startsWith(o));
    if (hit) {
      cur = hit;
      seg = seg.slice(hit.length);
    }
    if (!cur) throw new Error(`${where}: 町名が決まらない断片 "${raw}" (${name})`);
    const all = towns.filter((t) => t.oaza === cur);

    if (seg === '全域' || seg === '') {
      // 「井の頭全域」/ 丁目のない町。ここで初出のときだけ全丁目を入れる
      if (seg === '全域') { out.push(...all); continue; }
      throw new Error(`${where}: 丁目の指定が読めない "${raw}" (${name})`);
    }
    const range = seg.match(/^(\d+)丁目[～~](\d+)丁目$/);
    if (range) {
      const [a, b] = [Number(range[1]), Number(range[2])];
      for (let n = a; n <= b; n++) {
        const t = all.find((x) => x.chome_number === n);
        if (!t) throw new Error(`${where}: ${cur}${n}丁目 が ABR に無い`);
        out.push(t);
      }
      continue;
    }
    const one = seg.match(/^(\d+)(丁目)?$/);
    if (!one) throw new Error(`${where}: 丁目の指定が読めない "${raw}" (${name})`);
    const t = all.find((x) => x.chome_number === Number(one[1]));
    if (!t) throw new Error(`${where}: ${cur}${one[1]}丁目 が ABR に無い`);
    out.push(t);
  }
  return out;
}
