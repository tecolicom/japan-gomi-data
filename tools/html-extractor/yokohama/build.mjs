// 横浜市: cache/ の 126 サブページ → municipalities/kanagawa/yokohama/2026/course-<区>-<n>.yaml
// 収集体系は全品目 weekly の 3 スロット:
//   燃やすごみの曜日 (週2) = 燃えないごみ・電池類・スプレー缶も同日別袋
//   缶・びん・ペットボトルの曜日 (週1) = 小さな金属類も同日別袋
//   プラスチック資源の曜日 (週1)
import { readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stringify as yamlStringify } from 'yaml';
import { parsePage, cellsToSchedule } from './parse.mjs';
import { expandTown } from './areas.mjs';
import { WARDS, BASE } from './wards.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '../../../municipalities/kanagawa/yokohama');
const EXTRACTED_AT = process.env.EXTRACTED_AT || '2026-07-20'; // Date.now() 不使用

// ABR 町字マスター (fetch-yomi.mjs で取得) で yomi・machiaza_id を付与する。
// ベース町名 (expandTown の base) + 丁目番号で照合。区またぎ同名は ABR の区でも一意化する。
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
// base(大字) + chome(番号|null) + wardJa(区名) → { yomi, machiazaId } | {}
function abrOf(base, chome, wardJa) {
  const b = base.normalize('NFKC');
  let rows = abrByOaza.get(b) ?? abrByOaza.get(b.replace(/ケ/g, 'ヶ')) ?? abrByOaza.get(b.replace(/が/g, 'ヶ')) ?? [];
  rows = rows.filter((t) => t.ward === wardJa);
  const uniq = new Map(rows.map((t) => [`${t.lg}-${t.id}`, t]));
  rows = [...uniq.values()];
  const pick = chome !== null
    ? rows.filter((t) => t.chome_number === chome)
    : rows.filter((t) => t.chome_number === null);
  if (pick.length === 1) return { yomi: pick[0].kana ?? undefined, machiazaId: `${pick[0].lg}-${pick[0].id}` };
  // 丁目行が無い/複数の場合: 大字読みだけでも付ける (ID は一意でないと付けない)
  const oaza = rows.filter((t) => t.chome_number === null);
  const kanas = new Set(oaza.map((t) => t.kana).filter(Boolean));
  if (kanas.size === 1) return { yomi: [...kanas][0], machiazaId: undefined };
  return {};
}

// 収集曜日が非公開の町 (表に「◯◯事務所にお問合せください」とだけある行)。検出したら既知リストと突合。
const KNOWN_UNPUBLISHED = new Set(['平楽']); // 南区

// 年末年始: 実効休止は 12/31〜1/3 (2023-24・2025-26 の2年分の市告知から。日曜は元々収集なし)。
// 2026年度: 12/31(木)・1/1(金)・1/2(土) が収集曜日に当たるコースのみ cancelled。1/3 は日曜。
const DAY_TO_INDEX = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };
const YEAR_END = ['2026-12-31', '2027-01-01', '2027-01-02', '2027-01-03'];
function yearEndOverrides(rules) {
  const out = [];
  for (const iso of YEAR_END) {
    const dow = new Date(iso + 'T00:00:00').getDay();
    if (rules.some((r) => r.days.some((x) => DAY_TO_INDEX[x] === dow)))
      out.push({ date: iso, cancelled: true, note: '年末年始休止(12/31〜1/3)' });
  }
  return out;
}

// 1) 全区の全行を読み込み
const wardRows = []; // { ward, rows }
const townWards = new Map(); // town -> Set(ward.ja)
const allExcluded = [];
for (const ward of WARDS) {
  const files = readdirSync(join(HERE, 'cache'))
    .filter((f) => f.startsWith(`${ward.romaji}__`) && f !== `${ward.romaji}__index.html`)
    .sort();
  if (!files.length) throw new Error(`${ward.romaji}: cache にサブページが無い (node fetch.mjs を先に)`);
  const rows = [];
  for (const f of files) {
    const { rows: r, excluded } = parsePage(readFileSync(join(HERE, 'cache', f), 'utf8'));
    rows.push(...r);
    for (const e of excluded) allExcluded.push({ ward: ward.ja, ...e });
  }
  wardRows.push({ ward, rows });
  for (const r of rows) {
    const base = expandTown(r.town)[0].base; // 区またぎ判定は大字ベースで
    if (!townWards.has(base)) townWards.set(base, new Set());
    townWards.get(base).add(ward.ja);
  }
}
for (const e of allExcluded) {
  if (!KNOWN_UNPUBLISHED.has(e.town))
    throw new Error(`未知の除外行: ${e.ward} ${e.town} (${e.reason})`);
  console.log(`excluded (収集曜日非公開): ${e.ward} ${e.town}`);
}
const isDup = (base) => (townWards.get(base)?.size ?? 0) > 1; // 区をまたぐ同名のみ曖昧性解消
const yomiStat = { total: 0, abr: 0, id: 0 };

