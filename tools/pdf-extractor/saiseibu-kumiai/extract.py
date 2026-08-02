#!/usr/bin/env python3
# 埼玉西部環境保全組合(鶴ヶ島市・毛呂山町・鳩山町・越生町)の令和8年度ごみ収集カレンダーPDFから
# 日付ごとの収集品目を座標ベースで抽出する。 使い方: python3 extract.py <handle>
# レイアウト: 1ページ(842×1191)に12ヶ月(3列×4段)。各月グリッドの日付数字の直下(同じ曜日列・
# 少し下)に品目略称(可燃/不燃/他プラ/びん缶/有害/紙/ペット)が積まれる。紙・布類は「紙」で代表。
import pdfplumber, json, re, sys
from pathlib import Path

HERE = Path(__file__).parent
CONF = json.loads((HERE / 'config.json').read_text())
ITEMS = ['可燃', '不燃', '他プラ', 'びん缶', '有害', '紙', 'ペット']
COLB = [281, 561]        # 固定列境界 (842/3)。3列均等グリッド

def year_of(month):
    return 2026 if month >= 4 else 2027

def col_of(x):
    return 0 if x < COLB[0] else (1 if x < COLB[1] else 2)

def extract_district(path):
    page = pdfplumber.open(path).pages[0]
    words = page.extract_words()
    labels = [{'month': int(re.match(r'^(\d+)月$', w['text']).group(1)), 'x': w['x0'], 'top': w['top']}
              for w in words if re.match(r'^(\d+)月$', w['text'])]
    labels.sort(key=lambda d: d['top'])
    rows = []
    for lab in labels:
        for r in rows:
            if abs(r[0]['top'] - lab['top']) < 60:
                r.append(lab); break
        else:
            rows.append([lab])
    rows.sort(key=lambda r: min(d['top'] for d in r))

    result = {}
    n_items = n_unassigned = 0   # 網羅性チェック: グリッド内品目word数と、日付に割当できなかった数
    for ri, r in enumerate(rows):
        col_month = {col_of(d['x']): d['month'] for d in r}
        t0 = min(d['top'] for d in r)
        t1 = rows[ri + 1][0]['top'] if ri + 1 < len(rows) else t0 + 245
        days, its = [], []
        for w in words:
            if not (t0 <= w['top'] < t1):
                continue
            c = col_of(w['x0'])
            if c not in col_month:
                continue
            if re.fullmatch(r'\d{1,2}', w['text']) and 1 <= int(w['text']) <= 31:
                days.append({'d': int(w['text']), 'x': w['x0'], 'top': w['top'], 'col': c})
            elif w['text'] in ITEMS:
                its.append({'item': w['text'], 'x': w['x0'], 'top': w['top'], 'col': c})
        # 各品目を「同じ列・品目より上・48pt以内」の日付のうち、まず曜日列(x差)が近く、同x差なら top 最近へ
        for it in its:
            n_items += 1
            best, bd = None, (1e9, 1e9)
            for dy in days:
                if dy['col'] != it['col'] or dy['top'] >= it['top'] or abs(dy['x'] - it['x']) > 22:
                    continue
                td = it['top'] - dy['top']
                if td >= 48:
                    continue
                score = (abs(dy['x'] - it['x']), td)
                if score < bd:
                    bd, best = score, dy
            if best is None:
                n_unassigned += 1
                continue
            month = col_month[best['col']]
            key = f"{year_of(month):04d}-{month:02d}-{best['d']:02d}"
            result.setdefault(key, set()).add(it['item'])
    return {k: sorted(v, key=ITEMS.index) for k, v in sorted(result.items())}, n_items, n_unassigned

handle = sys.argv[1]
conf = CONF[handle]
records = []
for d in conf['districts']:
    dates, n_items, n_unassigned = extract_district(HERE / 'cache' / f'{handle}2026_{d}.pdf')
    records.append({'district': d, 'dates': dates})
    flag = '' if n_unassigned == 0 else f'  ★未割当 {n_unassigned}'
    print(f"{handle} 地区{d.upper()}: {len(dates)} 収集日 / のべ品目 {sum(len(v) for v in dates.values())} / グリッド品目word {n_items}{flag}")

(HERE / 'cache' / f'{handle}-records.json').write_text(json.dumps(records, ensure_ascii=False, indent=1))
print(f"→ cache/{handle}-records.json")
