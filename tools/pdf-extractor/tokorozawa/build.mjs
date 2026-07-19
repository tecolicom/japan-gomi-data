// 所沢市: extract.py が出した extracted.json (町別 {isodate:[cats]}) から
// 各町の rules/overrides を機械推定し、同一日程の町をコースに畳んで course YAML を出力する。
//
// 推定方針 (通年ラウンドトリップでゼロ差分になることを構成的に保証):
//  - 町ごとに「収集が全く無い日 (NoCollectionDays)」を求める (年末年始休止は町で異なる: 12/29 or 12/30〜1/3)。
//  - 各品目 D について:
//     weekly 検定  : D == {FYでその曜日} − NoCollectionDays なら weekly
//     monthly_nth  : D == {FYでその曜日かつ第n} − NoCollectionDays なら monthly_nth
//     どちらも不成立: monthly_specific (実日付列挙)。1月は曜日ごとずれる町があり、
//                    その品目は自動的に monthly_specific に落ちる (source どおり忠実)。
//  - cancelled overrides = NoCollectionDays のうち weekly/nth が生成する日 (その日を全停止)。
// これにより monthly_specific は NoCollectionDays を生成しないので、全日で再展開 == 抽出結果。
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as yamlParse } from 'yaml';
import { DAY_TO_INDEX } from '../../_lib/jp.mjs';
import { nthOfMonth, isoDate, categoriesOn } from '../../_lib/schedule.mjs';
import { foldCourses, courseDoc, writeCourses } from '../../_lib/emit.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..', '..');
const OUTDIR = join(ROOT, 'municipalities', 'saitama', 'tokorozawa');
const FY = 2026;
const EXTRACTED_AT = process.env.EXTRACTED_AT || (() => { throw new Error('EXTRACTED_AT env 必須'); })();
const EXTRACTED_BY = 'claude-opus-4-8';

const INDEX_URL = 'https://www.city.tokorozawa.saitama.jp/kurashi/gomi/nittei/index.html';

const DOW = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
// 出力・署名の決定順 (同一日程の町が同一署名になるようカテゴリ順を固定)
const CAT_ORDER = ['burnable', 'plastic', 'pet_bottle', 'non_burnable', 'hazardous',
  'glass_bottle', 'beverage_can', 'paper', 'metal', 'paper_cloth'];
const catRank = (c) => { const i = CAT_ORDER.indexOf(c); if (i < 0) throw new Error(`未知カテゴリ ${c}`); return i; };

const extracted = JSON.parse(readFileSync(join(HERE, 'cache', 'extracted.json'), 'utf8'));
const manifest = JSON.parse(readFileSync(join(HERE, 'manifest.json'), 'utf8'));
const yomiMap = yamlParse(readFileSync(join(HERE, 'yomi.yaml'), 'utf8'));

// 会計年度の全日付 (iso)
const fyDates = [];
for (let d = new Date(FY, 3, 1); d < new Date(FY + 1, 3, 1); d = new Date(d.getTime() + 86400000)) {
  fyDates.push(isoDate(d));
}
const isoWeekday = (iso) => new Date(iso + 'T00:00:00').getDay();
const isoNth = (iso) => nthOfMonth(new Date(iso + 'T00:00:00'));
const sortDaysCanon = (days) => [...new Set(days)].sort((a, b) => DOW.indexOf(a) - DOW.indexOf(b));

