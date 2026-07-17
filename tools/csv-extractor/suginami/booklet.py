#!/usr/bin/env python3
"""補助照合: 全地域版冊子 (t2026zentiiki.pdf) P.21「ごみ・資源の収集曜日一覧」を
一次 CSV (suginami.csv) と突き合わせる。

一覧表は PDF 1 ページ (index 20) に町 2 列 × 各 8 列で全 52 町を収める。
列: 五十音 / 町名(和英) / 丁目 / 可燃 / 不燃(第n) / 不燃曜日 / 古紙・ペットボトル / びん・かん・プラ。
※ CSV と列順が違う (冊子は古紙・ペットが先)。不燃は「第n」と曜日が別セル。

冊子は表下端の数行 (和田・高円寺南2〜4 等) で町名が縦書き・セル境界がずれ、
pdfplumber の表抽出が町名/丁目ラベルを取りこぼすことがある。そこで
(1) 町名+丁目キーで突合し値差分を報告、(2) さらに曜日パターン 5-tuple の多重集合が
CSV と一致するか (どの行も相手側に対応があるか) を確認する二段構えにする。
値そのものはどちらの見方でも一致することを確かめる。
"""
import csv as _csv
import re
import unicodedata
from collections import Counter
from pathlib import Path

import pdfplumber

HERE = Path(__file__).parent
CACHE = HERE / 'cache'
BOOKLET = CACHE / 't2026zentiiki.pdf'
CSV = CACHE / 'suginami.csv'
TABLE_PAGE = 20  # PDF index (P.21)
DAYS = '日月火水木金土'


def canon(s):
    s = unicodedata.normalize('NFKC', s or '').replace(' ', '').replace('　', '')
    return s.replace('~', '-').replace('〜', '-').replace('～', '-')  # 波ダッシュ統一


def _townjp(cell):
    s = (cell or '').replace('\n', '').replace(' ', '').replace('　', '')
    j = ''.join(ch for ch in s if '一' <= ch <= '鿿' or '぀' <= ch <= 'ヿ')
    return j.replace('丁目', '')


def _chome(cell):
    return ''.join(ch for ch in canon(cell) if ch.isdigit() or ch in '-・').strip('-・')


def _days(cell):
    return ''.join(c for c in canon((cell or '').split('\n')[0]) if c in DAYS)


def _val(r):
    return (r['burn'], r['nonocc'], r['nonwd'], r['paperpet'], r['binkanpla'])


def booklet_rows():
    tbl = pdfplumber.open(str(BOOKLET)).pages[TABLE_PAGE].extract_tables()[0]
    out = []
    for base in (0, 8):  # 左右の町カラムは独立ストリーム (町名の縦連結を分けて引き継ぐ)
        prev = ''
        for row in tbl:
            if len(row) < base + 8 or not _days(row[base + 3]):
                continue  # 可燃列に曜日が無い行 (見出し等) は除外
            town = _townjp(row[base + 1]) or prev
            prev = town
            out.append({'town': town, 'chome': _chome(row[base + 2]),
                        'burn': _days(row[base + 3]),
                        'nonocc': ''.join(c for c in canon(row[base + 4]) if c.isdigit()),
                        'nonwd': _days(row[base + 5]),
                        'paperpet': _days(row[base + 6]),
                        'binkanpla': _days(row[base + 7])})
    return out


def csv_rows():
    out = []
    with open(CSV, encoding='utf-8-sig') as f:
        for r in _csv.DictReader(f):
            name = canon(r['町名'])
            m = re.match(r'^(.+?)([0-9].*?)丁目$', name)
            town = m.group(1) if m else name
            chome = ''.join(c for c in (m.group(2) if m else '') if c.isdigit() or c in '-・').strip('-・')
            wd = lambda col: ''.join(x.group(1) for x in re.finditer(r'([日月火水木金土])曜日', r[col]))
            nb = re.match(r'第([\d,]+)([日月火水木金土])', r['不燃ごみ'])
            out.append({'town': town, 'chome': chome, 'burn': wd('可燃ごみ'),
                        'nonocc': nb.group(1).replace(',', ''), 'nonwd': nb.group(2),
                        'paperpet': wd('古紙・ペットボトル'), 'binkanpla': wd('びん・かん・プラ')})
    return out


def verify():
    """戻り値: (ok, 統計 dict)。CSV と冊子で値差分・多重集合不一致が無ければ ok=True。"""
    bk, cv = booklet_rows(), csv_rows()
    key = lambda r: r['town'] + '|' + r['chome']
    bkmap, cvmap = {key(r): r for r in bk}, {key(r): r for r in cv}
    common = set(bkmap) & set(cvmap)
    key_diffs = [k for k in sorted(common) if _val(bkmap[k]) != _val(cvmap[k])]
    cb, cc = Counter(_val(r) for r in bk), Counter(_val(r) for r in cv)
    stats = {
        'booklet': len(bk), 'csv': len(cv),
        'key_matched': len(common), 'key_value_diffs': key_diffs,
        'booklet_only_keys': sorted(set(bkmap) - set(cvmap)),
        'csv_only_keys': sorted(set(cvmap) - set(bkmap)),
        'multiset_equal': cb == cc,
        'multiset_booklet_only': cb - cc, 'multiset_csv_only': cc - cb,
    }
    ok = not key_diffs and stats['multiset_equal']
    return ok, stats


def main():
    ok, s = verify()
    print(f"冊子P.21={s['booklet']}行  CSV={s['csv']}行")
    print(f"町名+丁目キー一致: {s['key_matched']} / 値差分: {len(s['key_value_diffs'])}")
    for k in s['key_value_diffs']:
        print('   DIFF', k)
    if s['booklet_only_keys'] or s['csv_only_keys']:
        print(f"  キー未整合 (冊子下端の縦書き/セルずれ) 冊子側:{s['booklet_only_keys']} CSV側:{s['csv_only_keys']}")
    print(f"曜日パターン 5-tuple 多重集合一致: {s['multiset_equal']}")
    if not s['multiset_equal']:
        print('  booklet只:', dict(s['multiset_booklet_only']))
        print('  csv只:', dict(s['multiset_csv_only']))
    print('OK' if ok else 'NG')
    return ok


if __name__ == '__main__':
    import sys
    sys.exit(0 if main() else 1)
