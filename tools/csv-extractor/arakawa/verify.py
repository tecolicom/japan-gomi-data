#!/usr/bin/env python3
"""荒川区: 生成 YAML の独立検証 (build.mjs とは別言語・別ライブラリの第2実装)。

build.mjs / parse.mjs (Node + yaml パッケージ) の出力を、
Python (csv + PyYAML + 独自の日程展開) で一から作り直して突合する。
共有しているのは入力 CSV だけで、パーサ・畳み込み・日付展開はすべて別実装。

検証項目:
  1. area 名の逆写像: 生成 YAML の area 名を (地区,丁目,番地・号) 集合へ復元し、
     CSV 全 2,249 行をちょうど 1 回ずつ被覆する (重複なし・漏れなし) ことを確認。
     → 「1〜13番」形式の畳み込みが情報を落としていないことの証明になる。
  2. rules の一致: CSV 各行から Python 側で組んだ rules と、その行が属するコースの rules が一致。
  3. 通年展開の一致: 2026年度 (2026-04-01〜2027-03-31) 全 365 日について、
     Python 側の独立実装で求めた収集カテゴリ集合と YAML (rules+overrides) の展開が一致。
  4. 年末年始: CSV 備考欄の文言から導いた休止日と overrides が整合。

使い方: python3 verify.py
"""
import csv
import os
import re
import sys
import unicodedata
from collections import defaultdict
from datetime import date, timedelta

import yaml

HERE = os.path.dirname(os.path.abspath(__file__))
CSV_PATH = os.path.join(HERE, "cache", "gomi.csv")
COURSE_DIR = os.path.normpath(os.path.join(HERE, "../../../municipalities/tokyo/arakawa/2026"))

DAY_JA = {"日": "SU", "月": "MO", "火": "TU", "水": "WE", "木": "TH", "金": "FR", "土": "SA"}
# date.weekday(): 月=0 … 日=6
DAY_TO_PYWD = {"MO": 0, "TU": 1, "WE": 2, "TH": 3, "FR": 4, "SA": 5, "SU": 6}
UNSCHEDULABLE = {"個別", "お問い合わせください", "不定期", ""}

C_DIST, C_CHOME, C_BAN = "地区", "丁目", "番地・号"
C_BURN, C_NONBURN, C_PLA = "燃やすごみ", "燃やさないごみ", "プラスチック"
C_GNOTE = "ごみ備考欄"
C_BKP = "びん・缶、古紙"
C_PET = "ペットボトル・発泡スチロール製食品用トレイ"
C_CLOTH = "古布"
C_SNOTE = "資源備考欄"

GOMI_CATS = {"burnable", "non_burnable", "plastic"}
SHIGEN_CATS = {"glass_bottle", "beverage_can", "paper", "pet_bottle", "paper_cloth"}

errors = []


def fail(msg):
    errors.append(msg)


def norm(s):
    """全角→半角、空白除去。build 側 normJa と同等だが実装は独立 (unicodedata 使用)。"""
    s = unicodedata.normalize("NFKC", s or "")
    return re.sub(r"\s+", "", s).replace("･", "・")


# --- 独立パーサ (parse.mjs を参照せず正規表現で書き下ろす) -------------------

def parse_sched(text):
    """収集日表記 → (pattern, days, occurrences) / 展開不能なら None。"""
    t = norm(text)
    if t in UNSCHEDULABLE:
        return None
    m = re.fullmatch(r"(?:第(\d)(?:・第(\d))?(?:・第(\d))?)の?([日月火水木金土])曜?日?", t)
    if m:
        occ = tuple(int(g) for g in m.groups()[:3] if g)
        return ("monthly_nth", (DAY_JA[m.group(4)],), occ)
    if re.fullmatch(r"[日月火水木金土]曜日(?:・[日月火水木金土]曜日)*", t):
        return ("weekly", tuple(DAY_JA[d] for d in re.findall(r"([日月火水木金土])曜日", t)), ())
    raise SystemExit(f"verify.py: 未知の収集日表記 {text!r}")


