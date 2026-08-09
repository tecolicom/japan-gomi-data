// 秩父広域: extract.py (色ベース) が出した {品目:[日付...]} から course YAML を生成する。
// 収集頻度・曜日は地区で異なる(可燃=月木/火金/…、太田部は少頻度)ため、パターンは固定せず
// 各品目の実日付から導出する: weekly が綺麗に当てはまれば weekly+cancelled override、
// 当てはまらなければ monthly_specific(実日付)。導出後に再展開して抽出結果と完全一致することを
// 自己検証してから採用する(不一致なら monthly_specific にフォールバック)。
// カンビンは glass_bottle+beverage_can に分ける(config.item_category)。
// config は複数自治体(秩父市・横瀬町…、同一組合の同一テンプレート)を municipalities で保持。
// 使い方: EXTRACTED_AT=YYYY-MM-DD node build.mjs [handle ...]   (省略時は全自治体)
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { stringify as yamlStringify } from 'yaml';
import { courseDoc, writeCourses } from '../../_lib/emit.mjs';
import { parsePeriod } from '../../_lib/schedule.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CONF = JSON.parse(readFileSync(join(HERE, 'config.json'), 'utf8'));
const outDir = (handle) => join(HERE, '..', '..', '..', 'municipalities', 'saitama', handle);
const EXTRACTED_AT = process.env.EXTRACTED_AT || (() => { throw new Error('EXTRACTED_AT env 必須'); })();

const DOW = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
const parseUTC = (s) => new Date(`${s}T00:00:00Z`);
const iso = (d) => d.toISOString().slice(0, 10);
const CAT_ORDER = ['burnable', 'non_burnable', 'paper_cloth', 'glass_bottle', 'beverage_can', 'pet_bottle'];
const catRank = (c) => { const i = CAT_ORDER.indexOf(c); return i < 0 ? 99 : i; };
const ym = (s) => s.slice(0, 7);

// 収録期間 (CONF.period) の weekly[dowSet] 展開。会計年度を決め打ちしない
function weeklyExpand(period, dowSet) {
  const { from, to } = parsePeriod(period);
  const [ty, tm] = to.split('-').map(Number);
  const last = iso(new Date(Date.UTC(tm === 12 ? ty + 1 : ty, tm % 12, 0)));
  const out = [];
  for (let d = parseUTC(`${from}-01`); d <= parseUTC(last); d.setUTCDate(d.getUTCDate() + 1))
    if (dowSet.has(d.getUTCDay())) out.push(iso(d));
  return out;
}

// 実日付から規則を1つ導出する。weekly が当てはまれば {pattern:weekly,days} + cancelled、
// 当てはまらなければ {pattern:monthly_specific,dates}。extra(規則外の実日付)がゼロの時だけ
// weekly を採用するので、規則の再展開は必ず実日付集合に一致する(自己検証済み)。
const WEEKLY_MIN = 40; // 通年でこの回数以上ある曜日を weekly の曜日とみなす(月2=~24は除外)
function deriveRule(dates, period) {
  const S = new Set(dates);
  const cnt = new Map();
  for (const s of dates) { const w = parseUTC(s).getUTCDay(); cnt.set(w, (cnt.get(w) || 0) + 1); }
  const days = [...cnt.entries()].filter(([, c]) => c >= WEEKLY_MIN).map(([w]) => w).sort((a, b) => a - b);
  if (days.length >= 1 && days.length <= 3) {
    const dowSet = new Set(days);
    const exp = weeklyExpand(period, dowSet);
    const expSet = new Set(exp);
    const extra = [...S].filter((d) => !expSet.has(d));
    const missing = exp.filter((d) => !S.has(d));
    if (extra.length === 0 && missing.length <= 6) // extra=0 ⇔ 再展開(exp∖missing)=S
      return { pattern: 'weekly', days: days.map((w) => DOW[w]), cancelled: missing.sort() };
  }
  return { pattern: 'monthly_specific', dates: [...S].sort(), cancelled: [] };
}

