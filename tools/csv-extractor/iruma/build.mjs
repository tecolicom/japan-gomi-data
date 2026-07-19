// 入間市: 埼玉県 OD の日付入り収集カレンダー CSV → course YAML + meta.yaml + taxonomy.yaml。
//
// 手順:
//   1. cache/iruma.csv (cp932) を読み、収集地域ごとに Map<iso, Set<category>> を組む。
//   2. 各地域・各品目の通年日付列から収集規則を推定する:
//        - 主要曜日を毎週欠かさない品目           → weekly
//        - その月 n 回目の該当曜日 (隔週など)      → monthly_nth  (occurrences=[1,3] 等)
//        - どちらにも当てはまらない品目            → monthly_specific (実日付列挙)
//      欠落は年末年始の全休止日のみ (= その地域で全品目が収集されない日) であることを要求する。
//   3. 年末年始休止日を cancelled override で明示する (CSV は休止=データ欠落なので規則展開との差を吸収)。
//   4. rules+overrides を categoriesOn で通年再展開し、CSV の実日付と完全一致することを自己検証
//      (不一致なら書き出さず throw)。verify.mjs も同じ照合 + 分け出し表 PDF との独立照合を行う。
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as yamlParse, stringify as yamlStringify } from 'yaml';
import { categoriesOn, expandFiscalYear, nthOfMonth, isoDate } from '../../_lib/schedule.mjs';
import { DAY_TO_INDEX } from '../../_lib/jp.mjs';
import {
  parseIrumaCsv, BUNBETSU2CATS, CAT_ORDER, splitRegion, fragmentToArea,
} from './parse.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..', '..');
const OUT = join(ROOT, 'municipalities', 'saitama', 'iruma');
const FY = 2026;
const CSV_URL = 'https://opendata.pref.saitama.lg.jp/resource_download/1494';
const CHIKUBETSU_URL = 'https://www.city.iruma.saitama.jp/gomi_search/chikubetsu/index.html';
const WAKEDASHI_URL = 'https://www.city.iruma.saitama.jp/material/files/group/21/R8wakedasihyou.pdf';
const YEAREND_URL = WAKEDASHI_URL; // 年末年始休止(12/29〜1/3)は分け出し表PDFに明記
const EXTRACTED_AT = process.env.EXTRACTED_AT || '2026-07-19'; // Date.now() 不使用 (決定的出力)

const DOW = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
const dow = (iso) => new Date(iso + 'T00:00:00').getDay();

const yomiMap = yamlParse(readFileSync(join(HERE, 'yomi.yaml'), 'utf8'));

// --- CSV 読み込み・地域ごとのカレンダー化 ---
const text = new TextDecoder('shift_jis').decode(readFileSync(join(HERE, 'cache', 'iruma.csv')));
const rows = parseIrumaCsv(text);
console.log(`CSV ${rows.length} 行 (空行除去後)`);

// FY の全日付
const fyDates = [];
for (let d = new Date(FY, 3, 1); d < new Date(FY + 1, 3, 1); d = new Date(d.getTime() + 86400000)) {
  fyDates.push(isoDate(d));
}
const fySet = new Set(fyDates);

// region(出現順) -> { cal: Map<iso,Set<cat>>, byCat: Map<cat,[iso]> }
const regions = new Map();
for (const { region, bunbetsu, iso } of rows) {
  if (!fySet.has(iso)) throw new Error(`FY${FY} 範囲外の日付: ${iso} (region=${region})`);
  if (!regions.has(region)) regions.set(region, { cal: new Map(), byCat: new Map() });
  const R = regions.get(region);
  if (!R.cal.has(iso)) R.cal.set(iso, new Set());
  for (const cat of BUNBETSU2CATS[bunbetsu]) {
    R.cal.get(iso).add(cat);
    if (!R.byCat.has(cat)) R.byCat.set(cat, []);
    R.byCat.get(cat).push(iso);
  }
}
console.log(`${regions.size} 地域 (= コース)`);

