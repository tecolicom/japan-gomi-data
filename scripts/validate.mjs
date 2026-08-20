import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as yamlParse } from 'yaml';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { PERIOD_RE, parsePeriod, iso } from '../tools/_lib/schedule.mjs';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
// schema/*.json は $schema: draft/2020-12 を使うため Ajv2020 が必要 (plain Ajv は draft-07 のみ)
const ajv = new Ajv2020({ allErrors: true });
addFormats(ajv);

const loadJson = (p) => JSON.parse(readFileSync(join(ROOT, p), 'utf8'));
// yaml の日付スカラは文字列化して schema の pattern と揃える
const loadYaml = (p) => yamlParse(readFileSync(p, 'utf8'), {
  customTags: [{ tag: '!!timestamp', test: /.*/, resolve: (s) => s }],
});

const scheduleV = ajv.compile(loadJson('schema/schedule.schema.json'));
const taxonomyV = ajv.compile(loadJson('schema/taxonomy.schema.json'));
const factsV = ajv.compile(loadJson('schema/facts.schema.json'));
const metaV = ajv.compile(loadJson('schema/meta.schema.json'));
const jitenV = ajv.compile(loadJson('schema/bunbetsu-jiten.schema.json'));
const vocab = new Set(Object.keys(loadYaml(join(ROOT, 'schema/categories.yaml')).categories));
// 品目辞典だけが使う「処分の可否」語彙。course-*.yaml には現れない (schema/disposal.yaml 参照)
const disposalVocab = new Set(Object.keys(loadYaml(join(ROOT, 'schema/disposal.yaml')).disposal));

const errors = [];
const fail = (f, msg) => errors.push(`${f}: ${msg}`);

const muniDir = join(ROOT, 'municipalities');
// municipalities/<県>/<handle>/ の2階層。handle は leaf 名 (全国一意)。
const isDir = (p) => statSync(p).isDirectory();
const handles = [];
if (existsSync(muniDir)) {
  for (const pref of readdirSync(muniDir).filter((p) => isDir(join(muniDir, p)))) {
    const prefDir = join(muniDir, pref);
    for (const h of readdirSync(prefDir).filter((h) => isDir(join(prefDir, h)))) {
      handles.push({ handle: h, dir: join(prefDir, h) });
    }
  }
}

