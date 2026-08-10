#!/usr/bin/env node
// 収録済み自治体の一次ソースを見に行き、「次の版が公開されたか」を判定して一覧にする。
//
// なぜ期限監視ではなくこれを主にするか:
//   公開時期は自治体ごとに違い、体系的な記録が無い (survey.yaml に書けているのは数件だけ)。
//   予測に頼るより「出たら気づく」方が確実で、しかも副産物として
//   「どの自治体がいつ公開したか」がこのファイルの git 履歴に貯まる。
//
// 判定は控えめに: 一次ソースのページに「次の版の年」を含むリンクがあれば「公開検出」。
// 自動収録はしない — あくまで人が見に行く候補を出すだけ。
//
// 使い方: node scripts/check-new-editions.mjs [--out docs/next-edition-status.md] [--limit N]

import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse as yamlParse } from 'yaml';
import { parse as parseHtml } from 'node-html-parser';

const ROOT = 'municipalities';
const OUT = process.argv.includes('--out')
  ? process.argv[process.argv.indexOf('--out') + 1]
  : 'docs/next-edition-status.md';
const LIMIT = process.argv.includes('--limit')
  ? Number(process.argv[process.argv.indexOf('--limit') + 1])
  : Infinity;

const PERIOD_DIR = /^\d{4}-\d{2}--\d{4}-\d{2}$/;
// 「カレンダー本体らしさ」。年だけで拾うと「令和9年度の粗大ごみ受付」等も引っかかる。
const CALENDAR_WORD = /カレンダー|収集|日程|ごみ|ゴミ|calendar|schedule|syusyu|shushu/i;

const FETCH_TIMEOUT_MS = 20_000;
const CONCURRENCY = 4;

/** 収録済み (期間ディレクトリを持つ) 自治体を列挙する。 */
async function listRecorded() {
  const out = [];
  for (const pref of await readdir(ROOT, { withFileTypes: true })) {
    if (!pref.isDirectory()) continue;
    for (const city of await readdir(join(ROOT, pref.name), { withFileTypes: true })) {
      if (!city.isDirectory()) continue;
      const dir = join(ROOT, pref.name, city.name);
      const periods = (await readdir(dir)).filter((n) => PERIOD_DIR.test(n));
      if (periods.length === 0) continue;
      out.push({ handle: city.name, pref: pref.name, dir, period: periods.sort().at(-1) });
    }
  }
  return out.sort((a, b) => a.handle.localeCompare(b.handle));
}

/** 監視先 URL と現行 edition を決める。survey が無い自治体は course YAML の出典で代替する。 */
async function resolveTarget(m) {
  let watchUrl = null;
  let source = 'survey.schedule_url';
  try {
    const survey = yamlParse(await readFile(join(m.dir, 'survey.yaml'), 'utf-8'));
    watchUrl = survey?.schedule_url ?? null;
  } catch {
    /* survey 無しは想定内 (sabae / kamifurano-town / kawasaki / yokohama) */
  }
  let editionJa = null;
  const courseDir = join(m.dir, m.period);
  const courses = (await readdir(courseDir)).filter((f) => /^course-.*\.yaml$/.test(f));
  if (courses.length > 0) {
    const first = yamlParse(await readFile(join(courseDir, courses[0]), 'utf-8'));
    editionJa = first?.metadata?.source?.edition_ja ?? null;
    if (!watchUrl) {
      // ページ URL があればそれ、無ければ PDF の URL をそのまま見る (更新で 404 になれば
      // 「確認失敗」として気づける)。
      watchUrl = first?.metadata?.source?.source_url ?? first?.metadata?.source?.pdf_url ?? null;
      source = 'course.source';
    }
  }
  return { watchUrl, editionJa, source, courseCount: courses.length };
}

/** 次の版を指す年トークン (西暦 / 和暦) を作る。 */
function nextTokens(period, editionJa) {
  // 「次の版が始まる年」を使う。period の開始年 + 1 だと、世田谷のように
  // 開始が前年12月の版 (2025-12--2026-12 = 令和8年(2026年)版) で現行版を拾ってしまう。
  // 終端の翌月の年なら、会計年度 (…--2027-03 → 2027) も暦年 (…--2026-12 → 2027) も合う。
  const [endYear, endMonth] = period.split('--')[1].split('-').map(Number);
  const nextYear = endMonth === 12 ? endYear + 1 : endYear;
  const tokens = [String(nextYear)];
  // 令和 N 年度 → N+1。edition_ja が無い自治体は西暦から計算する (令和 = 西暦 - 2018)。
  // 版名が 2 つの元号年にまたがることがある (西東京「令和7年10月〜令和8年9月版」)。
  // 先頭を取ると現行版の後半の年をそのまま「次の版」の印にしてしまい、現行版の
  // リンク自身に一致して誤検出になる。最後の一致を使う。
  const ms = editionJa ? [...editionJa.matchAll(/令和\s*(\d+)/g)] : [];
  const nextReiwa = ms.length ? Number(ms.at(-1)[1]) + 1 : nextYear - 2018;
  tokens.push(`令和${nextReiwa}`, `令和 ${nextReiwa}`, `R${String(nextReiwa).padStart(2, '0')}`, `R${nextReiwa}`);
  return { nextYear, nextReiwa, tokens };
}