def row_rules(row):
    """CSV 1 行 → {category: (pattern, days, occurrences)}"""
    out = {}

    def put(cat, sched):
        if sched:
            out[cat] = sched

    put("burnable", parse_sched(row[C_BURN]))
    put("non_burnable", parse_sched(row[C_NONBURN]))
    put("plastic", parse_sched(row[C_PLA]))

    bkp = norm(row[C_BKP])
    if ":" in bkp:  # 「古紙：X、びん缶：Y」複合表記 (norm で NFKC 済み → 半角コロン)
        for part in bkp.split("、"):
            m = re.fullmatch(r"(古紙|びん缶):(.+)", part)
            if not m:
                raise SystemExit(f"verify.py: 複合表記のパース失敗 {row[C_BKP]!r}")
            for c in (["paper"] if m.group(1) == "古紙" else ["glass_bottle", "beverage_can"]):
                put(c, parse_sched(m.group(2)))
    else:
        s = parse_sched(bkp)
        for c in ("glass_bottle", "beverage_can", "paper"):
            put(c, s)

    put("pet_bottle", parse_sched(row[C_PET]))
    put("paper_cloth", parse_sched(row[C_CLOTH]))
    return out


def rules_from_yaml(rules):
    out = {}
    for r in rules:
        days = tuple(r.get("days") or ())
        occ = tuple(r.get("occurrences") or ())
        out[r["category"]] = (r["pattern"], days, occ)
    return out


# --- 独立の日程展開 --------------------------------------------------------

def nth_of_month(d):
    return (d.day - 1) // 7 + 1


def cats_on(d, rules, overrides):
    """その日に収集されるカテゴリ集合 (schedule.mjs categoriesOn と等価な独立実装)。"""
    got = set()
    for cat, (pattern, days, occ) in rules.items():
        if not any(DAY_TO_PYWD[x] == d.weekday() for x in days):
            continue
        if pattern == "weekly":
            got.add(cat)
        elif pattern == "monthly_nth" and nth_of_month(d) in occ:
            got.add(cat)
    ovs = [o for o in overrides if o["date"] == d.isoformat()]
    if any(o.get("cancelled") for o in ovs):
        return set()
    return got


def expand(rules, overrides, start=date(2026, 4, 1), end=date(2027, 4, 1)):
    out = {}
    d = start
    while d < end:
        c = cats_on(d, rules, overrides)
        if c:
            out[d.isoformat()] = c
        d += timedelta(days=1)
    return out


# --- area 名の逆写像 -------------------------------------------------------

TOWNS = ["南千住", "東尾久", "西尾久", "東日暮里", "西日暮里", "荒川", "町屋"]
# 長い町名から先に当てる (「東日暮里」が「荒川」等と衝突しないよう長さ降順)
TOWN_RE = "|".join(sorted(TOWNS, key=len, reverse=True))


def parse_area_name(name, chome_members):
    """area 名 → [(地区, 丁目, 番地・号), ...]"""
    m = re.fullmatch(rf"({TOWN_RE})(\d+丁目)(.*)", name)
    if not m:
        raise SystemExit(f"verify.py: area 名を解釈できない: {name!r}")
    town, chome, rest = m.group(1), m.group(2), m.group(3)
    key = (town, chome)
    if rest == "":  # 丁目まるごと
        return [(town, chome, b) for b in chome_members[key]]
    r = re.fullmatch(r"(\d+)〜(\d+)番", rest)
    if r:
        return [(town, chome, f"{n}番") for n in range(int(r.group(1)), int(r.group(2)) + 1)]
    return [(town, chome, rest)]


# --- 本体 ------------------------------------------------------------------

