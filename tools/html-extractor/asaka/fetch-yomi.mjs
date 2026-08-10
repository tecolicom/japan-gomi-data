// 朝霞市の町名 → 読み(yomi)・町字ID(machiaza_id)。
// デジタル庁 ABR 町字マスター埼玉県版 (pref11) から 朝霞市 (lg_code 11227) 分を
// cache/abr-town.json へ書き出す。取得と抽出の実体は tools/_lib/abr.mjs にある。
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeAbrTownJson } from '../../_lib/abr.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
await writeAbrTownJson({
  pref: '11',
  lgPrefix: '11227',
  cacheDir: join(HERE, 'cache'),
  force: process.argv.includes('--force'),
  label: '朝霞市',
});
