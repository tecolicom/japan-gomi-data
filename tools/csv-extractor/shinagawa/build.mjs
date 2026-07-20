// 品川区 ODP CSV → municipalities/tokyo/shinagawa/2026/course-*.yaml
//
// 3 経路を突合してから出力する:
//   A. CSV  (日本語ラベル "第2木・第4木" を解釈)          … parse.mjs
//   B. RDF  (ODP 語彙 URI #SecondThursday を解釈)         … parse-rdf.mjs
//   C. 公式 HTML (現行「収集日一覧」表 "第2木曜日、…")    … parse-html.mjs
// A と B は同一データセットの別表現なので「抽出の健全性」を、
// C は独立に編集・更新される現行公式表なので「データの鮮度と正しさ」を検証する。
//
// ODP データセットは dcterms:modified 2015-06-03 と古く、実際に 1 件の誤りを含む
// (大井6丁目の燃やすごみに陶器・ガラス・金属ごみの値が複写されている)。
// C と食い違う行は KNOWN_DIVERGENCES に明示したものだけを公式 HTML 側の値で採用し、
// 未知の食い違いが出たら中断する (ソースを黙って書き換えない)。
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as yamlParse } from 'yaml';
import { loadCsv, loadRdf, loadHtmlPages, CSV_URL } from './fetch.mjs';
import { parseShinagawaCsv, areaToRules, CATEGORY_MAP } from './parse.mjs';
import { parseShinagawaRdf } from './parse-rdf.mjs';
import { parseShinagawaHtml } from './parse-html.mjs';
import { signatureKey } from '../../_lib/schedule.mjs';
import { foldCourses, courseDoc, writeCourses } from '../../_lib/emit.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '../../../municipalities/tokyo/shinagawa');
const YEAR = 2026;
const FISCAL_YEAR_JA = '令和8年度';
const EXTRACTED_AT = process.env.EXTRACTED_AT || '2026-07-20'; // Date.now() 不使用 (決定的出力)
const CATEGORIES_JA = Object.keys(CATEGORY_MAP);

// 現行公式 HTML と食い違う ODP 側の既知の誤り。
// key: "町名|丁目|分類" / expect: 公式 HTML 側の署名 / wrong: ODP 側の署名
// 公式 HTML 側を採用する。両者がここに書いた値と変わったら中断する (再調査の合図)。
const KNOWN_DIVERGENCES = {
  '大井|6|燃やすごみ': {
    wrong: 'monthly_nth:MO:13',
    expect: 'weekly:FRTU:',
    note: 'ODP は陶器・ガラス・金属ごみ (第1月・第3月) の値を燃やすごみ欄に複写している。'
      + '区公式「収集日一覧」は火曜日・金曜日。隣接する大井5・7丁目も火・金であり、'
      + '全 137 地区で燃やすごみが月2回になるのはこの1件のみ。公式 HTML 側を採用。',
  },
};

// 地区名から「町名」「丁目」「残り (番地・エリア表記)」を分解する。
const AREA_RE = /^(.+?)(\d+)丁目(.*)$/;
function splitArea(area) {
  const m = area.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)).match(AREA_RE);
  if (!m) throw new Error(`地区名の分解に失敗: "${area}"`);
  return { town: m[1], chome: Number(m[2]), rest: m[3] };
}

// 地区名の接尾表記 → 読み。未知の表記は throw する (黙って落とさない)。
const SUFFIX_YOMI = {
  '': '',
  '（荏原エリア）': '-えばらえりあ',
  '（品川エリア）': '-しながわえりあ',
  '1～10番': '-1-10ばん',
  '1～10番以外': '-1-10ばんいがい',
  '1～16番': '-1-16ばん',
  '17番': '-17ばん',
  '18番': '-18ばん',
  '18番以外': '-18ばんいがい',
  '4番4号': '-4ばん4ごう',
  '4番4号以外': '-4ばん4ごういがい',
  '1～39号': '-1-39ごう',
  '40～69号棟・わかくさ荘': '-40-69ごうとう-わかくさそう',
};

const sigOf = (d) => `${d.pattern}:${[...d.days].sort().join('')}:${(d.occurrences || []).join('')}`;
const rowSig = (byCat) => CATEGORIES_JA.map((c) => sigOf(byCat[c])).join('/');