// --- 1 地域分の rules/overrides を推定 ---
function buildCourse(region, R) {
  const collectionDays = new Set(R.cal.keys());
  const isStop = (iso) => !collectionDays.has(iso); // その地域で全品目が収集されない日
  const stopDays = new Set();

  // 同日収集グループ (資源4品目) は days/occurrences 配列を共有させて YAML anchor 化する
  const sharedWeekly = new Map();   // key(days) -> 配列
  const sharedNth = new Map();      // key(occ|days) -> {occurrences, days}
  const shareDays = (days) => {
    const k = days.join('');
    if (!sharedWeekly.has(k)) sharedWeekly.set(k, days);
    return sharedWeekly.get(k);
  };
  const shareNth = (occurrences, days) => {
    const k = occurrences.join(',') + '|' + days.join('');
    if (!sharedNth.has(k)) sharedNth.set(k, { occurrences, days });
    return sharedNth.get(k);
  };

  const rules = [];
  for (const cat of CAT_ORDER) {
    if (!R.byCat.has(cat)) continue;
    const dates = [...R.byCat.get(cat)].sort();
    const dset = new Set(dates);

    // 曜日ヒストグラム
    const wcnt = {};
    for (const d of dates) { const w = dow(d); wcnt[w] = (wcnt[w] || 0) + 1; }

    // (a) weekly 候補: 出現 6 回以上の曜日を主要曜日とみなす
    const domWd = Object.entries(wcnt).filter(([, k]) => k >= 6).map(([w]) => Number(w)).sort();
    const expWeekly = fyDates.filter((d) => domWd.includes(dow(d)));
    const extraW = dates.filter((d) => !expWeekly.includes(d));
    const missW = expWeekly.filter((d) => !dset.has(d));
    if (domWd.length && extraW.length === 0 && missW.every(isStop)) {
      missW.forEach((d) => stopDays.add(d));
      rules.push({ category: cat, pattern: 'weekly', days: shareDays(domWd.map((w) => DOW[w])) });
      continue;
    }

    // (b) monthly_nth 候補: 出現曜日と「その月 n 回目」の集合で規則化
    const wds = [...new Set(dates.map((d) => dow(d)))].sort();
    const occ = [...new Set(dates.map((d) => nthOfMonth(new Date(d + 'T00:00:00'))))].sort((a, b) => a - b);
    const expNth = fyDates.filter((d) => wds.includes(dow(d)) &&
      occ.includes(nthOfMonth(new Date(d + 'T00:00:00'))));
    const extraN = dates.filter((d) => !expNth.includes(d));
    const missN = expNth.filter((d) => !dset.has(d));
    if (wds.length && occ.length && extraN.length === 0 && missN.every(isStop)) {
      missN.forEach((d) => stopDays.add(d));
      const nth = shareNth(occ, wds.map((w) => DOW[w]));
      rules.push({ category: cat, pattern: 'monthly_nth', occurrences: nth.occurrences, days: nth.days });
      continue;
    }

    // (c) 規則化できない → 実日付列挙
    rules.push({ category: cat, pattern: 'monthly_specific', dates });
  }

  // 年末年始休止 overrides (cancelled)。stopDays は必ず「全品目収集なし」の日
  const overrides = [...stopDays].sort().map((d) => ({
    date: d, cancelled: true, note: '年末年始休止(市カレンダーどおり。CSV は休止日=データ欠落)',
  }));

  // 自己検証: rules+overrides を categoriesOn で通年再展開し CSV と完全一致するか
  for (const d of fyDates) {
    const got = categoriesOn(new Date(d + 'T00:00:00'), rules, overrides).slice().sort();
    const exp = [...(R.cal.get(d) || new Set())].sort();
    if (got.join(',') !== exp.join(',')) {
      throw new Error(`照合NG [${region}] ${d}: got[${got}] exp[${exp}]`);
    }
  }
  return { rules, overrides, nDays: collectionDays.size };
}

