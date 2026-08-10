// 西東京市: 地域別 HTML カレンダー(cache/) → course YAML + meta.yaml + taxonomy.yaml。
//
// 品目ごとに収集日を集計し
//   - 通年その曜日を欠かさない品目 (年末年始の停止のみ例外) → weekly + cancelled override
//   - 隔週 (びん/古紙・缶) と 4 週周期 (水曜の不燃/有害・金属類) → monthly_specific (実日付列挙)
// に自動分類する。分類後 expandRange() で収録期間を再展開し、カレンダー実日付と
// 完全一致することを build 内で自己検証する (不一致なら書き出さない)。
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stringify as yamlStringify } from 'yaml';
import { expandRange, cancelledOverrides } from '../../_lib/schedule.mjs';
import { courseDoc, writeCourses } from '../../_lib/emit.mjs';
import { classifyRules } from '../../_lib/classify.mjs';
import { normJa } from '../../_lib/jp.mjs';
import { parseCalendar, periodDates, DOW, AREA_URL, AREAS } from './parse.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..', '..');
const OUTDIR = join(ROOT, 'municipalities', 'tokyo', 'nishitokyo');
// 一次ソースが裏付ける範囲 = 2025年10月〜2026年9月 (会計年度ではない)
const PERIOD = '2025-10--2026-09';
const LG_CODE = '132292';
const EXTRACTED_AT = process.env.EXTRACTED_AT;
if (!EXTRACTED_AT) throw new Error('EXTRACTED_AT を環境変数で渡す (Date.now は使わない)');

const CAT_ORDER = [
  'burnable', 'non_burnable', 'plastic', 'paper_cloth',
  'glass_bottle', 'spray_can', 'beverage_can', 'pet_bottle', 'hazardous', 'metal',
];
const DOW_INDEX = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };
const dowOf = (iso) => new Date(iso + 'T00:00:00').getDay();

// ---- areas: ページタイトルの町名列挙を ABR 町字マスターで丁目へ展開する ----

const abr = JSON.parse(readFileSync(join(HERE, 'cache', 'abr-town.json'), 'utf8')).towns;
const abrByTown = new Map(); // 町名 → [{chome, id, kana}] (丁目昇順)
for (const t of abr) {
  if (!t.chome_number) throw new Error(`ABR: 丁目の無い町字 "${t.oaza}" (西東京は全町が丁目制の想定)`);
  if (!abrByTown.has(t.oaza)) abrByTown.set(t.oaza, []);
  abrByTown.get(t.oaza).push({ chome: t.chome_number, id: t.id, kana: t.kana });
}
for (const list of abrByTown.values()) list.sort((a, b) => a.chome - b.chome);

// "<title>1　田無町、西原町、芝久保町5丁目（令和7年10月から令和8年9月まで）　西東京市Web</title>"
// → { areaNo: 1, spec: ['田無町', '西原町', '芝久保町5丁目'], titleEra: '令和7年10月から令和8年9月まで' }
export function parseTitle(html) {
  const m = /<title>([^<]*)<\/title>/.exec(html);
  if (!m) throw new Error('title が無い');
  const raw = m[1].replace(/\s*西東京市Web\s*$/, '').trim();
  const t = /^(\d)[\s　]*(.+?)（(.+?)）$/.exec(raw);
  if (!t) throw new Error(`title の形が想定外: "${raw}"`);
  return {
    areaNo: Number(t[1]),
    spec: normJa(t[2]).split('、').filter(Boolean),
    titleEra: t[3],
  };
}

