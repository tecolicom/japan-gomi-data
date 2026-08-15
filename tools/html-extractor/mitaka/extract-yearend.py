#!/usr/bin/env python3
"""三鷹: 地区別カレンダー PDF (12月・翌1月) から年末年始の扱いを読む。

HTML の曜日規則には年末年始が載っていない (「下記添付ファイルでご確認ください」とだけ書かれる)。
この 2 つは PDF にしか無いので、ここで機械的に取り出して sources.mjs の設定と突き合わせる。

  1. 休止日 — セルに「年末のため、収集はありません」と赤字で入る。
     「ありません」の直上にある日番号を同じセルの日付とみなす。
  2. 注記 — 「※12月29日（火）の可燃は臨時に収集します。」
            「※ペットボトルは2回目と4回目、空きびん・缶は3回目と5回目に収集します。」

品目マークは 1 枚の画像に埋め込まれていてテキストとしては読めない。日程そのものの照合は
verify.mjs の PDF_SAMPLES (目視転記) が担う。

出力: {"districts": {<id>: {closed: [...], notes: [...]}}} を stdout へ。
使い方: python3 extract-yearend.py cache/pdf/*.pdf
"""
import argparse
import json
import os
import re
import sys

import pdfplumber

# 12月・翌1月の 2 か月が 1 ページに並ぶ。左が 12 月、右が翌 1 月。
YEAR_MONTH = {'left': (2026, 12), 'right': (2027, 1)}


class ExtractError(RuntimeError):
    pass


def district_id(path):
    m = re.search(r'(\d{6})', os.path.basename(path))
    if not m:
        raise ExtractError(f'ファイル名から地区 ID が読めない: {path}')
    return m.group(1)


def read_pdf(path):
    with pdfplumber.open(path) as pdf:
        if len(pdf.pages) != 1:
            raise ExtractError(f'{path}: 1 ページのはずが {len(pdf.pages)} ページ')
        page = pdf.pages[0]
        words = page.extract_words()
        mid = page.width / 2

        nums = [w for w in words
                if re.fullmatch(r'\d{1,2}', w['text']) and 1 <= int(w['text']) <= 31]
        closed = []
        for stop in [w for w in words if 'ありません' in w['text']]:
            # 同じセルの日番号 = x が近く、すぐ上にあるもの
            cand = [n for n in nums
                    if abs(n['x0'] - stop['x0']) < 60 and 0 < stop['top'] - n['top'] < 80]
            if not cand:
                raise ExtractError(f'{path}: 「ありません」に対応する日番号が見つからない')
            cand.sort(key=lambda n: stop['top'] - n['top'])
            day = int(cand[0]['text'])
            year, month = YEAR_MONTH['left' if stop['x0'] < mid else 'right']
            closed.append(f'{year:04d}-{month:02d}-{day:02d}')

        # 注記は語に分割されたうえ、隣のセルの文字と座標順に混ざって出てくる
        # (「※12月29日（火）の注意注意可燃は臨時に収集年末のため、…します。」)。
        # 連続した文字列としては読めないので、断片の共存で判定する。
        flat = re.sub(r'\s+', '', page.extract_text() or '')
        notes = []
        if '12月29日（火）の' in flat and '可燃は臨時に収集' in flat:
            notes.append('12/29 は可燃を臨時に収集する')
        m = re.search(r'※(ペットボトル|空きびん・缶)は2回目と4回目、(ペットボトル|空きびん・缶)は3回目と5回目に収集します', flat)
        if m:
            notes.append(f'1月は {m.group(1)}=2・4回目 / {m.group(2)}=3・5回目 に繰り下がる')
        return {'closed': sorted(set(closed)), 'notes': notes}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('pdfs', nargs='+')
    args = ap.parse_args()
    out = {}
    for p in args.pdfs:
        out[district_id(p)] = read_pdf(p)
    json.dump({'districts': out}, sys.stdout, ensure_ascii=False, indent=1)
    print()


if __name__ == '__main__':
    main()
