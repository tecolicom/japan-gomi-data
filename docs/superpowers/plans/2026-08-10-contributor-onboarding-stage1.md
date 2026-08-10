# 貢献者オンボーディング 第1段 (入口と足場) 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** クローンした人が `make help` から始めて、エージェントか手作業で自分の町を収録できる入口と足場を用意する。

**Architecture:** 知識は既存の `docs/playbook.md` に残したまま、進行管理だけを skill に切り出す。`AGENTS.md` を事実の単一の実体とし、`CLAUDE.md` はそこへの symlink にして drift を構造的に防ぐ。人間の入口は `Makefile`、実装は npm scripts に置き、CI は npm を直接叩く。

**Tech Stack:** Node.js 22 (ESM)、npm scripts、GNU make、ESLint 10、`yaml` パッケージ。新しい依存は追加しない。

設計: `docs/2026-08-10-contributor-onboarding-design.md`

## Global Constraints

- **schema を変更しない。** `provenance` / `confidence` / `summary` は第2段で扱う。
- **既存の生成データを変更しない。** 各タスク末で `git status --short municipalities/` が空であること。
- **`Date.now()` 禁止。** 日付が要るものは環境変数か引数で受ける (既存規約)。
- **`git add -A` 禁止。** コミットは必ずファイルを指定する (同一作業ツリーを他セッションが使う)。
- **未対応の入力は握りつぶさず throw する** (既存規約)。
- **Windows 非対応。** symlink を使う。
- 新規 `.mjs` は `npm test` の ESLint (`no-undef` / `no-unused-vars`) を通ること。
- 日本語の文章は「です・ます」調ではなく既存ドキュメントの体裁 (常体・箇条書き) に合わせる。

---

### Task 1: `make regen` — 再生成して差分ゼロを確認する

最初に作る。以降のタスクすべてで「データを壊していないこと」の確認に使う。

**Files:**
- Create: `scripts/check-regen.mjs`
- Modify: `package.json` (scripts に `regen` を追加)

**Interfaces:**
- Produces: `node scripts/check-regen.mjs <handle>` … 終了コード 0 = 差分なし / 1 = 差分あり or 実行失敗。
  `<handle>` 省略時は cache を持つ全自治体を対象にする。

- [ ] **Step 1: 仕様を決めるための調査**

extractor と自治体の対応を機械的に求める必要がある。次を実行して、対応の付け方を確認する。

```bash
ls -d tools/*-extractor/*/ | head -30
ls -d municipalities/*/*/ | head -5
```

対応規則: `tools/<kind>-extractor/<name>/` の `<name>` が `municipalities/<pref>/<name>/` に
存在すれば同一自治体とみなす。存在しなければ共通ツール (`chichibu-koiki`・`saiseibu-kumiai`) と
みなして対象外にする。これは `scripts/check-tools.mjs` が既に使っている規則と同じ。

- [ ] **Step 2: `scripts/check-regen.mjs` を書く**

```javascript
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

const targets = process.argv.slice(2).filter((a) => !a.startsWith('-'));
const all = extractors();
const handles = targets.length ? targets : [...all.keys()].sort();

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
```

- [ ] **Step 3: cache のある自治体で通ることを確認する**

```bash
node scripts/check-regen.mjs chofu
```

期待: `✓ chofu: 再生成で差分なし` と出て終了コード 0。

- [ ] **Step 4: 差分を検出できることを確認する**

**手編集は「コミットされている」状態でなければ検出できない。** 作業ツリーを書き換えただけでは、
check-regen が走らせる build がその場で正しい内容を再生成してしまい、HEAD と一致するので
差分は出ない (それが正しい挙動)。手編集がリポジトリに入るのはコミット経由なので、
コミットした状態を作って確かめる。

```bash
sed -i '' 's|^  - 祝日(振替休日含む)・お盆も通常どおり収集。休みは日曜と年末年始のみ。$|  - 手編集テスト (この行は生成器に無い)|' municipalities/tokyo/chofu/meta.yaml
git add municipalities/tokyo/chofu/meta.yaml
git commit -q -m "TEMP: 手編集を模擬 (検証用・直後に破棄)"
node scripts/check-regen.mjs chofu; echo "exit=$?"
git reset --hard HEAD~1
node scripts/check-regen.mjs chofu; echo "exit=$?"
```

期待: 1 回目は `✗ chofu: 再生成で差分が出た` と `M municipalities/tokyo/chofu/meta.yaml` が出て `exit=1`。
`git reset --hard` の後は `✓ chofu: 再生成で差分なし` で `exit=0`。

**`git reset --hard` を忘れないこと。** 忘れると偽の手編集がブランチに残る。

- [ ] **Step 5: cache が無い自治体で skip されることを確認する**

```bash
node scripts/check-regen.mjs kawaguchi
```

期待: cache があれば `✓`、無ければ `- kawaguchi: cache が無いので skip`。どちらでも終了コード 0。

- [ ] **Step 6: package.json に登録する**

`scripts` に次を追加する。

