#!/usr/bin/env node
// extractor の「腐り」検査。ネットワークも cache も要らない静的検査だけを行う。
//
// なぜ要るか: 2026-08-10 に、収録期間ディレクトリ移行 (d20ae49) の追従漏れで
// build/verify 計 7 本が実行不能・参照先消失のまま数週間放置されていたのが見つかった。
// データは正しいので npm test は通り、extractor は CI で実行しないので誰も気づけなかった。
// 一次ソースを取り直さないと本当の意味の smoke test はできないが、
// 「消えたディレクトリを指している」「構文が壊れている」程度なら静的に捕まえられる。
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { PERIOD_RE } from '../tools/_lib/schedule.mjs';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const errors = [];
const fail = (where, msg) => errors.push(`${where}: ${msg}`);
const isDir = (p) => existsSync(p) && statSync(p).isDirectory();

// --- 収録済み自治体の期間ディレクトリ一覧 (handle → [period]) ---
const periodsOf = new Map();
const muni = join(ROOT, 'municipalities');
for (const pref of readdirSync(muni).filter((p) => isDir(join(muni, p)))) {
  for (const h of readdirSync(join(muni, pref)).filter((h) => isDir(join(muni, pref, h)))) {
    const ps = readdirSync(join(muni, pref, h)).filter((n) => PERIOD_RE.test(n));
    if (ps.length) periodsOf.set(h, ps);
  }
}

// --- extractor のソースを走査 ---
const toolDirs = [];
for (const kind of readdirSync(join(ROOT, 'tools')).filter((k) => k.endsWith('-extractor'))) {
  for (const h of readdirSync(join(ROOT, 'tools', kind)).filter((h) => isDir(join(ROOT, 'tools', kind, h)))) {
    toolDirs.push({ kind, handle: h, dir: join(ROOT, 'tools', kind, h) });
  }
}

let checkedFiles = 0, checkedPeriods = 0;
for (const { handle, dir } of toolDirs) {
  const files = readdirSync(dir).filter((f) => f.endsWith('.mjs') || f.endsWith('.py'));
  for (const f of files) {
    const rel = relative(ROOT, join(dir, f));
    const src = readFileSync(join(dir, f), 'utf8');

    // (1) 構文検査 (mjs のみ)。切り詰めや括弧の壊れを拾う
    if (f.endsWith('.mjs')) {
      checkedFiles++;
      try {
        execFileSync(process.execPath, ['--check', join(dir, f)], { stdio: 'pipe' });
      } catch (e) {
        fail(rel, `構文エラー: ${String(e.stderr ?? e).split('\n').find((l) => l.trim()) ?? e}`);
      }
    }

    // (2) 収録期間ディレクトリの参照が実在するか。
    // 対象は「PERIOD 系の定数」と「municipalities/… を含む文字列」だけに絞る —
    // 説明文の中の期間表記 (「次版が出たら 2026-10--2027-09/ を作る」等) を
    // 誤検出しないため。
    const known = periodsOf.get(handle);
    if (known) { // extractor 名 = handle でない共通ツール (chichibu-koiki 等) は対象外
      // PERIOD 系の定数は「値が収録期間の形であること」も見る。
      // 形が違うとただ数から外れるだけで見逃す (const PERIOD = '2026' が素通りしていた)。
      for (const m of src.matchAll(/(?:^|\b(?:const|let|var)\s+)(\w*PERIOD\w*)\s*=\s*['"`]([^'"`]*)['"`]/gim)) {
        checkedPeriods++;
        if (!PERIOD_RE.test(m[2])) {
          fail(rel, `${m[1]} = "${m[2]}" が収録期間の形 (YYYY-MM--YYYY-MM) でない`);
        } else if (!known.includes(m[2])) {
          fail(rel, `収録期間 "${m[2]}" のディレクトリが municipalities に無い (実在: ${known.join(', ')})`);
        }
      }
      // パス文字列に埋め込まれた期間も実在を見る
      for (const m of src.matchAll(/municipalities[^\n'"`]*?(\d{4}-\d{2}--\d{4}-\d{2})/g)) {
        checkedPeriods++;
        if (!known.includes(m[1])) {
          fail(rel, `収録期間 "${m[1]}" のディレクトリが municipalities に無い (実在: ${known.join(', ')})`);
        }
      }
    }

    // (3) 年ディレクトリの直書きが残っていないか (期間ディレクトリ移行の取り残し)
    for (const m of src.matchAll(/municipalities[^\n'"`]*['"`,\s]+['"`](\d{4})['"`]/g)) {
      fail(rel, `年ディレクトリ "${m[1]}" を直接参照している (収録期間ディレクトリへ移行済み)`);
    }
    for (const m of src.matchAll(/municipalities\/[a-z-]+\/[a-z-]+\/(\d{4})['"`/]/g)) {
      fail(rel, `年ディレクトリ "${m[1]}" を直接参照している (収録期間ディレクトリへ移行済み)`);
    }
  }
}

// --- scripts/ と _lib の構文も見ておく ---
for (const d of [join(ROOT, 'scripts'), join(ROOT, 'tools', '_lib'), join(ROOT, 'tools', '_template')]) {
  for (const f of readdirSync(d).filter((f) => f.endsWith('.mjs'))) {
    checkedFiles++;
    try {
      execFileSync(process.execPath, ['--check', join(d, f)], { stdio: 'pipe' });
    } catch (e) {
      fail(relative(ROOT, join(d, f)), `構文エラー: ${String(e.stderr ?? e).split('\n').find((l) => l.trim()) ?? e}`);
    }
  }
}

if (errors.length) {
  console.error(`✗ extractor 検査 ${errors.length} 件:`);
  for (const e of errors) console.error('  - ' + e);
  process.exit(1);
}
console.log(`✓ extractor 検査 OK (${toolDirs.length} extractor / ${checkedFiles} ファイル構文 / ${checkedPeriods} 期間参照)`);
