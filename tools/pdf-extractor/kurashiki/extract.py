#!/usr/bin/env python3
# 倉敷市 地区別収集日PDF(6枚) → records.json
#
# 各PDFは罫線グリッドの表。縦マージセル(学区/地区/値列が複数行にまたがる)は
# pdfplumber の row.cells が None を返すので直前の非空値でフィル(上方向継承)する。
# 玉島/児島/船穂は「地区」列が縦マージされ、1地区が複数の「旧呼称」(=収集ゾーン)行を持ち、
# 各行が固有の日程を持つ。よって地区は継承し、旧呼称でゾーンを識別する。
# 値セルは「月・木」(曜日列挙=weekly) か「N・曜日」/「N・M曜日」(=monthly_nth) の2形。
# 未知表記は例外にして黙って落とさない(playbook: 未パース表記は throw)。
import json
from pathlib import Path
import pdfplumber
from collections import Counter

HERE = Path(__file__).resolve().parent
CACHE = HERE / 'cache'

ZEN = str.maketrans('０１２３４５６７８９', '0123456789')
WD = {'月': 'MO', '火': 'TU', '水': 'WE', '木': 'TH', '金': 'FR', '土': 'SA', '日': 'SU'}


def norm(s):
    if s is None:
        return ''
    return (s.replace('．', '・').replace('，', '・').replace(' ', '').replace('　', '')
            .translate(ZEN).strip())


def parse_value(raw):
    """値セル -> ('weekly',[days],None) | ('nth',[occ],day) | None(空/継承)"""
    t = norm(raw)
    days = [WD[c] for c in t if c in WD]
    occs = [int(c) for c in t if c.isdigit()]
    if not days:
        return None  # 曜日が無い(空/ヘッダ残り)→ 継承
    if occs:
        if len(set(days)) != 1:
            raise ValueError(f'monthly値の曜日が複数: {raw!r}')
        return ('nth', sorted(set(occs)), days[0])
    return ('weekly', sorted(set(days), key=lambda d: list(WD.values()).index(d)), None)


def cell_text(page, c):
    return None if c is None else page.crop(c).extract_text()


SCHEMA_KEYS = {
    'main': ['burnable', 'shigen', 'umetate'],
    'mabi': ['moeru', 'moenai', 'shigen_pet', 'shigen_can', 'shigen_binpaper', 'yugai'],
}


def extract_table(page, table, colmap, schema, district, out):
    last = {}
    last_gakku = ''
    last_area = ''
    for row in table.rows:
        cells = [cell_text(page, c) for c in row.cells]
        if all((c is None or norm(c) == '') for c in cells):
            continue
        joined = norm('/'.join(c or '' for c in cells))
        if not any(w in joined for w in WD):
            continue  # 値列に曜日が無い = ヘッダ行

        if 'gakku' in colmap:
            g = norm(cells[colmap['gakku']]) if colmap['gakku'] < len(cells) else ''
            if g:
                last_gakku = g
        # 地区(area)。縦マージ(None/空)は継承
        araw = cells[colmap['area']] if colmap['area'] < len(cells) else None
        alines = [ln.strip() for ln in (araw or '').split('\n') if ln.strip()]
        area = '・'.join(alines).translate(ZEN) if alines else last_area
        last_area = area
        # 旧呼称(あれば)。ゾーン識別子
        kyu = ''
        if 'kyu' in colmap and colmap['kyu'] < len(cells):
            kraw = cells[colmap['kyu']]
            klines = [ln.strip() for ln in (kraw or '').split('\n') if ln.strip()]
            kyu = '・'.join(klines).translate(ZEN)

        vals = {}
        for key in SCHEMA_KEYS[schema]:
            idx = colmap[key]
            pv = parse_value(cells[idx] if idx < len(cells) else None)
            if pv is None:
                if key not in last:
                    raise ValueError(f'{district}: {key} 初期継承不能 row={cells!r}')
                vals[key] = last[key]
            else:
                vals[key] = pv
                last[key] = pv

        label = area
        if 'gakku' in colmap and last_gakku:
            label = f'{last_gakku}／{area}'
        if kyu:
            label = f'{label}（{kyu}）'
        if not area:
            raise ValueError(f'{district}: 地区名が空 row={cells!r}')
        out.append({'district': district, 'label': label,
                    'gakku': last_gakku if 'gakku' in colmap and last_gakku else None,
                    'area': area, 'kyu': kyu if kyu else None,
                    'values': {k: list(v) for k, v in vals.items()}, 'schema': schema})


def force_columns(page0, table0):
    vv = sorted(set(round(e['x0'], 1) for e in page0.edges
                    if e['orientation'] == 'v' and table0.bbox[1] - 2 <= e['top'] <= table0.bbox[3] + 2))
    return {"vertical_strategy": "explicit", "explicit_vertical_lines": vv, "horizontal_strategy": "lines"}


def main():
    rec = []

    pdf = pdfplumber.open(CACHE / 'kurashiki.pdf')
    for p in pdf.pages:
        for t in p.find_tables():
            if len(t.rows[0].cells) != 5:
                continue  # 粗大ごみ注記(3列)を除外
            extract_table(p, t, {'gakku': 0, 'area': 1, 'shigen': 2, 'umetate': 3, 'burnable': 4},
                          'main', '倉敷', rec)

    pdf = pdfplumber.open(CACHE / 'mizushima.pdf')
    for p in pdf.pages:
        for t in p.find_tables():
            extract_table(p, t, {'area': 0, 'burnable': 1, 'shigen': 2, 'umetate': 3}, 'main', '水島', rec)

    # 玉島(tamashimafunao.pdf, 末尾の船穂表は除外)
    cm = {'area': 0, 'kyu': 1, 'burnable': 2, 'shigen': 3, 'umetate': 4}
    pdf = pdfplumber.open(CACHE / 'tamashimafunao.pdf')
    extract_table(pdf.pages[0], pdf.pages[0].find_tables()[0], cm, 'main', '玉島', rec)
    extract_table(pdf.pages[1], pdf.pages[1].find_tables()[0], cm, 'main', '玉島', rec)

    # 児島(page1+ は page0 の縦線でカラム強制)
    pdf = pdfplumber.open(CACHE / 'kojima.pdf')
    p0 = pdf.pages[0]; t0 = p0.find_tables()[0]
    extract_table(p0, t0, cm, 'main', '児島', rec)
    ts = force_columns(p0, t0)
    for pi in range(1, len(pdf.pages)):
        for t in pdf.pages[pi].find_tables(table_settings=ts):
            extract_table(pdf.pages[pi], t, cm, 'main', '児島', rec)

    # 船穂
    pdf = pdfplumber.open(CACHE / 'funao.pdf')
    for p in pdf.pages:
        for t in p.find_tables():
            extract_table(p, t, cm, 'main', '船穂', rec)

    # 真備
    pdf = pdfplumber.open(CACHE / 'mabi.pdf')
    for p in pdf.pages:
        for t in p.find_tables():
            extract_table(p, t, {'area': 0, 'moeru': 1, 'moenai': 2, 'shigen_pet': 3,
                                 'shigen_can': 4, 'shigen_binpaper': 5, 'yugai': 6}, 'mabi', '真備', rec)

    (CACHE / 'records.json').write_text(json.dumps(rec, ensure_ascii=False, indent=1))
    c = Counter(r['district'] for r in rec)
    print('records(地区ゾーン行):', len(rec))
    for d, n in c.items():
        print(f'  {d}: {n}')


if __name__ == '__main__':
    main()