```json
"regen": "node scripts/check-regen.mjs"
```

- [ ] **Step 7: ESLint と全体テストを通す**

```bash
npm test
```

期待: `✓ 検証 OK` `✓ extractor 検査 OK` `# fail 0`。ESLint エラーが出たら未使用変数を消す。

- [ ] **Step 8: コミット**

```bash
git add scripts/check-regen.mjs package.json
git commit -m "feat(tools): 再生成して差分ゼロを確認する make regen を追加

2026-08-10 の extractor 修復では、安全確認をすべて「一次ソースを取り直して
再生成し既存データと差分ゼロ」で行い、この手順を 15 回手で回した。
あわせて生成物への手編集も 3 件見つかっている (再生成でしか検出できない)。
その手順を scripts/check-regen.mjs に固定する。

cache と一次ソースが要るので CI では回せない。PR 前のローカルゲートとする。
build が要求する EXTRACTED_AT は既存 course の extracted_at から復元する
(Date.now 禁止の規約を守るため)。"
```

---

### Task 2: `make new` — 足場を生成する

**Files:**
- Create: `scripts/new-municipality.mjs`
- Modify: `package.json` (scripts に `new` を追加)

**Interfaces:**
- Consumes: `tools/_lib/registry.mjs` の `lookupMunicipality(q)` — handle/code/name_ja のいずれかで 1 件引き、
  `{ code, handle, name_ja, yomi, type, lat, lng }` を返す。見つからなければ throw。
  **都道府県は含まれない**ので `--pref` で受ける。
- Consumes: `tools/_lib/schedule.mjs` の `PERIOD_RE` — 収録期間の書式検査。
- Produces: `node scripts/new-municipality.mjs --handle <h> --pref <romaji> --kind <html|pdf|csv|txt|api> [--period YYYY-MM--YYYY-MM]`

- [ ] **Step 1: レジストリが返す形を確認する (確認だけ)**

```bash
node -e "import('./tools/_lib/registry.mjs').then(async m => console.log(JSON.stringify(await m.lookupMunicipality('ome'), null, 1)))"
```

期待される出力 (2026-08-10 時点で確認済み):

```json
{ "code": "13205", "handle": "ome", "name_ja": "青梅市", "yomi": "おうめし",
  "type": "city", "lat": 35.78777778, "lng": 139.2758333 }
```

**都道府県は返ってこない。** リポジトリ内に団体コード → 都道府県 romaji の対応表も無い。
そのため `--pref` を必須引数にする。誤りは団体コード先頭 2 桁との突き合わせで検出する
(既存の `municipalities/<pref>/` に居る自治体と先頭 2 桁が食い違えば落とす)。

- [ ] **Step 2: `scripts/new-municipality.mjs` を書く**

```javascript
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

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const handleArg = arg('handle');
const pref = arg('pref');
const kind = arg('kind');
const period = arg('period') ?? '2026-04--2027-03';

if (!handleArg || !pref || !kind) {
  console.error('使い方: node scripts/new-municipality.mjs --handle <handle> --pref <都道府県romaji> --kind <html|pdf|csv|txt|api> [--period YYYY-MM--YYYY-MM]');
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
    const body = readFileSync(join(tpl, f), 'utf8')
      .replaceAll("'CHANGEME'", `'${handle}'`)
      .replaceAll('CHANGEME', handle)
      .replaceAll('2026-04--2027-03', period);
    writeFileSync(join(toolDir, f), body);
  }
  // PREF は handle 置換で潰れるので個別に直す
  for (const f of ['build.mjs', 'verify.mjs']) {
    const p = join(toolDir, f);
    if (!existsSync(p)) continue;
    writeFileSync(p, readFileSync(p, 'utf8').replaceAll(`const PREF = '${handle}'`, `const PREF = '${pref}'`));
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
```

- [ ] **Step 3: 既存自治体で「触らない」ことを確認する**

```bash
node scripts/new-municipality.mjs --handle ome --pref tokyo --kind pdf
git status --short
```

期待: `既存:` が 2 行出て、`git status` が空 (何も変更しない)。

- [ ] **Step 4: 未収録の自治体で足場ができることを確認する**

```bash
node scripts/new-municipality.mjs --handle kodaira --pref tokyo --kind html
ls tools/html-extractor/kodaira/
cat municipalities/tokyo/kodaira/survey.yaml | head -5
npm test
```

期待: `_template` の 4 ファイルと `.gitignore` ができ、`npm test` が通る
(小平は survey.yaml が既にあるので「既存」と出る。無ければ雛形が作られる)。

- [ ] **Step 5: 後始末**

```bash
rm -rf tools/html-extractor/kodaira
git checkout -- municipalities/tokyo/kodaira/ 2>/dev/null || true
git status --short
```

期待: `git status` が空。

- [ ] **Step 6: 不正な入力で落ちることを確認する**

```bash
node scripts/new-municipality.mjs --handle ome --pref tokyo --kind xlsx; echo "exit=$?"
node scripts/new-municipality.mjs --handle nonexistent-city --pref tokyo --kind pdf; echo "exit=$?"
node scripts/new-municipality.mjs --handle ome --pref saitama --kind pdf; echo "exit=$?"
```

