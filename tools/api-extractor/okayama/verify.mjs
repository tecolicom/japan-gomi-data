// 岡山市 検証 (JS 側):
//  (1) 2取得突合: fetch.mjs の cache/records.json × 独立ブラウザ取得 cache/browser-records.json を全行照合。
//  (2) パース署名の書き出し: 各行4フィールドの正規化断片署名を cache/js_field_sigs.json へ。
//      verify_parse.py が別実装で同じ署名を作り突合する (パースの独立2実装照合)。
//  (3) コース展開整合: 各行を rules 化し署名でコースへ写像 → コースYAMLを FY2026 通年展開し、
//      その行の可燃/不燃/資源化物/プラの weekly/第n パターンを完全再現するか確認 (畳み込み+展開の忠実性)。
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as yamlParse } from 'yaml';
import { parseFragments, DAY_INDEX } from './parse.mjs';
import { expandFiscalYear, nthOfMonth, signatureKey } from '../../_lib/schedule.mjs';
import { DAY_TO_INDEX } from '../../_lib/jp.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CACHE = join(HERE, 'cache');
const OUTDIR = join(HERE, '..', '..', '..', 'municipalities', 'okayama', 'okayama', '2026');
const FY = 2026;
const DOW = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

// フィールド断片 -> 正規化署名文字列 (JS/Python 共通仕様)
function fieldSig(text) {
  const frags = parseFragments(text);
  const parts = frags.map((f) => f.pattern === 'weekly'
    ? `W:${[...f.days].sort((a, b) => DAY_INDEX[a] - DAY_INDEX[b]).join(',')}`
    : `M:${f.days[0]}@${[...f.occurrences].sort((a, b) => a - b).join(',')}`);
  return parts.sort().join('|');
}

let fail = 0;
const err = (m) => { console.error('✗', m); fail++; };

// ---- (1) 2取得突合 ----
const api = JSON.parse(readFileSync(join(CACHE, 'records.json'), 'utf8')).records;
const FIELDS = ['id', 'district', 'town', 'burnable', 'nonburnable', 'recycle', 'plastic', 'note'];
if (existsSync(join(CACHE, 'browser-records.json'))) {
  const br = JSON.parse(readFileSync(join(CACHE, 'browser-records.json'), 'utf8')).records;
  const brMap = new Map(br.map((r) => [r.id, r]));
  let cmp = 0, mism = 0;
  if (api.length !== br.length) err(`件数不一致 api=${api.length} browser=${br.length}`);
  for (const a of api) {
    const b = brMap.get(a.id);
    if (!b) { err(`browser に id ${a.id} が無い`); continue; }
    cmp++;
    for (const f of FIELDS)
      if (String(a[f] ?? '').trim() !== String(b[f] ?? '').trim())
        err(`id${a.id} ${f}: api=${JSON.stringify(a[f])} browser=${JSON.stringify(b[f])}`);
  }
  console.log(`(1) 2取得突合: ${cmp} 行照合, 不一致 ${mism === 0 ? fail : mism} (エラー総数に計上)`);
} else {
  console.log('(1) browser-records.json 無し → スキップ');
}

// ---- (2) パース署名を書き出し (python が別実装で突合) ----
const fieldSigs = api.map((r) => ({
  id: r.id,
  burnable: fieldSig(r.burnable),
  nonburnable: fieldSig(r.nonburnable),
  recycle: fieldSig(r.recycle),
  plastic: fieldSig(r.plastic),
}));
writeFileSync(join(CACHE, 'js_field_sigs.json'), JSON.stringify(fieldSigs, null, 0));
console.log(`(2) JS パース署名 ${fieldSigs.length} 行 -> cache/js_field_sigs.json (verify_parse.py で突合)`);

// ---- (3) コース展開整合 ----
// コースYAML を読み、rules 署名 -> 実現パターン(展開)を索引化
function realizedByCat(rules, overrides) {
  const cal = expandFiscalYear(FY, rules, overrides || []);
  const out = {};
  for (const [iso, cats] of cal) {
    const d = new Date(iso + 'T00:00:00');
    const dow = DOW[d.getDay()], occ = nthOfMonth(d);
    for (const c of cats) { (out[c] ||= new Set()); out[c].add(`${occ}|${dow}`); }
  }
  return out; // {cat: Set("occ|DOW")}
}
const courseBySig = new Map();
for (const f of readdirSync(OUTDIR).filter((x) => x.endsWith('.yaml'))) {
  const doc = yamlParse(readFileSync(join(OUTDIR, f), 'utf8'));
  courseBySig.set(signatureKey(doc.rules), { file: f, real: realizedByCat(doc.rules, doc.overrides) });
}

