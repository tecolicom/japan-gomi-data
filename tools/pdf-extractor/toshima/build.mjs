// 豊島区: 外国語版リーフレット p2 の「曜日一覧」→ course YAML。
//
// meta.yaml / taxonomy.yaml は生成しない (手書きが正典)。ここが書くのは course-*.yaml だけ。
//
// 使い方: node fetch.mjs && EXTRACTED_AT=YYYY-MM-DD node build.mjs
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { findPython } from '../../_lib/python.mjs';
import { foldCourses, courseDoc, writeCourses } from '../../_lib/emit.mjs';
import { expandRange, periodDates, nthOfMonth } from '../../_lib/schedule.mjs';
import { DAY_TO_INDEX } from '../../_lib/jp.mjs';
import { splitAreas, areaYomi, cellsToRules, overlapCount, banchiItems, bareOverlaps } from './parse.mjs';
import { PRIMARY, PERIOD, EDITION_JA, LG_CODE, CAT_ORDER, COLUMNS } from './sources.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CACHE = join(HERE, 'cache');
const OUTDIR = join(HERE, '../../../municipalities/tokyo/toshima');

const EXTRACTED_AT = process.env.EXTRACTED_AT;
if (!EXTRACTED_AT) throw new Error('EXTRACTED_AT を環境変数で渡す (Date.now は使わない)');

const py = findPython(['pdfplumber']);
const records = JSON.parse(execFileSync(py, [
  join(HERE, 'extract.py'), join(CACHE, PRIMARY.file), '--name-x-max', String(PRIMARY.nameXMax),
], { encoding: 'utf8', maxBuffer: 32 << 20 })).records;

// ---- ABR 町字マスターで読みと町字IDを引く ----

const abr = JSON.parse(readFileSync(join(CACHE, 'abr-town.json'), 'utf8')).towns;
const kanaOf = new Map();      // 町名 → かな
const idOf = new Map();        // "町名N" → machiaza_id
for (const t of abr) {
  if (t.chome_number === null) throw new Error(`ABR: 丁目の無い町字 "${t.oaza}" (豊島区は全町が丁目制の想定)`);
  if (t.kana) kanaOf.set(t.oaza, t.kana);
  idOf.set(`${t.oaza}${t.chome_number}`, t.id);
}

// ---- 行 → area ----

const rows = [];
for (const rec of records) {
  const rules = cellsToRules(rec.cells);
  for (const a of splitAreas(rec.name)) {
    const key = `${a.town}${a.chome}`;
    if (!idOf.has(key)) throw new Error(`ABR に無い丁目 "${key}" (元の行: "${rec.name}")`);
    rows.push({
      area: {
        name: a.name,
        ...(kanaOf.has(a.town) ? { yomi: areaYomi(kanaOf.get(a.town), a) } : {}),
        machiaza_id: `${LG_CODE}-${idOf.get(key)}`,
        ...(rec.section === 'downtown' ? { note: '池袋駅周辺繁華街地域' } : {}),
      },
      sortKey: `${areaYomi(kanaOf.get(a.town) ?? a.town, a)}`,
      rules,
      cells: rec.cells,
      section: rec.section,
      chomeKey: key,
    });
  }
}

// ---- 検査 1: 区の全丁目をちょうど覆っているか ----
//
// 表が ABR の 83 町字を過不足なく覆うことを確かめる。行を 1 つ落とせば足りなくなり、
// 二重に読めば余る。**表の外から数を持ってくる唯一の検査**なので効きが強い。
{
  const covered = new Set(rows.map((r) => r.chomeKey));
  const all = new Set(idOf.keys());
  const missing = [...all].filter((k) => !covered.has(k));
  const extra = [...covered].filter((k) => !all.has(k));
  if (missing.length || extra.length) {
    throw new Error(`丁目の網羅に不一致: 表に無い ${missing.join(',') || 'なし'} / ABR に無い ${extra.join(',') || 'なし'}`);
  }
  console.log(`丁目の網羅: ABR ${all.size} 件をちょうど被覆`);
}

