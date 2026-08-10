#!/usr/bin/env python3
"""武蔵野市 地区別「ごみと資源の収集カレンダー」PDF → {isodate: [category]} 抽出。

PDF は Illustrator 製 A4 横 7 ページ。1 ページ目は表紙 (前年度のミニ暦を含む) で、
2〜7 ページに各 2 ヶ月ブロック (左 = 奇数番目の月 / 右) が入り計 12 ヶ月。
罫線が本物のベクタ線として入っているので、色ベース抽出 (秩父広域) は不要で
座標グリッドをそのまま復元できる。

  ブロック矩形 = 長い水平罫線 (length > 300) の x 範囲 (左 [23, 415.6] / 右 [426.3, 818.9])
  列境界       = 長い垂直罫線 (length > 300) 6 本 + ブロック左右端 → 7 列 (日〜土)
  グリッド天地 = 長い垂直罫線の top/bottom (88.2〜547.4)。これより下はフッター (粗大ごみ案内等)
  月と年       = ヘッダの英語月名 (April 等) と 4 桁西暦。ページ順ではなくこれで判定する

罠と対処:
 1. 太字は文字が二重打ちされる (`燃燃ややすす` → `燃やす`)。偶数長かつ s[i]==s[i+1] (i 偶数)
    なら 1 文字おきに取る。太字化は品目にも注記にも起きる。
 2. ページ番号 (8pt) を日番号と誤認しない。日番号は 12.8pt / 21.0pt なので size>=10 で分離する。
 3. 6 週ある月は物理行が 5 行しかなく、あふれた週末日が同じセルに縦積みされる
    (2026年8月・2027年5月)。行バンドで機械的に切らず、
    「同じ列で自分より上にある直近の日番号」に品目を帰属させる。
 4. `pdftotext -layout` は列がずれる (火曜の品目が水曜に見える)。必ず座標で取る。

使い方: python3 extract.py            → cache/extracted.json を書く
"""
import json
import re
import sys
import unicodedata
from pathlib import Path

import pdfplumber

HERE = Path(__file__).resolve().parent
CACHE = HERE / 'cache'
DISTRICTS = list('abcdefghij')
MONTH_EN = {
    'January': 1, 'February': 2, 'March': 3, 'April': 4, 'May': 5, 'June': 6,
    'July': 7, 'August': 8, 'September': 9, 'October': 10, 'November': 11, 'December': 12,
}
DOW_JA = '日月火水木金土'  # 列 0..6 = 日曜..土曜

# カレンダー上の品目表記 → 正典 category。
# 「プラスチック製」「容器包装」は 1 品目が 2 語に分かれて印字される (どちらも plastic)。
ITEM2CAT = {
    '燃やす': 'burnable',
    '燃やさない': 'non_burnable',
    'プラスチック製': 'plastic',
    '容器包装': 'plastic',
    '古紙・古着': 'paper_cloth',
    'ペットボトル': 'pet_bottle',
    'びん': 'glass_bottle',
    '缶': 'beverage_can',
    '危険有害': 'hazardous',
}

# グリッド内に印字されるが品目ではない語 (注記・バナー)。全 PDF を走査して洗い出した閉集合。
# ここに無い語が出たら黙って捨てず落とす (握りつぶし禁止)。
IGNORE = {
    # 6・7月ページのバナー「7月からペットボトルの毎週収集が始まります!」
    '7月からペットボトルの', '毎週収集が始まります!',
    'ラベルとキャップは必ず外して', '「プラスチック製容器包装」へ。',
    # 12・1月ページの注記「年が明けてもカレンダーを捨てないでください。…」
    '注意', '年が明けてもカレンダーを', '捨てないでください。', '本カレンダーには、',
    '2027', '年', '３', '月までの収集日が', '載っています。',
    # 年末の特別収集であることを示す添え書き (収集日そのものは品目語で表現されている)
    '（年末特別収集）',
}
YEAREND_MARK = '（年末特別収集）'


def undouble(s):
    """太字の二重打ちを畳む。`燃燃ややすす` → `燃やす`。条件を満たさなければそのまま返す。"""
    if len(s) >= 2 and len(s) % 2 == 0 and all(s[i] == s[i + 1] for i in range(0, len(s), 2)):
        return s[::2]
    return s


def cluster(vals, tol=1.0):
    out = []
    for v in sorted(vals):
        if out and v - out[-1][-1] <= tol:
            out[-1].append(v)
        else:
            out.append([v])
    return [sum(g) / len(g) for g in out]


def blocks_of(page):
    """ページ内の月ブロック矩形 (x0, x1) を長い水平罫線の x 範囲から求める。"""
    hl = [l for l in page.lines if abs(l['y0'] - l['y1']) < 0.5 and l['x1'] - l['x0'] > 300]
    if not hl:
        return []
    rects = sorted({(round(l['x0'], 1), round(l['x1'], 1)) for l in hl})
    # 同一ブロックの罫線は完全に同じ x 範囲を持つ (実測)。念のため許容差でまとめる
    merged = []
    for x0, x1 in rects:
        if merged and abs(merged[-1][0] - x0) < 2 and abs(merged[-1][1] - x1) < 2:
            continue
        merged.append((x0, x1))
    return merged, sorted({round(l['top'], 1) for l in hl})


