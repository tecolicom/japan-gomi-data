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
// 終端 … 2027 年 3 月。**年末年始の記述が公表資料に無い** — 区サイトにもパンフレット
//        (日英中韓) にも。運用ルールとして公表されているのは「日曜日は収集しない」だけ
//        (パンフ英語版 `No collection on Sundays.` / 中国語版「收集日：星期日不予收集」)。
//        区の FAQ は「年末年始の収集については決まり次第、チラシや集積所の看板への張り紙等で
//        お知らせします」で、例年 12 月 15 日号の区報に載る。
//        当初 (2026-09-15) は 11 月で切ったが、それでは 12/1 から告知までカレンダーが空になるので、
//        2026-10-23 に 2027-03 まで延ばし、年末年始の窓だけを不明 (unknown_periods) にした。
//
// 祝日は収集すると読む — ソースが例外を列挙していて祝日がそこに無いため。
// ただし豊島の「祝日(年末年始を除く)も収集します」より根拠は弱い。
export const PERIOD = '2026-01--2027-03';

// 年末年始の FAQ (「決まり次第お知らせ」)
export const YEAREND_FAQ_URL = 'https://www.city.chuo.lg.jp/a0039/faq/kurashi/gomi/shuushuu/0005.html';

// 年末年始の不明区間。豊島区と同じ窓 (豊島区の前年度の休止 12/31〜1/4 と江東区の窓 12/29〜 を含む幅)。
// 中央区は前年度の休止日も手元の資料に無いので、窓の幅は近隣区に合わせた。
export const YEAREND_UNKNOWN = {
  from: '2026-12-29',
  to: '2027-01-04',
  reason: '区は年末年始の収集を「決まり次第、チラシや集積所の看板への張り紙等でお知らせします」としており、'
    + '2026-10-23 時点で未公表。公表資料の運用ルールは「日曜日は収集しない」だけで、年末年始は曜日規則どおりと言えない。',
  source_url: YEAREND_FAQ_URL,
};
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
