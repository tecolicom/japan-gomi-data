// 三鷹市の町名 → 読み(yomi)・町字ID(machiaza_id)。
// デジタル庁 ABR 町字マスター東京都版 (pref13) から 三鷹市 (lg_code 132047) 分を
// cache/abr-town.json へ書き出す。取得と抽出の実体は tools/_lib/abr.mjs にある。
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeAbrTownJson } from '../../_lib/abr.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
await writeAbrTownJson({
  pref: '13',
  lgPrefix: '132047',
  cacheDir: join(HERE, 'cache'),
  force: process.argv.includes('--force'),
  label: '三鷹市',
});
