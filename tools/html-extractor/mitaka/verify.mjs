// 三鷹: 生成した course YAML を独立ソースと突き合わせる。
//
// 一次ソースは地区別 HTML の曜日規則で、そこには年末年始が載っていない。
// 独立照合の相手は地区別カレンダー PDF (日付入り) で、次の 3 つを見る。
//
//   1. 年末年始の休止日   PDF のテキスト層から機械抽出 (extract-yearend.py) → 全 10 地区
//   2. 1 月の繰り下げ注記  同上 → 該当 2 地区
//   3. カレンダー本体      品目マークが画像でテキストにならないため**目視転記**。
//                          下の PDF_SAMPLES に固定保持する (一過性にしない)
//
// 使い方: node verify.mjs
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import YAML from 'yaml';
import { expandRange } from '../../_lib/schedule.mjs';
import { CACHE, HERE, PERIOD, CLOSED_ALL, CLOSED_1229, JANUARY_SHIFT } from './sources.mjs';

const CANON = join(HERE, '..', '..', '..', 'municipalities', 'tokyo', 'mitaka', PERIOD);

// PDF ページ画像の目視転記。日付 -> その日に収集する category (収集なしの日は空配列)。
// 年末年始をまたぐ 12 月・1 月を、繰り下げのある 2 地区について全日書き出したもの
// (2026-08-15 に 120dpi のページ画像から読んだ)。土日は収集がない。
const PDF_SAMPLES = {
  // 牟礼全域: 金曜が 第1・3 ペットボトル / 第2・4 空きびん・缶
  '095682': {
    '2026-12-01': ['paper', 'cloth'],
    '2026-12-02': ['plastic', 'hazardous', 'non_burnable'],
    '2026-12-03': ['burnable'],
    '2026-12-04': ['pet_bottle'],
    '2026-12-07': ['burnable'],
    '2026-12-08': ['paper', 'cloth'],
    '2026-12-09': ['plastic', 'hazardous'],
    '2026-12-10': ['burnable'],
    '2026-12-11': ['glass_bottle', 'beverage_can'],
    '2026-12-14': ['burnable'],
    '2026-12-15': ['paper', 'cloth'],
    '2026-12-16': ['plastic', 'hazardous', 'non_burnable'],
    '2026-12-17': ['burnable'],
    '2026-12-18': ['pet_bottle'],
    '2026-12-21': ['burnable'],
    '2026-12-22': ['paper', 'cloth'],
    '2026-12-23': ['plastic', 'hazardous'],
    '2026-12-24': ['burnable'],
    '2026-12-25': ['glass_bottle', 'beverage_can'],
    '2026-12-28': ['burnable'],
    '2026-12-29': [],
    '2026-12-30': [],
    '2026-12-31': [],
    '2027-01-01': [],
    '2027-01-04': ['burnable'],
    '2027-01-05': ['paper', 'cloth'],
    '2027-01-06': ['plastic', 'hazardous', 'non_burnable'],
    '2027-01-07': ['burnable'],
    '2027-01-08': ['pet_bottle'],
    '2027-01-11': ['burnable'],
    '2027-01-12': ['paper', 'cloth'],
    '2027-01-13': ['plastic', 'hazardous'],
    '2027-01-14': ['burnable'],
    '2027-01-15': ['glass_bottle', 'beverage_can'],
    '2027-01-18': ['burnable'],
    '2027-01-19': ['paper', 'cloth'],
    '2027-01-20': ['plastic', 'hazardous', 'non_burnable'],
    '2027-01-21': ['burnable'],
    '2027-01-22': ['pet_bottle'],
    '2027-01-25': ['burnable'],
    '2027-01-26': ['paper', 'cloth'],
    '2027-01-27': ['plastic', 'hazardous'],
    '2027-01-28': ['burnable'],
    '2027-01-29': ['glass_bottle', 'beverage_can'],
  },
  // 下連雀1丁目～4丁目: 金曜が 古紙・古着(毎週) + 第1・3 空きびん・缶 / 第2・4 ペットボトル
  '095671': {
    '2026-12-01': ['plastic', 'hazardous'],
    '2026-12-02': ['non_burnable'],
    '2026-12-03': ['burnable'],
    '2026-12-04': ['paper', 'cloth', 'glass_bottle', 'beverage_can'],
    '2026-12-07': ['burnable'],
    '2026-12-08': ['plastic', 'hazardous'],
    '2026-12-09': [],
    '2026-12-10': ['burnable'],
    '2026-12-11': ['paper', 'cloth', 'pet_bottle'],
    '2026-12-14': ['burnable'],
    '2026-12-15': ['plastic', 'hazardous'],
    '2026-12-16': ['non_burnable'],
    '2026-12-17': ['burnable'],
    '2026-12-18': ['paper', 'cloth', 'glass_bottle', 'beverage_can'],
    '2026-12-21': ['burnable'],
    '2026-12-22': ['plastic', 'hazardous'],
    '2026-12-23': [],
    '2026-12-24': ['burnable'],
    '2026-12-25': ['paper', 'cloth', 'pet_bottle'],
    '2026-12-28': ['burnable'],
    '2026-12-29': [],
    '2026-12-30': [],
    '2026-12-31': [],
    '2027-01-01': [],
    '2027-01-04': ['burnable'],
    '2027-01-05': ['plastic', 'hazardous'],
    '2027-01-06': ['non_burnable'],
    '2027-01-07': ['burnable'],
    '2027-01-08': ['paper', 'cloth', 'glass_bottle', 'beverage_can'],
    '2027-01-11': ['burnable'],
    '2027-01-12': ['plastic', 'hazardous'],
    '2027-01-13': [],
    '2027-01-14': ['burnable'],
    '2027-01-15': ['paper', 'cloth', 'pet_bottle'],
    '2027-01-18': ['burnable'],
    '2027-01-19': ['plastic', 'hazardous'],
    '2027-01-20': ['non_burnable'],
    '2027-01-21': ['burnable'],
    '2027-01-22': ['paper', 'cloth', 'glass_bottle', 'beverage_can'],
    '2027-01-25': ['burnable'],
    '2027-01-26': ['plastic', 'hazardous'],
    '2027-01-27': [],
    '2027-01-28': ['burnable'],
    '2027-01-29': ['paper', 'cloth', 'pet_bottle'],
  },
};

