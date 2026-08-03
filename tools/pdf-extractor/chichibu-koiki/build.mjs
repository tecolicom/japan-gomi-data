// 秩父広域: extract.py (色ベース) が出した {品目:[日付...]} から course YAML を生成する。
// 収集頻度・曜日は地区で異なる(可燃=月木/火金/…、太田部は少頻度)ため、パターンは固定せず
// 各品目の実日付から導出する: weekly が綺麗に当てはまれば weekly+cancelled override、
// 当てはまらなければ monthly_specific(実日付)。導出後に再展開して抽出結果と完全一致することを
// 自己検証してから採用する(不一致なら monthly_specific にフォールバック)。
// カンビンは glass_bottle+beverage_can に分ける(config.item_category)。
// build 時の点検: 品目カバレッジ・同日複数品目(斜め分割)を報告。
// 使い方: EXTRACTED_AT=YYYY-MM-DD node build.mjs [course...]   (省略時は config の全地区)
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { stringify as yamlStringify } from 'yaml';
import { courseDoc, writeCourses } from '../../_lib/emit.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CONF = JSON.parse(readFileSync(join(HERE, 'config.json'), 'utf8'));
const OUT = join(HERE, '..', '..', '..', 'municipalities', 'saitama', CONF.handle);
const EXTRACTED_AT = process.env.EXTRACTED_AT || (() => { throw new Error('EXTRACTED_AT env 必須'); })();

const DOW = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
const parseUTC = (s) => new Date(`${s}T00:00:00Z`);
const iso = (d) => d.toISOString().slice(0, 10);
const CAT_ORDER = ['burnable', 'non_burnable', 'paper_cloth', 'glass_bottle', 'beverage_can', 'pet_bottle'];
const catRank = (c) => { const i = CAT_ORDER.indexOf(c); return i < 0 ? 99 : i; };
const ym = (s) => s.slice(0, 7);

// 会計年度 4/1..翌3/31 の weekly[dowSet] 展開
function weeklyExpand(year, dowSet) {
  const out = [];
  for (let d = parseUTC(`${year}-04-01`); d <= parseUTC(`${year + 1}-03-31`); d.setUTCDate(d.getUTCDate() + 1))
    if (dowSet.has(d.getUTCDay())) out.push(iso(d));
  return out;
}

// 実日付から規則を1つ導出する。weekly が当てはまれば {pattern:weekly,days} + cancelled、
// 当てはまらなければ {pattern:monthly_specific,dates}。extra(規則外の実日付)がゼロの時だけ
// weekly を採用するので、規則の再展開は必ず実日付集合に一致する(自己検証済み)。
const WEEKLY_MIN = 40; // 通年でこの回数以上ある曜日を weekly の曜日とみなす(月2=~24は除外)
function deriveRule(dates, year) {
  const S = new Set(dates);
  const cnt = new Map();
  for (const s of dates) { const w = parseUTC(s).getUTCDay(); cnt.set(w, (cnt.get(w) || 0) + 1); }
  const days = [...cnt.entries()].filter(([, c]) => c >= WEEKLY_MIN).map(([w]) => w).sort((a, b) => a - b);
  if (days.length >= 1 && days.length <= 3) {
    const dowSet = new Set(days);
    const exp = weeklyExpand(year, dowSet);
    const expSet = new Set(exp);
    const extra = [...S].filter((d) => !expSet.has(d));
    const missing = exp.filter((d) => !S.has(d));
    if (extra.length === 0 && missing.length <= 6) // extra=0 ⇔ 再展開(exp∖missing)=S
      return { pattern: 'weekly', days: days.map((w) => DOW[w]), cancelled: missing.sort() };
  }
  return { pattern: 'monthly_specific', dates: [...S].sort(), cancelled: [] };
}

function buildRules(ext, year) {
  const rules = [];
  const overrides = [];
  for (const [item, cats] of Object.entries(CONF.item_category)) {
    const dates = ext[item] || [];
    if (!dates.length) continue;
    const r = deriveRule(dates, year);
    for (const cat of cats) {
      if (r.pattern === 'weekly') {
        rules.push({ category: cat, pattern: 'weekly', days: r.days });
        for (const date of r.cancelled) overrides.push({ date, category: cat, cancelled: true });
      } else {
        rules.push({ category: cat, pattern: 'monthly_specific', dates: r.dates });
      }
    }
  }
  rules.sort((a, b) => catRank(a.category) - catRank(b.category));
  overrides.sort((a, b) => a.date.localeCompare(b.date) || catRank(a.category) - catRank(b.category));
  return { rules, overrides };
}

// 生成した rules+overrides を再展開して、抽出の実日付集合と品目カテゴリごとに一致するか検証する。
function selfVerify(ext, rules, overrides, year) {
  const cancelSet = new Set(overrides.map((o) => `${o.category}|${o.date}`));
  const byCat = new Map();
  for (const r of rules) {
    const dates = r.pattern === 'weekly' ? weeklyExpand(year, new Set(r.days.map((d) => DOW.indexOf(d)))) : r.dates;
    const kept = dates.filter((d) => !cancelSet.has(`${r.category}|${d}`));
    if (!byCat.has(r.category)) byCat.set(r.category, new Set());
    for (const d of kept) byCat.get(r.category).add(d);
  }
  const problems = [];
  for (const [item, cats] of Object.entries(CONF.item_category)) {
    const want = new Set(ext[item] || []);
    for (const cat of cats) {
      const got = byCat.get(cat) || new Set();
      const miss = [...want].filter((d) => !got.has(d));
      const ext2 = [...got].filter((d) => !want.has(d));
      if (miss.length || ext2.length)
        problems.push(`${item}->${cat}: 欠落${miss.length}(${miss.slice(0, 3)}) 余分${ext2.length}(${ext2.slice(0, 3)})`);
    }
  }
  return problems;
}

