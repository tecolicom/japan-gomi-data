// 中央区の一次ソース URL と規約 (fetch / parse / build / verify で共有)。
//
//   一次ソース … 区公式「あなたの町のごみ・資源収集曜日」HTML 表 (3 地域・56 行)。
//                **日本語の町名があるのはここだけ。**
//                ページ表示の「更新日 2023年1月18日」は古いメタデータで、
//                HTTP Last-Modified は 2026-07-30。実体は新しい。
//
//   照合     … 「ごみと資源の分け方・出し方」パンフレットの**外国語版 3 種**。
//                英語・中国語・韓国語のいずれにも同じ曜日表が入っており、
//                それぞれ別に組版されている (豊島・江東と同じ構図)。
//                日本語版パンフは画像 PDF (27+25 ページで 54 字) で読めない。
//
// **鮮度の裁定は先に決めてある。** HTML (Last-Modified 2026-07-30) はパンフレット
// (令和8年1月発行) より新しいので、食い違ったら **HTML を正**とする。
// 差分を見てから決めない (江東で CSV が古かった教訓)。
export const INDEX_URL = 'https://www.city.chuo.lg.jp/a0039/kurashi/gomi/calendar/syuusyuuyoubi.html';
export const SORT_URL = 'https://www.city.chuo.lg.jp/a0039/kurashi/gomi/shigen/sigen.html';
export const PAMPHLET_URL = 'https://www.city.chuo.lg.jp/a0039/kurashi/gomi/bunbetsu/wakekata/panhuretto.html';
const DOC = 'https://www.city.chuo.lg.jp/documents/5392';

export const PAMPHLETS = [
  { file: 'pamph-en.pdf', url: `${DOC}/english2024.pdf`, lang: 'en', label: '英語版' },
  { file: 'pamph-zh.pdf', url: `${DOC}/chinese2024.pdf`, lang: 'zh', label: '中国語版' },
  { file: 'pamph-ko.pdf', url: `${DOC}/korean2024.pdf`, lang: 'ko', label: '韓国語版' },
];

// 収録期間。**この表は曜日規則だけで日付を持たない。**
//
// 始端 … パンフレットの発行月 (令和8年1月)。HTML にも表にも年度の主張が無いので、
//        4 月起点にすると根拠が「慣例」だけになる。schema は暦年起点を許す (川口の先例)。
// 終端 … 11 月。**年末年始の記述がどこにも無い** — 区サイトにもパンフレット
//        (日英中韓) にも、年末年始ページにも。運用ルールとして公表されているのは
//        「日曜日は収集しない」だけ (パンフ英語版 `No collection on Sundays.` /
//        中国語版「收集日：星期日不予收集」)。12 月については休止も収集も主張しない。
//
// 祝日は収集すると読む — ソースが例外を列挙していて祝日がそこに無いため。
// ただし豊島の「祝日(年末年始を除く)も収集します」より根拠は弱い。
export const PERIOD = '2026-01--2026-11';
export const EDITION_JA = '「ごみと資源の分け方・出し方」(令和8年1月発行) / 区公式「あなたの町のごみ・資源収集曜日」';

// 表の列。粗大ごみは**申込制なので収録しない**が、照合には使う (無料で得られる 5 列目)。
export const COLUMNS = ['燃やすごみ', '燃やさないごみ', 'プラマーク', '資源', '粗大ごみ'];
export const EMITTED = ['燃やすごみ', '燃やさないごみ', 'プラマーク', '資源'];

// 区の区分 → 正典カテゴリ。
// 資源の内訳は区「資源の分け方・出し方」による — 新聞・雑誌・雑紙・段ボール (古紙)、
// ペットボトル、びん・缶・**金属製のなべ・やかん・フライパン**。
export const GROUP_CATEGORIES = {
  燃やすごみ: ['burnable'],
  燃やさないごみ: ['non_burnable'],
  プラマーク: ['plastic'],
  資源: ['paper', 'glass_bottle', 'beverage_can', 'pet_bottle', 'metal'],
};

export const CAT_ORDER = [
  'burnable', 'non_burnable', 'plastic', 'paper',
  'glass_bottle', 'beverage_can', 'pet_bottle', 'metal',
];

export const LG_CODE = '131024'; // 中央区 (ABR の lg_code)
export const ABR_PREF = '13';

// 3 地域。HTML の表 3 枚に対応する。
export const AREAS_JA = ['京橋地域', '日本橋地域', '月島地域'];
