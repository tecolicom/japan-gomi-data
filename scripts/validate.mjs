import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as yamlParse } from 'yaml';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

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
const vocab = new Set(Object.keys(loadYaml(join(ROOT, 'schema/categories.yaml')).categories));

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

  // meta — 無い場合、survey.yaml だけの「調査済み・未収録」ディレクトリは許容する
  const metaPath = join(dir, 'meta.yaml');
  if (!existsSync(metaPath)) {
    if (existsSync(join(dir, 'survey.yaml'))) {
      const sv = loadYaml(join(dir, 'survey.yaml'));
      if (sv.handle !== handle) fail(`${handle}/survey.yaml`, `handle "${sv.handle}" がディレクトリ名と不一致`);
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

  // facts (任意。読み物断片 — schema 検証 + id 一意)
  const factsPath = join(dir, 'facts.yaml');
  if (existsSync(factsPath)) {
    const facts = loadYaml(factsPath);
    if (!factsV(facts)) fail(`${handle}/facts.yaml`, ajv.errorsText(factsV.errors));
    else {
      const ids = new Set();
      for (const f of facts.facts) {
        if (ids.has(f.id)) fail(`${handle}/facts.yaml`, `fact id 重複 "${f.id}"`);
        ids.add(f.id);
      }
    }
  }

  // courses(年度ディレクトリ配下の course-*.yaml)
  for (const entry of readdirSync(dir)) {
    if (!/^\d{4}$/.test(entry)) continue;
    const yearDir = join(dir, entry);
    for (const f of readdirSync(yearDir)) {
      if (!/^course-.*\.yaml$/.test(f)) continue;
      const rel = `${handle}/${entry}/${f}`;
      const doc = loadYaml(join(yearDir, f));
      if (!scheduleV(doc)) { fail(rel, ajv.errorsText(scheduleV.errors)); continue; }
      if (doc.metadata.city !== handle) fail(rel, `metadata.city "${doc.metadata.city}" != "${handle}"`);
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
