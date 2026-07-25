// 倉敷市: extract.py が出した records.json (地区ゾーンごとの weekly/nth 日程) を
// 正典カテゴリの rules へ写像し、同一日程を収集地区(環境センター)内で畳んで course YAML を出力。
//
// 種別マッピング(taxonomy.yaml と一致):
//  真備以外5地区(倉敷/水島/玉島/児島/船穂): 燃やせる=burnable(週2 or 月n) /
//    資源ごみ(月1・同日一括)=びん+缶+ペット+古紙+古布 / 埋立=non_burnable
//  真備: 燃える=burnable / 燃えない=non_burnable / 資源[ペット・白トレイ・古布]=pet+plastic+cloth /
//    資源[缶]=beverage_can / 資源[びん・古紙]=glass_bottle+paper / 有害[体温計・乾電池]=hazardous
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { foldCourses, courseDoc, writeCourses } from '../../_lib/emit.mjs';
import { expandRow, compressChomes } from './areas.mjs';

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

// 読み (yomi) と町字ID (machiaza_id): デジタル庁 ABR 倉敷市町字マスター
// (fetch-yomi.mjs → cache/abr-town.json、lg_code 332020) 由来。ABR の町名は管区/大字接頭辞つき
// (水島高砂町・茶屋町早沖・連島町亀島新田・玉島服部・児島唐琴・真備町箭田) や 町 サフィクス
// (老松→老松町・船倉→船倉町)・通り→通・の→之 の表記ゆれが多いため、管区ごとの接頭辞候補と異形を
// 試して照合し、丁目番号まで一致する町字行で machiaza_id・yomi を引く (無ければ大字行)。引けない
// (町内会・字・未登録地名) 場合: ①ひらがな/カタカナ町名は自身を読みとする (表記=読み)、
// ②それ以外は yomi/machiaza_id を付けない (推測でカナ・ID を作らない)。
let ABR = [];
try { ABR = JSON.parse(readFileSync(join(HERE, 'cache', 'abr-town.json'), 'utf8')).towns; }
catch { throw new Error('cache/abr-town.json がありません。node fetch-yomi.mjs を先に実行'); }
const abrByOaza = new Map();
for (const t of ABR) { if (!abrByOaza.has(t.oaza)) abrByOaza.set(t.oaza, []); abrByOaza.get(t.oaza).push(t); }
// 管区/大字接頭辞 → その読み。ABR ヒットが接頭辞つき (玉島服部=たましまはっとり) の場合、
// 表示名 (服部) に合わせて接頭辞ぶんの読みを除去 (岡山「岩井1丁目→いわい」同様、文脈接辞は含めない)。
const PREFIX_YOMI = {
  水島: 'みずしま', 児島: 'こじま', 玉島: 'たましま', 真備町: 'まびちょう', 船穂町: 'ふなおちょう',
  茶屋町: 'ちゃやまち', 藤戸町: 'ふじとちょう', 連島町: 'つらじまちょう', 福田町: 'ふくだちょう',
  西阿知町: 'にしあちちょう', 下津井: 'しもつい', 児島味野: 'こじまあじの',
};
// 接頭辞候補の順序 = マッチ優先順。倉敷本体は接頭辞なしが正なので '' 先頭。玉島は「黒崎」が
// 倉敷本体 (0036000) と玉島黒崎 (0095000) の両在で、玉島 PDF の黒崎は玉島黒崎が正のため '玉島'
// を先に試す (玉島で接頭辞つき↔なし両在は黒崎のみ)。児島味野: 原文略記「城」= 児島味野城。
const PREFIX = {
  倉敷: ['', '茶屋町', '藤戸町', '西阿知町'],
  水島: ['', '水島', '連島町', '福田町', '西阿知町'],
  玉島: ['玉島', ''],
  児島: ['', '児島', '下津井', '児島味野'],
  真備: ['', '真備町'],
  船穂: ['', '船穂町'],
};
const kata2hira = (s) => s.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
// ABR は拗音・促音を大書き (ちよう=ちょう) する表記ゆれがあるため、接頭辞照合は正規化して行う
const normKana = (s) => s.replace(/ょ/g, 'よ').replace(/ゅ/g, 'ゆ').replace(/ゃ/g, 'や').replace(/っ/g, 'つ');
const stripPre = (kana, pre) =>
  (pre && normKana(kana).startsWith(normKana(pre)) ? kana.slice(pre.length) : kana);
