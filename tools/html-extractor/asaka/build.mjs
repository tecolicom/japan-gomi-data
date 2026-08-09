// 朝霞市: 公式HTML「家庭ごみ収集日一覧表」dust-syuusyuu.html を一次ソースに course YAML を出力。
// (5374 area_days.csv は大字溝沼の東上線北側区分・自衛隊を欠くため、CSV は yomi 補完のみに使う。)
// 収集は全域 朝霞市クリーンセンター単一・全品目 weekly。HTML表の3曜日列と正典カテゴリの対応:
//   資源列 = びん・缶・ペットボトル・古紙・古布を同日一括 = glass_bottle+beverage_can+pet_bottle+paper+cloth
//   プラスチック資源列(=燃やせないごみと有害ごみ 同曜日) = plastic + non_burnable + hazardous
//   燃やすごみ列(週2) = burnable
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { foldCourses, courseDoc, writeCourses } from '../../_lib/emit.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '..', '..', '..', 'municipalities', 'saitama', 'asaka');
const PERIOD = '2026-04--2027-03'; // 一次ソースが裏付ける範囲 (会計年度とは限らない)
// 年末年始: 市は「祝日も収集します(年末年始を除く)」と明記するが実日付は毎年12月に別途告知。
const UNKNOWN = [{
  from: '2026-12-30', to: '2027-01-03',
  reason: '市は「祝日も収集します(年末年始を除く)」と明記するが、休止の実日付は毎年12月に別途告知され一次ソースに載らない',
  source_url: 'https://www.city.asaka.lg.jp/soshiki/15/dust-syuusyuu.html',
}];
const FY_JA = '令和8年度';
const EXTRACTED_AT = process.env.EXTRACTED_AT || (() => { throw new Error('EXTRACTED_AT env 必須'); })();
const SRC_HTML = 'https://www.city.asaka.lg.jp/soshiki/15/dust-syuusyuu.html';

const DOW = { 日: 'SU', 月: 'MO', 火: 'TU', 水: 'WE', 木: 'TH', 金: 'FR', 土: 'SA' };
const parseDays = (s) => (s || '').trim().split(/[・\s　、]+/).map((d) => DOW[d]).filter(Boolean);

const CAT_ORDER = ['burnable', 'non_burnable', 'hazardous', 'glass_bottle', 'beverage_can',
  'pet_bottle', 'paper', 'cloth', 'plastic'];
const catRank = (c) => { const i = CAT_ORDER.indexOf(c); if (i < 0) throw new Error(`未知カテゴリ ${c}`); return i; };

// --- ABR 町字マスター (fetch-yomi.mjs) ---
let ABR = [];
try { ABR = JSON.parse(readFileSync(join(HERE, 'cache', 'abr-town.json'), 'utf8')).towns; }
catch { throw new Error('cache/abr-town.json がありません。node fetch-yomi.mjs を先に実行'); }
const abrByOaza = new Map();
for (const t of ABR) {
  for (const k of new Set([t.oaza, t.oaza.replace(/ケ/g, 'ヶ'), t.oaza.replace(/ヶ/g, 'ケ')])) {
    if (!abrByOaza.has(k)) abrByOaza.set(k, []);
    abrByOaza.get(k).push(t);
  }
}
function abrOf(base, chomes) {
  const rows = abrByOaza.get(base) ?? abrByOaza.get(base.replace(/ケ/g, 'ヶ')) ?? abrByOaza.get(base.replace(/ヶ/g, 'ケ')) ?? [];
  if (!rows.length) return {};
  const oazaLvl = rows.filter((t) => t.chome_number === null);
  const yRows = oazaLvl.length ? oazaLvl : rows;
  const kanas = new Set(yRows.map((t) => t.kana).filter(Boolean));
  const yomi = kanas.size === 1 ? [...kanas][0] : undefined;
  let machiazaIds;
  if (chomes.length === 0) {
    const uniq = [...new Map(oazaLvl.map((t) => [t.id, t])).values()];
    if (uniq.length === 1) machiazaIds = [`${uniq[0].lg}-${uniq[0].id}`];
    else {
      const all = [...new Map(rows.map((t) => [t.id, t])).values()];
      if (all.length === 1) machiazaIds = [`${all[0].lg}-${all[0].id}`];
    }
  } else {
    const ids = [];
    for (const c of chomes) {
      const hit = rows.filter((t) => t.chome_number === c);
      if (hit.length === 1) ids.push(`${hit[0].lg}-${hit[0].id}`);
    }
    if (ids.length) machiazaIds = ids;
  }
  return { yomi, machiazaIds };
}

