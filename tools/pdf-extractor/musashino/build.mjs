// 武蔵野市: extract.py の cache/extracted.json → course YAML + meta.yaml + taxonomy.yaml。
//
// 品目ごとに収集日を集計し
//   - 通年その曜日を欠かさない品目 (年末年始の停止のみ例外) → weekly + cancelled override
//   - 隔週の品目 (燃やさないごみ / びん・缶・危険有害ごみ)   → monthly_specific (実日付列挙)
//   - 年度途中で頻度が変わる品目 (ペットボトルは7月から毎週) → monthly_specific
// に自動分類する。分類後 expandRange() で収録期間を再展開し、PDF から読んだ実日付と
// 完全一致することを build 内で自己検証する (不一致なら書き出さない)。
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stringify as yamlStringify } from 'yaml';
import { expandRange, cancelledOverrides } from '../../_lib/schedule.mjs';
import { courseDoc, writeCourses } from '../../_lib/emit.mjs';
import { classifyRules } from '../../_lib/classify.mjs';
import { normJa } from '../../_lib/jp.mjs';
import { BASE, CAL_PDF, DISTRICTS } from './sources.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..', '..');
const OUTDIR = join(ROOT, 'municipalities', 'tokyo', 'musashino');
// 一次ソースが裏付ける範囲。武蔵野の令和8年度版はちょうど 2026年4月〜2027年3月
const PERIOD = '2026-04--2027-03';
const LG_CODE = '132039';
const EXTRACTED_AT = process.env.EXTRACTED_AT;
if (!EXTRACTED_AT) throw new Error('EXTRACTED_AT を環境変数で渡す (Date.now は使わない)');

const CAT_ORDER = [
  'burnable', 'non_burnable', 'plastic', 'paper_cloth',
  'glass_bottle', 'beverage_can', 'pet_bottle', 'hazardous',
];
const DOW = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
const dowOf = (iso) => new Date(iso + 'T00:00:00').getDay();
// weekly と認めるのに許す「停止で欠けた回数」の上限 (割合)。
// 年末年始のような例外的休止は cancelled override で表せるが、隔週リズム
// (欠け 50%) を「毎週 + 半分キャンセル」と表現してしまわないための歯止め。
const WEEKLY_STOP_TOLERANCE = 0.1;

const data = JSON.parse(readFileSync(join(HERE, 'cache', 'extracted.json'), 'utf8'));

// ---- areas: index ページの「A地区 吉祥寺南町」を ABR 町字マスターで丁目へ展開 ----

const indexHtml = readFileSync(join(HERE, 'cache', 'index.html'), 'utf8');
const abr = JSON.parse(readFileSync(join(HERE, 'cache', 'abr-town.json'), 'utf8')).towns;
const abrByTown = new Map();
for (const t of abr) {
  if (!t.chome_number) throw new Error(`ABR: 丁目の無い町字 "${t.oaza}" (武蔵野は全町が丁目制の想定)`);
  if (!abrByTown.has(t.oaza)) abrByTown.set(t.oaza, []);
  abrByTown.get(t.oaza).push({ chome: t.chome_number, id: t.id, kana: t.kana });
}
for (const list of abrByTown.values()) list.sort((a, b) => a.chome - b.chome);

// index ページ本文の「<大文字>地区 町名、町名…」から地区→町名列挙を取る
function districtSpecs() {
  const out = new Map();
  for (const m of indexHtml.matchAll(/([A-J])地区[ 　]+([^<\n]+)/g)) {
    const key = m[1].toLowerCase();
    const spec = normJa(m[2]).split('、').filter(Boolean);
    const prev = out.get(key);
    if (prev && prev.join('|') !== spec.join('|'))
      throw new Error(`地区${m[1]} の町名列挙が index 内で食い違う: [${prev}] vs [${spec}]`);
    out.set(key, spec);
  }
  if (out.size !== DISTRICTS.length) throw new Error(`index から取れた地区が ${out.size} 個`);
  return out;
}

// '吉祥寺本町2・3・4丁目' / '御殿山'(丁目指定なし = 全丁目) → area オブジェクト配列
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

// ---- rules ----

function buildRules(events, dates, label) {
  const { rules, stopDays } = classifyRules({ dates, events, catOrder: CAT_ORDER });
  const stop = stopDays;

  const overrides = cancelledOverrides(rules, [...stop].sort(), '年末年始 収集なし(市カレンダーどおり)');

  // 自己検証: rules + overrides を再展開して PDF 由来の実日付と全日一致するか
  const actual = expandRange(PERIOD, rules, overrides, []);
  for (const d of dates) {
    const got = [...(actual.get(d) || [])].sort().join(',');
    const exp = [...events[d]].sort().join(',');
    if (got !== exp) throw new Error(`${label} 照合NG ${d}: got[${got}] exp[${exp}]`);
  }
  for (const d of actual.keys()) if (!(d in events)) throw new Error(`${label}: 期間外の展開日 ${d}`);

  return { rules, overrides };
}