def extract_district(path):
    """1 地区の PDF → {iso: sorted[category]} と年末特別収集の日付一覧。"""
    events = {}
    yearend_marks = []
    months_seen = []
    with pdfplumber.open(path) as pdf:
        for page in pdf.pages:
            got = blocks_of(page)
            if not got:
                continue  # 表紙 (長い水平罫線が無い)
            rects, hrows = got
            vl = [l for l in page.lines if abs(l['x0'] - l['x1']) < 0.5 and l['bottom'] - l['top'] > 300]
            if not vl:
                continue
            grid_top, grid_bottom = min(hrows), max(round(l['bottom'], 1) for l in vl)
            words = page.extract_words(extra_attrs=['size'])

            for bx0, bx1 in rects:
                inblock = lambda w: bx0 - 0.5 <= w['x0'] < bx1
                # 列境界: ブロック内の長い垂直罫線 + 左右端
                cols = [bx0] + cluster([round(l['x0'], 1) for l in vl if bx0 < l['x0'] < bx1]) + [bx1]
                if len(cols) != 8:
                    raise SystemExit(f'{path.name} p{page.page_number}: 列境界が {len(cols) - 1} 本 (7 列でない)')

                # ヘッダ (年・英語月名) はブロック枠より数 pt 外にはみ出して置かれている
                head = [w for w in words if bx0 - 10 <= w['x0'] < bx1 and w['top'] < grid_top]
                mon = [MONTH_EN[w['text']] for w in head if w['text'] in MONTH_EN]
                yrs = [int(w['text']) for w in head if re.fullmatch(r'20\d\d', w['text']) and w['size'] > 14]
                if len(mon) != 1 or len(yrs) != 1:
                    raise SystemExit(f'{path.name} p{page.page_number}: 月/年の判定に失敗 {mon} {yrs}')
                month, year = mon[0], yrs[0]
                months_seen.append((year, month))

                def col_of(w):
                    # 語の中心で判定する。左端 (x0) だと、セル内で中央寄せされた添え書き
                    # 「(年末特別収集)」が隣の列にはみ出して誤帰属する (実例: 12/29 → 12/28)。
                    cx = (w['x0'] + w['x1']) / 2
                    for i in range(7):
                        if cols[i] - 0.5 <= cx < cols[i + 1]:
                            return i
                    raise SystemExit(f'{path.name} p{page.page_number}: 列外の語 {w["text"]!r} x={cx:.1f}')

                grid = [w for w in words if inblock(w)
                        and w['top'] >= grid_top - 1 and w['bottom'] <= grid_bottom + 1]

                daynums, items = [], []
                for w in grid:
                    text = undouble(w['text'])
                    if re.fullmatch(r'\d{1,2}', w['text']) and w['size'] >= 10:
                        daynums.append((col_of(w), w['top'], int(w['text'])))
                    elif text in ITEM2CAT:
                        items.append((col_of(w), w['top'], text))
                    elif text in IGNORE:
                        if text == YEAREND_MARK:
                            items.append((col_of(w), w['top'], YEAREND_MARK))
                    else:
                        raise SystemExit(
                            f'{path.name} p{page.page_number} {year}-{month:02d}: 未知の語 {text!r} '
                            f'(x={w["x0"]:.1f} top={w["top"]:.1f} size={w["size"]})')

                # 月の日がすべて 1 回ずつ現れ、列 = 実曜日であること
                import calendar
                dim = calendar.monthrange(year, month)[1]
                seen = {}
                for col, top, day in daynums:
                    if day in seen:
                        raise SystemExit(f'{path.name}: {year}-{month:02d}-{day} が重複')
                    if not 1 <= day <= dim:
                        raise SystemExit(f'{path.name}: {year}-{month:02d} に日 {day}')
                    import datetime
                    wd = (datetime.date(year, month, day).weekday() + 1) % 7  # 0=日
                    if wd != col:
                        raise SystemExit(
                            f'{path.name}: {year}-{month:02d}-{day} の列 {DOW_JA[col]} が実曜日 {DOW_JA[wd]} と不一致')
                    seen[day] = True
                if len(seen) != dim:
                    raise SystemExit(f'{path.name}: {year}-{month:02d} の日数 {len(seen)} != {dim}')

                for day in range(1, dim + 1):
                    events.setdefault(f'{year}-{month:02d}-{day:02d}', [])

                # 品目は「同じ列で自分より上にある直近の日番号」に帰属させる
                for col, top, text in items:
                    above = [(t, d) for c, t, d in daynums if c == col and t < top]
                    if not above:
                        raise SystemExit(
                            f'{path.name}: {year}-{month:02d} の {text!r} (列 {DOW_JA[col]}) に対応する日番号が無い')
                    day = max(above)[1]
                    iso = f'{year}-{month:02d}-{day:02d}'
                    if text == YEAREND_MARK:
                        yearend_marks.append(iso)
                        continue
                    cat = ITEM2CAT[text]
                    if cat not in events[iso]:
                        events[iso].append(cat)

    if len(months_seen) != 12 or len(set(months_seen)) != 12:
        raise SystemExit(f'{path.name}: 月ブロックが 12 個そろわない {sorted(set(months_seen))}')
    return {k: sorted(v) for k, v in sorted(events.items())}, sorted(set(yearend_marks))


def main():
    out = {}
    for d in DISTRICTS:
        name = f'2026{d}-1-1.pdf' if d in ('c', 'e') else f'2026{d}-1.pdf'
        path = CACHE / name
        events, marks = extract_district(path)
        out[d] = {'source_pdf': name, 'events': events, 'yearend_special': marks}
        n = sum(1 for v in events.values() if v)
        print(f'{d}: {len(events)} 日 (収集 {n} 日) 年末特別収集 {marks}', file=sys.stderr)
    (CACHE / 'extracted.json').write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding='utf-8')
    print(f'wrote {CACHE / "extracted.json"}', file=sys.stderr)


if __name__ == '__main__':
    main()