// '芝久保町5丁目' / '谷戸町1・2丁目' / '田無町'(丁目指定なし = 全丁目) → area オブジェクト配列
function expandTown(token) {
  const m = /^(.+?)((?:\d+・)*\d+)丁目$/.exec(token);
  const town = m ? m[1] : token;
  const list = abrByTown.get(town);
  if (!list) throw new Error(`ABR に無い町名 "${town}" (token="${token}")`);
  const chomes = m ? m[2].split('・').map(Number) : list.map((x) => x.chome);
  return chomes.map((c) => {
    const hit = list.find((x) => x.chome === c);
    if (!hit) throw new Error(`ABR に無い丁目 "${town}${c}丁目"`);
    const area = { name: `${town}${c}丁目` };
    if (hit.kana) area.yomi = hit.kana; // 丁目の読みは付けない (ABR の町字読みは基底町名)
    area.machiaza_id = [`${LG_CODE}-${hit.id}`];
    return area;
  });
}

// ---- rules: 日付入りカレンダー → weekly / monthly_specific ----

function buildRules(events, dates) {
  const { rules, stopDays } = classifyRules({ dates, events, catOrder: CAT_ORDER });

  // 全停止日のうち weekly 規則が発火する日だけ cancelled にする
  const overrides = cancelledOverrides(rules, [...stopDays].sort(),
    '収集なし(市カレンダーどおり)').map((o) => ({
      ...o,
      note: /^(2025-12|2026-01-0[123])/.test(o.date) ? '年末年始 収集なし(市カレンダーどおり)' : o.note,
    }));

  // 自己検証: rules + overrides を再展開してカレンダーと全日一致するか
  const actual = expandRange(PERIOD, rules, overrides, []);
  for (const d of dates) {
    const got = [...(actual.get(d) || [])].sort().join(',');
    const exp = [...events.get(d)].sort().join(',');
    if (got !== exp) throw new Error(`照合NG ${d}: got[${got}] exp[${exp}]`);
  }
  for (const d of actual.keys()) if (!events.has(d)) throw new Error(`期間外の展開日 ${d}`);

  return { rules, overrides, stopCount: stopDays.length };
}

// ---- 実行 ----

const dates = periodDates(PERIOD);
const docs = [];
const usedAreas = new Map(); // name → 地域番号 (全域の重複・欠落チェック用)
const titleNotes = [];

for (const n of AREAS) {
  const html = readFileSync(join(HERE, 'cache', `${n}.html`), 'utf8');
  const { areaNo, spec, titleEra } = parseTitle(html);
  if (areaNo !== n) throw new Error(`${n}.html の title 地域番号が ${areaNo}`);
  if (titleEra !== '令和7年10月から令和8年9月まで') titleNotes.push(`地域${n}: title「${titleEra}」`);

  const events = parseCalendar(html);
  if (events.size !== dates.length) throw new Error(`地域${n}: 収録日数 ${events.size} != ${dates.length}`);
  for (const d of dates) if (!events.has(d)) throw new Error(`地域${n}: ${d} が欠落`);

  const areas = spec.flatMap(expandTown);
  for (const a of areas) {
    if (usedAreas.has(a.name)) throw new Error(`町字 "${a.name}" が地域${usedAreas.get(a.name)}と地域${n}に重複`);
    usedAreas.set(a.name, n);
  }

  const { rules, overrides, stopCount } = buildRules(events, dates);
  docs.push(courseDoc({
    city: 'nishitokyo', course: String(n), courseNameJa: `地域${n}`,
    areas, period: PERIOD,
    source: {
      edition_ja: '令和7年10月〜令和8年9月版',
      source_url: AREA_URL(n),
      extracted_at: EXTRACTED_AT,
      extracted_by: 'claude-opus-5',
      verified_by: 'Claude(西東京市「ごみ・資源物収集カレンダー(テキスト版)」地域別HTMLの機械抽出。日付入り通年カレンダーと expandRange 再展開で全365日照合し完全一致)',
    },
    rules, overrides,
  }));
  console.log(`地域${n}: areas=${areas.length} rules=${rules.length} overrides=${overrides.length} 停止日=${stopCount} 照合OK`);
}

// 全 8 地域で市内 114 町字を過不足なく覆うか
const allAbr = [...abrByTown.entries()].flatMap(([t, l]) => l.map((x) => `${t}${x.chome}丁目`));
const missing = allAbr.filter((n) => !usedAreas.has(n));
if (missing.length) throw new Error(`地域割当に漏れた町字: ${missing.join(', ')}`);
if (usedAreas.size !== allAbr.length) throw new Error(`町字数不一致 ${usedAreas.size} != ${allAbr.length}`);