// --- 全コース組み立て ---
mkdirSync(join(OUT, String(FY)), { recursive: true });
let courseNo = 0, totalDays = 0;
const patternTally = { weekly: 0, monthly_nth: 0, monthly_specific: 0 };
for (const [region, R] of regions) {
  courseNo++;
  const { rules, overrides, nDays } = buildCourse(region, R);
  totalDays += nDays;
  for (const r of rules) patternTally[r.pattern]++;
  const areas = splitRegion(region).map((f) => fragmentToArea(f, yomiMap))
    .sort((a, b) => a.yomi.localeCompare(b.yomi, 'ja'));

  const doc = {
    metadata: {
      city: 'iruma',
      course: String(courseNo),
      course_name_ja: region, // 収集地域フリーテキストをそのまま地区名にする (原文保持)
      areas,
      year: FY,
      fiscal_year_ja: '令和8年度',
      source: {
        source_url: CSV_URL,
        pdf_url: WAKEDASHI_URL,
        extracted_at: EXTRACTED_AT,
        extracted_by: 'claude-opus-4-8',
        verified_by: 'Claude(埼玉県ODの日付入り収集カレンダーCSVを機械抽出。categoriesOn再展開で通年自己照合ゼロ差 + 分け出し表PDFと独立照合)',
      },
    },
    rules,
    overrides,
  };
  const header =
    `# 入間市 コース${courseNo} ${FY}年度(令和8年度)\n` +
    `# Auto-generated by tools/csv-extractor/iruma/build.mjs\n` +
    `# Source: ${CSV_URL} (埼玉県オープンデータポータル / 入間市ごみ収集日程 CSV, PDL-1.0)\n` +
    `# 日付入り通年カレンダーから規則を推定し、categoriesOn 再展開で全日照合済み(相違ゼロ)。\n`;
  writeFileSync(join(OUT, String(FY), `course-${courseNo}.yaml`), header + yamlStringify(doc, { lineWidth: 0 }));
  console.log(`コース${courseNo}: areas=${areas.length} rules=${rules.length} overrides=${overrides.length} 収集日=${nDays} 照合OK :: ${region.slice(0, 24)}…`);
}

// --- taxonomy.yaml ---
const taxonomy = {
  categories: [
    'burnable', 'non_burnable', 'plastic', 'paper_cloth',
    'glass_bottle', 'beverage_can', 'pet_bottle', 'hazardous',
  ],
  overrides: {
    burnable: { label: '可燃ごみ' },
    non_burnable: { label: '不燃ごみ' },
    plastic: { label: 'プラスチックごみ', short: 'プラ' },
    paper_cloth: { label: '古布・紙類', short: '古布紙' },
    glass_bottle: { label: 'ビン' },
    beverage_can: { label: '缶' },
    pet_bottle: { label: 'ペットボトル' },
    hazardous: { label: '有害ごみ' },
  },
};
const taxHeader =
  '# 入間市。公式区分(家庭ごみの分け方・出し方):\n' +
  '#   可燃ごみ / 不燃ごみ / プラスチックごみ / 古布・紙類 /\n' +
  '#   ビン・缶・ペットボトル・有害ごみ (この4品目は同日収集)。\n' +
  '# 資源の「ビン・缶・ペットボトル・有害ごみ」は同日収集のため glass_bottle/beverage_can/\n' +
  '# pet_bottle/hazardous の4区分に分解して収録 (収集日は同一)。\n';
writeFileSync(join(OUT, 'taxonomy.yaml'), taxHeader + yamlStringify(taxonomy, { lineWidth: 0 }));