// base(丁目除去済み町名) + chomes(番号のリスト、丁目なしは []) + 管区
//   → { yomi, machiazaIds, src }|null。丁目まとめは各構成丁目の ID を配列で返す (横浜方式)。
function abrOf(base, chomes, distJa) {
  // 照合する oaza 候補: base 異形 ('' / +町 / り除去 / の→之) × 管区接頭辞
  const variants = [[base, null]];
  if (!/町$/.test(base)) variants.push([`${base}町`, 'cho']);   // 老松→老松町・船倉→船倉町
  if (/り$/.test(base)) variants.push([base.replace(/り$/, ''), null]); // 中通り→(水島)中通
  if (/の/.test(base)) variants.push([base.replace(/の/g, '之'), null]); // 田の浦→(下津井)田之浦
  for (const [b, vkind] of variants)
    for (const p of PREFIX[distJa] || ['']) {
      const key = p + b;
      for (const oaza of [key, key.replace(/ケ/g, 'ヶ'), key.replace(/ヶ/g, 'ケ')]) {
        const rows = abrByOaza.get(oaza);
        if (!rows) continue;
        // yomi: 大字読み (丁目まとめでも読みは大字を使う)。大字行 → 無ければ丁目行のカナから。
        const oazaLvl = rows.filter((t) => t.chome_number === null);
        const yRows = oazaLvl.length ? oazaLvl : (chomes.length ? rows.filter((t) => chomes.includes(t.chome_number)) : rows);
        const kanas = new Set(yRows.map((t) => t.kana).filter(Boolean));
        let y = kanas.size === 1 ? stripPre([...kanas][0], PREFIX_YOMI[p]) : undefined; // 接頭辞ぶん除去
        if (y && vkind === 'cho') y = y.replace(/ち[ょよ]う$/, ''); // +町 異形は末尾「ちょう/ちよう」を除去
        // machiaza_id: 丁目なしは大字行が一意な時のみ。丁目まとめは各丁目行が一意に取れた分を配列化。
        let machiazaIds;
        if (chomes.length === 0) {
          const uniq = [...new Map(oazaLvl.map((t) => [`${t.lg}-${t.id}`, t])).values()];
          if (uniq.length === 1) machiazaIds = [`${uniq[0].lg}-${uniq[0].id}`];
        } else {
          const ids = [];
          for (const c of chomes) {
            const uniq = [...new Map(rows.filter((t) => t.chome_number === c).map((t) => [`${t.lg}-${t.id}`, t])).values()];
            if (uniq.length === 1) ids.push(`${uniq[0].lg}-${uniq[0].id}`);
          }
          if (ids.length) machiazaIds = ids;
        }
        if (y === undefined && machiazaIds === undefined) continue; // この候補は不発、次へ
        return { yomi: y, machiazaIds, src: 'abr' };
      }
    }
  if (/^[ぁ-んァ-ヶー]+$/.test(base)) return { yomi: kata2hira(base), machiazaIds: undefined, src: 'kana' };
  return null;
}

const records = JSON.parse(readFileSync(join(HERE, 'cache', 'records.json'), 'utf8'));

// PDF 読み括弧: 市公式 PDF は難読地名にルビ「地名（ひらがな）」を振っている (宇頭間（うとうま）・
// 美野団地（みのだんち）・中庄（なかんじょう）等 13 件)。市自身の読み表記なので権威ソースとして
// 採用し、ABR に無い地名の yomi をこれで補完する。name/note からは読み括弧を除去する。
const pdfYomi = new Map();
for (const r of records) {
  for (const src of [r.area, r.kyu || '']) {
    for (const m of src.matchAll(/([^・，,\s（）()]+)[（(]([ぁ-んー]+)[）)]/g)) pdfYomi.set(m[1], m[2]);
  }
}
console.log(`PDF 読み括弧 (市公式ルビ): ${pdfYomi.size} 地名 [${[...pdfYomi.keys()].join('、')}]`);
const stripRuby = (t) => t ? t.replace(/[（(][ぁ-んー]+[）)]/g, '').replace(/\s+/g, ' ').trim() : t;

