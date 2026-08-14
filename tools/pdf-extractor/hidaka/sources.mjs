// 日高市「ごみ収集日程表」(令和8年度 = 2026年4月〜2027年3月) の一次ソース。
//
// 全 20 コースが 1 本の PDF に載る。3・4 ページ目が「地区別ごみ収集日程表」で、
// コースごとに 7 行 × 14 列の表が 1 つずつ。行 = 品目、列 = 4月〜3月、セル = その月の日
// (「8・22」のように中黒区切り)。テキスト層があり pdfplumber の extract_tables で素直に取れる。
//
// 行政区名は表のヘッダにも載っているが、丸括弧つきの但し書き (「久保（高麗川）」) や
// 折り返しがあって表記が揺れるため、コース → areas の対応は収録済みデータに合わせて
// ここに設定として持つ (yomi は PDF に無い)。
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const HERE = dirname(fileURLToPath(import.meta.url));
export const CACHE = join(HERE, 'cache');

export const INDEX_URL =
  'https://www.city.hidaka.lg.jp/soshiki/shiminseikatsu/kankyo/haikibutsutaisaku/gomi/syusyu_hannyu/27861.html';
export const PDF_URL =
  'https://www.city.hidaka.lg.jp/material/files/group/13/reiwa8nendogominitteihyou.pdf';
export const PDF_FILE = 'reiwa8nendogominitteihyou.pdf';

export const PERIOD = '2026-04--2027-03';
export const EDITION_JA = '令和8年度';

// PDF の品目表記 → 正典 category。「ビン･カン」「粗大･金属」は同日収集の 2 品目をまとめた
// 市の呼称なので、構成カテゴリへ分解する (日程情報の欠落はゼロ)。
export const ITEM2CATS = {
  '古紙･古布': ['paper_cloth'],
  'ビン･カン': ['glass_bottle', 'beverage_can'],
  'ペットボトル': ['pet_bottle'],
  '有害ごみ': ['hazardous'],
  '粗大･金属': ['oversized', 'metal'],
};

// rules の並び順。PDF の表の行順 (古紙･古布 → ビン･カン → ペットボトル → 有害ごみ →
// 粗大･金属) に可燃を足したもので、収録済みデータもこの順になっている。
export const CAT_ORDER = [
  'burnable', 'paper_cloth', 'glass_bottle', 'beverage_can',
  'pet_bottle', 'hazardous', 'oversized', 'metal',
];

