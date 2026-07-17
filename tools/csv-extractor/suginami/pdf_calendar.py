#!/usr/bin/env python3
"""杉並区 地域別「ごみ・資源の収集カレンダー」PDF → {date: set(category)} 抽出。

杉並の PDF (2〜3ページ) は 1 ページ目が表紙 (対象地区・曜日ルール要約)、
2〜3 ページ目が日付入り月間カレンダー (2列×3行=6ヶ月/ページ、全12ヶ月)。
中野と違い収集ラベルは色矩形チップでなく素のテキスト語 (可燃/不燃/古紙/ペット/
びん/かん/プラ) で、収集日にだけ印字される (非収集日には語が無い)。

各月ブロックは「令和X年（YYYY年）」ヘッダ + 「<n>月」 + 曜日ヘッダ(日月火水木金土)
+ 日付数字グリッド + 各セルの収集ラベル語で構成。

月は装飾大数字グリフが二重打ち (例: 12月ブロックが「1122」「月月」「DDeecceemmbbeerr」)
になる PDF があり、グリフからの月判定は当てにできない。全 28 PDF が「表紙 + カレンダー
2ページ (6ヶ月×2、行優先で会計年度の月順)」という共通テンプレートなので、月はブロックの
スロット位置から会計年度の並び (4,5,…,3月) で決める。日付数字・ラベル語は二重打ちに
ならないためグリッドはそのまま読める。明瞭な「<n>月」グリフが読めた場合のみ整合検査する。
"""
import pdfplumber, re, datetime as dt, sys, unicodedata

# 会計年度 (4月始まり) の月並び。カレンダー各ページ 6 ブロックを行優先で辿った順に対応。
FISCAL_MONTHS = [4, 5, 6, 7, 8, 9, 10, 11, 12, 1, 2, 3]


def nfkc(s):
    return unicodedata.normalize('NFKC', s)


def label_to_cats(text):
    """カレンダーセルのラベル語 → 正典カテゴリ集合。

    ラベルは通常 '古紙'/'ペット' 等の語で来るが、月末セルなどで 1 文字ずつ
    ('古','紙','ペ','ッ','ト') に分解される PDF がある。識別文字単位で判定する
    (語彙は 可燃/不燃/古紙/ペット/びん/かん/プラ の閉集合で、'燃' のような
    両属の字は使わず一意な字だけを使う)。"""
    cats = set()
    if '可' in text:                                # 可燃
        cats.add('burnable')
    if '不' in text:                                # 不燃
        cats.add('non_burnable')
    if any(c in text for c in '古紙ペット'):          # 古紙・ペットボトル 同日
        cats |= {'paper', 'pet_bottle'}
    if any(c in text for c in 'びんかプラ'):          # びん・かん・資源プラスチック 同日
        cats |= {'glass_bottle', 'beverage_can', 'plastic'}
    return cats


DOW = '日月火水木金土'


