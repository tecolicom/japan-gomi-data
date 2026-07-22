// 倉敷市: extract.py が出した records.json (地区ゾーンごとの weekly/nth 日程) を
// 正典カテゴリの rules へ写像し、同一日程を収集地区(環境センター)内で畳んで course YAML を出力。
//
// 種別マッピング(taxonomy.yaml と一致):
//  真備以外5地区(倉敷/水島/玉島/児島/船穂): 燃やせる=burnable(週2 or 月n) /
//    資源ごみ(月1・同日一括)=びん+缶+ペット+古紙+古布 / 埋立=non_burnable
//  真備: 燃える=burnable / 燃えない=non_burnable / 資源[ペット・白トレイ・古布]=pet+plastic+cloth /
//    資源[缶]=beverage_can / 資源[びん・古紙]=glass_bottle+paper / 有害[体温計・乾電池]=hazardous
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { foldCourses, courseDoc, writeCourses } from '../../_lib/emit.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..', '..');
const OUTDIR = join(ROOT, 'municipalities', 'okayama', 'kurashiki');
const YEAR = 2026;
const FY_JA = '令和8年度';
const EXTRACTED_AT = process.env.EXTRACTED_AT || (() => { throw new Error('EXTRACTED_AT env 必須'); })();
const EXTRACTED_BY = 'claude-opus-4-8';
const INDEX_URL = 'https://www.city.kurashiki.okayama.jp/kurashi/kankyo/1003645/1013690/1003647/1003660.html';
const PDF_BASE = 'https://www.city.kurashiki.okayama.jp/_res/projects/default_project/_page_/001/003/660';

const DISTRICTS = {
  倉敷: { romaji: 'kurashiki', pdf: 'kurashiki.pdf' },
  水島: { romaji: 'mizushima', pdf: 'mizushima.pdf' },
  玉島: { romaji: 'tamashima', pdf: 'tamashimafunao.pdf' },
  児島: { romaji: 'kojima', pdf: 'kojima.pdf' },
  船穂: { romaji: 'funao', pdf: 'funao.pdf' },
  真備: { romaji: 'mabi', pdf: 'mabi.pdf' },
};

// カテゴリの決定順(署名安定用)
const CAT_ORDER = ['burnable', 'non_burnable', 'glass_bottle', 'beverage_can', 'pet_bottle',
  'plastic', 'paper', 'cloth', 'hazardous'];
const catRank = (c) => { const i = CAT_ORDER.indexOf(c); if (i < 0) throw new Error(`未知カテゴリ ${c}`); return i; };

// weekly/nth の生値 [kind, a, b] → rule 断片(category を後付け)
function frag(v) {
  if (v[0] === 'weekly') return { pattern: 'weekly', days: v[1] };
  if (v[0] === 'nth') return { pattern: 'monthly_nth', occurrences: v[1], days: [v[2]] };
  throw new Error(`未知pattern ${v[0]}`);
}
const rule = (category, v) => ({ category, ...frag(v) });

function toRules(rec) {
  const v = rec.values;
  const rules = [];
  if (rec.schema === 'main') {
    rules.push(rule('burnable', v.burnable));
    for (const c of ['glass_bottle', 'beverage_can', 'pet_bottle', 'paper', 'cloth'])
      rules.push(rule(c, v.shigen));
    rules.push(rule('non_burnable', v.umetate));
  } else if (rec.schema === 'mabi') {
    rules.push(rule('burnable', v.moeru));
    rules.push(rule('non_burnable', v.moenai));
    for (const c of ['pet_bottle', 'plastic', 'cloth']) rules.push(rule(c, v.shigen_pet));
    rules.push(rule('beverage_can', v.shigen_can));
    for (const c of ['glass_bottle', 'paper']) rules.push(rule(c, v.shigen_binpaper));
    rules.push(rule('hazardous', v.yugai));
  } else throw new Error(`未知schema ${rec.schema}`);
  // カテゴリ順に整列(署名安定)
  return rules.sort((a, b) => catRank(a.category) - catRank(b.category));
}

const records = JSON.parse(readFileSync(join(HERE, 'cache', 'records.json'), 'utf8'));

const docs = [];
let seq = 0;
for (const [distJa, meta] of Object.entries(DISTRICTS)) {
  const rows = records.filter((r) => r.district === distJa);
  if (!rows.length) continue;
  // 環境センター(収集地区)内で同一日程を畳む。areas は {name, note} で構造化し、
  // 旧呼称 (kyu) は note へ分離 (course_name_ja には入れない)。学区 (gakku) がある行は
  // 「学区／地区」を name にして文脈を保つ。読み (yomi) は権威ソースが無いため付けない。
  const folded = foldCourses(rows, toRules, (r) => ({
    name: r.gakku ? `${r.gakku}／${r.area}` : r.area,
    ...(r.kyu ? { note: r.kyu } : {}),
  }));
  folded.forEach((c, i) => {
    seq++;
    const courseId = `${meta.romaji}-${i + 1}`;
    docs.push(courseDoc({
      city: 'kurashiki',
      course: courseId,
      courseNameJa: `${distJa}地区: ${c.areas.map((a) => a.name).join(' ／ ')}`,
      areas: c.areas,
      year: YEAR,
      fiscalYearJa: FY_JA,
      source: {
        source_url: INDEX_URL,
        pdf_url: `${PDF_BASE}/${meta.pdf}`,
        extracted_at: EXTRACTED_AT,
        extracted_by: EXTRACTED_BY,
        verified_by: 'Claude(地区別PDFを pdfplumber 罫線グリッド抽出。data eye 平成31年度地区別収集日CSVと曜日/第n を独立照合)',
      },
      rules: c.rules,
    }));
  });
}

const n = writeCourses(OUTDIR, YEAR, docs);
console.log(`wrote ${n} courses (${seq} total) → ${OUTDIR}/${YEAR}/`);
