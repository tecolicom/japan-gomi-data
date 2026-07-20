#!/usr/bin/env python3
# 川口市「2026年 地区別ごみ収集日カレンダー」PDF 群 (18地区) の抽出。
#
# 一次ソース = 各地区 PDF のヘッダに市が明示する収集ルール (曜日ルール文)。
# これが「一般・有害=X・Y曜日 / プラ=水曜日 / びん飲料かん・金属紙・ペット繊維=第n・m曜日」と
# 5 行で規則そのものを印字している(所沢のように日付から規則を推定する必要がない)。
#
# 出力:
#   cache/rules.json  地区 -> {weekly:{cats:[days]}, monthly:[{cats,occ,day}]}   (rules の材料)
#   cache/grid.json   地区 -> {isodate:[cats]}   (カレンダー本体の実日付。独立照合用)
#   cache/areas.json  地区 -> {towns:[...], name_ja: "…"}   (番号一覧表 banngou より)
# さらに header-rule 展開と grid を通年照合し、レポートを標準出力に出す。
#
# カテゴリ対応 (市の区分 -> 正典語彙):
#   一般ごみ=burnable / 有害ごみ=hazardous / プラスチック製容器包装=plastic /
#   びん=glass_bottle / 飲料かん=beverage_can / 金属類=metal / 紙類=paper /
#   ペットボトル=pet_bottle / 繊維類=paper_cloth
import pdfplumber, json, re, os, datetime, sys
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
PDFDIR = os.path.join(HERE, 'cache', 'pdf')
CACHE = os.path.join(HERE, 'cache')
YEAR = 2026
JA = "日月火水木金土"
DAYJA = {'日':'SU','月':'MO','火':'TU','水':'WE','木':'TH','金':'FR','土':'SA'}
WCOLS = [40, 180, 300, 440, 560, 690]  # 6 month weekday-columns per page (validated vs 2026 calendar)
Z2H = str.maketrans('０１２３４５６７８９', '0123456789')

def month_col(x):
    return min(range(6), key=lambda i: abs(x - WCOLS[i]))

# ---- header rule block ----------------------------------------------------
def parse_header(pdf):
    """地区 PDF page0 ヘッダの 5 ルール行を読む。"""
    p = pdf.pages[0]
    words = [w for w in p.extract_words() if w['x0'] > 525 and w['top'] < 170]
    # cluster into rows by top with tolerance (day-spec & keyword differ by ~1pt)
    clusters = []  # (anchor_top, [words])
    for w in sorted(words, key=lambda w: w['top']):
        for c in clusters:
            if abs(c[0] - w['top']) <= 8:
                c[1].append(w); break
        else:
            clusters.append((w['top'], [w]))
    lines = []
    for anchor, ws in clusters:
        txt = ''.join(w['text'] for w in sorted(ws, key=lambda w: w['x0']))
        lines.append(txt.translate(Z2H))
    blob = '\n'.join(lines)

    def weekly_days(line):
        m = re.search(r'([日月火水木金土])(?:・([日月火水木金土]))?曜日', line)
        if not m:
            raise ValueError(f'weekly parse fail: {line!r}')
        return [DAYJA[d] for d in m.groups() if d]

    def monthly(line):
        m = re.search(r'第([\d・,]+)([日月火水木金土])曜日', line)
        if not m:
            raise ValueError(f'monthly parse fail: {line!r}')
        occ = [int(x) for x in re.split(r'[・,]', m.group(1)) if x]
        return occ, DAYJA[m.group(2)]

    rule = {'weekly': {}, 'monthly': []}
    for ln in lines:
        if '一般' in ln and '有害' in ln:
            rule['weekly']['general'] = weekly_days(ln)          # burnable+hazardous
        elif 'プラスチック' in ln or 'プラ' in ln:
            rule['weekly']['plastic'] = weekly_days(ln)
        elif 'びん' in ln and 'かん' in ln:
            occ, day = monthly(ln); rule['monthly'].append({'k': 'bincan', 'occ': occ, 'day': day})
        elif '金属' in ln and '紙' in ln:
            occ, day = monthly(ln); rule['monthly'].append({'k': 'metalpaper', 'occ': occ, 'day': day})
        elif 'ペットボトル' in ln or ('ペット' in ln and '繊維' in ln):
            occ, day = monthly(ln); rule['monthly'].append({'k': 'petcloth', 'occ': occ, 'day': day})
    if 'general' not in rule['weekly'] or 'plastic' not in rule['weekly'] or len(rule['monthly']) != 3:
        raise ValueError(f'incomplete header rules:\n{blob}')
    return rule

