// 品川区 ODP 縦持ち CSV のパーサ (経路 A: 日本語ラベル解釈)。
//
// 列: ゴミ分類区分,地区名,地区名(英語),収集曜日,祝日の収集,
//     特別に収集する日,特別に収集しない日,適用開始日,適用終了日,標準地域コード
// 収集曜日の表記ゆれ: "火・金" / "第2木・第4木" / "第２木・第４木" (全角数字混在)。
//   → _lib/jp.mjs の normJa/zen2han が吸収する。
// 品川区の「第n<曜日>・第m<曜日>」は曜日を繰り返す形式なので、_lib の
//   parseMonthlyNthJa ("第1,3月曜日" 形式) はそのままでは使えない。ここで専用に解く。
import { DAY_JA, normJa } from '../../_lib/jp.mjs';

// 品川区の収集区分は 3 つ (粗大ごみは申込制のため曜日表に載らない)。
// 「資源」は複数品目を同一曜日に「資源回収ステーション」で回収する区の呼称なので、
// 正典語彙 (schema/categories.yaml) の構成品目へ分解する (中野・杉並・入間と同方式)。
// 区公式の資源の内訳 (2025年版「資源・ごみの分け方・出し方」/ 令和8年版カレンダー):
//   資源プラスチック (製品プラスチック + プラスチック製容器包装) … plastic
//   飲食用のペットボトル                                        … pet_bottle
//   飲食用のびん                                                … glass_bottle
//   飲食用の缶                                                  … beverage_can
//   古紙 (新聞・折込チラシ・段ボール・雑誌書籍・紙パック・雑がみ) … paper
//   蛍光灯・水銀体温計・水銀血圧計・乾電池                        … hazardous
// ※古着・古布は「資源」ではなく拠点回収 (毎月第2・4土曜 午前10時〜正午、区内一律) のため対象外。
// 日程は同一なので days 配列を共有させ、YAML anchor で同日性を明示する。
export const CATEGORY_MAP = {
  燃やすごみ: ['burnable'],
  '陶器・ガラス・金属ごみ': ['non_burnable'],
  資源: ['plastic', 'pet_bottle', 'glass_bottle', 'beverage_can', 'paper', 'hazardous'],
};

const CSV_COLUMNS = [
  'ゴミ分類区分', '地区名', '地区名(英語)', '収集曜日', '祝日の収集',
  '特別に収集する日', '特別に収集しない日', '適用開始日', '適用終了日', '標準地域コード',
];

// 引用符対応の素朴な CSV パーサ (全フィールドが引用されているとは限らない)
export function parseCsvText(text) {
  const rows = [];
  let row = [], field = '', inQ = false;
  const src = text.replace(/^﻿/, '');
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQ) {
      if (c === '"') { if (src[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += c;
    } else if (c === '"') inQ = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((f) => f !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); if (row.some((f) => f !== '')) rows.push(row); }
  return rows;
}

// "火・金" → {pattern:'weekly', days:['TU','FR']}
// "第2木・第4木" / "第１月・第３月" → {pattern:'monthly_nth', occurrences:[2,4], days:['TH']}
// 未知表記は throw する (黙って落とさない)。
export function parseCollectionDay(text) {
  const t = normJa(text); // 全角数字→半角・区切り正規化
  if (!t) throw new Error(`収集曜日が空`);
  const parts = t.split('・').filter(Boolean);

  if (parts.every((p) => /^第\d[日月火水木金土]$/.test(p))) {
    const occurrences = [], days = new Set();
    for (const p of parts) {
      const n = Number(p[1]);
      if (!(n >= 1 && n <= 5)) throw new Error(`第n の範囲外: "${text}"`);
      occurrences.push(n);
      days.add(DAY_JA[p[2]]);
    }
    if (days.size !== 1) throw new Error(`第n で曜日が複数: "${text}" (未対応の表記)`);
    return { pattern: 'monthly_nth', occurrences: [...new Set(occurrences)].sort((a, b) => a - b), days: [...days] };
  }

  if (parts.every((p) => /^[日月火水木金土]$/.test(p))) {
    return { pattern: 'weekly', days: parts.map((p) => DAY_JA[p]) };
  }

  throw new Error(`収集曜日パース失敗: "${text}" (第n と毎週の混在か未知表記)`);
}

// CSV → [{category, area, day:{pattern,days,occurrences}, holiday, specialCollect, specialSkip, from, to}]
export function parseShinagawaCsv(text) {
  const rows = parseCsvText(text);
  const header = rows[0];
  for (const name of CSV_COLUMNS) {
    if (!header.includes(name)) throw new Error(`CSV に列 "${name}" が無い (ヘッダ変更? 実際: ${header.join('|')})`);
  }
  const idx = Object.fromEntries(CSV_COLUMNS.map((n) => [n, header.indexOf(n)]));
  return rows.slice(1).map((r, i) => {
    const category = r[idx['ゴミ分類区分']].trim();
    if (!CATEGORY_MAP[category]) throw new Error(`未知のゴミ分類区分: "${category}" (行 ${i + 2})`);
    return {
      category,
      area: r[idx['地区名']].trim(),
      day: parseCollectionDay(r[idx['収集曜日']]),
      holiday: r[idx['祝日の収集']].trim(),        // '○' = 祝日も収集
      specialCollect: r[idx['特別に収集する日']].trim(),
      specialSkip: r[idx['特別に収集しない日']].trim(),
      from: r[idx['適用開始日']].trim(),
      to: r[idx['適用終了日']].trim(),
    };
  });
}

// 1 地区の 3 分類 → rules 配列。同日収集の「資源」構成品目は days 配列を共有する。
// byCategory: { '燃やすごみ': {pattern, days, occurrences?}, … } (parseCollectionDay の返り値)
export function areaToRules(byCategory) {
  const rules = [];
  for (const [ja, cats] of Object.entries(CATEGORY_MAP)) {
    const day = byCategory[ja];
    if (!day) throw new Error(`分類 "${ja}" の収集日が無い`);
    const { pattern, days, occurrences } = day;
    const shared = days; // 同一参照 → yaml が anchor 化し同日性が明示される
    for (const category of cats) {
      rules.push(occurrences
        ? { category, pattern, occurrences, days: shared }
        : { category, pattern, days: shared });
    }
  }
  return rules;
}