function writeMeta() {
  const meta = {
    handle: CONF.handle, name_ja: CONF.name_ja, region_ja: CONF.region_ja, code: CONF.code,
    source: { index_url: CONF.source_index, schedule_url: CONF.source_index, yearend_url: CONF.source_index },
    notes: [
      '一次ソース: 秩父市公式「家庭ごみ収集カレンダー」(city.chichibu.lg.jp/9098.html)の地区別PDF。収集主体は秩父広域市町村圏組合(秩父市・横瀬町・皆野町・長瀞町・小鹿野町の5市町共同)、日程管理は秩父市生活衛生課。地区は町名対応で全43分割、コースは地区番号(course=01〜43、PDF番号に一致)。',
      '抽出方法: PDFはInDesign製の雑誌型で文字/座標抽出が不可(pdfplumber extract_words空)。品目がセル背景色で塗り分けられていることを使い、全PDF共通テンプレートの各月グリッド四隅座標(01日野田町の矩形注釈から確定しextract.pyに埋め込み)から暦計算でセル座標を復元し、セル領域の色ピクセルで品目を判定する色ベース抽出(tools/pdf-extractor/chichibu-koiki)。文字も日付も読まない。斜め分割・上下2段の複数品目、6週目(最終行下半分)も網羅。',
      '種別マッピング(taxonomy.yaml と一致、語彙追加なし): 可燃ごみ(緑)=burnable / 不燃ごみ(黄)=non_burnable / 紙・布類(紫)=paper_cloth / カン・ビン(水色、同日収集)=glass_bottle+beverage_can に分解 / ペットボトル(茶)=pet_bottle。ピンクの「クリーンサンデー」「施設持込可/不可」は集積所収集でなく施設持込のため収録しない。',
      '収集頻度・曜日は地区で異なる(可燃=日野田町は月・木、上宮地町は火・金など。太田部は全品目が少頻度で可燃も月2)。パターンは固定せず各品目の実日付から導出: 可燃はweeklyが綺麗に当てはまる地区はweekly+休止のcancelled override(例:日野田町は12/03休止、12/31は可燃あり)、当てはまらない地区や不規則な品目(不燃・紙布・カン・ビン・ペット等)はmonthly_specificで実日付を転記。',
      '検証: 生成した規則(weekly/monthly_specific+override)を会計年度で再展開し、色ベース抽出の実日付集合と品目ごとに完全一致することを自己検証(build.mjs)。目視レビューは日野田町(全12ヶ月)+上宮地町・太田部(サンプル)。',
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
  const { rules, overrides } = buildRules(ext, CONF.year);
  const problems = selfVerify(ext, rules, overrides, CONF.year);
  if (problems.length) { for (const p of problems) console.error(`  ⚠ [${dist.course}] ${p}`); throw new Error(`${dist.course}: 自己検証NG (規則の再展開が抽出と不一致)`); }
  // 表示: 品目件数 + 可燃の導出結果 + 同日複数品目
  const kaen = rules.find((r) => r.category === 'burnable');
  const kdesc = kaen?.pattern === 'weekly'
    ? `weekly[${kaen.days.join('')}]${overrides.some((o) => o.category === 'burnable') ? `+休止${overrides.filter((o) => o.category === 'burnable').length}` : ''}`
    : `monthly_specific(${kaen?.dates.length || 0})`;
  const dupes = {};
  for (const [item, dl] of Object.entries(ext)) for (const d of dl) (dupes[d] ||= []).push(item);
  const multi = Object.entries(dupes).filter(([, v]) => v.length > 1);
  console.log(`[${dist.course}] ${dist.name_ja}: 可燃${(ext['可燃'] || []).length}(${kdesc}) 不燃${(ext['不燃'] || []).length} 紙布${(ext['紙布'] || []).length} カンビン${(ext['カンビン'] || []).length} ペット${(ext['ペット'] || []).length} / 同日${multi.length}件`);
  docs.push(courseDoc({
    city: CONF.handle, course: dist.course, courseNameJa: dist.name_ja, areas: dist.areas,
    year: CONF.year, fiscalYearJa: CONF.fiscal_year_ja,
    source: {
      pdf_url: dist.pdf_url, extracted_at: EXTRACTED_AT, extracted_by: 'claude-opus-4-8', confidence: 0.9,
      verified_by: 'Claude(秩父広域の雑誌型ごみカレンダーPDFを色ベース抽出(tools/pdf-extractor/chichibu-koiki)。全PDF共通テンプレートの四隅座標+暦でセル座標を決めセル背景色で品目判定。実日付からweekly/monthly_specificを地区ごとに導出し、規則の再展開が抽出結果と完全一致することを自己検証。目視レビューは日野田町(全月)+上宮地町/太田部(サンプル))',
    },
    rules, overrides,
  }));
}
// 既存の同年 course を全消しして書き直すので、複数地区は一括ビルドが前提。
const n = writeCourses(OUT, CONF.year, docs);
writeMeta();
writeTaxonomy();
console.log(`\n書き出し: ${n} course + meta + taxonomy -> ${OUT}`);