期待: 3 つとも 0 以外で終了し、理由が出る (kind の候補一覧 / レジストリで見つからない /
団体コード 13xxxx が saitama と食い違う)。

- [ ] **Step 7: package.json に登録する**

```json
"new": "node scripts/new-municipality.mjs"
```

- [ ] **Step 8: コミット**

```bash
git add scripts/new-municipality.mjs package.json
git commit -m "feat(tools): 新自治体の足場を作る make new を追加

survey.yaml の雛形・_template の展開・cache の .gitignore を用意する。
2026-08-10 に西東京を収録した際に手作業した 3 つで、毎回同じなので固定する。

handle はレジストリ (city-tecoli-data) で必ず引く。自分で綴りを考えない
という playbook §0 の規約を、実行時に強制する形にした。
既存のディレクトリには一切触らない。"
```

---

### Task 3: `AGENTS.md` と `CLAUDE.md`

**Files:**
- Create: `AGENTS.md`
- Create: `CLAUDE.md` (symlink → `AGENTS.md`)

**Interfaces:**
- Produces: エージェントが毎セッション読む事実。手順は持たず `docs/playbook.md` と skill を指す。

- [ ] **Step 1: `AGENTS.md` を書く**

内容は「毎回必要な事実」だけに絞る。手順は書かない (playbook と skill にある)。
200 行を超えないこと。

```markdown
# AGENTS.md

日本の自治体のごみ収集カレンダーを機械可読なオープンデータ (CC BY 4.0) として集約するリポジトリ。

- 人間向けの入口: `CONTRIBUTING.md`
- 収録の手順と判断基準: `docs/playbook.md`
- 進行管理 (Claude Code): `.claude/skills/add-municipality/SKILL.md`
- 検証の考え方: `docs/opendata-sources.md`「検証の考え方 (確率論的な信頼度)」

## データの単位

```
municipalities/<都道府県romaji>/<handle>/
  survey.yaml            収集日データの公開状況サーベイ (収録前の調査記録。収録後も残す)
  meta.yaml              自治体メタ + 更新に必要な情報源 + 運用ルール + 検証記録
  taxonomy.yaml          その自治体の種別語彙 (schema/categories.yaml の部分集合)
  facts.yaml             任意。利用者向けの読み物断片 (出典必須)
  <収録期間>/course-*.yaml  日程本体
```

- **handle** は自分で綴りを考えず、必ずレジストリで引く (`tools/_lib/registry.mjs`)。
- **収録期間** は `YYYY-MM--YYYY-MM`。**一次ソースが実際に裏付ける範囲**であって会計年度ではない。
  4月起点・10月起点・暦年・半期がいずれも同じ形で表せる。**この範囲の外は展開しない。**
- **course** = 同一日程のまとまり。**area** = 1 町名 (丁目単位)。

## コマンド

```
make help                 ターゲット一覧
make test                 全ゲート (schema + extractor 静的検査 + ESLint + 単体テスト)
make new HANDLE=.. PREF=.. KIND=..  新自治体の足場
make regen HANDLE=..      再生成して差分ゼロを確認 (PR 前に必須)
make verify HANDLE=..     その自治体の verify を実行
make ics                  .ics と stats を生成
```

## 不変条件

守らないと壊れるもの。

- **推測でデータを作らない。** ソースが機械可読でない・地区割に確信が持てないなら、
  作らずに `survey.yaml` だけ残して終わる。それは失敗ではなく正しい完走。
- **未対応の表記は throw する。** 黙って読み飛ばさない。
- **`Date.now()` を使わない。** 日付は環境変数 (`EXTRACTED_AT`) で渡す。出力を決定的に保つため。
- **生成ファイルを手で編集しない。** `meta.yaml` / `taxonomy.yaml` / `course-*.yaml` は
  build が作る。直したいときは生成器を直して `make regen` する。
  (2026-08-10 に手編集が 3 件見つかり、再生成で消えるところだった)
- **`git add -A` を使わない。** 同一作業ツリーを別セッションが使うことがある。
  コミットは必ずファイルを指定する。
- **語彙を勝手に増やさない。** `schema/categories.yaml` に無い品目が出たら、
  同日収集の別品目に寄せるか除外し、**上流に相談する**。判断を貢献者側で完結させない。
- **ソースを「修正」しない。** 一次ソースの誤記は直さず、事実として `meta.yaml` に記録する。

## 触ってよい場所

1 自治体を収録するとき、書き込みは次に閉じる。

```
tools/<形式>-extractor/<handle>/
municipalities/<都道府県>/<handle>/
```

`schema/` `docs/` `tools/_lib/` `.github/` と他自治体は上流の担当範囲。
変更が要るなら提案に留める。

## 共通部品

再実装しない。`tools/_lib/` にある。

| 部品 | 提供 |
|---|---|
| `schedule.mjs` | 収集日展開の正典 (`categoriesOn` / `expandRange` / `periodDates` / `cancelledOverrides`) |
| `classify.mjs` | 実日付 → weekly / monthly_specific の自動分類 |
| `emit.mjs` | コース畳み込みと course YAML 出力 (フィールド順を統一) |
| `abr.mjs` | ABR 町字マスター取得 (yomi / machiaza_id) |
| `jp.mjs` | 曜日・第n回目の日本語パース、町名正規化 |
| `verify.mjs` | 期間 diff、rule of three、層化サンプリング |
| `fetch.mjs` | キャッシュつき取得 |
| `registry.mjs` | 全国自治体レジストリの参照 |

`build-ics` と各 verify が `schedule.mjs` を共有することで
「照合と配信で同じ解釈」を保証している。ここを自前で書き直さない。
```

