// course YAML / taxonomy の出力と、行→コースの畳み込み (全自治体共通)。
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { stringify as yamlStringify } from 'yaml';
import { signatureKey, parsePeriod } from './schedule.mjs';

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

// course YAML 1 本を組み立てる (フィールド順を全自治体で統一)。
// period は "YYYY-MM--YYYY-MM" (収録期間 = 出力ディレクトリ名と一致させる)。
// editionJa は自治体自身の刊行物名 (例「令和7年度版」)。期間とは一致しないことがあるので
// 期間の説明には使わない (例: 東村山は 2025-10--2026-09 を「令和7年度版」と呼ぶ)。
export function courseDoc({ city, course, courseNameJa, areas, period, source, rules, overrides, unknownPeriods }) {
  if (!parsePeriod(period)) throw new Error(`courseDoc: 不正な period "${period}" (${city}/${course})`);
  const metadata = { city, course: String(course) };
  if (courseNameJa) metadata.course_name_ja = courseNameJa;
  Object.assign(metadata, { areas, period, source });
  const doc = { metadata, rules };
  if (overrides?.length) doc.overrides = overrides;
  if (unknownPeriods?.length) doc.unknown_periods = unknownPeriods;
  return doc;
}

// <outDir>/<period>/ を作り直して course YAML 群を書き出す
export function writeCourses(outDir, period, docs) {
  if (!parsePeriod(period)) throw new Error(`writeCourses: 不正な period "${period}"`);
  const dir = join(outDir, String(period));
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  for (const doc of docs) {
    writeFileSync(join(dir, `course-${doc.metadata.course}.yaml`), yamlStringify(doc, { lineWidth: 0 }));
  }
  return docs.length;
}
