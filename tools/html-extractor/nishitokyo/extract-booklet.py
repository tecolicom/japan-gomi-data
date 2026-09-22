#!/usr/bin/env python3
"""西東京市 冊子版カレンダー PDF → 日付ごとの収集種別 (独立照合用)。

一次ソースは地域別 HTML (テキスト版)。これはそれと**別に組版された**冊子版で、
令和8年10月版から**テキスト層を持つようになった** (令和7年10月版は Illustrator で
アウトライン化されており pdffonts が空 = 完全な画像。あちらは目視の層化サンプリングしか
できず、verify.mjs の PDF_SAMPLES に転記を保持している)。

## 読み取りの難所

1. **文字が二重に描かれている。** 同じ字が同じ位置に 2 回置かれるので、素の
   extract_text は「日日 SSuunnddaayy」になる。dedupe_chars(tolerance=1) で潰す。

2. **ページ外に複製レイヤーがある。** 曜日ヘッダが top=55.8 と top=654.3 の 2 箇所に出る
   (ページ高 595.3)。ページ内に絞らないと列の数が倍になる (江東で踏んだのと同型)。

3. **週が 6 つ必要な月は、6 行目を半端な位置に押し込む。**
   2027年1月: 1/31(日) だけ最終行の下に x0=89.6 (通常の列頭は 21.8) で置かれる。
   2027年5月: 5/1(土) を第1行の土曜セルに入れ、5/8(土) を**全角の「８」**で
   同じ列の下に重ねる。つまり第1行は [2,3,4,5,6,7 / 1･8] という並びになる。
   **行グリッドを固定すると壊れる**ので、内容語は「同じ列で自分より上にある
   最も近い日付」に寄せる。

4. 祝日名は赤 (CMYK 0,0.9,0.85,0) の Meiryo で、品目とは別レイヤー。色で外す。

## 検査

- 列は日付の x0 から作る。間隔が一定でなければ throw
- **全日について「日付から決まる曜日 == その日が居る列」を検査する**。
  一次ソース HTML 側で月見出しの年が 1 年古いという誤植を踏んでいるので、
  冊子にも同種の誤植が無いことを仮定しない
- セル内の語は既知の語彙に無ければ throw。組み合わせも既知のパターンに無ければ throw

使い方: extract-booklet.py <pdf>
"""
import argparse
import calendar
import json
import re
import sys
import unicodedata

import pdfplumber

# 語 → 収集種別。1 語が 1 品目とは限らない (「可」「燃」で 1 品目、
# 「古」「紙・古」「布」で 1 品目) ので、語ごとに属する種別を書く。
# 空リストは「その語だけでは種別を足さない」ではなく「種別を足さない語」。
WORD_CATS = {
    'ペットボトル': ['pet_bottle'],
    'プラスチック': ['plastic'], '容器包装類': [],
    '可': ['burnable'], '燃': [],
    'せん定枝': [], 'おむつ': [],          # 可燃と常に同一セル (taxonomy の groups 参照)
    '不燃': ['non_burnable'], '有害・危険物': ['hazardous'],
    '缶': ['beverage_can'],
    '金属類': ['metal'], '小型家電・廃食用油': [],
    '古': ['paper_cloth'], '紙・古': [], '布': [],
    'びん': ['glass_bottle'], 'スプレー缶': ['spray_can'], 'ライター': [],
    '収集はありません': [],
}

# セルに出てよい語の組み合わせ。未知の組み合わせは throw する。
# **並び順では持たない。** 同じセルでも語の top/x0 の前後が版面で入れ替わるので、
# 読み順を鍵にすると同じ組み合わせが別物に見える。
CELL_PATTERNS = {frozenset(k): v for k, v in {
    (): '(なし)',
    ('収集はありません',): '収集なし',
    ('可', '燃', 'せん定枝', 'おむつ'): '可燃',
    ('ペットボトル', 'プラスチック', '容器包装類'): 'ペットボトル+プラ容器包装',
    ('不燃', '有害・危険物'): '不燃+有害',
    ('缶',): '缶',
    ('金属類', '小型家電・廃食用油'): '金属類',
    ('古', '紙・古', '布', 'びん', 'スプレー缶', 'ライター'): 'びん等+古紙古布',
}.items()}

HOLIDAY_COLOR = (0.0, 0.9, 0.85, 0.0)   # 赤。祝日名だけがこの色
# 枠の一番上は曜日ヘッダ。日付より上にあるので内容語と混ざる。
HEADER_WORDS = set('日月火水木金土') | {
    'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'}
DAY_SIZE_MIN = 20                        # 日付は 24pt、品目は 17pt 以下
GRID_MIN_WIDTH = 600                     # 日程表は幅 813pt。小さい表は装飾


