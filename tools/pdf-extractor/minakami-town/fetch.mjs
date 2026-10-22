// みなかみ町の地区別カレンダー PDF (15 枚) と案内ページ、ABR 町字マスターを cache/ へ取得する。
// --force で取り直す。
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { cachedFetch } from '../../_lib/fetch.mjs';
import { writeAbrTownJson } from '../../_lib/abr.mjs';
import { INDEX_URL, PDFS, CACHE } from './sources.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const force = process.argv.includes('--force');

const html = await cachedFetch(INDEX_URL, join(CACHE, 'index.html'), { encoding: 'utf-8', force });
console.log(`fetched: index.html (${html.length} 字)`);

for (const { slug, url, file } of PDFS) {
  if (!html.includes(`files/20261001__gomi_calendar_${slug}.pdf`)) {
    throw new Error(`案内ページに ${slug} のリンクが無い (版が変わった可能性)`);
  }
  const buf = await cachedFetch(url, join(CACHE, file), { encoding: null, force });
  const sha = createHash('sha256').update(buf).digest('hex').slice(0, 16);
  console.log(`fetched: ${file} (${buf.length} bytes, sha256:${sha})`);
  await sleep(300);
}

// 群馬県版フルセットから みなかみ町 (lg_code 104493) の町字だけを cache/abr-town.json へ
await writeAbrTownJson({ pref: '10', lgPrefix: '104493', cacheDir: CACHE, force, label: 'みなかみ町' });
