#!/usr/bin/env python3
"""上富良野町 ごみ収集カレンダー PDF 抽出。
カレンダーグリッド(座標)から category->日付 を、側枠から粗大ごみ日付を抽出する。
"""
import sys, re, json, unicodedata
import pdfplumber

# 列アンカー(日付/ラベルの左端 x0)。日=0 ... 土=6
COL_ANCHORS = [61.3, 133.8, 206.3, 278.8, 351.3, 423.8, 496.3]
WEEKDAYS = ['日','月','火','水','木','金','土']

LABEL_MAP = {
    '一般ごみ': 'burnable',
    '不燃ごみ': 'non_burnable',
    'プラスチック類': 'plastic',
    'ペットボトル': 'pet_bottle',
    '空き缶': 'beverage_can',
    '空きびん': 'glass_bottle',
    '紙類': 'paper_cloth',
    '生ごみ': 'kitchen',
    # 農村コースは缶とびんを1日にまとめて収集する統合ラベル
    '缶・ビン': ['beverage_can', 'glass_bottle'],
}
# グリッドで無視するラベル(注記など)
IGNORE_LABELS = {'注意', '回収しません', '31'}

def z2h(s):
    """全角数字->半角。それ以外はそのまま。"""
    return unicodedata.normalize('NFKC', s)

def nearest_col(x0):
    return min(range(7), key=lambda i: abs(x0 - COL_ANCHORS[i]))

def cluster_rows(words, tol=8):
    """topでクラスタリング。(top平均, [words]) のリストを返す(top昇順)。"""
    ws = sorted(words, key=lambda w: w['top'])
    rows = []
    for w in ws:
        if rows and abs(w['top'] - rows[-1][0]) <= tol:
            rows[-1][1].append(w)
            rows[-1][0] = (rows[-1][0]*(len(rows[-1][1])-1)+w['top'])/len(rows[-1][1])
        else:
            rows.append([w['top'], [w]])
    return rows

def is_int(s):
    return re.fullmatch(r'\d+', s) is not None

def parse_calendar_block(words, block_top, block_bottom, month, year):
    """1カレンダーブロックを解析。(iso_date, category) のリストを返す。"""
    bw = [w for w in words if block_top <= w['top'] < block_bottom]
    rows = cluster_rows(bw)
    results = []
    # 日付行とラベル行を分類し、各日付行に続くラベル行を対応付ける
    # まず各行を {col: [texts]} に整形
    parsed = []
    for top, ws in rows:
        cols = {}
        for w in ws:
            c = nearest_col(w['x0'])
            cols.setdefault(c, []).append((w['x0'], w['text']))
        # x0順に結合
        colmap = {c: ''.join(t for _,t in sorted(v)) for c,v in cols.items()}
        # 日付行判定: 数値(全角/半角)が3個以上
        numvals = {}
        for c, txt in colmap.items():
            h = z2h(txt)
            if is_int(h):
                numvals[c] = int(h)
        is_date_row = len(numvals) >= 4
        parsed.append({'top':top, 'colmap':colmap, 'numvals':numvals, 'is_date': is_date_row})

    # 各日付行について、その月内の実日付を決定 (連続性で月境界を処理)
    # 日付行を上から順に処理。cur_month は表示中の月を追跡。
    # ブロック先頭: 最初の数値が1でなければ前月から始まる。
    date_rows = [p for p in parsed if p['is_date']]
    # 各日付行 col->(y,m,d) を計算
    # 連続カウンタ: 前セルの数値より小さくなったら翌月へ
    def resolve_dates(date_rows, month, year):
        # 最初のセル(col0..)から走査。開始月を推定。
        first = None
        for p in date_rows:
            for c in range(7):
                if c in p['numvals']:
                    first = p['numvals'][c]; break
            if first is not None: break
        cm = month if first == 1 else (month-1 if month>1 else 12)
        cy = year if not (first != 1 and month==1) else year-1
        prev = None
        for p in date_rows:
            p['dates'] = {}
            for c in range(7):
                if c not in p['numvals']:
                    prev_in_row = None
                    continue
                n = p['numvals'][c]
                if prev is not None and n < prev:
                    # 月境界
                    cm += 1
                    if cm > 12:
                        cm = 1; cy += 1
                p['dates'][c] = (cy, cm, n)
                prev = n
        return date_rows
    resolve_dates(date_rows, month, year)

    # ラベル行を直上の日付行に対応付け
    for i, p in enumerate(parsed):
        if p['is_date']:
            continue
        # 直上の日付行を探す
        above = None
        for q in parsed[:i][::-1]:
            if q['is_date']:
                above = q; break
        if above is None:
            continue
        for c, txt in p['colmap'].items():
            label = txt.strip()
            if label in LABEL_MAP and c in above['dates']:
                y,m,d = above['dates'][c]
                cats = LABEL_MAP[label]
                if isinstance(cats, str):
                    cats = [cats]
                for cat in cats:
                    results.append((f"{y:04d}-{m:02d}-{d:02d}", cat))
    return results


