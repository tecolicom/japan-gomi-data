// pdfplumber / PIL / numpy を持つ python を探す。
//
// **`python3` を直打ちしない。** 既定の python3 が必要なモジュールを持っているとは限らない。
// 2026-08-21 の時点でこの環境は python3=3.13 (PIL も pdfplumber も無い) /
// python3.10=3.10.2 (全部ある) で、`python3` 直打ちの extractor は make regen で
// 「ModuleNotFoundError: No module named 'PIL'」を出して失敗していた。
//
// PYTHON 環境変数があればそれだけを試す (使う python を運用側が指定できる)。
// 無ければ候補を順に試し、どれも駄目なら**黙って進まず throw する**。
import { execFileSync } from 'node:child_process';

const CANDIDATES = ['python3', 'python3.13', 'python3.12', 'python3.11', 'python3.10', 'python'];
const cache = new Map();

/**
 * 指定モジュールをすべて import できる python の実行パスを返す。
 * @param {string[]} modules 例: ['pdfplumber', 'PIL', 'numpy']
 */
export function findPython(modules = []) {
  const key = modules.slice().sort().join(',');
  if (cache.has(key)) return cache.get(key);

  const probe = modules.map((m) => `import ${m}`).join('; ') || 'pass';
  const cands = process.env.PYTHON ? [process.env.PYTHON] : CANDIDATES;
  for (const p of cands) {
    try {
      execFileSync(p, ['-c', probe], { stdio: 'ignore' });
      cache.set(key, p);
      return p;
    } catch { /* 次の候補へ */ }
  }
  throw new Error(
    `${modules.join(' / ') || 'python'} を使える python が見つからない (試した: ${cands.join(', ')})。` +
    'PYTHON=/path/to/python で指定するか、pip install してから再実行する');
}
