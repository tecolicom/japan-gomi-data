#!/usr/bin/env python3
# 独立照合: 抽出したPDF日程 (records.json) を data eye オープンデータ
# 「平成31年度 地区別収集日」CSV(別ソース・別年度・別グルーピング)と突合する。
# CSV は倉敷/水島/玉島/児島の4地区をカバー(真備・船穂は非対象)。
# CSV の地名トークンで PDF ラベルをアンカー照合し、燃やせる/資源/埋立の
# 曜日・第n を比較。スケジュールが不変(2019→現行)であることの独立確認。
import csv, json, re
from pathlib import Path
from collections import defaultdict

HERE = Path(__file__).resolve().parent
CACHE = HERE / 'cache'
ZEN = str.maketrans('０１２３４５６７８９', '0123456789')
WD = {'月': 'MO', '火': 'TU', '水': 'WE', '木': 'TH', '金': 'FR', '土': 'SA', '日': 'SU'}
CENTER2DIST = {'': '倉敷', '水島環境センター': '水島', '玉島環境センター': '玉島', '児島環境センター': '児島'}


def parse_val(t):
    t = (t or '').translate(ZEN)
    days = [WD[c] for c in t if c in WD]
    occs = sorted(set(int(c) for c in t if c.isdigit()))
    if not days:
        return None
    if occs:
        return ('N', tuple(occs), days[0])
    return ('W', tuple(sorted(set(days), key=lambda d: list(WD.values()).index(d))))


def sched_key(b, s, u):
    return (b, s, u)


def load_csv():
    rows = list(csv.reader(open(CACHE / 'dist_collection_2019.csv', encoding='utf-8-sig')))
    h = rows[0]; ci = {x: i for i, x in enumerate(h)}
    out = []
    for r in rows[1:]:
        dist = CENTER2DIST[r[ci['センター']]]
        b = parse_val(r[ci['燃やせるごみ収集日']])
        s = parse_val(r[ci['資源ごみ収集日']])
        u = parse_val(r[ci['埋立ごみ収集日']])
        out.append({'dist': dist, 'name': r[ci['地名']].translate(ZEN),
                    'sched': sched_key(b, s, u)})
    return out


def load_pdf():
    recs = json.load(open(CACHE / 'records.json'))
    out = []
    for r in recs:
        if r['schema'] != 'main':
            continue
        v = r['values']
        b = tuple(['W', tuple(v['burnable'][1])]) if v['burnable'][0] == 'weekly' \
            else ('N', tuple(v['burnable'][1]), v['burnable'][2])
        s = ('N', tuple(v['shigen'][1]), v['shigen'][2])
        u = ('N', tuple(v['umetate'][1]), v['umetate'][2])
        # CSV は船穂を玉島環境センター扱いにするため、照合上も玉島へ寄せる
        dist = '玉島' if r['district'] == '船穂' else r['district']
        out.append({'dist': dist, 'label': r['label'], 'sched': sched_key(b, s, u)})
    return out


def tokens(name):
    # 括弧内トークン + 基底名。長さ2以上のみ。
    toks = []
    m = re.findall(r'[（(]([^）)]*)[）)]', name)
    for grp in m:
        for t in re.split(r'[、,・]', grp):
            t = t.strip()
            if len(t) >= 2:
                toks.append(t)
    base = re.sub(r'[（(].*', '', name).strip()
    if len(base) >= 2:
        toks.append(base)
    return toks


def main():
    csv_rows = load_csv()
    pdf_rows = load_pdf()
    pdf_by_dist = defaultdict(list)
    for p in pdf_rows:
        pdf_by_dist[p['dist']].append(p)

    stats = defaultdict(lambda: {'match': 0, 'mismatch': 0, 'unmatched': 0})
    mism = []
    for c in csv_rows:
        cand = pdf_by_dist[c['dist']]
        hit = None
        # 非曖昧アンカー: そのトークンにマッチする PDF レコード群が単一スケジュールなら採用
        for tok in tokens(c['name']):
            found = [p for p in cand if tok in p['label']]
            scheds = set(p['sched'] for p in found)
            if len(found) >= 1 and len(scheds) == 1:
                hit = found[0]
                break
        if hit is None:
            stats[c['dist']]['unmatched'] += 1
            continue
        if hit['sched'] == c['sched']:
            stats[c['dist']]['match'] += 1
        else:
            stats[c['dist']]['mismatch'] += 1
            mism.append((c['dist'], c['name'], c['sched'], hit['label'][:30], hit['sched']))

    print('=== CSV(2019) × PDF(現行) アンカー照合 ===')
    tot = {'match': 0, 'mismatch': 0, 'unmatched': 0}
    for d in ['倉敷', '水島', '玉島', '児島']:
        s = stats[d]
        for k in tot: tot[k] += s[k]
        print(f'  {d}: 一致 {s["match"]} / 不一致 {s["mismatch"]} / 未照合 {s["unmatched"]}')
    print(f'  合計: 一致 {tot["match"]} / 不一致 {tot["mismatch"]} / 未照合 {tot["unmatched"]}')
    if mism:
        print('\n--- 不一致詳細 ---')
        for m in mism[:40]:
            print('  ', m)

    # パターン集合比較(地区ごとの distinct sched)
    print('\n=== distinct スケジュールパターン集合の一致 ===')
    for d in ['倉敷', '水島', '玉島', '児島']:
        cset = set(r['sched'] for r in csv_rows if r['dist'] == d)
        pset = set(p['sched'] for p in pdf_by_dist[d])
        only_c = cset - pset
        only_p = pset - cset
        print(f'  {d}: CSV {len(cset)} / PDF {len(pset)} / 共通 {len(cset&pset)} '
              f'/ CSVのみ {len(only_c)} / PDFのみ {len(only_p)}')


if __name__ == '__main__':
    main()