// 1 町 (PDF) の抽出結果 → {rules, overrides}
function inferRules(cal) {
  // cal: {iso: [cats]}  収集日のみ
  const collectionDays = new Set(Object.keys(cal));
  const noCollection = fyDates.filter((d) => !collectionDays.has(d));
  const noCollectionSet = new Set(noCollection);
  // 品目 -> 収集日集合
  const catDates = {};
  for (const [iso, cats] of Object.entries(cal)) {
    for (const c of cats) (catDates[c] ||= []).push(iso);
  }
  const rules = [];
  for (const cat of Object.keys(catDates)) {
    const D = new Set(catDates[cat]);
    const wdays = [...new Set([...D].map(isoWeekday))].sort();
    // weekly 検定
    const genW = fyDates.filter((d) => wdays.includes(isoWeekday(d)));
    const wantW = genW.filter((d) => !noCollectionSet.has(d));
    const eqW = wantW.length === D.size && wantW.every((d) => D.has(d));
    if (eqW) {
      rules.push({ category: cat, pattern: 'weekly', days: sortDaysCanon(wdays.map((w) => DOW[w])) });
      continue;
    }
    // monthly_nth 検定 (曜日ごとの第n集合)
    const occByDay = {};
    for (const d of D) (occByDay[isoWeekday(d)] ||= new Set()).add(isoNth(d));
    const genN = fyDates.filter((d) => occByDay[isoWeekday(d)]?.has(isoNth(d)));
    const wantN = genN.filter((d) => !noCollectionSet.has(d));
    const eqN = wantN.length === D.size && wantN.every((d) => D.has(d));
    if (eqN) {
      // 同一 occ 集合の曜日をまとめて 1 rule に
      const byOcc = new Map();
      for (const w of Object.keys(occByDay).map(Number)) {
        const key = [...occByDay[w]].sort((a, b) => a - b).join(',');
        (byOcc.get(key) || byOcc.set(key, []).get(key)).push(w);
      }
      for (const [key, ws] of byOcc) {
        rules.push({
          category: cat, pattern: 'monthly_nth',
          days: sortDaysCanon(ws.map((w) => DOW[w])),
          occurrences: key.split(',').map(Number),
        });
      }
      continue;
    }
    // monthly_specific
    rules.push({ category: cat, pattern: 'monthly_specific', dates: [...D].sort() });
  }
  // 決定順ソート (同一日程 → 同一署名になるよう)
  rules.sort((a, b) =>
    catRank(a.category) - catRank(b.category) ||
    a.pattern.localeCompare(b.pattern) ||
    (a.days || []).join().localeCompare((b.days || []).join()) ||
    (a.occurrences || []).join().localeCompare((b.occurrences || []).join()));
  // cancelled overrides: NoCollectionDays のうち weekly/nth が生成する日
  const patternRules = rules.filter((r) => r.pattern !== 'monthly_specific');
  const overrides = [];
  for (const d of noCollection) {
    if (categoriesOn(new Date(d + 'T00:00:00'), patternRules, []).length) {
      overrides.push({ date: d, cancelled: true, note: '年末年始休止' });
    }
  }
  overrides.sort((a, b) => a.date.localeCompare(b.date));
  return { rules, overrides };
}

// PDF ラベル(町名) → area {name, yomi}[] (、で複数、丁目は基底名で yomi 引き)
function labelToAreas(label) {
  const parts = label.split('、').map((s) => s.trim()).filter(Boolean);
  return parts.map((name) => {
    const base = name.replace(/[一二三四五六七八九十・]+丁目$/, '');
    const yomi = yomiMap[base];
    if (!yomi) throw new Error(`yomi 不明: "${name}" (base="${base}")`);
    return { name, yomi };
  });
}

// 各 PDF を「行」として組み立てる
const rows = manifest.map(({ file, url, label }) => {
  const cal = extracted[file];
  if (!cal || !Object.keys(cal).length) throw new Error(`抽出結果なし: ${file}`);
  const { rules, overrides } = inferRules(cal);
  return { file, url, label, rules, overrides, areas: labelToAreas(label) };
});

// 同一 rules の町を 1 コースに畳む (overrides も含めて署名一致を確認)
import { signatureKey } from '../../_lib/schedule.mjs';
const sigOf = (row) => signatureKey(row.rules) + '#' + row.overrides.map((o) => o.date).join(',');
const byCourse = new Map();
for (const row of rows) {
  const sig = sigOf(row);
  if (!byCourse.has(sig)) byCourse.set(sig, { rules: row.rules, overrides: row.overrides, areas: [], files: [] });
  const c = byCourse.get(sig);
  c.areas.push(...row.areas);
  c.files.push(row.file);
}

const courses = [...byCourse.values()];
// コース slug: 出現順の連番
const docs = courses.map((c, i) => {
  const n = i + 1;
  return courseDoc({
    city: 'tokorozawa',
    course: String(n),
    courseNameJa: undefined,
    areas: c.areas,
    year: FY,
    fiscalYearJa: '令和8年度',
    source: {
      index_url: INDEX_URL,
      pdf_url: manifest.find((m) => m.file === c.files[0]).url,
      extracted_at: EXTRACTED_AT,
      extracted_by: EXTRACTED_BY,
      verified_by: 'Claude(所沢市 地区別収集カレンダーPDF群の機械抽出。日付入り通年カレンダーとcategoriesOn再展開で全日照合し完全一致)',
    },
    rules: c.rules,
    overrides: c.overrides,
  });
});

// courseDoc は source を metadata.source にそのまま入れるが、schema は
// index_url を許さない。source は pdf_url/extracted_* のみへ整形する。
for (const doc of docs) {
  const s = doc.metadata.source;
  doc.metadata.source = {
    pdf_url: s.pdf_url,
    extracted_at: s.extracted_at,
    extracted_by: s.extracted_by,
    verified_by: s.verified_by,
  };
}

const written = writeCourses(OUTDIR, FY, docs);
console.log(`courses: ${written}  (from ${rows.length} PDFs, ${rows.reduce((a, r) => a + r.areas.length, 0)} areas)`);
// コース内訳
docs.forEach((d) => console.log(`  course-${d.metadata.course}: ${d.metadata.areas.length} areas  [${d.metadata.areas.map((a) => a.name).join(', ')}]`));
