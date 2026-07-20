// 品川区 ODP RDF/XML のパーサ (経路 B: ODP 語彙 URI 解釈)。
//
// CSV パーサ (parse.mjs) との独立性を保つための制約:
//   - rdfs:label ("第2木・第4木" 等の日本語ラベル) を一切読まない。
//   - 収集日は odp:hasCollectionDay → rdf:value の URI フラグメント
//     (#SecondThursday / #EveryTuesday …) だけから復元する。
//   - 分類は odp:classified の Classification URI (percent-encoded) から復元する。
//   - 地区は schema:address → schema:streetAddress から復元する。
// これにより「日本語文字列の解釈」と「URI 語彙の解釈」という別経路になり、
// 一方のパースミスをもう一方が検出できる。
//
// RDF 構造:
//   <rdf:Description rdf:about="…375#<分類>/<地区>/">
//     <odp:classified rdf:resource="…/Classification/<分類>"/>
//     <schema:address rdf:nodeID="A34"/>
//     <odp:hasCollectionDay rdf:nodeID="A35"/>
//   <rdf:Description rdf:nodeID="A34"><schema:streetAddress>大井6丁目</schema:streetAddress>
//   <rdf:Description rdf:nodeID="A35"><rdf:value rdf:resource="…#FirstMonday"/>…
//                                     <odp:isCollectToPublicHoliday>true</…>

const ORDINAL = { First: 1, Second: 2, Third: 3, Fourth: 4, Fifth: 5 };
const WEEKDAY = {
  Sunday: 'SU', Monday: 'MO', Tuesday: 'TU', Wednesday: 'WE',
  Thursday: 'TH', Friday: 'FR', Saturday: 'SA',
};

// "#EveryTuesday" → {occurrence:null, day:'TU'} / "#SecondThursday" → {occurrence:2, day:'TH'}
export function parseDayUri(fragment) {
  const m = fragment.match(/^(Every|First|Second|Third|Fourth|Fifth)(Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday)$/);
  if (!m) throw new Error(`未知の ODP 収集日語彙: "${fragment}"`);
  return { occurrence: m[1] === 'Every' ? null : ORDINAL[m[1]], day: WEEKDAY[m[2]] };
}

// nodeID ブロック / about ブロックを素朴に切り出す (依存を増やさないための正規表現ベース)。
const blocks = (xml, attr) => [
  ...xml.matchAll(new RegExp(`<rdf:Description rdf:${attr}="([^"]*)"\\s*>([\\s\\S]*?)</rdf:Description>`, 'g')),
].map((m) => ({ key: m[1], body: m[2] }));

export function parseShinagawaRdf(xml) {
  // 1) 空白ノード: 住所ノードと収集日ノード
  const addresses = new Map();   // nodeID → 地区名
  const collectionDays = new Map(); // nodeID → {pattern, days, occurrences, holiday}
  for (const { key, body } of blocks(xml, 'nodeID')) {
    const addr = body.match(/<schema:streetAddress[^>]*>([^<]*)<\/schema:streetAddress>/);
    if (addr) { addresses.set(key, addr[1].trim()); continue; }

    const uris = [...body.matchAll(/<rdf:value rdf:resource="http:\/\/odp\.jig\.jp\/odp\/1\.0#([^"]+)"/g)].map((m) => m[1]);
    if (!uris.length) continue; // 分類ラベル等のノード
    const parsed = uris.map(parseDayUri);
    const days = [...new Set(parsed.map((p) => p.day))];
    const isEvery = parsed.map((p) => p.occurrence === null);
    if (isEvery.some(Boolean) !== isEvery.every(Boolean)) {
      throw new Error(`毎週と第n が混在する収集日ノード ${key}`);
    }
    const holidayRaw = body.match(/<odp:isCollectToPublicHoliday[^>]*>([^<]*)</);
    const entry = { holiday: holidayRaw ? holidayRaw[1].trim() === 'true' : null };
    if (isEvery[0]) {
      Object.assign(entry, { pattern: 'weekly', days });
    } else {
      if (days.length !== 1) throw new Error(`第n で曜日が複数の収集日ノード ${key}`);
      const occurrences = [...new Set(parsed.map((p) => p.occurrence))].sort((a, b) => a - b);
      Object.assign(entry, { pattern: 'monthly_nth', occurrences, days });
    }
    collectionDays.set(key, entry);
  }

  // 2) 実体ノード (分類 × 地区)
  const out = [];
  for (const { key: about, body } of blocks(xml, 'about')) {
    // rdf:type が RubbishCollectionDay の実体ノードだけを対象にする。
    // (データセット記述ノードは odp:target で同じ URI を参照するので type で絞る)
    if (!/<rdf:type rdf:resource="http:\/\/odp\.jig\.jp\/odp\/1\.0#RubbishCollectionDay"\s*\/>/.test(body)) continue;
    const cls = body.match(/<odp:classified rdf:resource="http:\/\/odp\.jig\.jp\/res\/Classification\/([^"]+)"/);
    const addrRef = body.match(/<schema:address rdf:nodeID="([^"]+)"/);
    const dayRef = body.match(/<odp:hasCollectionDay rdf:nodeID="([^"]+)"/);
    if (!cls || !addrRef || !dayRef) throw new Error(`実体ノードに必須要素が無い: ${about}`);
    const area = addresses.get(addrRef[1]);
    const day = collectionDays.get(dayRef[1]);
    if (area === undefined) throw new Error(`住所ノード未解決: ${addrRef[1]} (${about})`);
    if (day === undefined) throw new Error(`収集日ノード未解決: ${dayRef[1]} (${about})`);
    out.push({ category: decodeURIComponent(cls[1]), area, day, holiday: day.holiday });
  }
  return out;
}