async function fetchText(url) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctl.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': 'japan-gomi-data next-edition watcher (+https://github.com/tecolicom/japan-gomi-data)',
      },
    });
    if (!res.ok) return { error: `HTTP ${res.status}` };
    const ct = (res.headers.get('content-type') ?? '').split(';')[0].trim();
    // CSV / PDF / プレーンテキストを監視先にしても「次の版へのリンク」は現れない。
    // 未検出と混ぜると永久に静かなままになるので、監視先の設定漏れとして別扱いにする。
    if (!/html|xml/i.test(ct)) return { badTarget: ct || 'unknown' };
    return { html: await res.text() };
  } catch (e) {
    return { error: e.name === 'AbortError' ? 'タイムアウト' : String(e.message ?? e) };
  } finally {
    clearTimeout(timer);
  }
}

/** ページ内リンクから「次の版らしいもの」を拾う。 */
function findNextEditionLinks(root, baseUrl, tokens) {
  const hits = [];
  for (const a of root.querySelectorAll('a')) {
    const href = a.getAttribute('href');
    if (!href) continue;
    const text = a.textContent.replace(/\s+/g, ' ').trim();
    const hay = `${href} ${text}`;
    if (!tokens.some((t) => hay.includes(t))) continue;
    // 年だけの一致は弱い。カレンダーらしい語か PDF であることを併せて要求する。
    if (!CALENDAR_WORD.test(hay) && !/\.pdf(\?|$)/i.test(href)) continue;
    let abs = href;
    try { abs = new URL(href, baseUrl).href; } catch { /* 相対解決できなければ原文のまま */ }
    hits.push({ href: abs, text: text.slice(0, 60) });
    if (hits.length >= 5) break;
  }
  return hits;
}

async function checkOne(m) {
  const { watchUrl, editionJa, source, courseCount } = await resolveTarget(m);
  const { nextYear, nextReiwa, tokens } = nextTokens(m.period, editionJa);
  const base = { ...m, watchUrl, editionJa, source, courseCount, nextYear, nextReiwa };
  if (!watchUrl) return { ...base, status: 'no-url' };
  const { html, error, badTarget } = await fetchText(watchUrl);
  if (error) return { ...base, status: 'error', detail: error };
  if (badTarget) return { ...base, status: 'bad-target', detail: badTarget };
  const root = parseHtml(html);
  // リンクが 1 本も無いページは、監視先としては機能しない (データファイル直リンク等)。
  if (root.querySelectorAll('a').length === 0) return { ...base, status: 'bad-target', detail: 'リンク無し' };
  const hits = findNextEditionLinks(root, watchUrl, tokens);
  return { ...base, status: hits.length > 0 ? 'found' : 'not-yet', hits };
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++;
        out[idx] = await fn(items[idx]);
      }
    }),
  );
  return out;
}

function periodEnd(period) {
  const [y, mo] = period.split('--')[1].split('-').map(Number);
  return `${y}-${String(mo).padStart(2, '0')} 末`;
}

function render(results) {
  const L = [];
  L.push('# 次の版の公開状況');
  L.push('');
  L.push('収録済み自治体の一次ソースを機械的に見に行き、現行 `period` の次の版へのリンクが');
  L.push('出ているかを判定したもの。**自動収録はしない** — 人が見に行く候補の一覧。');
  L.push('判定は「次の年 (西暦 / 令和) を含み、かつカレンダーらしい語か PDF であるリンク」の有無。');
  L.push('誤検出はありうるので、リンクを開いて確認すること。');
  L.push('');
  L.push('生成: `node scripts/check-new-editions.mjs`。いつ状態が変わったかは、このファイルの');
  L.push('git 履歴が記録になる (公開時期の実測値がここに貯まる)。');
  L.push('');

  const groups = [
    ['found', '## 公開を検出 — 収録の候補', '次の版らしいリンクが一次ソースに出ている。'],
    ['error', '## 確認できず — 要点検', 'ページが取れない。移転・削除の可能性があるので**未公開と混同しない**。'],
    ['bad-target', '## 監視先がページでない — 要設定',
      '監視先が CSV / PDF / テキスト等でリンクを持たないため、次の版が出ても検出できない。' +
      'survey.yaml の `schedule_url` を、そのファイルが置かれている**案内ページ**に直すこと。'],
    ['no-url', '## 監視先が未設定', 'survey.yaml に schedule_url が無く、course の出典にも URL が無い。'],
    ['not-yet', '## 未検出', '次の版はまだ見当たらない。'],
  ];

  for (const [status, heading, note] of groups) {
    const rows = results.filter((r) => r.status === status);
    if (rows.length === 0) continue;
    L.push(heading);
    L.push('');
    L.push(`${note} (${rows.length} 自治体)`);
    L.push('');
    for (const r of rows) {
      const edition = r.editionJa ? ` / 現行 ${r.editionJa}` : '';
      L.push(`- **${r.handle}** (${r.pref}) — 収録 \`${r.period}\` (${periodEnd(r.period)})${edition}`);
      if (r.status === 'found') {
        for (const h of r.hits) L.push(`  - ${h.text || '(テキストなし)'} → ${h.href}`);
      } else if (r.status === 'error' || r.status === 'bad-target') {
        L.push(`  - ${r.detail} — ${r.watchUrl}`);
      } else if (r.status === 'not-yet') {
        L.push(`  - 探した年: ${r.nextYear} / 令和${r.nextReiwa} — ${r.watchUrl}`);
      }
    }
    L.push('');
  }
  return L.join('\n') + '\n';
}

const recorded = (await listRecorded()).slice(0, LIMIT);
process.stderr.write(`checking ${recorded.length} municipalities...\n`);
const results = await mapLimit(recorded, CONCURRENCY, checkOne);
await writeFile(OUT, render(results), 'utf-8');

const count = (s) => results.filter((r) => r.status === s).length;
process.stderr.write(
  `found=${count('found')} not-yet=${count('not-yet')} error=${count('error')} no-url=${count('no-url')} → ${OUT}\n`,
);
