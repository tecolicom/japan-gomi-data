#!/usr/bin/env python3
"""青梅市「令和8年度版 資源物・ごみ収集カレンダー」PDF → {isodate: [item]} 抽出。

日程別 PDF は 28 ページの冊子で、20〜25 ページが日付入りカレンダー
(1 ページに 2 ヶ月ブロック = 計 12 ヶ月、2026年4月〜2027年3月)。
罫線は本物のベクタ線なのでグリッドは座標で復元できるが、
**品目名はすべてアウトライン化された図版**でテキスト層に無い
(テキストで取れるのは日番号・曜日ヘッダ・西暦だけ)。

そこで秩父広域と同じ **色ベース抽出** を使う。品目は次の 2 系統の図版で表され、
どちらも塗り色が品目ごとに固有:

  袋アイコン (40×35 の淡色フィル) … 燃やすごみ(緑) / 容器包装プラスチック(紫) / 燃やさないごみ(橙)
  角丸ラベル (幅 32〜68 × 高 20、または 3 行組の 43×44) … 資源物 9 品目

抽出は「色 → 品目」の対応表だけで行い、文字も日付も読まない (秩父と同方針)。
グリッド上の位置から日付へ帰属させる方式は武蔵野と同じ
(「同じ列で自分より上にある直近の日番号」)。

使い方: python3 extract.py   → cache/extracted.json
"""
import json
import re
import sys
import datetime
import calendar
from pathlib import Path

import pdfplumber

HERE = Path(__file__).resolve().parent
CACHE = HERE / 'cache'
SCHEDULES = list('ABCDEFGH')
# 収録期間 (令和8年度)。ブロックはこの順に 1 つずつ対応する。
PERIOD_MONTHS = [(2026, m) for m in range(4, 13)] + [(2027, m) for m in range(1, 4)]

# 塗り色 → 品目名 (原文表記)。(color, 幅, 高さ) の組で一意。
# 幅・高さは ±2pt の許容で照合する。3 行組のラベル (43×44) は B・C・E・F・G 日程で使われる。
SPEC = [
    # 袋アイコン
    ('燃やすごみ', (0.737, 0.871, 0.686), 40, 35),
    ('容器包装プラスチックごみ', (0.769, 0.718, 0.855), 40, 35),
    ('燃やさないごみ', (1.0, 0.788, 0.541), 40, 35),
    # 角丸ラベル (資源物)
    ('ペットボトル', (0.988, 0.941, 0.275), 33, 20),
    ('ペットボトル', (0.988, 0.941, 0.275), 32, 20),
    ('有害ごみ', (0.957, 0.741, 0.729), 32, 20),
    ('カン', (1.0, 0.843, 0.875), 33, 20),
    ('ガラス', (0.953, 0.706, 0.816), 33, 20),
    ('ビン', (0.812, 0.925, 0.945), 33, 20),
    ('陶磁器', (0.451, 0.82, 0.965), 33, 20),
    ('繊維類', (0.678, 0.82, 0.792), 43, 20),
    ('新聞・折込チラシ', (0.835, 0.831, 0.835), 68, 20),
    ('雑誌・雑紙', (0.941, 0.698, 0.549), 68, 20),
    ('ダンボール・飲料用紙パック', (0.882, 0.737, 0.58), 68, 20),
    ('新聞・折込チラシ', (0.835, 0.831, 0.835), 43, 44),
    ('雑誌・雑紙', (0.925, 0.659, 0.49), 43, 44),
    ('ダンボール・飲料用紙パック', (0.82, 0.639, 0.431), 43, 44),
]
BY_COLOR = {}
for name, col, w, h in SPEC:
    BY_COLOR.setdefault(col, []).append((name, w, h))


def cluster(vals, tol=1.0):
    out = []
    for v in sorted(vals):
        if out and v - out[-1][-1] <= tol:
            out[-1].append(v)
        else:
            out.append([v])
    return [sum(g) / len(g) for g in out]