// 各行を「1 町名 (丁目単位)」へ展開し yomi・machiaza_id・文脈 (gakku,base) を付す。
const stats = { total: 0, abr: 0, kana: 0, ruby: 0, none: 0, id: 0, missing: [] };
const expandTable = [];
function expandWithYomi(r) {
  const out = expandRow(r).map((a) => {
    // name = 町名 + 丁目レンジ圧縮 (丁目なしは町名のみ)。横浜方式で丁目まとめは展開しない。
    const name = stripRuby(a.chomes.length ? `${a.base}${compressChomes(a.chomes)}丁目` : a.base);
    const note = stripRuby(a.note);
    const hit = abrOf(a.base, a.chomes, r.district);
    let yomi = hit?.yomi;
    let src = hit?.src;
    if (!yomi) {
      const ruby = pdfYomi.get(name) ?? pdfYomi.get(a.base);
      if (ruby) { yomi = ruby; src = 'ruby'; }
    }
    const machiazaIds = hit?.machiazaIds;
    stats.total++;
    if (yomi) stats[src]++; else { stats.none++; stats.missing.push(name); }
    if (machiazaIds) stats.id++;
    return { name, base: a.base, gakku: r.gakku || '',
      ...(yomi ? { yomi } : {}), ...(machiazaIds ? { machiaza_id: machiazaIds } : {}), ...(note ? { note } : {}) };
  });
  expandTable.push({ district: r.district, gakku: r.gakku, kyu: r.kyu, area: r.area,
    expanded: out.map((a) => ({ name: a.name, ...(a.yomi ? { yomi: a.yomi } : {}),
      ...(a.machiaza_id ? { machiaza_id: a.machiaza_id } : {}), ...(a.note ? { note: a.note } : {}) })) });
  return out;
}

// course_name_ja: 学区 (倉敷本体) があれば学区ごとに、無ければ管区単位で
// ベース町名 (丁目番号を除いた重複なし) を列挙。丁目展開で肥大しないよう簡約する。
function courseName(distJa, flat) {
  const byG = new Map();
  for (const a of flat) {
    const g = a.gakku || '';
    if (!byG.has(g)) byG.set(g, []);
    if (!byG.get(g).includes(a.base)) byG.get(g).push(a.base);
  }
  const hasG = [...byG.keys()].some((g) => g);
  const body = hasG
    ? [...byG.entries()].map(([g, ts]) => (g ? `${g}(${ts.join('／')})` : ts.join('／'))).join(' ｜ ')
    : [...byG.values()].flat().join('／');
  return `${distJa}地区: ${body}`;
}

const docs = [];
const docMeta = []; // docs と同順: 割れ判別子昇格用の { district, gakkuByName }
let seq = 0;
for (const [distJa, meta] of Object.entries(DISTRICTS)) {
  const rows = records.filter((r) => r.district === distJa);
  if (!rows.length) continue;
  // 環境センター (収集地区) 内で同一日程を畳む。1 行が複数 area に展開されるため
  // toArea は配列を返し、畳み込み後に平坦化・重複除去する。
  const folded = foldCourses(rows, toRules, expandWithYomi);
  folded.forEach((c, i) => {
    seq++;
    const courseId = `${meta.romaji}-${i + 1}`;
    // 展開 area の平坦化 + (name, note) 重複除去 (同一町・同一注記の反復を畳む)
    const flat = c.areas.flat();
    const seen = new Set();
    const uniq = [];
    for (const a of flat) {
      const k = `${a.name} ${a.note || ''}`;
      if (seen.has(k)) continue;
      seen.add(k);
      uniq.push(a);
    }
    docs.push(courseDoc({
      city: 'kurashiki',
      course: courseId,
      courseNameJa: courseName(distJa, uniq),
      areas: uniq.map((a) => ({ name: a.name, ...(a.yomi ? { yomi: a.yomi } : {}),
        ...(a.machiaza_id ? { machiaza_id: a.machiaza_id } : {}), ...(a.note ? { note: a.note } : {}) })),
      year: YEAR,
      fiscalYearJa: FY_JA,
      source: {
        source_url: INDEX_URL,
        pdf_url: `${PDF_BASE}/${meta.pdf}`,
        extracted_at: EXTRACTED_AT,
        extracted_by: EXTRACTED_BY,
        verified_by: 'Claude(地区別PDFを pdfplumber 罫線グリッド抽出。area 文字列は areas.mjs で 1 町名=1 area へ機械分解。読みは ABR 倉敷市町字マスター由来。data eye 平成31年度地区別収集日CSVと曜日/第n を独立照合)',
      },
      rules: c.rules,
    }));
    const gakkuByName = new Map();
    for (const a of uniq) if (!gakkuByName.has(a.name)) gakkuByName.set(a.name, a.gakku || '');
    docMeta.push({ district: distJa, gakkuByName });
  });
}

