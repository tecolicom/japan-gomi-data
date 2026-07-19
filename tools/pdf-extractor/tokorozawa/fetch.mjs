// 所沢市 地区別収集カレンダー PDF を取得し cache/ へ保存する。
// 一次ソース: 市サイトの頭文字別 8 ページ (あ行/か・き/…/や・わ行) に並ぶ町別 PDF 群。
// 入口: https://www.city.tokorozawa.saitama.jp/kurashi/gomi/nittei/index.html
// 各 PDF は Excel LTSC 製・A4横 2 ページの日付入り通年カレンダー (4月〜翌3月・テキスト層あり)。
// manifest.json (file/url/letter/label) は index+8ページの HTML から抽出済み。
// サーバに負荷をかけないよう cachedFetch で逐次取得 (キャッシュ済みは再取得しない)。
import { readFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cachedFetch } from '../../_lib/fetch.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PDFDIR = join(HERE, 'cache', 'pdf');
const manifest = JSON.parse(readFileSync(join(HERE, 'manifest.json'), 'utf8'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

mkdirSync(PDFDIR, { recursive: true });

let n = 0;
for (const { file, url } of manifest) {
  const path = join(PDFDIR, file);
  const cached = existsSync(path);
  await cachedFetch(url, path, { encoding: null });
  n++;
  if (n % 10 === 0) console.log(`  ${n}/${manifest.length}`);
  if (!cached) await sleep(500); // 実取得のときだけ間隔を空ける
}
console.log(`done: ${n} PDFs in cache/pdf/`);