// 2) 区ごとにスケジュールシグネチャで畳み込み → コース
rmSync(join(OUT, '2026'), { recursive: true, force: true });
mkdirSync(join(OUT, '2026'), { recursive: true });
let totalCourses = 0;
let totalTowns = 0;
for (const { ward, rows } of wardRows) {
  const bySig = new Map(); // sig -> { sched, areas }
  for (const row of rows) {
    const sched = cellsToSchedule(row.cells);
    const sig = `${sched.burnable.join('')}|${sched.can}|${sched.plastic}`;
    if (!bySig.has(sig)) bySig.set(sig, { sched, areas: [] });
    // 町名セルを 1 町名 (丁目単位) へ展開し、ABR で yomi・machiaza_id を付与
    for (const a of expandTown(row.town)) {
      const dup = isDup(a.base);
      const name = dup ? `${a.name}（${ward.ja}）` : a.name;
      const { yomi, machiazaId } = abrOf(a.base, a.chome, ward.ja);
      yomiStat.total++;
      if (yomi) yomiStat.abr++;
      if (machiazaId) yomiStat.id++;
      bySig.get(sig).areas.push({
        name,
        yomi: yomi ?? row.kana, // ABR に無ければ公式表の五十音マーカ (初字) にフォールバック
        ...(machiazaId ? { machiaza_id: machiazaId } : {}),
        ...(a.note ? { note: a.note } : {}),
      });
    }
  }
  // 同一 name+note の重複 (丁目展開が既存の単一丁目と衝突) を除去
  for (const v of bySig.values()) {
    v.areas = [...new Map(v.areas.map((a) => [`${a.name}${a.note ?? ''}`, a])).values()];
  }
  // 公式表の五十音順に並べ直す (yomi は ABR 由来の完全読み優先)
  for (const { areas } of bySig.values())
    areas.sort((a, b) => a.yomi.localeCompare(b.yomi, 'ja'));
  // 番号は 燃やすごみ初日 → 缶等 → プラ の曜日順で安定させる
  const sigs = [...bySig.keys()].sort((a, b) => {
    const k = (s) => s.split('|').flatMap((p) => p.match(/../g)).map((d) => DAY_TO_INDEX[d]);
    const ka = k(a); const kb = k(b);
    for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return ka[i] - kb[i];
    return 0;
  });
  sigs.forEach((sig, i) => {
    const { sched, areas } = bySig.get(sig);
    const course = `${ward.romaji}-${i + 1}`;
    // 同日別袋の品目は days 配列を共有し YAML アンカーで同日を明示
    const burnDays = sched.burnable;
    const canDays = [sched.can];
    const rules = [
      { category: 'burnable', pattern: 'weekly', days: burnDays },
      { category: 'non_burnable', pattern: 'weekly', days: burnDays },
      { category: 'hazardous', pattern: 'weekly', days: burnDays },
      { category: 'spray_can', pattern: 'weekly', days: burnDays },
      { category: 'beverage_can', pattern: 'weekly', days: canDays },
      { category: 'glass_bottle', pattern: 'weekly', days: canDays },
      { category: 'pet_bottle', pattern: 'weekly', days: canDays },
      { category: 'metal', pattern: 'weekly', days: canDays },
      { category: 'plastic', pattern: 'weekly', days: [sched.plastic] },
    ];
    const doc = {
      metadata: {
        city: 'yokohama',
        course,
        areas, // 公式表の掲載 (五十音) 順を保持
        year: 2026,
        fiscal_year_ja: '令和8年度',
        source: {
          source_url: `${BASE}/${ward.romaji}/index.html`,
          extracted_at: EXTRACTED_AT,
          extracted_by: 'claude-fable-5',
          verified_by:
            'Claude(横浜市公式「ごみと資源の収集曜日」区別HTML表の機械変換。独立2実装・独立取得の2経路で全1,087行突合一致。青葉区は事務所版一覧画像と全町照合一致。日付入り年間カレンダーは市非公開のため日付レベルの独立照合は不可)',
        },
      },
      rules,
      overrides: yearEndOverrides(rules),
    };
    writeFileSync(join(OUT, '2026', `course-${course}.yaml`), yamlStringify(doc, { lineWidth: 0 }));
  });
  totalCourses += sigs.length;
  totalTowns += rows.length;
  console.log(`${ward.ja} (${ward.romaji}): ${rows.length}町名 → ${sigs.length}コース`);
}
console.log(`generated ${totalCourses} courses, ${totalTowns} towns (18区)`);
console.log(`yomi: ${yomiStat.abr}/${yomiStat.total} (ABR) + フォールバック${yomiStat.total-yomiStat.abr} / machiaza_id: ${yomiStat.id} (${(100*yomiStat.id/yomiStat.total).toFixed(1)}%)`);
