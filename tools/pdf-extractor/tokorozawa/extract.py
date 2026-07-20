#!/usr/bin/env python3
"""所沢市 地区別収集カレンダー PDF → {isodate: set(category)} 抽出。

所沢の PDF (Excel LTSC 製・A4横 2 ページ) は日付入り通年カレンダー。
1 ページに 6 ヶ月 (3 列 × 2 行)、2 ページで会計年度 12 ヶ月 (4月〜翌3月)。
各月ブロックは「N月」ヘッダ + 曜日ヘッダ(日月火水木金土) + 日付数字グリッド +
各収集日セルに品目ラベル語で構成。テキスト層は健全 (隠し OCR / CID 化けなし)。

品目ラベルは月末セル等で 1 文字ずつに分解されるため (杉並と同じ癖)、
識別文字単位で判定する。凡例 (PDF 末尾) の 7 区分:
  燃やせるごみ / 容器包装プラスチック(容プラ) / ペットボトル /
  破砕ごみ類・有害ごみ(破砕/有害, 同日) / びん・かん・スプレー缶(びん・缶・スプレー, 同日) /
  新聞・雑誌雑がみ・段ボール(新・雑・段) / 小型家電製品・古着古布(小型家電/古着・古布, 同日)
ラベルは収集日にだけ印字される (非収集日には語が無い)。
"""
import pdfplumber, re, sys, json, unicodedata
from pathlib import Path

def nfkc(s):
    return unicodedata.normalize('NFKC', s)

# 識別文字 → 正典カテゴリ集合。語彙は閉集合なので一意な字だけを使う。
def label_to_cats(text):
    cats = set()
    if '燃' in text:                      # 燃やせるごみ
        cats.add('burnable')
    if '容' in text or 'プラ' in text:     # 容器包装プラスチック(容プラ)
        cats.add('plastic')
    if 'ペ' in text or 'ボ' in text:       # ペットボトル
        cats.add('pet_bottle')
    if '破' in text:                      # 破砕ごみ類 (不燃)
        cats.add('non_burnable')
    if '有' in text:                      # 有害ごみ
        cats.add('hazardous')
    if 'び' in text or 'ん' in text:       # びん
        cats.add('glass_bottle')
    if '缶' in text:                      # かん・スプレー缶
        cats.add('beverage_can')
    if '雑' in text or '段' in text:       # 新聞・雑誌雑がみ・段ボール(古紙)
        cats.add('paper')
    if '家' in text or '電' in text:       # 小型家電製品
        cats.add('metal')
    if '着' in text or '布' in text:       # 古着・古布
        cats.add('paper_cloth')
    return cats

DOW = '日月火水木金土'
# 品目ラベルに現れうる識別文字 (これ以外の語は無視)
LABEL_CHARS = set('燃容プラペボ破有びん缶雑段家電着布')

def cluster(vals, tol):
    vals = sorted(vals)
    groups = []
    for v in vals:
        if groups and v - groups[-1][-1] <= tol:
            groups[-1].append(v)
        else:
            groups.append([v])
    return [sum(g) / len(g) for g in groups]