function expandChomeSpec(spec) {
  const out = [];
  for (const part of spec.split(/[・､、]/)) {
    const m = part.match(/^(\d+)～(\d+)$/);
    if (m) { for (let i = +m[1]; i <= +m[2]; i++) out.push(i); }
    else if (/^\d+$/.test(part)) out.push(+part);
  }
  return out;
}

// 地名セル → { base, chomeSpec, chomes, note, yomiCsv }
function parseArea(raw) {
  let s = raw.trim().replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0)).replace(/〜/g, '～');
  let yomiCsv = null;
  const ym = s.match(/[ 　]([ぁ-ん][ぁ-んーゝ・]*)$/); // CSV の読み併記 (HTML には無い)
  if (ym) { yomiCsv = ym[1]; s = s.slice(0, ym.index).trim(); }
  // 先頭「大字」接頭辞、および HTML の別名併記「岡・大字岡」の後半を落とす
  s = s.replace(/^大字/, '').replace(/・大字[^（(]*$/, '');
  let note = null;
  const bu = s.match(/^(.+?)の一部（(.+?)）$/);
  if (bu) { s = bu[1]; note = bu[2]; }
  const cm = s.match(/^(.+?)([\d～・]+)丁目(.*)$/);
  if (cm) {
    const chomeSpec = cm[2];
    const rest = cm[3].trim();
    const restNote = rest.replace(/（(.+)）$/, (_, x) => x).trim() || null;
    const notes = [restNote, note].filter(Boolean);
    return { base: cm[1], chomeSpec, chomes: expandChomeSpec(chomeSpec), note: notes.join('、') || null, yomiCsv };
  }
  return { base: s, chomeSpec: null, chomes: [], note, yomiCsv };
}

// --- CSV から yomi マップ (大字 base → 読み) を構築 (HTML には読みが無いため) ---
const baseYomi = new Map();
try {
  const csvText = readFileSync(join(HERE, 'cache', 'area_days.csv'), 'utf8');
  for (const line of csvText.split('\n').slice(1)) {
    const name = (line.split(',')[0] || '').trim();
    if (!name) continue;
    const pa = parseArea(name);
    if (pa.yomiCsv && !baseYomi.has(pa.base)) baseYomi.set(pa.base, pa.yomiCsv);
  }
} catch { /* CSV 無しでも ABR のみで続行 */ }

// --- 公式HTML表をパース (一次ソース) ---
const html = readFileSync(join(HERE, 'cache', 'dust-syuusyuu.html'), 'utf8');
const rows = [];
for (const tr of html.match(/<tr[\s\S]*?<\/tr>/g) || []) {
  let tds = [...tr.matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/g)]
    .map((m) => m[1].replace(/<[^>]*>/g, '').replace(/[\s　]+/g, '').trim());
  if (tds.length === 5) tds = tds.slice(1); // 五十音見出し列
  if (tds.length !== 4 || tds[0] === '区域' || !tds[0]) continue;
  rows.push({ name: tds[0], shigen: tds[1], pla: tds[2], burn: tds[3] });
}