- [ ] **Step 2: symlink を作る**

```bash
ln -s AGENTS.md CLAUDE.md
ls -l CLAUDE.md
```

期待: `CLAUDE.md -> AGENTS.md` と表示される。

- [ ] **Step 3: git が symlink として記録することを確認する**

```bash
git add AGENTS.md CLAUDE.md
git ls-files -s CLAUDE.md
```

期待: モードが `120000` (symlink)。`100644` なら実体がコピーされているので
`git rm --cached CLAUDE.md` して作り直す。

- [ ] **Step 4: テストを通す**

```bash
npm test
```

- [ ] **Step 5: コミット**

```bash
git commit -m "docs(agents): AGENTS.md を追加し CLAUDE.md を symlink にする

エージェントが毎セッション読む事実だけを置く。手順は書かない
(docs/playbook.md と .claude/skills/add-municipality にある)。

CLAUDE.md は AGENTS.md への symlink にした。公式ドキュメントが認めている方法で、
@AGENTS.md の import と違い実体が 1 つになるので drift が構造的に起きない。
Windows は対象外とする判断による。

不変条件には 2026-08-10 に実際に踏んだものを入れた:
生成ファイルを手で編集しない (再生成で消える手編集が 3 件見つかった)、
git add -A を使わない (同一作業ツリーを別セッションが使う)、
語彙を勝手に増やさない (青梅のガラス・陶磁器)。"
```

---

### Task 4: 収録スキル

**Files:**
- Create: `.claude/skills/add-municipality/SKILL.md`

**Interfaces:**
- Consumes: `make new` / `make regen` / `make verify` / `make test` (Task 1・2・6)
- Produces: `/add-municipality` で起動できる進行管理。

- [ ] **Step 1: `SKILL.md` を書く**

frontmatter は Agent Skills 標準の範囲 (`name` / `description`) に留める。
Claude Code 拡張のフィールドは使わない (他ツールでも読めるようにするため)。

````markdown
---
name: add-municipality
description: このリポジトリに新しい自治体のごみ収集カレンダーを収録する。ユーザーが「自分の町のデータを作って」「<市区町村名>を収録して」と言ったとき、または municipalities/ に新しい自治体を追加するときに使う。
---

# 自治体を 1 つ収録する

**知識は `docs/playbook.md` にある。本書は進行管理だけを担う。** 先に playbook を読むこと。

## 原則

- **停止するのは 1 回だけ** — Phase 1 の直後。それ以外は自分で進める。
- **推測でデータを作らない。** 撤退は失敗ではない。`survey.yaml` が 1 件増えれば台帳が育つ。
- **生成ファイルを手で編集しない。** 直したいときは生成器を直して `make regen`。

## Phase 0: 準備

1. `docs/playbook.md` を読む。
2. handle をレジストリで引く。

```bash
node -e "import('./tools/_lib/registry.mjs').then(async m => console.log(await m.lookupMunicipality('市区町村名')))"
```

3. `municipalities/<pref>/<handle>/survey.yaml` があれば読む。
   **survey の記述を鵜呑みにしない** — 2026-08-10 に青梅で
   「カレンダーは画像で抽出不可」という記述が誤りだった実例がある。

## Phase 1: ソース探索 → ここで停止する

`docs/playbook.md` §1 の優先順で探す。テキスト版カレンダー > OD CSV > サイト内 CSV >
HTML 表 > テキスト層 PDF > 画像 PDF。

PDF を「画像だから無理」と判断する前に、必ず次を実行する。

```bash
python3 -c "
import pdfplumber, sys
pdf = pdfplumber.open(sys.argv[1])
for i, p in enumerate(pdf.pages):
    print(i+1, 'words', len(p.extract_words()), 'lines', len(p.lines), 'curves', len(p.curves), 'images', len(p.images))
" <pdf>
```

罫線 (`lines`) が生きていればグリッドは座標復元でき、品目が図版でも**塗り色**で判定できる。

### 停止して報告する 4 項目

調べ終えたら**実装に入らず**、次を報告して承認を得る。

1. **一次ソース** — URL・形式・収録期間・ライセンス
2. **独立照合に何を使うか** — 無ければ「無い」と明言する。
   その場合 `verified_by` に自己照合のみと書く旨も宣言する
