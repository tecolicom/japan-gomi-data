// 鯖江市 ごみ収集日程の一次ソース定義。
//
// 日程の本体は**福井県オープンデータの CSV** (町名 × 品目 → 収集曜日)。
// 曜日しか書いていないので、実日付に落とすには別の資料が 2 つ要る。
//
//   1. 祝日        — 内閣府「国民の祝日について」の CSV (公式)。
//                    可燃は休日も収集するが、資源系は祝日は収集しない
//   2. 年末年始    — エコプラザさばえの PDF。**品目別・曜日別に最終日と開始日が違う**ので
//                    「12/29〜1/3 休止」のような一律の期間では表せない。毎年更新される
//
// PDF には特別収集日 (2 週連続で祝日になり通常収集ができない場合の振替) も載る。
// 2026 年度は水コースの 5/6 がこれに当たり、**祝日だが収集する**。
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const CACHE = join(HERE, 'cache');

export const PERIOD = '2026-04--2027-03';
export const EDITION_JA = '令和8年度';
export const INDEX_URL =
  'https://www.city.sabae.fukui.jp/kurashi_tetsuduki/gomi_risaikuru/kateigomi/index.html';
export const SCHEDULE_CSV =
  'https://www.pref.fukui.lg.jp/doc/dx-suishin/list_ct_gomisyusyubi_d/fil/sabaeshisyusyubi.csv';
export const YEAREND_PDF =
  'https://www.ecoplaza-sabae.jp/_files/ugd/622687_af9f8871cc87414789446ad8caf412fc.pdf';
// 内閣府 国民の祝日 (1955 年〜翌年分まで。毎年 2 月頃に翌年が追加される)
export const HOLIDAY_CSV = 'https://www8.cao.go.jp/chosei/shukujitsu/syukujitsu.csv';

export const FILES = {
  schedule: 'sabaeshisyusyubi.csv',
  yearend: 'yearend.pdf',
  holiday: 'syukujitsu.csv',
};

// CSV の品目列 → 正典語彙。**同じ曜日に出す品目をまとめる**ので多対一になる。
// 「廃食用油（天ぷら油）」は正典 categories.yaml に該当が無く、同日収集の別品目にも
// 寄せられないため**収録しない** (語彙を勝手に増やさない。上流に相談する案件)。
export const COLUMN_MAP = {
  '燃やすごみ': 'burnable',
  '燃えないごみ': 'non_burnable',
  '空きびん': 'glass_bottle',
  '空き缶': 'beverage_can',
  'ペットボトル': 'pet_bottle',
  '白トレー': 'plastic',
  '色トレー・その他プラスチック製容器包装': 'plastic',
  '容器包装以外のプラスチック類': 'plastic',
  '雑紙類': 'paper_cloth',
  '雑誌類': 'paper_cloth',
  '新聞紙': 'paper_cloth',
  '段ボール': 'paper_cloth',
  '牛乳パック': 'paper_cloth',
  '繊維類': 'paper_cloth',
  'スプレー缶類': 'hazardous',
  '乾電池類': 'hazardous',
  '充電式電池を含む製品': 'hazardous',
  '蛍光灯': 'hazardous',
  '廃食用油（天ぷら油）': null,   // 正典語彙に無い。収録しない
};

// course YAML の rules 出力順 (決定的に保つため固定)
export const CAT_ORDER = [
  'burnable', 'non_burnable', 'glass_bottle', 'beverage_can',
  'pet_bottle', 'plastic', 'paper_cloth', 'hazardous',
];

// 可燃以外はすべて「資源系」— 祝日は収集しない側
export const isResource = (c) => c !== 'burnable';

// コース番号の割り当て。(燃やすごみの曜日, 資源の曜日) → course。
// **収録時 (2026-07) の番号をそのまま保つ。** 下流は metadata.course で識別するので
// 番号が動くと URL も購読も壊れる。CSV の出現順に振り直してはいけない。
export const COURSE_IDS = [
  { burnDays: ['MO', 'TH'], resDay: 'TU', course: '1' },
  { burnDays: ['MO', 'TH'], resDay: 'FR', course: '2' },
  { burnDays: ['TU', 'FR'], resDay: 'TH', course: '3' },
  { burnDays: ['TU', 'FR'], resDay: 'WE', course: '4' },
];
