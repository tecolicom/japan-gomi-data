// 荒川区のごみ収集データ源泉を取得し cache/ へ保存する。
// 1. 区配布 CSV (cp932)。ポータルページから実際にリンクされている URL を拾って鮮度を確認する。
// 2. 収集曜日案内ページ・ポータルページの HTML (検証ソース探索・年末年始告知の追跡用)。
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CACHE = join(HERE, 'cache');
const PORTAL = 'https://www.city.arakawa.tokyo.jp/portal/gomi/index.html';
const SYUSYUBI = 'https://www.city.arakawa.tokyo.jp/a025/recycle/shuushuubi/syusyubi.html';
const CSV_FALLBACK = 'https://www.city.arakawa.tokyo.jp/documents/41480/gomi_20251216.csv';

mkdirSync(CACHE, { recursive: true });

async function get(url, { binary = false } = {}) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return binary ? Buffer.from(await res.arrayBuffer()) : await res.text();
}

const portal = await get(PORTAL);
writeFileSync(join(CACHE, 'portal.html'), portal);
writeFileSync(join(CACHE, 'syusyubi.html'), await get(SYUSYUBI));

// ポータルから CSV リンクを抽出。ファイル名の日付サフィックスが鮮度そのもの。
const links = [...new Set([...portal.matchAll(/\/documents\/\d+\/gomi_\d+\.csv/g)].map((m) => m[0]))];
if (links.length > 1) throw new Error(`CSV リンクが複数: ${links.join(', ')} (最新版の判定が必要)`);
const csvUrl = links.length ? `https://www.city.arakawa.tokyo.jp${links[0]}` : CSV_FALLBACK;
if (!links.length) console.warn(`警告: ポータルに CSV リンクが見つからず fallback を使用: ${CSV_FALLBACK}`);
if (csvUrl !== CSV_FALLBACK) console.warn(`注意: CSV URL が更新されている: ${csvUrl} (build.mjs の CSV_URL も更新すること)`);

const buf = await get(csvUrl, { binary: true });
// 区の配布は cp932。UTF-8 へ倒して cache に置く (以降の実装は UTF-8 前提)。
writeFileSync(join(CACHE, 'gomi.csv'), new TextDecoder('shift_jis').decode(buf));
writeFileSync(join(CACHE, 'source-url.txt'), `${csvUrl}\n`);
console.log(`fetched ${csvUrl} (${buf.length} bytes) → cache/gomi.csv`);
