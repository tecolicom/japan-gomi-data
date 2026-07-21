#!/usr/bin/env python3
# 岡山市 パースの独立第2実装 (Python)。
# verify.mjs(JS) が書き出した cache/js_field_sigs.json の各行4フィールド署名を、
# ここで records.json から独立にパースし直して突合する (2実装照合)。
# アルゴリズムは JS と別実装 (正規表現ベースのトークナイズ) にして相互に誤りを検出する。
import json
import re
from pathlib import Path

HERE = Path(__file__).resolve().parent
CACHE = HERE / 'cache'

DAY = {'日': 'SU', '月': 'MO', '火': 'TU', '水': 'WE', '木': 'TH', '金': 'FR', '土': 'SA'}
DAY_ORDER = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU']
ZEN = str.maketrans('０１２３４５６７８９', '0123456789')
SEP = set('・．. ,，、　')


def parse_fragments(text):
    """text -> {'weekly': [days...], 'monthly': {day: set(occ)}}  (JS parseFragments と等価)."""
    t = (text or '').translate(ZEN)
    terms = []          # (occ_tuple, day)
    occs = []
    for ch in t:
        if ch.isdigit():
            occs.append(int(ch))
        elif ch in DAY:
            terms.append((tuple(occs), DAY[ch]))
            occs = []
        elif ch in SEP:
            continue
        else:
            raise ValueError(f'未知の文字 {ch!r} in {text!r}')
    if occs:
        raise ValueError(f'曜日を伴わない数字 in {text!r}')
    if not terms:
        raise ValueError(f'曜日が無い: {text!r}')
    weekly, monthly = [], {}
    for occ, day in terms:
        if not occ:
            if day not in weekly:
                weekly.append(day)
        else:
            for o in occ:
                if not (1 <= o <= 5):
                    raise ValueError(f'回数範囲外 {text!r}')
                monthly.setdefault(day, set()).add(o)
    return weekly, monthly


def field_sig(text):
    weekly, monthly = parse_fragments(text)
    parts = []
    if weekly:
        parts.append('W:' + ','.join(sorted(weekly, key=DAY_ORDER.index)))
    for day in sorted(monthly, key=DAY_ORDER.index):
        parts.append(f'M:{day}@' + ','.join(str(o) for o in sorted(monthly[day])))
    return '|'.join(sorted(parts))


def main():
    recs = json.load(open(CACHE / 'records.json'))['records']
    js = {r['id']: r for r in json.load(open(CACHE / 'js_field_sigs.json'))}
    mism = 0
    checked = 0
    for r in recs:
        py = {f: field_sig(r[f]) for f in ('burnable', 'nonburnable', 'recycle', 'plastic')}
        j = js.get(r['id'])
        if not j:
            print(f'JS 署名に id{r["id"]} 無し')
            mism += 1
            continue
        for f in ('burnable', 'nonburnable', 'recycle', 'plastic'):
            checked += 1
            if py[f] != j[f]:
                print(f'MISMATCH id{r["id"]} {f}: py={py[f]!r} js={j[f]!r} raw={r[f]!r}')
                mism += 1
    print(f'パース2実装突合: {len(recs)} 行 × 4 フィールド = {checked} 署名, 不一致 {mism}')
    raise SystemExit(1 if mism else 0)


if __name__ == '__main__':
    main()
