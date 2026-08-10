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
//
// 対象は「収録済み自治体 (course-*.yaml を持つもの) 全件」で、1 件たりとも
// 沈黙で結果から消さない。extractor 名が handle と一致する「直接対応」に加えて、
// 複数自治体を 1 本の生成器で束ねる「共通 extractor」(秩父広域・埼玉西部環境保全組合等)
// の配下の自治体も config.json から宣言的に引いて対象に含める。対応表は
// ハードコードしない (将来組合に自治体が増えても沈黙で消えないようにするため)。
// 生成器そのものが無い自治体 (データを手書きした収録) は検査しようがないので skip する。
// ただし build.mjs 規約に乗っていないだけで生成器 (Python 等) が実在する場合は、
// 「データは手書き」という偽の理由を出さないよう、skip の文言を区別する。
import { readdirSync, readFileSync, existsSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const isDir = (p) => existsSync(p) && statSync(p).isDirectory();
const gitStatus = (dir) =>
  execFileSync('git', ['status', '--porcelain', '--', dir], { cwd: ROOT, encoding: 'utf8' }).trim();

function municipalityDir(handle) {
  const muni = join(ROOT, 'municipalities');
  for (const pref of readdirSync(muni).filter((p) => isDir(join(muni, p)))) {
    if (isDir(join(muni, pref, handle))) return join('municipalities', pref, handle);
  }
  return null;
}

// 収録済み自治体の正典リスト: municipalities/*/*/<収録期間>/course-*.yaml を持つもの全件。
// これが「本来検査対象になり得る全数」の基準になる (最後にこの件数と内訳合計を突き合わせる)。
function collectedHandles() {
  const muni = join(ROOT, 'municipalities');
  const out = [];
  for (const pref of readdirSync(muni).filter((p) => isDir(join(muni, p)))) {
    for (const handle of readdirSync(join(muni, pref)).filter((h) => isDir(join(muni, pref, h)))) {
      const dir = join(muni, pref, handle);
      const hasCourse = readdirSync(dir)
        .filter((entry) => /^\d{4}-\d{2}--\d{4}-\d{2}$/.test(entry) && isDir(join(dir, entry)))
        .some((entry) => readdirSync(join(dir, entry)).some((f) => f.startsWith('course-') && f.endsWith('.yaml')));
      if (hasCourse) out.push(handle);
    }
  }
  return out.sort();
}

// 直接対応: extractor ディレクトリ名が handle と一致し、build.mjs を持つもの。
function directExtractors() {
  const out = new Map();
  for (const kind of readdirSync(join(ROOT, 'tools')).filter((k) => k.endsWith('-extractor'))) {
    for (const name of readdirSync(join(ROOT, 'tools', kind)).filter((n) => isDir(join(ROOT, 'tools', kind, n)))) {
      if (!existsSync(join(ROOT, 'tools', kind, name, 'build.mjs'))) continue;
      if (!municipalityDir(name)) continue; // 単独 handle と一致しないものは共通 extractor 側で扱う
      out.set(name, { dir: join('tools', kind, name), kind });
    }
  }
  return out;
}

// 共通 extractor: ディレクトリ名がどの handle とも一致しない (municipalityDir が無い) が
// build.mjs を持つもの。config.json から対象 handle を読む。2 つの形を許す:
//   1. { municipalities: { <handle>: { districts: [{ pdf: 'cache/...', ... }, ...], ... } } }
//      (例: chichibu-koiki。districts[].pdf が cache 内の相対パスを宣言している)
//   2. { <handle>: { ... }, _comment: '...' }  (フラット。_ 始まりのキーは無視)
//      (例: saiseibu-kumiai。cache/<handle>-records.json を読む生成器)
// どちらの形かは config.json の中身から判定する (対応表を手で書かない)。
// config.json が読めない異常時に、「本来この extractor がカバーするはずだった
// (=黙殺すると『データは手書き』という偽の理由で skip されるはずだった) 自治体」を
// エラーメッセージに含めるための最善努力の推測。config.json の名前とカバーする handle
// (例: chichibu-koiki ⇔ chichibu/yokoze-town/…) には命名上の関係が無いことがあるので、
// 直接読めないなら git 管理下の最終正常版 (HEAD) を読んで宣言を辿る。
function guessAffectedHandles(dir) {
  try {
    const raw = execFileSync('git', ['show', `HEAD:${dir}/config.json`], { cwd: ROOT, encoding: 'utf8' });
    const conf = JSON.parse(raw);
    const muniMap = (conf && typeof conf.municipalities === 'object' && conf.municipalities) || conf;
    if (!muniMap || typeof muniMap !== 'object') return [];
    return Object.keys(muniMap).filter((h) => !h.startsWith('_'));
  } catch {
    return [];
  }
}

function sharedCoverage(direct) {
  const out = new Map(); // handle -> { dir, kind, buildArgs, hasCache }
  for (const kind of readdirSync(join(ROOT, 'tools')).filter((k) => k.endsWith('-extractor'))) {
    for (const name of readdirSync(join(ROOT, 'tools', kind)).filter((n) => isDir(join(ROOT, 'tools', kind, n)))) {
      const dir = join('tools', kind, name);
      if (!existsSync(join(ROOT, dir, 'build.mjs'))) continue;
      if (municipalityDir(name)) continue; // 直接対応済み

      // ここに到達した時点で「build.mjs はあるが単独 handle とは一致しない共通 extractor
      // 候補」であることが確定している。その候補で宣言 (config.json) が読めないのは
      // 異常事態であり、黙って飛ばすと配下の自治体が「生成器が無い (データは手書き)」という
      // 事実と異なる理由で skip される (AGENTS.md の不変条件「未対応の表記は throw する」
      // に反する: この検査は生成物の手編集を見つける唯一の手段なので、壊れた設定を
      // 静かに無視して「検査しました」と見せるのが最も避けたい壊れ方)。
      const guess = guessAffectedHandles(dir);
      const affected = guess.length
        ? `git HEAD の config.json から推測される影響先: ${guess.join(', ')} (黙殺すると「生成器が無い(データは手書き)」と誤表示されるところだった)`
        : '影響先を推測できなかった (git HEAD にも読める config.json が無い)';

      const confPath = join(ROOT, dir, 'config.json');
      if (!existsSync(confPath)) {
        throw new Error(`${dir}: build.mjs はあるが config.json が無く、対象 handle を宣言的に読めない。${affected}`);
      }

      let conf;
      try {
        conf = JSON.parse(readFileSync(confPath, 'utf8'));
      } catch (e) {
        throw new Error(`${dir}/config.json の JSON パースに失敗した (${e.message})。${affected}`);
      }
      const isPlainObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
      const muniMap = (isPlainObj(conf) && isPlainObj(conf.municipalities) && conf.municipalities) || conf;
      if (!isPlainObj(muniMap)) {
        throw new Error(`${dir}/config.json の形が想定外 (.municipalities オブジェクトにも、_ 始まり以外を handle として持つフラットオブジェクトにもならない: ${JSON.stringify(conf).slice(0, 80)})。${affected}`);
      }

      for (const [handle, entry] of Object.entries(muniMap)) {
        if (handle.startsWith('_')) continue;
        if (!municipalityDir(handle)) continue; // municipalities に対応が無いキーは対象外
        if (direct.has(handle) || out.has(handle)) continue; // 二重登録は先勝ち

        const districts = entry && Array.isArray(entry.districts) ? entry.districts : null;
        const pdfPaths = districts && districts.every((d) => d && typeof d.pdf === 'string')
          ? districts.map((d) => join(ROOT, dir, d.pdf))
          : null;

        const hasCache = () => {
          if (pdfPaths) return pdfPaths.every((p) => existsSync(p));
          return existsSync(join(ROOT, dir, 'cache', `${handle}-records.json`));
        };

        out.set(handle, { dir, kind, buildArgs: [handle], hasCache });
      }
    }
  }
  return out;
}

// resolveExtractor が null を返す handle について、「本当に生成器が無い」のか
// 「build.mjs 規約に乗っていないだけで生成器 (Python 等) は実在する」のかを、
// ディレクトリの実在で機械的に見分ける。handle 名はハードコードしない —
// tools/*-extractor/ を走査し、ディレクトリ名が handle に一致するか、
// handle が「ディレクトリ名 + '-'」で始まる (例: 上富良野の extractor ディレクトリ名は
// kamifurano だが handle は kamifurano-town、というような命名の揺れ) ものを探す。
// build.mjs を持つディレクトリは direct/shared 側で既に解決されているはずなので除く。
function extractorTraceWithoutBuild(handle) {
  for (const kind of readdirSync(join(ROOT, 'tools')).filter((k) => k.endsWith('-extractor'))) {
    for (const name of readdirSync(join(ROOT, 'tools', kind)).filter((n) => isDir(join(ROOT, 'tools', kind, n)))) {
      if (name !== handle && !handle.startsWith(`${name}-`)) continue;
      if (existsSync(join(ROOT, 'tools', kind, name, 'build.mjs'))) continue;
      return join('tools', kind, name);
    }
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
// 引数省略時は収録済み全自治体が対象 (cache が無ければ skip、生成器が無ければ skip、
// いずれも理由つきで 1 行ずつ出す)。handle を明示指定した場合は打ち間違いを検出するため、
// municipalities に無ければそのまま失敗させる。
const args = process.argv.slice(2);
const badOpt = args.find((a) => a.startsWith('-'));
if (badOpt) {
  console.error(`不明なオプション: ${badOpt}`);
  console.error('使い方: node scripts/check-regen.mjs [handle...]');
  process.exit(1);
}

const collected = collectedHandles();
const direct = directExtractors();
const shared = sharedCoverage(direct);
function resolveExtractor(handle) {
  if (direct.has(handle)) {
    const ex = direct.get(handle);
    return { dir: ex.dir, kind: ex.kind, buildArgs: [], hasCache: () => isDir(join(ROOT, ex.dir, 'cache')) };
  }
  if (shared.has(handle)) return shared.get(handle);
  return null;
}

const explicit = args.length > 0;
const handles = explicit ? args : collected;

let checked = 0, skipped = 0, failed = 0;
for (const handle of handles) {
  const muniDir = municipalityDir(handle);
  if (!muniDir) {
    console.error(`✗ ${handle}: municipalities に見つからない`);
    failed++; continue;
  }

  const res = resolveExtractor(handle);
  if (!res) {
    const trace = extractorTraceWithoutBuild(handle);
    if (trace) {
      console.log(`- ${handle}: build.mjs が無い (${trace}/ に生成器はあるが regen 非対応) — skip`);
    } else {
      console.log(`- ${handle}: 生成器が無い (データは手書き) — skip`);
    }
    skipped++; continue;
  }

  if (!res.hasCache()) {
    console.log(`- ${handle}: cache が無いので skip (${res.dir}/cache を用意すること)`);
    skipped++; continue;
  }

  // build を走らせる前に作業ツリーの状態を見る。build 後の差分だけを見ていた頃は
  // 「build が書いた差分」と「元からあった未コミットの変更」を区別できず、
  // 後者に対して「git checkout -- で戻せ」と案内していた = 作業を壊す指示だった。
  // meta.yaml / taxonomy.yaml は生成しない extractor があり (その場合は手書きが正典)、
  // それらを編集中に regen を叩くのは普通に起きる。
  const before = gitStatus(muniDir);
  if (before) {
    const lines = before.split('\n');
    if (lines.every((l) => l.startsWith('?? '))) {
      // ディレクトリ全体が未追跡 = まだコミットしていない新規収録。比較対象が git に無い。
      console.error(`✗ ${handle}: 未コミットの新規収録 — 比較対象がまだ無い`);
      console.error(lines.map((l) => '    ' + l).join('\n'));
      console.error('    手編集や cache の問題ではない。コミットしてから再実行すること。');
    } else {
      console.error(`✗ ${handle}: 未コミットの変更があるので実行しない`);
      console.error(lines.map((l) => '    ' + l).join('\n'));
      console.error('    make regen は build を実際に走らせて作業ツリーを書き換えるため、');
      console.error('    このまま実行すると作業中の変更を壊す。');
      console.error('    先にコミットするか git stash してから再実行すること。');
    }
    failed++; continue;
  }

  const at = extractedAt(muniDir);
  try {
    execFileSync(process.execPath, [join(ROOT, res.dir, 'build.mjs'), ...res.buildArgs], {
      cwd: ROOT, stdio: 'pipe',
      env: { ...process.env, ...(at ? { EXTRACTED_AT: at } : {}) },
    });
  } catch (e) {
    console.error(`✗ ${handle}: build 失敗\n${String(e.stderr ?? e).split('\n').slice(0, 5).join('\n')}`);
    failed++; continue;
  }

  const diff = gitStatus(muniDir);
  if (diff) {
    // 実行前は clean だったことを上で確認済みなので、ここの差分はすべて build の出力。
    // 作業中の変更が混ざる余地が無いため、保存してから安全に元へ戻せる。
    const diffLines = diff.split('\n');
    console.error(`✗ ${handle}: 再生成で差分が出た`);
    console.error(diffLines.map((l) => '    ' + l).join('\n'));
    console.error('    生成物を手編集したか、cache が古いか、一次ソースが更新された可能性がある。');

    const saved = join(tmpdir(), `regen-diff-${handle}.diff`);
    writeFileSync(saved, execFileSync('git', ['diff', '--', muniDir], { cwd: ROOT, encoding: 'utf8' }));
    execFileSync('git', ['checkout', '--', muniDir], { cwd: ROOT });
    console.error(`    差分は ${saved} に保存し、作業ツリーは元に戻した。`);

    // git checkout は未追跡ファイルを消さない。build が新しいファイルを作った場合は残る。
    const leftover = diffLines.filter((l) => l.startsWith('?? '));
    if (leftover.length) {
      console.error('    次のファイルは build が新規に作ったもので、作業ツリーに残っている:');
      console.error(leftover.map((l) => '      ' + l.slice(3)).join('\n'));
    }
    failed++;
  } else {
    console.log(`✓ ${handle}: 再生成で差分なし`);
    checked++;
  }
}

const total = checked + skipped + failed;
console.log(`\n検査 ${checked} / skip ${skipped} / 失敗 ${failed}、収録済み合計 = ${total}`);
if (!explicit && total !== handles.length) {
  console.error(`✗ 内訳合計が収録済み件数と一致しない: ${total} ≠ ${handles.length} (どこかで自治体が沈黙で消えている)`);
  failed++;
}
process.exit(failed ? 1 : 0);
