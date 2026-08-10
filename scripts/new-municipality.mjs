#!/usr/bin/env node
// 新しい自治体の足場を作る。
//   municipalities/<pref>/<handle>/survey.yaml   (無ければ雛形)
//   tools/<kind>-extractor/<handle>/             (_template を展開)
//   同ディレクトリの .gitignore に cache/
//
// 2026-08-10 に西東京を収録した際、この 3 つを手作業で用意した。毎回同じなので固定する。
// handle は自分で綴りを考えず必ずレジストリで引く (playbook §0)。
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lookupMunicipality } from '../tools/_lib/registry.mjs';
import { PERIOD_RE } from '../tools/_lib/schedule.mjs';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const KINDS = ['html', 'pdf', 'csv', 'txt', 'api'];
const USAGE = '使い方: node scripts/new-municipality.mjs --handle <handle> --pref <都道府県romaji> --kind <html|pdf|csv|txt|api> [--period YYYY-MM--YYYY-MM]';

// 未知のオプションは黙って捨てず、使い方を出して落とす (scripts/check-regen.mjs と同じ体裁)。
const KNOWN_OPTS = ['--handle', '--pref', '--kind', '--period'];
const badOpt = process.argv.slice(2).filter((a) => a.startsWith('-')).find((a) => !KNOWN_OPTS.includes(a));
if (badOpt) {
  console.error(`不明なオプション: ${badOpt}`);
  console.error(USAGE);
  process.exit(1);
}

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const handleArg = arg('handle');
const pref = arg('pref');
const kind = arg('kind');
const period = arg('period') ?? '2026-04--2027-03';

if (!handleArg || !pref || !kind) {
  console.error(USAGE);
  console.error('  handle はレジストリで検証される。自分で綴りを考えないこと。');
  console.error('  pref は municipalities/ のディレクトリ名 (tokyo / saitama / hokkaido …)。');
  process.exit(1);
}
if (!KINDS.includes(kind)) throw new Error(`--kind は ${KINDS.join('|')} のいずれか (指定: ${kind})`);
if (!PERIOD_RE.test(period)) throw new Error(`--period は YYYY-MM--YYYY-MM (指定: ${period})`);
if (!/^[a-z-]+$/.test(pref)) throw new Error(`--pref は romaji の小文字 (指定: ${pref})`);

const reg = await lookupMunicipality(handleArg);
const handle = reg.handle;
console.log(`レジストリ: ${reg.name_ja} (code ${reg.code} / handle ${handle})`);

// --pref の取り違えを団体コード先頭 2 桁で検出する。
// 既存の municipalities/<pref>/ に居る自治体と先頭 2 桁が食い違えば落とす。
const prefDir = join(ROOT, 'municipalities', pref);
if (existsSync(prefDir)) {
  const codes = new Set();
  for (const h of readdirSync(prefDir).filter((h) => statSync(join(prefDir, h)).isDirectory())) {
    const sv = join(prefDir, h, 'survey.yaml');
    if (!existsSync(sv)) continue;
    const m = /^code:\s*'?(\d{2})/m.exec(readFileSync(sv, 'utf8'));
    if (m) codes.add(m[1]);
  }
  const mine = String(reg.code).slice(0, 2);
  if (codes.size && !codes.has(mine)) {
    throw new Error(`--pref ${pref} は団体コード ${mine}xxxx と食い違う (そこに居るのは ${[...codes].join(',')}xxxx)`);
  }
}

// --- 1. municipalities/<pref>/<handle>/survey.yaml ---
const muniDir = join(ROOT, 'municipalities', pref, handle);
mkdirSync(muniDir, { recursive: true });
const surveyPath = join(muniDir, 'survey.yaml');
if (existsSync(surveyPath)) {
  console.log(`既存: ${surveyPath} (触らない — 調査済みの内容を読むこと)`);
} else {
  writeFileSync(surveyPath,
    '# 収集日データの公開状況サーベイ (正典)。docs/triage/ はここから生成される。\n' +
    '# 収録作業の起点: 一次ソース・形式・粒度・罠は notes に書く。\n' +
    `code: '${reg.code}'\n` +
    `handle: ${handle}\n` +
    `name_ja: ${reg.name_ja}\n` +
    'source_type: unknown      # csv | json | html | pdf | txt | api | none\n' +
    'schedule_url:             # 収集日程の案内ページ (PDF/CSV 直リンクではなくページ)\n' +
    'license: unknown          # cc-by | pdl | proprietary-site | unknown\n' +
    'difficulty: 0             # 1(易) 〜 5(難)\n' +
    'granularity: unknown      # dates | weekday-rules | partial | none\n' +
    'district_unit:\n' +
    'district_count_approx:\n' +
    'yearend: unknown          # calendar-explicit | announced | unknown\n' +
    "notes: '調査中'\n" +
    `surveyed_at: ''           # 調査した日 (YYYY-MM-DD)\n`);
  console.log(`作成: municipalities/${pref}/${handle}/survey.yaml`);
}

// --- 2. tools/<kind>-extractor/<handle>/ ---
const toolDir = join(ROOT, 'tools', `${kind}-extractor`, handle);
if (existsSync(toolDir)) {
  console.log(`既存: tools/${kind}-extractor/${handle}/ (触らない)`);
} else {
  mkdirSync(toolDir, { recursive: true });
  const tpl = join(ROOT, 'tools', '_template');
  for (const f of readdirSync(tpl).filter((f) => statSync(join(tpl, f)).isFile())) {
    // 置換は定数の宣言行だけを狙う。source: ブロックの CHANGEME (edition_ja / source_url /
    // extracted_by / verified_by) は一次ソースを調べてから人が埋める欄なので、
    // 埋め忘れに気づけるよう CHANGEME のまま残す。
    const body = readFileSync(join(tpl, f), 'utf8')
      .replaceAll("const HANDLE = 'CHANGEME';", `const HANDLE = '${handle}';`)
      .replaceAll("const PREF = 'CHANGEME';", `const PREF = '${pref}';`)
      .replaceAll("const PERIOD = '2026-04--2027-03';", `const PERIOD = '${period}';`);
    writeFileSync(join(toolDir, f), body);
  }
  writeFileSync(join(toolDir, '.gitignore'),
    '# fetch で再取得できる一次ソースのスナップショット (他の extractor と同様に非追跡)\n' +
    'cache/\n__pycache__/\n');
  console.log(`作成: tools/${kind}-extractor/${handle}/ (_template を展開)`);
}

console.log('\n次にやること:');
console.log(`  1. docs/playbook.md §1 に従って一次ソースを探し、survey.yaml を埋める`);
console.log(`  2. 調査結果を報告して承認を得る (何を一次ソースにし、何で独立照合するか)`);
console.log(`  3. tools/${kind}-extractor/${handle}/ の fetch/build/verify を実装する`);
console.log(`  4. make regen HANDLE=${handle} と make test を通す`);
