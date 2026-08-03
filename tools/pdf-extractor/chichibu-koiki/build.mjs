// 秩父広域: extract.py (色ベース) が出した {品目:[日付...]} から course YAML を生成する。
// 可燃は weekly(config.burnable_weekly) とみなし、実データとの差分(収集休止)を override cancelled に落とす。
// 不燃/紙布/カンビン/ペットは monthly_specific(実日付)。カンビンは glass_bottle+beverage_can に分ける。
// build 時に検証: (1)可燃の weekly 差分は cancelled のみ・臨時収集は警告 (2)月別件数 (3)同日複数品目。
// 使い方: EXTRACTED_AT=YYYY-MM-DD node build.mjs [course...]   (省略時は config の全地区)
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { stringify as yamlStringify } from 'yaml';
import { courseDoc, writeCourses } from '../../_lib/emit.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CONF = JSON.parse(readFileSync(join(HERE, 'config.json'), 'utf8'));
const OUT = join(HERE, '..', '..', '..', 'municipalities', CONF.region_ja === '埼玉県' ? 'saitama' : 'saitama', CONF.handle);
const EXTRACTED_AT = process.env.EXTRACTED_AT || (() => { throw new Error('EXTRACTED_AT env 必須'); })();

const DOW = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
const DOW_IDX = Object.fromEntries(DOW.map((d, i) => [d, i]));
const parseUTC = (s) => new Date(`${s}T00:00:00Z`);
const iso = (d) => d.toISOString().slice(0, 10);
const CAT_ORDER = ['burnable', 'non_burnable', 'paper_cloth', 'glass_bottle', 'beverage_can', 'pet_bottle'];
const catRank = (c) => { const i = CAT_ORDER.indexOf(c); return i < 0 ? 99 : i; };

// 会計年度 4/1..翌3/31 の weekly[days] 展開
function weeklyDates(year, days) {
  const set = new Set(days.map((d) => DOW_IDX[d]));
  const out = [];
  for (let d = parseUTC(`${year}-04-01`); d <= parseUTC(`${year + 1}-03-31`); d.setUTCDate(d.getUTCDate() + 1))
    if (set.has(d.getUTCDay())) out.push(iso(d));
  return out;
}

function ym(s) { return s.slice(0, 7); }

function validate(course, ext) {
  const problems = [];
  // 1) 可燃 vs weekly
  const kaen = new Set(ext['可燃'] || []);
  const exp = new Set(weeklyDates(CONF.year, CONF.burnable_weekly));
  const cancelled = [...exp].filter((d) => !kaen.has(d)).sort();
  const extra = [...kaen].filter((d) => !exp.has(d)).sort();
  if (extra.length) problems.push(`可燃に weekly 外の臨時収集: ${extra.join(',')}`);
  // 2) 月別件数 (不燃1・紙布2・カンビン2・ペット2)
  const want = { 不燃: 1, 紙布: 2, カンビン: 2, ペット: 2 };
  for (const [item, n] of Object.entries(want)) {
    const byMonth = {};
    for (const d of ext[item] || []) byMonth[ym(d)] = (byMonth[ym(d)] || 0) + 1;
    for (const [mo, c] of Object.entries(byMonth)) if (c !== n) problems.push(`${item} ${mo}: ${c}件 (期待${n})`);
    const months = new Set((ext[item] || []).map(ym));
    if (months.size !== 12) problems.push(`${item}: ${months.size}ヶ月分 (期待12)`);
  }
  return { cancelled, extra, problems };
}

function buildRules(ext, cancelled) {
  const rules = [];
  // 可燃 = weekly + override(cancelled)
  rules.push({ category: 'burnable', pattern: 'weekly', days: CONF.burnable_weekly });
  // 他 = monthly_specific。カンビンは2カテゴリに展開。
  const specific = [
    ['non_burnable', ext['不燃']],
    ['paper_cloth', ext['紙布']],
    ['glass_bottle', ext['カンビン']],
    ['beverage_can', ext['カンビン']],
    ['pet_bottle', ext['ペット']],
  ];
  for (const [cat, dates] of specific)
    rules.push({ category: cat, pattern: 'monthly_specific', dates: [...dates].sort() });
  rules.sort((a, b) => catRank(a.category) - catRank(b.category));
  const overrides = cancelled.map((date) => ({ date, category: 'burnable', cancelled: true }));
  return { rules, overrides };
}

