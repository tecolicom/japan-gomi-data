# みなかみ町のごみ収集カレンダー PDF (1 枚 1 ページ) から、語と記号の座標を JSON で出す。
# 解釈はしない。表と日付表の読み取りは parse.mjs が行う。
#
#   words: 語 (pdfplumber の extract_words)。表の文言・見出し・日番号
#   marks: 日付表の記号 1 文字ずつ (■ ▲ 衣)。「■衣」のように 1 語に連なることがあるので文字単位で出す
#
# 使い方: python extract.py <pdf>
import json
import sys

import pdfplumber

MARKS = set('■▲衣●')

with pdfplumber.open(sys.argv[1]) as pdf:
    if len(pdf.pages) != 1:
        raise SystemExit(f'{sys.argv[1]}: 1 ページのはずが {len(pdf.pages)} ページ')
    p = pdf.pages[0]
    words = [
        {'text': w['text'], 'x0': round(w['x0'], 2), 'x1': round(w['x1'], 2),
         'top': round(w['top'], 2), 'size': round(w['size'], 2)}
        for w in p.extract_words(extra_attrs=['size'])
    ]
    marks = [
        {'ch': c['text'], 'x0': round(c['x0'], 2), 'x1': round(c['x1'], 2),
         'top': round(c['top'], 2), 'size': round(c['size'], 2)}
        for c in p.chars if c['text'] in MARKS
    ]
    json.dump({'width': p.width, 'height': p.height, 'words': words, 'marks': marks},
              sys.stdout, ensure_ascii=False)
