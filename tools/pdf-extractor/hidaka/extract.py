#!/usr/bin/env python3
"""日高市「ごみ収集日程表」PDF からコース別の収集日を抽出する。

全 20 コースが 1 本の PDF に載る。3・4 ページ目が「地区別ごみ収集日程表」で、
コースごとに 7 行 × 14 列の表が 1 つずつ並ぶ。

    行0  コース番号1 | 行政区名 | 高萩北 旭ケ丘１・２ …
    行1  可燃ごみ | 分 別 | 4月 | 5月 | … | 3月
    行2  月･木曜日 | 古紙･古布 | 8・22 | 13 | 10 | …
    行3           | ビン･カン   | 24    | 22 | 26 | …
    行4           | ペットボトル | 7・21 | 5・19 | …
    行5           | 有害ごみ   |       | 20 |    | …   ← 空欄はその月に収集なし
    行6           | 粗大･金属  | 10    |    | 19 | …

テキスト層があるので pdfplumber の表抽出がそのまま効く。飯能のような色ベース抽出は要らない。

表の下に「※注意」があり、可燃ごみを休む日 (施設の定期点検) が実日付で書かれている。
月木コースは 5/4・12/31、火金コースは 5/5・1/1。**曜日から推測せず表ごとに読む**。
古紙・古布を市が収集しない区がある場合もここに書かれる (「※注意２ 下鹿山区は…」)。

出力: {"courses": [{course, burnable_days, closed, items, item_notes}]} の JSON を stdout へ。
使い方: python3 extract.py <PDF>
"""
import argparse
import json
import os
import re
import sys

import pdfplumber

PAGES = (2, 3)  # 0 始まり。3・4 ページ目が日程表

# 「4月」…「3月」の列が指す暦年 (収録期間 2026-04--2027-03)
MONTH_YEAR = {4: 2026, 5: 2026, 6: 2026, 7: 2026, 8: 2026, 9: 2026,
              10: 2026, 11: 2026, 12: 2026, 1: 2027, 2: 2027, 3: 2027}

DOW_JA2EN = {'日': 'SU', '月': 'MO', '火': 'TU', '水': 'WE', '木': 'TH', '金': 'FR', '土': 'SA'}

ITEM_ROWS = ['古紙･古布', 'ビン･カン', 'ペットボトル', '有害ごみ', '粗大･金属']

# セルの日付。「8」「8・22」「10・24」。中黒は全角/半角どちらも来うる
DATE_CELL = re.compile(r'^\d{1,2}([・･]\d{1,2})*$')
NOT_COLLECTED = '市では収集しません'


class ExtractError(RuntimeError):
    pass


def norm(s):
    return re.sub(r'\s+', '', s or '').replace('・', '･')


def zen2han(s):
    return s.translate(str.maketrans('０１２３４５６７８９', '0123456789'))


def parse_note_dates(text):
    """「※注意 ５月４日(月)、12月31日(木)は…可燃ごみの収集は行いません」から実日付を取る。"""
    out = []
    for m in re.finditer(r'(\d{1,2})月(\d{1,2})日', zen2han(text)):
        month, day = int(m.group(1)), int(m.group(2))
        if month not in MONTH_YEAR:
            raise ExtractError(f'注意書きの月が範囲外: {month}月{day}日')
        out.append(f'{MONTH_YEAR[month]:04d}-{month:02d}-{day:02d}')
    return out


