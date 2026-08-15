// 三鷹市「収集日程」(令和8年度 = 2026年4月〜2027年3月) の一次ソース。
//
// 索引ページに地区別ページが並ぶ。地区は 10 で、各ページに曜日規則の表が 1 つ。
// 地区の顔ぶれは索引から動的に拾う (年度で変わりうるため一覧をここに固定しない)。
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const HERE = dirname(fileURLToPath(import.meta.url));
export const CACHE = join(HERE, 'cache');

export const INDEX_URL = 'https://www.city.mitaka.lg.jp/c_categories/index01004001001.html';
export const BASE = 'https://www.city.mitaka.lg.jp';

export const PERIOD = '2026-04--2027-03';
export const EDITION_JA = '令和8年度';
export const LG_CODE = '132047';

// HTML の品目表記 → 正典 category。
// 「空きびん・缶」「古紙・古着」は同日収集の 2 品目をまとめた市の呼称なので構成カテゴリへ分解する
// (日程情報の欠落はゼロ。同日性は days 共有で明示される)。
export const ITEM2CATS = {
  燃やせるごみ: ['burnable'],
  燃やせないごみ: ['non_burnable'],
  プラスチック類: ['plastic'],
  有害ごみ: ['hazardous'],
  ペットボトル: ['pet_bottle'],
  '空きびん・缶': ['glass_bottle', 'beverage_can'],
  '古紙・古着': ['paper', 'cloth'],
};

// rules の並び順 (schema/categories.yaml の順)
export const CAT_ORDER = [
  'burnable', 'non_burnable', 'plastic', 'pet_bottle', 'beverage_can',
  'glass_bottle', 'cloth', 'paper', 'hazardous',
];

// --- 年末年始 (HTML には無く、地区別カレンダー PDF にしかない) ---
//
// HTML の曜日規則の下に「年末及び1月は収集日程、時間が異なることがあります。
// 下記添付ファイルでご確認ください」とあるだけなので、ここは PDF から読む。
// 下の 3 つはすべて 2026-08-15 に PDF (12月・2027年1月版) を読んで確定したもので、
// verify.mjs が PDF のテキスト層・注記と突き合わせて裏を取る。

// 全地区で収集を休む日。
export const CLOSED_ALL = ['2026-12-30', '2026-12-31', '2027-01-01'];

// 12/29 (火) は地区で分かれる。「※12月29日（火）の可燃は臨時に収集します。」の注記がある
// 5 地区 (いずれも火曜が可燃) は通常どおり収集し、残る 5 地区は休む。
export const CLOSED_1229 = ['095667', '095671', '095674', '095677', '095682'];

// 1/1 (金) が休みになるため、金曜に「第n」枠を持つ 2 地区だけサイクルが 1 週繰り下がる。
// PDF に「※空きびん・缶は2回目と4回目、ペットボトルは3回目と5回目に収集します。」と明記され、
// カレンダー本体もそのとおりになっている (両地区とも目視で全日確認済み)。
// 他の曜日は 1/1 の影響を受けないので繰り下がらない。
export const JANUARY_SHIFT = {
  '095671': {
    '2027-01-08': ['glass_bottle', 'beverage_can'],
    '2027-01-15': ['pet_bottle'],
    '2027-01-22': ['glass_bottle', 'beverage_can'],
    '2027-01-29': ['pet_bottle'],
  },
  '095682': {
    '2027-01-08': ['pet_bottle'],
    '2027-01-15': ['glass_bottle', 'beverage_can'],
    '2027-01-22': ['pet_bottle'],
    '2027-01-29': ['glass_bottle', 'beverage_can'],
  },
};
