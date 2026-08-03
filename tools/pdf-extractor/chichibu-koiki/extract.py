#!/usr/bin/env python3
"""秩父広域市町村圏組合 雑誌型ごみカレンダーの色ベース抽出 (幾何確定版)。

InDesign 製の雑誌型 PDF はテキストが語にまとまらず (pdfplumber extract_words が空)、
日付マスの背景も curves 描画で座標抽出できない。しかし品目はセル背景色で塗り分けられて
いるので、文字も日付も一切読まず「暦計算で決めたセル領域の色」だけで品目を判定する。

グリッド幾何は全 PDF で同一の InDesign テンプレート (01_chichibu*.indd 系) なので、
各月グリッドの四隅の空セル (日列/土列 × 第1週/最終行) の座標を TEMPLATE に埋め込んで
使う (PDF pt, ページ非依存)。この4点から暦計算で各日の (週,曜日) → セル中心を求め、
セル領域内の品目色ピクセルを数える。塊クラスタリングは使わないため週行ずれ
(旧実装の 12月バグ) は原理的に起きない。四隅数ドットの誤差は面サンプリングで吸収。

新しい版で幾何がずれた場合は derive_template_from_annots(pdf) で /Square 注釈から
再較正して TEMPLATE を差し替える (--dump-template)。

出力: {品目名: [YYYY-MM-DD, ...]} の JSON を stdout へ。
使い方: python3 extract.py <PDF> [--dpi 150] > out.json
検証は build.mjs 側 (可燃=weekly差分・月別件数・同日複数品目) で行う。
"""
import sys, json, subprocess, calendar, argparse, tempfile, os
import numpy as np
from PIL import Image
import pypdf

# 月index(0..5, 左上->右下 行優先) -> [日列x, 土列x, 第1週y, 最終行y] (PDF pt, y-up)。
# 01 日野田町の /Square 注釈から確定 (page0 実測、page1 との差 <1.5pt でテンプレ共通)。
TEMPLATE = {
    0: [51.0, 347.4, 1352.3, 1180.8],
    1: [406.9, 702.1, 1352.3, 1180.8],
    2: [761.7, 1057.9, 1352.3, 1180.8],
    3: [51.8, 347.4, 1100.4, 928.9],
    4: [405.9, 701.2, 1100.4, 928.9],
    5: [760.9, 1057.3, 1100.4, 928.9],
}

# 品目名 -> 代表 RGB (150dpi レンダリングでの実測中央値)
REFS = {
    '可燃':    (124, 205, 93),
    '不燃':    (252, 202, 22),
    '紙布':    (173, 139, 205),
    'カンビン': (89, 202, 245),
    'ペット':  (195, 143, 81),
}
# クリーンサンデー(施設持込)=ピンク。収集ではないので拾わない。参考のため定義のみ。
CLEAN_SUNDAY = (241, 167, 203)

# ページ -> 各月の暦年月 (令和8年度: 4月-翌3月、3列×2段で6月/ページ、行優先)
PAGE_MONTHS = {
    0: [(2026, 4), (2026, 5), (2026, 6), (2026, 7), (2026, 8), (2026, 9)],
    1: [(2026, 10), (2026, 11), (2026, 12), (2027, 1), (2027, 2), (2027, 3)],
}

COLOR_THRESH = 45   # |RGB差|の合計がこれ未満なら一致
MIN_PIXELS = 80     # セル内でこの画素数以上一致したら「その品目あり」


def cluster(vals, tol):
    vals = sorted(vals)
    groups, cur = [], [vals[0]]
    for v in vals[1:]:
        if v - cur[-1] <= tol:
            cur.append(v)
        else:
            groups.append(sum(cur) / len(cur)); cur = [v]
    groups.append(sum(cur) / len(cur))
    return groups


def render(pdf, page, dpi):
    tmp = tempfile.mkdtemp()
    prefix = os.path.join(tmp, "pg")
    subprocess.run(["pdftoppm", "-png", "-r", str(dpi),
                    "-f", str(page + 1), "-l", str(page + 1), pdf, prefix], check=True)
    return Image.open(f"{prefix}-{page + 1}.png").convert("RGB")