def parse_course_table(rows, note_text, seq):
    """seq は表の並び順 (ページ → 左右の段 → 上から) で決めた 1 始まりの位置。"""
    head = norm(rows[0][0])
    m = re.match(r'^コース番号(\d+)$', zen2han(head))
    if m:
        course = m.group(1)
        if int(course) != seq:
            raise ExtractError(f'コース番号 {course} が並び順 {seq} と食い違う')
    else:
        # 10 以降は黒丸に白抜きの数字で、テキスト層では 1 文字の制御コード (\x1a) になり
        # コードポイントが取れない。1〜9 は読めていて並び順と一致するので、その並びで補う。
        if not re.match(r'^コース番号.$', head):
            raise ExtractError(f'コース番号が読めない: {head!r}')
        course = str(seq)

    # 行1 が月のヘッダ。「4月」…「3月」が 12 個並ぶことを検査する
    months = []
    for cell in rows[1][2:]:
        mm = re.match(r'^(\d{1,2})月$', norm(zen2han(cell or '')))
        if not mm:
            raise ExtractError(f'コース{course}: 月ヘッダが読めない: {cell!r}')
        months.append(int(mm.group(1)))
    if months != [4, 5, 6, 7, 8, 9, 10, 11, 12, 1, 2, 3]:
        raise ExtractError(f'コース{course}: 月の並びが想定と違う: {months}')

    # 行2 の 1 列目に可燃ごみの曜日 (「月･木曜日」)
    days_cell = norm(rows[2][0])
    dm = re.match(r'^([日月火水木金土])･([日月火水木金土])曜日$', days_cell)
    if not dm:
        raise ExtractError(f'コース{course}: 可燃ごみの曜日が読めない: {days_cell!r}')
    burnable_days = [DOW_JA2EN[dm.group(1)], DOW_JA2EN[dm.group(2)]]

    items, item_notes = {}, {}
    for r in rows[2:]:
        name = norm(r[1])
        if name not in ITEM_ROWS:
            raise ExtractError(f'コース{course}: 未知の品目行: {name!r}')
        dates = []
        merged = norm(''.join(c or '' for c in r[2:]))
        if NOT_COLLECTED in merged:
            # 「市では収集しません。地域の集団資源回収に出してください。」で 12 列が埋まる
            item_notes[name] = '市では収集しません。地域の集団資源回収に出してください。'
            items[name] = []
            continue
        for month, cell in zip(months, r[2:]):
            if cell is None or not norm(cell):
                continue
            token = norm(zen2han(cell))
            if not DATE_CELL.match(token):
                raise ExtractError(f'コース{course} {name} {month}月: 日付として読めない: {cell!r}')
            for d in re.split(r'[・･]', token):
                dates.append(f'{MONTH_YEAR[month]:04d}-{month:02d}-{int(d):02d}')
        items[name] = sorted(dates)

    if len(items) != len(ITEM_ROWS):
        raise ExtractError(f'コース{course}: 品目行が {len(items)} 個 (期待 {len(ITEM_ROWS)})')

    # 「※注意２ 下鹿山区は、古紙・古布を市では収集しません。…」のような区単位の例外。
    # 現行スキーマは規則をコース単位でしか持てないので、該当品目の note に残す。
    area_note = re.search(r'※注意\S*\s*([^※]*?区は、[^※]*?ください。)', note_text)
    if area_note:
        text = re.sub(r'\s+', '', area_note.group(1))
        hit = [i for i in ITEM_ROWS if norm(i) in norm(text)]
        if len(hit) != 1:
            raise ExtractError(f'コース{course}: 区単位の注記がどの品目か決まらない ({hit}): {text!r}')
        item_notes[hit[0]] = text

    closed = parse_note_dates(note_text)
    if not closed:
        raise ExtractError(f'コース{course}: 可燃ごみの休止日が注意書きから読めない: {note_text!r}')
    return {
        'course': course,
        'burnable_days': burnable_days,
        'closed': sorted(set(closed)),
        'items': items,
        'item_notes': item_notes,
        'note_text': re.sub(r'\s+', ' ', note_text).strip(),
    }


def extract(pdf_path):
    courses = []
    found = []
    with pdfplumber.open(pdf_path) as pdf:
        for page_index in PAGES:
            page = pdf.pages[page_index]
            for table in page.find_tables():
                rows = table.extract()
                if len(rows) != 7 or len(rows[1]) != 14:
                    continue  # 見出しなどコース表でないもの
                found.append((page_index, table.bbox, page, rows))
    # 並び順を決める: ページ → 左右の段 → 上から。コース番号 1〜9 はこの順で読めるので、
    # 読めない 10 以降 (丸数字) をこの並びで補ってよいことがその場で確かめられる。
    mid = 400
    found.sort(key=lambda f: (f[0], 0 if f[1][0] < mid else 1, f[1][1]))
    for seq, (_pi, bbox, page, rows) in enumerate(found, 1):
        x0, _top, x1, bottom = bbox
        # 表の直下に「※注意」がある。次の表まで届かない範囲で切る
        strip = page.crop((x0, bottom, x1, min(bottom + 45, page.height)))
        courses.append(parse_course_table(rows, strip.extract_text() or '', seq))
    if len(courses) != 20:
        raise ExtractError(f'コース表が {len(courses)} 個 (期待 20)')
    seen = [c['course'] for c in courses]
    if sorted(seen, key=int) != [str(i) for i in range(1, 21)]:
        raise ExtractError(f'コース番号が 1〜20 を過不足なく覆っていない: {sorted(seen, key=int)}')
    return courses


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('pdf')
    args = ap.parse_args()
    courses = extract(args.pdf)
    json.dump({'pdf': os.path.basename(args.pdf), 'courses': courses},
              sys.stdout, ensure_ascii=False, indent=1)
    print()


if __name__ == '__main__':
    main()
