#!/usr/bin/env python3
"""板橋区 地域別カレンダー PDF → JSON (ヘッダの町名・曜日規則・実収集日)。

1 本の PDF に 2 つの表現が入っている。

  - **曜日規則** … テキスト層に明記 (「資源：週1回 土 / 可燃ごみ：週3回 月・水・金 /
    不燃ごみ：毎月1回目・3回目の木」)。
  - **実収集日** … 12 か月のカレンダーグリッド。日番号はテキストだが、収集日の印は
    セルの**塗り色**で表される (ピンク=可燃 / 緑=資源 / シアン=不燃)。

両方を出して、build 側で突き合わせる。

## 踏んだ罠

**月ブロックの割り当ては左右の中点で切る。** 1 ページに 2 か月 × 6 段が並ぶ。
「月見出しの x から一定幅」で判定すると右側の月のセルが左側の月に吸われ、
偽の欠け 27 件・偽の余り 8 件が出た (調査中に実際に踏んだ)。
見出しの x の最小と最大の中点で左右を分け、その列の中で直上の見出しを採る。

使い方: extract.py <pdf> [<pdf> ...]
"""
import json
import re
import sys
import datetime
import collections

import pdfplumber

Z = '０１２３４５６７８９'
DAY_JA = {'日': 6, '月': 0, '火': 1, '水': 2, '木': 3, '金': 4, '土': 5}
EN_MONTHS = ['April', 'May', 'June', 'July', 'August', 'September',
             'October', 'November', 'December', 'January', 'February', 'March']
YM = [(2026, 4), (2026, 5), (2026, 6), (2026, 7), (2026, 8), (2026, 9),
      (2026, 10), (2026, 11), (2026, 12), (2027, 1), (2027, 2), (2027, 3)]
COLORS = {(1.0, 0.8, 0.8): '可燃', (0.0, 1.0, 0.0): '資源', (0.0, 1.0, 1.0): '不燃'}
CELL_W = 37.2   # 日セルの幅 (凡例の色見本と同じ幅なので、日番号の有無で区別する)


def z2h(s):
    for i, c in enumerate(Z):
        s = s.replace(c, str(i))
    return s


def fill(r):
    c = r.get('non_stroking_color')
    return tuple(round(x, 3) for x in c) if isinstance(c, (list, tuple)) else None


def parse_rules(text):
    """テキスト層の曜日規則。読めなければ止める。"""
    t = z2h(re.sub(r'\s+', '', text))
    m_res = re.search(r'資源：週(\d)回([日月火水木金土・]+)', t)
    m_bur = re.search(r'可燃ごみ：週(\d)回([日月火水木金土・]+)', t)
    m_non = re.search(r'不燃ごみ：毎月([\d回目・]+)の([日月火水木金土])', t)
    if not (m_res and m_bur and m_non):
        raise SystemExit(f'曜日規則が読めない: {t[:200]!r}')
    res = [c for c in m_res.group(2) if c in DAY_JA]
    bur = [c for c in m_bur.group(2) if c in DAY_JA]
    occ = [int(x) for x in re.findall(r'(\d)回目', m_non.group(1))]
    if len(res) != int(m_res.group(1)):
        raise SystemExit(f'資源: 「週{m_res.group(1)}回」と曜日 {res} が合わない')
    if len(bur) != int(m_bur.group(1)):
        raise SystemExit(f'可燃: 「週{m_bur.group(1)}回」と曜日 {bur} が合わない')
    if not occ:
        raise SystemExit(f'不燃: 回目が読めない {m_non.group(1)!r}')
    return {'資源': {'days': res}, '可燃': {'days': bur},
            '不燃': {'days': [m_non.group(2)], 'occurrences': occ}}


CIRCLED = {chr(0x2460 + i): i + 1 for i in range(12)}   # ①〜⑫


def header_towns(text):
    """「…にお住まいの方」の行から町名の並びを取る。

    **1 行目にあるとは限らない。** 「西 ①」のような地域ラベルが町名と同じ行に
    続く PDF (w01) と、ラベルだけが 1 行目に来る PDF (e03・e07) がある。
    行を決め打ちせず、全行から「にお住まいの方」を含む行を探す。
    """
    for line in text.split('\n'):
        m = re.search(r'^\s*(.*?)にお住まいの方', z2h(line))
        if m and m.group(1).strip():
            body = re.sub(r'[東西]\s*[\u2460-\u246b]\s*$', '', m.group(1)).strip()
            return [t for t in re.split(r'[、,]', body) if t]
    raise SystemExit(f'ヘッダの町名が読めない: {text.split(chr(10))[0][:80]!r}')


def header_area(text):
    """「東 ③」「西 ①」から (東西, 番号) を取る。ファイル名との照合に使う。"""
    m = re.search(r'([東西])\s*([\u2460-\u246b])', text)
    if not m:
        raise SystemExit('地域ラベル (東①〜西⑫) が見つからない')
    return ('e' if m.group(1) == '東' else 'w', CIRCLED[m.group(2)])


def month_blocks(page):
    """英語の月名から 12 ブロックの (年月, 見出しの top, 左か) を作る。"""
    hdr = {}
    for w in page.extract_words():
        if w['text'] in EN_MONTHS and w['text'] not in hdr:
            hdr[w['text']] = (w['x0'], w['top'])
    if len(hdr) != 12:
        raise SystemExit(f'月見出しが {len(hdr)} 個 (12 のはず): {sorted(hdr)}')
    xs = sorted(v[0] for v in hdr.values())
    mid = (xs[0] + xs[-1]) / 2
    return [(YM[i], hdr[EN_MONTHS[i]][1], hdr[EN_MONTHS[i]][0] < mid) for i in range(12)], mid


