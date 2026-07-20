// 生成した course YAML を、区の町丁目別カレンダー PDF (対象地区 no1〜no37) と
// 日付レベルで突き合わせるための「期待日程」を出力する。
//
// 世田谷区のカレンダー PDF は全ページが画像 (テキスト層は 8 文字= 改ページのみ) で、
// pdftotext による機械抽出ができない。したがって照合は
//   node verify.mjs --month 2026-11 --month 2026-12   (期待日程を表形式で出力)
//   node verify.mjs --render 8                        (全 37 PDF の該当ページを PNG 化)
// の 2 つを突き合わせる目視照合になる。結果は meta.yaml notes に記録する。
//
// PDF のページ構成 (令和8年版, 全 8 ページ):
//   p1 表紙(対象地区) / p2 令和7年12月 / p3 1・2月 / p4 3・4月 / p5 5・6月
//   p6 7・8月 / p7 9・10月 / p8 11・12月
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { parse as yamlParse } from 'yaml';
import { categoriesOn } from '../../_lib/schedule.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CACHE = join(HERE, 'cache');
const COURSES = join(HERE, '../../../municipalities/tokyo/setagaya/2026');

const SHORT = { burnable: '可燃', non_burnable: '不燃', paper: '資源', glass_bottle: '資源', beverage_can: '資源', pet_bottle: 'ペット' };
// 資源 (古紙・びん・缶) は PDF 上 1 つのチップ「資源」で表される
const chip = (cats) => [...new Set(cats.map((c) => SHORT[c]))].sort().join('+');

const args = process.argv.slice(2);
const months = args.flatMap((a, i) => (a === '--month' ? [args[i + 1]] : []));
const renderPage = args.includes('--render') ? Number(args[args.indexOf('--render') + 1]) : null;

const courses = readdirSync(COURSES).filter((f) => f.endsWith('.yaml'))
  .map((f) => yamlParse(readFileSync(join(COURSES, f), 'utf8')))
  .sort((a, b) => Number(a.metadata.course) - Number(b.metadata.course));

if (renderPage) {
  for (const c of courses) {
    const no = c.metadata.course;
    execFileSync('pdftoppm', ['-r', '100', '-png', '-f', String(renderPage), '-l', String(renderPage),
      join(CACHE, `no${no}.pdf`), join(CACHE, `verify-no${no}-p${renderPage}`)]);
  }
  console.log(`rendered page ${renderPage} of ${courses.length} PDFs → cache/verify-no<N>-p${renderPage}-${renderPage}.png`);
}

for (const ym of months) {
  const [y, m] = ym.split('-').map(Number);
  console.log(`\n===== ${y}年${m}月 期待日程 (対象地区 → 日:種別) =====`);
  for (const c of courses) {
    const days = [];
    for (let d = 1; d <= new Date(y, m, 0).getDate(); d++) {
      const cats = categoriesOn(new Date(y, m - 1, d), c.rules, c.overrides);
      if (cats.length) days.push(`${d}:${chip(cats)}`);
    }
    const areas = c.metadata.areas.map((a) => a.name).join('、');
    console.log(`[${String(c.metadata.course).padStart(2)}] ${days.join(' ')}`);
    console.log(`     ${areas}`);
  }
}
