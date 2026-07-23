// 全自治体の rules/taxonomy から横断比較統計を導出する。
// 出力: ics/stats.json (build:ics と同じく生成物。Pages デプロイ時に生成して配信)。
// 「全国のごみ情報を網羅的に見る」ページと、facts (読み物) の裏付けデータになる。
import { readFileSync, readdirSync, existsSync, writeFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { parse as yamlParse } from 'yaml';

const ROOT = new URL('..', import.meta.url).pathname;
const loadYaml = (p) => yamlParse(readFileSync(p, 'utf8'));
const vocab = loadYaml(join(ROOT, 'schema/categories.yaml')).categories;

const muniDir = join(ROOT, 'municipalities');
const cities = [];
for (const pref of readdirSync(muniDir).filter((p) => statSync(join(muniDir, p)).isDirectory())) {
  for (const h of readdirSync(join(muniDir, pref)).filter((x) => statSync(join(muniDir, pref, x)).isDirectory())) {
    const dir = join(muniDir, pref, h);
    if (!existsSync(join(dir, 'taxonomy.yaml'))) continue; // 調査のみ (未収録) は対象外
    const meta = loadYaml(join(dir, 'meta.yaml'));
    const tax = loadYaml(join(dir, 'taxonomy.yaml'));
    const facts = existsSync(join(dir, 'facts.yaml')) ? loadYaml(join(dir, 'facts.yaml')).facts : [];

    // 品目別の頻度 (全コースの規則から): weekly n日 / 月n回 / 実日付 の分布
    const freq = {}; // cat -> Set<表現>
    let courseCount = 0;
    let areaCount = 0;
    for (const y of readdirSync(dir).filter((e) => /^\d{4}$/.test(e))) {
      for (const f of readdirSync(join(dir, y)).filter((f) => /^course-.*\.yaml$/.test(f))) {
        courseCount++;
        const doc = loadYaml(join(dir, y, f));
        areaCount += (doc.metadata.areas || []).length;
        for (const r of doc.rules) {
          if (!freq[r.category]) freq[r.category] = new Set();
          if (r.pattern === 'weekly') freq[r.category].add(`週${r.days.length}回`);
          else if (r.pattern === 'monthly_nth') freq[r.category].add(`月${r.occurrences.length}回`);
          else if (r.pattern === 'monthly_specific') freq[r.category].add('指定日');
        }
      }
    }
    const labels = {};
    for (const c of tax.categories) {
      labels[c] = tax.overrides?.[c]?.label ?? vocab[c].label;
    }
    cities.push({
      handle: h,
      pref,
      name_ja: meta.name_ja,
      region_ja: meta.region_ja,
      courses: courseCount,
      areas: areaCount,
      categories: tax.categories,
      labels,
      groups: (tax.groups || []).map((g) => ({ label: g.label, members: g.members })),
      freq: Object.fromEntries(Object.entries(freq).map(([c, s]) => [c, [...s].sort()])),
      facts: facts.map((f) => f.id),
    });
  }
}

// 横断ビュー
const byCategory = {}; // cat -> { cities: n, labelVariants: {label: [handles]} }
for (const c of Object.keys(vocab)) {
  const using = cities.filter((x) => x.categories.includes(c));
  if (!using.length) continue;
  const variants = {};
  for (const x of using) {
    const l = x.labels[c];
    if (!variants[l]) variants[l] = [];
    variants[l].push(x.handle);
  }
  byCategory[c] = { canonical: vocab[c].label, cities: using.length, labelVariants: variants };
}

const out = {
  generated_note: 'japan-gomi-data の収録データから機械導出した横断比較。出典は各自治体の meta.yaml を参照',
  cities: cities.sort((a, b) => (a.pref + a.handle < b.pref + b.handle ? -1 : 1)),
  byCategory,
};
writeFileSync(join(ROOT, 'ics/stats.json'), JSON.stringify(out, null, 1));
console.log(`stats: ${cities.length} 自治体 → ics/stats.json (${Object.keys(byCategory).length} カテゴリ横断)`);
