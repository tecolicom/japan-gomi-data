#!/usr/bin/env python3
# 抽出エンジン非依存の担保: pdfplumber(罫線グリッド)とは別アルゴリズムの
# pdftotext -layout(座標→行テキスト)で真備・船穂(=data eye CSV非対象地区)を再抽出し、
# records.json の distinct スケジュールパターン集合と一致するか確認する。
import json, re, subprocess
from pathlib import Path
CACHE = Path(__file__).resolve().parent / 'cache'
ZEN = str.maketrans('０１２３４５６７８９', '0123456789')
WD = {'月': 'MO', '火': 'TU', '水': 'WE', '木': 'TH', '金': 'FR', '土': 'SA', '日': 'SU'}
VAL = re.compile(r'^[0-9０-９]*[・／]?[月火水木金土日](?:[・／][0-9０-９月火水木金土日]+)*$')


ALLOWED = set('0123456789・．／') | set(WD)
def pv(tok):
    t = tok.translate(ZEN).replace('／', '・')
    # 値トークンは 数字・曜日・区切りのみ(地名「柳井原・水江」等の誤検出を排除)
    if any(c not in ALLOWED for c in t):
        return None
    days = [WD[c] for c in t if c in WD]
    occs = tuple(sorted(set(int(c) for c in t if c.isdigit())))
    if not days:
        return None
    return ('N', occs, days[0]) if occs else ('W', tuple(sorted(set(days), key=lambda d: list(WD.values()).index(d))))


def value_tokens(line):
    """行末に並ぶ収集値トークン列を右から拾う"""
    parts = line.replace('　', ' ').split()
    vals = []
    for p in reversed(parts):
        v = pv(p)
        if v is None:
            break
        vals.append(v)
    return list(reversed(vals))


def engine_patterns(pdf, ncols):
    txt = subprocess.run(['pdftotext', '-layout', str(CACHE / pdf), '-'],
                         capture_output=True, text=True).stdout
    pats = set()
    for line in txt.splitlines():
        vals = value_tokens(line)
        if len(vals) == ncols:
            pats.add(tuple(vals))
    return pats


def records_patterns(district, keys):
    recs = json.load(open(CACHE / 'records.json'))
    pats = set()
    for r in recs:
        if r['district'] != district:
            continue
        v = r['values']
        pats.add(tuple(tuple(v[k]) if v[k][0] == 'nth' else (v[k][0][0].upper(), tuple(v[k][1]))
                       for k in keys))
    return pats


def norm_pdfplumber(pats):
    # records の ('nth',[occ],day) / ('weekly',[days]) を engine 形式へ
    out = set()
    for p in pats:
        row = []
        for v in p:
            if v[0] == 'W':
                row.append(('W', v[1]))
            else:
                row.append(('N', tuple(v[1]), v[2]) if len(v) == 3 else v)
        out.add(tuple(row))
    return out


def main():
    # 真備: 6値列(燃える/燃えない/資源pet/資源缶/資源bin+紙/有害)
    mabi_keys = ['moeru', 'moenai', 'shigen_pet', 'shigen_can', 'shigen_binpaper', 'yugai']
    eng = engine_patterns('mabi.pdf', 6)
    rec = set()
    for r in json.load(open(CACHE / 'records.json')):
        if r['district'] != '真備':
            continue
        v = r['values']
        row = []
        for k in mabi_keys:
            vv = v[k]
            row.append(('W', tuple(vv[1])) if vv[0] == 'weekly' else ('N', tuple(vv[1]), vv[2]))
        rec.add(tuple(row))
    print(f'真備: pdftotext {len(eng)} / pdfplumber {len(rec)} / 共通 {len(eng & rec)} '
          f'/ engのみ {len(eng - rec)} / recのみ {len(rec - eng)}')
    ok = (eng == rec)

    # 船穂: 3値列(可燃/資源/埋立)
    eng2 = engine_patterns('funao.pdf', 3)
    rec2 = set()
    for r in json.load(open(CACHE / 'records.json')):
        if r['district'] != '船穂':
            continue
        v = r['values']
        row = []
        for k in ['burnable', 'shigen', 'umetate']:
            vv = v[k]
            row.append(('W', tuple(vv[1])) if vv[0] == 'weekly' else ('N', tuple(vv[1]), vv[2]))
        rec2.add(tuple(row))
    print(f'船穂: pdftotext {len(eng2)} / pdfplumber {len(rec2)} / 共通 {len(eng2 & rec2)} '
          f'/ engのみ {len(eng2 - rec2)} / recのみ {len(rec2 - eng2)}')
    ok = ok and (eng2 == rec2)
    print('エンジン非依存:', 'OK' if ok else 'NG')
    if not ok:
        print(' eng-mabi only:', eng - rec)
        print(' rec-mabi only:', rec - eng)


if __name__ == '__main__':
    main()