3. **正典語彙に収まらない品目とその処理案** — 同日の別品目に寄せる / 除外 / 語彙追加の相談。
   **語彙追加は上流の判断**なので自分で決めない
4. **撤退の可能性** — 下記に当たるなら「survey だけ残して終了」を提案する

### 撤退条件

- 一次ソースが機械可読でない (画像 PDF・アプリ内のみ)
- 地区割が公開資料から確定できない
- 第三者商用アプリ (ごみスケ・さんあ〜る等) しか情報源が無い — 方針により不採用

撤退するときは `survey.yaml` に調査結果と理由を書いて終わる。

## Phase 2: 抽出

```bash
make new HANDLE=<handle> PREF=<都道府県romaji> KIND=<html|pdf|csv|txt|api>
```

手本にする既存 extractor を選ぶ。

| ソース形式 | 手本 |
|---|---|
| テキスト版カレンダー | `tools/txt-extractor/chofu/` |
| 日付入り HTML | `tools/html-extractor/nishitokyo/` |
| 罫線のある PDF | `tools/pdf-extractor/musashino/` |
| 文字が図版の PDF (色ベース) | `tools/pdf-extractor/ome/`、`tools/pdf-extractor/chichibu-koiki/` |
| OD CSV | `tools/csv-extractor/iruma/` |

守ること。

- `tools/_lib/` にあるものを再実装しない (`AGENTS.md` の表を見る)
- 実日付から規則を導くときは `_lib/classify.mjs` の `classifyRules()` を使う。
  events は期間を漏れなく覆い、収集なしの日は空配列で渡す
- 未対応の表記は throw する
- build 内で `expandRange()` 再展開が抽出実日付と完全一致することを自己検証する。
  一致しなければ書き出さない

## Phase 3: 照合

Phase 1 で宣言した独立ソースと突き合わせる。

- 機械照合できるなら全数。`_lib/verify.mjs` の `diffRange` を使う
- **高コスト (目視転記・OCR 不可) なら層化サンプリング**。
  `docs/opendata-sources.md`「検証の考え方」§5 の停止規則に従う
- **目視で読んだ結果は `verify.mjs` の `PDF_SAMPLES` に固定保持する** (同 §6)。
  一過性にしない。平日は全部書き、「収集なし」も明示する。
  サンプルは端 (年末年始・6 週ある月・隔週の位相が変わる月) を狙う

## Phase 4: 仕上げ

1. `meta.yaml` の notes に運用ルール・年末年始・検証・**確率的信頼度**を書く
   (rule of three。N は「1 つの誤りで壊れる最小単位」で数える)
2. `taxonomy.yaml` は `schema/categories.yaml` の部分集合 + ラベル override
3. `survey.yaml` に「【収録済 YYYY-MM-DD】…」を追記する
4. 通す。

```bash
make regen HANDLE=<handle>   # 再生成して差分ゼロ
make verify HANDLE=<handle>  # 独立照合
make test                    # 全ゲート
```

5. 完了報告: コース数・area 数 / 照合統計 (N・不一致内訳・確率的信頼度) /
   `make test` の結果 / 未解決事項。

## 詰まったとき

- **verify で差分が出る** — まず cache を疑う。一次ソースを取り直して extract からやり直す
  (2026-08-10 に所沢で、古い cache が原因の「1044 件の不一致」を踏んだ)
- **`make regen` で差分が出る** — 生成ファイルを手編集した可能性がある。`git diff` で中身を見る
- **語彙が足りない** — 止めて相談する。同日収集の別品目があれば寄せるか除外で回避できることが多い
````

- [ ] **Step 2: skill が認識されることを確認する**

```bash
ls -l .claude/skills/add-municipality/SKILL.md
head -5 .claude/skills/add-municipality/SKILL.md
```

期待: frontmatter に `name` と `description` がある。

- [ ] **Step 3: コミット**

```bash
git add .claude/skills/add-municipality/SKILL.md
git commit -m "feat(skill): 自治体を収録する進行管理スキルを追加

知識は docs/playbook.md に置いたまま、進行管理だけを担う。重複させない。

停止点は Phase 1 の直後 1 回だけで、報告する 4 項目を固定した
(一次ソース / 独立照合に何を使うか / 語彙に収まらない品目 / 撤退の可能性)。
撤退も正しい完走として明記した。

2026-08-10 に実際に踏んだ罠を「詰まったとき」に入れた:
古い cache による偽の不一致 (所沢の 1044 件)、生成物の手編集、語彙不足。
PDF を画像と決めつける前に pdfplumber で lines/curves を数える手順も入れた
(青梅は survey の誤判定で difficulty 4 とされていた)。

frontmatter は Agent Skills 標準の name/description のみ。
Claude Code 拡張は使わず、他ツールでも素の markdown として読めるようにした。"
```

---

### Task 5: `CONTRIBUTING.md`

**Files:**
- Create: `CONTRIBUTING.md`

- [ ] **Step 1: `CONTRIBUTING.md` を書く**

**手元だけで使う導線を先頭に置く。** PR を出さない人も一級市民として扱う。

