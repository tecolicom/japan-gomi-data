// 上富良野町 ごみ収集カレンダーの一次ソース定義。
//
// 町は市街地 3 コース (赤・青・緑) と農村 2 コース (農村東・農村西) の 5 コース。
// 区分は町名で、番号運用ではない。粗大ごみの収集日は全コース共通。
// 都市と農村で分別方式が違う —
//   都市 (赤/青/緑): 生ごみ (週2) を分別収集。空き缶と空きびんは別日
//   農村 (東/西):    生ごみは分別せず一般ごみへ (自家処理前提)。缶・びんは同一日
//
// areas の yomi は収録時 (2026-07) に確定した値をそのまま持つ。ABR から引き直していない。

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const CACHE = join(HERE, 'cache');

export const PERIOD = '2026-04--2027-03';
export const EDITION_JA = '令和8年度';
export const INDEX_URL = 'https://www.town.kamifurano.hokkaido.jp/index.php?id=333';
export const PDF_BASE =
  'https://www.town.kamifurano.hokkaido.jp/contents/04chomin/0420seikatsu/gomi/calendar';

export const COURSES = [
  {
    id: "aka",
    nameJa: "赤コース",
    pdf: "R08_aka",
    areas: [
      { name: "緑町", yomi: "みどりまち" },
      { name: "旭町", yomi: "あさひまち" },
      { name: "新町", yomi: "しんまち" },
      { name: "東町", yomi: "ひがしまち" },
      { name: "向町", yomi: "むかいまち" },
      { name: "丘町", yomi: "おかまち" },
      { name: "桜町", yomi: "さくらまち" },
      { name: "南町3丁目", yomi: "みなみまち3" },
      { name: "東中市街地", yomi: "ひがしなかしがいち" },
    ],
  },
  {
    id: "ao",
    nameJa: "青コース",
    pdf: "R08_ao",
    areas: [
      { name: "錦町", yomi: "にしきまち" },
      { name: "中町", yomi: "なかまち" },
      { name: "栄町", yomi: "さかえまち" },
      { name: "泉町", yomi: "いずみまち" },
      { name: "扇町", yomi: "おうぎまち" },
      { name: "西町", yomi: "にしまち" },
      { name: "光町", yomi: "ひかりまち" },
      { name: "北町", yomi: "きたまち" },
    ],
  },
  {
    id: "midori",
    nameJa: "緑コース",
    pdf: "R08_midori",
    areas: [
      { name: "富町", yomi: "とみまち" },
      { name: "大町", yomi: "おおまち" },
      { name: "本町", yomi: "もとまち" },
      { name: "宮町", yomi: "みやまち" },
      { name: "南町（南町3丁目を除く）", yomi: "みなみまち" },
    ],
  },
  {
    id: "noson-higashi",
    nameJa: "農村東コース",
    pdf: "R08_higasi",
    areas: [
      { name: "清富", yomi: "きよとみ" },
      { name: "日新", yomi: "にっしん" },
      { name: "日の出", yomi: "ひので" },
      { name: "旭野", yomi: "あさひの" },
      { name: "富原", yomi: "とみはら" },
      { name: "東中（東中市街地を除く）", yomi: "ひがしなか" },
    ],
  },
  {
    id: "noson-nishi",
    nameJa: "農村西コース",
    pdf: "R08_nisi",
    areas: [
      { name: "草分", yomi: "くさわけ" },
      { name: "里仁", yomi: "りじん" },
      { name: "江幌", yomi: "えほろ" },
      { name: "静修", yomi: "せいしゅう" },
      { name: "江花", yomi: "えばな" },
      { name: "島津", yomi: "しまづ" },
    ],
  },
];

export const pdfUrl = (c) => `${PDF_BASE}/${c.pdf}.pdf`;
export const pdfFile = (c) => `${c.pdf}.pdf`;