def derive_template_from_annots(pdf):
    """/Square 注釈から月index->[xl,xr,yt,yb] (PDF pt) を再導出する (テンプレ再較正用)。
    page0 を採用 (page1 との差は面サンプリングで吸収される範囲)。"""
    r = pypdf.PdfReader(pdf)
    page = r.pages[0]
    cs = []
    for a in (page.get("/Annots") or []):
        o = a.get_object(); rc = o.get("/Rect")
        if rc and str(o.get("/Subtype")) == "/Square":
            cs.append(((float(rc[0]) + float(rc[2])) / 2, (float(rc[1]) + float(rc[3])) / 2))
    if len(cs) != 24:
        raise SystemExit(f"/Square 注釈が24個でない ({len(cs)}個): 再較正不可")
    yl = sorted(cluster([cy for _, cy in cs], tol=30), reverse=True)  # 上=大きいpt
    bands = [(yl[0], yl[1]), (yl[2], yl[3])]
    templ = {}
    for bi, (yt, yb) in enumerate(bands):
        pts = [(cx, cy) for cx, cy in cs if abs(cy - yt) < 30 or abs(cy - yb) < 30]
        xl = sorted(cluster([cx for cx, _ in pts], tol=40))
        for mi in range(3):
            templ[bi * 3 + mi] = [round(xl[mi * 2], 1), round(xl[mi * 2 + 1], 1), round(yt, 1), round(yb, 1)]
    return templ


def cell_counts(arr, cx, cy, hw, hh):
    H, W, _ = arr.shape
    x0, x1 = max(0, int(cx - hw)), min(W, int(cx + hw))
    y0, y1 = max(0, int(cy - hh)), min(H, int(cy + hh))
    sub = arr[y0:y1, x0:x1].reshape(-1, 3).astype(np.int16)
    out = {}
    for name, rgb in REFS.items():
        d = np.abs(sub - np.array(rgb)).sum(1)
        out[name] = int((d < COLOR_THRESH).sum())
    return out


def extract(pdf, dpi, template=TEMPLATE):
    reader = pypdf.PdfReader(pdf)
    result = {name: set() for name in REFS}
    for page, months_ym in PAGE_MONTHS.items():
        pg = reader.pages[page]
        PW, PH = float(pg.mediabox.width), float(pg.mediabox.height)
        img = render(pdf, page, dpi); arr = np.asarray(img)
        sx, sy = img.size[0] / PW, img.size[1] / PH
        for mi, (y, m) in enumerate(months_ym):
            xl_pt, xr_pt, yt_pt, yb_pt = template[mi]
            # PDF pt (y-up) -> 画像座標 (y-down)
            xl, xr = xl_pt * sx, xr_pt * sx
            yt, yb = (PH - yt_pt) * sy, (PH - yb_pt) * sy
            col = [xl + (xr - xl) * j / 6 for j in range(7)]
            weeks = calendar.Calendar(firstweekday=6).monthdayscalendar(y, m)
            nweeks = len(weeks)
            nrows = min(nweeks, 5)  # 物理行は最大5、6週目は最終行の下半分
            row = [yt + (yb - yt) * i / (nrows - 1) for i in range(nrows)] if nrows > 1 else [yt]
            colpitch = (xr - xl) / 6
            rowpitch = (yb - yt) / (nrows - 1) if nrows > 1 else (yb - yt)
            hw = colpitch * 0.42
            for wi, wk in enumerate(weeks):
                for dow, day in enumerate(wk):
                    if day == 0:
                        continue
                    if nweeks <= 5 or wi <= 3:
                        cx, cy, hh = col[dow], row[wi], rowpitch * 0.40
                    elif wi == 4:  # 第5週 = 最終行の上半分
                        cx, cy, hh = col[dow], row[4] - rowpitch * 0.25, rowpitch * 0.22
                    else:          # 第6週 = 最終行の下半分
                        cx, cy, hh = col[dow], row[4] + rowpitch * 0.25, rowpitch * 0.22
                    counts = cell_counts(arr, cx, cy, hw, hh)
                    date = f"{y:04d}-{m:02d}-{day:02d}"
                    for name in REFS:
                        if counts[name] >= MIN_PIXELS:
                            result[name].add(date)
    return {name: sorted(dates) for name, dates in result.items()}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("pdf")
    ap.add_argument("--dpi", type=int, default=150)
    ap.add_argument("--dump-template", action="store_true",
                    help="PDFの/Square注釈からTEMPLATE座標を再導出して表示 (再較正用)")
    args = ap.parse_args()
    if args.dump_template:
        print(json.dumps(derive_template_from_annots(args.pdf), ensure_ascii=False, indent=1))
        return
    out = extract(args.pdf, args.dpi)
    print(json.dumps(out, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