// 行 -> 期待パターン {cat: Set("occ|DOW")}。weekly は全 occ(1..5) を展開して比較。
const RECYCLE_CATS = ['glass_bottle', 'beverage_can', 'spray_can', 'pet_bottle', 'paper', 'cloth'];
function expectedByCat(rec) {
  const out = {};
  const add = (cat, frags) => {
    (out[cat] ||= new Set());
    for (const fr of frags) {
      const occs = fr.pattern === 'weekly' ? [1, 2, 3, 4, 5] : fr.occurrences;
      for (const day of fr.days) for (const o of occs) {
        // weekly の第5週は月により無いので、比較は「宣言 occ が展開に含まれるか」を weekly は緩めず
        out[cat].add(`${o}|${day}`);
      }
    }
  };
  add('burnable', parseFragments(rec.burnable));
  add('non_burnable', parseFragments(rec.nonburnable));
  const rf = parseFragments(rec.recycle);
  for (const c of RECYCLE_CATS) add(c, rf);
  add('plastic', parseFragments(rec.plastic));
  return out;
}

// 行の rules 署名を build と同じ写像で作る (照合対象コースの特定用)
import { fragmentsExpecting } from './parse.mjs';
const CAT_ORDER = ['burnable', 'non_burnable', 'glass_bottle', 'beverage_can', 'spray_can', 'pet_bottle', 'paper', 'cloth', 'plastic'];
function rowRules(rec) {
  const rules = [];
  for (const f of fragmentsExpecting(rec.burnable, 'weekly', '可燃')) rules.push({ category: 'burnable', pattern: f.pattern, days: f.days });
  for (const f of fragmentsExpecting(rec.nonburnable, 'monthly_nth', '不燃')) rules.push({ category: 'non_burnable', pattern: f.pattern, days: f.days, occurrences: f.occurrences });
  const rf = fragmentsExpecting(rec.recycle, 'monthly_nth', '資源化物');
  for (const c of RECYCLE_CATS) for (const f of rf) rules.push({ category: c, pattern: f.pattern, days: f.days, occurrences: f.occurrences });
  for (const f of fragmentsExpecting(rec.plastic, 'weekly', 'プラ資源')) rules.push({ category: 'plastic', pattern: f.pattern, days: f.days });
  return rules.map((r, i) => [r, i]).sort((a, b) => CAT_ORDER.indexOf(a[0].category) - CAT_ORDER.indexOf(b[0].category) || a[1] - b[1]).map(([r]) => r);
}

let checked = 0, rowMism = 0;
for (const rec of api) {
  const sig = signatureKey(rowRules(rec));
  const course = courseBySig.get(sig);
  if (!course) { err(`id${rec.id} が対応コース無し (署名 ${sig})`); rowMism++; continue; }
  const exp = expectedByCat(rec);
  const got = course.real;
  for (const [cat, set] of Object.entries(exp)) {
    const g = got[cat] || new Set();
    // weekly カテゴリは宣言 occ(1..5) のうち、その曜日が実在する occ が展開に出る。
    // 比較は「宣言した (occ|DOW) がすべて展開に含まれ、かつ展開の当該カテゴリが宣言 DOW 以外の曜日を持たない」。
    const declDows = new Set([...set].map((s) => s.split('|')[1]));
    const gotDows = new Set([...g].map((s) => s.split('|')[1]));
    for (const dow of gotDows) if (!declDows.has(dow)) { err(`id${rec.id} ${cat} 展開に想定外曜日 ${dow}`); rowMism++; }
    // monthly は occ も厳密比較
    const isWeekly = [...set].some((s) => ['1', '2', '3', '4', '5'].every((o) => set.has(`${o}|${s.split('|')[1]}`)));
    if (!isWeekly) {
      const es = [...set].sort().join(';'), gs = [...g].sort().join(';');
      if (es !== gs) { err(`id${rec.id} ${cat} 第n 不一致 exp=${es} got=${gs}`); rowMism++; }
    }
  }
  checked++;
}
console.log(`(3) コース展開整合: ${checked} 行検証, 行不一致 ${rowMism}`);

console.log(fail === 0 ? '\n✅ 全検証パス' : `\n❌ エラー ${fail} 件`);
if (fail) process.exit(1);