def parse(path, fiscal_start=2026):
    out = {}
    with pdfplumber.open(path) as pdf:
        cal_pages = pdf.pages[1:]  # 1 ページ目は表紙
        for pi, page in enumerate(cal_pages):
            words = page.extract_words()
            page_mid = page.width / 2
            # ブロックの起点 = 「令和…（YYYY年）」ヘッダ語
            heads = []
            for w in words:
                if re.search(r'\((\d{4})年\)', nfkc(w['text'])):  # NFKC で全角括弧は半角化される
                    heads.append({'x0': w['x0'], 'top': w['top'],
                                  'side': 'L' if w['x0'] < page_mid else 'R'})
            # ブロックを行 (top クラスタ) 優先で並べ、会計年度の月順を割り当てる
            row_tops = []
            for h in sorted(heads, key=lambda h: h['top']):
                if not row_tops or h['top'] - row_tops[-1] > 40:
                    row_tops.append(h['top'])
                h['row'] = len(row_tops) - 1
            ordered = sorted(heads, key=lambda h: (h['row'], h['x0']))
            for slot, blk in enumerate(ordered):
                idx = pi * 6 + slot
                if idx >= len(FISCAL_MONTHS):
                    continue
                month = FISCAL_MONTHS[idx]
                year = fiscal_start if month >= 4 else fiscal_start + 1
                lo, hi = (0, page_mid) if blk['side'] == 'L' else (page_mid, page.width)
                below = [h['top'] for h in heads if h['side'] == blk['side'] and h['top'] > blk['top'] + 5]
                bottom = min(below) if below else page.height
                bw = [w for w in words if lo <= (w['x0'] + w['x1']) / 2 < hi and blk['top'] - 3 <= w['top'] < bottom]
                # 曜日ヘッダ行 = 日〜土 の 7 文字がそろう行。月ラベルの単独「月」を
                # 曜日と誤認しないよう、7 曜日が集まる top クラスタを選ぶ。
                dow_ws = [w for w in bw if nfkc(w['text']) in DOW]
                clusters = []
                for w in sorted(dow_ws, key=lambda w: w['top']):
                    for c in clusters:
                        if abs(c['top'] - w['top']) < 4:
                            c['ws'].append(w); break
                    else:
                        clusters.append({'top': w['top'], 'ws': [w]})
                header = next((c for c in sorted(clusters, key=lambda c: c['top'])
                               if len({nfkc(w['text']) for w in c['ws']}) >= 7), None)
                if header is None:
                    continue
                dow_top = header['top']
                header_row = sorted(header['ws'], key=lambda w: w['x0'])
                col_x = [(w['x0'] + w['x1']) / 2 for w in header_row[:7]]
                # 月の整合検査: 明瞭な「<n>月」グリフが読めたらスロット由来の月と照合する
                # (二重打ちグリフの PDF では読めないので黙ってスロットを信頼する)。
                for w in [w for w in bw if w['top'] < dow_top - 2]:
                    mm = re.fullmatch(r'(\d{1,2})月', nfkc(w['text']))
                    if mm and int(mm.group(1)) != month:
                        print(f'警告: 月不一致 {path} p{pi+2} slot{slot}: '
                              f'スロット={month} グリフ={mm.group(1)}', file=sys.stderr)
                        break
                # 日付セル。右端タブ数字などグリッド列に載らない語 (列中心から遠い語) は
                # 除外する (ページ端 x≈577 は dist≈38、実日付は dist≤5)。杉並のグリッドは
                # 当月日のみ印字するので、印字数字 = 当月の日付として扱える。
                col_of = lambda w: min(range(7), key=lambda i: abs(col_x[i] - (w['x0'] + w['x1']) / 2))
                col_dist = lambda w: min(abs(cx - (w['x0'] + w['x1']) / 2) for cx in col_x)
                cells = [(w['top'], col_of(w), int(nfkc(w['text'])))
                         for w in bw if re.fullmatch(r'\d{1,2}', nfkc(w['text']))
                         and w['top'] > dow_top + 3 and col_dist(w) <= 15]
                if not cells:
                    continue
                grid_bottom = max(t for t, _, _ in cells) + 50
                # ラベル語を「同じ曜日列で直上にある日付セル」に割り付ける。
                # (末尾の 31 単独行などが週行の間に挟まっても列単位なら誤らない)
                for w in bw:
                    cats = label_to_cats(w['text'])
                    if not cats or w['top'] <= dow_top + 3 or w['top'] > grid_bottom:
                        continue
                    col = col_of(w)
                    above = [c for c in cells if c[1] == col and c[0] < w['top'] - 1]
                    if not above:
                        continue
                    day = max(above, key=lambda c: c[0])[2]
                    out.setdefault(dt.date(year, month, day), set()).update(cats)
    return out


if __name__ == '__main__':
    cal = parse(sys.argv[1])
    for d in sorted(cal):
        print(d.isoformat(), d.strftime('%a'), ','.join(sorted(cal[d])))