mkdirSync(OUTDIR, { recursive: true });
console.log(`generated ${writeCourses(OUTDIR, PERIOD, docs)} courses (町字 ${usedAreas.size} 件を過不足なく分割)`);
if (titleNotes.length) console.log('title の元号表記ゆれ:', titleNotes.join(' / '));

// ---- taxonomy.yaml ----
const taxonomy = {
  categories: CAT_ORDER,
  overrides: {
    plastic: { label: 'プラスチック容器包装類', short: '容プラ' },
    paper_cloth: { label: '古紙・古布類（衣類等）', short: '古紙布' },
    beverage_can: { label: '缶' },
    hazardous: { label: '有害ごみ・危険物', short: '有害' },
    metal: { label: '金属類・小型家電', short: '金属' },
  },
  groups: [
    { label: 'びん・スプレー缶・ライター', short: 'びん類', members: ['glass_bottle', 'spray_can'],
      note: 'カレンダー上は 1 品目 1 セル。ライターはスプレー缶に含めて収録した (語彙なし)' },
  ],
};
writeFileSync(join(OUTDIR, 'taxonomy.yaml'),
  '# 西東京市。公式区分(ごみ・資源物収集カレンダー):\n' +
  '#   可燃ごみ / せん定枝・落ち葉・草・おむつ / 不燃ごみ / 有害ごみ・危険物 /\n' +
  '#   プラスチック容器包装類 / ペットボトル / びん・スプレー缶・ライター /\n' +
  '#   古紙・古布類（衣類等） / 缶 / 金属類 / 小型家電 / 廃食用油\n' +
  '# せん定枝・落ち葉・草・おむつは可燃ごみと常に同日のため burnable に含めた。\n' +
  '# 小型家電は金属類と常に同一セル・同日のため metal に含めた (所沢・東秩父の先例)。\n' +
  '# 廃食用油は正典語彙に無く、金属類と常に同日のため収録していない (鯖江の先例。日程情報の欠落なし)。\n' +
  yamlStringify(taxonomy, { lineWidth: 0 }));

