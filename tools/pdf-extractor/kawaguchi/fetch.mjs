// 川口市 地区別ごみ収集日カレンダー PDF (18地区) + 番号一覧表 PDF を cache/pdf/ へ取得。
// 一次ソース: 市公式「2026年 川口市地区別ごみ収集日カレンダー」
//   本体   material/files/group/94/2026---{1..18}.pdf   (A3・2ページ・テキスト層あり)
//   番号表 material/files/group/94/banngouitirannhyou.pdf (住所→カレンダー番号)
// 案内ページ: https://www.city.kawaguchi.lg.jp/soshiki/01100/040/4/2/3488.html
import { mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cachedFetch } from '../../_lib/fetch.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PDFDIR = join(HERE, 'cache', 'pdf');
const BASE = 'https://www.city.kawaguchi.lg.jp/material/files/group/94';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

mkdirSync(PDFDIR, { recursive: true });

const jobs = [];
for (let i = 1; i <= 18; i++) jobs.push([`${BASE}/2026---${i}.pdf`, `2026-${i}.pdf`]);
jobs.push([`${BASE}/banngouitirannhyou.pdf`, 'bango.pdf']);

let n = 0;
for (const [url, file] of jobs) {
  const path = join(PDFDIR, file);
  const cached = existsSync(path);
  await cachedFetch(url, path, { encoding: null });
  n++;
  if (!cached) await sleep(600);
}
console.log(`done: ${n} PDFs in cache/pdf/`);