# key -> canonical categories
KEYCATS = {
    'general': ['burnable', 'hazardous'],
    'plastic': ['plastic'],
    'bincan': ['glass_bottle', 'beverage_can'],
    'metalpaper': ['metal', 'paper'],
    'petcloth': ['pet_bottle', 'paper_cloth'],
}

def rule_to_rows(rule):
    """rules.json 形式へ"""
    weekly = {}
    for wk, days in rule['weekly'].items():
        for c in KEYCATS[wk]:
            weekly[c] = days
    monthly = []
    for m in rule['monthly']:
        for c in KEYCATS[m['k']]:
            monthly.append({'category': c, 'occ': m['occ'], 'day': m['day']})
    return {'weekly': weekly, 'monthly': monthly}

# ---- expected schedule from header rules ----------------------------------
def nth_of_month(d):
    return (d.day - 1) // 7 + 1

def expand_rules(rows):
    """header-rule を 2026 暦年(1/1-12/31)へ展開 -> {iso:set(cats)}"""
    DIDX = {'SU':6,'MO':0,'TU':1,'WE':2,'TH':3,'FR':4,'SA':5}  # python weekday()
    out = defaultdict(set)
    d = datetime.date(YEAR, 1, 1)
    end = datetime.date(YEAR, 12, 31)
    while d <= end:
        wd = d.weekday()
        for cat, days in rows['weekly'].items():
            if any(DIDX[x] == wd for x in days):
                out[d.isoformat()].add(cat)
        for m in rows['monthly']:
            if DIDX[m['day']] == wd and nth_of_month(d) in m['occ']:
                out[d.isoformat()].add(m['category'])
        d += datetime.timedelta(days=1)
    return out

# ---- grid (calendar body) -------------------------------------------------
def parse_grid(pdf, district):
    """カレンダー本体から実日付ごとの記号/ラベル -> {iso:set(cats)}。独立照合ソース。"""
    grid = defaultdict(set)
    for pi, base in ((0, 1), (1, 7)):
        p = pdf.pages[pi]
        words = [w for w in p.extract_words() if w['top'] > 230]
        for mi in range(6):
            month = base + mi
            col = [w for w in words if month_col(w['x0']) == mi]
            # weekday chars -> ordered rows -> date d = index+1
            wd = sorted([w for w in col if w['text'] in JA], key=lambda w: w['top'])
            # validate sequence
            ndays = (datetime.date(YEAR, month % 12 + 1, 1) - datetime.date(YEAR, month, 1)).days if month < 12 else 31
            real = [JA[(datetime.date(YEAR, month, d).weekday() + 1) % 7] for d in range(1, ndays + 1)]
            got = [w['text'] for w in wd]
            if got != real:
                raise ValueError(f'd{district} m{month}: weekday seq mismatch\n got={got}\n real={real}')
            tops = [w['top'] for w in wd]  # tops[d-1]

            def nearest_date(top):
                return min(range(len(tops)), key=lambda i: abs(tops[i] - top)) + 1

            for w in col:
                t = w['text']
                cats = None
                if t == '●':
                    cats = ['burnable', 'hazardous']
                elif t == '▲':
                    cats = ['plastic']
                elif t == 'びん':
                    cats = ['glass_bottle', 'beverage_can']
                elif t == '金属':
                    cats = ['metal', 'paper']
                elif t == 'ペット':
                    cats = ['pet_bottle', 'paper_cloth']
                if cats:
                    day = nearest_date(w['top'])
                    iso = datetime.date(YEAR, month, day).isoformat()
                    grid[iso].update(cats)
    return grid

