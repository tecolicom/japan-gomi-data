// 青梅市: extract.py の cache/extracted.json → course YAML + meta.yaml + taxonomy.yaml。
//
// 抽出は品目の原文表記 (燃やすごみ / カン / ガラス …) で持ち、ここで正典 category へ写す。
// 週2回の燃やすごみと週1回のペットボトル・有害ごみは weekly + 年末年始の cancelled、
// 月1〜3回の資源物は monthly_specific (実日付列挙)。年末年始の休止でひと月ぶん周期がずれる
// 日程があるため monthly_nth では表せない。
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stringify as yamlStringify } from 'yaml';
import { expandRange, cancelledOverrides } from '../../_lib/schedule.mjs';
import { courseDoc, writeCourses } from '../../_lib/emit.mjs';
import { normJa } from '../../_lib/jp.mjs';
import { BASE, SCHEDULES } from './sources.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..', '..');
const OUTDIR = join(ROOT, 'municipalities', 'tokyo', 'ome');
const PERIOD = '2026-04--2027-03'; // 令和8年度版が裏付ける範囲
const LG_CODE = '132055';
const EXTRACTED_AT = process.env.EXTRACTED_AT;
if (!EXTRACTED_AT) throw new Error('EXTRACTED_AT を環境変数で渡す (Date.now は使わない)');

// 品目の原文表記 → 正典 category (0 個以上)。
// ガラス (びん以外のガラス製品) と陶磁器は正典語彙に無い。いずれもカン・ビンと
// 常に同日収集なので収録しない (鯖江の廃食用油・西東京の同型。日程情報の欠落はゼロ)。
// 新聞・折込チラシ / 雑誌・雑紙 / ダンボール・飲料用紙パックはいずれも古紙で、
// 収集日が月内で分かれるだけなので paper に統合し、内訳は rule の note に残す。
const ITEM2CAT = {
  '燃やすごみ': ['burnable'],
  '燃やさないごみ': ['non_burnable'],
  '容器包装プラスチックごみ': ['plastic'],
  '新聞・折込チラシ': ['paper'],
  '雑誌・雑紙': ['paper'],
  'ダンボール・飲料用紙パック': ['paper'],
  '繊維類': ['cloth'],
  'ビン': ['glass_bottle'],
  'カン': ['beverage_can'],
  'ペットボトル': ['pet_bottle'],
  '有害ごみ': ['hazardous'],
  'ガラス': [], // カンと常に同日 (正典語彙なし)
  '陶磁器': [], // ビンと常に同日 (正典語彙なし)
};
const CAT_ORDER = [
  'burnable', 'non_burnable', 'plastic', 'paper', 'cloth',
  'glass_bottle', 'beverage_can', 'pet_bottle', 'hazardous',
];
const CAT_NOTE = {
  paper: '古紙。同一曜日で月内 3 回に分かれる (1 回目=新聞・折込チラシ / 2 回目=雑誌・雑紙 / 3 回目=ダンボール・飲料用紙パック)',
  cloth: '繊維類 (古着・かばん・靴等)。月1回',
  beverage_can: 'カン。同じ日に「ガラス」(びん以外のガラス製品) も収集される',
  glass_bottle: 'ビン。同じ日に「陶磁器」も収集される',
};
const DOW = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
const dowOf = (iso) => new Date(iso + 'T00:00:00').getDay();
// weekly と認めるのに許す「停止で欠けた回数」の上限 (割合)。隔週・月1 のリズムを
// 「毎週 + 大半をキャンセル」と表現してしまわないための歯止め (武蔵野と同じ)。
const WEEKLY_STOP_TOLERANCE = 0.1;

const data = JSON.parse(readFileSync(join(HERE, 'cache', 'extracted.json'), 'utf8'));

// ---- areas: index ページの「町名 → X日程」表を ABR 町字マスターで展開 ----

