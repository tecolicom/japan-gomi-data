// 岡山市: 市公式 kViewer「収集曜日一覧」(kintone 公開ビュー) の records API から
// 全 844 レコードを取得し cache/records.json へ正規化保存する。
//
// 取得プロトコル (待合室 waitingRoomEnabled:false 前提。有効時は wr-api/request_order の
// ポーリングが要るが本ビューは無効。混雑・待合室化を検知したら失敗を明示して中断する):
//   1. POST /wr-api/assign_request_order {subdomain,code} -> requestId
//   2. POST /wr-api/generate_token {requestId,subdomain,code} -> JWT (60秒有効)
//   3. GET  /public/<code>?_viewAccessToken=<JWT>&_viewRef=  (Set-Cookie でセッション確立)
//   4. GET  /public/internal/api/records/<code>/<page>  (Cookie 送付, 20件/ページ, page=1..)
//
// 礼儀: ページ間 PAGE_DELAY_MS の間隔を置く (accessLimitPerMinute=300 に十分収まる)。
// レコード形は browser-records.json (別経路=ブラウザ取得) と全844行突合できるよう揃える。
import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = 'https://f5d44204.viewer.kintoneapp.com';
const SUBDOMAIN = 'f5d44204';
const CODE = 'bba750ccc0622ed0ea1ee9803b60537753367b11af275de1ad0d1507c414d779';
const PAGE_DELAY_MS = 300;
const SOURCE_URL = `${BASE}/public/${CODE}`;

// kintone フィールドコード -> 正規化キー
const FIELD = {
  $id: 'id',
  ドロップダウン_1: 'district',   // 小学校区
  文字列__1行__0: 'town',         // 町名
  ドロップダウン_3: 'burnable',   // 可燃ごみ
  ドロップダウン_4: 'nonburnable', // 不燃ごみ
  ドロップダウン_6: 'recycle',    // 資源化物
  ドロップダウン_7: 'plastic',    // プラスチック資源
  文字列__1行__1: 'note',         // 備考
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const jbody = (o) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(o) });

// Set-Cookie を素朴に name=value; ... からペアだけ抜き出して Cookie ヘッダを組む
function cookieHeader(setCookies) {
  const jar = new Map();
  for (const sc of setCookies) {
    const first = sc.split(';', 1)[0];
    const eq = first.indexOf('=');
    if (eq > 0) jar.set(first.slice(0, eq).trim(), first.slice(eq + 1).trim());
  }
  return [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
}

function getSetCookies(res) {
  // Node fetch: getSetCookie() が複数 Set-Cookie を配列で返す
  if (typeof res.headers.getSetCookie === 'function') return res.headers.getSetCookie();
  const one = res.headers.get('set-cookie');
  return one ? [one] : [];
}

async function main() {
  // 1. requestId
  const r1 = await fetch(`${BASE}/wr-api/assign_request_order`, jbody({ subdomain: SUBDOMAIN, code: CODE }));
  if (!r1.ok) throw new Error(`assign_request_order 失敗 http=${r1.status}`);
  const { requestId } = await r1.json();
  if (!requestId) throw new Error('requestId が得られない (待合室化の可能性)');

  // 2. token。requestId は assign 直後は未反映のことがあるので短い間隔でポーリングする
  //    (404 "Request ID not found" は伝播待ち。待合室有効時もこの経路で順番待ちになる)。
  let token = null;
  for (let attempt = 1; attempt <= 20; attempt++) {
    await sleep(500);
    const r2 = await fetch(`${BASE}/wr-api/generate_token`, jbody({ requestId, subdomain: SUBDOMAIN, code: CODE }));
    if (r2.ok) { token = (await r2.json()).token; if (token) break; }
    else if (r2.status !== 404) throw new Error(`generate_token 失敗 http=${r2.status}`);
    process.stderr.write(`  token 待機 ${attempt}/20 (http=${r2.status})\r`);
  }
  if (!token) throw new Error('token が得られない (待合室が有効・混雑の可能性)。時間をおいて再試行。');
  process.stderr.write('\n');

  // 3. セッション確立 (Cookie 取得)。/waiting/ へ 302 されたら待合室有効=中断。
  const r3 = await fetch(`${BASE}/public/${CODE}?_viewAccessToken=${token}&_viewRef=`, { redirect: 'manual' });
  if (r3.status >= 300 && r3.status < 400 && /\/waiting\//.test(r3.headers.get('location') || '')) {
    throw new Error('待合室(/waiting/)へ誘導された。混雑中のため中断。時間をおいて再試行。');
  }
  const cookie = cookieHeader(getSetCookies(r3));

  // 4. records ページング
  const recHeaders = cookie ? { cookie } : {};
  const first = await fetch(`${BASE}/public/internal/api/records/${CODE}/1?`, { headers: recHeaders });
  if (!first.ok) throw new Error(`records page1 失敗 http=${first.status} (待合室/セッション不成立の可能性)`);
  const firstJson = await first.json();
  const total = firstJson.totalCount;
  const perPage = firstJson.records.length;
  const pages = Math.ceil(total / perPage);
  const out = [];
  const pushRecords = (recs) => {
    for (const rec of recs) {
      const row = {};
      for (const [fc, key] of Object.entries(FIELD)) {
        const cell = rec[fc];
        row[key] = cell ? String(cell.value ?? '') : '';
      }
      out.push(row);
    }
  };
  pushRecords(firstJson.records);
  process.stderr.write(`totalCount=${total} perPage=${perPage} pages=${pages}\n`);

  for (let p = 2; p <= pages; p++) {
    await sleep(PAGE_DELAY_MS);
    const res = await fetch(`${BASE}/public/internal/api/records/${CODE}/${p}?`, { headers: recHeaders });
    if (!res.ok) throw new Error(`records page${p} 失敗 http=${res.status}`);
    const j = await res.json();
    pushRecords(j.records);
    process.stderr.write(`  page ${p}/${pages} (+${j.records.length}) total=${out.length}\r`);
  }
  process.stderr.write('\n');

  if (out.length !== total) throw new Error(`件数不一致 got=${out.length} totalCount=${total}`);

  const payload = {
    fetched_at: process.env.EXTRACTED_AT || (() => { throw new Error('EXTRACTED_AT env 必須'); })(),
    source: SOURCE_URL,
    api: '/public/internal/api/records/<code>/<page>',
    totalCount: total,
    records: out,
  };
  writeFileSync(join(HERE, 'cache', 'records.json'), JSON.stringify(payload, null, 1));
  console.log(`wrote ${out.length} records -> cache/records.json`);
}

main().catch((e) => { console.error('FETCH ERROR:', e.message); process.exit(1); });