function toRules(row) {
  const burn = parseDays(row.burn);
  const pla = parseDays(row.pla);   // プラスチック資源 = 燃やせないごみ+有害 (同曜日)
  const shi = parseDays(row.shigen); // 資源 (びん・缶・ペット・古紙・古布 一括)
  const R = [
    { category: 'burnable', pattern: 'weekly', days: burn },
    { category: 'non_burnable', pattern: 'weekly', days: pla },
    { category: 'hazardous', pattern: 'weekly', days: pla },
    { category: 'glass_bottle', pattern: 'weekly', days: shi },
    { category: 'beverage_can', pattern: 'weekly', days: shi },
    { category: 'pet_bottle', pattern: 'weekly', days: shi },
    { category: 'paper', pattern: 'weekly', days: shi },
    { category: 'cloth', pattern: 'weekly', days: shi },
    { category: 'plastic', pattern: 'weekly', days: pla },
  ];
  return R.sort((a, b) => catRank(a.category) - catRank(b.category));
}

const stat = { total: 0, yomi: 0, id: 0, noYomi: [] };
function toArea(row) {
  const { base, chomeSpec, chomes, note } = parseArea(row.name);
  const { yomi: yomiAbr, machiazaIds } = abrOf(base, chomes);
  const name = chomeSpec ? `${base}${chomeSpec}丁目` : base;
  const yomi = baseYomi.get(base) || yomiAbr;
  stat.total++;
  if (yomi) stat.yomi++; else stat.noYomi.push(name);
  if (machiazaIds) stat.id++;
  return { name, ...(yomi ? { yomi } : {}), ...(machiazaIds ? { machiaza_id: machiazaIds } : {}), ...(note ? { note } : {}) };
}

// --- 畳み込み → course ---
const folded = foldCourses(rows, toRules, toArea);
const docs = [];
folded.forEach((c, i) => {
  const seen = new Set();
  const areas = [];
  for (const a of c.areas) {
    const k = `${a.name}|${a.note || ''}`;
    if (seen.has(k)) continue;
    seen.add(k); areas.push(a);
  }
  docs.push(courseDoc({
    city: 'asaka',
    course: i + 1,
    areas,
    period: PERIOD,
    source: {
      edition_ja: FY_JA,
      source_url: SRC_HTML,
      extracted_at: EXTRACTED_AT,
      extracted_by: 'claude-opus-4-8',
      verified_by: 'Claude(朝霞市公式「家庭ごみ収集日一覧表」HTML表を一次ソースに機械抽出。市民団体Publitech ASAKAの5374版 area_days.csv と全地区の4分別×曜日を照合し、CSVが欠く大字溝沼の東上線北側区分・自衛隊はHTMLを採用。読みはCSVの読み併記、町字IDはABR町字マスター埼玉県版由来。日付入り年間カレンダーは市非公開のため日付レベルの独立照合は不可)',
    },
    rules: c.rules,
    unknownPeriods: UNKNOWN,
  }));
});

// --- 割れ (同名が別コース) は note を判別子として name に昇格 ---
{
  const cnt = new Map();
  for (const d of docs) for (const a of d.metadata.areas) cnt.set(a.name, (cnt.get(a.name) || 0) + 1);
  for (const d of docs) {
    d.metadata.areas = d.metadata.areas.map((a) => {
      if (!((cnt.get(a.name) || 0) > 1 && a.note)) return a;
      const { note, ...rest } = a;
      let nc = note.replace(/^（(.+)）$/, '$1').replace(/^[・、\s]+/, '').replace(/[・、\s]+$/, '');
      return { ...rest, name: nc ? `${a.name}（${nc}）` : a.name };
    });
  }
  const after = new Map();
  for (const d of docs) for (const a of d.metadata.areas) {
    if (!after.has(a.name)) after.set(a.name, new Set());
    after.get(a.name).add(String(d.metadata.course));
  }
  const dup = [...after].filter(([, cs]) => cs.size > 1).map(([n]) => n);
  if (dup.length) console.log(`  警告: 判別不能な割れ: ${dup.join('、')}`);
}

const n = writeCourses(OUT, PERIOD, docs);
console.log(`wrote ${n} courses → ${OUT}/${PERIOD}/`);
console.log(`areas: ${stat.total} (yomi ${stat.yomi} / machiaza_id ${stat.id})`);
if (stat.noYomi.length) console.log(`yomi 未付与: ${[...new Set(stat.noYomi)].join('、')}`);