// --- meta.yaml ---
const meta = {
  handle: 'iruma',
  name_ja: '入間市',
  region_ja: '埼玉県',
  code: '11225',
  source: {
    index_url: CHIKUBETSU_URL,
    schedule_url: CSV_URL,
    yearend_url: YEAREND_URL,
  },
  notes: [
    '一次ソース: 埼玉県オープンデータポータルの「入間市ごみ収集日程」CSV (resource 1494 / dataset 274)。日付入りの通年収集カレンダー(縦持ち)で、2026-04-01〜2027-03-31 の全収集日が実日付で明示されている。',
    'ライセンス: 埼玉県ODポータル標準 = 公共データ利用規約(PDL) 1.0 (CC BY 互換・出典明示要)。出典「埼玉県オープンデータポータル(入間市提供)」。',
    'CSV の罠: (1) 文字コードは Shift_JIS。(2) ヘッダの列名順は「…年月日, 収集分別区分」だが実データの並びは「…収集分別区分, 年月日」で最後の2列が入れ替わっている(列名でなく位置で解釈)。(3) 末尾に空行(,,,,,)が多数付く。いずれもソースの状態をそのまま扱い、勝手に修正していない。',
    '市内を12の収集地域(コース)に分割。各地域は「扇台3～6丁目、久保稲荷3～5丁目、…、大字扇町屋1217・1219番地」等のフリーテキストで、町丁目・番地単位に分割して areas に収録した。course_name_ja は収集地域の原文をそのまま保持している(括弧内の番地除外条件も原文どおり)。',
    '収集品目5区分: 可燃ごみ(毎週3日) / プラスチックごみ(毎週) / 不燃ごみ(毎週) / ビン・缶・ペットボトル・有害ごみ(隔週・4品目同日) / 古布・紙類(隔週)。ビン・缶・ペットボトル・有害ごみは同日収集のため4カテゴリに分解(収集日は同一)。語彙追加なし。',
    '規則化: 通年の実日付から weekly / monthly_nth を推定し規則+overridesに畳み込んだ。隔週の資源(ビン缶ペット有害)と古布・紙類は「その月 第n回目の該当曜日」(occurrences=[1,3] または [2,4])として monthly_nth 化でき、全12地域×2品目=24件すべて規則化+自己照合ゼロ差で成立(monthly_specific への退避は発生せず)。',
    '年末年始: CSV は休止日をデータ欠落で表現する。全品目が収集されない日(地域により 12/29〜1/2 の該当日)を cancelled override で明示した。分け出し表PDFにも「12月29日(火)〜1月3日(日)までは収集をお休みします」と明記(地域共通)。祝日・お盆・GWは通常収集(粗大ごみ搬入案内より)。',
    '向原団地(コース4)は郵便町名でないため読みが郵便カナで確定できず、通例読み「むかいはらだんち」を採用した(要確認)。他47のベース町名の読みは日本郵便の郵便番号カナ(zipcloud)由来。',
    'ソース間の表記差(未修正): 下藤沢の番地境界について、一次CSVは「下藤沢173～184、1263～1319番地」、検証PDF(分け出し表)は「下藤沢176-1・1263〜1319番地」と数値が食い違う(コース7の除外条件・コース12の該当番地の両方)。収集日程には影響しないため、いずれのソースも勝手に修正せず原文どおり収録した(course_name_ja/areas は CSV 原文)。',
    '粗大ごみは有料・申込制(市公式LINE/電話予約、総合クリーンセンター)で集積所収集の対象外 → rules 非対象。',
    '検証(2026-07-19): (1) 自己照合 — rules+overrides を categoriesOn で通年(2026-04-01〜2027-03-31)再展開し、全12地域で CSV の実日付と完全一致(相違ゼロ)。(2) 独立照合 — 市「令和8年度 分け出し表」PDF(R8wakedasihyou.pdf、県ODとは別発行の市リーフレット)の地区別収集日程表と全12地域で照合。可燃の毎週曜日・不燃/プラ/資源の曜日・隔週品目の第n回目(実日付)まで一致。',
    '確率的信頼度: 独立誤り単位は「地域×品目パターン」。分け出しPDFとの独立照合は 12地域 × (可燃曜日 + 不燃 + プラ + ビン缶第n + 古布紙第n) = 60 パターンで不一致ゼロ → 95%信頼で片側性誤り率 <5%/パターン(rule of three)。隔週品目はPDFが実日付(第n回目の日番号)まで載せるため曜日レベルでなく日付レベルの独立照合。検出できない残余は両ソース共通原簿の誤りのみ。等級: 独立ソースとの(部分的に日付・大半は曜日+第n)照合。',
  ],
};
writeFileSync(join(OUT, 'meta.yaml'), yamlStringify(meta, { lineWidth: 0 }));

console.log(`\nwrote meta.yaml, taxonomy.yaml, ${courseNo} courses.`);
console.log(`pattern 内訳: weekly=${patternTally.weekly} monthly_nth=${patternTally.monthly_nth} monthly_specific=${patternTally.monthly_specific}`);
console.log(`総収録収集日(12地域計)=${totalDays}`);