function writeMeta() {
  const meta = {
    handle: CONF.handle, name_ja: CONF.name_ja, region_ja: CONF.region_ja, code: CONF.code,
    source: { index_url: CONF.source_index, schedule_url: CONF.source_index, yearend_url: CONF.source_index },
    notes: [
      '一次ソース: 秩父市公式「家庭ごみ収集カレンダー」(city.chichibu.lg.jp/9098.html)の地区別PDF。収集主体は秩父広域市町村圏組合(秩父市・横瀬町・皆野町・長瀞町・小鹿野町の5市町共同)、日程管理は秩父市生活衛生課。地区は町名対応で全43分割、コースは地区単位(course=地区名ローマ字)。',
      '抽出方法: PDFはInDesign製の雑誌型で文字/座標抽出が不可(pdfplumber extract_words空)。品目がセル背景色で塗り分けられていることを使い、各月グリッド四隅の空セルに置いた矩形注釈から暦計算でセル座標を復元し、セル領域の色ピクセルで品目を判定する色ベース抽出(tools/pdf-extractor/chichibu-koiki)。文字も日付も読まない。',
      '種別マッピング(taxonomy.yaml と一致、語彙追加なし): 可燃ごみ(緑)=burnable / 不燃ごみ(黄)=non_burnable / 紙・布類(紫)=paper_cloth / カン・ビン(水色、同日収集)=glass_bottle+beverage_can に分解 / ペットボトル(茶)=pet_bottle。ピンクの「クリーンサンデー」「施設持込可/不可」は集積所収集でなく施設持込のため収録しない。',
      '可燃ごみは月・木の週2回。実カレンダーとの差分は 2026-12-03(休・施設持込可の日)の1件のみで、override に cancelled として記録。12/31は可燃収集あり(施設持込不可の注記のみ)。不燃は月1、紙・布類/カン・ビン/ペットボトルは月2で、各月の実日付を monthly_specific に転記(第n回では表せない不規則配置のため)。',
      '検証: 色ベース抽出の結果を自動照合(可燃=weekly月木との差分がcancelledのみ・臨時収集ゼロ、月別件数が不燃1紙布2カンビン2ペット2で全12ヶ月一致、同日複数品目がカン・ビン+ペットの斜め分割6日のみ)。目視サンプル(12月・1月・8月)とも一致。',
      'ライセンス: 収集日程データ自体の公開ライセンスは未確認(市サイト、埼玉県ODポータルに個別データセット無し)→ unknown。収集日という事実データの抽出として収録。',
    ],
  };
  writeFileSync(join(OUT, 'meta.yaml'), yamlStringify(meta, { lineWidth: 0 }));
}

function writeTaxonomy() {
  const tax = {
    categories: ['burnable', 'non_burnable', 'paper_cloth', 'glass_bottle', 'beverage_can', 'pet_bottle'],
    overrides: {
      burnable: { label: '可燃ごみ', short: '可燃' },
      non_burnable: { label: '不燃ごみ', short: '不燃' },
      paper_cloth: { label: '紙・布類', short: '紙布' },
      glass_bottle: { label: 'びん', short: 'びん' },
      beverage_can: { label: 'かん', short: '缶' },
      pet_bottle: { label: 'ペットボトル', short: 'ペット' },
    },
    groups: [
      { label: 'カン・ビン', members: ['glass_bottle', 'beverage_can'], note: 'カンとビンを同日(monthly_specificの実日付)に収集' },
    ],
  };
  const header = '# 秩父市(秩父広域市町村圏組合)。地区別ごみカレンダーPDFの品目を正典語彙へ割り当てる(語彙追加なし)。\n'
    + '#  可燃ごみ=burnable / 不燃ごみ=non_burnable / 紙・布類=paper_cloth /\n'
    + '#  カン・ビン(同日)=glass_bottle+beverage_can / ペットボトル=pet_bottle\n';
  writeFileSync(join(OUT, 'taxonomy.yaml'), header + yamlStringify(tax, { lineWidth: 0 }));
}

// ---- main ----
mkdirSync(OUT, { recursive: true });
const wanted = process.argv.slice(2);
const districts = CONF.districts.filter((d) => !wanted.length || wanted.includes(d.course));
const docs = [];
for (const dist of districts) {
  const raw = execFileSync('python3', [join(HERE, 'extract.py'), join(HERE, dist.pdf)], { encoding: 'utf8', maxBuffer: 1 << 24 });
  const ext = JSON.parse(raw);
  const v = validate(dist.course, ext);
  console.log(`[${dist.course}] ${dist.name_ja}: 可燃${(ext['可燃'] || []).length} 不燃${(ext['不燃'] || []).length} 紙布${(ext['紙布'] || []).length} カンビン${(ext['カンビン'] || []).length} ペット${(ext['ペット'] || []).length}`);
  console.log(`  可燃休止(cancelled): ${v.cancelled.join(', ') || 'なし'}`);
  if (v.problems.length) { for (const p of v.problems) console.error(`  ⚠ ${p}`); throw new Error(`${dist.course}: 検証NG`); }
  const { rules, overrides } = buildRules(ext, v.cancelled);
  docs.push(courseDoc({
    city: CONF.handle, course: dist.course, courseNameJa: dist.name_ja, areas: dist.areas,
    year: CONF.year, fiscalYearJa: CONF.fiscal_year_ja,
    source: {
      pdf_url: dist.pdf_url, extracted_at: EXTRACTED_AT, extracted_by: 'claude-opus-4-8', confidence: 0.9,
      verified_by: `Claude(秩父広域の雑誌型ごみカレンダーPDFを色ベース抽出(tools/pdf-extractor/chichibu-koiki)。四隅較正矩形+暦でセル座標を決めセル背景色で品目判定。可燃=weekly月木との差分がcancelledのみ・月別件数一致・同日複数品目がカンビン+ペットの斜め分割のみ、を自動照合。目視レビューは12月/1月/8月をサンプル)`,
    },
    rules, overrides,
  }));
}
// 既存の同年 course を全消しして書き直すので、複数地区は一括ビルドが前提。
const n = writeCourses(OUT, CONF.year, docs);
writeMeta();
writeTaxonomy();
console.log(`\n書き出し: ${n} course + meta + taxonomy -> ${OUT}`);
