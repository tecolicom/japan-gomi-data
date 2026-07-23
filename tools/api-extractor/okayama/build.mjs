// 岡山市: fetch.mjs が取得した cache/records.json (844行) を正典カテゴリの rules へ写像し、
// 同一日程を市全域で畳んで course YAML を出力する。
//
// 種別マッピング (taxonomy.yaml と一致・市公式の分別定義に基づく):
//   可燃ごみ(ドロップダウン_3)      -> burnable        (weekly)
//   不燃ごみ(ドロップダウン_4)      -> non_burnable    (monthly_nth)
//   資源化物(ドロップダウン_6)      -> 同一収集日に一括の6品目へ分解 (monthly_nth):
//       ガラスびん=glass_bottle / 空き缶=beverage_can / スプレー缶=spray_can /
//       ペットボトル=pet_bottle / 古紙=paper / 古布=cloth
//       (市公式 https://www.city.okayama.jp/kurashi/0000005214.html で構成品目を裏取り)
//   プラスチック資源(ドロップダウン_7) -> plastic       (weekly)
//
// 畳み込み: 4フィールドの日程シグネチャで市全域を畳む。小学校区(district)は行政区の下位で
//   ソースの地区単位だが行政区への対応表が公開に無いため、コース slug は okayama-<n> とし、
//   小学校区と町名は course_name_ja に人間可読で保持する (詳細は README)。
//   町丁目カナの権威ソースが repo に無く 町内会単位の備考が地区区別子のため、構造化 areas は付けない
//   (倉敷と同方針。推測でカナを作らない)。
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { foldCourses, courseDoc, writeCourses } from '../../_lib/emit.mjs';
import { fragmentsExpecting } from './parse.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..', '..');
const OUTDIR = join(ROOT, 'municipalities', 'okayama', 'okayama');
const YEAR = 2026;
const FY_JA = '令和8年度';
const EXTRACTED_AT = process.env.EXTRACTED_AT || (() => { throw new Error('EXTRACTED_AT env 必須'); })();
const EXTRACTED_BY = 'claude-opus-4-8';
const SOURCE_URL = 'https://f5d44204.viewer.kintoneapp.com/public/bba750ccc0622ed0ea1ee9803b60537753367b11af275de1ad0d1507c414d779';
const CATEGORY_URL = 'https://www.city.okayama.jp/kurashi/category/1-12-7-10-3-0-0-0-0-0.html';

// 資源化物の同日一括6品目
const RECYCLE_CATS = ['glass_bottle', 'beverage_can', 'spray_can', 'pet_bottle', 'paper', 'cloth'];
// 署名安定用のカテゴリ順
const CAT_ORDER = ['burnable', 'non_burnable', 'glass_bottle', 'beverage_can', 'spray_can',
  'pet_bottle', 'paper', 'cloth', 'plastic'];
const catRank = (c) => { const i = CAT_ORDER.indexOf(c); if (i < 0) throw new Error(`未知カテゴリ ${c}`); return i; };

// 1 行 -> rules。資源化物断片は6カテゴリで days/occurrences 配列を参照共有し YAML anchor 化する。
function toRules(rec) {
  const rules = [];
  for (const f of fragmentsExpecting(rec.burnable, 'weekly', '可燃'))
    rules.push({ category: 'burnable', pattern: f.pattern, days: f.days });
  for (const f of fragmentsExpecting(rec.nonburnable, 'monthly_nth', '不燃'))
    rules.push({ category: 'non_burnable', pattern: f.pattern, days: f.days, occurrences: f.occurrences });
  const recFrags = fragmentsExpecting(rec.recycle, 'monthly_nth', '資源化物');
  for (const cat of RECYCLE_CATS)
    for (const f of recFrags)
      rules.push({ category: cat, pattern: f.pattern, days: f.days, occurrences: f.occurrences });
  for (const f of fragmentsExpecting(rec.plastic, 'weekly', 'プラ資源'))
    rules.push({ category: 'plastic', pattern: f.pattern, days: f.days });
  // カテゴリ順で整列 (署名安定)。同カテゴリ内は断片順を保持。
  return rules
    .map((r, i) => [r, i])
    .sort((a, b) => catRank(a[0].category) - catRank(b[0].category) || a[1] - b[1])
    .map(([r]) => r);
}

