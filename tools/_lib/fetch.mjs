// キャッシュつき fetch (全 extractor 共通)。cache/ は各 extractor の .gitignore で非追跡。
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';

// URL を取得して cachePath に保存 (存在すればキャッシュを返す)。
// encoding: 'utf-8' (default) | 'shift_jis' など TextDecoder が受ける名前 | null (Buffer を返す)
export async function cachedFetch(url, cachePath, { encoding = 'utf-8', force = false } = {}) {
  if (!force && existsSync(cachePath)) {
    const buf = readFileSync(cachePath);
    return encoding ? new TextDecoder(encoding).decode(buf) : buf;
  }
  const res = await fetch(url, { headers: { 'user-agent': 'japan-gomi-data (+https://github.com/tecolicom/japan-gomi-data)' } });
  if (!res.ok) throw new Error(`fetch ${url}: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  mkdirSync(dirname(cachePath), { recursive: true });
  writeFileSync(cachePath, buf);
  return encoding ? new TextDecoder(encoding).decode(buf) : buf;
}

// UTF-8 BOM を除去 (あってもなくても安全)
export const stripBom = (s) => s.replace(/^﻿/, '');
