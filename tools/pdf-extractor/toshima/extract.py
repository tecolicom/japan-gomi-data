#!/usr/bin/env python3
"""豊島区 外国語版リーフレット p2 の「曜日一覧」を行 → JSON にする。

6 言語版すべてを同じコードで読むために、**版面の座標を決め打ちしない**。
拠り所は次の 3 つだけで、これはどの言語版にも共通している。

  1. 町丁名も曜日も日本語のまま印字される (訳はその右に並ぶ)
  2. 曜日セルは "火" / "月・木" / "第1・3金" のいずれかの形をしている
  3. 「池袋駅周辺繁華街地域」の見出しから下が繁華街地域の表

**曜日セルの行を軸にする。** 行を上から順に畳んで区切る方式は使えない —
英中韓版は同じ表の行が「日本語+英語」と「中国語+韓国語」の 2 段に分かれて印字され、
その 2 段が隣のレコードとの隙間を埋めてしまう。曜日セルはレコードごとに
ちょうど 1 行に 4 つ並ぶので、それを錨にして町丁名を拾う方が版面に依存しない。

未対応の表記に出会ったら黙って読み飛ばさず SystemExit で止める。

使い方:
  extract.py <pdf> [--name-x-max 119.5]

--name-x-max を与えると町丁名セルを x 座標で切り出して name に入れる
(一次ソース = 英中韓版でのみ使う。日本語名と英訳が字間なしで隣接するため
 隙間では切れず x 帯で切るしかない)。与えなければ name は null で、
 版どうしの照合に使う name_head (先頭の漢字・かな連続) だけが入る。
"""
import argparse
import json
import re
import sys

import pdfplumber

DAY = '日月火水木金土'
# 曜日セルの文法。"火" / "月・木" / "第1・3金" / "第2・4土"
CELL_RE = re.compile(rf'^(?:第(?P<occ>[0-9]+(?:・[0-9]+)*))?(?P<days>[{DAY}](?:・[{DAY}])*)$')
# 町丁名の先頭にある漢字・かなの連続 (版どうしの行の対応づけに使う)
HEAD_RE = re.compile(r"[一-鿿぀-ゟ゠-ヿー]+")
SECTION_MARK = '池袋駅周辺繁華街地域'
# 日本語の町丁名に出てよい文字。ここに無い文字が名前セルに出たら止める。
NAME_OK_RE = re.compile(r'^[一-鿿぀-ゟ゠-ヿー0-9、（）～・]+$')

ROW_TOL = 1.5   # 同じ行とみなす top の差 (pt)
GAP = 3.0       # 同じ run とみなす x の隙間 (pt)


def text_rows(page):
    """chars を行クラスタに畳む。返り値は [[char, ...], ...] を top 昇順で。"""
    chars = [c for c in page.chars if c['text'].strip()]
    chars.sort(key=lambda c: (round(c['top'], 1), c['x0']))
    rows, cur, base = [], [], None
    for c in chars:
        if base is None or abs(c['top'] - base) <= ROW_TOL:
            cur.append(c)
            base = c['top'] if base is None else base
        else:
            rows.append(cur)
            cur, base = [c], c['top']
    if cur:
        rows.append(cur)
    for r in rows:
        r.sort(key=lambda c: c['x0'])
    return rows


def runs(row):
    """1 行を x の隙間で run に割る。返り値は [(x0, text), ...]。"""
    out, seg, sx, prev = [], [], None, None
    for c in row:
        if prev is not None and c['x0'] - prev > GAP:
            out.append((sx, ''.join(seg)))
            seg, sx = [], None
        if sx is None:
            sx = c['x0']
        seg.append(c['text'])
        prev = c['x1']
    if seg:
        out.append((sx, ''.join(seg)))
    return out


EN_RE = re.compile(r'^[A-Za-z0-9.]+$')


def day_cells(row):
    """行の中の曜日セルを x 昇順で返す。

    返すのは (x, 日本語セル, 英語セル or None)。英語セルは日本語セルの
    すぐ右隣の run で、英中韓版にだけある (他言語版では None)。
    日本語セルと英語セルは別々に組まれているので、突き合わせると
    版面上の転記ずれを検出できる。
    """
    rr = runs(row)
    out = []
    for i, (x, t) in enumerate(rr):
        if not CELL_RE.match(t):
            continue
        nxt = rr[i + 1][1] if i + 1 < len(rr) else None
        out.append((x, t, nxt if nxt and EN_RE.match(nxt) else None))
    return sorted(out, key=lambda p: p[0])


