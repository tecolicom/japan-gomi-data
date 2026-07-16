#!/usr/bin/env python3
"""生成した course YAML を町丁目別カレンダー PDF (R8-<NO>.pdf, 全42枚) と通年機械照合する。

- R8-<NO> の NO はオープンデータ CSV の NO 列と一致 (build.mjs が cache/no-to-area.json を出力)。
- PDF のチップ名 → 正典カテゴリ: 燃やす=burnable, 資源プラ=plastic,
  び缶ペ=glass_bottle+beverage_can+pet_bottle, 陶ガラ金=non_burnable。
- 年末年始: PDF は 12/27〜1/3 の最終週を空白にする (確定告知は12月頃) が、
  データは 12/31〜1/3 のみ休止 (meta.yaml notes 参照)。この窓 (12/27〜1/3) は
  「PDF 側に収集が無いこと」だけを確認し、日程比較からは除外する。

usage: python3 verify.py
"""
import datetime as dt
import json
import sys
from pathlib import Path

import yaml

import pdf_calendar

HERE = Path(__file__).parent
OUT = HERE / '../../../municipalities/tokyo/tokyo-nakano/2026'
CACHE = HERE / 'cache'

CHIP_TO_CATS = {
    '燃やす': {'burnable'},
    '資源プラ': {'plastic'},
    'び缶ペ': {'glass_bottle', 'beverage_can', 'pet_bottle'},
    '陶ガラ金': {'non_burnable'},
}
DAY_TO_WD = {'MO': 0, 'TU': 1, 'WE': 2, 'TH': 3, 'FR': 4, 'SA': 5, 'SU': 6}

# 区 PDF 側の誤植・未解明の空白 (目視確認済み、README「PDF の罠」参照)。データ側が正。
KNOWN_PDF_ERRATA = {
    (15, dt.date(2026, 4, 27)), (15, dt.date(2026, 4, 28)), (15, dt.date(2026, 4, 30)),  # 空白 (未解明・過去日)
    (28, dt.date(2026, 4, 27)), (28, dt.date(2026, 4, 28)), (28, dt.date(2026, 4, 30)),  # 同上
    (28, dt.date(2027, 1, 30)),  # 2027-01 最終週の日付誤植でチップ欠落
    (29, dt.date(2026, 5, 28)), (29, dt.date(2026, 8, 27)),  # チップ文字が「資源プラ」誤記 (色は陶ガラ金で正)
}
START, END = dt.date(2026, 4, 1), dt.date(2027, 3, 31)
BLANK_LO, BLANK_HI = dt.date(2026, 12, 27), dt.date(2027, 1, 3)  # PDF 空白週

def expand(course):
    """course YAML → {date: set(category)} (overrides 適用済み)"""
    cancelled = {o['date'] if isinstance(o['date'], dt.date) else dt.date.fromisoformat(o['date'])
                 for o in course.get('overrides', []) if o.get('cancelled')}
    out = {}
    d = START
    while d <= END:
        cats = set()
        for r in course['rules']:
            if d.weekday() not in [DAY_TO_WD[x] for x in r['days']]:
                continue
            if r['pattern'] == 'weekly':
                cats.add(r['category'])
            elif r['pattern'] == 'monthly_nth' and (d.day - 1) // 7 + 1 in r['occurrences']:
                cats.add(r['category'])
        if cats and d not in cancelled:
            out[d] = cats
        d += dt.timedelta(days=1)
    return out

def main():
    no_to_area = json.loads((CACHE / 'no-to-area.json').read_text())
    courses = [yaml.safe_load(p.read_text()) for p in sorted(OUT.glob('course-*.yaml'))]
    area_to_course = {}
    for c in courses:
        for a in c['metadata']['areas']:
            area_to_course[a['name']] = c

    total_diffs = 0
    for no_str, area in sorted(no_to_area.items(), key=lambda kv: int(kv[0])):
        no = int(no_str)
        pdf_path = CACHE / f'R8-{no}.pdf'
        if not pdf_path.exists():
            print(f'NO {no} ({area}): PDF なし — SKIP')
            total_diffs += 1
            continue
        course = area_to_course[area]
        expected = expand(course)
        got_chips = pdf_calendar.parse(str(pdf_path))
        got = {}
        for d, chips in got_chips.items():
            cats = set()
            for chip in chips:
                cats |= CHIP_TO_CATS[chip]
            got[d] = cats
        diffs = []
        d = START
        while d <= END:
            e = expected.get(d, set())
            g = got.get(d, set())
            if BLANK_LO <= d <= BLANK_HI:
                if g:  # PDF 空白想定週に収集が印字されていたら報告 (12月の確定告知反映後は要更新)
                    diffs.append((d, 'PDF空白週に印字', sorted(g)))
            elif e != g and (no, d) not in KNOWN_PDF_ERRATA:
                diffs.append((d, sorted(e), sorted(g)))
            d += dt.timedelta(days=1)
        label = f"NO {no} ({area}) -> course-{course['metadata']['course']}"
        if diffs:
            total_diffs += len(diffs)
            print(f'{label}: {len(diffs)} 差分')
            for x in diffs[:8]:
                print('   ', *x)
        else:
            print(f'{label}: OK')
    print('---')
    if total_diffs:
        print(f'NG: {total_diffs} 差分')
        sys.exit(1)
    print(f'OK: 全 {len(no_to_area)} 町丁目 × 通年 ({START}〜{END}) 一致')

if __name__ == '__main__':
    main()
