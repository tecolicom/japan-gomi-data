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
import { parseTown } from './areas.mjs';
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
// base(大字) + chomes(構成丁目のリスト、丁目なしは []) + wardJa(区名)
//   → { yomi, machiazaIds }。丁目まとめは各丁目の ID をリストで返す。
function abrOf(base, chomes, wardJa) {
  const b = base.normalize('NFKC');
  let rows = abrByOaza.get(b) ?? abrByOaza.get(b.replace(/ケ/g, 'ヶ')) ?? abrByOaza.get(b.replace(/が/g, 'ヶ')) ?? [];
  rows = rows.filter((t) => t.ward === wardJa);
  rows = [...new Map(rows.map((t) => [`${t.lg}-${t.id}`, t])).values()];
  // 大字読み (丁目まとめでも読みは大字を使う。無ければ丁目行の読みから大字部を採る)
  const oaza = rows.filter((t) => t.chome_number === null);
  let yomi = new Set(oaza.map((t) => t.kana).filter(Boolean)).size === 1 ? oaza.find((t) => t.kana).kana : undefined;
  if (!yomi) yomi = KENALL[base] ?? KENALL[base.replace(/ヶ/g, 'ケ')] ?? KENALL[base.replace(/ケ/g, 'ヶ')];
  if (chomes.length === 0) {
    // 素の大字: 大字行が一意なら ID も付ける
    if (oaza.length === 1) return { yomi: oaza[0].kana ?? yomi, machiazaIds: [`${oaza[0].lg}-${oaza[0].id}`] };
    return { yomi, machiazaIds: undefined };
  }
  // 丁目まとめ/単一丁目: 各構成丁目の行が一意に取れた分だけ ID をリスト化
  const ids = [];
  for (const c of chomes) {
    const p = rows.filter((t) => t.chome_number === c);
    if (p.length === 1) ids.push(`${p[0].lg}-${p[0].id}`);
  }
  // 丁目行の読みからも yomi を補える (大字読みが無い場合)
  if (!yomi) {
    const anyChome = rows.find((t) => chomes.includes(t.chome_number) && t.kana);
    if (anyChome) yomi = anyChome.kana.replace(/[0-9１-９]+ちょうめ$/, '');
  }
  return { yomi, machiazaIds: ids.length ? ids : undefined };
}
let KENALL = {};
try { KENALL = JSON.parse(readFileSync(join(HERE, 'cache', 'kenall-town.json'), 'utf8')); } catch { /* ken_all 未配置は許容 */ }

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
    const base = parseTown(r.town).base; // 区またぎ判定は大字ベースで
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
const allDocs = [];
for (const { ward, rows } of wardRows) {
  const bySig = new Map(); // sig -> { sched, areas }
  for (const row of rows) {
    const sched = cellsToSchedule(row.cells);
    const sig = `${sched.burnable.join('')}|${sched.can}|${sched.plastic}`;
    if (!bySig.has(sig)) bySig.set(sig, { sched, areas: [] });
    // 町名セルを 1 area にパースし (丁目まとめは展開せず)、ABR で yomi・machiaza_id を付与
    const a = parseTown(row.town);
    const name = isDup(a.base) ? `${a.name}（${ward.ja}）` : a.name;
    const { yomi, machiazaIds } = abrOf(a.base, a.chomes, ward.ja);
    yomiStat.total++;
    if (yomi) yomiStat.abr++;
    if (machiazaIds) yomiStat.id++;
    bySig.get(sig).areas.push({
      name,
      yomi: yomi ?? row.kana, // ABR/ken_all に無ければ公式表の五十音マーカ (初字)
      ...(machiazaIds ? { machiaza_id: machiazaIds } : {}),
      ...(a.note ? { note: a.note } : {}),
    });
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
    allDocs.push({ path: join(OUT, '2026', `course-${course}.yaml`), doc });
  });
  totalCourses += sigs.length;
  totalTowns += rows.length;
  console.log(`${ward.ja} (${ward.romaji}): ${rows.length}町名 → ${sigs.length}コース`);
}

// 割れ町 (同一 name が複数コースに存在) は note の判別子を name に昇格し「町名（判別子）」に
// (岡山・倉敷と統一。name 単独で地域特定できるように)。昇格行の note は外す。判別 note 無しは警告。
{
  const nameCount = new Map();
  for (const { doc } of allDocs) for (const a of doc.metadata.areas) nameCount.set(a.name, (nameCount.get(a.name) ?? 0) + 1);
  // 割れ name の note を判別子として name に昇格。note は整形する:
  // 外側括弧の除去 (二重括弧防止)・先頭の町名繰り返し除去 (笹下1丁目「笹下1丁目10の一部…」→「10の一部…」)。
  for (const { doc } of allDocs) {
    doc.metadata.areas = doc.metadata.areas.map((a) => {
      if (!((nameCount.get(a.name) ?? 0) > 1 && a.note)) return a;
      const { note, ...rest } = a;
      let nc = note.replace(/^（(.+)）$/, '$1').trim();
      if (nc.startsWith(a.name)) nc = nc.slice(a.name.length).trim();
      return { ...rest, name: nc ? `${a.name}（${nc}）` : a.name };
    });
  }
  // 昇格後に再カウントし、まだ同一 name が複数コースに残る = 真に判別不能な割れのみ警告
  const after = new Map();
  for (const { doc } of allDocs) for (const a of doc.metadata.areas) {
    if (!after.has(a.name)) after.set(a.name, new Set());
    after.get(a.name).add(doc.metadata.course);
  }
  const dup = [...after].filter(([, cs]) => cs.size > 1).map(([n]) => n);
  if (dup.length) console.log(`  警告: 昇格後も判別不能な割れ (原文に番地等の区別が無い): ${dup.join('、')}`);
}
for (const { path, doc } of allDocs) writeFileSync(path, yamlStringify(doc, { lineWidth: 0 }));
console.log(`generated ${totalCourses} courses, ${totalTowns} towns (18区)`);
console.log(`yomi: ${yomiStat.abr}/${yomiStat.total} (ABR) + フォールバック${yomiStat.total-yomiStat.abr} / machiaza_id: ${yomiStat.id} (${(100*yomiStat.id/yomiStat.total).toFixed(1)}%)`);