const yePath = join(CACHE, 'yearend.json');
if (!existsSync(yePath)) throw new Error(`${yePath} が無い (先に extract-yearend.py を回す)`);
const yearend = JSON.parse(readFileSync(yePath, 'utf8')).districts;

let ng = 0;
const fail = (msg) => { console.log(`  ★ ${msg}`); ng++; };


for (const [id, ye] of Object.entries(yearend).sort()) {
  const doc = YAML.parse(readFileSync(join(CANON, `course-${id}.yaml`), 'utf8'));
  const expanded = expandRange(doc.metadata.period, doc.rules, doc.overrides);
  console.log(`course ${id} ${doc.metadata.course_name_ja}`);

  // 1. 休止日
  const cancelled = (doc.overrides || []).filter((o) => o.cancelled).map((o) => String(o.date)).sort();
  if (cancelled.join(',') !== ye.closed.join(',')) {
    fail(`休止日が PDF と不一致  YAML=[${cancelled}]  PDF=[${ye.closed}]`);
  }
  const expectClosed = [...CLOSED_ALL, ...(CLOSED_1229.includes(id) ? ['2026-12-29'] : [])].sort();
  if (ye.closed.join(',') !== expectClosed.join(',')) {
    fail(`PDF の休止日が sources.mjs の設定と不一致  PDF=[${ye.closed}]  設定=[${expectClosed}]`);
  }

  // 2. 注記との整合
  const hasShift = Boolean(JANUARY_SHIFT[id]);
  const noteShift = ye.notes.some((n) => n.includes('繰り下がる'));
  if (hasShift !== noteShift) fail(`1月の繰り下げ: 設定=${hasShift} だが PDF 注記=${noteShift}`);
  const noteExtra = ye.notes.some((n) => n.includes('臨時'));
  if (noteExtra === CLOSED_1229.includes(id)) {
    fail(`12/29: 臨時収集の注記=${noteExtra} なのに休止扱い=${CLOSED_1229.includes(id)}`);
  }
  if (noteExtra) {
    const got = [...(expanded.get('2026-12-29') || [])];
    if (got.join(',') !== 'burnable') fail(`12/29 は可燃の臨時収集のはずが [${got}]`);
  }

  // 3. 目視転記との照合
  const sample = PDF_SAMPLES[id];
  if (sample) {
    let diff = 0;
    for (const [day, cats] of Object.entries(sample)) {
      const got = [...(expanded.get(day) || [])].sort().join(',');
      const exp = [...cats].sort().join(',');
      if (got !== exp) { fail(`${day}  生成=[${got || 'なし'}]  目視=[${exp || 'なし'}]`); diff++; }
    }
    console.log(`     目視転記 ${Object.keys(sample).length} 日枠と照合、不一致 ${diff}`);
  }
}

const sampled = Object.values(PDF_SAMPLES).reduce((s, o) => s + Object.keys(o).length, 0);
console.log(`\n地区 ${Object.keys(yearend).length} / 目視転記 ${sampled} 日枠 / 不一致 ${ng}`);
if (ng) process.exitCode = 1;