def find_month_for_header(page_words, header_top):
    """ヘッダ(曜日行)直上の '○月' ラベルから月を得る。"""
    cands = []
    for w in page_words:
        t = w['text']
        m = re.fullmatch(r'([０-９0-9]{1,2})月', t)
        if m and w['top'] < header_top and header_top - w['top'] < 60:
            cands.append((header_top - w['top'], int(z2h(m.group(1)))))
    if cands:
        cands.sort()
        return cands[0][1]
    return None


def extract_calendar(path):
    pdf = pdfplumber.open(path)
    all_results = []
    for pi, page in enumerate(pdf.pages):
        words = page.extract_words()
        # ヘッダ行(日月火水木金土が7個並ぶ)を検出
        header_tops = []
        rows = cluster_rows([w for w in words if w['text'] in WEEKDAYS])
        for top, ws in rows:
            texts = sorted(((w['x0'], w['text']) for w in ws))
            seq = ''.join(t for _,t in texts)
            if seq == '日月火水木金土':
                header_tops.append(top)
        header_tops.sort()
        for hi, ht in enumerate(header_tops):
            month = find_month_for_header(words, ht)
            if month is None:
                continue
            # fiscal: 4-12 -> 2026, 1-3 -> 2027
            year = 2026 if month >= 4 else 2027
            block_top = ht + 10
            block_bottom = header_tops[hi+1]-40 if hi+1 < len(header_tops) else ht + 320
            res = parse_calendar_block(words, block_top, block_bottom, month, year)
            all_results.extend(res)
    # dedupe
    seen = set(all_results)
    return sorted(seen)


def extract_oversized(path):
    """側枠 '粗大ごみの収集日' から (iso_date) を抽出。テキストベース。
    構造: 月ラベルが2つの日付の間にある (D1, [M], D2)。よって順序トークン列を作り、
    各月ラベルの直前/直後の日付をその月に割り当てる。"""
    import subprocess
    txt = subprocess.run(['pdftotext','-layout',path,'-'],capture_output=True,text=True).stdout
    lines = txt.splitlines()
    tokens = []  # ('day', d) または ('month', m)
    in_block = False
    for ln in lines:
        if '粗大ごみの収集日' in ln:
            in_block = True
            continue
        if in_block:
            if 'お問い合わせ' in ln or '持ち込む' in ln:
                in_block = False
                continue
            dm = re.search(r'([０-９0-9]{1,2})日', ln)
            mm = re.search(r'([０-９0-9]{1,2})月', ln)
            if dm:
                tokens.append(('day', int(z2h(dm.group(1)))))
            elif mm:
                tokens.append(('month', int(z2h(mm.group(1)))))
    dates = []
    for i, (t, v) in enumerate(tokens):
        if t != 'month':
            continue
        m = v
        y = 2026 if m >= 4 else 2027
        # 直前の日付
        if i-1 >= 0 and tokens[i-1][0] == 'day':
            dates.append(f"{y:04d}-{m:02d}-{tokens[i-1][1]:02d}")
        # 直後の日付
        if i+1 < len(tokens) and tokens[i+1][0] == 'day':
            dates.append(f"{y:04d}-{m:02d}-{tokens[i+1][1]:02d}")
    return sorted(set(dates))


if __name__ == '__main__':
    path = sys.argv[1]
    cal = extract_calendar(path)
    from collections import defaultdict
    bycat = defaultdict(list)
    for d, c in cal:
        bycat[c].append(d)
    out = {c: sorted(v) for c, v in bycat.items()}
    out['oversized'] = extract_oversized(path)
    print(json.dumps(out, ensure_ascii=False, indent=1))
    # サマリ
    sys.stderr.write("\n=== counts ===\n")
    for c in sorted(out):
        sys.stderr.write(f"{c}: {len(out[c])}\n")
