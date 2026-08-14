#!/usr/bin/env python3
"""飯能市 コース別ごみ収集カレンダー PDF の色ベース抽出。

この PDF は InDesign 製で、テキスト層が全く無い (pdfplumber の chars が 0)。
品目名も日番号もアウトライン化された図版なので、文字は一切読まない。
読むのは「暦で決めたセル領域に、どの品目色が塗られているか」だけ。

秩父広域 (tools/pdf-extractor/chichibu-koiki) と同じ方針だが、飯能の PDF は
罫線が本物のベクタ線として残っているので、四隅座標をハードコードせず
**毎回罫線からグリッドを復元する**。市がレイアウトを動かしても座標がずれない。

グリッドの構造 (実測):

    曜日ヘッダ行  高さ ~11pt   ← 月ブロックの目印。左右の罫線 8 本が列境界になる
    第1週         高さ ~42pt
    第2週         高さ ~42pt
    第3週         高さ ~42pt
    第4週         高さ ~42pt
    第5週         高さ ~21pt   ← 最終行は上下 2 段に分かれている
    第6週         高さ ~21pt   ← 6 週ある月だけ下段を使う

最終行が最初から 2 段に割ってあるので、秩父で要った blob 分割 (連結成分の重心で
週5/週6 に振り分ける処理) は不要で、週の取り違えが原理的に起きない。
列幅は不均等 (日曜・土曜が狭い) なので等分割はせず、罫線の実測値をそのまま使う。

出力: {"course": "...", "items": {品目名: [YYYY-MM-DD, ...]}} の JSON を stdout へ。
使い方: python3 extract.py <PDF> [--dpi 150] [--debug]
"""
import argparse
import calendar
import collections
import json
import os
import subprocess
import sys
import tempfile

import numpy as np
import pdfplumber
from PIL import Image

# 品目 -> 代表 RGB (150dpi レンダリングでの実測値)。
# 旧 extractor のヘッダが書き残した凡例 (灰=不燃・紫=粗大・白=紙布) は実物と違う。
# 実際のセル塗り分けを 4 月の既知セルから測り直したものがこれ。
REFS = {
    '可燃':   (249, 179, 220),  # ピンク
    'プラ':   (179, 230, 250),  # 水色
    'ペット': (179, 227, 182),  # 薄緑
    '粗大':   (249, 178, 137),  # 薄橙
    '不燃':   (255, 245, 64),   # 黄
    '有害':   (191, 225, 66),   # 黄緑
    '飲料缶': (255, 250, 166),  # 薄黄
    '紙布':   (211, 208, 168),  # カーキ
    'びん':   (251, 201, 75),   # オレンジ
}

# 品目ではないと分かっている色 (セルの地・日番号や「休業」の文字)。
# ここに無い色がセル面積の UNKNOWN_RATIO 以上を占めたら「未対応の塗り」として落とす。
IGNORE = {
    '白':   (255, 255, 255),
    '黒':   (35, 31, 32),
    '赤':   (237, 28, 36),
    '青':   (9, 148, 220),   # 土曜の日番号
}

PAGE_MONTHS = {
    0: [(2026, 4), (2026, 5), (2026, 6), (2026, 7), (2026, 8), (2026, 9)],
    1: [(2026, 10), (2026, 11), (2026, 12), (2027, 1), (2027, 2), (2027, 3)],
}

# 参照色は近いものがある (不燃(255,245,64) と びん(251,201,75) は |RGB差| で 59 しか離れて
# いない)。閾値で「どれかに当たるか」を見ると取り違えるので、各画素は最も近い参照色 1 つに
# 割り当て、その距離が MAX_DIST を超えたものだけ未知として扱う。
MAX_DIST = 30          # 画素を参照色に割り当てる上限 (|RGB差| の合計)

# 年末年始の「休業」は白地に赤文字で、品目色が無い = 収集なしとしては正しく落ちる。
# ただしそれだと「休んだ」のか「元々収集がない日」なのかが区別できない。
# 赤い画素の量で「休業」の 2 文字を拾い、休業日として別に報告する。
# 実測: 「休業」は 317〜347 px、祝日の日番号 (同じ赤) は 74〜89 px できれいに分かれる。
CLOSED_RED_MIN = 200
MIN_RATIO = 0.08       # セル面積に対する比率。これ以上あれば「その品目あり」
UNKNOWN_RATIO = 0.03   # 既知色に当たらない「単一の色」がこれ以上を占めたら throw
UNKNOWN_MIN_PX = 150   # 同上。狭いセルで文字の縁が相対的に増えるので絶対数でも下限を置く
PAD = 0.15             # セル境界の罫線を避けるための内側マージン

# 行の高さ (pt)。週行は実測で 42.2〜42.5 か 20.8〜21.4 にきれいに分かれる。
# 月ブロックの下には高さ 39.9 の帯 (次ブロックの見出し枠) が混じることがあり、
# 42 に近いので範囲を広く取ると週行として拾ってしまう。狭く取って選別する。
HEADER_H = (8, 16)     # 曜日ヘッダ行
FULL_H = (41, 44)      # 通常の週行
HALF_H = (19, 23)      # 最終行 (上下 2 段に割れているとき)


