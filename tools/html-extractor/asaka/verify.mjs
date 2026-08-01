// 朝霞: 公式HTML「家庭ごみ収集日一覧表」と 5374 area_days.csv を独立照合する。
// HTML列: 区域 / 資源 / プラスチック資源=燃やせないごみ / 燃やすごみ。
// CSV列 : 地名 / 燃やすごみ / プラスチック資源 / 燃やせないごみと有害ごみ / 資源。
// 照合: HTML資源=CSV資源, HTMLプラ=CSVプラ=CSV燃やせない, HTML燃やす=CSV燃やす。地区の過不足も検出。
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DOWSET = (s) => new Set((s || '').split(/[・\s　、]+/).filter(Boolean));
const eqSet = (a, b) => a.size === b.size && [...a].every((x) => b.has(x));
// 照合キー: 大字接頭辞・別名併記・空白・全角数字・～ゆらぎを正規化
const norm = (t) => t.replace(/^大字/, '').replace(/・大字[^（(]*/, '').replace(/[\s　]/g, '')
  .replace(/[ヶケ]/g, 'ヶ')
  .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0)).replace(/〜/g, '～');
const stripYomi = (t) => t.replace(/[ 　][ぁ-ん][ぁ-んーゝ・]*$/, '').trim();

// --- HTML ---
const html = readFileSync(join(HERE, 'cache', 'dust-syuusyuu.html'), 'utf8');
const htmlMap = new Map();
for (const tr of html.match(/<tr[\s\S]*?<\/tr>/g) || []) {
  let tds = [...tr.matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/g)]
    .map((m) => m[1].replace(/<[^>]*>/g, '').replace(/[\s　]+/g, '').trim());
  if (tds.length === 5) tds = tds.slice(1); // 五十音見出し列を落とす
  if (tds.length !== 4 || tds[0] === '区域') continue;
  const [name, shigen, pla, burn] = tds;
  htmlMap.set(norm(name), { shigen: DOWSET(shigen), pla: DOWSET(pla), burn: DOWSET(burn), raw: name });
}

// --- CSV ---
const csv = readFileSync(join(HERE, 'cache', 'area_days.csv'), 'utf8');
const csvMap = new Map();
for (const line of csv.split('\n').slice(1)) {
  const c = line.split(',');
  if (!(c[0] || '').trim()) continue;
  csvMap.set(norm(stripYomi(c[0].trim())),
    { burn: DOWSET(c[2]), pla: DOWSET(c[3]), fue: DOWSET(c[4]), shigen: DOWSET(c[5]), raw: c[0].trim() });
}

// --- 照合 ---
console.log(`HTML ${htmlMap.size} 地区 / CSV ${csvMap.size} 地区`);
let issues = 0;
for (const [k, h] of htmlMap) if (!csvMap.has(k)) { console.log(`  [CSV欠落] ${h.raw}`); issues++; }
for (const [k, c] of csvMap) if (!htmlMap.has(k)) { console.log(`  [HTML無] ${c.raw}`); issues++; }
for (const [k, h] of htmlMap) {
  const c = csvMap.get(k); if (!c) continue;
  if (!eqSet(h.shigen, c.shigen)) { console.log(`  [資源≠] ${h.raw}: HTML=${[...h.shigen]} CSV=${[...c.shigen]}`); issues++; }
  if (!eqSet(h.pla, c.pla)) { console.log(`  [プラ≠] ${h.raw}: HTML=${[...h.pla]} CSV=${[...c.pla]}`); issues++; }
  if (!eqSet(h.pla, c.fue)) { console.log(`  [燃やせない≠HTMLプラ] ${h.raw}: HTMLプラ=${[...h.pla]} CSV燃やせない=${[...c.fue]}`); issues++; }
  if (!eqSet(h.burn, c.burn)) { console.log(`  [燃やす≠] ${h.raw}: HTML=${[...h.burn]} CSV=${[...c.burn]}`); issues++; }
}
console.log(issues ? `\n${issues} 件の差分 (要確認)` : '\n全地区で4分別×曜日が完全一致 ✓');