const indexHtml = readFileSync(join(HERE, 'cache', 'index.html'), 'utf8');
const abr = JSON.parse(readFileSync(join(HERE, 'cache', 'abr-town.json'), 'utf8')).towns;
const abrByTown = new Map();
for (const t of abr) {
  if (!abrByTown.has(t.oaza)) abrByTown.set(t.oaza, []);
  abrByTown.get(t.oaza).push({ chome: t.chome_number, id: t.id, kana: t.kana });
}
for (const list of abrByTown.values()) list.sort((a, b) => (a.chome || 0) - (b.chome || 0));

// index ページの表: <td>町名</td><td><a href="…/NNNNN.pdf">…カレンダーＸ日程…</a></td>
function townSchedules() {
  const out = new Map(); // 日程 → [町名]
  const re = /<td[^>]*>([^<]*?)<\/td>\s*<td[^>]*>\s*<a href="\/uploaded\/attachment\/\d+\.pdf"[^>]*>([^<]*?)<\/a>/g;
  for (const m of indexHtml.matchAll(re)) {
    const town = normJa(m[1]);
    const s = /カレンダー([ＡＢＣＤＥＦＧＨ])日程/.exec(m[2]);
    if (!town || !s) continue;
    const d = 'ABCDEFGH'['ＡＢＣＤＥＦＧＨ'.indexOf(s[1])];
    if (!out.has(d)) out.set(d, []);
    out.get(d).push(town);
  }
  if (out.size !== Object.keys(SCHEDULES).length)
    throw new Error(`index から取れた日程が ${out.size} 個`);
  return out;
}

// 町名 → area 配列 (丁目がある町は 1 丁目 = 1 area。大字のみの行も別 area として残す)
function expandTown(town) {
  const list = abrByTown.get(town);
  if (!list) throw new Error(`ABR に無い町名 "${town}"`);
  return list.map((x) => {
    const area = { name: x.chome ? `${town}${x.chome}丁目` : town };
    if (x.kana) area.yomi = x.kana; // ABR の町字読みは基底町名 (丁目の読みは付けない)
    area.machiaza_id = [`${LG_CODE}-${x.id}`];
    return area;
  });
}

// ---- rules ----

function buildRules(events, dates, label) {
  const stop = new Set(dates.filter((d) => events[d].length === 0));
  const catDates = new Map();
  for (const d of dates) {
    const cats = [];
    for (const item of events[d]) {
      const mapped = ITEM2CAT[item];
      if (!mapped) throw new Error(`${label}: 未知の品目 "${item}" (${d})`);
      for (const c of mapped) if (!cats.includes(c)) cats.push(c);
    }
    for (const c of cats) {
      if (!catDates.has(c)) catDates.set(c, []);
      catDates.get(c).push(d);
    }
  }

  const rules = [];
  for (const c of CAT_ORDER) {
    if (!catDates.has(c)) continue;
    const ds = catDates.get(c), dset = new Set(ds);
    const wcnt = {};
    for (const d of ds) wcnt[dowOf(d)] = (wcnt[dowOf(d)] || 0) + 1;
    const domWd = Object.entries(wcnt).filter(([, k]) => k >= 6).map(([w]) => Number(w)).sort();
    const weeklyExp = dates.filter((d) => domWd.includes(dowOf(d)));
    const minusStop = weeklyExp.filter((d) => !stop.has(d));
    const eqExact = ds.length === weeklyExp.length && weeklyExp.every((d) => dset.has(d));
    const eqMinusStop = ds.length === minusStop.length && minusStop.every((d) => dset.has(d))
      && weeklyExp.length - minusStop.length <= weeklyExp.length * WEEKLY_STOP_TOLERANCE;

    const rule = (domWd.length && (eqExact || eqMinusStop))
      ? { category: c, pattern: 'weekly', days: domWd.map((w) => DOW[w]) }
      : { category: c, pattern: 'monthly_specific', dates: [...ds] };
    if (CAT_NOTE[c]) rule.note = CAT_NOTE[c];
    rules.push(rule);
  }

  const overrides = cancelledOverrides(rules, [...stop].sort(), '年末年始 収集なし(市カレンダーどおり)');

  // 自己検証: rules + overrides を再展開して PDF 由来の実日付と全日一致するか
  const actual = expandRange(PERIOD, rules, overrides, []);
  for (const d of dates) {
    const exp = [...new Set(events[d].flatMap((i) => ITEM2CAT[i]))].sort().join(',');
    const got = [...(actual.get(d) || [])].sort().join(',');
    if (got !== exp) throw new Error(`${label} 照合NG ${d}: got[${got}] exp[${exp}]`);
  }
  for (const d of actual.keys()) if (!(d in events)) throw new Error(`${label}: 期間外の展開日 ${d}`);

  return { rules, overrides };
}