class ExtractError(RuntimeError):
    pass


def cluster(vals, tol):
    """近い値をまとめて代表値 (平均) の列にする。"""
    vals = sorted(vals)
    groups, cur = [], [vals[0]]
    for v in vals[1:]:
        if v - cur[-1] <= tol:
            cur.append(v)
        else:
            groups.append(sum(cur) / len(cur))
            cur = [v]
    groups.append(sum(cur) / len(cur))
    return groups


def vertical_lines(page):
    return [l for l in page.lines if abs(l['x1'] - l['x0']) < 0.5]


def row_bands(lines):
    """垂直線を上端でまとめ、(top, bottom, [x...]) の帯にして上から順に返す。"""
    bands = []
    for t in cluster([l['top'] for l in lines], 2):
        grp = [l for l in lines if abs(l['top'] - t) <= 2]
        bands.append((t, sum(l['bottom'] for l in grp) / len(grp), [l['x0'] for l in grp]))
    bands.sort(key=lambda b: b[0])
    return bands


def blocks_of_page(page):
    """1 ページ分の月ブロック 6 個を、罫線から復元して返す。

    返り値は [{'cols': [x0..x7], 'rows': [y...]}] を左→右・上→下の順に並べたもの。
    rows は週行の境界で、要素数はその月ブロックの行数 + 1。

    行の高さは月ブロックごとに違う。最終行が上下 2 段に割ってある月 (6 週ある月と、
    5 週でも下に空段を残す月) があるため、段の左右で行数が揃わない。
    したがって左右のブロックを別々に組み、暦の週数と突き合わせるのは呼び出し側で行う。
    """
    lines = vertical_lines(page)
    heads = [b for b in row_bands(lines) if HEADER_H[0] <= b[1] - b[0] <= HEADER_H[1]]
    if len(heads) != 3:
        raise ExtractError(f'曜日ヘッダの段が 3 つでない ({len(heads)} 個): レイアウトが変わった可能性')

    blocks = []
    for top, bottom, xs in heads:
        cols = cluster(xs, 2)
        if len(cols) != 16:
            raise ExtractError(f'列境界が左右あわせて 16 本でない ({len(cols)} 本) at y={top:.1f}')
        nxt = min((h[0] for h in heads if h[0] > top), default=float('inf'))

        for side in (cols[:8], cols[8:]):
            own = [l for l in lines if side[0] - 2 <= l['x0'] <= side[-1] + 2 and bottom - 1 <= l['top'] < nxt]
            isRow = lambda h: FULL_H[0] <= h <= FULL_H[1] or HALF_H[0] <= h <= HALF_H[1]
            bands = [b for b in row_bands(own) if isRow(b[1] - b[0])]
            if not bands:
                raise ExtractError(f'週行が 1 本も無い at x={side[0]:.1f} y={top:.1f}')
            # ヘッダ直下から連続している行だけを週行とする (間が空いたらそこで打ち切る)
            rows = [bands[0][0]]
            for b in bands:
                if abs(b[0] - rows[-1]) > 2:
                    break
                rows.append(b[1])
            if len(rows) - 1 > 6:
                raise ExtractError(f'週行が 7 本以上ある ({len(rows) - 1}) at x={side[0]:.1f} y={top:.1f}')
            blocks.append({'cols': side, 'rows': rows})
    return blocks


def render(pdf, page_index, dpi):
    tmp = tempfile.mkdtemp()
    prefix = os.path.join(tmp, 'pg')
    subprocess.run(
        ['pdftoppm', '-png', '-r', str(dpi), '-f', str(page_index + 1), '-l', str(page_index + 1), pdf, prefix],
        check=True,
    )
    return Image.open(f'{prefix}-{page_index + 1}.png').convert('RGB')


def cell_span(rows, weeks, wi, dow):
    """(wi, dow) のセルが占める y 範囲を返す。

    最終行は上下 2 段に割ってあるが、**6 週ある月で、その列に 6 週目の日がある場合だけ**
    上下が別々の日になる。6 週目が無い列では 2 段ぶんが 1 つの縦長セルで、そこに品目が
    2 つ縦積みされる。上段だけ見ると下の品目を丸ごと落とす (実際 24 日ぶん取りこぼした)。

    最終週は下に空段があればそこまでを 1 セルとして使うが、**使うのは 2 段まで**。
    罫線からは月ブロックの下に余分な段が拾われることがあり (行が 7 つになる月がある)、
    残り全部を含めると隣の要素まで巻き込む。品目色は無いので日程には響かないが、
    「休業」の赤字を数えるときに誤検出する。
    """
    last = len(rows) - 1
    if wi == 4 and len(weeks) > 5:
        # 6 週の月の第 5 週。その列に第 6 週の日があるなら上段だけ、無ければ 2 段ぶん
        return (rows[4], rows[5]) if weeks[5][dow] else (rows[4], rows[min(6, last)])
    if wi == len(weeks) - 1:
        return rows[wi], rows[min(wi + 2, last)]
    return rows[wi], rows[wi + 1]


