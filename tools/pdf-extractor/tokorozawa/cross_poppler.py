#!/usr/bin/env python3
"""独立交差検証: poppler (pdftotext -bbox-layout) で全 PDF を別経路抽出し、
pdfplumber (extract.py) の extracted.json と全日突合する。

extract.py は pdfminer.six (pdfplumber) の語分割 + 日付セルのクラスタで列中心を決める。
本スクリプトは poppler の語分割 (「容プラ」を 1 語に保持、日曜ヘッダも出力) + 曜日ヘッダ
由来で列中心を決める、という独立エンジン・独立アルゴリズム。両者一致すれば
「テキスト層の内容」「語座標」「列割付ロジック」がエンジン非依存に再現することを示す。
"""
import subprocess, re, sys, json, unicodedata
from pathlib import Path
from xml.etree import ElementTree as ET

def nfkc(s):
    return unicodedata.normalize('NFKC', s)

def label_to_cats(text):
    cats = set()
    if '燃' in text: cats.add('burnable')
    if '容' in text or 'プラ' in text: cats.add('plastic')
    if 'ペ' in text or 'ボ' in text: cats.add('pet_bottle')
    if '破' in text: cats.add('non_burnable')
    if '有' in text: cats.add('hazardous')
    if 'び' in text or 'ん' in text: cats.add('glass_bottle')
    if '缶' in text: cats.add('beverage_can')
    if '雑' in text or '段' in text: cats.add('paper')
    if '家' in text or '電' in text: cats.add('metal')
    if '着' in text or '布' in text: cats.add('paper_cloth')
    return cats

DOW = '日月火水木金土'
LABEL_CHARS = set('燃容プラペボ破有びん缶雑段家電着布')

def words_of(path):
    xml = subprocess.run(['pdftotext', '-bbox-layout', str(path), '-'],
                         capture_output=True, text=True).stdout
    xml = re.sub(r'xmlns="[^"]*"', '', xml, count=1)
    root = ET.fromstring(xml)
    pages = []
    for page in root.iter('page'):
        pw = float(page.get('width')); ph = float(page.get('height'))
        ws = []
        for w in page.iter('word'):
            t = (w.text or '')
            x0 = float(w.get('xMin')); x1 = float(w.get('xMax'))
            y0 = float(w.get('yMin')); y1 = float(w.get('yMax'))
            ws.append({'text': t, 'xc': (x0+x1)/2, 'top': y0, 'x0': x0, 'x1': x1})
        pages.append((pw, ph, ws))
    return pages

def parse(path, fiscal_start=2026):
    out = {}
    for pw, ph, words in words_of(path):
        heads = []
        for w in words:
            m = re.fullmatch(r'(\d{1,2})月', nfkc(w['text']))
            if m:
                heads.append({'month': int(m.group(1)), 'xc': w['xc'], 'top': w['top']})
        if not heads:
            continue
        # 行クラスタ
        tops = sorted(set(round(h['top']) for h in heads))
        rows = []
        for t in tops:
            if not rows or t - rows[-1] > 40: rows.append(t)
        for h in heads:
            h['row'] = min(range(len(rows)), key=lambda i: abs(rows[i]-h['top']))
            below = [r for r in rows if r > h['top']+40]
            h['bottom'] = (min(below)-5) if below else ph
        for blk in heads:
            month = blk['month']; year = fiscal_start if month>=4 else fiscal_start+1
            lo, hi = blk['xc']-106, blk['xc']+106
            top0, bot = blk['top']+8, blk['bottom']
            bw = [w for w in words if lo <= w['xc'] < hi and top0 <= w['top'] < bot]
            # 曜日ヘッダ行: 日〜土 が 7 個そろう top クラスタ
            dow_ws = [w for w in bw if nfkc(w['text']) in DOW and len(nfkc(w['text']))==1]
            clusters = {}
            for w in dow_ws:
                key = next((k for k in clusters if abs(k-w['top'])<4), None)
                clusters.setdefault(key if key is not None else round(w['top']), []).append(w)
            header = None
            for k in sorted(clusters):
                if len({nfkc(w['text']) for w in clusters[k]}) >= 7:
                    header = clusters[k]; break
            if header is None:
                # 日曜が無い PDF もあるので 6 以上で妥協 (列は日付セルで補完)
                for k in sorted(clusters):
                    if len({nfkc(w['text']) for w in clusters[k]}) >= 6:
                        header = clusters[k]; break
            if header is None:
                continue
            dow_top = max(w['top'] for w in header)
            col_centers = sorted(w['xc'] for w in header)
            def col_of(xc): return min(range(len(col_centers)), key=lambda i: abs(col_centers[i]-xc))
            date_cells = [(w['top'], col_of(w['xc']), int(nfkc(w['text'])))
                          for w in bw if re.fullmatch(r'\d{1,2}', nfkc(w['text'])) and w['top'] > dow_top+2
                          and min(abs(c-w['xc']) for c in col_centers) <= 12]
            date_cells = [c for c in date_cells if 1<=c[2]<=31]
            if not date_cells: continue
            grid_bottom = max(c[0] for c in date_cells)+60
            for w in bw:
                t = w['text']
                if not (LABEL_CHARS & set(t)): continue
                if w['top'] <= dow_top+2 or w['top'] > grid_bottom: continue
                col = col_of(w['xc'])
                above = [c for c in date_cells if c[1]==col and c[0] < w['top']-1]
                if not above: continue
                day = max(above, key=lambda c: c[0])[2]
                cats = label_to_cats(t)
                if not cats: continue
                out.setdefault(f'{year:04d}-{month:02d}-{day:02d}', set()).update(cats)
    return out

def main():
    here = Path(__file__).parent
    ref = json.load(open(here/'cache'/'extracted.json'))
    ng = 0; checked = 0
    for fn, cal in sorted(ref.items()):
        got = parse(here/'cache'/'pdf'/fn)
        got = {d: sorted(c) for d, c in got.items()}
        checked += 1
        # 全日比較
        keys = set(got) | set(cal)
        diffs = [k for k in sorted(keys) if got.get(k, []) != cal.get(k, [])]
        if diffs:
            ng += 1
            print(f'NG {fn}: {len(diffs)} 日差分', file=sys.stderr)
            for k in diffs[:5]:
                print(f'   {k} poppler={got.get(k,[])} pdfminer={cal.get(k,[])}', file=sys.stderr)
    if ng == 0:
        print(f'OK: 全 {checked} PDF が poppler×pdfminer 独立2エンジンで全日一致')
        sys.exit(0)
    print(f'NG: {ng}/{checked} PDF で差分', file=sys.stderr)
    sys.exit(1)

if __name__ == '__main__':
    if len(sys.argv) > 1:
        for d, c in sorted(parse(Path(sys.argv[1])).items()):
            print(d, ','.join(sorted(c)))
    else:
        main()