def weekday_columns(page, mid):
    """曜日ヘッダ (日Sun 月Mon …) から「列の中心 → 曜日」の対応表を作る。

    グリッドの列と実日付の曜日が合っているかを検査するために使う (青梅と同型)。

    **12 ブロック分 84 個が揃うことを前提にしてはいけない。** e01 と w11 は
    2 月ブロックの「日Sun」だけがテキスト層に無い (区の版面の欠落)。
    列の x は全ブロックで共通なので、どこか 1 か所にあれば対応は決まる。
    ヘッダ語はセルの中に**中央寄せ**で置かれており、セルの左端はヘッダ語の左端より
    7.3pt ほど外側にあるので、左端どうしでは対応が取れない (実際に踏んだ)。
    """
    seen = {}
    for w in page.extract_words():
        m = re.match(r'^([日月火水木金土])(Sun|Mon|Tue|Wed|Thu|Fri|Sat)$', w['text'])
        if not m:
            continue
        cx = round((w['x0'] + w['x1']) / 2, 1)
        wd = DAY_JA[m.group(1)]
        key = min((k for k in seen if abs(k - cx) <= 3), default=cx)
        if key in seen and seen[key] != wd:
            raise SystemExit(f'列 x={key} に曜日が 2 通り ({seen[key]} と {wd})')
        seen[key] = wd
    left = sorted(k for k in seen if k < mid)
    right = sorted(k for k in seen if k >= mid)
    for side, ks in (('左', left), ('右', right)):
        if len(ks) != 7 or sorted(seen[k] for k in ks) != [0, 1, 2, 3, 4, 5, 6]:
            raise SystemExit(f'{side}の曜日列が {len(ks)} 個 (日〜土の 7 個のはず)')
    return [(k, seen[k], k < mid) for k in seen]


def extract(path):
    pdf = pdfplumber.open(path)
    if len(pdf.pages) != 1:
        raise SystemExit(f'{path}: {len(pdf.pages)} ページ (1 のはず)')
    page = pdf.pages[0]
    text = page.extract_text()
    rules = parse_rules(text)
    towns = header_towns(text)
    side, num = header_area(text)
    stem = path.split('/')[-1][:-4]
    if stem != f'{side}{num:02d}':
        raise SystemExit(f'{path}: ヘッダの地域ラベルは {side}{num:02d} で、ファイル名 {stem} と違う')
    blocks, mid = month_blocks(page)
    cols = weekday_columns(page, mid)

    nums = [c for c in page.chars if c['text'].strip().isdigit()]

    def daynum(r):
        ts = sorted((c for c in nums
                     if r['x0'] - 1 <= c['x0'] and c['x1'] <= r['x1'] + 1
                     and r['top'] - 1 <= c['top'] and c['bottom'] <= r['bottom'] + 1),
                    key=lambda c: c['x0'])
        return ''.join(c['text'] for c in ts)

    def month_of(r):
        left = r['x0'] < mid
        cand = [(ym, hy) for ym, hy, l in blocks if l == left and r['top'] > hy]
        if not cand:
            raise SystemExit(f'セル top={r["top"]:.1f} x={r["x0"]:.1f} が月ブロックに入らない')
        return max(cand, key=lambda t: t[1])[0]

    def col_weekday(r):
        cx = (r['x0'] + r['x1']) / 2
        c = {w for cxh, w, left in cols if left == (cx < mid) and abs(cxh - cx) <= 3}
        if len(c) != 1:
            raise SystemExit(f'セル中心 x={cx:.1f} に対応する曜日列が {len(c)} 個')
        return c.pop()

    events = collections.defaultdict(set)
    legend = collections.Counter()
    for r in page.rects:
        cat = COLORS.get(fill(r))
        if cat is None or abs((r['x1'] - r['x0']) - CELL_W) > 1:
            continue
        d = daynum(r)
        if not d:
            legend[cat] += 1        # 凡例の色見本 (日番号を持たない)
            continue
        y, m = month_of(r)
        wd = col_weekday(r)
        # 「24/31」のように 1 セルに 2 日が縦積みされることがある (月末の週)
        cands = [int(d)] if len(d) <= 2 else ([int(d[:2]), int(d[2:])] if len(d) == 4 else [int(d)])
        hit = 0
        for n in cands:
            try:
                date = datetime.date(y, m, n)
            except ValueError:
                continue
            # **列の曜日と日付の曜日が一致すること** (月ブロックや行のずれを検出する)
            if date.weekday() != wd:
                raise SystemExit(
                    f'{path}: {date} は {date.weekday()} 曜だが列は {wd} 曜 '
                    f'(セル x={r["x0"]:.1f} top={r["top"]:.1f} 数字={d!r})')
            events[date.isoformat()].add(cat)
            hit += 1
        if hit == 0:
            raise SystemExit(f'{path}: セルの数字 {d!r} が {y}-{m} の日付にならない')

    for cat in COLORS.values():
        if legend[cat] != 1:
            raise SystemExit(f'{path}: 凡例の色見本が {cat} で {legend[cat]} 個 (1 のはず)')

    return {
        'area': f'{side}{num}',
        'towns': towns,
        'rules': rules,
        'events': {k: sorted(v) for k, v in sorted(events.items())},
    }


def main():
    out = {}
    for p in sys.argv[1:]:
        out[p.split('/')[-1]] = extract(p)
    json.dump(out, sys.stdout, ensure_ascii=False, indent=1)
    sys.stdout.write('\n')


if __name__ == '__main__':
    main()