// ---- meta.yaml ----
const meta = {
  handle: 'nishitokyo',
  name_ja: '西東京市',
  region_ja: '東京都',
  code: '13229',
  source: {
    index_url: 'https://www.city.nishitokyo.lg.jp/kurasi/gomi_recycle/gomi-calebder/index.html',
    schedule_url: 'https://www.city.nishitokyo.lg.jp/kurasi/gomi_recycle/gomi-calebder/gomicalender_exel/index.html',
    yearend_url: 'https://www.city.nishitokyo.lg.jp/kurasi/gomi_recycle/gomi-calebder/gomicalender_exel/index.html',
  },
  notes: [
    '一次ソース: 市公式「ごみ・資源物収集カレンダー(テキスト版)」の地域別HTMLページ(地域1〜8 = 111.html〜888.html)。日付入りの通年カレンダーで、祝日・お盆・年末年始も含め全日の収集有無が明示されている。',
    '収録期間は 2025年10月〜2026年9月。西東京市のカレンダーは会計年度ではなく10月起点の1年で、これが一次ソースの裏付ける範囲そのもの。次版(令和8年10月〜令和9年9月・例年9月中旬公開)が出たら 2026-10--2027-09/ として別途収録する。週次ルールで期間外へ延長はしない。',
    'ライセンス: カレンダー掲載ページは通常ページでライセンス明示なし。市のオープンデータに収集日程データセットは無く、収集日という事実データを抽出して収録している(練馬・杉並・調布と同じ整理)。',
    '市内を8地域に分割。22町114丁目(デジタル庁ABR町字マスター東京都版 lg_code 132292 の全町字)が丁目単位で重複・欠落なく各地域へ割り当てられる(build 内で機械確認)。地域割はカレンダーページの title 記載を一次とした。',
    '地域8のページ title のみ元号が「令和6年10月から令和7年9月まで」と誤記だが、本文の月見出しは他地域と同じ2025年10月〜2026年9月。ソースは修正せず事実として記録する(収録内容は本文の月見出しに従う)。',
    '同日収集グループ(全地域共通): 可燃ごみ+せん定枝・落ち葉・草・おむつ / ペットボトル+プラスチック容器包装類 / 不燃ごみ+有害ごみ・危険物 / びん・スプレー缶・ライター+古紙・古布類（衣類等） / 金属類+小型家電+廃食用油。',
    '語彙対応: せん定枝・落ち葉・草・おむつは可燃ごみと常に同日のため burnable に含めた。小型家電は金属類と常に同日・同一セルのため metal(所沢・東秩父の先例)。廃食用油は正典語彙に無く金属類と常に同日のため未収録(鯖江の先例)。ライターは「びん・スプレー缶・ライター」1品目のためスプレー缶(spray_can)に同梱。いずれも他品目と同日のため日程情報の欠落はゼロで、原文は taxonomy.yaml のコメントと groups に残している。',
    '収集頻度: 可燃ごみ 週2回 / ペットボトル・プラスチック容器包装類 週1回(同日) / びん・スプレー缶・ライター+古紙・古布類 と 缶 は同じ曜日で隔週交替 / 水曜は「不燃ごみ・有害ごみ → 金属類 → 不燃ごみ・有害ごみ → 収集なし」の4週周期。隔週・4週周期は weekly/monthly_nth では表せないため monthly_specific(実日付列挙)で収録した。',
    '祝日も通常どおり収集する(建国記念日・こどもの日等に収集がある)。休みは土日と年末年始(2025-12-29〜2026-01-02のうち地域ごとに指定された日)、および水曜4週周期の「収集なし」の日。',
    '検証(2026-08-10): 8地域それぞれについて、日付入りカレンダーHTMLを機械抽出し rules+overrides を expandRange で収録期間(2025-10-01〜2026-09-30, 365日 × 8地域 = 2920日枠)再展開して全日照合、相違ゼロ。曜日ヘッダと実曜日の一致・各月の日数・地域間の町字重複と欠落も build 内で検査している。',
    '独立照合(2026-08-10): 冊子版カレンダーPDF(999.html の -N-070911.pdf)は Illustrator でアウトライン化されテキスト層が無く(pdffonts が空)機械抽出できないため、playbook §3 に従い層化サンプリングで照合した。地域1の2025年10月・2025年12月(年末)、地域3の2026年1月(年始)、地域8の2025年10月の計4ヶ月91日枠を画像から読み取り、生成データと突き合わせて相違ゼロ(tools/html-extractor/nishitokyo/verify.mjs に転記を保持)。地域8のPDFも2025年10月始まりで、HTMLページ title の元号誤記が title だけの誤りであることを裏づけた。',
    '確率的信頼度: HTML再展開は同一ソースからの一致(自己照合)であり保証されるのはパースの忠実性。独立な誤り単位で見ると、規則単位の系統誤りは 8地域×10種別=80 パターン ゼロ不一致 → 95%信頼で <3.8%/パターン、monthly_specific の実日付転記誤りは 2920 日枠 ゼロ不一致 → <0.11%/日枠 (rule of three)。一次ソースと独立な冊子版PDFとの照合は 91 日枠 ゼロ不一致 → <3.3%/日枠。地域割当は ABR 町字マスターと独立照合済み(114町字を過不足なく分割)。等級: 高(日付レベル・独立ソースあり)。残余リスクは、テキスト版HTMLと冊子版PDFが同一の版下から作られている場合に共通の誤りが相殺されない点。',
  ],
};
writeFileSync(join(OUTDIR, 'meta.yaml'), yamlStringify(meta, { lineWidth: 0 }));
console.log('wrote meta.yaml, taxonomy.yaml');