// areas は構造化して備考を note フィールドへ分離する (course_name_ja には備考を入れない)。
// name は町名そのまま。地区割れ (同一町名で日程違い) の判別は note が担う
// (割れ町の備考は「砂川以東」等の地理区分)。
// yomi はデジタル庁アドレス・ベース・レジストリ (ABR) 町字マスターの大字・町名カナ由来
// (fetch-yomi.mjs → cache/abr-town-kana.json、ひらがな化済み)。ベース町名 (丁目・区注記・
// 記号サフィクスを除去) で引き、無ければ ①ひらがな/カタカナのみの町名は自身を読みとする
// (表記=読み。推測ではない)、②それ以外は yomi を付けない (推測でカナを作らない)。
let ABR = null;
try { ABR = JSON.parse(readFileSync(join(HERE, 'cache', 'abr-town.json'), 'utf8')).towns; }
catch { throw new Error('cache/abr-town.json がありません。node fetch-yomi.mjs を先に実行'); }
const nfkc = (s) => s.normalize('NFKC');
// 原文の丸括弧は全角/半角が混在する (（…) 等) ため出力時に全角へ正規化する
const zenParen = (s) => s.replace(/\(/g, '（').replace(/\)/g, '）');
const eqOaza = (a, b) => a === b || a.replace(/ケ/g, 'ヶ') === b || a.replace(/ヶ/g, 'ケ') === b;
// kViewer 町名 → { base(大字), chome(丁目番号|null), ward(区注記|null) } へ正規化
const parseTown = (t) => {
  let s = nfkc(t).replace(/\s+/g, '');
  let ward = null;
  s = s.replace(/[（(]([^）)]*)[）)]/g, (_, inner) => {
    const m = inner.match(/^(北|中|東|南)区$/);
    if (m) ward = `${m[1]}区`;
    return '';
  });
  let chome = null;
  s = s.replace(/([0-9]+)丁目.*$/, (_, n) => { chome = Number(n); return ''; });
  s = s.replace(/[一二三四五六七八九十]+丁目.*$/, (m0) => {
    const K = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
    chome = K[m0[0]] ?? null; return '';
  });
  s = s.replace(/[0-9A-Za-z]+$/, ''); // 福田①→(NFKC)福田1・東古松A 等の記号サフィクス
  return { base: s, chome, ward };
};
// ABR 照合: 丁目まで一致する町字行 → { yomi, machiazaId }。丁目行が無ければ大字行。
const abrOf = (town) => {
  const { base, chome, ward } = parseTown(town);
  let cands = ABR.filter((t) => eqOaza(t.oaza, base));
  if (ward) cands = cands.filter((t) => t.ward === ward);
  const exact = chome !== null
    ? cands.filter((t) => t.chome_number === chome)
    : cands.filter((t) => t.chome_number === null);
  let pick = exact.length ? exact : cands.filter((t) => t.chome_number === null);
  // ABR は同一町字が複数行になることがある (小字違い等)。ID でユニーク化してから判定
  const uniq = new Map(pick.map((t) => [`${t.lg}-${t.id}`, t]));
  pick = [...uniq.values()];
  if (pick.length === 1) {
    const t = pick[0];
    return { yomi: t.kana ?? undefined, machiazaId: `${t.lg}-${t.id}` };
  }
  if (pick.length > 1) {
    // 区をまたぐ同名町 (例 西市=北区/南区) で kViewer 側に区注記が無い場合は一意化できない。
    // 誤った ID を付けるより付けない (yomi はカナが同一なら採用できる)。
    ambiguous.push(`${town}→${pick.map((t) => `${t.lg}-${t.id}`).join('/')}`);
    const kanas = new Set(pick.map((t) => t.kana));
    return { yomi: kanas.size === 1 ? pick[0].kana : undefined, machiazaId: undefined };
  }
  // ABR に無い: ひらがな/カタカナのみの町名は表記=読み (ID は付けない)
  if (/^[ぁ-んァ-ヶー]+$/.test(base))
    return { yomi: base.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60)), machiazaId: undefined };
  return { yomi: undefined, machiazaId: undefined };
};
let yomiMissing = [];
let idMissing = [];
const ambiguous = [];
// 備考のうち収集時刻の運用説明 (「朝7時30分までにお出しください。」等) は町名選択の
// 判別に不要なため note から除去する (区別子・地区限定は残す)。原文は cache の一次取得に残る。
let timeNoteStripped = 0;
const stripTimeNote = (n) => {
  let out = n
    // 収集時刻の運用説明
    .replace(/\s*[（(]?朝[78]時(?:30分)?までにお出しください。?[）)]?\s*/g, ' ')
    // 「〜にお住いの方は上記の収集曜日に出してください。」→ 前半の番地区別子を残す
    .replace(/にお住いの方は[^。]*ください。?/g, '')
    // 「〜ので、…ください。」→ 前半の限定条件を残す (泉田・下伊福)
    .replace(/ので、[^。]*ください。?/g, '。')
    // 括弧内全体が案内・注意で終わるものは括弧ごと除去 (例「（…は<福田②>をご覧ください。）」「（…ため注意）」)
    .replace(/[（(][^（）()]*(?:ください。?|ため注意。?)[）)]/g, '')
    // 残る「〜ください。」終端の文を文単位で除去 (例「ステーション看板をご確認ください。」)
    .replace(/[^。]*ください。/g, '');
  out = out.replace(/\s+/g, ' ').trim();
  if (out !== n.trim()) timeNoteStripped++;
  return out;
};
// 割れ町 (同一町名が複数の日程レコードを持つ) は note の判別子を name に昇格させる:
// name だけで地域を特定できるようにする (横浜「上郷町1〜199の一部」・川崎「梶ヶ谷（高津区）」の先例)。
// 昇格した行の note は重複排除のため外す。非割れ町の note (限定条件等) はそのまま。
// 割れ判定キー: 区注記括弧と記号サフィクス (①②・A/B) を除いた表示ベース名 (丁目は保持)。
// 福田①/福田② や 下中野（北区）/（南区） を同一グループとして扱う。
const splitKey = (t) => nfkc(t)
  .replace(/[（(][^）)]*[）)]/g, '')
  .replace(/\s+/g, '')
  .replace(/[0-9A-Za-z]+$/, '');
