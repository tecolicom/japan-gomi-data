// 江東区の一次ソース URL と規約 (fetch / extract / build / verify で共有)。
//
// **都カタログの CSV は一次ソースにできない。** 現行版 (令和8年度版) と地区割が食い違う。
//
//   | 町   | CSV                        | 区の配布シート (令和8年度版) |
//   |------|----------------------------|------------------------------|
//   | 豊洲 | 全域 → 地区6               | 2・4〜6丁目 → 地区6 / 1・3丁目 → 地区12 |
//   | 塩浜 | 1丁目 → 地区6 / 2丁目 → 12 | 全域 → 地区12                |
//
// CKAN の last_modified は 2024-11-30、シートは令和8年度版 (ページ更新 2026-04-10)。
// 地理的にも塩浜1丁目を青海・有明 (湾を挟んだ埋立地) と同じ地区にする CSV 側が不自然。
// **シートを地区割の正典とする** (2026-09-12 に上流承認)。CSV は「修正」せず、
// 食い違いを事実として meta.yaml に記録する。中野区の OD が 2021 年止まりだったのと同型。
//
// 日本語の町名は CSV にしかない (多言語版は簡体字・ハングル表記) ので、
// **町名は CSV・地区割はシート**という分担になる。
export const INDEX_URL = 'https://www.city.koto.lg.jp/388010/kurashi/gomi/kate/43735.html';
export const SORT_URL = 'https://www.city.koto.lg.jp/388010/kurashi/gomi/kate/sigen.html';
export const CSV_URL = 'https://www.opendata.metro.tokyo.lg.jp/koto/131083_201_kotocity_waste_recycle_collectionday.csv';
const DOC = 'https://www.city.koto.lg.jp/388010/kurashi/gomi/kate/documents';

// 配布シート。日本語版は chars 0 の画像 PDF、裏面は CID フォント化けで、
// **多言語版だけがテキスト層を持つ** (豊島区と同じ構図)。
export const SHEETS = [
  { file: 'sheet-zh.pdf', url: `${DOC}/8ch.pdf`, lang: 'zh', label: '中国語版', primary: true },
  { file: 'sheet-ko.pdf', url: `${DOC}/8ko.pdf`, lang: 'ko', label: '韓国語版' },
];
// 照合用 (目視)。日本語版の表面 = 地区別の一覧そのもの。
export const SHEET_JA = { file: 'sheet-ja.pdf', url: `${DOC}/8omote.pdf`, label: '日本語版 (画像)' };

export const PERIOD = '2026-04--2027-03';
export const EDITION_JA = '令和8年度版 地区別 資源回収・ごみ収集日一覧';
export const DISTRICTS = 12;

// 年末年始。**カレンダーの実日付から出た窓で、選んだものではない。**
// 隔週の日付が 2026-12-29〜2027-01-02 に入る地区は、その日だけが印字されていない
// (地区2=12/29 / 地区3=12/30 / 地区4=12/31 / 地区5=1/1 / 地区6=1/2)。
// 窓の外の月曜 12/28・1/4 は印字されている。1/3 は日曜で元々収集が無い。
// シートは「※年末年始の収集日については、別途お知らせします。」と確定を留保しているので
// cancelled (収集なしの断定) にはせず unknown_periods に置く (板橋と同じ整理)。
export const YEAREND_UNKNOWN = {
  from: '2026-12-29',
  to: '2027-01-03',
  reason: '区のシートは隔週の収集日のうち 2026-12-29〜2027-01-02 に当たる日を印字せず、'
    + '「※年末年始の収集日については、別途お知らせします。」と確定を留保している。'
    + '1/3 は日曜で通常収集が無いが振替の告知がありうるため窓に含めた。'
    + 'なお実日付を持つのは燃やさないごみだけで、週次3品目にこの窓を適用する根拠は上記の注記である。',
  source_url: INDEX_URL,
};
export const YEAREND_BLANK = ['2026-12-29', '2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02'];

// 区の 4 区分 → 正典カテゴリ。
// 「資源」は 古紙・びん・かん・ペットボトル・**発泡トレイ/発泡スチロール** の同日収集。
// 発泡トレイに対応する正典語彙は無く、全国の台帳 127 件を見ても単独の収集日を持つ
// 自治体が 1 件も無い (檜原村も「缶・びん/ペットボトル/白色トレイ」で 1 タイル)。
// **語彙は足さず、ペットボトルを代表項目として表現する** (2026-09-12 に上流承認)。
// ラベルは列挙しない — 品目→種別の辞書はこのリポジトリの収録範囲外 (README)。
export const GROUP_CATEGORIES = {
  資源: ['paper', 'glass_bottle', 'beverage_can', 'pet_bottle'],
  プラスチック: ['plastic'],
  燃やすごみ: ['burnable'],
  燃やさないごみ: ['non_burnable'],
};

export const CAT_ORDER = [
  'burnable', 'non_burnable', 'plastic', 'paper',
  'glass_bottle', 'beverage_can', 'pet_bottle',
];

export const LG_CODE = '131083'; // 江東区 (ABR の lg_code)
export const ABR_PREF = '13';

// CSV とシートで地区割が食い違う町。**シートを採る** (上記の理由)。
// build はこの表に載っている町だけ食い違いを許し、それ以外の差異では止まる。
export const DISTRICT_OVERRIDES = [
  { name: '豊洲1・3丁目', district: 12, csvSaid: '豊洲 全域 → 地区6' },
  { name: '豊洲2・4～6丁目', district: 6, csvSaid: '豊洲 全域 → 地区6' },
  { name: '塩浜1～2丁目', district: 12, csvSaid: '塩浜1丁目 → 地区6 / 塩浜2丁目 → 地区12' },
];
// 上の override が置き換える CSV の行 (町名)。
export const CSV_ROWS_REPLACED = ['豊洲', '塩浜1丁目', '塩浜2丁目'];