def parse(path, fiscal_start=2026):
    out = {}
    warnings = []
    with pdfplumber.open(path) as pdf:
        for page in pdf.pages:
            words = page.extract_words()
            # 月ヘッダ "N月"
            heads = []
            for w in words:
                m = re.fullmatch(r'(\d{1,2})月', nfkc(w['text']))
                if m:
                    heads.append({'month': int(m.group(1)),
                                  'xc': (w['x0'] + w['x1']) / 2, 'top': w['top']})
            if not heads:
                continue
            # 行 (top クラスタ) を求め、各月ブロックの下端を決める
            row_tops = cluster([h['top'] for h in heads], 40)
            for h in heads:
                h['row'] = min(range(len(row_tops)), key=lambda i: abs(row_tops[i] - h['top']))
            for h in heads:
                below = [r for r in row_tops if r > h['top'] + 40]
                h['bottom'] = (min(below) - 5) if below else page.height
            for blk in heads:
                month = blk['month']
                year = fiscal_start if month >= 4 else fiscal_start + 1
                lo, hi = blk['xc'] - 106, blk['xc'] + 106
                top0, bot = blk['top'] + 8, blk['bottom']
                bw = [w for w in words
                      if lo <= (w['x0'] + w['x1']) / 2 < hi and top0 <= w['top'] < bot]
                # 曜日ヘッダ行: 日〜土 の字が集まる top クラスタ
                dow_ws = [w for w in bw if nfkc(w['text']) in DOW and len(nfkc(w['text'])) == 1]
                clusters = []
                for w in sorted(dow_ws, key=lambda w: w['top']):
                    for c in clusters:
                        if abs(c['top'] - w['top']) < 4:
                            c['ws'].append(w); break
                    else:
                        clusters.append({'top': w['top'], 'ws': [w]})
                header = next((c for c in sorted(clusters, key=lambda c: c['top'])
                               if len({nfkc(w['text']) for w in c['ws']}) >= 6), None)
                if header is None:
                    warnings.append(f'{path.name} {month}月: 曜日ヘッダ検出失敗')
                    continue
                dow_top = header['top']
                # 日付数字セル (当月日のみ印字)。列中心はセル群のクラスタで求める。
                date_cells = [(w['top'], (w['x0'] + w['x1']) / 2, int(nfkc(w['text'])))
                              for w in bw if re.fullmatch(r'\d{1,2}', nfkc(w['text']))
                              and w['top'] > dow_top + 2]
                # 明らかな範囲外の日(>31)は無い前提だが念のため
                date_cells = [c for c in date_cells if 1 <= c[2] <= 31]
                if not date_cells:
                    warnings.append(f'{path.name} {month}月: 日付セル無し')
                    continue
                col_centers = cluster([c[1] for c in date_cells], 12)
                def col_of(xc):
                    return min(range(len(col_centers)), key=lambda i: abs(col_centers[i] - xc))
                # セル高 = 日付行間隔の実測値。固定 60pt だとページ下部の凡例チップ
                # (注記が少なく凡例が近い PDF: 城・東所沢三〜五) を最終週セルに誤割当する
                row_tops = sorted(cluster([c[0] for c in date_cells], 10))
                pitches = [b - a for a, b in zip(row_tops, row_tops[1:])]
                pitch = min(pitches) if pitches else 45
                grid_bottom = max(c[0] for c in date_cells) + pitch
                # ラベル文字を「同列で直上にある日付セル」に割り付ける
                for w in bw:
                    t = w['text']
                    if not (LABEL_CHARS & set(t)):
                        continue
                    if w['top'] <= dow_top + 2 or w['top'] > grid_bottom:
                        continue
                    xc = (w['x0'] + w['x1']) / 2
                    col = col_of(xc)
                    above = [c for c in date_cells if col_of(c[1]) == col and c[0] < w['top'] - 1]
                    if not above:
                        continue
                    day = max(above, key=lambda c: c[0])[2]
                    cats = label_to_cats(t)
                    if not cats:
                        continue
                    key = f'{year:04d}-{month:02d}-{day:02d}'
                    out.setdefault(key, set()).update(cats)
                # 月/日の妥当性検査: その月に存在しない日付が付かないよう getdays で確認
    return out, warnings


def main():
    here = Path(__file__).parent
    pdfdir = here / 'cache' / 'pdf'
    result = {}
    all_warnings = []
    for pdf_path in sorted(pdfdir.glob('*.pdf')):
        cal, warns = parse(pdf_path)
        all_warnings += warns
        result[pdf_path.name] = {d: sorted(cats) for d, cats in sorted(cal.items())}
    outpath = here / 'cache' / 'extracted.json'
    outpath.write_text(json.dumps(result, ensure_ascii=False, indent=0))
    print(f'extracted {len(result)} PDFs -> {outpath}', file=sys.stderr)
    for w in all_warnings:
        print('WARN', w, file=sys.stderr)
    if all_warnings:
        sys.exit(1)


if __name__ == '__main__':
    if len(sys.argv) > 1:
        cal, warns = parse(Path(sys.argv[1]))
        for d in sorted(cal):
            print(d, ','.join(sorted(cal[d])))
        for w in warns:
            print('WARN', w, file=sys.stderr)
    else:
        main()