// 割れ area (同一 name が別コース・別条件で複数存在) は note の判別子を name に昇格し、
// name 単独で地域特定できるようにする (岡山と同じ規則。横浜「上郷町1〜199の一部」先例)。
// 昇格行の note は重複排除のため外す。判別 note の無い割れ name は警告。
{
  const nameCount = new Map();
  for (const d of docs) for (const a of d.metadata.areas) nameCount.set(a.name, (nameCount.get(a.name) || 0) + 1);
  // 割れ name の note を判別子として name に昇格。note は整形する (二重括弧・入れ子を出さない):
  // 外側括弧の除去・先頭の name 繰り返し除去 (横浜と統一)。
  for (const d of docs) {
    d.metadata.areas = d.metadata.areas.map((a) => {
      if (!((nameCount.get(a.name) || 0) > 1 && a.note)) return a;
      const { note, ...rest } = a;
      let nc = note.replace(/^（(.+)）$/, '$1').trim();
      if (nc.startsWith(a.name)) nc = nc.slice(a.name.length);
      // name 重複分を削った後に残る先頭・末尾の区切り (・、) を除去 (「福江（・曽原…）」防止)。
      nc = nc.replace(/^[・、\s]+/, '').replace(/[・、\s]+$/, '');
      return { ...rest, name: nc ? `${a.name}（${nc}）` : a.name };
    });
  }
  // note 判別子でも残る割れ (原文に番地等の区別が無い) は、学区(gakku)→無ければ地区(district)を
  // 判別子に付ける。同名でも別学区・別地区なら住民が区別できるようにする (黒崎=倉敷/玉島、中島=学区)。
  {
    const cnt = new Map();
    for (const d of docs) for (const a of d.metadata.areas) cnt.set(a.name, (cnt.get(a.name) || 0) + 1);
    for (let i = 0; i < docs.length; i++) {
      const dm = docMeta[i];
      docs[i].metadata.areas = docs[i].metadata.areas.map((a) => {
        if ((cnt.get(a.name) || 0) <= 1 || /[（(]/.test(a.name)) return a;
        const disc = dm.gakkuByName.get(a.name) || dm.district;
        return disc ? { ...a, name: `${a.name}（${disc}）` } : a;
      });
    }
  }
  // 昇格後も同一 name が複数コースに残る = 真に判別不能な割れのみ警告。
  const after = new Map();
  for (const d of docs) for (const a of d.metadata.areas) {
    if (!after.has(a.name)) after.set(a.name, new Set());
    after.get(a.name).add(d.metadata.course);
  }
  const dup = [...after].filter(([, cs]) => cs.size > 1).map(([n]) => n);
  if (dup.length) console.log(`  警告: 昇格後も判別不能な割れ (原文に番地等の区別が無い): ${dup.join('、')}`);
}
const n = writeCourses(OUTDIR, YEAR, docs);
writeFileSync(join(HERE, 'cache', 'area_expansion.json'),
  JSON.stringify({ rows: expandTable.length, areas: stats.total, table: expandTable }, null, 1));
console.log(`wrote ${n} courses (${seq} total) → ${OUTDIR}/${YEAR}/`);
console.log(`areas: ${stats.total} 展開 (ABR ${stats.abr} / PDF読み括弧 ${stats.ruby} / ひらがな自明 ${stats.kana} / 未付与 ${stats.none})`);
console.log(`yomi 付与率: ${((stats.abr + stats.kana) / stats.total * 100).toFixed(1)}%`);
console.log(`machiaza_id 付与率: ${(stats.id / stats.total * 100).toFixed(1)}% (${stats.id}/${stats.total})`);
console.log(`未付与 (uniq): ${[...new Set(stats.missing)].join('、')}`);