// ---- 実行 ----

const specs = townSchedules();
const docs = [];
const usedAreas = new Map();

for (const d of Object.keys(SCHEDULES)) {
  const events = data[d].events;
  const dates = Object.keys(events).sort();
  if (dates.length !== 365 || dates[0] !== '2026-04-01' || dates.at(-1) !== '2027-03-31')
    throw new Error(`${d}日程: 収録範囲が ${dates[0]}..${dates.at(-1)} (${dates.length}日)`);

  const towns = specs.get(d);
  const areas = towns.flatMap(expandTown);
  for (const a of areas) {
    if (usedAreas.has(a.name)) throw new Error(`町字 "${a.name}" が ${usedAreas.get(a.name)}日程と${d}日程に重複`);
    usedAreas.set(a.name, d);
  }

  const { rules, overrides } = buildRules(events, dates, `${d}日程`);
  docs.push(courseDoc({
    city: 'ome', course: d, courseNameJa: `${d}日程`,
    areas, period: PERIOD,
    source: {
      edition_ja: '令和8年度版',
      source_url: `${BASE}/${SCHEDULES[d]}.pdf`,
      extracted_at: EXTRACTED_AT,
      extracted_by: 'claude-opus-5',
      verified_by: 'Claude(青梅市「令和8年度版 資源物・ごみ収集カレンダー」日程別PDFの色ベース抽出。品目名はアウトライン図版でテキスト層に無いため塗り色で判定し、expandRange 再展開で全365日を自己照合。冊子本文の収集頻度規則および PDF ページ画像の目視転記と独立照合)',
    },
    rules, overrides,
  }));
  console.log(`${d}日程: 町 ${towns.length} → areas ${areas.length} / rules ${rules.length} / overrides ${overrides.length} 照合OK`);
}

const allAbr = [...abrByTown.entries()].flatMap(([t, l]) => l.map((x) => (x.chome ? `${t}${x.chome}丁目` : t)));
const missing = allAbr.filter((n) => !usedAreas.has(n));
if (missing.length) throw new Error(`日程割当に漏れた町字: ${missing.join(', ')}`);
if (usedAreas.size !== allAbr.length) throw new Error(`町字数不一致 ${usedAreas.size} != ${allAbr.length}`);

mkdirSync(OUTDIR, { recursive: true });
console.log(`generated ${writeCourses(OUTDIR, PERIOD, docs)} courses (町字 ${usedAreas.size} 件を過不足なく分割)`);

