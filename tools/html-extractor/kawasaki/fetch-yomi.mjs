// 川崎市の町名 → 読み(yomi)・町字ID(machiaza_id) ソース取得。
// デジタル庁 ABR 町字マスター(フルセット)神奈川県版から川崎市 7 区分を cache/abr-town.json へ。
// build.mjs が areas[].yomi / machiaza_id 付与に使う (岡山・倉敷と同型)。
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const URL = 'https://data.address-br.digital.go.jp/mt_town_fullset/pref/mt_town_fullset_pref14.csv.zip';

const res = await fetch(URL);
if (!res.ok) throw new Error(`ABR fetch: HTTP ${res.status}`);
mkdirSync(join(HERE, 'cache'), { recursive: true });
const zipPath = join(HERE, 'cache', 'mt_town_fullset_pref14.csv.zip');
writeFileSync(zipPath, Buffer.from(await res.arrayBuffer()));
execFileSync('unzip', ['-o', '-q', zipPath, '-d', join(HERE, 'cache')]);

const csv = readFileSync(join(HERE, 'cache', 'mt_town_fullset_pref14.csv'), 'utf8');
const lines = csv.trim().split('\n');
const h = lines[0].split(',');
const col = (n) => h.indexOf(n);
const [iLg, iId, iWard, iOaza, iKana, iChNum, iStatus] =
  ['lg_code', 'machiaza_id', 'ward', 'oaza_cho', 'oaza_cho_kana', 'chome_number', 'status_flg'].map(col);

const kata2hira = (s) => s.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
const towns = [];
for (const line of lines.slice(1)) {
  const c = line.split(',');
  if (!c[iLg] || !c[iLg].startsWith('1413')) continue; // 川崎市 7 区
  if (iStatus >= 0 && c[iStatus] === '0') continue; // 廃止町字は除外
  const oaza = c[iOaza];
  if (!oaza) continue;
  towns.push({
    lg: c[iLg], id: c[iId], ward: c[iWard], oaza,
    kana: c[iKana] ? kata2hira(c[iKana]) : null,
    chome_number: c[iChNum] ? Number(c[iChNum]) : null,
  });
}
writeFileSync(join(HERE, 'cache', 'abr-town.json'), JSON.stringify({ towns }, null, 1));
console.log(`ABR 川崎市 町字 ${towns.length} 行 -> cache/abr-town.json`);

// 第2の yomi ソース: 日本郵便 郵便番号データ (ken_all)。ABR に無い広域大字 (戸塚町・和泉町 等)
// の読みを補う。公式 zip は bot 対策でスクリプト直取得できないため、手動 or ブラウザで
// cache/utf_ken_all.zip を配置しておく (無ければ ABR のみで続行)。
const kenZip = join(HERE, 'cache', 'utf_ken_all.zip');
if (existsSync(kenZip)) {
  execFileSync('unzip', ['-o', '-q', kenZip, '-d', join(HERE, 'cache')]);
  const H2K = { 'ｦ': 'ヲ', 'ｧ': 'ァ', 'ｨ': 'ィ', 'ｩ': 'ゥ', 'ｪ': 'ェ', 'ｫ': 'ォ', 'ｬ': 'ャ', 'ｭ': 'ュ', 'ｮ': 'ョ', 'ｯ': 'ッ', 'ｰ': 'ー', 'ｱ': 'ア', 'ｲ': 'イ', 'ｳ': 'ウ', 'ｴ': 'エ', 'ｵ': 'オ', 'ｶ': 'カ', 'ｷ': 'キ', 'ｸ': 'ク', 'ｹ': 'ケ', 'ｺ': 'コ', 'ｻ': 'サ', 'ｼ': 'シ', 'ｽ': 'ス', 'ｾ': 'セ', 'ｿ': 'ソ', 'ﾀ': 'タ', 'ﾁ': 'チ', 'ﾂ': 'ツ', 'ﾃ': 'テ', 'ﾄ': 'ト', 'ﾅ': 'ナ', 'ﾆ': 'ニ', 'ﾇ': 'ヌ', 'ﾈ': 'ネ', 'ﾉ': 'ノ', 'ﾊ': 'ハ', 'ﾋ': 'ヒ', 'ﾌ': 'フ', 'ﾍ': 'ヘ', 'ﾎ': 'ホ', 'ﾏ': 'マ', 'ﾐ': 'ミ', 'ﾑ': 'ム', 'ﾒ': 'メ', 'ﾓ': 'モ', 'ﾔ': 'ヤ', 'ﾕ': 'ユ', 'ﾖ': 'ヨ', 'ﾗ': 'ラ', 'ﾘ': 'リ', 'ﾙ': 'ル', 'ﾚ': 'レ', 'ﾛ': 'ロ', 'ﾜ': 'ワ', 'ﾝ': 'ン' };
  const han2hira = (s) => {
    let r = '';
    for (let i = 0; i < s.length; i++) {
      const c = s[i], nx = s[i + 1];
      let k = H2K[c] ?? c;
      if (nx === 'ﾞ') { k = String.fromCharCode(k.charCodeAt(0) + 1); i++; }
      else if (nx === 'ﾟ') { k = String.fromCharCode(k.charCodeAt(0) + 2); i++; }
      r += k;
    }
    return r.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
  };
  const ken = {};
  const csvKen = readFileSync(join(HERE, 'cache', 'utf_ken_all.csv'), 'utf8');
  for (const line of csvKen.split('\n')) {
    const c = line.split(',').map((x) => x.replace(/^"|"$/g, ''));
    if (c.length < 9 || !c[0].startsWith('1413')) continue; // 川崎市
    let town = c[8].replace(/（.*/, '');
    if (!town || town.includes('以下に掲載がない')) continue;
    if (!(town in ken)) ken[town] = han2hira(c[5]);
  }
  writeFileSync(join(HERE, 'cache', 'kenall-town.json'), JSON.stringify(ken, null, 1));
  console.log(`ken_all 川崎市 町域 ${Object.keys(ken).length} 件 -> cache/kenall-town.json`);
} else {
  console.log('cache/utf_ken_all.zip 未配置 → ken_all 補完はスキップ (ABR のみ)');
}
