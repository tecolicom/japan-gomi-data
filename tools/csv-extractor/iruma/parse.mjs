// 入間市 ごみ収集日程 CSV (埼玉県オープンデータポータル resource 1494) のパーサ。
//
// このデータは「日付入りの実収集カレンダー」(縦持ち)。1 行 = 1 収集地域 × 1 分別区分 × 1 日付。
//   列 (実データの並び):
//     0 識別情報 / 1 全国地方公共団体コード(112259) / 2 団体名(入間市) /
//     3 収集地域(フリーテキスト) / 4 収集分別区分 / 5 年月日(YYYY/MM/DD)
//   ★罠1: 文字コードは Shift_JIS (survey の「UTF-8」は誤り)。
//   ★罠2: ヘッダの列名順は「…年月日, 収集分別区分」だが、実データは「…収集分別区分, 年月日」で
//          最後の 2 列が入れ替わっている。列名でなく実データの並び(位置)で解釈する。
//   ★罠3: 末尾に空行 (,,,,,) が多数付く → 全フィールド空の行は捨てる。
import { zen2han } from '../../_lib/jp.mjs';

// 収集分別区分 → 正典 category (schema/categories.yaml の部分集合)。
// 「ビン・缶・ペットボトル・有害ごみ」は 4 品目が同日収集 (同じ日付列を共有)。
// 「古布・紙類」は入間市の資源回収区分 → paper_cloth。
export const BUNBETSU2CATS = {
  '可燃ごみ': ['burnable'],
  '不燃ごみ': ['non_burnable'],
  'プラスチックごみ': ['plastic'],
  'ビン・缶・ペットボトル・有害ごみ': ['glass_bottle', 'beverage_can', 'pet_bottle', 'hazardous'],
  '古布・紙類': ['paper_cloth'],
};

// rules に並べる正典 category の順序 (可燃→不燃→プラ→古布紙→ビン缶ペット有害)。
export const CAT_ORDER = [
  'burnable', 'non_burnable', 'plastic', 'paper_cloth',
  'glass_bottle', 'beverage_can', 'pet_bottle', 'hazardous',
];

// CSV → [{ region, bunbetsu, iso }] (空行を除去、cp932 デコード済み文字列を受ける)。
export function parseIrumaCsv(text) {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/);
  const rows = [];
  for (const line of lines.slice(1)) {
    const f = line.split(',');
    if (f.length !== 6) continue;
    // 全フィールド空 (末尾のパディング行) は捨てる
    if (f.every((x) => x.trim() === '')) continue;
    const region = f[3].trim();
    const bunbetsu = f[4].trim();
    const dateStr = f[5].trim();
    if (!region && !bunbetsu && !dateStr) continue;
    if (f[2].trim() !== '入間市') throw new Error(`団体名が入間市でない行: [${line}]`);
    if (!BUNBETSU2CATS[bunbetsu]) throw new Error(`未知の収集分別区分: [${bunbetsu}] (${line})`);
    const m = dateStr.match(/^(\d{4})\/(\d{2})\/(\d{2})$/);
    if (!m) throw new Error(`年月日の形式が不正: [${dateStr}] (${line})`);
    rows.push({ region, bunbetsu, iso: `${m[1]}-${m[2]}-${m[3]}` });
  }
  return rows;
}

// 収集地域フリーテキストを町丁目フラグメントへ分割する。
// 区切りは「、」だが、括弧 （） の内側の「、」では区切らない
//   (例: 下藤沢（173～184、1263～1319番地…以外の地区）は 1 フラグメント)。
export function splitRegion(region) {
  const parts = [];
  let buf = '', depth = 0;
  for (const ch of region) {
    if (ch === '（' || ch === '(') depth++;
    else if (ch === '）' || ch === ')') depth = Math.max(0, depth - 1);
    if (ch === '、' && depth === 0) { parts.push(buf); buf = ''; }
    else buf += ch;
  }
  if (buf) parts.push(buf);
  if (depth !== 0) throw new Error(`括弧が閉じていない収集地域: [${region}]`);
  // 数字始まりのフラグメントは直前の町名の番地継続とみなして結合
  //   (例: 「下藤沢173～184」「1263～1319番地」→「下藤沢173～184、1263～1319番地」)
  const merged = [];
  for (const p of parts) {
    if (merged.length && /^[0-9０-９]/.test(p)) merged[merged.length - 1] += '、' + p;
    else merged.push(p);
  }
  return merged.map((s) => s.trim()).filter(Boolean);
}

// フラグメント → ベース町名 (読み引き用)。括弧を除去、全角数字→半角、最初のアラビア数字以降を切る。
//   例: 扇台3～6丁目 → 扇台 / 大字扇町屋1217・1219番地 → 大字扇町屋 / 上藤沢（グリーンヒル除く）→ 上藤沢
export function baseName(fragment) {
  return zen2han(fragment.replace(/（.*?）/g, '')).replace(/[0-9].*$/, '').trim();
}

// フラグメントの丁目・番地部分を読みソート用の数値サフィックスにする。
//   例: 扇台3～6丁目 → "3-6" / 東町2・4・5丁目 → "2-4-5" / 河原町1・2番 → "1-2"
export function chomeSuffix(fragment, base) {
  let s = zen2han(fragment.replace(/（.*?）/g, ''));
  // ベース町名を除去 (大字プレフィクスは base 側に含まれる)
  s = s.replace(base.replace(/^大字/, ''), '').replace(/^大字/, '');
  s = s.replace(/丁目|番地|番/g, '');
  s = s.replace(/[～〜・、,\s]+/g, '-').replace(/^-|-$/g, '');
  return s;
}

// フラグメント → { name, yomi }。yomi は yomi.yaml のベース読み + 丁目サフィックス。
//   大字X は「おおあざ」+ X の読み。読みが引けなければ throw (黙って落とさない)。
export function fragmentToArea(fragment, yomiMap) {
  const name = zen2han(fragment).trim();
  const base = baseName(fragment);
  const isOaza = base.startsWith('大字');
  const baseKey = base.replace(/^大字/, '');
  const baseYomi = yomiMap[base] ?? yomiMap[baseKey];
  if (!baseYomi) throw new Error(`yomi.yaml にベース町名が無い: [${base}] (fragment=${fragment})`);
  const suffix = chomeSuffix(fragment, base);
  const yomi = (isOaza ? 'おおあざ' : '') + baseYomi + (suffix ? suffix : '');
  return { name, yomi };
}