# ---- banngou index (town -> district) -------------------------------------
def parse_banngou(path):
    """番号一覧表: 住所 -> カレンダー番号。地区 -> [town] を返す。
    3 列組 [town(x~58/235/411), 番号(x~191/367/545)] の反復。town は 1 word。"""
    # (town-band, number-band) per column
    COLS = [((50, 175), (175, 225)), ((225, 355), (355, 400)), ((400, 530), (530, 565))]
    d2t = defaultdict(list)
    with pdfplumber.open(path) as pdf:
        for p in pdf.pages:
            words = p.extract_words()
            rows = defaultdict(list)
            for w in words:
                rows[round(w['top'] / 6)].append(w)  # ~14pt row pitch -> tolerant bucket
            # merge adjacent buckets belonging to same visual row
            for key in list(rows):
                for w in list(rows.get(key, [])):
                    pass
            for key in sorted(rows):
                ws = rows[key]
                for (tb, nb) in COLS:
                    towns = [w for w in ws if tb[0] <= w['x0'] < tb[1] and re.search(r'[一-龥ｦ-ﾟ]', w['text']) and len(w['text']) > 1]
                    nums = [w for w in ws if nb[0] <= w['x0'] < nb[1] and re.fullmatch(r'[0-9０-９]{1,2}', w['text'])]
                    if not towns or not nums:
                        continue
                    town = towns[0]['text']
                    # nearest number in same column by top
                    num = min(nums, key=lambda n: abs(n['top'] - towns[0]['top']))
                    d = int(num['text'].translate(Z2H))
                    if 1 <= d <= 18 and abs(num['top'] - towns[0]['top']) < 6:
                        d2t[d].append(town)
    # dedup preserve order
    return {d: list(dict.fromkeys(v)) for d, v in d2t.items()}

# ---- main -----------------------------------------------------------------
def main():
    rules_out, grid_out, expected_out = {}, {}, {}
    report = []
    total_mismatch = 0
    for district in range(1, 19):
        path = os.path.join(PDFDIR, f'{YEAR}-{district}.pdf')
        with pdfplumber.open(path) as pdf:
            rule = parse_header(pdf)
            rows = rule_to_rows(rule)
            grid = parse_grid(pdf, district)
        expected = expand_rules(rows)
        rules_out[district] = rows
        grid_out[district] = {k: sorted(v) for k, v in sorted(grid.items())}
        expected_out[district] = {k: sorted(v) for k, v in sorted(expected.items())}
        # compare (skip year-end window 12/29-12/31 & 1/1-1/3: PDF says year-end not reflected here anyway,
        # but grid DOES show normal collection there, so compare full year and report those separately)
        keys = set(expected) | set(grid)
        diffs = []
        for k in sorted(keys):
            e, g = expected.get(k, set()), grid.get(k, set())
            if e != g:
                diffs.append((k, sorted(e - g), sorted(g - e)))
        total_mismatch += len(diffs)
        wk = ','.join(f"{c}:{'/'.join(d)}" for c, d in rows['weekly'].items())
        report.append(f"d{district:2d}  weekly[{wk}]  monthly={[ (m['category'],m['occ'],m['day']) for m in rows['monthly'] ]}")
        report.append(f"     grid-days={len(grid)} expected-days={len(expected)} mismatches={len(diffs)}")
        for k, miss, extra in diffs[:6]:
            report.append(f"       {k}  header-only={miss}  grid-only={extra}")

    d2t = parse_banngou(os.path.join(PDFDIR, 'bango.pdf'))
    areas_out = {d: sorted(set(d2t.get(d, []))) for d in range(1, 19)}

    os.makedirs(CACHE, exist_ok=True)
    json.dump(rules_out, open(os.path.join(CACHE, 'rules.json'), 'w'), ensure_ascii=False, indent=1)
    json.dump(grid_out, open(os.path.join(CACHE, 'grid.json'), 'w'), ensure_ascii=False)
    json.dump(expected_out, open(os.path.join(CACHE, 'expected.json'), 'w'), ensure_ascii=False)
    json.dump(areas_out, open(os.path.join(CACHE, 'areas.json'), 'w'), ensure_ascii=False, indent=1)

    print('\n'.join(report))
    print(f"\nTOTAL rule-label mismatches across 18 districts (full calendar year): {total_mismatch}")
    print("area counts:", {d: len(areas_out[d]) for d in range(1, 19)}, "sum=", sum(len(v) for v in areas_out.values()))

if __name__ == '__main__':
    main()
