// 豊島区の一次ソース URL とファイル名の規約 (fetch / build / verify で共有)。
//
// 区は「資源とごみの分け方・出し方」の**曜日一覧**を 2 系統で出している。
//
//   A. 保存版冊子 p34-35「資源回収・ごみ収集曜日一覧(50音順)」
//      → Microsoft Print To PDF 製。pdfplumber で chars 0 の完全な画像 PDF。
//         人が見れば読めるが機械では読めない。**照合用**に使う (verify.mjs で目視転記と突合)。
//
//   B. 外国語版リーフレット「資源回収・ごみ収集のお知らせ」と「曜日一覧」(2 ページ)
//      → p2 に A と同じ表がテキスト層つきで載る。町丁名も曜日も**日本語のまま**で、
//         その右に各言語の訳が並ぶ。**これを一次ソースにする。**
//
// B は 6 言語版 (英中韓 / ベトナム / ミャンマー / ネパール / タイ / ヒンディー) があり、
// それぞれ別に組版されている。同じ表を 6 通りの版面で持っているので、
// **版どうしの相互照合**ができる (verify.mjs)。
//
// survey.yaml (2026-07-18) は B を「分別ルール解説主体で町名別曜日表は含まず=照合力弱い」と
// 書いていたが誤り。p2 が表そのものである。字数も「約17.4万字」とあるが実測 4.8 万字。

export const LANDING_URL = 'https://www.city.toshima.lg.jp/gomi-fl/foreignlanguage.html';
export const SCHEDULE_PAGE_URL = 'https://www.city.toshima.lg.jp/150/kurashi/gomi/shigen/2303021832.html';
export const YEAREND_PAGE_URL = 'https://www.city.toshima.lg.jp/150/kurashi/gomi/shigen/2211020850.html';

const DOC = 'https://www.city.toshima.lg.jp/documents';

// 一次ソース: 英語・中国語・韓国語版。曜日セルの隣に英訳が並ぶので
// 「日本語セル ↔ 英語セル」の内部照合ができる。他言語版にこれは無い。
export const PRIMARY = {
  file: 'leaflet-en-zh-ko.pdf',
  url: `${DOC}/27707/20260716110355.pdf`,
  label: '英語版・中国語版・韓国語版',
  // 町丁名 (日本語) セルの右端。ここより右は各言語の訳。
  // 日本語名は左端 15.5pt から始まり、セル幅の都合で必ず 119.5pt 未満で折り返す。
  nameXMax: 119.5,
};

// 照合用: 同じ表の別言語版。組版が別なので転記のずれを検出できる。
export const CROSS_LANG = [
  { file: 'leaflet-vi.pdf', url: `${DOC}/27707/20260716110657.pdf`, label: 'ベトナム語版' },
  { file: 'leaflet-my.pdf', url: `${DOC}/27707/20260716110818.pdf`, label: 'ミャンマー語版' },
  { file: 'leaflet-ne.pdf', url: `${DOC}/27707/20260716110924.pdf`, label: 'ネパール語版' },
  { file: 'leaflet-th.pdf', url: `${DOC}/27707/20260716111103.pdf`, label: 'タイ語版' },
  { file: 'leaflet-hi.pdf', url: `${DOC}/27707/20260716111203.pdf`, label: 'ヒンディー語版' },
];

// 照合用: 保存版冊子の曜日一覧 (画像 PDF)。verify.mjs の目視転記の対象。
export const BOOKLET = {
  file: 'youbi-ichiran.pdf',
  url: `${DOC}/1053/20260403165803.pdf`,
  label: '保存版「資源回収・ごみ収集曜日一覧(50音順)」',
};

// 収録期間。**会計年度ではなく一次ソースが裏付ける範囲**。
//
// このリーフレットは曜日規則しか持たず日付を持たない。ただし表の欄外に
// 「雨の日や祝日(年末年始を除く)も資源やごみを収集します」と恒常ルールが明記されており、
// 祝日は通常収集なので祝日表は要らない (東久留米で撤退の決め手になった問題は起きない)。
//
// 期間の上限を決めているのは年末年始だけ。区の「年末年始の資源回収・ごみ収集について」は
// 2026-08-31 時点で令和7年度版 (2025-12-31〜2026-01-04) のままで、
// 2026→2027 の休止日は未公表。鯖江の実例が示すとおり年末の最終日は 12 月下旬の
// どこにでも来るので、**12 月はソースが裏付けない**。告知が出たら期間を延ばす。
export const PERIOD = '2026-04--2026-11';

// 刊行物の呼び名。区は版を「令和8年度版」等と名乗っていないので、刊行物名をそのまま置く。
export const EDITION_JA = '「資源回収・ごみ収集のお知らせ」と「曜日一覧」(2026年7月16日掲載)';

export const LG_CODE = '131164'; // 豊島区 (ABR の lg_code)
export const ABR_PREF = '13';

// 表の 4 列。左から順に並んでおり、1 列が複数の正典カテゴリに対応することがある
// (同日収集なので days 配列を共有する = YAML anchor になり同日性が明示される)。
export const COLUMNS = [
  { label: 'びん・かん・ペットボトル類', pattern: 'weekly', categories: ['glass_bottle', 'beverage_can', 'pet_bottle'] },
  { label: '段ボール・紙布類 / プラスチック', pattern: 'weekly', categories: ['paper_cloth', 'plastic'] },
  { label: '燃やすごみ', pattern: 'weekly', categories: ['burnable'] },
  { label: '金属・陶器・ガラスごみ', pattern: 'monthly_nth', categories: ['non_burnable'] },
];

// course YAML の rules を並べる順 (全コースで同じ順に揃える)
export const CAT_ORDER = [
  'burnable', 'non_burnable', 'plastic', 'paper_cloth',
  'glass_bottle', 'beverage_can', 'pet_bottle',
];
