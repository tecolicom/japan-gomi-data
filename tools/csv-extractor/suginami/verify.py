#!/usr/bin/env python3
"""生成した course YAML を地域別カレンダー PDF (cache/<N>.pdf, 全28枚) と通年機械照合する。

- コース番号 N = 地域別カレンダー PDF 番号 (course-<N>.yaml ↔ <N>.pdf、CSV pdf_url 由来)。
- pdf_calendar.parse() が各 PDF の日付入りカレンダーから {date: set(category)} を返す。
- 期待値は course YAML の rules を通年展開し overrides (年末年始休止) を適用したもの。
  杉並の PDF は年末年始 (12/31〜1/3) を空白にし、それ以外は祝日・お盆も通常収集を印字するので
  overrides と一致する。ズレは差分として報告する (握りつぶさない)。

usage: python3 verify.py
"""
import datetime as dt
import sys
from pathlib import Path

import yaml

import pdf_calendar
import booklet

HERE = Path(__file__).parent
OUT = HERE / '../../../municipalities/tokyo/suginami/2026'
CACHE = HERE / 'cache'

DAY_TO_WD = {'MO': 0, 'TU': 1, 'WE': 2, 'TH': 3, 'FR': 4, 'SA': 5, 'SU': 6}
START, END = dt.date(2026, 4, 1), dt.date(2027, 3, 31)


def expand(course):
    """course YAML → {date: set(category)} (overrides の cancelled 適用済み)"""
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
    courses = {int(yaml.safe_load(p.read_text())['metadata']['course']):
               yaml.safe_load(p.read_text()) for p in sorted(OUT.glob('course-*.yaml'))}
    total_diffs = 0
    total_days = 0
    checked = 0
    for no in sorted(courses):
        course = courses[no]
        pdf_path = CACHE / f'{no}.pdf'
        if not pdf_path.exists():
            print(f'course-{no}: PDF {no}.pdf なし — SKIP')
            total_diffs += 1
            continue
        expected = expand(course)
        got = pdf_calendar.parse(str(pdf_path))
        diffs = []
        d = START
        while d <= END:
            e = expected.get(d, set())
            g = got.get(d, set())
            if e != g:
                diffs.append((d.isoformat(), d.strftime('%a'), 'YAML=' + ','.join(sorted(e)),
                              'PDF=' + ','.join(sorted(g))))
            d += dt.timedelta(days=1)
        checked += 1
        total_days += len(expected)
        areas = '/'.join(a['name'] for a in course['metadata']['areas'])
        if diffs:
            total_diffs += len(diffs)
            print(f'course-{no} ({areas}): {len(diffs)} 差分 / 収集{len(expected)}日')
            for x in diffs[:12]:
                print('   ', *x)
        else:
            print(f'course-{no} ({areas}): OK ({len(expected)}日)')
    print('---')
    print(f'[1] カレンダー PDF 照合: {checked} コース × 通年 ({START}〜{END})、期待収集日 延べ {total_days} 日')
    if total_diffs:
        print(f'NG: {total_diffs} 差分')
        sys.exit(1)
    print(f'    OK: 全 {checked} コース一致')

    # --- [2] 全地域版冊子 P.21 一覧表 × CSV の補助照合 ---
    print('---')
    print('[2] 全地域版冊子 P.21「収集曜日一覧」× CSV 補助照合:')
    ok2 = booklet.main()
    if not ok2:
        sys.exit(1)


if __name__ == '__main__':
    main()