def cell_items(arr, scale, cols, rows, weeks, wi, dow, where):
    """セル領域の色を数え、含まれる品目の集合を返す。未知の塗りがあれば落とす。"""
    x0, x1 = cols[dow], cols[dow + 1]
    y0, y1 = cell_span(rows, weeks, wi, dow)
    dx, dy = (x1 - x0) * PAD, (y1 - y0) * PAD
    sub = arr[
        int((y0 + dy) * scale):int((y1 - dy) * scale),
        int((x0 + dx) * scale):int((x1 - dx) * scale),
    ].reshape(-1, 3).astype(np.int16)
    if sub.size == 0:
        raise ExtractError(f'セル領域が空: {where}')
    total = sub.shape[0]

    names = list(REFS) + list(IGNORE)
    palette = np.array(list(REFS.values()) + list(IGNORE.values()))
    dist = np.abs(sub[:, None, :] - palette[None, :, :]).sum(2)
    nearest, best = dist.argmin(1), dist.min(1)
    assigned = best <= MAX_DIST

    found = set()
    for i, name in enumerate(names[:len(REFS)]):
        if (assigned & (nearest == i)).sum() / total >= MIN_RATIO:
            found.add(name)

    # 文字の縁のアンチエイリアスはどの参照色からも遠いが、色が細かく散らばるので
    # 単色ではまとまらない。面で塗られた品目色だけが単色の塊として残る。
    # 「未知の単色が面を占めている」= 語彙が増えた/配色が変わったとみなして落とす。
    rest = sub[~assigned]
    if rest.shape[0]:
        rgb, n = collections.Counter(map(tuple, rest)).most_common(1)[0]
        if n >= UNKNOWN_MIN_PX and n / total >= UNKNOWN_RATIO:
            raise ExtractError(
                f'未対応の塗り色: {where} に {tuple(int(v) for v in rgb)} が {n}/{total} px。'
                f' 品目が増えたか配色が変わった可能性がある'
            )
    return found


def cell_is_closed(arr, scale, cols, rows, weeks, wi, dow):
    """そのセルに「休業」の赤文字が入っているか。"""
    x0, x1 = cols[dow], cols[dow + 1]
    y0, y1 = cell_span(rows, weeks, wi, dow)
    dx, dy = (x1 - x0) * PAD, (y1 - y0) * PAD
    sub = arr[
        int((y0 + dy) * scale):int((y1 - dy) * scale),
        int((x0 + dx) * scale):int((x1 - dx) * scale),
    ].reshape(-1, 3).astype(np.int16)
    red = np.array(IGNORE['赤'])
    return int((np.abs(sub - red).sum(1) < MAX_DIST).sum()) >= CLOSED_RED_MIN


def extract(pdf, dpi, debug=False):
    result = {name: set() for name in REFS}
    closed = set()
    with pdfplumber.open(pdf) as doc:
        for page_index, months in PAGE_MONTHS.items():
            page = doc.pages[page_index]
            blocks = blocks_of_page(page)
            img = render(pdf, page_index, dpi)
            arr = np.asarray(img)
            scale = img.size[1] / float(page.height)

            for mi, (year, month) in enumerate(months):
                cols, rows = blocks[mi]['cols'], blocks[mi]['rows']
                weeks = calendar.Calendar(firstweekday=6).monthdayscalendar(year, month)
                # 行が週数より多い月がある (最終行の下に空段が残る)。暦の週数だけ上から使う。
                if len(rows) - 1 < len(weeks):
                    raise ExtractError(
                        f'{year}-{month:02d}: 罫線の行が {len(rows) - 1} で暦の {len(weeks)} 週に足りない'
                    )
                for wi, week in enumerate(weeks):
                    for dow, day in enumerate(week):
                        if not day:
                            continue
                        key = f'{year}-{month:02d}-{day:02d}'
                        where = f'{key} (page {page_index + 1}, 週{wi + 1}, 曜{dow})'
                        for name in cell_items(arr, scale, cols, rows, weeks, wi, dow, where):
                            result[name].add(key)
                        if cell_is_closed(arr, scale, cols, rows, weeks, wi, dow):
                            closed.add(key)
                if debug:
                    print(f'  {year}-{month:02d}: {len(weeks)} 週', file=sys.stderr)
    return {name: sorted(dates) for name, dates in result.items()}, sorted(closed)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('pdf')
    ap.add_argument('--dpi', type=int, default=150)
    ap.add_argument('--debug', action='store_true')
    args = ap.parse_args()
    items, closed = extract(args.pdf, args.dpi, args.debug)
    json.dump(
        {'pdf': os.path.basename(args.pdf), 'items': items, 'closed': closed},
        sys.stdout, ensure_ascii=False, indent=1,
    )
    print()


if __name__ == '__main__':
    main()
