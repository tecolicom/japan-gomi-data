#!/usr/bin/env python3
"""中央区「ごみと資源の分け方・出し方」外国語版パンフ → 曜日表 (照合用)。

日本語版パンフは画像 PDF (27+25 ページで 54 字) で読めないが、**外国語版には
同じ曜日表がテキスト層つきで入っている** (豊島・江東と同じ構図)。
英語版と中国語版はそれぞれ別に組版されているので、HTML 表との突き合わせに使える。

## 韓国語版を使わない理由

韓国語版も同じ表を持つが、**機械で安定して読めない**。
  - 町名のハングルに曜日と同じ字が混じる (신**토**미 / 미나**토** / 가부**토**초 の「토」=土)
    ため、行の曜日グループが 5 個でなく 6 個になる
  - 「닌교초 (人形町) 2초메1〜14번」の週5日の値が行またぎで分断される
「最後の 5 個を採る」等で辻褄は合わせられるが、**取り繕いが要る検査は検査にならない**ので
照合から外した。英語版・中国語版とも 56 行が素直に取れるので、独立な版は 2 つ確保できている。

使い方: extract.py <pdf> --lang en|zh
"""
import argparse
import json
import re
import subprocess
import sys

LANGS = {
    'en': {
        'heads': {'京橋地域': r'Kyobashi Area', '日本橋地域': r'Nihonbashi Area',
                  '月島地域': r'Tsukishima Area'},
        'group': r'(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)(?:\s*(?:/|to|・)\s*(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun))*',
        'day': {'Mon': 0, 'Tue': 1, 'Wed': 2, 'Thu': 3, 'Fri': 4, 'Sat': 5, 'Sun': 6},
        'range': 'to',
        'token': r'Mon|Tue|Wed|Thu|Fri|Sat|Sun',
    },
    'zh': {
        'heads': {'京橋地域': r'京桥区域', '日本橋地域': r'日本桥区域',
                  '月島地域': r'月岛区域'},
        'group': r'周\s*[一二三四五六日](?:\s*[・〜~]\s*周\s*[一二三四五六日])*',
        'day': {'周一': 0, '周二': 1, '周三': 2, '周四': 3, '周五': 4, '周六': 5, '周日': 6},
        'range': '〜',
        'token': r'周[一二三四五六日]',
    },
}
NCOL = 5  # 燃やすごみ / 燃やさないごみ / プラマーク / 資源 / 粗大ごみ


def parse_group(text, L):
    """1 セル分の曜日グループ → 曜日番号の並び。範囲は展開する。"""
    toks = re.findall(L['token'], text)
    if not toks:
        raise SystemExit(f'曜日が読めない: {text!r}')
    idx = [L['day'][t] for t in toks]
    if L['range'] in text:
        if len(idx) != 2:
            raise SystemExit(f'範囲なのに曜日が {len(idx)} 個: {text!r}')
        a, b = idx
        if b <= a:
            raise SystemExit(f'曜日の範囲が逆か週をまたぐ: {text!r}')
        if a == 6 or b == 6:
            raise SystemExit(f'日曜を含む範囲: {text!r}')
        return list(range(a, b + 1))
    if len(set(idx)) != len(idx):
        raise SystemExit(f'曜日が重複: {text!r}')
    return sorted(idx)


def extract(path, lang):
    """地域ごとに { 地域名: [[曜日番号, ...] × 5, ...] } を返す。

    **本文の物理的な並びは HTML の並びと違う。** 英語版・中国語版とも
    京橋 → **月島** → 日本橋 の順で組まれており、素直に上から読むと
    日本橋地域と月島地域が入れ替わる (位置で突き合わせると 320 セル食い違った)。
    見出しで切り分けて地域ごとに返す。
    """
    L = LANGS[lang]
    txt = subprocess.run(['pdftotext', '-layout', path, '-'],
                         capture_output=True, text=True, check=True).stdout
    lines = txt.split('\n')

    # 見出しの位置 → 地域名
    marks = []
    for name, pat in L['heads'].items():
        hits = [i for i, l in enumerate(lines) if re.search(pat, l)]
        if len(hits) != 1:
            raise SystemExit(f'{path}: 「{name}」の見出しが {len(hits)} 個 (1 個のはず)')
        marks.append((hits[0], name))
    marks.sort()

    out = {}
    for k, (pos, name) in enumerate(marks):
        end = marks[k + 1][0] if k + 1 < len(marks) else len(lines)
        rows = []
        for l in lines[pos:end]:
            groups = re.findall(L['group'], l)
            if len(groups) != NCOL:
                continue
            rows.append([parse_group(re.sub(r'\s+', '', g), L) for g in groups])
        if not rows:
            raise SystemExit(f'{path}: {name} の行が 1 つも取れない')
        out[name] = rows
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('pdf')
    ap.add_argument('--lang', required=True, choices=sorted(LANGS))
    a = ap.parse_args()
    json.dump({'areas': extract(a.pdf, a.lang)}, sys.stdout, ensure_ascii=False)
    sys.stdout.write('\n')


if __name__ == '__main__':
    main()