const splitCount = new Map(); // build 実行部で records 読込後に構築する
const splitNoNote = [];
const rowArea = (r) => {
  const { yomi, machiazaId } = abrOf(r.town);
  if (!yomi) yomiMissing.push(r.town);
  if (!machiazaId) idMissing.push(r.town);
  const note = r.note && r.note.trim() ? zenParen(stripTimeNote(r.note)) : '';
  const isSplit = splitCount.get(splitKey(r.town)) > 1;
  if (isSplit && !note) splitNoNote.push(r.town);
  // 地域情報の一貫化: note のうち「地域範囲・区別」の情報 (割れ町の判別子、非割れ町の
  // 対象集落列挙・学区・境界) は name に含め、「運用情報」(町内会単位の当面系例外・
  // 個別上書き・限定条件の注意書き) だけを note に残す。
  const OPERATIONAL = /当面|町内会|互助会|民生会|親交会|※|例外|異なり|ルールが違う|不燃|資源化物|資源（|プラ資源|分は/;
  const isRegional = note && !OPERATIONAL.test(note);
  if (note && (isSplit || isRegional)) {
    // name と重複する冗長な範囲説明 (御津中山 | 中山 等) は昇格せず note ごと落とす
    if (r.town.includes(note)) {
      return {
        name: r.town,
        ...(yomi ? { yomi } : {}),
        ...(machiazaId ? { machiaza_id: machiazaId } : {}),
      };
    }
    // town が既に区注記括弧を持つ場合 (下中野（北区）等) は二重括弧にせず単一括弧へ統合。
    // note 末尾の句点は括弧内では除去する。
    const noteClean = note.replace(/。$/, '');
    const wm = r.town.match(/^(.+?)（([^）]+)）\s*$/);
    const name = wm ? `${wm[1]}（${wm[2]}・${noteClean}）` : `${r.town}（${noteClean}）`;
    return {
      name: zenParen(name),
      ...(yomi ? { yomi } : {}),
      ...(machiazaId ? { machiaza_id: machiazaId } : {}),
    };
  }
  return {
    name: r.town,
    ...(yomi ? { yomi } : {}),
    ...(machiazaId ? { machiaza_id: machiazaId } : {}),
    ...(note ? { note } : {}),
  };
};

const payload = JSON.parse(readFileSync(join(HERE, 'cache', 'records.json'), 'utf8'));
const records = [...payload.records].sort((a, b) => Number(a.id) - Number(b.id));
for (const r of records) {
  const k = splitKey(r.town);
  splitCount.set(k, (splitCount.get(k) || 0) + 1);
}

