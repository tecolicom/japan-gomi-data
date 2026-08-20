// 東秩父村 ごみ収集日程の一次ソース定義。
//
// 村全域が一律で地区割が無いため 1 コース。日付入りカレンダーは無く、
// 「ごみの出し方」ページの表に**種別ごとの収集曜日が文章で書かれている**のが唯一の資料。
// したがって抽出するのは日付ではなく**規則そのもの**になる。
//
// 収録期間は暦ではなくこのページの内容が支える範囲。ページに年度の記載は無いが、
// 「令和9年3月まで使用可能」という推奨袋の注記があり令和8年度の版と判断している。
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const CACHE = join(HERE, 'cache');

export const PERIOD = '2026-04--2027-03';
export const EDITION_JA = '令和8年度';
export const SCHEDULE_URL =
  'https://www.vill.higashichichibu.saitama.jp/soshiki/05/gominodashikata.html';

// 表の「種別」→ 正典語彙への対応。**ここが判断の全て**なので表に出す。
// 一次ソースの種別名は表記ゆれがあるので、含まれる語で照合する (完全一致にしない)。
export const CATEGORY_MAP = [
  { match: '燃えるごみ',       categories: ['burnable'] },
  { match: '資源プラスチック', categories: ['plastic'] },
  { match: '廃プラスチック',   categories: ['plastic'] },
  { match: '金属類',           categories: ['metal'] },
  { match: '有害ごみ',         categories: ['hazardous'] },
  // 「ガラス類・ペットボトル」は 1 行に 2 品目。村に不燃ごみ区分は無くガラス類がこれに相当する
  { match: 'ガラス類',         categories: ['non_burnable', 'pet_bottle'] },
  { match: 'びん類',           categories: ['glass_bottle'] },
  // 資源回収は第2水と第4水で**出せる品目が違う**。行ごとに主なもの欄から判定する
  { match: '資源回収',         categories: null, byItems: true },
  // 粗大ごみは自己搬入 (小川地区衛生組合) で集積所の対象外。course には入れない
  { match: '粗大ごみ',         categories: [] },
];

// 資源回収の行で「主なもの」に現れたら、その品目を立てる
export const ITEM_MAP = [
  { match: '新聞',     category: 'paper' },
  { match: '衣類',     category: 'cloth' },
  { match: 'アルミ缶', category: 'beverage_can' },
];
