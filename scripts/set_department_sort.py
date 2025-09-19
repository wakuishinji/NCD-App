#!/usr/bin/env python3
"""Apply sort group/order to department master entries.

Usage:
  python3 scripts/set_department_sort.py [--base-url https://...]

Requires Internet access to the Cloudflare Workers API. By default uses
https://ncd-app.altry.workers.dev.  Adjust by passing --base-url.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.error
import urllib.request

DEFAULT_BASE_URL = "https://ncd-app.altry.workers.dev"
USER_AGENT = "NCD-Script/department-sort/1.0"

SORT_PLAN = {
    "内科": (100, "内科系"),
    "総合診療科": (110, "内科系"),
    "呼吸器内科": (120, "内科系"),
    "消化器内科": (130, "内科系"),
    "循環器内科": (140, "内科系"),
    "糖尿病内科": (150, "内科系"),
    "腎臓内科": (160, "内科系"),
    "血液内科": (170, "内科系"),
    "内分泌内科": (180, "内科系"),
    "感染症内科": (190, "内科系"),
    "アレルギー内科": (200, "内科系"),
    "老年内科": (210, "内科系"),
    "腫瘍内科": (220, "内科系"),
    "膠原病内科": (230, "内科系"),
    "緩和ケア内科": (240, "内科系"),
    "精神科": (300, "精神・神経系"),
    "心療内科": (310, "精神・神経系"),
    "神経内科": (320, "精神・神経系"),
    "小児科": (400, "小児系"),
    "小児外科": (410, "小児系"),
    "小児歯科": (420, "小児系"),
    "外科": (500, "外科系"),
    "整形外科": (510, "外科系"),
    "形成外科": (520, "外科系"),
    "美容外科": (530, "外科系"),
    "脳神経外科": (540, "外科系"),
    "心臓血管外科": (550, "外科系"),
    "呼吸器外科": (560, "外科系"),
    "消化器外科": (570, "外科系"),
    "乳腺外科": (580, "外科系"),
    "胸部外科": (590, "外科系"),
    "リハビリテーション科": (600, "外科系"),
    "救急科": (610, "外科系"),
    "産科": (700, "産婦人科系"),
    "婦人科": (710, "産婦人科系"),
    "産婦人科": (720, "産婦人科系"),
    "耳鼻咽喉科": (800, "耳鼻咽喉科系"),
    "気管食道科": (810, "耳鼻咽喉科系"),
    "気管食道耳鼻咽喉科": (820, "耳鼻咽喉科系"),
    "眼科": (900, "眼科系"),
    "皮膚科": (1000, "皮膚科・アレルギー系"),
    "アレルギー科": (1010, "皮膚科・アレルギー系"),
    "泌尿器科": (1100, "泌尿器科系"),
    "歯科": (1200, "歯科系"),
    "歯科口腔外科": (1220, "歯科系"),
    "放射線科": (1300, "放射線・麻酔・検査系"),
    "麻酔科": (1310, "放射線・麻酔・検査系"),
    "臨床検査科": (1320, "放射線・麻酔・検査系"),
    "病理診断科": (1330, "放射線・麻酔・検査系"),
    "リウマチ科": (1400, "リウマチ・免疫系"),
}


def fetch_master(base_url: str) -> dict[str, dict]:
    url = f"{base_url}/api/listMaster?type=department&includeSimilar=false"
    with urllib.request.urlopen(url) as resp:
        data = json.load(resp)
    items = data.get("items", [])
    return {it["name"]: it for it in items}


def update_entry(base_url: str, name: str, category: str, group: str, order: int) -> None:
    payload = json.dumps(
        {
            "type": "department",
            "category": category,
            "name": name,
            "sortGroup": group,
            "sortOrder": order,
        },
        ensure_ascii=False,
    ).encode("utf-8")
    req = urllib.request.Request(
        f"{base_url}/api/updateMasterItem",
        data=payload,
        method="POST",
        headers={
            "Content-Type": "application/json; charset=utf-8",
            "User-Agent": USER_AGENT,
        },
    )
    with urllib.request.urlopen(req) as resp:
        if resp.status != 200:
            raise RuntimeError(f"API returned {resp.status}")


def main():
    parser = argparse.ArgumentParser(description="Set sortGroup/sortOrder for department master entries")
    parser.add_argument("--base-url", default=DEFAULT_BASE_URL, help="Workers base URL")
    parser.add_argument("--dry-run", action="store_true", help="Only show actions without updating")
    parser.add_argument("--sleep", type=float, default=0.2, help="Delay between API calls (seconds)")
    args = parser.parse_args()

    master = fetch_master(args.base_url)
    missing = [name for name in SORT_PLAN if name not in master]
    if missing:
        print("以下の診療科がマスターにありません:", missing, file=sys.stderr)
        sys.exit(1)

    for idx, (name, (order, group)) in enumerate(SORT_PLAN.items(), 1):
        category = master[name]["category"]
        if args.dry_run:
            print(f"[dry-run] {idx:02d}: {name} -> group={group}, order={order}")
        else:
            update_entry(args.base_url, name, category, group, order)
            print(f"updated {idx:02d}: {name}")
            time.sleep(args.sleep)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\nInterrupted", file=sys.stderr)
        sys.exit(1)
