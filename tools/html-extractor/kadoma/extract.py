# 門真市の地区別カレンダー PDF (A3 縦 2 ページ) から、罫線と塗りつぶし図形の座標を JSON で出す。
# 解釈はしない。月の枠・マス・品目の読み取りは parse.mjs が行う。
#
# 文字はすべてアウトライン化されていて (chars 0)、品目名も曲線の集まりとして描かれている。
#   vlines / hlines: 月の枠の罫線 (細長い rect)
#   shapes: 塗りつぶした小さな図形 (曲線と rect)。品目名の字形・日番号・凡例の文字がここに入る
#
# 使い方: python extract.py <pdf>
import json
import sys

import pdfplumber


def r2(v):
    return round(v, 2)


def color(o):
    c = o.get('non_stroking_color')
    if not isinstance(c, (list, tuple)) or len(c) != 3:
        return None
    return [round(v, 3) for v in c]


pages = []
with pdfplumber.open(sys.argv[1]) as pdf:
    for p in pdf.pages:
        vlines = [{'x': r2(r['x0']), 'top': r2(r['top']), 'bottom': r2(r['bottom'])}
                  for r in p.rects if r['height'] > 200 and r['width'] < 1.5]
        hlines = [{'y': r2(r['top']), 'x0': r2(r['x0']), 'x1': r2(r['x1'])}
                  for r in p.rects if r['width'] > 300 and r['height'] < 1.5]
        shapes = []
        for o in p.curves + p.rects:
            if not o.get('fill') or o['width'] >= 30 or o['height'] >= 30:
                continue
            c = color(o)
            if c is None:
                continue
            shapes.append({'c': c, 'x0': r2(o['x0']), 'x1': r2(o['x1']),
                           'top': r2(o['top']), 'bottom': r2(o['bottom'])})
        pages.append({'width': r2(p.width), 'height': r2(p.height),
                      'vlines': vlines, 'hlines': hlines, 'shapes': shapes})

json.dump({'pages': pages}, sys.stdout)