// ---- 0) 3 ソースの読み込み ----
const csvRows = parseShinagawaCsv(await loadCsv());
const rdfRows = parseShinagawaRdf(await loadRdf());
const htmlRows = parseShinagawaHtml(await loadHtmlPages());
const { towns: TOWN_YOMI } = yamlParse(readFileSync(join(HERE, 'yomi.yaml'), 'utf8'));

// ---- 1) A(CSV) × B(RDF) 全行突合 ----
{
  const key = (r) => `${r.category}|${r.area}`;
  const rdfByKey = new Map(rdfRows.map((r) => [key(r), r]));
  if (csvRows.length !== rdfRows.length) throw new Error(`行数不一致: CSV=${csvRows.length} RDF=${rdfRows.length}`);
  for (const r of csvRows) {
    const o = rdfByKey.get(key(r));
    if (!o) throw new Error(`RDF に無い行: ${key(r)}`);
    if (sigOf(r.day) !== sigOf(o.day)) throw new Error(`CSV/RDF 日程不一致: ${key(r)} ${sigOf(r.day)} vs ${sigOf(o.day)}`);
    if ((r.holiday === '○') !== (o.holiday === true)) throw new Error(`CSV/RDF 祝日収集不一致: ${key(r)}`);
  }
  console.log(`[1] CSV ${csvRows.length} 行 = RDF ${rdfRows.length} 行 (日程・祝日収集とも全一致)`);
}

// ---- 2) 運用列の確認 (祝日収集・特別収集日・適用期間) ----
{
  const noHoliday = csvRows.filter((r) => r.holiday !== '○');
  const special = csvRows.filter((r) => r.specialCollect || r.specialSkip);
  const period = csvRows.filter((r) => r.from || r.to);
  if (noHoliday.length) throw new Error(`祝日収集なしの地区が出現 (要 overrides 対応): ${noHoliday.length} 件`);
  if (special.length) throw new Error(`特別に収集する/しない日が設定された (要 overrides 対応): ${special.length} 件`);
  if (period.length) throw new Error(`適用開始/終了日が設定された (要 overrides 対応): ${period.length} 件`);
  console.log(`[2] 運用列: 全 ${csvRows.length} 行が「祝日の収集=○」・特別収集日なし・適用期間指定なし`);
}

// ---- 3) 地区ごとに 3 分類を束ね、C(公式 HTML) と突合 ----
const byArea = new Map();
for (const r of csvRows) {
  if (!byArea.has(r.area)) byArea.set(r.area, {});
  byArea.get(r.area)[r.category] = r.day;
}
for (const [area, m] of byArea) {
  const missing = CATEGORIES_JA.filter((c) => !m[c]);
  if (missing.length) throw new Error(`${area}: 分類 ${missing.join(',')} の行が無い`);
}

const htmlByKey = new Map(); // "町名|丁目" → [{banchi, days}]
for (const r of htmlRows) {
  const k = `${r.town}|${r.chome}`;
  if (!htmlByKey.has(k)) htmlByKey.set(k, []);
  htmlByKey.get(k).push(r);
}

