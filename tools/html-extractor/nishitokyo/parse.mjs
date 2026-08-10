// 西東京市 地域別 HTML カレンダー(テキスト版)のパーサ。
// 「<h2>YYYY年M月</h2> + 直後の table.table01」が 12 ヶ月ぶん並ぶ。
// table は「日番号行 / 内容行」の交互・各行 7 セル (日曜〜土曜)。
// これを Map<isoDate, category[]> に変換する (build と verify で共有)。
import { parse as parseHtml } from 'node-html-parser';

export const BASE = 'https://www.city.nishitokyo.lg.jp/kurasi/gomi_recycle/gomi-calebder/gomicalender_exel';
export const AREAS = [1, 2, 3, 4, 5, 6, 7, 8];
// 地域 N のページは {N}{N}{N}.html (111.html, 222.html, … 888.html)
export const AREA_URL = (n) => `${BASE}/${String(n).repeat(3)}.html`;

// カレンダー上の品目表記 → 正典 category (0 個以上)。
// 語彙外の品目は先例に従って既存 category に寄せるか除外する:
//   小型家電 → metal (所沢・東秩父。金属類と常に同日・同一集合)
//   ライター → spray_can に同梱 (「びん・スプレー缶・ライター」1 セルで 1 品目)
//   廃食用油 → 除外 (鯖江。金属類と常に同日なので日程情報の欠落はゼロ)
export const ITEM2CATS = {
  '可燃ごみ': ['burnable'],
  'せん定枝・落ち葉・草・おむつ': ['burnable'], // 可燃と常に同日。独立ルールは作らない
  'ペットボトル': ['pet_bottle'],
  'プラスチック容器包装類': ['plastic'],
  '不燃ごみ': ['non_burnable'],
  '有害ごみ・危険物': ['hazardous'],
  'びん・スプレー缶・ライター': ['glass_bottle', 'spray_can'],
  '古紙・古布類（衣類等）': ['paper_cloth'],
  '缶': ['beverage_can'],
  '金属類': ['metal'],
  '小型家電': ['metal'], // 金属類と同日・同一集合
  '廃食用油': [], // 語彙なし。金属類と同日のため日程は失われない
  '休み': [], // 土日
  '収集なし': [], // 平日の休止日 (年末年始等)
};

const WD_HEADER = ['日曜', '月曜', '火曜', '水曜', '木曜', '金曜', '土曜'];
const pad = (n) => String(n).padStart(2, '0');

// セルの innerHTML → <br> 区切りのトークン配列
function cellTokens(td) {
  return td.innerHTML
    .split(/<br\s*\/?>/i)
    .map((s) => parseHtml(s).textContent.replace(/ /g, ' ').trim())
    .filter((s) => s.length > 0);
}

// 月ブロック (h2 + 直後の table) を切り出す
function monthBlocks(html) {
  const out = [];
  const re = /<h2[^>]*>\s*(\d{4})年(\d{1,2})月\s*<\/h2>/g;
  let m;
  while ((m = re.exec(html))) {
    const from = re.lastIndex;
    const ts = html.indexOf('<table', from);
    const te = html.indexOf('</table>', ts);
    if (ts < 0 || te < 0) throw new Error(`${m[1]}年${m[2]}月: 直後に table が見つからない`);
    out.push({ year: Number(m[1]), month: Number(m[2]), table: html.slice(ts, te + 8) });
  }
  if (!out.length) throw new Error('月見出しが 1 つも見つからない');
  return out;
}

// HTML 全体 → Map<isoDate, category[]>。
// 収集なしの日 (休み・収集なし) も空配列で入れる (全品目停止の明示)。
export function parseCalendar(html) {
  const events = new Map();
  for (const { year, month, table } of monthBlocks(html)) {
    const rows = parseHtml(table).querySelectorAll('tr');
    const head = rows[0].querySelectorAll('th').map((th) => th.textContent.trim());
    if (head.join(',') !== WD_HEADER.join(','))
      throw new Error(`${year}-${month}: 曜日ヘッダが想定と異なる [${head}]`);

    const seen = new Set();
    for (let i = 1; i + 1 < rows.length; i += 2) {
      const dayCells = rows[i].querySelectorAll('td');
      const itemCells = rows[i + 1].querySelectorAll('td');
      if (dayCells.length !== 7 || itemCells.length !== 7)
        throw new Error(`${year}-${month}: 行 ${i} のセル数が 7 でない (${dayCells.length}/${itemCells.length})`);

      for (let c = 0; c < 7; c++) {
        const dayText = dayCells[c].textContent.replace(/ /g, ' ').trim();
        const items = cellTokens(itemCells[c]);
        if (!dayText) { // 月外のセル。品目が入っていたら構造の読み違い
          if (items.length) throw new Error(`${year}-${month}: 日番号の無いセルに品目 [${items}]`);
          continue;
        }
        if (!/^\d{1,2}$/.test(dayText)) throw new Error(`${year}-${month}: 日番号が数値でない "${dayText}"`);
        const day = Number(dayText);
        const d = new Date(year, month - 1, day);
        if (d.getMonth() !== month - 1) throw new Error(`${year}-${month}-${day}: 存在しない日付`);
        if (d.getDay() !== c) throw new Error(`${year}-${month}-${day}: 曜日列 ${WD_HEADER[c]} と実曜日が不一致`);
        if (seen.has(day)) throw new Error(`${year}-${month}: 日 ${day} が重複`);
        seen.add(day);

        const cats = [];
        for (const it of items) {
          const mapped = ITEM2CATS[it];
          if (!mapped) throw new Error(`未知の品目 "${it}" (${year}-${pad(month)}-${pad(day)})`);
          for (const c2 of mapped) if (!cats.includes(c2)) cats.push(c2);
        }
        events.set(`${year}-${pad(month)}-${pad(day)}`, cats);
      }
    }
    // その月の日数がすべて現れたか (欠落した週の見落とし検出)
    const dim = new Date(year, month, 0).getDate();
    if (seen.size !== dim) throw new Error(`${year}-${month}: 日数 ${seen.size} != ${dim}`);
  }
  return events;
}

// 期間 (YYYY-MM--YYYY-MM) の全日付を iso で返す
export function periodDates(period) {
  const [from, to] = period.split('--');
  const [fy, fm] = from.split('-').map(Number);
  const [ty, tm] = to.split('-').map(Number);
  const out = [];
  for (let d = new Date(fy, fm - 1, 1); d < new Date(ty, tm, 1); d = new Date(d.getTime() + 86400000)) {
    out.push(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`);
  }
  return out;
}

export const DOW = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
