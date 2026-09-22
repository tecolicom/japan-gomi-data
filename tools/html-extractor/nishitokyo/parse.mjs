// 西東京市 地域別 HTML カレンダー(テキスト版)のパーサ。
// 「<h2>YYYY年M月</h2> + 直後の table.table01」が 12 ヶ月ぶん並ぶ。
// table は「日番号行 / 内容行」の交互・各行 7 セル (日曜〜土曜)。
// これを Map<isoDate, category[]> に変換する (build と verify で共有)。
import { parse as parseHtml } from 'node-html-parser';

export const SITE = 'https://www.city.nishitokyo.lg.jp';
export const BASE = `${SITE}/kurasi/gomi_recycle/gomi-calebder/gomicalender_exel`;
export const INDEX_URL = `${BASE}/index.html`;
// 冊子版 PDF はテキスト版とは別の入口から辿る (市のごみカレンダー案内ページ)
export const CALENDAR_INDEX_URL = `${SITE}/kurasi/gomi_recycle/gomi-calebder/index.html`;
export const AREAS = [1, 2, 3, 4, 5, 6, 7, 8];

// 市が公開している版。**index ページに新旧が併記される**ので、両方を収録する。
// 現行版が切れる前に次版が出るため、片方だけにすると必ず空白期間ができる
// (2026-09-20 に次版が出た時点で現行版はまだ 9/30 まで有効だった)。
export const EDITIONS = [
  {
    period: '2025-10--2026-09',
    editionJa: '令和7年10月〜令和8年9月版',
    titleEra: '令和7年10月から令和8年9月まで',
    yearEnd: /^(2025-12|2026-01-0[123])/,
    bookletEra: '令和7年10月～令和8年9月',
    // **この版の冊子 PDF はテキスト層を持たない。** Illustrator でアウトライン化されており
    // pdffonts が空 = 完全な画像。機械照合できないので verify.mjs の PDF_SAMPLES に
    // 目視転記を保持して層化サンプリングで照合している (playbook §3)。
    bookletText: false,
    // **版ごとに抽出日を固定する。** 固定しないと build を走らせた日が入り、
    // make regen が毎回差分を出す (check-regen は既存データから 1 つだけ日付を
    // 復元して渡すので、複数の版に別々の日付を持たせられない)。
    // この版の日程は次版の追加時も 1 日も変わっていないので、収録当時の日付を保つ。
    extractedAt: '2026-08-10',
  },
  {
    period: '2026-10--2027-09',
    editionJa: '令和8年10月〜令和9年9月版',
    titleEra: '令和8年10月から令和9年9月まで',
    yearEnd: /^(2026-12|2027-01-0[123])/,
    extractedAt: '2026-09-21',
    bookletEra: '令和8年10月～令和9年9月',
    // **この版からテキスト層がある** (13 ページ・約 1.9 万字)。冊子はテキスト版 HTML とは
    // 別に組版されているので、全 2,920 日枠の独立照合に使える。extract-booklet.py 参照。
    bookletText: true,
  },
];

// **地域ページの URL は規則で組み立てない。** 版ごとに命名が変わり、しかも不規則。
//   令和7年度版: 111.html 222.html … 888.html          (n を 3 回)
//   令和8年度版: 1-2026-2027.html … 8-2026-2027.html   **ただし地域5 だけ 20275.html**
// index ページのリンク文言「N　町名…（<元号表記>）」から拾う。
// 武蔵野の枝番 PDF と同型の罠で、規則を仮定すると次の版で静かに壊れる。
export function discoverAreaUrls(indexHtml, titleEra) {
  const out = new Map();
  const re = /<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
  for (let m; (m = re.exec(indexHtml));) {
    const text = m[2].replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim();
    const t = /^(\d)[\s　]*.+?（(.+?)）$/.exec(text);
    if (!t || t[2] !== titleEra) continue;
    const n = Number(t[1]);
    const href = new URL(m[1], INDEX_URL).toString();
    if (out.has(n) && out.get(n) !== href) {
      throw new Error(`地域${n} (${titleEra}) のリンクが 2 通り: ${out.get(n)} / ${href}`);
    }
    out.set(n, href);
  }
  const missing = AREAS.filter((n) => !out.has(n));
  if (missing.length) {
    throw new Error(`index に「${titleEra}」の地域 ${missing.join(',')} のリンクが無い`);
  }
  return out;
}

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