// ---- taxonomy.yaml ----
const taxonomy = {
  categories: CAT_ORDER,
  overrides: {
    burnable: { label: '燃やすごみ', short: '燃やす' },
    non_burnable: { label: '燃やさないごみ', short: '燃やさない' },
    plastic: { label: '容器包装プラスチックごみ', short: '容プラ' },
    paper: { label: '古紙(新聞・雑誌雑紙・ダンボール)', short: '古紙' },
    cloth: { label: '繊維類' },
    glass_bottle: { label: 'ビン' },
    beverage_can: { label: 'カン' },
    hazardous: { label: '有害ごみ', short: '有害' },
  },
};
writeFileSync(join(OUTDIR, 'taxonomy.yaml'),
  '# 青梅市。公式区分(資源物・ごみ収集カレンダー): 燃やすごみ / 燃やさないごみ /\n' +
  '#   容器包装プラスチックごみ / 新聞・折込チラシ / 雑誌・雑紙 / ダンボール・飲料用紙パック /\n' +
  '#   繊維類 / カン / ビン / ガラス / 陶磁器 / ペットボトル / 有害ごみ\n' +
  '# 新聞・折込チラシ / 雑誌・雑紙 / ダンボール・飲料用紙パックはいずれも古紙で、同一曜日の\n' +
  '# 月内 1・2・3 回目に分かれるだけなので paper に統合した (内訳は course の rule note)。\n' +
  '# 「ガラス」(びん以外のガラス製品) と「陶磁器」は正典語彙に無い。ガラスはカンと、陶磁器は\n' +
  '# ビンと常に同日収集のため収録していない (日程情報の欠落はゼロ。鯖江・西東京と同じ整理)。\n' +
  yamlStringify(taxonomy, { lineWidth: 0 }));