// ---- 実行 ----

const specs = districtSpecs();
const docs = [];
const usedAreas = new Map();

for (const d of DISTRICTS) {
  const { events, yearend_special: yearendSpecial } = data[d];
  const dates = Object.keys(events).sort();
  if (dates.length !== 365 || dates[0] !== '2026-04-01' || dates.at(-1) !== '2027-03-31')
    throw new Error(`地区${d}: 収録範囲が ${dates[0]}..${dates.at(-1)} (${dates.length}日)`);

  const areas = specs.get(d).flatMap(expandTown);
  for (const a of areas) {
    if (usedAreas.has(a.name)) throw new Error(`町字 "${a.name}" が地区${usedAreas.get(a.name)}と地区${d}に重複`);
    usedAreas.set(a.name, d);
  }

  const { rules, overrides } = buildRules(events, dates, `地区${d.toUpperCase()}`);
  // カレンダーの「(年末特別収集)」の添え書きは、その日に実際に収集される品目の rule に付ける。
  // overrides に書くと category 無しの override が weekly 以外を落としてしまうため使わない。
  for (const iso of yearendSpecial) {
    for (const r of rules) {
      if (!events[iso].includes(r.category)) continue;
      r.note = [r.note, `${iso} は年末特別収集(カレンダーの添え書き)`].filter(Boolean).join(' / ');
    }
  }

  docs.push(courseDoc({
    city: 'musashino', course: d.toUpperCase(), courseNameJa: `${d.toUpperCase()}地区`,
    areas, period: PERIOD,
    source: {
      edition_ja: '令和8年度(2026年度)版',
      source_url: `${BASE}/${CAL_PDF(d)}`,
      extracted_at: EXTRACTED_AT,
      extracted_by: 'claude-opus-5',
      verified_by: 'Claude(武蔵野市「ごみと資源の収集カレンダー」地区別PDFの罫線グリッド座標抽出。expandRange 再展開で全365日を自己照合し完全一致、市サイトの地区別曜日サマリと独立照合)',
    },
    rules,
    overrides,
  }));
  console.log(`地区${d.toUpperCase()}: areas=${areas.length} rules=${rules.length} overrides=${overrides.length} 照合OK`);
}

const allAbr = [...abrByTown.entries()].flatMap(([t, l]) => l.map((x) => `${t}${x.chome}丁目`));
const missing = allAbr.filter((n) => !usedAreas.has(n));
if (missing.length) throw new Error(`地区割当に漏れた町字: ${missing.join(', ')}`);
if (usedAreas.size !== allAbr.length) throw new Error(`町字数不一致 ${usedAreas.size} != ${allAbr.length}`);

mkdirSync(OUTDIR, { recursive: true });
console.log(`generated ${writeCourses(OUTDIR, PERIOD, docs)} courses (町字 ${usedAreas.size} 件を過不足なく分割)`);

// ---- taxonomy.yaml ----
const taxonomy = {
  categories: CAT_ORDER,
  overrides: {
    burnable: { label: '燃やすごみ', short: '燃やす' },
    non_burnable: { label: '燃やさないごみ', short: '燃やさない' },
    plastic: { label: 'プラスチック製容器包装', short: '容器包装' },
    paper_cloth: { label: '古紙、古着', short: '古紙古着' },
    beverage_can: { label: '缶' },
    hazardous: { label: '危険・有害ごみ', short: '危険有害' },
  },
  groups: [
    { label: 'びん、缶、危険・有害ごみ', short: 'びん缶危険', members: ['glass_bottle', 'beverage_can', 'hazardous'],
      note: '同じ曜日に隔週で一括収集される 3 品目 (市サイトの地区別曜日サマリの括り)' },
  ],
};
writeFileSync(join(OUTDIR, 'taxonomy.yaml'),
  '# 武蔵野市。公式区分(ごみと資源の収集カレンダー):\n' +
  '#   燃やすごみ / 燃やさないごみ / プラスチック製容器包装 / 古紙、古着 /\n' +
  '#   びん / 缶 / 危険・有害ごみ / ペットボトル\n' +
  '# 古紙と古着はカレンダー上「古紙・古着」の 1 品目として同日収集されるため paper_cloth にまとめた。\n' +
  '# 粗大ごみは予約制のため rules の対象外。\n' +
  yamlStringify(taxonomy, { lineWidth: 0 }));