function buildRules(ext, period) {
  const rules = [];
  const overrides = [];
  for (const [item, cats] of Object.entries(CONF.item_category)) {
    const dates = ext[item] || [];
    if (!dates.length) continue;
    const r = deriveRule(dates, period);
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
function selfVerify(ext, rules, overrides, period) {
  const cancelSet = new Set(overrides.map((o) => `${o.category}|${o.date}`));
  const byCat = new Map();
  for (const r of rules) {
    const dates = r.pattern === 'weekly' ? weeklyExpand(period, new Set(r.days.map((d) => DOW.indexOf(d)))) : r.dates;
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

function writeMeta(OUT, handle, muni) {
  const meta = {
    handle, name_ja: muni.name_ja, region_ja: CONF.region_ja, code: muni.code,
    source: { index_url: muni.source_index, schedule_url: muni.source_index, yearend_url: muni.source_index },
    notes: [
      `一次ソース: ${muni.name_ja}のごみ収集カレンダー地区別PDF(${muni.source_index})。収集主体は${CONF.union_ja}。コースは地区番号(course=PDF番号に一致)。`,
      '抽出方法: PDFはInDesign製の雑誌型で文字/座標抽出が不可(pdfplumber extract_words空)。品目がセル背景色で塗り分けられていることを使い、組合共通テンプレートの各月グリッド四隅座標(extract.pyに埋め込み)から暦計算でセル座標を復元し、セル領域の色ピクセルで品目を判定する色ベース抽出(tools/pdf-extractor/chichibu-koiki)。文字も日付も読まない。斜め分割・上下2段の複数品目、6週目(最終行下半分)も網羅。',
      '種別マッピング(taxonomy.yaml と一致、語彙追加なし): 可燃ごみ(緑)=burnable / 不燃ごみ(黄)=non_burnable / 紙・布類(紫)=paper_cloth / カン・ビン(水色、同日収集)=glass_bottle+beverage_can に分解 / ペットボトル(茶)=pet_bottle。ピンクの「クリーンサンデー」「施設持込可/不可」は集積所収集でなく施設持込のため収録しない。',
      '収集頻度・曜日は地区で異なる(可燃の収集曜日が地区で違う。山間部は全品目が少頻度のことがある)。パターンは固定せず各品目の実日付から導出: 可燃はweeklyが綺麗に当てはまる地区はweekly+休止のcancelled override(年末年始等)、当てはまらない地区や不規則な品目(不燃・紙布・カン・ビン・ペット等)はmonthly_specificで実日付を転記。',
      '検証: 生成した規則(weekly/monthly_specific+override)を会計年度で再展開し、色ベース抽出の実日付集合と品目ごとに完全一致することを自己検証(build.mjs)。目視レビューはサンプル地区で実施。',
      'ライセンス: 収集日程データ自体の公開ライセンスは未確認(自治体サイト、埼玉県ODポータルに個別データセット無し)→ unknown。収集日という事実データの抽出として収録。',
    ],
  };
  writeFileSync(join(OUT, 'meta.yaml'), yamlStringify(meta, { lineWidth: 0 }));
}

function writeTaxonomy(OUT, name) {
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
  const header = `# ${name}(${CONF.union_ja})。地区別ごみカレンダーPDFの品目を正典語彙へ割り当てる(語彙追加なし)。\n`
    + '#  可燃ごみ=burnable / 不燃ごみ=non_burnable / 紙・布類=paper_cloth /\n'
    + '#  カン・ビン(同日)=glass_bottle+beverage_can / ペットボトル=pet_bottle\n';
  writeFileSync(join(OUT, 'taxonomy.yaml'), header + yamlStringify(tax, { lineWidth: 0 }));
}

function buildMunicipality(handle, muni) {
  const OUT = outDir(handle);
  mkdirSync(OUT, { recursive: true });
  const docs = [];
  for (const dist of muni.districts) {
    const raw = execFileSync('python3', [join(HERE, 'extract.py'), join(HERE, dist.pdf)], { encoding: 'utf8', maxBuffer: 1 << 24 });
    const ext = JSON.parse(raw);
    const { rules, overrides } = buildRules(ext, CONF.period);
    const problems = selfVerify(ext, rules, overrides, CONF.period);
    if (problems.length) { for (const p of problems) console.error(`  ⚠ [${handle}/${dist.course}] ${p}`); throw new Error(`${handle}/${dist.course}: 自己検証NG (規則の再展開が抽出と不一致)`); }
    const kaen = rules.find((r) => r.category === 'burnable');
    const kdesc = kaen?.pattern === 'weekly'
      ? `weekly[${kaen.days.join('')}]${overrides.some((o) => o.category === 'burnable') ? `+休止${overrides.filter((o) => o.category === 'burnable').length}` : ''}`
      : `monthly_specific(${kaen?.dates.length || 0})`;
    const dupes = {};
    for (const [item, dl] of Object.entries(ext)) for (const d of dl) (dupes[d] ||= []).push(item);
    const multi = Object.entries(dupes).filter(([, v]) => v.length > 1);
    console.log(`[${handle}/${dist.course}] ${dist.name_ja}: 可燃${(ext['可燃'] || []).length}(${kdesc}) 不燃${(ext['不燃'] || []).length} 紙布${(ext['紙布'] || []).length} カンビン${(ext['カンビン'] || []).length} ペット${(ext['ペット'] || []).length} / 同日${multi.length}件`);
    docs.push(courseDoc({
      city: handle, course: dist.course, courseNameJa: dist.name_ja, areas: dist.areas,
      period: CONF.period,
      source: {
        pdf_url: dist.pdf_url, extracted_at: EXTRACTED_AT, extracted_by: 'claude-opus-4-8', confidence: 0.9,
        verified_by: `Claude(${CONF.union_ja}の雑誌型ごみカレンダーPDFを色ベース抽出(tools/pdf-extractor/chichibu-koiki)。組合共通テンプレートの四隅座標+暦でセル座標を決めセル背景色で品目判定。実日付からweekly/monthly_specificを地区ごとに導出し、規則の再展開が抽出結果と完全一致することを自己検証。目視レビューはサンプル地区)`,
      },
      rules, overrides,
    }));
  }
  // 既存の同年 course を全消しして書き直すので、自治体単位で全地区を一括ビルドする。
  const n = writeCourses(OUT, CONF.period, docs);
  writeMeta(OUT, handle, muni);
  writeTaxonomy(OUT, muni.name_ja);
  console.log(`  -> ${n} course + meta + taxonomy: ${OUT}\n`);
}

// ---- main ----
const wanted = process.argv.slice(2);
const handles = Object.keys(CONF.municipalities).filter((h) => !wanted.length || wanted.includes(h));
if (!handles.length) throw new Error(`対象自治体なし。指定可能: ${Object.keys(CONF.municipalities).join(' ')}`);
for (const handle of handles) buildMunicipality(handle, CONF.municipalities[handle]);