let surveyOnly = 0;
for (const { handle, dir } of handles) {

  // survey.yaml は収録後も調査記録の正典として残る。下の分岐は「meta が無いとき」しか
  // 読まないため、収録済み自治体の survey.yaml は誰も検査していなかった
  // (notes への追記でコロン+空白を入れて YAML を壊したまま気づけなかった実例あり)。
  // 収録の有無によらず、構文と handle だけは必ず検査する。
  const surveyPath = join(dir, 'survey.yaml');
  let survey = null;
  if (existsSync(surveyPath)) {
    try {
      survey = loadYaml(surveyPath);
    } catch (e) {
      fail(`${handle}/survey.yaml`, `YAML として読めません: ${String(e?.message ?? e).split('\n')[0]}`);
    }
    if (survey && survey.handle !== handle) {
      fail(`${handle}/survey.yaml`, `handle "${survey.handle}" がディレクトリ名と不一致`);
    }
  }

  // meta — 無い場合、survey.yaml だけの「調査済み・未収録」ディレクトリは許容する
  const metaPath = join(dir, 'meta.yaml');
  if (!existsSync(metaPath)) {
    if (existsSync(surveyPath)) {
      surveyOnly++;
      continue;
    }
    fail(handle, 'meta.yaml がありません');
  }
  else {
    const meta = loadYaml(metaPath);
    if (!metaV(meta)) fail(`${handle}/meta.yaml`, ajv.errorsText(metaV.errors));
    else if (meta.handle !== handle) fail(`${handle}/meta.yaml`, `handle "${meta.handle}" がディレクトリ名と不一致`);
  }

  // taxonomy
  const taxPath = join(dir, 'taxonomy.yaml');
  let taxCats = new Set();
  if (!existsSync(taxPath)) fail(handle, 'taxonomy.yaml がありません');
  else {
    const tax = loadYaml(taxPath);
    if (!taxonomyV(tax)) fail(`${handle}/taxonomy.yaml`, ajv.errorsText(taxonomyV.errors));
    else {
      for (const c of tax.categories ?? []) {
        if (!vocab.has(c)) fail(`${handle}/taxonomy.yaml`, `未知の種別 "${c}"(schema/categories.yaml に無い)`);
        taxCats.add(c);
      }
      // groups (参考情報の括り名) の members は宣言済み categories の部分集合であること
      for (const g of tax.groups ?? []) {
        for (const m of g.members ?? []) {
          if (!taxCats.has(m)) fail(`${handle}/taxonomy.yaml`, `groups "${g.label}" の member "${m}" が categories に無い`);
        }
      }
    }
  }

  // 品目辞典 (任意)。品目名から出し方を引く辞典で、収集日程とは別の資料。
  // **収録期間ディレクトリに置いてはいけない** — emit.mjs の writeCourses() が
  // <outDir>/<period>/ を rmSync してから書き出すので、build のたびに消える。
  // handle 直下に置く (meta.yaml / taxonomy.yaml と同じ階層)。
  const jitenPath = join(dir, 'bunbetsu-jiten.yaml');
  if (existsSync(jitenPath)) {
    const jiten = loadYaml(jitenPath);
    if (!jitenV(jiten)) fail(`${handle}/bunbetsu-jiten.yaml`, ajv.errorsText(jitenV.errors));
    else {
      // category は「収集種別」か「処分可否」のどちらかの正典に属すること。
      // 2026-08 まで飯能が not_collected / drop_off_only / reference を混ぜており、
      // 別リポジトリにあったため誰も検査していなかった。
      const seen = new Map();
      for (const it of jiten.items) {
        if (!vocab.has(it.category) && !disposalVocab.has(it.category)) {
          fail(`${handle}/bunbetsu-jiten.yaml`,
            `未知の category "${it.category}" (品目「${it.name}」)。` +
            'schema/categories.yaml (収集種別) か schema/disposal.yaml (処分可否) に無い');
        }
        // 同名品目が別種別で二重に載っていると、アプリは先勝ちで一方しか見せない
        const prev = seen.get(it.name);
        if (prev != null && prev !== it.category) {
          fail(`${handle}/bunbetsu-jiten.yaml`, `品目「${it.name}」が "${prev}" と "${it.category}" で重複`);
        }
        seen.set(it.name, it.category);
      }
      // taxonomy に無い収集種別を辞典が使っていたら、その街では出せない種別を案内している
      for (const it of jiten.items) {
        if (vocab.has(it.category) && taxCats.size && !taxCats.has(it.category)) {
          fail(`${handle}/bunbetsu-jiten.yaml`,
            `category "${it.category}" (品目「${it.name}」) がこの自治体の taxonomy.yaml に無い`);
        }
      }
    }
  }

  // facts (任意。読み物断片 — schema 検証 + id 一意 + 出典パスの実在)
  const factsPath = join(dir, 'facts.yaml');
  if (existsSync(factsPath)) {
    const facts = loadYaml(factsPath);
    if (!factsV(facts)) fail(`${handle}/facts.yaml`, ajv.errorsText(factsV.errors));
    else {
      const ids = new Set();
      for (const f of facts.facts) {
        if (ids.has(f.id)) fail(`${handle}/facts.yaml`, `fact id 重複 "${f.id}"`);
        ids.add(f.id);
        // 出典がリポジトリ内パスなら実在を確かめる。スキーマ移行 (年ディレクトリ →
        // 収録期間ディレクトリ) で 33 件が黙って壊れていたため検査を足した。
        // URL は到達性を確かめない (ネットワークに依存させない)。ics/ は生成物で
        // .gitignore 対象、かつ CI は npm test → build:ics の順なので対象外。
        for (const s of f.sources ?? []) {
          if (/^https?:\/\//.test(s) || s.startsWith('ics/')) continue;
          if (!existsSync(join(ROOT, s))) fail(`${handle}/facts.yaml`, `fact "${f.id}" の出典パスが存在しません: ${s}`);
        }
      }
    }
  }

  // courses(収録期間ディレクトリ YYYY-MM--YYYY-MM 配下の course-*.yaml)
  for (const entry of readdirSync(dir)) {
    const periodDir = join(dir, entry);
    if (!statSync(periodDir).isDirectory()) continue;
    if (!PERIOD_RE.test(entry)) {
      // 期間名でないディレクトリを黙って読み飛ばすと、収録が丸ごと配信から漏れても気づけない
      if (/^\d{4}$/.test(entry)) fail(`${handle}/${entry}`, '年ディレクトリは廃止。YYYY-MM--YYYY-MM へ移行すること');
      continue;
    }
    const period = parsePeriod(entry);
    for (const f of readdirSync(periodDir)) {
      if (!/^course-.*\.yaml$/.test(f)) continue;
      const rel = `${handle}/${entry}/${f}`;
      const doc = loadYaml(join(periodDir, f));
      if (!scheduleV(doc)) { fail(rel, ajv.errorsText(scheduleV.errors)); continue; }
      if (doc.metadata.city !== handle) fail(rel, `metadata.city "${doc.metadata.city}" != "${handle}"`);
      // ディレクトリ名 = 収録期間 = 展開範囲。三者がずれたら日付が静かに捨てられる/湧く
      if (doc.metadata.period !== entry) fail(rel, `metadata.period "${doc.metadata.period}" がディレクトリ名 "${entry}" と不一致`);
      // 期間外の日付は展開されない = 書いても効かない。黙って無視させず落とす
      // (川口の 2026-01-01 cancelled が FY2026 の外にあって効いていなかった事例)
      const outside = (d) => { const m = iso(d).slice(0, 7); return m < period.from || m > period.to; };
      for (const o of doc.overrides ?? []) {
        if (outside(o.date)) fail(rel, `override の日付 ${iso(o.date)} が収録期間 ${entry} の外 (展開されないため無効)`);
      }
      for (const r of doc.rules ?? []) {
        for (const d of r.dates ?? []) {
          if (outside(d)) fail(rel, `rule "${r.category}" の日付 ${iso(d)} が収録期間 ${entry} の外`);
        }
      }
      for (const u of doc.unknown_periods ?? []) {
        if (iso(u.to) < iso(u.from)) fail(rel, `unknown_periods の from/to が逆転: ${iso(u.from)}〜${iso(u.to)}`);
        if (outside(u.from) && outside(u.to)) fail(rel, `unknown_periods ${iso(u.from)}〜${iso(u.to)} が収録期間 ${entry} と重ならない`);
      }
      // areas の name/note の括弧バランス (全角・半角を別々に検査。抽出の削り残し検出)
      for (const a of doc.metadata.areas ?? []) {
        for (const v of [a.name, a.note]) {
          if (!v) continue;
          const c = (str, ch) => str.split(ch).length - 1;
          if (c(v, '（') !== c(v, '）') || c(v, '(') !== c(v, ')'))
            fail(rel, `括弧が不整合: "${v}"`);
        }
      }
      for (const r of doc.rules ?? []) {
        if (!taxCats.has(r.category)) fail(rel, `rule category "${r.category}" が taxonomy に無い`);
      }
      for (const o of doc.overrides ?? []) {
        if (o.category != null && !taxCats.has(o.category)) fail(rel, `override category "${o.category}" が taxonomy に無い`);
      }
    }
  }
}

if (errors.length) {
  console.error(`✗ ${errors.length} 件の検証エラー:`);
  for (const e of errors) console.error('  - ' + e);
  process.exit(1);
}
console.log(`✓ 検証 OK (収録 ${handles.length - surveyOnly} + 調査のみ ${surveyOnly} = ${handles.length} 自治体)`);
