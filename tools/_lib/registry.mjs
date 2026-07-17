// 全国自治体レジストリ (tecolicom/city-tecoli-data) の参照。
// handle は自分で採番せず必ずここで引く (lg.jp ラベル準拠・WHOIS 検証済み 1,786 自治体)。
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as yamlParse } from 'yaml';

const RAW_URL = 'https://raw.githubusercontent.com/tecolicom/city-tecoli-data/main/municipalities/municipalities.yaml';
// dev 環境では隣に clone がある想定 (city-data/ 配下)
const LOCAL_CANDIDATES = [
  join(fileURLToPath(new URL('.', import.meta.url)), '../../../city-tecoli-data/municipalities/municipalities.yaml'),
];

let cache = null;
export async function loadRegistry() {
  if (cache) return cache;
  for (const p of LOCAL_CANDIDATES) {
    if (existsSync(p)) return (cache = yamlParse(readFileSync(p, 'utf8')));
  }
  const res = await fetch(RAW_URL);
  if (!res.ok) throw new Error(`registry fetch: HTTP ${res.status}`);
  return (cache = yamlParse(await res.text()));
}

// 名前 (name_ja)・団体コード・handle のいずれかで 1 件引く。見つからなければ throw。
export async function lookupMunicipality(q) {
  const reg = await loadRegistry();
  const hit = reg.filter((m) => m.handle === q || m.code === q || m.name_ja === q);
  if (hit.length !== 1) throw new Error(`registry lookup "${q}": ${hit.length} 件 (期待 1 件)`);
  return hit[0];
}
