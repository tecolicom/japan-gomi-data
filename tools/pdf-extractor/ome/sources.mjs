// 青梅市の一次ソース URL とファイル名の規約 (fetch / build / verify で共有)。
export const INDEX_URL = 'https://www.city.ome.tokyo.jp/soshiki/23/1182.html';
export const BASE = 'https://www.city.ome.tokyo.jp/uploaded/attachment';
// 「令和8年度版 資源物・ごみ収集カレンダー」(2026年4月〜2027年3月) の日程別 PDF。
// 市サイトは同じ内容の PDF を町ごとに別 ID で貼っているため (A日程だけで 13 ID)、
// 日程ごとに 1 本を代表として取得する (中身が同一であることは fetch.mjs が確認する)。
export const SCHEDULES = {
  A: '77610', B: '77621', C: '77611', D: '77615',
  E: '77665', F: '77667', G: '77617', H: '77679',
};
export const CAL_URL = (id) => `${BASE}/${id}.pdf`;
export const CAL_FILE = (d) => `${d}.pdf`;