```markdown
# 貢献の仕方

日本の自治体のごみ収集カレンダーを機械可読なオープンデータにするプロジェクトです。
**自分の町のデータを手元で使うだけでも歓迎**します。PR は出しても出さなくて構いません。

## まず動かす

```bash
make setup    # 依存を入れる
make test     # 全ゲートが通ることを確認
make ics      # .ics を生成する (ics/<handle>/<course>.ics)
```

収録済みの自治体は `docs/coverage.md` を見てください。

## 自分の町を追加する

貢献の経路は 3 つあります。どれで作っても通るゲートは同じです。

### 1. エージェントに作らせる

Claude Code なら `/add-municipality`、その他のエージェントなら
`.claude/skills/add-municipality/SKILL.md` を読ませてください
(素の markdown なのでツールを問いません)。

**探索が終わった時点で一度止まり、「何を一次ソースにし、何で独立照合するか」を
提案してきます。そこだけ人が承認してください。** 以降は自動で進みます。

### 2. 手で書く

```bash
make new HANDLE=<handle> PREF=<都道府県romaji> KIND=<html|pdf|csv|txt|api>
```

足場ができます。`docs/playbook.md` が手順と判断基準です。
手本にする既存の自治体は `tools/*-extractor/` から近い形式のものを選んでください。

### 3. 自治体自身が公開する

**これが理想形です。** 自治体が `schema/schedule.schema.json` に沿った YAML を
公開してくれれば、抽出は要りません。形式についての相談は Issue でどうぞ。

## 通すべきゲート

```bash
make test                    # schema + extractor 静的検査 + ESLint + 単体テスト
make regen HANDLE=<handle>   # 再生成して差分ゼロ (PR を出すなら必須)
make verify HANDLE=<handle>  # 独立照合 (verify.mjs がある場合)
```

`make regen` は cache と一次ソースが要るので CI では回りません。**手元で必ず通してください。**
差分が出たら、まず cache を作り直してください。それでも出るなら、
生成ファイルを手で編集したか、一次ソースが更新されています。

## 守ってほしいこと

- **推測でデータを作らない。** ソースが機械可読でない・地区割に確信が持てないなら、
  作らずに `survey.yaml` だけ残してください。それでも台帳が 1 件増えます
- **生成ファイル (`meta.yaml` / `taxonomy.yaml` / `course-*.yaml`) を手で編集しない。**
  生成器を直して `make regen` してください
- **語彙 (`schema/categories.yaml`) を勝手に増やさない。** 足りないと思ったら Issue で相談を
- **一次ソースの誤記を「修正」しない。** 事実として `meta.yaml` に記録してください

## PR を出す

1 自治体 1 PR にしてください。変更は次に閉じているはずです。

```
municipalities/<都道府県>/<handle>/
tools/<形式>-extractor/<handle>/
```

`schema/` や `tools/_lib/` に手を入れる必要が出たら、先に Issue で相談してください。

## ライセンス

データは CC BY 4.0 です。一次ソースのライセンスは `meta.yaml` と `survey.yaml` に記録します。
自治体サイトにライセンス表示が無い場合は「収集日という事実データの抽出」として扱っています
(`docs/opendata-sources.md` 参照)。
```

- [ ] **Step 2: リンク先が実在することを確認する**

```bash
for p in docs/playbook.md docs/opendata-sources.md schema/schedule.schema.json schema/categories.yaml .claude/skills/add-municipality/SKILL.md; do
  [ -e "$p" ] && echo "OK  $p" || echo "★欠 $p"
done
```

期待: 全部 OK。`docs/coverage.md` は第2段で作るので、この時点では未作成でよい
(その旨を README に書かない。Task 7 で扱う)。

- [ ] **Step 3: コミット**

```bash
git add CONTRIBUTING.md
git commit -m "docs(contributing): 貢献の入口を追加

GitHub が PR/Issue 作成時に自動でリンクする慣習ファイル。
docs/playbook.md は README 29 行目からしか辿れず、入口として機能していなかった。

手元だけで使う導線を先頭に置いた。PR を出さない人も一級市民として扱う。
貢献経路は エージェント / 手書き / 自治体公式 の 3 つを対等に並べ、
自治体自身の公開を理想形として明記した。"
```

---

### Task 6: `Makefile`

**Files:**
- Create: `Makefile`

**Interfaces:**
- Consumes: Task 1・2 の npm scripts (`regen` / `new`) と既存の `test` / `build:ics` / `check:editions`
- Produces: `make help` / `setup` / `test` / `lint` / `new` / `regen` / `verify` / `fetch` / `ics` / `editions`

- [ ] **Step 1: `Makefile` を書く**

`##` コメントから `help` を自動生成する。実装は npm に置き、Makefile は呼ぶだけにする
(CI は npm を直接叩くため、二重管理にしない)。

```makefile
# 人間向けの入口。実装は npm scripts と scripts/ にある。
# CI は npm を直接叩くので、ここに実装を書かないこと。
.DEFAULT_GOAL := help
.PHONY: help setup test lint new regen verify fetch ics editions

help: ## このヘルプを表示する
	@grep -hE '^[a-z-]+:.*?##' $(MAKEFILE_LIST) | awk 'BEGIN{FS=":.*?## "}{printf "  \033[36m%-10s\033[0m %s\n", $$1, $$2}'
	@echo ''
	@echo '  HANDLE / KIND を取るターゲット:'
	@echo '    make new HANDLE=ome PREF=tokyo KIND=pdf'
	@echo '    make regen HANDLE=ome'
	@echo '    make verify HANDLE=ome'
	@echo ''
	@echo '  はじめての人は CONTRIBUTING.md を読んでください。'

setup: ## 依存を入れる
	npm ci

test: ## 全ゲート (schema + extractor 静的検査 + ESLint + 単体テスト)
	npm test

lint: ## ESLint だけ実行する
	npm run lint

new: ## 新自治体の足場を作る (HANDLE= PREF= KIND= 必須)
	@test -n "$(HANDLE)" || { echo 'HANDLE= が要る 例: make new HANDLE=ome PREF=tokyo KIND=pdf'; exit 1; }
	@test -n "$(PREF)" || { echo 'PREF= が要る (municipalities/ のディレクトリ名)'; exit 1; }
	@test -n "$(KIND)" || { echo 'KIND= が要る (html|pdf|csv|txt|api)'; exit 1; }
	npm run new -- --handle $(HANDLE) --pref $(PREF) --kind $(KIND)

regen: ## 再生成して差分ゼロを確認する (HANDLE 省略で cache のある全自治体)
	npm run regen -- $(HANDLE)

verify: ## その自治体の verify を実行する (HANDLE= 必須)
	@test -n "$(HANDLE)" || { echo 'HANDLE= が要る 例: make verify HANDLE=ome'; exit 1; }
	@f=$$(find tools -path "*/$(HANDLE)/verify.mjs" | head -1); \
	  test -n "$$f" || { echo "verify.mjs が無い: $(HANDLE)"; exit 1; }; \
	  node "$$f"