def section_top(rows):
    """「池袋駅周辺繁華街地域」見出しの top。表の前半/後半を分ける。"""
    tops = [r[0]['top'] for r in rows
            if SECTION_MARK in ''.join(c['text'] for c in r) and not day_cells(r)]
    if not tops:
        raise SystemExit(f'見出し「{SECTION_MARK}」が見つからない (版面が変わった可能性)')
    return min(tops)


def extract(path, name_x_max=None):
    page = pdfplumber.open(path).pages[1]
    rows = text_rows(page)
    mark = section_top(rows)

    anchors = []  # 曜日セル行
    for r in rows:
        cells = day_cells(r)
        if not cells:
            continue
        if len(cells) != 4:
            joined = ''.join(c['text'] for c in r)[:60]
            raise SystemExit(f'曜日セルが {len(cells)} 個 (4 個のはず): {joined!r}')
        anchors.append({'top': r[0]['top'], 'cells': cells,
                        'section': 'downtown' if r[0]['top'] > mark else 'normal'})
    if not anchors:
        raise SystemExit('曜日セルの行が 1 つも無い (版面が変わった可能性)')

    # 各曜日セル行が受け持つ縦の範囲を、**隣の曜日セル行との中点**で決める。
    # 固定の許容幅では版ごとの行間の違いに耐えられない (ミャンマー語版は折り返しの
    # 行間が英中韓版より広く、日本語名を取り落とした)。中点なら版面に依存しない。
    # 表の最初と最後は、隣との間隔の半分ぶんだけ外へ伸ばす (見出しや問い合わせ先を跨がない)。
    for sect in ('normal', 'downtown'):
        xs = [a for a in anchors if a['section'] == sect]
        if not xs:
            raise SystemExit(f'{sect} の行が 1 つも無い')
        for i, a in enumerate(xs):
            prev = xs[i - 1]['top'] if i else None
            nxt = xs[i + 1]['top'] if i + 1 < len(xs) else None
            half = ((nxt - a['top']) if nxt else (a['top'] - prev)) / 2
            a['lo'] = (prev + a['top']) / 2 if prev else a['top'] - half
            a['hi'] = (nxt + a['top']) / 2 if nxt else a['top'] + half

    records = []
    for a in anchors:
        xmin = a['cells'][0][0]
        # 町丁名は曜日セルより左、かつその行が受け持つ縦の範囲の中。
        pool = sorted(((r[0]['top'], [c for c in r if c['x0'] < xmin]) for r in rows
                       if a['lo'] <= r[0]['top'] <= a['hi']), key=lambda p: p[0])
        chars = [c for _, cs in pool for c in cs]
        if not chars:
            raise SystemExit(f'top={a["top"]:.1f} の行に町丁名が無い')

        # 先頭語 = 読み順 (上から、左から) で**最初に現れる漢字・かなの連続**。
        # 「左端の行から取る」ではいけない: 訳文だけの行が上に来たり (英中韓版の西池袋5丁目)、
        # 訳文の折り返しが日本語名より左に出たり (ミャンマー語版) して版ごとに壊れる。
        # 町丁名は必ず漢字で始まり、訳文 (ラテン/ミャンマー/デーヴァナーガリー等) には
        # 漢字が無いので、最初の漢字連続が町名の先頭になる。
        joined = ''.join(c['text'] for c in chars)
        head = HEAD_RE.search(joined)
        if not head:
            raise SystemExit(f'町丁名に漢字・かなが無い: {joined[:60]!r}')

        name = None
        if name_x_max is not None:
            name = ''.join(c['text'] for c in chars if c['x0'] < name_x_max)
            if not NAME_OK_RE.match(name):
                raise SystemExit(f'町丁名に想定外の文字: {name!r} (x < {name_x_max} の切り出し)')
            if not name.startswith(head.group(0)):
                raise SystemExit(f'町丁名 {name!r} が先頭語 {head.group(0)!r} で始まらない')

        records.append({
            'section': a['section'],
            'name': name,
            'name_head': head.group(0),
            'cells': [t for _, t, _ in a['cells']],
            'cells_en': [e for _, _, e in a['cells']],
            'top': round(a['top'], 2),
        })
    return records


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('pdf')
    ap.add_argument('--name-x-max', type=float, default=None)
    a = ap.parse_args()
    json.dump({'records': extract(a.pdf, a.name_x_max)},
              sys.stdout, ensure_ascii=False, indent=1)
    sys.stdout.write('\n')


if __name__ == '__main__':
    main()