// ---- 検査 2: 同じ丁目を分け合う行の番地が重ならないか ----
//
// 「要町1丁目1番～8番」と「要町1丁目9番～49番」のように 1 つの丁目が番地で割れる。
// 係り先を取り違えると同じ番地が 2 つのコースに現れる。
// 号や「通り沿い」で割ってある番は正当に重なるので、**どちらにも限定の無い重なり**だけを見る。
{
  const byChome = new Map();
  const unparsed = [];
  for (const rec of records) {
    for (const a of splitAreas(rec.name)) {
      if (!a.banchi) continue;
      const key = `${a.town}${a.chome}`;
      const parsed = banchiItems(a.banchi);
      for (const t of parsed.unparsed) unparsed.push({ name: rec.name, token: t });
      if (!byChome.has(key)) byChome.set(key, []);
      byChome.get(key).push({ name: rec.name, ...parsed });
    }
  }
  let overlaps = 0;
  for (const [key, list] of byChome) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const hit = bareOverlaps(list[i], list[j]);
        if (hit.length) {
          overlaps++;
          console.warn(`  警告: ${key} の番地が限定なしで重なる — "${list[i].name}" と "${list[j].name}" ${JSON.stringify(hit)}`);
        }
      }
    }
  }
  // 番として読めなかった断片。一次ソースの表記ゆれ・誤記がここに出る。
  // 2026-08-31 時点では「6号18番」1 件 (簡易版で読点が落ちている。保存版は「15番1号・6号，18番」)。
  for (const u of unparsed) console.warn(`  注意: 番地として読めない断片 "${u.token}" — "${u.name}"`);
  console.log(`番地の重なり検査: ${byChome.size} 丁目 / 限定なしの重なり ${overlaps} 件 / 読めない断片 ${unparsed.length} 件`);
}

// ---- コースへ畳む ----

const folded = foldCourses(rows, (r) => r.rules, (r) => r.area);
console.log(`コース ${folded.length} / area ${rows.length}`);

const docs = folded.map(({ rules, areas }, i) => {
  areas.sort((a, b) => {
    const x = a.yomi ?? a.name, y = b.yomi ?? b.name;
    return x < y ? -1 : x > y ? 1 : (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  });
  return courseDoc({
    city: 'toshima',
    course: String(i + 1),
    areas,
    period: PERIOD,
    source: {
      edition_ja: EDITION_JA,
      source_url: PRIMARY.url,
      extracted_at: EXTRACTED_AT,
      extracted_by: 'claude-opus-5',
      verified_by:
        'Claude (豊島区「資源回収・ごみ収集のお知らせ」外国語版リーフレット p2 の曜日一覧を機械抽出。' +
        '同じ表の別言語版 5 種 (ベトナム/ミャンマー/ネパール/タイ/ヒンディー) と全数照合し、' +
        '保存版冊子の曜日一覧 (画像 PDF) の目視転記 58 行とも全数照合した。' +
        '祝日は区が「年末年始を除き通常収集」と明記しているため休止日なし)',
    },
    rules,
  });
});

// ---- 検査 3: 生成した rules を展開し直すと、PDF の曜日セルと一致するか ----
//
// rules は cellsToRules() が作ったものなので、それを**別経路で**読み直して突き合わせる。
// 収録期間の全日について「その日に出る品目」を曜日セルの文字列から直に計算し、
// expandRange() の結果と比べる。ここが合わなければ書き出さない。
{
  const dates = periodDates(PERIOD);
  let checked = 0;
  for (const [i, { rules }] of folded.entries()) {
    const cells = folded[i].areas.length ? rows.find((r) => r.rules === rules).cells : null;
    const got = expandRange(PERIOD, rules, [], []);
    for (const iso of dates) {
      const d = new Date(`${iso}T00:00:00`);
      const want = new Set();
      cells.forEach((cell, ci) => {
        const col = COLUMNS[ci];
        const days = cell.replace(/^第[0-9・]+/, '').split('・');
        if (!days.some((x) => DAY_TO_INDEX[{ 日: 'SU', 月: 'MO', 火: 'TU', 水: 'WE', 木: 'TH', 金: 'FR', 土: 'SA' }[x]] === d.getDay())) return;
        if (col.pattern === 'monthly_nth') {
          const occ = (/^第([0-9・]+)/.exec(cell))[1].split('・').map(Number);
          if (!occ.includes(nthOfMonth(d))) return;
        }
        for (const c of col.categories) want.add(c);
      });
      const have = new Set(got.get(iso) ?? []);
      const same = want.size === have.size && [...want].every((c) => have.has(c));
      if (!same) {
        throw new Error(`自己検証で不一致: course ${i + 1} / ${iso} / セル "${cells.join('|')}" ` +
          `期待 [${[...want].sort()}] 展開 [${[...have].sort()}]`);
      }
      checked++;
    }
  }
  console.log(`自己検証: ${checked} 日枠で expandRange と曜日セルが一致`);
}

// 同日に複数品目が重なるコースの件数 (異常ではないが黙って通さない)
const overlapping = folded.filter(({ rules }) => overlapCount(rules) > 0).length;
console.log(`金属陶器ガラスと他品目が同日になるコース: ${overlapping} / ${folded.length}`);

for (const c of CAT_ORDER) {
  if (!docs.some((d) => d.rules.some((r) => r.category === c))) throw new Error(`品目 ${c} がどのコースにも無い`);
}

console.log(`generated ${writeCourses(OUTDIR, PERIOD, docs)} courses`);