export const COURSES = [
  {
    course: '1',
    areas: [
      { name: "高萩北", yomi: "たかはぎきた" },
      { name: "旭ケ丘1", yomi: "あさひがおか1" },
      { name: "旭ケ丘2", yomi: "あさひがおか2" },
      { name: "駒寺", yomi: "こまでら" },
      { name: "栄新田", yomi: "さかえしんでん" },
      { name: "森高", yomi: "もりたか" },
    ],
  },
  {
    course: '2',
    areas: [
      { name: "馬引沢", yomi: "うまひきざわ" },
      { name: "中沢", yomi: "なかざわ" },
      { name: "向郷", yomi: "むかいごう" },
      { name: "女影上組", yomi: "おなかげかみぐみ" },
      { name: "女影北口", yomi: "おなかげきたぐち" },
    ],
  },
  {
    course: '3',
    areas: [
      { name: "谷津", yomi: "やつ" },
      { name: "下大谷沢", yomi: "しもおおやざわ" },
      { name: "高富", yomi: "たかとみ" },
      { name: "田木", yomi: "たぎ" },
      { name: "大谷沢", yomi: "おおやざわ" },
    ],
  },
  {
    course: '4',
    areas: [
      { name: "高萩団地", yomi: "たかはぎだんち" },
    ],
  },
  {
    course: '5',
    areas: [
      { name: "天神", yomi: "てんじん" },
    ],
  },
  {
    course: '6',
    areas: [
      { name: "こま川団地1", yomi: "こまがわだんち1" },
      { name: "こま川団地2", yomi: "こまがわだんち2" },
      { name: "こま川団地3", yomi: "こまがわだんち3" },
      { name: "高根台", yomi: "たかねだい" },
    ],
  },
  {
    course: '7',
    areas: [
      { name: "高麗川", yomi: "こまがわ" },
      { name: "平沢上組", yomi: "ひらさわかみぐみ" },
      { name: "馬金", yomi: "うまがね" },
      { name: "平沢中組", yomi: "ひらさわなかぐみ" },
      { name: "山根", yomi: "やまね" },
      { name: "川端", yomi: "かわばた" },
    ],
  },
  {
    course: '8',
    areas: [
      { name: "上鹿山", yomi: "かみかやま" },
      { name: "県営鹿山団地", yomi: "けんえいかやまだんち" },
    ],
  },
  {
    course: '9',
    areas: [
      { name: "東急こまがわ1", yomi: "とうきゅうこまがわ1" },
      { name: "東急こまがわ2", yomi: "とうきゅうこまがわ2" },
      { name: "東急こまがわ3", yomi: "とうきゅうこまがわ3" },
      { name: "東急こまがわ4", yomi: "とうきゅうこまがわ4" },
    ],
  },
  {
    course: '10',
    areas: [
      { name: "宮ケ谷戸", yomi: "みやがやと" },
      { name: "芝ケ谷戸", yomi: "しばがやと" },
      { name: "久保(高麗川)", yomi: "くぼこまがわ" },
      { name: "田波目", yomi: "たばめ" },
      { name: "新宿(高麗川)", yomi: "しんじゅくこまがわ" },
      { name: "旭ケ丘(高麗川)", yomi: "あさひがおかこまがわ" },
      { name: "鹿山上", yomi: "かやまかみ" },
    ],
  },
  {
    course: '11',
    areas: [
      { name: "日高台", yomi: "ひだかだい" },
    ],
  },
  {
    course: '12',
    areas: [
      { name: "日高団地", yomi: "ひだかだんち" },
    ],
  },
  {
    course: '13',
    areas: [
      { name: "新堀", yomi: "にいほり" },
      { name: "四本木", yomi: "しもとぎ" },
      { name: "野々宮", yomi: "ののみや" },
      { name: "猿田", yomi: "さるだ" },
      { name: "鹿山下", yomi: "かやましも" },
      { name: "中鹿山", yomi: "なかかやま" },
      { name: "下鹿山", yomi: "しもかやま" },
      { name: "太平洋セメント社宅", yomi: "たいへいようせめんとしゃたく" },
      { name: "市営住宅", yomi: "しえいじゅうたく" },
      { name: "ガーデンパーク", yomi: "があでんぱあく" },
    ],
  },
  {
    course: '14',
    areas: [
      { name: "原宿", yomi: "はらじゅく" },
    ],
  },
  {
    course: '15',
    areas: [
      { name: "別所", yomi: "べっしょ" },
      { name: "下高萩", yomi: "しもたかはぎ" },
      { name: "女影本村", yomi: "おなかげほんむら" },
      { name: "新宿(高萩)", yomi: "しんじゅくたかはぎ" },
    ],
  },
  {
    course: '16',
    areas: [
      { name: "高萩１・２・３", yomi: "たかはぎ123" },
      { name: "宮前", yomi: "みやまえ" },
      { name: "むさし野団地", yomi: "むさしのだんち" },
      { name: "相原", yomi: "あいはら" },
    ],
  },
  {
    course: '17',
    areas: [
      { name: "横手", yomi: "よこて" },
      { name: "久保（高麗）", yomi: "くぼこま" },
      { name: "高麗本郷", yomi: "こまほんごう" },
      { name: "日向", yomi: "ひなた" },
      { name: "清流", yomi: "せいりゅう" },
      { name: "上高岡", yomi: "かみたかおか" },
      { name: "下高岡", yomi: "しもたかおか" },
      { name: "梅原", yomi: "うめはら" },
    ],
  },
  {
    course: '18',
    areas: [
      { name: "台", yomi: "だい" },
      { name: "栗坪", yomi: "くりつぼ" },
      { name: "栗原", yomi: "くりはら" },
      { name: "元宿", yomi: "もとじゅく" },
    ],
  },
  {
    course: '19',
    areas: [
      { name: "こま武蔵台（1〜3丁目）", yomi: "こまむさしだい1" },
    ],
  },
  {
    course: '20',
    areas: [
      { name: "こま武蔵台（4〜7丁目）", yomi: "こまむさしだい4" },
      { name: "横手台（1,2丁目）", yomi: "よこてだい1" },
    ],
  },
];
