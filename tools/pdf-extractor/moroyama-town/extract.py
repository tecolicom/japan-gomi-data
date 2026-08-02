#!/usr/bin/env python3
# 毛呂山町(埼玉西部環境保全組合)の令和8年度ごみ収集カレンダーPDF(A/B/C地区)から
# 日付ごとの収集品目を座標ベースで抽出し cache/records.json へ出力する。
# レイアウト: 1ページ(842×1191)に12ヶ月(3列×4段)。各月グリッドの日付数字の直下(同じ曜日列・
# 少し下)に品目略称(可燃/不燃/他プラ/びん缶/有害/紙布/ペット)が積まれる。
import pdfplumber, json, re
from pathlib import Path

HERE = Path(__file__).parent
# 紙・布類は PDF 上「紙」「布」の2 word(同じ日に隣接)で入るため「紙」で代表する(build で paper+cloth へ)。
ITEMS = ['可燃', '不燃', '他プラ', 'びん缶', '有害', '紙', 'ペット']
DISTRICTS = ['a', 'b', 'c']
COLB = [281, 561]        # 固定列境界 (842/3)。3列均等グリッド
COL_LEFT = 20            # カレンダー左端 (これより左は凡例・地図の可能性 → 段判定で別途除外)

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
    # 段(top)でクラスタ
    rows = []
    for lab in labels:
        for r in rows:
            if abs(r[0]['top'] - lab['top']) < 60:
                r.append(lab); break
        else:
            rows.append([lab])
    rows.sort(key=lambda r: min(d['top'] for d in r))

    result = {}
    for ri, r in enumerate(rows):
        col_month = {col_of(d['x']): d['month'] for d in r}
        t0 = min(d['top'] for d in r)                       # 月ラベル行 (日付はこの下)
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
        # 各品目を「同じ列・品目より上・48pt以内」の日付のうち、まず曜日列(x差)が最も近く、
        # 同x差なら top が最も近い日付へ割り当てる (x差を優先しないと隣の曜日へ誤配置する)。
        for it in its:
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
                continue
            month = col_month[best['col']]
            key = f"{year_of(month):04d}-{month:02d}-{best['d']:02d}"
            result.setdefault(key, set()).add(it['item'])
    return {k: sorted(v, key=ITEMS.index) for k, v in sorted(result.items())}

records = []
for d in DISTRICTS:
    dates = extract_district(HERE / 'cache' / f'moroyama2026_{d}.pdf')
    records.append({'district': d, 'dates': dates})
    print(f"地区{d.upper()}: {len(dates)} 収集日 / のべ品目 {sum(len(v) for v in dates.values())}")

(HERE / 'cache' / 'records.json').write_text(json.dumps(records, ensure_ascii=False, indent=1))
print("→ cache/records.json")
