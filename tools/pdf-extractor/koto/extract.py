#!/usr/bin/env python3
"""江東区 配布シート (多言語版) → JSON (地区・曜日規則・燃やさないごみの実日付)。

日本語版 (8omote.pdf) は `chars` 0 の画像 PDF、裏面は CID フォント化けで読めない。
**テキスト層を持つのは多言語版だけ** (豊島区と同じ構図)。中国語版と韓国語版は
同じ表を別々に組版してあるので、同じコードで読んで突き合わせられる。

1 ページに 12 地区が 3 列 × 4 段。各地区のブロックはこう並ぶ:

    收集地区编号  <町名リスト>
     N  地区
       资源      塑料      易燃垃圾
       周六      周四      周二、周五
    不易燃垃圾收集日 隔周 周一
    4月 5月 6月 7月 8月 9月          ← 月ヘッダ
     6日 4日 1日 13日 10日 7日       ← 日付 (最大 3 行)
    20日 18日 15日 27日 24日 21日
              29日
    10月 11月 12月 1月 2月 3月
    ...

## 踏んだ罠

**月の列に日付を寄せるとき、数字だけを見てはいけない。** 月ヘッダは "4" と "月" が、
日付は "6" と "日" が**別々の語**として出る。数字の中心だけで列に寄せると隣の月へ
流れ込み、調査中に全 12 地区で曜日ずれと 11/13/15/17 日の間隔が出た。
**数字と単位を組にして、その合成スパンの中心**で寄せる。

使い方: extract.py <pdf> --lang zh|ko
"""
import argparse
import collections
import datetime
import json
import re
import sys

import pdfplumber

# 言語ごとの語彙。拠り所はこれだけで、版面の座標は決め打ちしない。
LANGS = {
    'zh': {
        'biweekly': '隔周',
        'month': {'月'}, 'day': {'日'},
        'days': {'周一': 0, '周二': 1, '周三': 2, '周四': 3, '周五': 4, '周六': 5, '周日': 6},
        'sep': '、',
        'cats': {'资源': '資源', '塑料': 'プラスチック', '易燃垃圾': '燃やすごみ'},
    },
    'ko': {
        'biweekly': '격주',
        # 韓国語版は 1 か所だけ単位が漢字の「月」で組まれている (版面のゆれ)
        'month': {'월', '月'}, 'day': {'일', '日'},
        'days': {'월': 0, '화': 1, '수': 2, '목': 3, '금': 4, '토': 5, '일': 6},
        'sep': 'ㆍ',
        'cats': {'자원': '資源', '플라스틱': 'プラスチック'},
    },
}
YM = [(2026, m) for m in range(4, 13)] + [(2027, m) for m in range(1, 4)]
# 月ヘッダの並び (左→右、上段 4〜9 月 / 下段 10〜3 月)
MONTH_ORDER = [4, 5, 6, 7, 8, 9, 10, 11, 12, 1, 2, 3]
ROW_TOL = 6   # 同じ月ヘッダ行とみなす top の揺れ (pt)


def ym_of(month):
    return (2026, month) if month >= 4 else (2027, month)


def units(words, unit_set):
    """数字 + 単位 の組を (値, 中心x, top, 右端x) で返す。

    2 つの形がある。**どちらか一方を前提にすると版によって落ちる。**
      - 分かち書き … "4" "月" が別の語 (中国語版、韓国語版の 10〜3 月)
      - 連結       … "4월" が 1 語 (韓国語版の 4〜9 月)
    合成スパンの中心を列合わせに使う (数字だけの中心では隣の列へ流れる)。
    """
    out = []
    joined = re.compile('^(\\d{1,2})(?:' + '|'.join(re.escape(u) for u in unit_set) + ')$')
    for w in words:
        m = joined.match(w['text'])
        if m:
            out.append({'v': int(m.group(1)), 'cx': (w['x0'] + w['x1']) / 2,
                        'top': w['top'], 'x1': w['x1']})
            continue
        if w['text'] not in unit_set:
            continue
        cand = [n for n in words
                if re.fullmatch(r'\d{1,2}', n['text'])
                # 韓国語版は数字が単位より 4pt ほど下にある
                and abs(n['top'] - w['top']) < 6
                and 0 <= w['x0'] - n['x1'] < 9]
        if not cand:
            continue
        n = max(cand, key=lambda c: c['x1'])
        out.append({'v': int(n['text']), 'cx': (n['x0'] + w['x1']) / 2,
                    'top': w['top'], 'x1': w['x1']})
    return out


