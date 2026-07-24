import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stringify as yamlStringify } from 'yaml';
import { parseTables, parseWeekly, parseMonthlyNth } from './parse.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '../../../municipalities/kanagawa/kawasaki');
const EXTRACTED_AT = process.env.EXTRACTED_AT || '2026-07-17'; // Date.now() 不使用

const PDF_BASE = 'https://www.city.kawasaki.jp/300/cmsfiles/contents/0000012';
// ページ→区。ページ内の table.per100 は区順で並ぶ。cover は照合に使った区別 PDF。
const PAGES = [
  {
    file: 'kawasaki.html',
    url: 'https://www.city.kawasaki.jp/300/page/0000012570.html',
    wards: [{ ja: '川崎区', romaji: 'kawasaki', pdf: '12570/kawasaki(R8).pdf' }],
  },
  {
    file: 'saiwai-nakahara.html',
    url: 'https://www.city.kawasaki.jp/300/page/0000012568.html',
    wards: [
      { ja: '幸区', romaji: 'saiwai', pdf: '12568/saiwai(R8).pdf' },
      { ja: '中原区', romaji: 'nakahara', pdf: '12568/nakahara(8).pdf' },
    ],
  },
  {
    file: 'takatsu-miyamae.html',
    url: 'https://www.city.kawasaki.jp/300/page/0000012561.html',
    wards: [
      { ja: '高津区', romaji: 'takatsu', pdf: '12561/takatsumiyamae(R8).pdf' },
      { ja: '宮前区', romaji: 'miyamae', pdf: '12561/takatsumiyamae(R8).pdf' },
    ],
  },
  {
    file: 'tama-asao.html',
    url: 'https://www.city.kawasaki.jp/300/page/0000012577.html',
    wards: [
      { ja: '多摩区', romaji: 'tama', pdf: '12577/tamaaso(8).pdf' },
      { ja: '麻生区', romaji: 'asao', pdf: '12577/tamaaso(8).pdf' },
    ],
  },
];

// 1行 → rules。空き缶等の4種は同日 (days 配列を共有し YAML アンカーで同日を明示)。粗大は申込制なので metal のみ。
function rowToRules(row) {
  const can = parseWeekly(row.canEtc); // 空き缶・ペットボトル・空きびん・使用済み乾電池 同日
  const mk = parseMonthlyNth(row.sodaiKanamono);
  return [
    { category: 'burnable', pattern: 'weekly', days: parseWeekly(row.futsu) },
    { category: 'beverage_can', pattern: 'weekly', days: can },
    { category: 'pet_bottle', pattern: 'weekly', days: can },
    { category: 'glass_bottle', pattern: 'weekly', days: can },
    { category: 'hazardous', pattern: 'weekly', days: can },
    { category: 'paper', pattern: 'weekly', days: parseWeekly(row.mixPaper) },
    { category: 'plastic', pattern: 'weekly', days: parseWeekly(row.plastic) },
    { category: 'metal', pattern: 'monthly_nth', occurrences: mk.occurrences, days: mk.days },
  ];
}

const signatureKey = (rules) =>
  rules.map((r) => `${r.category}:${(r.days || []).join('')}:${(r.occurrences || []).join('')}`).join('|');

// 年末年始: 休みは 1/1〜1/3 のみ (12/31 は収集)。当該 rules で収集が発生する日だけ cancelled。
const DAY_TO_INDEX = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };
const YEAR_END = ['2027-01-01', '2027-01-02', '2027-01-03'];
function yearEndOverrides(rules) {
  const out = [];
  for (const iso of YEAR_END) {
    const d = new Date(iso + 'T00:00:00');
    const dow = d.getDay();
    const occ = Math.floor((d.getDate() - 1) / 7) + 1;
    const collects = rules.some((r) =>
      (r.days || []).some((x) => DAY_TO_INDEX[x] === dow) &&
      (r.pattern === 'weekly' || (r.pattern === 'monthly_nth' && r.occurrences.includes(occ))));
    if (collects) out.push({ date: iso, cancelled: true, note: '年末年始休止(1/1〜1/3)' });
  }
  return out;
}