fetch: ## 一次ソースを取得する (HANDLE= 必須。cache を作り直すときに使う)
	@test -n "$(HANDLE)" || { echo 'HANDLE= が要る 例: make fetch HANDLE=ome'; exit 1; }
	@f=$$(find tools -path "*/$(HANDLE)/fetch.mjs" | head -1); \
	  test -n "$$f" || { echo "fetch.mjs が無い: $(HANDLE)"; exit 1; }; \
	  node "$$f" $(ARGS)

ics: ## .ics と stats を生成する
	npm run build:ics

editions: ## 次の版が公開されたか確認する
	npm run check:editions
```

- [ ] **Step 2: `make help` を確認する**

```bash
make help
```

期待: ターゲット一覧が色付きで並び、末尾に HANDLE/KIND の使い方と
CONTRIBUTING.md への案内が出る。

- [ ] **Step 3: 引数チェックが効くことを確認する**

```bash
make new; echo "exit=$?"
make verify; echo "exit=$?"
```

期待: どちらも使い方を表示して `exit=1`。

- [ ] **Step 4: 主要ターゲットが動くことを確認する**

```bash
make test
make verify HANDLE=ome
make regen HANDLE=chofu
```

期待: いずれも成功する。

- [ ] **Step 5: コミット**

```bash
git add Makefile
git commit -m "feat(make): 人間向けの入口として Makefile を追加

make help でターゲット一覧が出る。実装は npm scripts と scripts/ に置き、
Makefile は呼ぶだけにした。CI は npm を直接叩くので二重管理にしない。

HANDLE / KIND を取るターゲットは引数が無ければ使い方を出して落ちる。"
```

---

### Task 7: 既存ドキュメントの整理

**Files:**
- Modify: `README.md` (冒頭に入口を足す)
- Modify: `docs/playbook.md` (§5 を縮める)
- Move: `docs/2026-07-16-national-scaling-draft.md` → `docs/drafts/`
- Move: `docs/2026-07-20-meta-rule-format-draft.md` → `docs/drafts/`
- Create: `docs/drafts/README.md`

**Interfaces:**
- Consumes: Task 3・4・5・6 の成果物 (README から参照する)

- [ ] **Step 1: 草案を隔離する**

```bash
mkdir -p docs/drafts
git mv docs/2026-07-16-national-scaling-draft.md docs/drafts/
git mv docs/2026-07-20-meta-rule-format-draft.md docs/drafts/
```

- [ ] **Step 2: `docs/drafts/README.md` を書く**

```markdown
# 草案 (未採用)

ここにあるものは**現行の方針ではない**。検討の記録として残している。

実装や判断の根拠にしないこと。特に `2026-07-20-meta-rule-format-draft.md` は
「rules + overrides を年度射影ではなく生成規則にする」という**現行スキーマを否定する内容**で、
未実装のまま置かれている。これを現行方針と誤読して schema を変え始めないこと。

