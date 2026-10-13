#!/usr/bin/env python3
"""画框辅助：给图卡叠上 0–1000 比例坐标网格，方便 AI/人读出框的坐标。
用法：python3 scripts/grid.py episodes/M007            → build/M007/grid/*.png
      python3 scripts/grid.py episodes/M007 03.png 0 450 1000 1000   → 只放大看某一块（0–1000 坐标）"""
import sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
ROOT = Path(__file__).resolve().parent.parent
ep = Path(sys.argv[1]); out = ROOT / "build" / ep.name / "grid"; out.mkdir(parents=True, exist_ok=True)
try: font = ImageFont.truetype("DejaVuSans.ttf", 14)
except Exception: font = ImageFont.load_default()
def grid(im, x1=0, y1=0, x2=1000, y2=1000, step=None):
    W, H = im.size
    crop = im.crop((int(x1 / 1000 * W), int(y1 / 1000 * H), int(x2 / 1000 * W), int(y2 / 1000 * H)))
    s = max(1, 1600 / crop.width); crop = crop.resize((int(crop.width * s), int(crop.height * s)))
    d = ImageDraw.Draw(crop, "RGBA")
    span = max(x2 - x1, y2 - y1); step = step or (50 if span > 500 else 20 if span > 200 else 10)
    for v in range(0, 1001, step):
        if x1 <= v <= x2:
            X = (v - x1) / (x2 - x1) * crop.width; major = v % (step * 2) == 0
            d.line([(X, 0), (X, crop.height)], fill=(255, 0, 80, 150 if major else 70), width=1)
            if major: d.text((X + 2, 2), str(v), fill=(255, 0, 80, 255), font=font)
        if y1 <= v <= y2:
            Y = (v - y1) / (y2 - y1) * crop.height; major = v % (step * 2) == 0
            d.line([(0, Y), (crop.width, Y)], fill=(0, 120, 255, 150 if major else 70), width=1)
            if major: d.text((2, Y + 2), str(v), fill=(0, 90, 255, 255), font=font)
    return crop
if len(sys.argv) > 3:
    f = sys.argv[2]; x1, y1, x2, y2 = map(float, sys.argv[3:7])
    p = out / f"{Path(f).stem}_{int(x1)}_{int(y1)}_{int(x2)}_{int(y2)}.png"; grid(Image.open(ep / "cards" / f).convert("RGB"), x1, y1, x2, y2).save(p); print(p)
else:
    for f in sorted((ep / "cards").glob("*.png")):
        p = out / f.name; grid(Image.open(f).convert("RGB")).save(p); print(p)
