// 板橋区の一次ソース URL と規約 (fetch / extract / build / verify で共有)。
//
// 区は同じ日程を 2 通りに出している。**どちらも機械可読**なので、片方を一次ソース、
// もう片方を独立照合に使える。
//
//   A. 地域別カレンダー PDF (24 本) … 一次ソース
//      東①〜⑫ + 西①〜⑫。A4 1 ページに令和8年4月〜令和9年3月の通年カレンダー。
//      テキスト層に曜日規則が明記され (「資源：週1回 土」等)、本体は 3 色の塗りセル。
//      **規則と実日付の両方が同じ PDF から取れる。**
//
//   B. 索引ページの HTML 表 (70 行) … 照合用
//      町丁目 × 資源/可燃/不燃の曜日 + 地域番号。PDF とは別に組まれた表現。
//      地区割 (町丁目 → 地域) はこちらが正典で、PDF ヘッダが逆向き (地域 → 町丁目) を持つ。

export const INDEX_URL = 'https://www.city.itabashi.tokyo.jp/tetsuduki/gomi/kaishu/1038152.html';
export const SORT_URL = 'https://www.city.itabashi.tokyo.jp/tetsuduki/gomi/shigen/1001856.html';
const BASE = 'https://www.city.itabashi.tokyo.jp/_res/projects/default_project/_page_/001/038/152/r8';

// 24 地域。course は下流の識別子になるので、区の呼称 (東N/西N) をそのまま ASCII 化する。
// **URL の置き場が東西で違う** — 西は r8/ 直下、東は r8/higashi/nishi/ 配下 (区側の名残)。
export const AREAS = [];
for (const side of ['e', 'w']) {
  for (let n = 1; n <= 12; n++) {
    const pad = String(n).padStart(2, '0');
    AREAS.push({
      id: `${side}${n}`,                       // metadata.course
      file: `${side}${pad}.pdf`,               // cache 上のファイル名
      nameJa: `${side === 'e' ? '東' : '西'}${n}`, // course_name_ja (区の呼称)
      label: `${side === 'e' ? '東' : '西'}${n}`,  // HTML 表の「地域別カレンダー番号」
      url: side === 'w' ? `${BASE}/w${pad}.pdf` : `${BASE}/higashi/nishi/e${pad}.pdf`,
    });
  }
}

// 収録期間。PDF の表題「令和８年４月～令和９年３月」がそのまま裏付ける。
export const PERIOD = '2026-04--2027-03';
export const EDITION_JA = '地域別 資源回収・ごみ収集曜日カレンダー(令和8年度版)';

// 年末年始。24 地域すべてで 12/31・1/1・1/2 のセルだけが空で、他は曜日規則と完全一致する。
// ただし PDF 自身が「年末年始の収集日は、改めて…お知らせいたします」と確定を留保しているので、
// **cancelled (収集なしの断定) にはせず unknown_periods (不明) に置く。**
// 1/3 は日曜で元々どの地域も収集が無いが、振替が告知される可能性を否定できないので窓に含める。
// 12/29・12/30 は塗りセルが実在する = ソースが収集を主張しているので窓に入れない。
export const YEAREND_UNKNOWN = {
  from: '2026-12-31',
  to: '2027-01-03',
  reason: '区のカレンダー PDF は 12/31〜1/2 のセルを空にしたうえで「年末年始の収集日は、'
    + '改めて板橋区ホームページ、区報、集積所看板への張り紙でお知らせいたします。」と'
    + '確定を留保している。1/3 は日曜で通常収集が無いが振替の告知がありうるため窓に含めた。',
  source_url: INDEX_URL,
};
// 上の窓の中で、カレンダーが実際に空にしている日 (extract の結果と突き合わせる)。
export const YEAREND_BLANK = ['2026-12-31', '2027-01-01', '2027-01-02'];

// カレンダー本体のセル塗り色 → 区分。PDF の凡例と一致することを extract.py が検査する。
export const CELL_COLORS = {
  '1.0,0.8,0.8': '可燃',
  '0.0,1.0,0.0': '資源',
  '0.0,1.0,1.0': '不燃',
};

// 区の 3 区分 → 正典カテゴリ。「資源」は 5 品目の同日収集。
export const GROUP_CATEGORIES = {
  資源: ['plastic', 'paper', 'glass_bottle', 'beverage_can', 'pet_bottle'],
  可燃: ['burnable'],
  不燃: ['non_burnable'],
};

export const CAT_ORDER = [
  'burnable', 'non_burnable', 'plastic', 'paper',
  'glass_bottle', 'beverage_can', 'pet_bottle',
];

export const LG_CODE = '131199'; // 板橋区 (ABR の lg_code)
export const ABR_PREF = '13';

// 区の収集日資料 (HTML 表・24 PDF のヘッダ) に一度も出てこない ABR 町字。
// ABR 上は 1947 年から現存 (status_flg=1・廃止日なし) だが、区が日程を公表していない。
// **推測でデータを作らない**ので収録しない。網羅検査はこの 2 件だけを例外として通す。
export const TOWNS_NOT_PUBLISHED = ['上赤塚町', '下赤塚町'];