def norm_digits(s):
    """全角数字を半角にする (2027年5月の「８」が全角)。"""
    return unicodedata.normalize('NFKC', s)


def collapse_overlaps(ws, where):
    """同じ語が重ねて 2 度置かれているのを 1 つにする。

    版下の残骸で、**同じ品目名が 0.7pt ほどずらして 2 回描かれている**セルがある
    (地域6 の 2027年8月18日、地域8 の 2027年2月3日 の「有害・危険物」)。
    文字の大きさが 15.6pt と 14.3pt で違うので dedupe_chars では畳めない。
    重なっているものだけ畳み、離れていたら別の情報なので throw する。"""
    out = []
    for w in ws:
        same = [o for o in out if o['text'] == w['text']]
        if not same:
            out.append(w)
            continue
        o = same[0]
        if w['x0'] < o['x1'] and o['x0'] < w['x1'] and w['top'] < o['bottom'] and o['top'] < w['bottom']:
            continue                      # 重なっている = 同じものの二度書き
        raise SystemExit(f'{where}: 「{w["text"]}」が離れた 2 箇所にある '
                         f'(x0={o["x0"]:.1f},top={o["top"]:.1f} と x0={w["x0"]:.1f},top={w["top"]:.1f})')
    return out


def color_of(w):
    c = w.get('non_stroking_color') or ()
    return tuple(round(float(x), 2) for x in c)


def grid_bbox(page):
    """日程表の枠。フッタの CID 化けテキストを外すために下端が要る。"""
    wide = [t for t in page.find_tables() if (t.bbox[2] - t.bbox[0]) > GRID_MIN_WIDTH]
    if len(wide) != 1:
        raise SystemExit(f'p.{page.page_number}: 幅のある表が {len(wide)} 枚 (1 枚のはず)')
    return wide[0].bbox


def month_of(words, gtop, page_no):
    """ページ上部の見出し → (年, 月)。**語の並びは一定でない**
    (「10月 2026年」と「2026年 12月」の両方が出る) ので順序に頼らない。"""
    text = ''.join(w['text'] for w in words if w['top'] < gtop)
    years = re.findall(r'(\d{4})年', text)
    months = re.findall(r'(\d{1,2})月', text)
    if len(set(years)) != 1 or len(set(months)) != 1:
        raise SystemExit(f'p.{page_no}: 月見出しが読めない 年{set(years)} 月{set(months)}')
    return int(years[0]), int(months[0])


def columns(anchors, gx0, page_no):
    """日付の x0 から列の左端を作る。間隔が一定でなければ throw。"""
    full = {}
    for a in anchors:
        full.setdefault(round(a['top']), []).append(a)
    rows = [sorted(v, key=lambda w: w['x0']) for v in full.values() if len(v) == 7]
    if len(rows) < 4:
        raise SystemExit(f'p.{page_no}: 7 日そろった週が {len(rows)} 行しかない')
    xs = [w['x0'] for w in rows[0]]
    pitch = (xs[-1] - xs[0]) / 6
    for i, x in enumerate(xs):
        if abs(x - (xs[0] + pitch * i)) > 1.0:
            raise SystemExit(f'p.{page_no}: 列 {i} の x0={x:.1f} が等間隔でない (間隔 {pitch:.1f})')
    # 列頭の文字は枠線より内側に入るので、その差だけ左へ寄せて境界にする
    off = xs[0] - gx0
    return [x - off for x in xs], pitch


def col_of(x, bounds, page_no, what):
    for i in range(len(bounds) - 1, -1, -1):
        if x >= bounds[i]:
            return i
    raise SystemExit(f'p.{page_no}: {what} の x={x:.1f} が最初の列より左')