// ---- meta.yaml ----
const meta = {
  handle: 'ome',
  name_ja: '青梅市',
  region_ja: '東京都',
  code: '13205',
  source: {
    index_url: 'https://www.city.ome.tokyo.jp/soshiki/23/1182.html',
    schedule_url: 'https://www.city.ome.tokyo.jp/soshiki/23/1182.html',
    yearend_url: 'https://www.city.ome.tokyo.jp/soshiki/23/1182.html',
  },
  notes: [
    '一次ソース: 市公式「令和8年度版 資源物・ごみ収集カレンダー」(2026年4月〜2027年3月) の日程別PDF(A〜H日程、全28ページの冊子)。20〜25ページが日付入りの通年カレンダー(1ページに2ヶ月ブロック)。',
    '市サイトは同じ内容のPDFを町名ごとに別の attachment ID で貼っている(A日程だけで13 ID)。日程ごとに1本を代表として取得し、別IDのPDFが byte 単位で同一であることを sha256 で確認済み(A・B・C・D・F・G の6日程で抜き取り)。',
    'ライセンス: 市サイトはライセンス明示なし。市のオープンデータに収集日程データセットは無く、収集日という事実データを抽出して収録している(練馬・杉並・調布と同じ整理)。',
    '市内を8日程(A〜H)に分割。44町149町字(デジタル庁ABR町字マスター東京都版 lg_code 132055 の全町字)が重複・欠落なく各日程へ割り当てられる(build 内で機械確認)。日程割は index ページの町名×日程の表を一次とした。',
    '抽出方式: このPDFは罫線が本物のベクタ線なのでグリッドは座標で復元できるが、品目名はすべてアウトライン化された図版でテキスト層に無い(テキストで取れるのは日番号・曜日ヘッダ・西暦だけ)。そこで秩父広域と同じ色ベース抽出を用いた — 袋アイコン(燃やすごみ=緑/容器包装プラスチック=紫/燃やさないごみ=橙)と資源物の角丸ラベル9品目は塗り色が品目ごとに固有で、色と寸法の組だけで判定できる。文字も日付も読まない。',
    '2026-07-18 のサーベイは「カレンダーは画像グリッドで pdftotext では取得不可、difficulty 4」と記録していたが、実際には座標と塗り色で機械抽出できた。survey.yaml を difficulty 2・granularity dates へ訂正した。',
    '収集頻度(冊子本文の明記どおり): 燃やすごみ 週2回 / ペットボトル 週1回 / 有害ごみ 週1回(ペットボトルと同日) / 容器包装プラスチックごみ 月3〜4回(資源日のうち燃やさないごみの回を除く) / 燃やさないごみ 月1回(3回目) / 新聞・折込チラシ 月1回(1回目) / 雑誌・雑紙 月1回(2回目) / ダンボール・飲料用紙パック 月1回(3回目) / 繊維類 月1回(4回目) / カンとガラス 月2〜3回(1・3・5回目) / ビンと陶磁器 月2回(2・4回目)。',
    '語彙対応: 「ガラス」(びん以外のガラス製品。コップ・板ガラス等)はカンと、「陶磁器」はビンと常に同日収集で、正典 categories.yaml に該当語彙が無いため収録していない(鯖江の廃食用油・西東京の同型。日程情報の欠落はゼロ)。新聞・折込チラシ / 雑誌・雑紙 / ダンボール・飲料用紙パックはいずれも古紙で、同一曜日の月内1・2・3回目に分かれるだけなので paper に統合し、内訳は course の rule note に残した。',
    '年末年始は12月29日ごろ〜1月3日ごろが休止(日程ごとに実日付が異なる)。カレンダーに実日付で明示されており overrides の cancelled に反映済み。祝日は通常どおり収集する(4/29・5/5 等に収集がある)。',
    'H日程(御岳山)は山間で頻度が低く、燃やすごみも週1回(金曜)。2027年1月4日(月)にのみ例外的な燃やすごみ収集があり、年末年始明けの振替とみられる(カレンダー実日付どおり収録)。',
    'すべての資源物は monthly_specific(実日付列挙)で収録した。規則自体は「月内のn回目のその曜日」だが、年末年始の休止でひと月ぶん周期がずれる日程があり(E・F・H日程の2027年1月など)、monthly_nth では表せないため。',
    '検証(2026-08-10): 8日程それぞれについて、カレンダーPDFから読んだ実日付と rules+overrides の expandRange 再展開を収録期間(2026-04-01〜2027-03-31, 365日 × 8日程 = 2920日枠)で全日照合、相違ゼロ。各月について日番号がグリッド位置(行×列)から計算した日付と一致し、1〜月末日まで欠落・重複なく現れることも extract.py が検査している。',
    '独立照合(2026-08-10): (1)冊子本文(7・10〜14ページ)に文章で書かれた収集頻度規則(「収集は月1回(第3週目)です」等)を機械パースして抽出結果と突き合わせ、8日程×13枠=104枠が全一致。ガラス=カン・陶磁器=ビンの同日性、ペットボトル=有害ごみの同日性、容器包装プラスチック+燃やさないごみ=資源日全体も機械確認した。年末年始の休止で周期がずれる 日程×月 30件は第n回目の判定から除外している(除外先は verify.mjs が一覧出力する)。(2)PDFページ画像を人が読んだ結果と照合(A・B日程の2026年4月・5月、86日枠)。いずれも tools/pdf-extractor/ome/verify.mjs に保持。',
    '確率的信頼度: PDF再展開は同一ソースからの一致(自己照合)であり保証されるのはパースの忠実性。独立な誤り単位で見ると、規則単位の系統誤りは 8日程×9種別=72 パターン ゼロ不一致 → 95%信頼で <4.2%/パターン、monthly_specific の実日付転記誤りは 2920 日枠 ゼロ不一致 → <0.10%/日枠 (rule of three)。冊子本文の頻度規則との照合は 104 枠 ゼロ不一致 → <2.9%/枠、PDF画像の目視転記との照合は 86 日枠 ゼロ不一致 → <3.5%/日枠。日程割当は ABR 町字マスターと独立照合済み(149町字を過不足なく分割)。等級: 高(日付レベル・同一冊子内に独立な文章表現あり)。残余リスクは、色ベース抽出のため市が次年度に配色を変えると静かに壊れる点(未知色は無視されるので extract.py の品目別件数が急減する形で現れる。次年度の収録時は品目別件数を必ず確認すること)。',
  ],
};
writeFileSync(join(OUTDIR, 'meta.yaml'), yamlStringify(meta, { lineWidth: 0 }));
console.log('wrote meta.yaml, taxonomy.yaml');