// 市全域を日程シグネチャで畳む。areas は行(小学校区+町名+備考)を保持。
const folded = foldCourses(records, toRules, (r) => r);

// 出現順(最初の行の id)でコース番号を安定化
folded.sort((a, b) => Number(a.areas[0].id) - Number(b.areas[0].id));

// 年末年始のうち複数年実績で不変の部分のみ反映 (詳細は meta.yaml notes):
//   市告知 (Wayback 令和2/4/5年度) は「年末は12/29または12/30まで・年始は1/4から」で、
//   共通する不変部分は 12/31〜1/3 休止。12/30 は年により収集する年としない年がある。
//   休止日に当たる地区の振替は毎年12月の「年末年始収集日変更一覧」PDF で告知されるため未反映。
//   2026年度の実効休止日は 12/31(木)・1/1(金) のみ (1/2土・1/3日は元々収集なし、
//   12/31 は第5木曜のため monthly_nth は非該当 = weekly 該当分のみ)。
const DAY_TO_INDEX = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };
function yearEndOverrides(rules) {
  const out = [];
  for (const iso of ['2026-12-31', '2027-01-01', '2027-01-02', '2027-01-03']) {
    const d = new Date(iso + 'T00:00:00');
    const occ = Math.floor((d.getDate() - 1) / 7) + 1;
    const hit = rules.some((r) => (r.days || []).some((x) => DAY_TO_INDEX[x] === d.getDay()) &&
      (r.pattern === 'weekly' || (r.pattern === 'monthly_nth' && r.occurrences.includes(occ))));
    if (hit) out.push({ date: iso, cancelled: true, note: '年末年始休止(12/31〜1/3。令和2・4・5年度の市告知に共通する不変部分。振替は12月の変更一覧で要確認)' });
  }
  return out;
}

const docs = folded.map((c, i) => {
  // course_name_ja: 小学校区ごとに町名を束ねる (備考は areas[].note へ分離)
  const byDist = new Map();
  for (const r of c.areas) {
    if (!byDist.has(r.district)) byDist.set(r.district, []);
    byDist.get(r.district).push(r.town);
  }
  const courseNameJa = [...byDist.entries()].map(([d, ts]) => `${d}: ${ts.join('／')}`).join(' ｜ ');
  return courseDoc({
    city: 'okayama',
    course: `okayama-${i + 1}`,
    courseNameJa,
    // 同一日程で学区だけ違う行 (例 今2丁目=西/大元) は畳み込みで同一コースに入り
    // area が重複するため、同一表現 (name+yomi+id+note) を dedupe する
    areas: [...new Map(c.areas.map(rowArea).map((a) => [JSON.stringify(a), a])).values()],
    year: YEAR,
    fiscalYearJa: FY_JA,
    source: {
      source_url: SOURCE_URL,
      extracted_at: EXTRACTED_AT,
      extracted_by: EXTRACTED_BY,
      verified_by: 'Claude(市公式 kViewer「収集曜日一覧」records API を機械取得。API取得×ブラウザ取得の2経路で全844行突合一致、JS/Python 2実装でパース突合一致。資源化物の構成品目は市公式分別ページで裏取り。日付入り年間カレンダー・原簿の独立照合は kViewer が唯一の公開のため不可)',
    },
    rules: c.rules,
    overrides: yearEndOverrides(c.rules),
  });
});

const n = writeCourses(OUTDIR, YEAR, docs);
console.log(`wrote ${n} courses (from ${records.length} rows) -> ${OUTDIR}/${YEAR}/`);
const uniqMissing = [...new Set(yomiMissing)];
console.log(`yomi: ${records.length - yomiMissing.length}/${records.length} 行に付与 (未付与 町名: ${uniqMissing.join('、') || 'なし'})`);
const uniqIdMissing = [...new Set(idMissing)];
console.log(`machiaza_id: ${records.length - idMissing.length}/${records.length} 行に付与 (未付与 町名: ${uniqIdMissing.join('、') || 'なし'})`);
if (ambiguous.length) console.log(`  うち区またぎ同名で曖昧 (ID未付与): ${[...new Set(ambiguous)].join('、')}`);
console.log(`note: 収集時刻の運用説明を ${timeNoteStripped} 行から除去`);
if (splitNoNote.length) console.log(`  警告: 割れ町なのに判別 note が無い行: ${[...new Set(splitNoNote)].join('、')}`);