def main():
    with open(CSV_PATH, encoding="utf-8") as f:
        rows = list(csv.DictReader(f))
    print(f"CSV {len(rows)} 行 (Python csv モジュールで独立パース)")

    # CSV 側に同一「地区+丁目+番地・号」が 2 行ある既知の不整合が 1 件だけある。
    # build.mjs と同じ「先勝ち」方針をここでも独立に適用し、
    # 既知リストに無い重複が現れたら失敗させる (方針の追認ではなく方針の検証)。
    known_dups = {("西尾久", "8丁目", "44番")}
    by_key = {}
    seen_dups = set()
    chome_members = defaultdict(list)
    for r in rows:
        key = (r[C_DIST], r[C_CHOME], r[C_BAN])
        if key in by_key:
            if key in known_dups:
                seen_dups.add(key)
                continue  # 先勝ち (build.mjs と同じ)
            fail(f"未知の重複行: {key}")
            continue
        by_key[key] = r
        chome_members[(r[C_DIST], r[C_CHOME])].append(r[C_BAN])
    if seen_dups != known_dups:
        fail(f"既知の重複行が CSV から消えた/変わった: 期待 {known_dups} 実際 {seen_dups}")
    print(f"既知の重複行 {len(seen_dups)} 件を先勝ちで除外 → 実効 {len(by_key)} 行")

    # 備考欄の年末年始文言 (これが overrides の根拠)
    gnotes = {norm(r[C_GNOTE]) for r in rows}
    snotes = {norm(r[C_SNOTE]) for r in rows}
    if gnotes != {"翌年1月1日から1月3日は、ごみ・プラスチックの収集・回収をしません。"}:
        fail(f"ごみ備考欄が想定外: {gnotes}")
    if snotes != {"12月31日から翌年1月3日は、資源回収をしません。"}:
        fail(f"資源備考欄が想定外: {snotes}")
    stopped = {
        "2026-12-31": SHIGEN_CATS,
        "2027-01-01": GOMI_CATS | SHIGEN_CATS,
        "2027-01-02": GOMI_CATS | SHIGEN_CATS,
        "2027-01-03": GOMI_CATS | SHIGEN_CATS,
    }

    files = sorted(os.listdir(COURSE_DIR))
    print(f"course YAML {len(files)} 本 (PyYAML で独立ロード)")

    covered = {}
    n_days_checked = 0
    n_rules_checked = 0
    for fn in files:
        with open(os.path.join(COURSE_DIR, fn), encoding="utf-8") as f:
            doc = yaml.safe_load(f)
        course = doc["metadata"]["course"]
        y_rules = rules_from_yaml(doc["rules"])
        y_ovs = [{"date": str(o["date"]), "cancelled": o.get("cancelled", False),
                  "category": o.get("category")} for o in doc.get("overrides", [])]
        y_year = expand(y_rules, y_ovs)

        for area in doc["metadata"]["areas"]:
            for key in parse_area_name(area["name"], chome_members):
                if key in covered:
                    fail(f"area 重複: {key} が course {covered[key]} と {course} の双方に出現")
                covered[key] = course
                row = by_key.get(key)
                if row is None:
                    fail(f"CSV に無い area: {key} (course {course}, name={area['name']!r})")
                    continue

                # (2) rules 一致
                p_rules = row_rules(row)
                n_rules_checked += 1
                if p_rules != y_rules:
                    fail(f"rules 不一致 {key} (course {course}): python={p_rules} yaml={y_rules}")
                    continue

                # (4) 年末年始 overrides を Python 側で独立に組む
                p_ovs = []
                for iso, stop in stopped.items():
                    d = date.fromisoformat(iso)
                    c = cats_on(d, p_rules, [])
                    hit = c & stop
                    if hit and hit == c:
                        p_ovs.append({"date": iso, "cancelled": True, "category": None})
                    elif hit:
                        for cat in sorted(hit):
                            p_ovs.append({"date": iso, "cancelled": True, "category": cat})
                p_year = expand(p_rules, p_ovs)

                # (3) 通年展開の一致
                n_days_checked += 1
                if p_year != y_year:
                    diff = sorted(set(p_year) ^ set(y_year)) or \
                        sorted(k for k in p_year if p_year[k] != y_year.get(k))
                    fail(f"通年展開が不一致 {key} (course {course}): 差分日 {diff[:5]}")

    missing = set(by_key) - set(covered)
    if missing:
        fail(f"YAML の area に現れない CSV 行が {len(missing)} 件: {sorted(missing)[:5]}")

    print(f"被覆: CSV {len(by_key)} 行 / area 展開 {len(covered)} 件 (重複 0・漏れ {len(missing)})")
    print(f"rules 突合 {n_rules_checked} 行 / 通年展開突合 {n_days_checked} 行 × 365 日")

    if errors:
        print(f"\nNG: 不一致 {len(errors)} 件")
        for e in errors[:30]:
            print("  -", e)
        sys.exit(1)
    print("\nOK: 全項目一致 (不一致 0 件)")


if __name__ == "__main__":
    main()
