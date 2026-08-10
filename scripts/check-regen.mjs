#!/usr/bin/env node
// build を実行し、生成データが git 管理下の内容と一致するかを確認する。
//
// なぜ要るか: 2026-08-10 に extractor 8 本を修復した際、安全確認はすべて
// 「一次ソースを取り直して再生成し、既存データと差分ゼロ」で行った。この手順を
// 15 回手で回した。あわせて「生成物への手編集」も 3 件見つかっている
// (調布 meta の 1 行・入間 taxonomy の groups・所沢の source.edition_ja)。
// 手編集は再生成すると消えるので、この検査が唯一の検出手段になる。
//
// cache と一次ソースが要るので CI では回せない。PR を出す前のローカルゲート。
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const isDir = (p) => existsSync(p) && statSync(p).isDirectory();

// handle → { dir, kind } (extractor 名が handle と一致するものだけ)
function extractors() {
  const out = new Map();
  for (const kind of readdirSync(join(ROOT, 'tools')).filter((k) => k.endsWith('-extractor'))) {
    for (const name of readdirSync(join(ROOT, 'tools', kind)).filter((n) => isDir(join(ROOT, 'tools', kind, n)))) {
      if (!existsSync(join(ROOT, 'tools', kind, name, 'build.mjs'))) continue;
      out.set(name, { dir: join('tools', kind, name), kind });
    }
  }
  return out;
}

function municipalityDir(handle) {
  const muni = join(ROOT, 'municipalities');
  for (const pref of readdirSync(muni).filter((p) => isDir(join(muni, p)))) {
    if (isDir(join(muni, pref, handle))) return join('municipalities', pref, handle);
  }
  return null;
}

// build が要求する環境変数を、既存データの extracted_at から復元する。
// Date.now() を使わない規約のため、build は EXTRACTED_AT を要求することがある。
function extractedAt(muniDir) {
  const abs = join(ROOT, muniDir);
  for (const entry of readdirSync(abs)) {
    if (!/^\d{4}-\d{2}--\d{4}-\d{2}$/.test(entry)) continue;
    for (const f of readdirSync(join(abs, entry))) {
      if (!f.startsWith('course-')) continue;
      const m = /extracted_at:\s*'?(\d{4}-\d{2}-\d{2})'?/.exec(
        readFileSync(join(abs, entry, f), 'utf8'));
      if (m) return m[1];
    }
  }
  return null;
}

// 使い方: node scripts/check-regen.mjs [handle...]
// 引数省略時は cache を持つ全自治体が対象。共通ツール (chichibu-koiki・saiseibu-kumiai 等、
// municipalities に対応物を持たないもの) は既定の対象からは除く。ただし handle を明示指定
// された場合は打ち間違いを検出するため、対応が無ければそのまま失敗させる。
const args = process.argv.slice(2);
const badOpt = args.find((a) => a.startsWith('-'));
if (badOpt) {
  console.error(`不明なオプション: ${badOpt}`);
  console.error('使い方: node scripts/check-regen.mjs [handle...]');
  process.exit(1);
}
const all = extractors();
const handles = args.length ? args : [...all.keys()].filter((h) => municipalityDir(h)).sort();

let ran = 0, skipped = 0, failed = 0;
for (const handle of handles) {
  const ex = all.get(handle);
  if (!ex) { console.error(`✗ ${handle}: build.mjs を持つ extractor が無い`); failed++; continue; }
  const muniDir = municipalityDir(handle);
  if (!muniDir) { console.error(`✗ ${handle}: municipalities に見つからない`); failed++; continue; }
  if (!isDir(join(ROOT, ex.dir, 'cache'))) {
    console.log(`- ${handle}: cache が無いので skip (make fetch HANDLE=${handle} で取得できる)`);
    skipped++; continue;
  }

  const at = extractedAt(muniDir);
  try {
    execFileSync(process.execPath, [join(ROOT, ex.dir, 'build.mjs')], {
      cwd: ROOT, stdio: 'pipe',
      env: { ...process.env, ...(at ? { EXTRACTED_AT: at } : {}) },
    });
  } catch (e) {
    console.error(`✗ ${handle}: build 失敗\n${String(e.stderr ?? e).split('\n').slice(0, 5).join('\n')}`);
    failed++; continue;
  }

  const diff = execFileSync('git', ['status', '--porcelain', '--', muniDir], { cwd: ROOT, encoding: 'utf8' }).trim();
  ran++;
  if (diff) {
    console.error(`✗ ${handle}: 再生成で差分が出た`);
    console.error(diff.split('\n').map((l) => '    ' + l).join('\n'));
    console.error('    生成物を手編集したか、cache が古いか、一次ソースが更新された可能性がある。');
    console.error(`    git diff -- ${muniDir} で中身を確認すること。`);
    failed++;
  } else {
    console.log(`✓ ${handle}: 再生成で差分なし`);
  }
}

console.log(`\n実行 ${ran} / skip ${skipped} / 失敗 ${failed}`);
process.exit(failed ? 1 : 0);