def extract_page(page, page_no):
    page = page.dedupe_chars(tolerance=1)
    H = page.height
    gx0, gtop, gx1, gbot = grid_bbox(page)
    words = [w for w in page.extract_words(extra_attrs=['size', 'non_stroking_color'])
             if 0 <= w['top'] <= H]
    year, month = month_of(words, gtop, page_no)

    inside = [w for w in words if gtop < w['top'] < gbot]
    anchors = [{**w, 'value': int(norm_digits(w['text']))} for w in inside
               if w['size'] > DAY_SIZE_MIN and re.fullmatch(r'\d{1,2}', norm_digits(w['text']))]
    if not anchors:
        raise SystemExit(f'p.{page_no}: 日付が 1 つも取れない')

    # 枠の一番上は曜日ヘッダ。日付より上にあるので内容語と混ざる。中身も確かめて外す。
    top0 = min(a['top'] for a in anchors)
    head = [w['text'] for w in inside if w['top'] < top0 - 2]
    if set(head) != HEADER_WORDS:
        raise SystemExit(f'p.{page_no}: 曜日ヘッダが想定と違う: {sorted(set(head))}')

    content = [w for w in inside
               if w['top'] >= top0 - 2 and w not in anchors and color_of(w) != HOLIDAY_COLOR
               and not (w['size'] > DAY_SIZE_MIN and re.fullmatch(r'\d{1,2}', norm_digits(w['text'])))]

    bounds, pitch = columns(anchors, gx0, page_no)
    for a in anchors:
        a['col'] = col_of((a['x0'] + a['x1']) / 2, bounds, page_no, f"日付 {a['value']}")

    # --- 日付 → 実日付。**列と曜日の一致でしか当月と認めない** ---
    #
    # ただし曜日だけでは足りない。**2月は 28 日 = 7 の倍数**なので、2月のページの
    # 末尾に出る「3月1日」が 2月1日 とまったく同じ列に来る (2027年2月で実際に衝突した)。
    # 同じく 3月のページ先頭の「2月28日」が 3月28日 と同じ列に来る。
    # 当月の日付は上から順に並ぶので、候補が複数あるときは
    # 「前日より下にあるもののうち最も上」を採り、最後に単調性を検査する。
    dim = calendar.monthrange(year, month)[1]
    cand = {}
    for a in anchors:
        if 1 <= a['value'] <= dim and calendar.weekday(year, month, a['value']) == (a['col'] + 6) % 7:
            cand.setdefault(a['value'], []).append(a)
    missing = [d for d in range(1, dim + 1) if d not in cand]
    if missing:
        raise SystemExit(
            f'p.{page_no} ({year}年{month}月): 列と曜日が合う日が見つからない: {missing} '
            f'(月見出しの年が誤っている可能性。冊子の現物を見ること)')

    cells = {}
    prev_top = -1.0
    for d in range(1, dim + 1):
        ok = sorted((a for a in cand[d] if a['top'] >= prev_top), key=lambda w: w['top'])
        if not ok:
            raise SystemExit(f'p.{page_no}: {year}-{month:02d}-{d:02d} が前日より上にしかない')
        cells[d] = {'anchor': ok[0], 'words': []}
        prev_top = ok[0]['top']

    # --- 内容語を「同じ列で自分より上にある最も近い日付」へ寄せる ---
    by_col = {}
    for a in anchors:
        by_col.setdefault(a['col'], []).append(a)
    for v in by_col.values():
        v.sort(key=lambda w: w['top'])
    for w in content:
        c = col_of((w['x0'] + w['x1']) / 2, bounds, page_no, f"「{w['text']}」")
        above = [a for a in by_col.get(c, []) if a['top'] <= w['top']]
        if not above:
            raise SystemExit(f'p.{page_no}: 「{w["text"]}」(top={w["top"]:.1f}) の上に日付が無い')
        a = above[-1]
        if w['top'] > a['top'] + pitch:
            raise SystemExit(f'p.{page_no}: 「{w["text"]}」が日付 {a["value"]} から {w["top"] - a["top"]:.1f}pt 離れている')
        if a['value'] in cells and cells[a['value']]['anchor'] is a:
            cells[a['value']]['words'].append(w)
        # 当月でない日付 (前後の月のセル) に付く語は捨てる

    out = {}
    for d, cell in cells.items():
        where = f'p.{page_no}: {year}-{month:02d}-{d:02d}'
        ws = collapse_overlaps(sorted(cell['words'], key=lambda w: (round(w['top']), w['x0'])), where)
        texts = [w['text'] for w in ws]
        unknown = [t for t in texts if t not in WORD_CATS]
        if unknown:
            raise SystemExit(f'{where} に未知の語 {unknown}')
        if frozenset(texts) not in CELL_PATTERNS:
            raise SystemExit(f'{where} のセルが未知の組み合わせ {texts}')
        cats = sorted({c for t in texts for c in WORD_CATS[t]})
        out[f'{year}-{month:02d}-{d:02d}'] = cats
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('pdf')
    a = ap.parse_args()
    events = {}
    with pdfplumber.open(a.pdf) as pdf:
        if len(pdf.pages) < 13:
            raise SystemExit(f'{a.pdf}: {len(pdf.pages)} ページ (表紙 + 12 ヶ月 = 13 以上のはず)')
        for i in range(1, 13):           # 1 ページ目は表紙
            for k, v in extract_page(pdf.pages[i], i + 1).items():
                if k in events:
                    raise SystemExit(f'{a.pdf}: {k} が 2 ページに出る')
                events[k] = v
    json.dump({'events': events}, sys.stdout, ensure_ascii=False)
    sys.stdout.write('\n')


if __name__ == '__main__':
    main()
