// 飯能市「家庭ごみ収集カレンダー」(令和8年度 = 2026年4月〜2027年3月) の一次ソース。
//
// 市はコース別に 1 本ずつ PDF を貼っている。PDF はテキスト層が全く無く (chars 0)、
// 表紙帯のコース記号・コース名・町名も、カレンダー内の日番号も、すべてアウトライン化
// された図版である。ピクセルから読めるのは「どの日のセルにどの色が塗られているか」だけ。
// したがって コース → PDF / コース名 / areas の対応はここに設定として持つ。
// areas の表記と yomi は市の地区割 (PDF 表紙帯) と ABR 由来の既存収録に合わせてある。
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const HERE = dirname(fileURLToPath(import.meta.url));
export const CACHE = join(HERE, 'cache');

export const INDEX_URL =
  'https://www.city.hanno.lg.jp/soshikikarasagasu/kankyokeizaibu/cleancenter/4/893.html';

export const PDF_URL = (slug) => `https://www.city.hanno.lg.jp/material/files/group/22/2026${slug}.pdf`;
export const PDF_FILE = (slug) => `2026${slug}.pdf`;

export const PERIOD = '2026-04--2027-03';
export const EDITION_JA = '令和8年度';

export const COURSES = [
  {
    course: 'A-1',
    slug: 'haraichibanaguri',
    nameJa: '原市場・名栗',
    areas: [
      { name: '原市場', yomi: 'はらいちば' },
      { name: '下赤工', yomi: 'しもあかだくみ' },
      { name: '上赤工', yomi: 'かみあかだくみ' },
      { name: '赤沢', yomi: 'あかざわ' },
      { name: '唐竹', yomi: 'からたけ' },
      { name: '中藤下郷', yomi: 'なかとうしもごう' },
      { name: '中藤中郷', yomi: 'なかとうなかごう' },
      { name: '中藤上郷', yomi: 'なかとうかみごう' },
      { name: '南', yomi: 'みなみ' },
      { name: '下名栗', yomi: 'しもなぐり' },
      { name: '上名栗', yomi: 'かみなぐり' },
    ],
  },
  {
    course: 'A-2',
    slug: 'chuuoiminami',
    nameJa: '中央南',
    areas: [
      { name: '柳町', yomi: 'やなぎちょう' },
      { name: '仲町', yomi: 'なかまち' },
      { name: '稲荷町', yomi: 'いなりちょう' },
      { name: '南町', yomi: 'みなみまち' },
      { name: '大河原', yomi: 'おおかわら' },
      { name: '茜台', yomi: 'あかねだい' },
      { name: '美杉台', yomi: 'みすぎだい' },
      { name: '岩渕', yomi: 'いわぶち' },
      { name: '下畑', yomi: 'しもはた' },
      { name: '上畑', yomi: 'かみはた' },
      { name: '苅生', yomi: 'かろう' },
      { name: '下直竹', yomi: 'しもなおたけ' },
      { name: '上直竹下分', yomi: 'かみなおたけしもぶん' },
      { name: '上直竹上分', yomi: 'かみなおたけかみぶん' },
    ],
  },
  {
    course: 'A-3',
    slug: 'kaji',
    nameJa: '加治コース',
    areas: [
      { name: '岩沢(国道299号旧道南)', yomi: 'いわさわ' },
      { name: '笠縫', yomi: 'かさぬい' },
      { name: '川寺', yomi: 'かわでら' },
      { name: '阿須', yomi: 'あず' },
      { name: '落合', yomi: 'おちあい' },
      { name: '前ヶ貫', yomi: 'まえがぬき' },
      { name: '矢颪', yomi: 'やおろし' },
      { name: '征矢町', yomi: 'そやちょう' },
      { name: '双柳(国道299号旧道南)', yomi: 'なみやなぎ' },
    ],
  },
  {
    course: 'B-1',
    slug: 'higashiaganoagano',
    nameJa: '東吾野・吾野',
    areas: [
      { name: '白子', yomi: 'しらこ' },
      { name: '平戸', yomi: 'ひらっと' },
      { name: '虎秀', yomi: 'こしゅう' },
      { name: '井上', yomi: 'いのうえ' },
      { name: '長沢', yomi: 'ながさわ' },
      { name: '坂石町分', yomi: 'さかいしまちぶん' },
      { name: '坂石', yomi: 'さかいし' },
      { name: '吾野', yomi: 'あがの' },
      { name: '上長沢', yomi: 'かみながさわ' },
      { name: '高山', yomi: 'たかやま' },
      { name: '北川', yomi: 'きたがわ' },
      { name: '坂元', yomi: 'さかもと' },
      { name: '南川', yomi: 'みなみかわ' },
    ],
  },
  {
    course: 'B-2',
    slug: 'chuuoukita',
    nameJa: '中央北',
    areas: [
      { name: '山手町', yomi: 'やまてちょう' },
      { name: '本町', yomi: 'ほんちょう' },
      { name: '八幡町', yomi: 'はちまんちょう' },
      { name: '新町', yomi: 'しんまち' },
      { name: '東町', yomi: 'あずまちょう' },
      { name: '飯能', yomi: 'はんのう' },
      { name: '原町', yomi: 'はらまち' },
      { name: '久下', yomi: 'くげ' },
      { name: '中山(JR八高線西)', yomi: 'なかやま' },
      { name: '久須美', yomi: 'くすみ' },
      { name: '小瀬戸', yomi: 'こせど' },
      { name: '小岩井', yomi: 'こいわい' },
      { name: '永田', yomi: 'ながた' },
      { name: '永田台', yomi: 'ながただい' },
    ],
  },
  {
    course: 'B-3',
    slug: 'seimei',
    nameJa: '精明コース',
    areas: [
      { name: '下加治', yomi: 'しもかじ' },
      { name: '小久保', yomi: 'こくぼ' },
      { name: '宮沢', yomi: 'みやざわ' },
      { name: '平松', yomi: 'ひらまつ' },
      { name: '川崎', yomi: 'かわさき' },
      { name: '下川崎', yomi: 'しもかわさき' },
      { name: '新光', yomi: 'しんこう' },
      { name: '芦苅場', yomi: 'あしかりば' },
      { name: '双柳(国道299号旧道北)', yomi: 'なみやなぎ' },
      { name: '青木', yomi: 'あおき' },
      { name: '中居', yomi: 'なかい' },
      { name: '栄町', yomi: 'さかえちょう' },
      { name: '緑町', yomi: 'みどりちょう' },
      { name: '中山(JR八高線東)', yomi: 'なかやま' },
      { name: '岩沢(国道299号旧道北)', yomi: 'いわさわ' },
    ],
  },
];