採用済みの設計は `docs/` 直下にある (例: `docs/2026-08-10-contributor-onboarding-design.md`)。
```

- [ ] **Step 3: 各草案の冒頭に「未採用」を明記する**

両ファイルの 3 行目 (ステータス行) を次のように直す。

```markdown
ステータス: **未採用の草案**。現行方針ではない (`docs/drafts/README.md` 参照)
```

- [ ] **Step 4: 参照が壊れていないか確認する**

```bash
grep -rn 'national-scaling-draft\|meta-rule-format-draft' --include='*.md' --include='*.mjs' . | grep -v node_modules | grep -v docs/drafts
```

期待: 何も出ない。出たらそのファイルのパスを `docs/drafts/` 込みに直す。

- [ ] **Step 5: README の冒頭に入口を足す**

`# japan-gomi-data` の説明の直後 (公開ページの行の後) に次を挿入する。

```markdown
## はじめに

- **自分の町を追加したい** → [`CONTRIBUTING.md`](CONTRIBUTING.md)
- **エージェント (Claude Code / Codex) で作業する** → [`AGENTS.md`](AGENTS.md)
- **収録の手順と判断基準** → [`docs/playbook.md`](docs/playbook.md)

```bash
make setup && make test    # 動作確認
make help                  # コマンド一覧
```
```

- [ ] **Step 6: playbook §5 を縮める**

`## 5. エージェント並行運用 (統括者向け)` の本文のうち、
skill と重複する「完了報告の様式」を削り、skill を指す 1 行に置き換える。
節そのものは残す (読者が統括者で、skill の読者=単独の貢献者とは別のため)。

置換後の §5 の末尾に次を足す。

```markdown
- 貢献者 1 人が単独で回すときの進行管理 (停止点・承認する 4 項目・撤退条件) は
  `.claude/skills/add-municipality/SKILL.md` にある。本節は統括者が複数を並行させるときの話。
```

そのうえで、既存の「完了報告の様式: …」の行を削る (skill 側に同じものがあるため)。

- [ ] **Step 7: テストを通す**

```bash
npm test
git status --short municipalities/
```

期待: テストが通り、`municipalities/` に差分が無い。

- [ ] **Step 8: コミット**

```bash
git add README.md docs/playbook.md docs/drafts
git commit -m "docs: 入口を README に足し、未採用の草案を docs/drafts へ隔離する

README の冒頭に CONTRIBUTING / AGENTS / playbook への導線を置いた。
これまで playbook へは構造説明の 29 行目からしか辿れなかった。

草案 2 本を docs/drafts/ へ移し、冒頭に「未採用」を明記した。
メタルール草案は現行スキーマを否定する内容で未実装のまま docs/ 直下にあり、
エージェントが現行方針と誤読して schema を変え始める事故を防ぐため隔離する。

playbook §5 (統括者向け並行運用) から、skill と重複する完了報告の様式を削り、
skill を指す 1 行に置き換えた。節自体は読者が違うので残す。"
```

---

### Task 8: 通しで確認する

**Files:** なし (確認のみ)

- [ ] **Step 1: まっさらな目で入口を辿る**

```bash
make help
head -20 README.md
```

期待: `make help` から `CONTRIBUTING.md` に辿り着け、README 冒頭から 3 つの導線が見える。

- [ ] **Step 2: 足場から `make test` までが通ることを確認する**

```bash
node scripts/new-municipality.mjs --handle koganei --pref tokyo --kind html
make test
rm -rf tools/html-extractor/koganei
git checkout -- municipalities/tokyo/koganei/ 2>/dev/null || true
git status --short
```

期待: 足場を作った直後に `make test` が通り、後始末後は `git status` が空。

- [ ] **Step 3: cache のある全自治体で `make regen` が通ることを確認する**

```bash
make regen
```

期待: cache のある自治体はすべて `✓ 再生成で差分なし`、無いものは skip、失敗ゼロ。

- [ ] **Step 4: symlink が壊れていないことを確認する**

```bash
git ls-files -s CLAUDE.md
cat CLAUDE.md | head -3
```

期待: モード `120000`、中身は `AGENTS.md` の先頭。

- [ ] **Step 5: 受け入れ基準を照合する**

設計文書 `docs/2026-08-10-contributor-onboarding-design.md` の「受け入れ基準」1〜3 と 6 を
1 つずつ確認する (4・5 は第2段の範囲なのでこの計画では対象外)。

- [ ] **Step 6: 最終コミット (差分があれば)**

```bash
git status --short
```

差分が無ければコミット不要。あれば内容を確認してからファイルを指定してコミットする。

---

## 第2段への引き継ぎ

この計画では扱わない。設計文書の「実装の分割」に順序が書いてある。

- `source.provenance` 追加 / `source.confidence` 削除 / `meta.summary` 追加
- `docs/coverage.md` の生成と README の収録リスト縮小
- `check-tools.mjs` への欠落検出追加

**順序を守ること。** 先に生成器を直して値を投入し、`make regen` で反映してから
schema を必須に変える。逆順にすると必須化した瞬間に全自治体が `make test` で落ちる。
