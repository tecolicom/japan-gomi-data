#!/usr/bin/env python3
"""中野区 資源とごみのカレンダー PDF (R8-*.pdf) → {date: set(category)} 抽出。

ラベルは色付き矩形チップ + 白文字。非収集セルは白矩形 (color=1.0/white) で
チップごと隠されているため、テキスト層だけでは幻のラベルを拾う。
→ 非白の塗り矩形だけを「可視チップ」とみなし、矩形内のテキストをラベルとする。
日付はカレンダーグリッドの数学的構造 (週行 top × 曜日列 x) から決定する。
前後月のグレーセルにも可視チップが出ることがある (年末年始週) ので月フィルタはしない。
"""
import pdfplumber, re, datetime as dt
import sys

LABELS = {'燃やす', '資源プラ', 'プラ', 'び缶ペ', 'び缶ぺ', '陶ガラ金'}
NORM = {'プラ': '資源プラ', 'び缶ぺ': 'び缶ペ'}  # 「ぺ」はひらがな表記の PDF がある (R8-25 等)

def is_white(color):
    if color is None: return True
    if isinstance(color, (int, float)): return float(color) >= 0.99
    vals = list(color)
    return all(float(v) >= 0.99 for v in vals)

def parse(path):
    out = {}
    with pdfplumber.open(path) as pdf:
        for page in pdf.pages:
            words = page.extract_words()
            page_mid = page.width / 2
            headers = []
            for i, w in enumerate(words):
                if (w['text'] == '年' and i + 2 < len(words) and i >= 1
                        and re.fullmatch(r'\d{1,2}', words[i+1]['text'])
                        and words[i+2]['text'] == '月'
                        and re.fullmatch(r'\d{4}', words[i-1]['text'])):
                    headers.append({'x': w['x0'], 'top': w['top'],
                                    'year': int(words[i-1]['text']),
                                    'month': int(words[i+1]['text']),
                                    'side': 'L' if w['x0'] < page_mid else 'R'})
            # ページ最下部の凡例 (「■ごみ集積所(朝8時まで)」以降) のチップは除外する
            legend_tops = [w['top'] for w in words if '集積所' in w['text']]
            legend_top = min(legend_tops) - 5 if legend_tops else page.height
            chips = [r for r in page.rects if r['fill'] and not is_white(r['non_stroking_color'])
                     and r['top'] < legend_top]
            for blk in headers:
                side_lo, side_hi = (0, page_mid) if blk['side'] == 'L' else (page_mid, page.width)
                below = [h['top'] for h in headers if h['side'] == blk['side'] and h['top'] > blk['top'] + 5]
                bottom = min(below) - 5 if below else page.height
                inblk = lambda o: side_lo <= (o['x0'] + o['x1']) / 2 < side_hi and blk['top'] < o['top'] < bottom
                bw = [w for w in words if inblk(w)]
                # 週行 (日付数字) を検出
                digits = [w for w in bw if re.fullmatch(r'\d{1,2}', w['text'])]
                dow_tops = [w['top'] for w in bw if w['text'] == '日']
                if not dow_tops: continue
                dow_top = min(dow_tops)
                digits = [w for w in digits if w['top'] > dow_top + 3]
                rows = []
                for w in sorted(digits, key=lambda w: w['top']):
                    for r in rows:
                        if abs(r['top'] - w['top']) < 5:
                            r['cells'].append(w); break
                    else:
                        rows.append({'top': w['top'], 'cells': [w]})
                week_rows = sorted([r for r in rows if len(r['cells']) >= 6], key=lambda r: r['top'])
                if not week_rows: continue
                # 曜日列の x 中心 (ヘッダ行の 日〜土)
                dow_words = sorted([w for w in bw if abs(w['top'] - dow_top) < 3
                                    and w['text'] in '日月火水木金土'], key=lambda w: w['x0'])
                col_x = [(w['x0'] + w['x1']) / 2 for w in dow_words]
                if len(col_x) != 7: continue
                y, m = blk['year'], blk['month']
                first = dt.date(y, m, 1)
                grid_start = first - dt.timedelta(days=(first.weekday() + 1) % 7)
                # このブロック内の可視チップ → (週行, 列) → 日付
                # 凡例 (ページ最下部) と横長帯の混入を除外: 1列幅のチップのみ・グリッド縦範囲内のみ
                grid_bottom = week_rows[-1]['top'] + 40
                for chip in [c for c in chips if inblk(c)
                             and (c['x1'] - c['x0']) <= 60
                             and c['top'] <= grid_bottom]:
                    cx = (chip['x0'] + chip['x1']) / 2
                    col = min(range(7), key=lambda i: abs(col_x[i] - cx))
                    # チップの属す週: チップ top より上で最も近い週行
                    above = [r for r in week_rows if r['top'] < chip['top']]
                    if not above: continue
                    ri = week_rows.index(above[-1])
                    d = grid_start + dt.timedelta(days=7 * ri + col)
                    # チップ内のラベルテキスト
                    label = None
                    for w in bw:
                        if (w['text'] in LABELS and chip['x0'] - 1 <= w['x0'] and w['x1'] <= chip['x1'] + 1
                                and chip['top'] - 1 <= w['top'] <= chip['top'] + chip['height'] + 1):
                            label = NORM.get(w['text'], w['text']); break
                    if label is None: continue
                    # 日付セル値と整合確認 (グリッド計算の自己検証)。
                    # 区 PDF 側の日付誤植が実在する (R8-28 の 2027-01 最終週が
                    # 「24 25 26 29 30 31」と誤印字) ため、不一致は警告に留めて
                    # グリッド計算 (週行×曜日列) の日付を採用する。
                    cells = sorted(week_rows[ri]['cells'], key=lambda w: w['x0'])
                    cell = min(cells, key=lambda c: abs((c['x0'] + c['x1']) / 2 - col_x[col]))
                    if abs((cell['x0'] + cell['x1']) / 2 - col_x[col]) < 15 and int(cell['text']) != d.day:
                        print(f'警告: セル数字不一致 {path} {y}-{m:02d} 週{ri+1} 列{col}: '
                              f'グリッド計算={d} セル印字={cell["text"]} (PDF 誤植の可能性)', file=sys.stderr)
                    out.setdefault(d, set()).add(label)
    return out

if __name__ == '__main__':
    cal = parse(sys.argv[1])
    for d in sorted(cal):
        print(d.isoformat(), d.strftime('%a'), ','.join(sorted(cal[d])))