// 1) 全行を区ごとに収集し、区またぎ同名を検出
// ABR 町字マスター (fetch-yomi.mjs で取得) で yomi・machiaza_id を付与 (横浜と同型)。
let ABR = null;
try { ABR = JSON.parse(readFileSync(join(HERE, 'cache', 'abr-town.json'), 'utf8')).towns; }
catch { throw new Error('cache/abr-town.json がありません。node fetch-yomi.mjs を先に実行'); }
const abrByOaza = new Map();
for (const t of ABR) {
  for (const k of [t.oaza, t.oaza.replace(/ケ/g, 'ヶ'), t.oaza.replace(/ヶ/g, 'ケ'), t.oaza.replace(/が/g, 'ヶ')]) {
    if (!abrByOaza.has(k)) abrByOaza.set(k, []);
    abrByOaza.get(k).push(t);
  }
}
let KENALL = {};
try { KENALL = JSON.parse(readFileSync(join(HERE, 'cache', 'kenall-town.json'), 'utf8')); } catch { /* 未配置は許容 */ }
function abrOf(base, chome, wardJa) {
  const b = base.normalize('NFKC');
  let rows = abrByOaza.get(b) ?? abrByOaza.get(b.replace(/ケ/g, 'ヶ')) ?? abrByOaza.get(b.replace(/が/g, 'ヶ')) ?? [];
  rows = rows.filter((t) => t.ward === wardJa);
  rows = [...new Map(rows.map((t) => [`${t.lg}-${t.id}`, t])).values()];
  const pick = chome !== null ? rows.filter((t) => t.chome_number === chome) : rows.filter((t) => t.chome_number === null);
  if (pick.length === 1) return { yomi: pick[0].kana ?? undefined, machiazaId: `${pick[0].lg}-${pick[0].id}` };
  const oaza = rows.filter((t) => t.chome_number === null);
  const kanas = new Set(oaza.map((t) => t.kana).filter(Boolean));
  if (kanas.size === 1) return { yomi: [...kanas][0], machiazaId: undefined };
  const kk = KENALL[base] ?? KENALL[base.replace(/ヶ/g, 'ケ')] ?? KENALL[base.replace(/ケ/g, 'ヶ')];
  if (kk) return { yomi: kk, machiazaId: undefined };
  return {};
}
// 町名セル → [{name, base, chome}]。川崎は素の町名主体で、丁目まとめ (古市場1・2丁目・小倉1〜5丁目) のみ展開。
function expandTown(town) {
  const s = town.normalize('NFKC').replace(/~/g, '〜');
  const m = s.match(/^(.+?)(\d+(?:[・〜]\d+)+)丁目$/);
  if (m) {
    const cs = [];
    for (const p of m[2].split('・')) {
      const r = p.match(/^(\d+)〜(\d+)$/);
      if (r) { for (let x = +r[1]; x <= +r[2]; x++) cs.push(x); } else cs.push(+p);
    }
    return cs.map((c) => ({ name: `${m[1]}${c}丁目`, base: m[1], chome: c }));
  }
  const s1 = s.match(/^(.+?)(\d+)丁目$/);
  if (s1) return [{ name: town, base: s1[1], chome: +s1[2] }];
  return [{ name: town, base: s.replace(/（.*/, ''), chome: null }];
}
const yomiStat = { total: 0, abr: 0, id: 0 };

const wardRows = []; // { ward, url, rows:[{row, town}] }
const townWards = new Map(); // base -> Set(ward.ja)
for (const page of PAGES) {
  const tables = parseTables(readFileSync(join(HERE, 'cache', page.file), 'utf8'));
  if (tables.length !== page.wards.length)
    throw new Error(`${page.file}: table数 ${tables.length} != 区数 ${page.wards.length}`);
  page.wards.forEach((ward, i) => {
    const rows = tables[i];
    wardRows.push({ ward, url: page.url, rows });
    for (const r of rows) {
      const base = expandTown(r.town)[0].base;
      if (!townWards.has(base)) townWards.set(base, new Set());
      townWards.get(base).add(ward.ja);
    }
  });
}
const isDup = (base) => (townWards.get(base)?.size ?? 0) > 1; // 区をまたぐ同名のみ曖昧性解消

// 2) 区ごとにシグネチャで畳み込み → コース
rmSync(join(OUT, '2026'), { recursive: true, force: true });
mkdirSync(join(OUT, '2026'), { recursive: true });
let totalCourses = 0;
const summary = [];
for (const { ward, url, rows } of wardRows) {
  const bySig = new Map(); // sig -> { rules, areas:[] }
  for (const row of rows) {
    const rules = rowToRules(row);
    const sig = signatureKey(rules);
    if (!bySig.has(sig)) bySig.set(sig, { rules, areas: [] });
    for (const a of expandTown(row.town)) {
      const name = isDup(a.base) ? `${a.name}（${ward.ja}）` : a.name;
      const { yomi, machiazaId } = abrOf(a.base, a.chome, ward.ja);
      yomiStat.total++;
      if (yomi) yomiStat.abr++;
      if (machiazaId) yomiStat.id++;
      bySig.get(sig).areas.push({
        name,
        yomi: yomi ?? row.kana, // ABR/ken_all に無ければ公式表の五十音マーカ (初字)
        ...(machiazaId ? { machiaza_id: machiazaId } : {}),
      });
    }
  }
  for (const v of bySig.values())
    v.areas = [...new Map(v.areas.map((a) => [a.name, a])).values()];
  const sigs = [...bySig.keys()].sort();
  sigs.forEach((sig, i) => {
    const n = i + 1;
    const { rules, areas } = bySig.get(sig);
    const course = `${ward.romaji}-${n}`;
    const doc = {
      metadata: {
        city: 'kawasaki',
        course,
        areas, // 公式表の掲載 (五十音) 順を保持
        year: 2026,
        fiscal_year_ja: '令和8年度',
        source: {
          source_url: url,
          cover_pdf_url: `${PDF_BASE}/${ward.pdf}`,
          extracted_at: EXTRACTED_AT,
          extracted_by: 'claude-opus-4-8',
          verified_by:
            'Claude(川崎市公式「収集日一覧」HTML表の機械変換。区別カバーPDFと全町名×5種別の曜日照合、不一致なし。日付入り年間カレンダーは市非公開のため日付レベルの独立照合は不可)',
        },
      },
      rules,
      overrides: yearEndOverrides(rules),
    };
    writeFileSync(join(OUT, '2026', `course-${course}.yaml`), yamlStringify(doc, { lineWidth: 0 }));
  });
  totalCourses += sigs.length;
  summary.push(`${ward.ja} (${ward.romaji}): ${rows.length}町名 → ${sigs.length}コース`);
}
console.log(summary.join('\n'));
console.log(`generated ${totalCourses} courses (7区)`);
