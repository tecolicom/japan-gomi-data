// 門真市の地区別ごみカレンダーページ、地区別 PDF (A〜F)、ABR 町字マスター (大阪府版) を cache/ へ取得する。
// --force で取り直す。
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { cachedFetch } from '../../_lib/fetch.mjs';
import { writeAbrTownJson } from '../../_lib/abr.mjs';
import { INDEX_URL, DISTRICTS, CACHE } from './sources.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const force = process.argv.includes('--force');

const html = await cachedFetch(INDEX_URL, join(CACHE, 'index.html'), { encoding: 'utf-8', force });
console.log(`fetched: index.html (${html.length} 字)`);

for (const { district, url, file } of DISTRICTS) {
  if (!html.includes(`material/files/group/20/${district}.pdf`)) {
    throw new Error(`案内ページに ${district}.pdf のリンクが無い (版が変わった可能性)`);
  }
  const buf = await cachedFetch(url, join(CACHE, file), { encoding: null, force });
  const sha = createHash('sha256').update(buf).digest('hex').slice(0, 16);
  console.log(`fetched: ${file} (${buf.length} bytes, sha256:${sha})`);
  await sleep(300);
}

// 大阪府版フルセットから門真市 (lg_code 272230) の町字だけを cache/abr-town.json へ
await writeAbrTownJson({ pref: '27', lgPrefix: '272230', cacheDir: CACHE, force, label: '門真市' });