// ---- meta.yaml ----
const meta = {
  handle: 'musashino',
  name_ja: '武蔵野市',
  region_ja: '東京都',
  code: '13203',
  source: {
    index_url: 'https://www.city.musashino.lg.jp/gomi_kankyo/gomi/gomi_shushubi/index.html',
    schedule_url: 'https://www.city.musashino.lg.jp/gomi_kankyo/gomi/gomi_shushubi/1053782.html',
    yearend_url: 'https://www.city.musashino.lg.jp/gomi_kankyo/gomi/gomi_shushubi/1053782.html',
  },
  notes: [
    '一次ソース: 市公式「【令和8年度(2026年度)版】ごみと資源の収集カレンダー」の地区別PDF(A〜J地区、2026{a..j}-1.pdf ※CとEのみ 2026{c,e}-1-1.pdf)。日付入りの通年カレンダーで、収録期間は2026年4月〜2027年3月(ちょうど令和8年度)。',
    'ライセンス: 市サイトはCC宣言なし。収集日という事実データを抽出して収録している(練馬・杉並・調布と同じ整理)。',
    '市内を10地区に分割。13町51丁目(デジタル庁ABR町字マスター東京都版 lg_code 132039 の全町字)が丁目単位で重複・欠落なく各地区へ割り当てられる(build 内で機械確認)。地区割は市サイト本文の「A地区 吉祥寺南町」等の記載を一次とした。',
    '収集は戸別収集。収集日の朝9時までに敷地内の決められた場所へ出す。祝日・振替休日も通常どおり収集し、土曜・日曜と年末年始は収集しない(市サイト本文の明記どおりで、カレンダーPDFの実日付とも一致)。',
    '年末年始の休止日は地区で異なる(A〜E: 12/29〜1/1、F〜J: 12/30〜1/1。いずれも1/2・1/3は土日)。F〜J地区は12月28日の資源・プラの回に「(年末特別収集)」の添え書きがあり、course YAML の先頭 rule の note に記録した。',
    'ペットボトルは6月まで隔週収集、7月から毎週収集に変わる(市サイトとカレンダーPDF表紙に明記)。年度途中で頻度が変わるため weekly では表せず monthly_specific(実日付列挙)で収録した(調布のペットボトルと同じ扱い)。',
    '燃やさないごみ、および びん・缶・危険有害ごみ は隔週収集のため monthly_specific。燃やすごみ(週2)・古紙、古着(週1)・プラスチック製容器包装(週1)は weekly + 年末年始の cancelled override。',
    '粗大ごみは予約制(粗大ごみ受付センター 0422-60-1844)のため rules の対象外。',
    'PDF は Illustrator 製で本物の罫線ベクタを持つため、色ベース抽出(秩父広域)ではなく罫線座標でグリッドを復元して抽出した。太字の文字二重打ち(「燃燃ややすす」→「燃やす」)、ページ番号と日番号の分離(日番号は12.8pt/21.0pt、ページ番号は8pt)、6週ある月(2026年8月・2027年5月)で週末日が同一セルに縦積みされる件は extract.py で対処済み。',
    '検証(2026-08-10): 10地区それぞれについて、カレンダーPDFから読んだ実日付と rules+overrides の expandRange 再展開を収録期間(2026-04-01〜2027-03-31, 365日 × 10地区 = 3650日枠)で全日照合、相違ゼロ。各月について日番号が1〜月末日まで欠落・重複なく現れること、列(曜日)と実曜日が一致することも extract.py が検査している。',
    '独立照合(2026-08-10): (1)市サイト本文の地区別曜日サマリ(例「A地区 月曜日:燃やすごみ / 火曜日:【毎週】(1)古紙、古着 (2)ペットボトル【隔週】びん、缶、危険・有害ごみ / …」)は PDF とは別に人が書いた表現であり、これを機械パースして 10地区×5曜日=50 枠の「曜日→品目集合と毎週/隔週の別」を抽出データと突き合わせ、相違ゼロ。市サイト脚注の「ペットボトルは6月まで隔週・7月から毎週」も全10地区で確認。(2)座標抽出の取りこぼし・列ずれを押さえるため、PDFページ画像を人が読んだ結果と 6ヶ月130日枠を照合し相違ゼロ(A地区の2026年4・5・8・9月とF地区の2026年12月・2027年1月。6週ある月と年末年始を狙って選定)。いずれも tools/pdf-extractor/musashino/verify.mjs に保持。',
    '確率的信頼度: PDF再展開は同一ソースからの一致(自己照合)であり保証されるのはパースの忠実性。独立な誤り単位で見ると、規則単位の系統誤りは 10地区×8種別=80 パターン ゼロ不一致 → 95%信頼で <3.8%/パターン、monthly_specific の実日付転記誤りは 3650 日枠 ゼロ不一致 → <0.082%/日枠 (rule of three)。一次ソースと独立な市サイト曜日サマリとの照合は 50 枠 ゼロ不一致 → <6.0%/枠、PDF画像の目視転記との照合は 130 日枠 ゼロ不一致 → <2.3%/日枠。地区割当は ABR 町字マスターと独立照合済み(51町字を過不足なく分割)。等級: 高(日付レベル・独立ソースあり)。残余リスクは、曜日サマリが日付レベルの情報を持たないため、隔週の位相(どの週から始まるか)と年末年始の実日付を裏づけるのは PDF と目視サンプルに限られる点。',
  ],
};
writeFileSync(join(OUTDIR, 'meta.yaml'), yamlStringify(meta, { lineWidth: 0 }));
console.log('wrote meta.yaml, taxonomy.yaml');