const corrections = [];
const banchiMap = [];  // CSV 名 ↔ 公式 HTML の番地表記の対応 (分割地区)
{
  const csvByKey = new Map(); // "町名|丁目" → [[area, byCat]]
  for (const [area, m] of byArea) {
    const { town, chome } = splitArea(area);
    const k = `${town}|${chome}`;
    if (!csvByKey.has(k)) csvByKey.set(k, []);
    csvByKey.get(k).push([area, m]);
  }
  const onlyCsv = [...csvByKey.keys()].filter((k) => !htmlByKey.has(k));
  const onlyHtml = [...htmlByKey.keys()].filter((k) => !csvByKey.has(k));
  if (onlyCsv.length || onlyHtml.length) {
    throw new Error(`町丁目の集合が公式 HTML と一致しない (CSV のみ: ${onlyCsv}, HTML のみ: ${onlyHtml})`);
  }

  for (const [k, entries] of csvByKey) {
    const hs = htmlByKey.get(k);
    if (entries.length !== hs.length) throw new Error(`${k}: 分割数が公式 HTML と違う (CSV=${entries.length} HTML=${hs.length})`);

    // 既知の誤りを公式 HTML 側の値で訂正する
    for (const [area, m] of entries) {
      for (const cat of CATEGORIES_JA) {
        const dk = `${k}|${cat}`;
        const known = KNOWN_DIVERGENCES[dk];
        if (!known) continue;
        if (sigOf(m[cat]) !== known.wrong) throw new Error(`${dk}: 既知の誤り (${known.wrong}) が ODP 側で解消/変化した (現在 ${sigOf(m[cat])}) → KNOWN_DIVERGENCES を見直すこと`);
        const h = hs.find((x) => sigOf(x.days[cat]) === known.expect);
        if (!h) throw new Error(`${dk}: 公式 HTML の値が期待 (${known.expect}) と違う → 再調査`);
        m[cat] = h.days[cat];
        corrections.push({ area, cat, from: known.wrong, to: known.expect, note: known.note });
      }
    }

    // 署名の多重集合として突合 (分割地区は CSV 名と HTML の番地表記が別体系のため)
    const cs = entries.map(([area, m]) => [area, rowSig(m)]).sort((a, b) => (a[1] < b[1] ? -1 : 1));
    const ds = hs.map((r) => [r.banchi || '(全域)', rowSig(r.days)]).sort((a, b) => (a[1] < b[1] ? -1 : 1));
    for (let i = 0; i < cs.length; i++) {
      if (cs[i][1] !== ds[i][1]) throw new Error(`${k}: 公式 HTML と日程不一致\n  CSV : ${JSON.stringify(cs)}\n  HTML: ${JSON.stringify(ds)}`);
    }
    // 分割地区は署名が全て相異なることを確認したうえで名称対応を確定する
    if (cs.length > 1) {
      if (new Set(cs.map((x) => x[1])).size !== cs.length) throw new Error(`${k}: 分割地区の日程が重複し公式 HTML の番地表記と対応づけられない`);
      for (let i = 0; i < cs.length; i++) banchiMap.push({ csv: cs[i][0], html: ds[i][0] });
    }
  }
  console.log(`[3] 公式 HTML 137 地区 (129 町丁目) と全突合: 不一致 ${corrections.length} 件 (既知の ODP 誤りとして公式 HTML 側を採用)`);
  for (const c of corrections) console.log(`      訂正: ${c.area} ${c.cat}: ${c.from} → ${c.to}`);
}

// ---- 4) コース畳み込みと出力 ----
function areaEntry(area) {
  const { town, chome, rest } = splitArea(area);
  const base = TOWN_YOMI[town];
  if (!base) throw new Error(`yomi.yaml に無い町名: "${town}" (${area})`);
  const suffix = SUFFIX_YOMI[rest];
  if (suffix === undefined) throw new Error(`未知の地区名接尾表記: "${rest}" (${area}) → build.mjs の SUFFIX_YOMI に追加すること`);
  return { name: area, yomi: `${base}${chome}${suffix}` };
}

const areas = [...byArea.keys()];
const courses = foldCourses(
  areas,
  (area) => areaToRules(byArea.get(area)),
  (area) => areaEntry(area),
);

// 署名順に採番して決定的な出力にする
courses.sort((a, b) => (signatureKey(a.rules) < signatureKey(b.rules) ? -1 : 1));
const docs = courses.map(({ rules, areas: as }, i) => courseDoc({
  city: 'shinagawa',
  course: String(i + 1),
  areas: as.sort((a, b) => a.yomi.localeCompare(b.yomi, 'ja')),
  year: YEAR,
  fiscalYearJa: FISCAL_YEAR_JA,
  source: {
    source_url: CSV_URL,
    extracted_at: EXTRACTED_AT,
    extracted_by: 'claude-opus-4-6',
    verified_by: 'Claude(品川区ODP CSVの機械変換。同ODP RDF を別実装でパースし全411行突合 + 区公式「ごみ・資源収集日一覧」HTML 全137地区と突合)',
  },
  rules,
  // 年末年始 overrides は置かない: 令和8年度分 (2026年末〜2027年始) が未公表のため。
  // 詳細は municipalities/tokyo/shinagawa/meta.yaml の notes を参照。
  overrides: [],
}));

const n = writeCourses(OUT, YEAR, docs);
console.log(`[4] ${areas.length} 地区 → ${n} コースを ${join(OUT, String(YEAR))} へ出力`);

writeFileSync(join(HERE, 'cache', 'banchi-map.json'), JSON.stringify(banchiMap, null, 1));
console.log(`[4] 分割地区 ${banchiMap.length} 件の CSV 名 ↔ 公式 HTML 番地表記の対応を cache/banchi-map.json に出力`);
