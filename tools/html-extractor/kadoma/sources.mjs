// 門真市の一次ソース: 市公式「地区別ごみカレンダー」ページ (HTML) と地区別カレンダー PDF (A〜F)。
// fetch / build / verify が共有する。
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const HERE = dirname(fileURLToPath(import.meta.url));
export const CACHE = join(HERE, 'cache');

// 地区ごとの町名と収集曜日の表 (規則の一次ソース)
export const INDEX_URL = 'https://www.city.kadoma.osaka.jp/kurashi/gomi/9/35805.html';
const FILES_URL = 'https://www.city.kadoma.osaka.jp/material/files/group/20/';

// 収録期間は PDF の見出し「令和8年4月1日～令和9年3月31日」が裏付ける範囲。HTML には期間の記載が無い
export const PERIOD = '2026-04--2027-03';
export const EDITION_JA = '令和8(2026)年度版';

// course の値は下流の識別子なので振り直さない。1 地区 = 1 course
export const DISTRICTS = ['A', 'B', 'C', 'D', 'E', 'F'].map((d) => ({
  district: d,
  course: d,
  url: `${FILES_URL}${d}.pdf`,
  file: `${d}.pdf`,
}));