// HTML 全体 → { events: Map<isoDate, category[]>, yearShift }。
// 収集なしの日 (休み・収集なし) も空配列で入れる (全品目停止の明示)。
//
// **月見出しの年がずれている版がある。** 令和8年度版の地域3 は title が正しく
// (令和8年10月から令和9年9月まで)、日付グリッドも 2026/2027 の曜日配置なのに、
// 月見出しだけ「2025年10月」から始まる (市が本文を更新して見出しの年を直し忘れた)。
// expectFirst を渡すと、先頭の月見出しとのずれを年単位で測って全月に適用する。
// **ずらした後も曜日列と実曜日の一致検査は全日効く**ので、根拠のない補正は通らない
// (1 年ずらして辻褄が合うのは、グリッドが実際にその年のものだったときだけ)。
export function parseCalendar(html, { expectFirst } = {}) {
  const blocks = monthBlocks(html);
  let yearShift = 0;
  if (expectFirst) {
    const b = blocks[0];
    if (b.month !== expectFirst.month) {
      throw new Error(`先頭の月見出しが ${b.year}-${b.month} (${expectFirst.month} 月のはず)`);
    }
    yearShift = expectFirst.year - b.year;
    if (Math.abs(yearShift) > 1) {
      throw new Error(`月見出しの年が ${yearShift} 年ずれている (${b.year}-${b.month})`);
    }
  }
  const events = new Map();
  for (const blk of blocks) {
    const { month, table } = blk;
    const year = blk.year + yearShift;
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
  return { events, yearShift };
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


// ---- 冊子版 PDF の発見 ----
//
// **URL も入口も版ごとに変わる。** 令和7年度版は 999.html、令和8年度版は 202610-pdf.html。
// PDF 本体も 999.files/-1-070911.pdf → 202610-pdf.files/1-0810.pdf と綴りが変わり、
// しかも**地域1 だけ先頭のダッシュが無い** (2〜8 は -N-0810.pdf)。
// 地域ページ URL と同じ罠なので、ここも規則を組み立てずリンクから拾う。

const TILDE = /[~～〜]/g;
// **リンクはページ相対のことがある** (202610-pdf.html の「202610-pdf.files/1-0810.pdf」)。
// サイト直下と決めつけると 404 になるので、必ず基準 URL から解決する。
const absolute = (href, base) => new URL(href, base).toString();

/** ごみカレンダー案内ページ → その版の冊子 PDF 一覧ページの URL。 */
export function discoverBookletPage(indexHtml, bookletEra, baseUrl = CALENDAR_INDEX_URL) {
  const want = bookletEra.replace(TILDE, '~');
  const hits = new Set();
  const re = /<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
  for (let m; (m = re.exec(indexHtml));) {
    const text = m[2].replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(TILDE, '~').trim();
    if (text.includes(want) && text.includes('PDF')) hits.add(absolute(m[1], baseUrl));
  }
  if (hits.size !== 1) {
    throw new Error(`冊子版 PDF ページ (${bookletEra}) のリンクが ${hits.size} 本: ${[...hits].join(' / ')}`);
  }
  return [...hits][0];
}

/**
 * 冊子 PDF 一覧ページ → 地域番号 → PDF の URL。
 * リンク文言は「表紙から13ページ（10月から9月）」で**地域番号を含まない**ので、
 * 直前の見出し「（N）町名…」から地域を決める。
 * 各地区共通の分別ページ (-0-…kyoutsu.pdf) は見出しに番号が無いので自然に外れる。
 */
export function discoverBookletPdfs(pageHtml, baseUrl) {
  if (!baseUrl) throw new Error('discoverBookletPdfs には基準 URL が要る (リンクがページ相対)');
  const out = new Map();
  let current = null;
  const re = /<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>|href="([^"]+\.pdf)"/g;
  for (let m; (m = re.exec(pageHtml));) {
    if (m[1] !== undefined) {
      const t = m[1].replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim();
      const n = /^[（(](\d)[）)]/.exec(t);
      current = n ? Number(n[1]) : null;
      continue;
    }
    if (current === null) continue;
    const href = absolute(m[2], baseUrl);
    if (out.has(current) && out.get(current) !== href) {
      throw new Error(`地域${current} の冊子 PDF が 2 通り: ${out.get(current)} / ${href}`);
    }
    out.set(current, href);
    current = null;               // 1 見出しにつき 1 本だけ拾う
  }
  const missing = AREAS.filter((n) => !out.has(n));
  if (missing.length) throw new Error(`冊子 PDF ページに地域 ${missing.join(',')} が無い`);
  return out;
}
