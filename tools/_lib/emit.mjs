// course YAML / taxonomy の出力と、行→コースの畳み込み (全自治体共通)。
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { stringify as yamlStringify } from 'yaml';
import { signatureKey } from './schedule.mjs';

// 同一日程の行を 1 コースに畳む。
// rows: 任意の行配列 / toRules(row) → rules / toArea(row) → {name, yomi}
// 返り値: [{ rules, areas }] (出現順を保った署名順)
export function foldCourses(rows, toRules, toArea) {
  const bySig = new Map();
  for (const row of rows) {
    const rules = toRules(row);
    const sig = signatureKey(rules);
    if (!bySig.has(sig)) bySig.set(sig, { rules, areas: [] });
    bySig.get(sig).areas.push(toArea(row));
  }
  return [...bySig.values()];
}

// course YAML 1 本を組み立てる (フィールド順を全自治体で統一)
export function courseDoc({ city, course, courseNameJa, areas, year, fiscalYearJa, source, rules, overrides }) {
  const metadata = { city, course: String(course) };
  if (courseNameJa) metadata.course_name_ja = courseNameJa;
  Object.assign(metadata, { areas, year, fiscal_year_ja: fiscalYearJa, source });
  const doc = { metadata, rules };
  if (overrides?.length) doc.overrides = overrides;
  return doc;
}

// <outDir>/<year>/ を作り直して course YAML 群を書き出す
export function writeCourses(outDir, year, docs) {
  const dir = join(outDir, String(year));
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  for (const doc of docs) {
    writeFileSync(join(dir, `course-${doc.metadata.course}.yaml`), yamlStringify(doc, { lineWidth: 0 }));
  }
  return docs.length;
}