def calendar_blocks(page):
    """ページ内の月ブロック [(x0, x1)] と行境界・グリッド天地を返す。カレンダーでなければ None。"""
    # カレンダーページは曜日ヘッダ (SUN..SAT) を 2 ブロック分持つ。
    # これを条件にしないと、罫線の多い解説ページ (分別一覧など) を拾ってしまう。
    heads = [w for w in page.extract_words() if w['text'] in ('SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT')]
    if len(heads) < 14:
        return None
    hl = [l for l in page.lines if abs(l['y0'] - l['y1']) < 0.5 and l['x1'] - l['x0'] > 200]
    vl = [l for l in page.lines if abs(l['x0'] - l['x1']) < 0.5 and l['bottom'] - l['top'] > 200]
    if not hl or not vl:
        return None
    rects = sorted({(round(l['x0'], 1), round(l['x1'], 1)) for l in hl})
    if len(rects) != 2:
        return None
    rows = cluster({round(l['top'], 1) for l in hl})
    bottom = max(round(l['bottom'], 1) for l in vl)
    if len(rows) < 5:
        return None
    return rects, rows, bottom, vl


def extract_schedule(path):
    events = {}
    blocks_done = 0
    with pdfplumber.open(path) as pdf:
        for page in pdf.pages:
            got = calendar_blocks(page)
            if not got:
                continue
            rects, rows, grid_bottom, vl = got
            grid_top = min(rows)
            words = page.extract_words(extra_attrs=['size'])

            for bx0, bx1 in rects:
                if blocks_done >= len(PERIOD_MONTHS):
                    raise SystemExit(f'{path.name}: 月ブロックが 12 個を超えた')
                year, month = PERIOD_MONTHS[blocks_done]
                blocks_done += 1

                cols = [bx0] + cluster([round(l['x0'], 1) for l in vl if bx0 < l['x0'] < bx1]) + [bx1]
                if len(cols) != 8:
                    raise SystemExit(f'{path.name} p{page.page_number}: 列境界が {len(cols) - 1} 本')

                def col_of(x0, x1):
                    cx = (x0 + x1) / 2
                    for i in range(7):
                        if cols[i] - 0.5 <= cx < cols[i + 1]:
                            return i
                    return None

                # ヘッダの西暦でブロックの年を独立確認する
                head_years = [int(w['text']) for w in words
                              if bx0 - 10 <= w['x0'] < bx1 and w['top'] < grid_top
                              and re.fullmatch(r'20\d\d', w['text']) and w['size'] > 20]
                if year not in head_years:
                    raise SystemExit(f'{path.name} p{page.page_number}: ヘッダ西暦 {head_years} に {year} が無い')

                # 行バンド (罫線の間)。品目は「自分と同じセル」に属する日番号へ帰属させる
                bounds = rows + [grid_bottom]

                def band_of(top, bottom):
                    cy = (top + bottom) / 2
                    for i in range(len(bounds) - 1):
                        if bounds[i] - 0.5 <= cy < bounds[i + 1]:
                            return i
                    return None

                # 日番号 (グリッド内・数字・15pt 前後)
                daynums = []
                for w in words:
                    if not (bx0 <= w['x0'] < bx1 and grid_top - 1 <= w['top'] <= grid_bottom + 1):
                        continue
                    if not (re.fullmatch(r'\d{1,2}', w['text']) and w['size'] >= 12):
                        continue
                    c = col_of(w['x0'], w['x1'])
                    b = band_of(w['top'], w['bottom'])
                    if c is None or b is None:
                        raise SystemExit(f'{path.name}: 列/行外の日番号 {w["text"]!r}')
                    daynums.append((c, b, w['top'], int(w['text'])))

                # グリッドの起点 = その月 1 日の直前 (以前) の日曜
                first = datetime.date(year, month, 1)
                start = first - datetime.timedelta(days=(first.weekday() + 1) % 7)
                dim = calendar.monthrange(year, month)[1]

                # 日番号 → 日付。列(曜日)と数字の組で [start, start+42) から一意に決める
                # セル位置 (行 b × 列 c) から日付を決め、印字された日番号と一致することを確認する。
                # 6 週ある月は物理行が 5 行しかなく、あふれた週が同じセルへ縦積みされるので
                # 「そのセルの日付」か「その 7 日後」のどちらかになる。
                pos = {}
                for c, b, top, day in daynums:
                    base = start + datetime.timedelta(days=b * 7 + c)
                    date = base if base.day == day else base + datetime.timedelta(days=7)
                    if date.day != day:
                        raise SystemExit(
                            f'{path.name}: {year}-{month:02d} 行{b}列{c} の日番号 {day} がグリッド位置 {base} と不整合')
                    pos[(c, b, top)] = date

                # その月の全日が 1 回ずつ現れていること
                got_days = sorted(d.day for d in pos.values() if d.year == year and d.month == month)
                if got_days != list(range(1, dim + 1)):
                    raise SystemExit(f'{path.name}: {year}-{month:02d} の日番号が不完全 {got_days}')

                for day in range(1, dim + 1):
                    events.setdefault(f'{year}-{month:02d}-{day:02d}', [])

                # 品目図版 → 「同じ列で自分より上にある直近の日番号」へ帰属
                seen = set()
                for cv in page.curves:
                    col = cv.get('non_stroking_color')
                    if not isinstance(col, (list, tuple)) or len(col) != 3:
                        continue
                    key = tuple(round(v, 3) for v in col)
                    if key not in BY_COLOR:
                        continue
                    if not (bx0 <= cv['x0'] < bx1 and grid_top - 1 <= cv['top'] <= grid_bottom + 1):
                        continue
                    w, h = cv['x1'] - cv['x0'], cv['bottom'] - cv['top']
                    hit = [n for n, sw, sh in BY_COLOR[key] if abs(w - sw) <= 2 and abs(h - sh) <= 2]
                    if not hit:
                        continue
                    c = col_of(cv['x0'], cv['x1'])
                    b = band_of(cv['top'], cv['bottom'])
                    if c is None or b is None:
                        continue
                    k = (hit[0], c, b, round(cv['x0'], 1), round(cv['top'], 1))
                    if k in seen:
                        continue
                    seen.add(k)

                for name, c, b, x0, top in seen:
                    # 同じセル (行バンド × 列) の日番号。6 週ある月は 1 セルに 2 つ縦積みされるので、
                    # 自分より上にある方を採る (日番号はセル左上、品目ラベルはその右で数 pt 上に来ることがある)
                    cell = sorted(((t, d) for (cc, bb, t), d in pos.items() if cc == c and bb == b))
                    if not cell:
                        raise SystemExit(f'{path.name}: {year}-{month:02d} の {name} (列 {c} 行 {b}) に対応する日番号が無い')
                    fit = [x for x in cell if x[0] <= top + 12]
                    date = (fit[-1] if fit else cell[0])[1]
                    if date.year != year or date.month != month:
                        raise SystemExit(f'{path.name}: {year}-{month:02d} ブロックの {name} が月外 {date} に帰属')
                    iso = date.isoformat()
                    if name not in events[iso]:
                        events[iso].append(name)

    if blocks_done != len(PERIOD_MONTHS):
        raise SystemExit(f'{path.name}: 月ブロックが {blocks_done} 個 (12 個必要)')
    return {k: sorted(v) for k, v in sorted(events.items())}


def main():
    out = {}
    for d in SCHEDULES:
        ev = extract_schedule(CACHE / f'{d}.pdf')
        out[d] = {'events': ev}
        n = sum(1 for v in ev.values() if v)
        print(f'{d}日程: {len(ev)} 日 (収集 {n} 日)', file=sys.stderr)
    (CACHE / 'extracted.json').write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding='utf-8')
    print(f'wrote {CACHE / "extracted.json"}', file=sys.stderr)


if __name__ == '__main__':
    main()