def extract(path, lang):
    L = LANGS[lang]
    page = pdfplumber.open(path).pages[0]
    if len(pdfplumber.open(path).pages) != 1:
        raise SystemExit(f'{path}: 1 ページのはず')
    # **ページの外にある語を落とす。** 韓国語版には x が負の領域に日本語のレイヤーが
    # 潜んでおり (単位が「月」「日」)、そのまま拾うと月ヘッダが 3 倍に増える。
    words = [w for w in page.extract_words()
             if 0 <= w['x0'] and w['x1'] <= page.width and 0 <= w['top'] <= page.height]

    anchors = [w for w in words if w['text'] == L['biweekly']]
    if len(anchors) != 12:
        raise SystemExit(f'{path}: 「{L["biweekly"]}」が {len(anchors)} 個 (12 のはず)')
    anchors.sort(key=lambda w: (round(w['top'] / 60), w['x0']))
    # 列のピッチをアンカー自身から測る (版面の座標を決め打ちしない)。
    colx = sorted({round(a['x0']) for a in anchors})
    if len(colx) != 3:
        raise SystemExit(f'{path}: 地区の列が {len(colx)} 本 (3 本のはず)')
    pitch = (colx[-1] - colx[0]) / 2

    # アンカーを 4 段 × 3 列に整える
    rowkeys = sorted({round(a['top'] / 60) for a in anchors})
    if len(rowkeys) != 4:
        raise SystemExit(f'{path}: 地区の段が {len(rowkeys)} 段 (4 段のはず)')
    for a in anchors:
        a['_row'] = rowkeys.index(round(a['top'] / 60))
    for r in rowkeys:
        same = sorted([a for a in anchors if round(a['top'] / 60) == r], key=lambda a: a['x0'])
        if len(same) != 3:
            raise SystemExit(f'{path}: 段の地区が {len(same)} 個 (3 個のはず)')
        for c, a in enumerate(same):
            a['_col'] = c

    months = units(words, L['month'])
    days = units(words, L['day'])

    # 月ヘッダを「段 → 月ヘッダ行の top → 3 ブロック × 6 列」に割る。
    row_top = {r: min(a['top'] for a in anchors if a['_row'] == r) for r in range(4)}
    month_rows, month_cols = {}, {}
    for r in range(4):
        lo = row_top[r]
        hi = row_top[r + 1] if r + 1 < 4 else 1e9
        tops = sorted({round(m['top']) for m in months if lo < m['top'] < hi})
        # 同じ段の月ヘッダ行は 2 本。**単位が「월」か「月」かで基準の top が 3.5pt ずれる**
        # ので、その程度の揺れは同じ行に寄せる (本当の 2 本は 60pt 以上離れている)。
        merged = []
        for t in tops:
            if merged and t - merged[-1] <= ROW_TOL:
                continue
            merged.append(t)
        if len(merged) != 2:
            raise SystemExit(f'{path}: 段{r} の月ヘッダ行が {len(merged)} 本 (2 本のはず)')
        month_rows[r] = merged
        for t in merged:
            line = sorted([m for m in months if abs(m['top'] - t) <= ROW_TOL], key=lambda m: m['cx'])
            if len(line) != 18:
                raise SystemExit(f'{path}: 段{r} top={t} の月ヘッダが {len(line)} 個 (18 個のはず)')
            month_cols[(r, t)] = [line[i * 6:(i + 1) * 6] for i in range(3)]

    out = []
    for idx, a in enumerate(anchors, 1):
        # ブロック領域。左右はピッチの 4 割強で切る — **隣の地区に食い込ませない**。
        # 実測では月ヘッダはアンカーの -96〜+95pt、隣の地区の先頭は +167pt にある。
        x0, x1 = a['x0'] - pitch * 0.42, a['x0'] + pitch * 0.45
        y0, y1 = a['top'] - 1, a['top'] + 200
        inblk = lambda o: x0 <= o['cx'] <= x1 and y0 <= o['top'] <= y1  # noqa: E731

        # 隔週の曜日: アンカーと同じ行で右隣
        wd = None
        for w in words:
            if w['text'] in L['days'] and abs(w['top'] - a['top']) < 3 and w['x0'] > a['x0']:
                wd = L['days'][w['text']]
                break
        if wd is None:
            raise SystemExit(f'地区{idx}: 隔週の曜日が読めない')

        # 月ヘッダ。**アンカー相対の x 窓では取れない** — 韓国語版はブロックが
        # アンカーより左に広く、中国語版と同じ窓では 1 列目を取り落とす。
        # 行ごとに「その行の月ヘッダを cx 順に 3 ブロック × 6 列へ割る」方式にする。
        grid = []
        for r in month_rows[a['_row']]:
            cols = month_cols[(a['_row'], r)][a['_col']]
            grid.append((r, cols))
        if len(grid) != 2:
            raise SystemExit(f'地区{idx}: 月ヘッダの段が {len(grid)} 段 (2 段のはず)')
        got = [c['v'] for _, cols in grid for c in cols]
        if got != MONTH_ORDER:
            raise SystemExit(f'地区{idx}: 月の並びが {got} (想定 {MONTH_ORDER})')

        dates = set()
        for ri, (r, cols) in enumerate(grid):
            top_next = grid[ri + 1][0] if ri + 1 < len(grid) else y1
            for c in cols:
                y, m = ym_of(c['v'])
                for d in days:
                    if not (r + 3 < d['top'] < top_next - 3):
                        continue
                    if abs(d['cx'] - c['cx']) > 14:
                        continue
                    try:
                        date = datetime.date(y, m, d['v'])
                    except ValueError:
                        raise SystemExit(f'地区{idx}: {y}-{m} に {d["v"]} 日は無い')
                    # **列の月と日付の曜日が隔週の曜日と一致すること**
                    if date.weekday() != wd:
                        raise SystemExit(
                            f'地区{idx}: {date} は {date.weekday()} 曜だが隔週は {wd} 曜 '
                            f'(月列={c["v"]}月 cx={c["cx"]:.1f} 日 cx={d["cx"]:.1f})')
                    dates.add(date)
        if not dates:
            raise SystemExit(f'地区{idx}: 燃やさないごみの日付が 1 つも取れない')

        # 週次 3 品目の曜日: カテゴリ見出しの下にある曜日語
        weekly = {}
        for zh, ja in L['cats'].items():
            head = [w for w in words if w['text'] == zh and x0 <= w['x0'] <= x1
                    and a['top'] - 40 < w['top'] < a['top']]
            if not head:
                raise SystemExit(f'地区{idx}: 見出し「{zh}」が見つからない')
            h = head[0]
            # 見出しの真下の語。**複数曜日は 1 語で出る** ("周二、周五" / "수ㆍ토") ので
            # 区切りで割ってから引く。語単位で曜日辞書に当てると取り落とす。
            below = [w for w in words if h['top'] < w['top'] < a['top'] - 2
                     and abs((w['x0'] + w['x1']) / 2 - (h['x0'] + h['x1']) / 2) < 34]
            ds = []
            for w in sorted(below, key=lambda w: w['x0']):
                for part in re.split(f"[{L['sep']}]", w['text']):
                    if part in L['days']:
                        ds.append(L['days'][part])
                    elif part:
                        raise SystemExit(f'地区{idx}: 「{zh}」の曜日に未対応の語 {part!r}')
            if not ds:
                raise SystemExit(f'地区{idx}: 「{zh}」の曜日が読めない')
            weekly[ja] = ds

        out.append({
            'district': idx,
            'weekly': weekly,
            'biweekly_weekday': wd,
            'dates': [d.isoformat() for d in sorted(dates)],
        })

    counts = collections.Counter(len(d['dates']) for d in out)
    if min(counts) < 20:
        raise SystemExit(f'日付が少なすぎる地区がある: {counts}')
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('pdf')
    ap.add_argument('--lang', required=True, choices=sorted(LANGS))
    a = ap.parse_args()
    json.dump({'districts': extract(a.pdf, a.lang)}, sys.stdout, ensure_ascii=False, indent=1)
    sys.stdout.write('\n')


if __name__ == '__main__':
    main()
