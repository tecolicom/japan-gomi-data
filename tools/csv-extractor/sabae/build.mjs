// 鯖江市: 県 OD の CSV + 内閣府の祝日 + 年末年始 PDF から course YAML を生成する。
//
// meta.yaml / taxonomy.yaml は生成しない (手書きが正典)。ここが書くのは course-*.yaml だけ。
//
// 使い方: node fetch.mjs && EXTRACTED_AT=YYYY-MM-DD node build.mjs
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { periodDates } from '../../_lib/schedule.mjs';
import { courseDoc, writeCourses } from '../../_lib/emit.mjs';
import { parseSchedule, parseHolidays, parseYearend, parseSpecial } from './parse.mjs';
import { CACHE, FILES, PERIOD, EDITION_JA, SCHEDULE_CSV,
         COLUMN_MAP, CAT_ORDER, COURSE_IDS, isResource } from './sources.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUTDIR = join(HERE, '../../../municipalities/fukui/sabae');
const FISCAL_YEAR = 2026;

const EXTRACTED_AT = process.env.EXTRACTED_AT;
if (!EXTRACTED_AT) throw new Error('EXTRACTED_AT を環境変数で渡す (Date.now は使わない)');

const DAY_IDX = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };
const dow = (iso) => new Date(`${iso}T00:00:00`).getDay();

const towns = parseSchedule(readFileSync(join(CACHE, FILES.schedule), 'utf8'));
const holidays = parseHolidays(readFileSync(join(CACHE, FILES.holiday)));
const yearend = parseYearend(join(CACHE, FILES.yearend), FISCAL_YEAR);
const special = parseSpecial(join(CACHE, FILES.yearend), FISCAL_YEAR);
const specialDates = new Set(special.map((s) => s.date));

// 資源系の正典語彙 (CSV の列から導く。列が増えたら自動で乗る)
const resourceCats = CAT_ORDER.filter(isResource);
for (const c of new Set(Object.values(COLUMN_MAP))) {
  if (c !== null && !CAT_ORDER.includes(c)) throw new Error(`CAT_ORDER に無い品目 "${c}"`);
}

// 町を (可燃曜日, 資源曜日) でコースに畳む
const groups = new Map();
for (const t of towns) {
  const key = `${t.burnDays.join(',')}|${t.resDay}`;
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push(t);
}
if (groups.size !== COURSE_IDS.length) {
  throw new Error(`コース数が ${groups.size} (COURSE_IDS は ${COURSE_IDS.length})。` +
    `実際の組み合わせ: ${[...groups.keys()].join(' / ')}`);
}

const dates = periodDates(PERIOD);
const docs = [];

for (const spec of COURSE_IDS) {
  const key = `${spec.burnDays.join(',')}|${spec.resDay}`;
  const members = groups.get(key);
  if (!members) throw new Error(`course ${spec.course} の組み合わせ (${key}) が CSV に無い`);

  // 町は**読み仮名の昇順**に並べる。CSV の掲載順ではない (県の CSV は「行・音」列で
  // 大まかに五十音に寄せてあるだけで、同じ音の中は順不同)。
  // 比較はコードポイント順にする — localeCompare は濁点の扱いが環境で変わりうるので使わない
  // ("さだつぎだんち" < "さだつぎちょう" が だ(U+3060) < ち(U+3061) で決まる)。
  members.sort((a, b) => {
    const x = a.yomi ?? '', y = b.yomi ?? '';
    return x < y ? -1 : x > y ? 1 : 0;
  });

  // 可燃と資源が同じ曜日だと、cancelled(全休止) では資源だけを止められない。
  // 現状そのコースは無いが、将来そうなったら黙って誤らせずに止める。
  if (spec.burnDays.includes(spec.resDay)) {
    throw new Error(`course ${spec.course}: 可燃と資源が同じ曜日 (${spec.resDay})。` +
      'cancelled は全休止なので資源だけの休止を表せない');
  }

  const rules = [
    { category: 'burnable', pattern: 'weekly', days: spec.burnDays },
    ...resourceCats.map((c) => ({ category: c, pattern: 'weekly', days: [spec.resDay] })),
  ];
  rules.sort((a, b) => CAT_ORDER.indexOf(a.category) - CAT_ORDER.indexOf(b.category));

  // 年末年始 PDF のキーは日本語の曜日表記 ("月・木" / "火")
  const JA = { SU: '日', MO: '月', TU: '火', WE: '水', TH: '木', FR: '金', SA: '土' };
  const burnKey = spec.burnDays.map((d) => JA[d]).join('・');
  const resKey = JA[spec.resDay];
  const burnYe = yearend.burn[burnKey];
  const resYe = yearend.res[resKey];
  if (!burnYe) throw new Error(`年末年始 PDF に燃やすごみ "${burnKey}" の行が無い`);
  if (!resYe) throw new Error(`年末年始 PDF に資源 "${resKey}" の行が無い`);

  const overrides = [];
  for (const d of dates) {
    const w = dow(d);
    const isBurn = spec.burnDays.some((x) => DAY_IDX[x] === w);
    const isRes = DAY_IDX[spec.resDay] === w;
    if (!isBurn && !isRes) continue;

    // 年末年始: 最終日の後、開始日の前は休止
    const ye = isBurn ? burnYe : resYe;
    if (d > ye.last && d < ye.resume) {
      overrides.push({ date: d, cancelled: true, note: '年末年始休止' });
      continue;
    }
    // 祝日: 資源系のみ休止。可燃は休日も収集する。
    // ただし特別収集日 (2 週連続で祝日になる場合の振替) は収集する
    if (isRes && holidays.has(d) && !specialDates.has(d)) {
      overrides.push({ date: d, cancelled: true, note: '祝日休止(資源は休日収集なし)' });
    }
  }

  docs.push(courseDoc({
    city: 'sabae',
    course: spec.course,
    areas: members.map((t) => (t.yomi ? { name: t.name, yomi: t.yomi } : { name: t.name })),
    period: PERIOD,
    source: {
      edition_ja: EDITION_JA,
      // schema/schedule.schema.json が許す source のキーは限られている
      // (additionalProperties: false)。補助ソース (祝日 CSV / 年末年始 PDF) の URL は
      // meta.yaml の source に置いてあるので、ここには一次ソースだけを書く。
      source_url: SCHEDULE_CSV,
      extracted_at: EXTRACTED_AT,
      extracted_by: 'claude-opus-5',
      verified_by:
        'Claude (福井県オープンデータ CSV の町名×品目→収集曜日を機械抽出し、' +
        '内閣府「国民の祝日」CSV とエコプラザさばえ「年末年始のごみ収集」PDF で実日付に落とした。' +
        '可燃は休日も収集し、資源系は祝日休止。年末年始は品目別・曜日別に最終日と開始日が違う。' +
        '2 週連続で祝日になるコースの特別収集日 (2026 年度は水コースの 5/6) は収集する)',
    },
    rules,
    overrides,
  }));
  console.log(`course ${spec.course}: areas ${members.length} / rules ${rules.length} / overrides ${overrides.length}`);
}

console.log(`generated ${writeCourses(OUTDIR, PERIOD, docs)} courses`);
