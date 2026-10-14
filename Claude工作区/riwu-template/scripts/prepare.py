#!/usr/bin/env python3
"""日物图鉴 模板 · 第 1 步：读 episode.json + 原图卡 → build/plan.json（全片唯一时间线）
不改原图；所有坐标、时长、事件都在这里算好，渲染器和配乐只读 plan.json。"""
import json, sys, hashlib, shutil, math, os, random, argparse
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
STYLE = json.load(open(ROOT / "template/style.json"))
FPS, CW, CH = STYLE["fps"], STYLE["width"], STYLE["height"]
BEAT = 60.0 / STYLE["bpm"]
L = STYLE["layout"]
KIND_LABEL = STYLE["kind_label"]
warns, errors = [], []


FONTS = {"Black": "/usr/share/fonts/google-noto-cjk/NotoSerifCJK-Black.ttc", "Bold": "/usr/share/fonts/google-noto-cjk/NotoSerifCJK-Bold.ttc"}
_FC = {}
def tw(text, weight, reg, size):
    """量字宽（和渲染用的是同一套 Noto Serif CJK），用来给大标题定字号。"""
    from PIL import ImageFont
    k = (weight, reg, int(size))
    if k not in _FC:
        for i in range(5):
            f_ = ImageFont.truetype(FONTS[weight], int(size), index=i)
            if f_.getname()[0].endswith(reg): _FC[k] = f_; break
        else: _FC[k] = ImageFont.truetype(FONTS[weight], int(size), index=2)
    return _FC[k].getlength(text)

def segs_of(word, parts):
    out, i = [], 0
    for k, p in enumerate(parts):
        while i < len(word) and word[i] == " ": out.append({"t": " ", "p": -1}); i += 1
        t = p.get("t", "")
        if not t or word[i:i + len(t)] != t: return None
        out.append({"t": t, "p": k}); i += len(t)
    return out if word[i:].strip() == "" else None

def sha(p): return hashlib.sha256(open(p, "rb").read()).hexdigest()

def beats(sec, lo, hi):  # 秒 → 整拍（卡点）
    sec = min(max(sec, lo), hi)
    return max(1, round(sec / BEAT))

def to_px(box, w, h, name):
    if not (isinstance(box, list) and len(box) == 4): errors.append(f"{name}: 框必须是 [x1,y1,x2,y2]"); return None
    x1, y1, x2, y2 = box
    if not all(0 <= v <= 1000 for v in box) or x2 <= x1 or y2 <= y1:
        errors.append(f"{name}: 坐标需在 0–1000 且 x2>x1, y2>y1，收到 {box}"); return None
    return [x1 / 1000 * w, y1 / 1000 * h, x2 / 1000 * w, y2 / 1000 * h]

def soft_mask(img):  # 找字间空隙用：浅一些的阈值，细横笔（如「一」）也算墨
    return np.asarray(img.convert("L"), dtype=np.int16) < 200

def ink_mask(img):
    a = np.asarray(img.convert("L"), dtype=np.int16)
    m = a < STYLE["ink_threshold"]
    # 去掉分隔线：文字里不会有连续 260px 的横向墨迹或 160px 的纵向墨迹
    def longrun(arr, n):
        out = np.zeros_like(arr)
        for i, row in enumerate(arr):
            if row.sum() < n: continue
            d = np.diff(np.concatenate([[0], row.astype(np.int8), [0]]))
            st, en = np.where(d == 1)[0], np.where(d == -1)[0]
            for s_, e_ in zip(st, en):
                if e_ - s_ >= n: out[i, max(0, s_ - 1):e_ + 1] = True
        return out
    h = longrun(m, 260); v = longrun(m.T, 160).T
    hd = h | np.roll(h, 1, 0) | np.roll(h, -1, 0)
    vd = v | np.roll(v, 1, 1) | np.roll(v, -1, 1)
    return m & ~hd & ~vd

def snap(mask, b, name):
    """把 AI 给的框收紧到框内实际文字墨迹上（不向外扩，避免吞进页眉/照片）；框边有墨迹就警告。"""
    H, W = mask.shape
    pad = 3
    x1, y1, x2, y2 = [int(round(v)) for v in b]
    X1, Y1, X2, Y2 = max(0, x1 - pad), max(0, y1 - pad), min(W, x2 + pad), min(H, y2 + pad)
    sub = mask[Y1:Y2, X1:X2]
    edge = [("上", sub[:2]), ("下", sub[-2:]), ("左", sub[:, :2]), ("右", sub[:, -2:])]
    cut = [n for n, e in edge if e.sum() >= 3]
    if cut: warns.append(f"{name}: 框的{'、'.join(cut)}边压到了文字，可能切字")
    ys, xs = np.where(sub)
    if len(ys) < 30: errors.append(f"{name}: 框里几乎没有文字，框可能放错了位置"); return [x1, y1, x2, y2]
    m = 6
    return [int(max(0, X1 + xs.min() - m)), int(max(0, Y1 + ys.min() - m)), int(min(W, X1 + xs.max() + 1 + m)), int(min(H, Y1 + ys.max() + 1 + m))]

def clip_mask(mask, box, keep=0.5):
    """框边上被切到的字（连通域大半在框外，比如上一行的 g 尾巴、下一行的 f 头）从框里去掉。"""
    import cv2
    H, W = mask.shape
    x1, y1, x2, y2 = [int(round(v)) for v in box]
    M = 60
    X1, Y1, X2, Y2 = max(0, x1 - M), max(0, y1 - M), min(W, x2 + M), min(H, y2 + M)
    sub = mask[Y1:Y2, X1:X2].astype(np.uint8)
    n, lab, st, _ = cv2.connectedComponentsWithStats(sub, connectivity=8)
    drop = np.zeros(n, bool)
    iy1, iy2 = y1 - Y1, y2 - Y1
    sl = sst = None
    if SOFT is not None and SOFT.shape == mask.shape:  # 浅阈值下连成一体的（ff 连字的勾、细笔）算同一个字
        _, sl, sst, _ = cv2.connectedComponentsWithStats(SOFT[Y1:Y2, X1:X2].astype(np.uint8), connectivity=8)
    for i in range(1, n):
        cy, ch = st[i, 1], st[i, 3]
        if cy >= iy1 and cy + ch <= iy2:
            # 框边上的小点（下一行的变音符 ü/ö、上一行的点）：离框外那行更近就去掉
            cx, cw = st[i, 0], st[i, 2]
            if ch < 0.25 * (iy2 - iy1) and sl is not None:
                ys_, xs_ = np.where(lab == i)
                k_ = sl[ys_[0], xs_[0]]
                if k_ and sst[k_, 3] >= 2 * ch and sst[k_, 1] >= iy1 - 1 and sst[k_, 1] + sst[k_, 3] <= iy2 + 1: continue
            if ch < 0.25 * (iy2 - iy1):
                # 同一行判定：附近的字（不含自己）底边普遍落到它这几行里（逗号、句号）→ 属于本行；
                # 顶边普遍在它下面结束之前开始（小写 c/o 贴着框上沿）→ 属于本行
                bot = iy2 - (cy + ch) <= 6
                ra, rb = (max(0, cy - 3 * ch), cy + ch) if bot else (cy, min(len(lab), cy + 4 * ch))
                nb = [j for j in np.unique(lab[ra:rb, max(0, cx - 6 * ch):cx + cw + 6 * ch]) if j not in (0, i) and st[j, 3] >= 1.5 * ch]
                if len(nb) >= 2:  # 至少两个字作证（单独一个 g 尾巴不算）
                    if bot and np.median([st[j, 1] + st[j, 3] for j in nb]) >= cy: continue
                    if not bot and np.median([st[j, 1] for j in nb]) <= cy + ch: continue
                col = sub[:, cx:cx + cw]
                if iy2 - (cy + ch) <= 6:
                    below = np.where(col[iy2:min(len(col), iy2 + 3 * ch)].any(1))[0] + (iy2 - cy - ch)  # 只看框外那一行
                    above = np.where(col[max(0, cy - 3 * ch):cy].any(1)[::-1])[0]
                    if len(below) and below[0] <= max(8, 1.5 * ch) and (not len(above) or below[0] < above[0]):
                        r0 = cy + ch + below[0]; lj = [l for l in np.unique(lab[r0, cx:cx + cw]) if l]
                        if lj and ch <= 0.4 * max(st[l, 3] for l in lj): drop[i] = True  # 只去掉比框外那个字小得多的点（变音符）
                elif cy - iy1 <= 6:
                    above = np.where(col[max(0, iy1 - 3 * ch):iy1].any(1)[::-1])[0] + (cy - iy1)
                    below = np.where(col[cy + ch:cy + 4 * ch].any(1))[0]
                    if len(above) and above[0] <= max(8, 1.5 * ch) and (not len(below) or above[0] < below[0]):
                        r0 = cy - 1 - above[0]; lj = [l for l in np.unique(lab[r0, cx:cx + cw]) if l]
                        if lj and ch <= 0.4 * max(st[l, 3] for l in lj): drop[i] = True
            continue
        ov = min(cy + ch, iy2) - max(cy, iy1)
        if ov > 0 and ov < keep * ch: drop[i] = True
    out = mask.copy()
    if drop.any():
        d = drop[lab]
        out[Y1:Y2, X1:X2] &= ~d
        return out, (d, X1, Y1)
    return out, None

def bands(mask, b, split_tall=False):
    x1, y1, x2, y2 = b
    sub = mask[y1:y2, x1:x2]
    rows = sub.sum(1) >= 2
    out, s = [], None
    for i, r in enumerate(list(rows) + [False]):
        if r and s is None: s = i
        if not r and s is not None: out.append([s, i]); s = None
    merged = []
    for bd in out:  # 只合并变音符、点等小碎片（高 < 6px）
        if merged and ((bd[1] - bd[0]) < 6 and bd[0] - merged[-1][1] <= 6 or (merged[-1][1] - merged[-1][0]) < 6 and bd[0] - merged[-1][1] <= 6):
            merged[-1][1] = bd[1]
        else: merged.append(bd)
    merged = [m for m in merged if m[1] - m[0] >= 4]
    if split_tall and len(merged) >= 2:  # 两行粘连：在墨迹最少的那一行切开
        med = sorted(m[1] - m[0] for m in merged)[len(merged) // 2]
        fixed = []
        for s_, e_ in merged:
            if e_ - s_ > med * 1.7:
                prof = sub[s_:e_].sum(1); a, z_ = int((e_ - s_) * 0.3), int((e_ - s_) * 0.7)
                c = s_ + a + int(np.argmin(prof[a:z_])); fixed += [[s_, c], [c + 1, e_]]
            else: fixed.append([s_, e_])
        merged = fixed
    res = []
    for s, e in merged:
        cols = np.where(sub[s:e].any(0))[0]
        res.append({"y1": y1 + s, "y2": y1 + e, "x1": x1 + int(cols.min()), "x2": x1 + int(cols.max()) + 1})
    return res

def find_cut(mask, band, target, lo, hi):
    seg = mask[band["y1"]:band["y2"], :].any(0)
    best, bestscore = None, 1e9
    x = lo
    while x < hi:
        if not seg[x]:
            s = x
            while x < hi and not seg[x]: x += 1
            gw = x - s
            if gw >= 2:
                c = (s + x) // 2
                score = abs(c - target) - gw * 9
                if score < bestscore: best, bestscore = c, score
        x += 1
    return best

SOFT = None
def layout_lift(mask, box, name, mode="body", zoom_hint=None, hmax=None, wmax=None, exclude=None, target=None, zmax=None, join=True):
    """把卡上一块区域抬出来放大：能整体放就整体放；太宽就按行、按字间空隙重排（像素仍是原图）。
    exclude：去掉和这个框重叠的行（例如名称区里已经单独做成大标题的那一行）。"""
    WMAX, HMAX = (wmax or L["panel_inner_w"]), (hmax or L["panel_inner_h"])
    ZMAX = zmax or L["zoom_max"]
    mask, _ = clip_mask(mask, box)
    bd = bands(mask, box, split_tall=(mode == "body"))
    if SOFT is not None:  # 行的上下沿：浅色笔画（f 的顶、细横）也带上，最多 4px，不越过相邻行
        for i, b in enumerate(bd):
            lo_ = bd[i - 1]["y2"] + 1 if i > 0 else max(0, b["y1"] - 4)
            hi_ = bd[i + 1]["y1"] - 1 if i + 1 < len(bd) else min(SOFT.shape[0], b["y2"] + 4)
            for _ in range(4):
                if b["y1"] - 1 >= lo_ and SOFT[b["y1"] - 1, b["x1"]:b["x2"]].any(): b["y1"] -= 1
                else: break
            for _ in range(4):
                if b["y2"] + 1 <= hi_ and SOFT[b["y2"], b["x1"]:b["x2"]].any(): b["y2"] += 1
                else: break
        # 行的左右端：浅灰色的标点/字（译文常用浅灰，句号「。」的细圈达不到墨迹阈值）也带上，最多跨 0.8 个字高的空白，不越出框
        for b in bd:
            h_ = b["y2"] - b["y1"]; reach = int(h_ * 0.8)
            cols = np.where(SOFT[b["y1"]:b["y2"], max(box[0], b["x2"]):min(box[2], b["x2"] + reach + h_)].any(0))[0]
            x_ = b["x2"]
            for cc in cols:
                if b["x2"] + cc - x_ > reach: break
                x_ = b["x2"] + cc + 1
            b["x2"] = x_
            cols = np.where(SOFT[b["y1"]:b["y2"], max(box[0], b["x1"] - reach - h_):b["x1"]].any(0))[0][::-1]
            x0 = max(box[0], b["x1"] - reach - h_); x_ = b["x1"]
            for cc in cols:
                if x_ - (x0 + cc) > reach: break
                x_ = x0 + cc
            b["x1"] = x_
    if len(bd) > 1:  # 框边上只露出一条的上/下一行（字高不到正常行的六成）→ 不属于这块
        hm_ = float(np.median([b["y2"] - b["y1"] for b in bd]))
        bd = [b for i, b in enumerate(bd) if not ((i == 0 or i == len(bd) - 1) and (b["y2"] - b["y1"]) < 0.6 * hm_)]
    if exclude:
        def ov(b):
            oy = min(b["y2"], exclude[3]) - max(b["y1"], exclude[1])
            return oy > 0.5 * (b["y2"] - b["y1"]) and min(b["x2"], exclude[2]) > max(b["x1"], exclude[0])
        bd = [b for b in bd if not ov(b)]
        if bd: box = [min(b["x1"] for b in bd) - 3, min(b["y1"] for b in bd) - 3, max(b["x2"] for b in bd) + 3, max(b["y2"] for b in bd) + 3]  # 居中排版的副行：左右也收紧
    if not bd: return None
    hs = sorted(b["y2"] - b["y1"] for b in bd)
    base = hs[max(0, int(len(hs) * 0.3) - (1 if len(hs) > 2 else 0))] if mode == "name" else hs[len(hs) // 2]
    T = target or L["target_text_px"]
    z = min(max(T / base, L["zoom_min"]), ZMAX)
    bw, bh = box[2] - box[0], box[3] - box[1]
    if mode == "fit": z = min(WMAX / bw, HMAX / bh, ZMAX)
    orph_try = 0
    for attempt in range(8):
        orphan = False
        if bw * z <= WMAX and bh * z <= HMAX:
            pieces = [{"src": [box[0], box[1], bw, bh], "dst": [0, 0, bw * z, bh * z], "line": 0}]
            ch = bh * z; split = False
        else:
            pieces, y = [], 0.0
            seg = (SOFT if SOFT is not None else mask)
            rmax = max(b["x2"] for b in bd)
            left = box[0]
            # 1) 分段落：上一行几乎写满到栏右边、这一行字高相近且缩进接近 → 同一段（卡片上的硬换行）
            paras = []
            for li, b in enumerate(bd):
                h = b["y2"] - b["y1"]; big = h > base * 1.6
                P_ = paras[-1] if paras else None
                fc_ = np.where(mask[b["y1"]:b["y2"], b["x1"]:b["x1"] + int(h * 0.6)].any(0))[0]
                run_ = 0
                while run_ < len(fc_) and fc_[run_] == run_ + (fc_[0] if len(fc_) else 0): run_ += 1
                rr_ = np.where(mask[b["y1"]:b["y2"], b["x1"]:b["x1"] + max(1, run_)].any(1))[0]
                bracket = len(fc_) > 0 and run_ < h * 0.32 and len(rr_) > 0 and (rr_.max() - rr_.min() + 1) > h * 0.8 and (run_ + 2 < len(fc_) and fc_[run_] - fc_[run_ - 1] > 1)  # 行首是「(」「（」类：译文/注释另起一段
                if (join and mode != "name" and P_ and not big and not P_["big"] and not bracket and P_["lines"][-1]["x2"] >= rmax - base * 3.0
                        and abs(h - P_["h"]) < base * 0.35 and b["y1"] - P_["lines"][-1]["y2"] < h * 1.3
                        and b["x1"] - left < (P_["lines"][-1]["x1"] - left) + base * 2.5):
                    P_["lines"].append(b)
                else:
                    paras.append({"lines": [b], "big": big, "h": h, "li": li})
            def gaps_of(ink, a, e):
                out, x = [], int(a)
                while x < e:
                    if not ink[x]:
                        s0_ = x
                        while x < e and not ink[x]: x += 1
                        out.append((s0_, x))
                    x += 1
                return out
            def best_cut(ink, a, lim, cap, tgt, med, bb=None):
                """在 [a, lim] 里找切点：靠近目标位置；明显比字距大的空隙（词间、标点后）优先。
                bb：所在行。空隙两边都是「矮字」（拉丁小写/字母，字高不到整行八成）且空隙比词间距窄 → 是单词内部，不切。"""
                lo = a + (lim - a) * 0.15
                best, bs = None, -1e9
                mr = mask[bb["y1"]:bb["y2"], :] if bb is not None else None
                okg = None
                if bb is not None:  # 偏旁合字：窄墨块 + 小空隙 → 同一个字（口|及 = 吸），只允许在整字之间切
                    hh_ = bb["y2"] - bb["y1"]; okg = set(); gw0 = 0.0; prev = None
                    for g0, g1 in gaps_of(ink, bb["x1"], bb["x2"]):
                        if prev is not None:
                            gw0 += g0 - prev
                            if gw0 >= 0.62 * hh_ or (g1 - g0) >= 0.18 * hh_: okg.add(g0); gw0 = 0.0
                            else: gw0 += g1 - g0
                        else: gw0 = g0 - bb["x1"]
                        prev = g1
                for g0, g1 in gaps_of(ink, lo, lim):
                    gw = g1 - g0
                    if gw < 2: continue
                    if okg is not None and g0 not in okg and gw < 0.18 * (bb["y2"] - bb["y1"]): continue
                    if mr is not None:
                        hh_ = bb["y2"] - bb["y1"]
                        if gw < 0.27 * hh_:
                            w_ = max(3, int(0.45 * hh_))
                            def ext_(v):
                                idx = np.where(v)[0]
                                return (idx.max() - idx.min() + 1) if len(idx) else hh_
                            if ext_(mr[:, max(0, g0 - w_):g0].any(1)) < 0.82 * hh_ and ext_(mr[:, g1:g1 + w_].any(1)) < 0.82 * hh_: continue
                    c = (g0 + g1) // 2
                    sc = min(gw / max(med, 2.0), 3.5) * 0.6 - abs(c - tgt) / max(1, cap) * 2.5
                    if sc > bs: best, bs = c, sc
                return best
            prev_y2 = None
            for pi, P_ in enumerate(paras):
                lz = z
                if P_["big"]: lz = min(z, WMAX / max(1, max(b["x2"] for b in P_["lines"]) - left))
                cap = WMAX / lz
                rows, row, rx = [], [], (P_["lines"][0]["x1"] - left) * 0
                ind0 = 0.0
                ind1 = max(0.0, (P_["lines"][1]["x1"] if len(P_["lines"]) > 1 else P_["lines"][0]["x1"]) - left) if len(P_["lines"]) > 1 else max(0.0, P_["lines"][0]["x1"] - left)
                # 首行从栏左边开始（保留原来的项目符号/缩进），续行对齐到段落正文起点
                rx = 0.0; cur_ind = 0.0
                for k, b in enumerate(P_["lines"]):
                    h = b["y2"] - b["y1"]
                    ink = seg[b["y1"]:b["y2"], :].any(0)
                    gl = [g1 - g0 for g0, g1 in gaps_of(ink, b["x1"], b["x2"]) if g1 - g0 >= 2]
                    med = float(np.median(gl)) if gl else 3.0
                    # 这一行的「空格宽」：拉丁文取词间距，中日文≈字距；跨行拼接、片段相接都用它
                    b["sp"] = float(min(max(np.percentile(gl, 85) if gl else base * 0.18, base * 0.12), base * 0.5))
                    bal = None
                    if len(P_["lines"]) == 1 and b["x2"] - left > cap:  # 单独一行要拆：按均分位置找切点，避免最后只剩一两个字
                        bal = (b["x2"] - left) / math.ceil((b["x2"] - left) / cap)
                    a = left if (k == 0) else b["x1"]
                    if k > 0 and row: rx += b["sp"]  # 跨行接上，留一点字距
                    while a < b["x2"]:
                        avail = cap - rx
                        if b["x2"] - a <= avail + 1:
                            row.append((a, b["x2"], b)); rx += b["x2"] - a; a = b["x2"]; break
                        c = best_cut(ink, a, int(a + avail), cap, (a + bal) if bal else (a + avail), med, b)
                        if c is None or c - a < base * 0.9:
                            if row: rows.append((row, cur_ind)); row = []; cur_ind = ind1; rx = ind1; continue
                            c = int(a + avail); warns.append(f"{name}: 第{li+1}行找不到字间空隙，硬切")
                        # 不让下一行以「，。、」开头：紧跟切点的矮小窄字形并到这一行
                        x = c
                        while x < b["x2"] and not ink[x]: x += 1
                        e2 = x
                        while e2 < b["x2"] and ink[e2]: e2 += 1
                        nx_ = e2
                        while nx_ < b["x2"] and not ink[nx_]: nx_ += 1
                        trail_ok = nx_ >= b["x2"] or (nx_ - e2) >= 0.25 * h  # 全角标点后面自带半个字的空白；拉丁小写字母后面紧跟下一个字母
                        if 0 < e2 - x < base * 0.45 and trail_ok:
                            rr = np.where(mask[b["y1"]:b["y2"], x:e2].any(1))[0]
                            if len(rr) and rr.max() - rr.min() + 1 < 0.5 * h:
                                if (e2 + 1 - a) * lz <= avail * lz + 22: c = e2 + 1   # 标点放得下（可伸进右内边距 22px）：并到这一行
                                else:  # 放不下：把标点前一个字一起挤到下一行（不出面板、不越安全线）
                                    c2 = best_cut(ink, a, int(c - 2), cap, c - base, med, b)
                                    if c2 is not None and c2 - a >= base * 0.9: c = c2
                        row.append((a, c, b)); rows.append((row, cur_ind)); row = []; cur_ind = ind1; rx = ind1
                        a = c
                        while a < b["x2"] and not ink[a]: a += 1
                if row: rows.append((row, cur_ind))
                if len(rows) > len(P_["lines"]) and sum(ex - sx for sx, ex, _ in rows[-1][0]) < base * 4.6: orphan = True  # 重排后最后一行只剩两三个字
                if len(P_["lines"]) == 1 and len(rows) == 2 and (P_["lines"][0]["x2"] - left) <= cap * 1.15: orphan = True  # 单行只超出一点：缩一点字号放进一行，不要从中间劈开
                if prev_y2 is not None: y += (P_["lines"][0]["y1"] - prev_y2) * z * 0.85
                for ri, (rw, ind) in enumerate(rows):
                    rh = max(bb["y2"] - bb["y1"] for _, _, bb in rw) + 4
                    xx = ind * lz
                    for j, (sx, ex, bb) in enumerate(rw):
                        if j > 0: xx += bb.get("sp", base * 0.18) * lz
                        if sx > bb["x1"] or j > 0 or ri > 0:  # 去掉片段开头的空白
                            cols = np.where(mask[bb["y1"]:bb["y2"], int(sx):int(ex)].any(0))[0]
                            if len(cols): sx = sx + max(0, int(cols.min()) - 2)
                        hh_ = bb["y2"] - bb["y1"] + 4
                        rowm_ = mask[bb["y1"]:bb["y2"], int(ex):int(ex) + 3].any(0)
                        nxt_ = int(np.argmax(rowm_)) if rowm_.any() else 3
                        pw_ = ex - sx + min(2, max(0, nxt_ - 1))  # 右边留 2px，但不吃进下一个字
                        pieces.append({"src": [sx, bb["y1"] - 2, pw_, hh_], "dst": [xx, y + (rh - hh_) / 2 * lz, pw_ * lz, hh_ * lz],
                                       "line": P_["li"], "wrap": ri > 0})
                        xx += pw_ * lz
                    y += rh * lz + (T * 0.22 if ri < len(rows) - 1 else 0)
                prev_y2 = P_["lines"][-1]["y2"]
            ch = y; split = True
        if ch <= HMAX and not (orphan and orph_try < 3 and base * z * 0.93 >= 46): break
        if ch <= HMAX: orph_try += 1; z *= 0.93; continue  # 只为消掉孤字：字号略缩一点再排
        z *= 0.9
    else:
        warns.append(f"{name}: 内容太多，放大后仍超出面板高度")
    cw = max(p["dst"][0] + p["dst"][2] for p in pieces)
    hmed = float(np.median([b["y2"] - b["y1"] for b in bd]))
    units = sum((b["x2"] - b["x1"]) / max(1, b["y2"] - b["y1"], hmed * 0.8) for b in bd if (b["y2"] - b["y1"]) > hmed * 0.45)
    return {"pieces": pieces, "w": cw, "h": ch, "zoom": z, "split": split, "units": units, "lines": len(bd), "text_px": base * z}

def stack(parts, gap=34):
    """多个框（例如名称区左右两栏）上下叠成一个面板。"""
    if len(parts) == 1: return parts[0]
    y, pieces = 0.0, []
    for k, p in enumerate(parts):
        for pc in p["pieces"]:
            d = pc["dst"]; pc = dict(pc); pc["dst"] = [d[0], d[1] + y, d[2], d[3]]; pc["line"] = pc["line"] + 100 * k; pieces.append(pc)
        y += p["h"] + gap
    return {"pieces": pieces, "w": max(p["w"] for p in parts), "h": y - gap, "zoom": min(p["zoom"] for p in parts),
            "split": any(p["split"] for p in parts), "units": sum(p["units"] for p in parts), "lines": sum(p["lines"] for p in parts),
            "text_px": min(p["text_px"] for p in parts)}

def place(lift, cx, top=None, cy=None):
    pad = L["panel_pad"]
    pw, ph = lift["w"] + pad * 2, lift["h"] + pad * 2
    px = cx - pw / 2
    py = top if top is not None else cy - ph / 2
    for p in lift["pieces"]:
        d = p["dst"]; p["dst"] = [px + pad + d[0], py + pad + d[1], d[2], d[3]]
    lift["panel"] = [px, py, pw, ph]
    return lift

def bg_color(im, box):
    """面板底色＝这块区域里非文字像素的中位色，切片贴上去看不出方块。"""
    x1, y1, x2, y2 = [int(v) for v in box]
    a = np.asarray(im.crop((x1, y1, x2, y2)).convert("RGB")).reshape(-1, 3)
    lum = a.mean(1); a = a[lum > 200]
    if len(a) < 20: return "#F4EEE3"
    m = np.median(a, 0).astype(int)
    return "#%02X%02X%02X" % tuple(m)

def render_piece(im, src, dw, dh, path, white=False, to=None, line=False, alpha=False):
    """预先用 Lanczos 放大并轻微锐化，静止时 1:1 显示，比浏览器拉伸清楚。
    white=True：把卡片底色归一成纯白，渲染时用 multiply 叠在纸面上，看不出方块边。"""
    sx, sy, sw, sh = src
    crop = im.crop((int(round(sx)), int(round(sy)), int(round(sx + sw)), int(round(sy + sh))))
    # 擦掉从框外伸进来的半个字（连通域大半在框外）
    x1, y1 = int(round(sx)), int(round(sy)); x2, y2 = x1 + crop.size[0], y1 + crop.size[1]
    gm = np.asarray(im.convert("L"), dtype=np.int16) < STYLE["ink_threshold"]
    _, hit = clip_mask(gm, [x1, y1, x2, y2])
    if line:  # 单行大标题：整个落在基线以下 / 顶线以上的小块（下一行的变音点、上一行的尾巴）不属于这一行
        import cv2
        sub = gm[y1:y2, x1:x2].astype(np.uint8)
        n, lab, st, _ = cv2.connectedComponentsWithStats(sub, connectivity=8)
        if n > 2:
            hmax = st[1:, 3].max(); big = [k for k in range(1, n) if st[k, 3] >= 0.5 * hmax]
            base = np.median([st[k, 1] + st[k, 3] for k in big]); topl = min(st[k, 1] for k in big)  # 用最高的字顶（i 的点、ア的浊点不会被误删）
            bad = np.zeros(n, bool)
            for k in range(1, n):
                if st[k, 1] > base + 1 or st[k, 1] + st[k, 3] < topl - 1: bad[k] = True
            if bad.any():
                d0 = np.zeros(gm.shape, bool); d0[y1:y2, x1:x2] = bad[lab]
                if hit is None: hit = (d0[max(0, y1 - 60):, max(0, x1 - 60):], max(0, x1 - 60), max(0, y1 - 60))
                else:
                    d, X1, Y1 = hit; d = d.copy(); d |= d0[Y1:Y1 + d.shape[0], X1:X1 + d.shape[1]]; hit = (d, X1, Y1)
    if hit is not None:
        import cv2
        d, X1, Y1 = hit
        d = cv2.dilate(d.astype(np.uint8), np.ones((5, 5), np.uint8)).astype(bool)
        d = d[y1 - Y1:y2 - Y1, x1 - X1:x2 - X1]
        if d.any():
            a = np.asarray(crop.convert("RGB")).copy()
            lum = a.mean(2); bgc = np.median(a[lum > np.percentile(lum, 60)], 0)
            a[d] = bgc.astype(np.uint8); crop = Image.fromarray(a)
    out = crop.resize((max(1, int(round(dw))), max(1, int(round(dh)))), Image.LANCZOS)
    if dw / max(1, sw) > 1.2: out = out.filter(ImageFilter.UnsharpMask(radius=1.4, percent=70, threshold=2))
    if white:
        a = np.asarray(out.convert("RGB"), dtype=np.float32)
        lum = a.mean(2).reshape(-1); px = a.reshape(-1, 3)[lum > np.percentile(lum, 60)]
        bg = np.median(px, 0) if len(px) else np.array([245, 240, 232], np.float32)
        out = Image.fromarray(np.clip(a / bg * 255, 0, 255).astype(np.uint8))
    elif alpha:  # 只留「墨」：按局部底色反算透明度 → 贴在任何面板上都没有底色补丁（卡片上的浅色块、渐变一并去掉）
        import cv2
        a = np.asarray(out.convert("RGB"), dtype=np.float32)
        k = max(31, int(round(min(dh, 160) * 1.6)) | 1)
        a8 = np.asarray(out.convert("RGB"))
        pad_ = k // 2 + 1
        ap = cv2.copyMakeBorder(a8, pad_, pad_, pad_, pad_, cv2.BORDER_REFLECT)
        bgm = cv2.medianBlur(ap, min(k, 255))[pad_:-pad_, pad_:-pad_].astype(np.float32)  # 局部中位色＝纸色（字只占一小部分）
        bgm = np.maximum(bgm, a)  # 比纸还亮的像素也当纸
        Lb, Lp = bgm.mean(2), a.mean(2)
        al = np.clip((Lb - Lp - 16) / 120.0, 0, 1)
        col = (a - (1 - al[..., None]) * bgm) / np.maximum(al[..., None], 1e-3)
        col = np.clip(np.where(al[..., None] > 0.02, col, 40), 0, 255)
        out = Image.fromarray(np.dstack([col, al * 255]).astype(np.uint8), "RGBA")
    elif to:  # 把切片自身底色校正成面板底色（卡片上有浅色色块/渐变时不出现补丁）
        a = np.asarray(out.convert("RGB"), dtype=np.float32)
        lum = a.mean(2).reshape(-1); px = a.reshape(-1, 3)[lum > np.percentile(lum, 60)]
        if len(px):
            bg = np.median(px, 0); tg = np.array([int(to[i:i + 2], 16) for i in (1, 3, 5)], np.float32)
            out = Image.fromarray(np.clip(a / np.maximum(bg, 1) * tg, 0, 255).astype(np.uint8))
    out.save(path)

FORMATS = ("reveal", "quiz", "flash", "book")  # 讲解式（完整讲解）/ 猜选式 / 快闪式

def quiz_pool(epdir, ep, short):
    """猜选式的干扰项：从同一系列其他期里取「同一种语言」的名字（都是真名字，只是不是这个东西的）。"""
    out = []
    for d in sorted(epdir.parent.iterdir()):
        if d == epdir or d.name.startswith("_") or not (d / "episode.json").exists(): continue
        try: e2 = json.load(open(d / "episode.json"))
        except Exception: continue
        for c in e2.get("cards", []):
            if c.get("role") == "lang" and c.get("short") == short and c.get("word") and all(o["text"] != c["word"] for o in out):
                out.append({"text": c["word"], "reading": c.get("reading", ""), "object": e2.get("object", ""), "id": e2.get("id", d.name)})
    return out

def main(epdir, fmt=None, name=None):
    global SOFT
    epdir = Path(epdir).resolve()
    ep = json.load(open(epdir / "episode.json"))
    fmt = fmt or ep.get("format", "reveal")
    if fmt not in FORMATS: print(f"✖ format 只能是 {FORMATS}，收到 {fmt}"); sys.exit(2)
    build = ROOT / "build" / (name or (epdir.name if fmt == "reveal" else f"{epdir.name}_{fmt}"))
    pub = build / "public"
    if pub.exists(): shutil.rmtree(pub)
    (pub / "cards").mkdir(parents=True); (pub / "pieces").mkdir()
    (build / "qc").mkdir(parents=True, exist_ok=True)
    rng = np.random.default_rng(6)
    g = rng.normal(0, 5, (CH, CW, 1)); base = np.array([244, 238, 227], dtype=np.float32)
    Image.fromarray(np.clip(base + g, 0, 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.6)).save(pub / "paper.png")

    cards, inputs, softs, IM = [], [], {}, {}
    for c in ep["cards"]:
        src = epdir / "cards" / c["file"]
        if not src.exists(): errors.append(f"找不到图卡 {src}"); continue
        im = Image.open(src).convert("RGB")
        if c.get("hide"):  # 只在内存副本上把图标（🔊 等看着能点的东西）涂成周围底色；原图不动
            im = im.copy(); d_ = ImageDraw.Draw(im)
            for k, hb in enumerate(c["hide"]):
                r = to_px(hb, *im.size, f"{c['file']}.hide[{k}]")
                if r: d_.rectangle([int(r[0]), int(r[1]), int(r[2]), int(r[3])], fill=bg_color(im, [r[0] - 12, r[1] - 12, r[2] + 12, r[3] + 12]))
        inputs.append({"file": str(src.relative_to(ROOT)), "sha256": sha(src), "size": im.size})
        shutil.copyfile(src, pub / "cards" / c["file"])
        cards.append((c, im, ink_mask(im))); softs[c["file"]] = soft_mask(im); IM[c["file"]] = im
    if errors: finish(build, None, inputs); return
    hook = [x for x in cards if x[0]["role"] == "hook"]; outro = [x for x in cards if x[0]["role"] == "outro"]
    langs = [x for x in cards if x[0]["role"] == "lang"]
    if not hook: errors.append("缺少 role=hook 的图卡")
    if not outro: errors.append("缺少 role=outro 的图卡")
    if not 1 <= len(langs) <= 6: errors.append("role=lang 的图卡需要 1–6 张")
    for c, _, _ in langs:
        for k in ("lang", "short", "photo", "word"):
            if k not in c: errors.append(f"{c['file']}: 缺少字段 {k}")
        if len(c.get("meaning", "")) > 12: errors.append(f"{c['file']}.meaning 不超过 12 个字")
    if len(ep.get("insight", "")) > 24: errors.append("insight 不超过 24 个字")
    # ---- 结构自检：拼错字段名、简称重复、parts 对不上、引用了不存在的语言/代号 ----
    TOP = {"id", "object", "series", "cards", "anchor", "bridge", "insight", "insight_langs", "insight_links", "recall", "notes", "format", "quiz"}
    CARD = {"file", "role", "lang", "short", "photo", "subject", "question", "title", "name", "focus", "meaning", "word", "reading",
            "parts", "hide", "max_focus", "notes"}
    FOCUS = {"kind", "box", "label", "hold", "note", "reflow", "hide"}
    for k in ep:
        if k not in TOP: warns.append(f"顶层未知字段「{k}」（拼错了？会被忽略）")
    for c in ep["cards"]:
        for k in c:
            if k not in CARD: warns.append(f"{c.get('file')}: 未知字段「{k}」（拼错了？会被忽略）")
        if c.get("role") not in ("hook", "lang", "outro"): errors.append(f"{c.get('file')}: role 只能是 hook / lang / outro")
        for k, fo in enumerate(c.get("focus", [])):
            for kk in fo:
                if kk not in FOCUS: warns.append(f"{c.get('file')}.focus[{k}]: 未知字段「{kk}」（拼错了？会被忽略）")
    sh = [x[0].get("short") for x in langs]
    for v in set(sh):
        if sh.count(v) > 1: errors.append(f"short「{v}」重复：每种语言的简称必须不同")
    links = set()
    for c, _, _ in langs:
        if "word" not in c: continue
        ps = c.get("parts", [])
        if ps:
            joined = "".join(p.get("t", "") for p in ps).replace(" ", "")
            if joined != c["word"].replace(" ", ""):
                errors.append(f"{c['file']}.parts 拼起来是「{joined}」，和 word「{c['word']}」对不上（空格除外，要一字不差）")
            for p in ps:
                if len(p.get("m", "")) > 6: warns.append(f"{c['file']}.parts「{p.get('t')}」的意思「{p['m']}」偏长（≤4 字最好）")
                if p.get("link"): links.add(p["link"])
    if ep.get("bridge", "中") not in sh: warns.append(f"bridge「{ep.get('bridge', '中')}」不是任何讲解卡的 short：不会有中文过渡")
    for v in ep.get("insight_langs", []):
        if v not in sh: errors.append(f"insight_langs 里的「{v}」不是任何讲解卡的 short")
    for v in ep.get("insight_links", []):
        if v not in links: errors.append(f"insight_links 里的「{v}」没有出现在任何 parts[].link 里")
    if errors: finish(build, None, inputs); return

    B = lambda n: int(round(n * BEAT * FPS))
    scenes, events, f, pc = [], [], 0, [0]
    def ev(t, kind): events.append({"f": int(t), "kind": kind})
    def bake(lift, card, tag):
        for i, p in enumerate(lift["pieces"]):
            name = f"{tag}_{i:02d}.png"
            render_piece(IM[card], p["src"], p["dst"][2], p["dst"][3], pub / "pieces" / name, alpha=True)
            p["img"] = "pieces/" + name
        return lift

    MK = {c["file"]: m for c, _, m in cards}
    def ink_span(card, src):
        x, y, w, h = [int(round(v)) for v in src]
        cols = np.where(MK[card][y:y + h, x:x + w].any(0))[0]
        return [float(cols.min() / max(1, w)), float((cols.max() + 1) / max(1, w))] if len(cols) else [0.0, 1.0]
    def bake_ink(lift, card):
        for p in lift["pieces"]: p["ink"] = ink_span(card, p["src"])
        return lift
    PX, PW, PAD = L["panel_x"], L["panel_w"], L["panel_pad"]
    INW = PW - 2 * PAD
    def place_left(lift, top):
        # 行尾标点允许伸进右内边距（最多 22px），面板宽不超过 panel_w → 不越右侧按钮安全线
        pw, ph = min(lift["w"] + PAD * 2, max(PW, INW + PAD * 2)), lift["h"] + PAD * 2
        for p in lift["pieces"]:
            d = p["dst"]; p["dst"] = [PX + PAD + d[0], top + PAD + d[1], d[2], d[3]]
        lift["panel"] = [PX, top, pw, ph]
        return lift

    # ---- 开场：问题面板压在照片下沿，第 0 帧就在 ----
    c, im, mk = hook[0]; SOFT = softs[c["file"]]; W_, H_ = im.size
    q = to_px(c["question"], W_, H_, "hook.question")
    ql = layout_lift(mk, snap(mk, q, "hook.question"), "hook.question", mode="fit", wmax=INW, hmax=L["hook_q_h"], zmax=3.2)
    place_left(ql, L["hook_bottom"] - ql["h"] - 2 * PAD); ql["bg"] = STYLE["colors"]["card"]; bake(ql, c["file"], "hook"); bake_ink(ql, c["file"])
    nb = {"tex": 2, "ask": 2, "count": 3}
    scenes.append({"type": "hook", "start": f, "dur": B(sum(nb.values())), "card": c["file"], "size": [W_, H_],
                   "photo": to_px(c["photo"], W_, H_, "hook.photo"), "subject": to_px(c.get("subject", c["photo"]), W_, H_, "hook.subject"),
                   "photo_h": ql["panel"][1] + 160,
                   "lift": ql, "t_zoom": B(1.5), "t_count": B(nb["tex"] + nb["ask"]), "beat": B(1), "countText": STYLE["text"]["guess"]})
    ev(f, "start"); ev(f + B(1.5), "whoosh")
    for k in range(3): ev(f + B(5 + k), "tick")
    f += B(sum(nb.values()))

    # ---- 讲解顺序：中文先做「你熟悉的叫法」过渡（bridge，短），主讲语言（anchor，默认日语）紧跟其后重点讲，其余按卡片顺序 ----
    anc, brg = ep.get("anchor", "日"), ep.get("bridge", "中")
    shorts = [x[0]["short"] for x in langs]
    if anc not in shorts: warns.append(f"anchor「{anc}」不是任何讲解卡的 short，改用第一张"); anc = shorts[0]
    if brg == anc or brg not in shorts: brg = None
    order = [x for x in langs if x[0]["short"] == brg] + [x for x in langs if x[0]["short"] == anc] + [x for x in langs if x[0]["short"] not in (anc, brg)]
    PB = L["photo_band"]
    seen = {}  # link → [(short, 片段)]：后面的语言出现同一个词根时，画面上直接连回前面
    RATE = STYLE["read_units_per_sec"]
    for li, (c, im, mk) in enumerate(order):
        W_, H_ = im.size; SOFT = softs[c["file"]]
        is_a, is_b = c["short"] == anc, c["short"] == brg
        reg = STYLE["lang_font"].get(c["short"], "SC")
        word = c["word"]; mean = c.get("meaning", "")
        lsw = 2
        fs = int(min(L["word_max"], L["hero_w"] * 0.97 / max(1, (tw(word, "Black", reg, 100) + lsw * len(word)) / 100)))
        if fs < 76: warns.append(f"{c['file']}.word 太长，大标题只有 {fs}px")
        parts = [dict(p) for p in c.get("parts", [])]
        segs = segs_of(word, parts) if parts else None
        if parts and segs is None: warns.append(f"{c['file']}.parts 拼起来和 word 对不上（空格除外），不显示拆字"); parts = []
        show_parts = bool(parts) and any(p.get("m") and p["m"] != p["t"] for p in parts)
        pm_fs = 0
        if show_parts:  # 每段下面写它的意思；挤不下就退回到一整行「字面」
            for cand in (48, 42, 36):
                x, cs = 0.0, []
                for sg in segs:
                    w = tw(sg["t"], "Black", reg, fs) + lsw * len(sg["t"])
                    if sg["p"] >= 0 and parts[sg["p"]].get("m"): cs.append((x + w / 2, tw(parts[sg["p"]]["m"], "Bold", "SC", cand)))
                    x += w
                ok = all(b[0] - a[0] >= (a[1] + b[1]) / 2 + 18 for a, b in zip(cs, cs[1:])) and (not cs or (cs[0][0] - cs[0][1] / 2 > -4 and cs[-1][0] + cs[-1][1] / 2 < L["hero_w"] + 20))
                if ok: pm_fs = cand; break
            if not pm_fs: show_parts = False; warns.append(f"{c['file']}: 拆字的意思写不下，退回「字面」一行")
        if not mean and parts and not show_parts: mean = " + ".join(p["m"] for p in parts if p.get("m"))
        links = []
        for k, p in enumerate(parts):
            if p.get("link"):
                prev = seen.get(p["link"], [])
                if prev: links.append({"p": k, "t": p["t"], "prev": [{"short": s_, "t": t_} for s_, t_ in prev[:2]]})
        k_scale = 1.0
        if links:  # 每个关联一行：「又见面了」+ 这一段 ＝ 前面语言里的那一段
            rows_ = [tw(l_["t"] + " ＝ " + " ＝ ".join(q["t"] + " " + q["short"] for q in l_["prev"]), "Black", reg, 44) for l_ in links]
            k_scale = min(1.0, (L["hero_w"] - 30) / max(1, max(rows_) + tw(STYLE["text"]["link"], "Black", "SC", 34) + 70))
        for p in parts:
            if p.get("link"): seen.setdefault(p["link"], []).append((c["short"], p["t"]))
        # 竖向排布：语言章(上方 96) → 大字 → 拆字意思 → 读音 → 「字面」（没拆字时）→ 「又见面了」
        yW = PB - 10; y = yW + fs * 1.2
        yP = y + 4 if show_parts else None; y += 58 if show_parts else 0
        yR = y + 6 if c.get("reading") else None; y += 64 if c.get("reading") else 0
        yM = y + 8 if (mean and not show_parts) else None; y += L["meaning_h"] + 8 if yM else 0
        yK = y + 10 if links else None; y += (62 * len(links) + 16) if links else 0
        cz = y + 34
        shmax = int(min(L["shift_max"], yW - 96 - 330))
        def fit_step(lift, tag, chip=False, extra=0):
            """内容面板放在名字下方；放不下就把上面整块（照片+名字）往上推，但语言章不进 HUD。"""
            top0 = cz + (70 if chip else 0)
            h = (lift["h"] + 2 * PAD) if lift else -34
            need = top0 + h + extra - L["content_bottom"]
            sh = int(min(shmax, need if need > 0 else min(0, max(-L["drop_max"], need + L["drop_keep"]))))
            if not lift: sh = int(max(-L["word_drop_max"], min(0, cz - L["word_bottom"])))  # 只有名字时：整块放低，照片露得多，下方不空
            if lift:
                place_left(lift, top0 - sh); lift["bg"] = STYLE["colors"]["card"]
                bake(lift, c["file"], tag); bake_ink(lift, c["file"])
            if need > shmax: warns.append(f"{tag}: 内容太高，推到顶也放不下 {need - shmax:.0f}px（框少一点）")
            return sh
        hmax_all = L["content_bottom"] - (cz - shmax) - 2 * PAD
        steps, t = [], 0
        sub = None
        if c.get("name"):  # 可选：名字区里的别称/表记等，原图切片
            nboxes = c["name"] if isinstance(c["name"][0], list) else [c["name"]]
            ex = snap(mk, to_px(c["title"], W_, H_, f"{c['file']}.title"), f"{c['file']}.title") if c.get("title") else None
            ps = []
            for k, bx in enumerate(nboxes):
                pb = to_px(bx, W_, H_, f"{c['file']}.name[{k}]")
                p_ = layout_lift(mk, snap(mk, pb, f"{c['file']}.name[{k}]"), f"{c['file']}.name[{k}]", mode="name", exclude=ex,
                                 wmax=INW, hmax=hmax_all / len(nboxes), target=L["sub_text_px"])
                if p_: ps.append(p_)
            sub = stack(ps) if ps else None
        sh0 = fit_step(None, f"L{li}_word")
        hold = STYLE["name_hold_bridge"] if is_b else STYLE["name_hold_anchor"] if is_a else STYLE["name_hold"]
        nd = beats(hold[0] + (0.6 if links and not is_a else 0), *hold)
        steps.append({"kind": "word", "label": c["lang"], "start": t, "dur": B(nd), "lift": None, "shift": sh0})
        ev(f + t, "reveal" if is_a else "thump"); t += B(nd)
        if sub:
            sh = fit_step(sub, f"L{li}_name")
            d = beats(0.9 + sub["units"] / RATE, *STYLE["focus_hold_other"])
            steps.append({"kind": "name", "label": c["lang"], "start": t, "dur": B(d), "lift": sub, "shift": sh}); ev(f + t, "pop"); t += B(d)
        nfo = c.get("max_focus", 0 if is_b else 2 if is_a else 1)
        fos = c.get("focus", [])[:nfo]
        for k, fo in enumerate(fos):
            if fo.get("kind") not in KIND_LABEL: errors.append(f"{c['file']}.focus[{k}].kind 只能是 {list(KIND_LABEL)}"); continue
            note = fo.get("note", "")
            if len(note) > 26: errors.append(f"{c['file']}.focus[{k}].note 不超过 26 个字"); note = note[:26]
            pb = to_px(fo["box"], W_, H_, f"{c['file']}.focus[{k}]")
            fl = layout_lift(mk, snap(mk, pb, f"{c['file']}.focus[{k}]"), f"{c['file']}.focus[{k}]", wmax=INW, hmax=hmax_all - (70 if fo.get("label") else 0) - (120 if note else 0),
                             join=fo.get("reflow", True))
            sh = fit_step(fl, f"L{li}_f{k}", chip=bool(fo.get("label")), extra=120 if note else 0)
            cap = STYLE["focus_hold"] if is_a else STYLE["focus_hold_other"]
            need_s = 0.9 + fl["units"] / RATE + (1.0 if note else 0)
            sec = fo.get("hold") or need_s
            if need_s > cap[1] * (1.4 if fo["kind"] == "example" else 1.12) and not fo.get("hold"):
                warns.append(f"{c['file']}.focus[{k}]: 约 {fl['units']:.0f} 字，需 {need_s:.1f}s 才读得完，只给 {cap[1]}s → 框少一点")
            d = beats(sec, *cap)
            steps.append({"kind": fo["kind"], "label": KIND_LABEL[fo["kind"]], "chip": bool(fo.get("label")), "start": t, "dur": B(d), "lift": fl, "shift": sh, "note": note})
            ev(f + t, "pop"); t += B(d)
        if is_a and ep.get("recall", True):  # 讲完主讲语言：先遮住名字考一次，再揭开（间隔重复）
            d = STYLE["recall_beats"]
            steps.append({"kind": "recall", "label": "", "start": t, "dur": B(d), "lift": None, "shift": sh0, "t_reveal": B(d * 0.55)})
            ev(f + t, "tick"); ev(f + t + B(d * 0.55), "reveal"); t += B(d)
        scenes.append({"type": "lang", "start": f, "dur": t, "card": c["file"], "size": [W_, H_], "lang": c["lang"], "short": c["short"],
                       "index": li, "anchor": is_a, "bridge": is_b, "steps": steps, "photo": to_px(c["photo"], W_, H_, "photo"),
                       "subject": to_px(c.get("subject", c["photo"]), W_, H_, "subject"), "meaning": mean,
                       "word": {"text": word, "fs": fs, "family": f"Noto Serif CJK {reg}", "segs": segs or [{"t": word, "p": -1}], "parts": parts, "show": show_parts, "pm_fs": pm_fs},
                       "reading": c.get("reading", ""), "links": links, "k_scale": k_scale,
                       "y": {"W": yW, "P": yP, "R": yR, "M": yM, "K": yK, "cz": cz}, "hero_x": L["hero_x"], "photo_band": PB})
        if li > 0: ev(f - L["transition"] // 2, "whoosh")
        f += t

    # ---- 复盘：一开始就排满整页；在 ≥2 种语言里出现的同一词根在 insight 时一起亮起 ----
    ls_ = [s for s in scenes if s["type"] == "lang"]; n = len(ls_)
    gap = 24; top, bot = L["recap_top"], L["recap_bottom"]
    rowh = min(250, (bot - top - gap * (n - 1)) / n)
    hl = set(ep.get("insight_langs", []))
    cnt = {}
    for s in ls_:
        for p in s["word"]["parts"]:
            if p.get("link"): cnt[p["link"]] = cnt.get(p["link"], 0) + 1
    items, y = [], top
    for k, s in enumerate(ls_):
        wd = s["word"]; reg = wd["family"].split()[-1]
        rfs = int(min(rowh * (0.42 if s["meaning"] else 0.52), 640 / max(1, (tw(wd["text"], "Black", reg, 100) + 2 * len(wd["text"])) / 100)))
        ofs = int(min(60, 600 / max(1, tw(wd["text"], "Black", reg, 100) / 100)))
        il = ep.get("insight_links")
        hlp = [i for i, p in enumerate(wd["parts"]) if p.get("link") and (p["link"] in il if il else cnt.get(p["link"], 0) >= 2)]
        items.append({"word": wd, "fs": rfs, "ofs": ofs, "ow": tw(wd["text"], "Black", reg, ofs) + 2 * len(wd["text"]), "short": s["short"], "lang": s["lang"], "anchor": s["anchor"],
                      "meaning": s["meaning"] or " + ".join(p["m"] for p in wd["parts"] if p.get("m")), "row": [y, rowh], "hl": s["short"] in hl, "hlp": hlp})
        y += rowh + gap
    ins = ep.get("insight", "")
    rd = STYLE["recap_beats"] if ins else STYLE["recap_beats"] - 2
    scenes.append({"type": "recap", "start": f, "dur": B(rd), "items": items, "beat": B(1), "head": STYLE["text"]["recap"].format(n=n),
                   "insight": ins, "t_insight": B(2.5), "y_insight": y + 10})
    ev(f - L["transition"] // 2, "whoosh")
    for k in range(n): ev(f + 4 + 5 * k, "pop")
    if ins: ev(f + B(2.5), "reveal")
    f += B(rd)

    # ---- 结尾：遮住全部名字 → 打字「评论区打出来」→ 最后一拍揭开答案（看完的人有闭环） ----
    c, im, mk = outro[0]; W_, H_ = im.size; od = STYLE["outro_beats"]
    scenes.append({"type": "outro", "start": f, "dur": B(od), "card": c["file"], "size": [W_, H_],
                   "photo": to_px(c["photo"], W_, H_, "outro.photo"), "subject": to_px(c.get("subject", c["photo"]), W_, H_, "outro.subject"),
                   "lines": STYLE["text"]["outro"], "comment": STYLE["text"]["comment"], "tagline": STYLE["text"]["tagline"], "beat": B(1), "items": items,
                   "t_reveal": B(od) - B(1.6)})
    ev(f - L["transition"] // 2, "whoosh"); ev(f + B(0.6), "thump"); ev(f + B(1.4), "thump"); ev(f + B(3), "type"); ev(f + B(od) - B(1.6), "reveal")
    f += B(od)

    hud_dots = True
    if fmt != "reveal":
        scenes, events, f, hud_dots = reformat(fmt, ep, epdir, scenes, B, L["transition"], events)
        if errors: finish(build, None, inputs); return
        ls_ = [s for s in scenes if s["type"] in ("lang", "flash", "b_lang")]  # 顶栏语言圆点
    # ---- 安全区：y>1000 时右侧按钮列（x>966）不放内容；底部 y>1600 是文案区 ----
    for sc in scenes:
        if sc["type"].startswith("b_"): continue  # 图鉴式自己排版、自己检查（book_layout）
        lifts = [("hook", sc["lift"])] if sc["type"] == "hook" else [(f"{sc.get('short','')}.{st['kind']}", st["lift"]) for st in sc.get("steps", []) if st.get("lift")]
        for nm, lf in lifts:
            x, y, w, h = lf["panel"]
            if (x + w > 970 and y + h > 1000) or y + h > 1600 or y < 300: warns.append(f"{nm}: 面板 {[round(v) for v in lf['panel']]} 超出安全区")
            if lf.get("text_px", 99) < 36: warns.append(f"{nm}: 正文只有 {lf['text_px']:.0f}px，手机上偏小（框少一点内容）")
    plan = {"episode": ep["id"], "object": ep.get("object", ""), "series": ep["series"], "fps": FPS, "width": CW, "height": CH,
            "bpm": STYLE["bpm"], "beat_frames": B(1), "frames": f, "style": STYLE, "transition": L["transition"],
            "langs": [{"short": s["short"], "lang": s["lang"], "start": s["start"], "dur": s["dur"]} for s in ls_],
            "scenes": scenes, "events": events, "inputs": inputs, "format": fmt, "hud_dots": hud_dots,
            "drums_from": 0.0 if fmt == "flash" else None}
    finish(build, plan, inputs)
    qc_lifts(build, plan)

# ---------------- 图鉴式（book）：信息量和讲解式一样，排成一本博物图鉴 ----------------
BK = {"top": 330, "plate_h": 300, "lim": 1580, "x0": 64, "clip_x": 104, "clip_w": 860, "label_h": 60, "gap": 26, "fold_h": 64, "note_h": 64, "flip_t": 16}  # flip_t：翻一页用 16 帧（0.53 秒）

def book_layout(s):
    """一个语言词条页：每一步（名字 / 每块重点 / 回忆）各算一套位置。
    规则：内容放不下时，① 先收起标本照片，② 再把前面读过的剪报折成一行标签，③ 最后才把当前剪报缩小（最小 0.62）。"""
    w = s["word"]; fs = w["fs"]
    T = BK["top"]
    hy = {"head": T}
    y = T + 84
    hy["plate"] = y; y += BK["plate_h"] + 36
    hy["word"] = y; y += fs * 1.22
    if s["reading"]: hy["reading"] = y + 2; y += 62
    etym = [p for p in w["parts"] if p.get("m")] if w["show"] else []
    if etym: hy["etym"] = y + 12; y += 80
    if s["meaning"]: hy["mean"] = y + (4 if etym else 12); y += 74 if etym else 80
    if s["links"]: hy["links"] = y + 6; y += 12 + 58 * len(s["links"])
    hy["end"] = y
    head_end = y + 30
    # 词源 / 参见 行按实际字宽自动缩字（三段以上的名字，如 coffee＋cup＋sleeve，46px 会出右边）
    reg = w["family"].split()[-1]; W = 820  # 量宽和实际排字有约 8% 误差，留余量
    def ew(f):
        return 118 + sum(tw(p["t"], "Black", reg, f) + (tw("〈" + p["m"] + "〉", "Black", "SC", f * 0.78) if p.get("m") else 0) for p in w["parts"]) + (len(w["parts"]) - 1) * (tw("＋", "Black", "SC", f) + 20)
    efs = 46
    while etym and efs > 32 and ew(efs) > W: efs -= 2
    if etym and ew(efs) > W: warns.append(f"图鉴式 {s['short']}: 词源一行放不下（{ew(efs):.0f}px）")
    def lw(f):
        return max([118 + tw(l["t"], "Black", reg, f) + sum(tw("＝", "Black", "SC", f) + tw(q["t"], "Black", reg, f) + 50 + 36 for q in l["prev"]) for l in s["links"]] or [0])
    lfs = 42
    while lfs > 32 and lw(lfs) > W: lfs -= 2
    if lw(lfs) > W: warns.append(f"图鉴式 {s['short']}: 参见一行放不下（{lw(lfs):.0f}px）")
    clips = []
    for st in s["steps"]:
        if st.get("lift"):
            pw, ph = st["lift"]["panel"][2], st["lift"]["panel"][3]
            k = min(1.0, BK["clip_w"] / pw)
            clips.append({"k": k, "h": ph, "note": bool(st.get("note")), "px": st["lift"].get("text_px", 50), "nm": st["kind"]})
    def blk(c, k=None, fold=False):
        if fold: return BK["fold_h"] + 14
        return BK["label_h"] + c["h"] * (k or c["k"]) + (BK["note_h"] if c["note"] else 0) + BK["gap"]
    lays, ci = [], -1
    for st in s["steps"]:
        if st.get("lift"): ci += 1
        vis = list(range(ci + 1))
        plate, fold, kk = True, set(), {i: clips[i]["k"] for i in vis}
        def bottom():
            return head_end - (0 if plate else BK["plate_h"] + 36) + sum(blk(clips[i], kk[i], i in fold) for i in vis)
        if st["kind"] == "recall":  # 回忆：剪报全部折起（里面有答案），便利贴盖住整条词条，照片放回来当提示
            fold = set(vis)
        if bottom() > BK["lim"]: plate = False
        for i in vis[:-1]:
            if bottom() <= BK["lim"]: break
            fold.add(i)
        if vis and bottom() > BK["lim"] and st["kind"] != "recall":
            i = vis[-1]; over = bottom() - BK["lim"]
            kk[i] = max(0.62, kk[i] - over / clips[i]["h"])
            if bottom() > BK["lim"]: warns.append(f"图鉴式 {s['short']}.{st['kind']}: 重点块太高，缩到 {kk[i]:.2f} 倍仍放不下（框少一点）")
        if vis and kk[vis[-1]] * clips[vis[-1]]["px"] < 34:
            warns.append(f"图鉴式 {s['short']}.{st['kind']}: 剪报缩小后正文只有 {kk[vis[-1]] * clips[vis[-1]]['px']:.0f}px（框少一点）")
        up = 0 if plate else BK["plate_h"] + 36
        # 页面下方有空：把标本照片放大（最多再高 300），词条和剪报整体下移，不让下半屏空着
        dy = int(min(300, max(0, BK["lim"] - bottom() - 40))) if plate else 0
        yy = head_end - up + dy
        cl = []
        for i in range(len(clips)):
            if i in vis:
                cl.append({"y": round(yy), "k": round(kk[i], 4), "fold": i in fold}); yy += blk(clips[i], kk[i], i in fold)
            else:
                cl.append({"y": round(yy + 80), "k": clips[i]["k"], "fold": False})
        lays.append({"plate": plate, "up": up - dy, "ex": dy, "clips": cl})
    return {"y": {k: round(v) for k, v in hy.items()}, "lays": lays, "etym": etym, "efs": efs, "lfs": lfs}

def book(ep, scenes, B, events0):
    out = []
    langs = [s for s in scenes if s["type"] == "lang"]
    n = len(langs)
    for sc in scenes:
        t = sc["type"]
        if t == "hook":
            out.append(dict(sc, type="b_hook", flip=True, flipT=BK["flip_t"], n=n))
        elif t == "lang":
            out.append(dict(sc, type="b_lang", flip=True, flipT=BK["flip_t"], book=book_layout(sc), n=n, no=sc["index"] + 1))
        elif t == "recap":
            its = []
            for it in sc["items"]:
                reg = it["word"]["family"].split()[-1]
                its.append(dict(it, bfs=int(min(84, 560 / max(1, (tw(it["word"]["text"], "Black", reg, 100) + 2 * len(it["word"]["text"])) / 100)))))
            step = int(min(200, 900 / max(1, n)))
            ins = sc["insight"] or ""
            ifs = int(max(44, min(60, 820 / max(1, (tw(ins, "Black", "SC", 100) + 32) / 100))))
            out.append(dict(sc, type="b_recap", flip=True, flipT=BK["flip_t"], items=its, step=step, ifs=ifs))
        elif t == "outro":
            its = []
            for it in sc["items"]:  # 记忆卡：名字右边要给 ✓ 章留位置（名字区宽 500）
                reg = it["word"]["family"].split()[-1]
                its.append(dict(it, bofs=int(min(60, 500 / max(1, (tw(it["word"]["text"], "Black", reg, 100) + 2 * len(it["word"]["text"])) / 100)))))
            out.append(dict(sc, type="b_outro", flip=True, flipT=BK["flip_t"], items=its))
    return out

def reformat(fmt, ep, epdir, scenes, B, TR, events0=None):
    """在「讲解式」算好的场景（名字排版、切片、复盘行）基础上，重新编排成别的版式。不新增任何卡片外的知识。"""
    TX = STYLE["text"]
    hook = scenes[0]; langs = [s for s in scenes if s["type"] == "lang"]
    recap = next(s for s in scenes if s["type"] == "recap"); outro = next(s for s in scenes if s["type"] == "outro")
    A = next(s for s in langs if s["anchor"]); Bg = next((s for s in langs if s["bridge"]), None)
    out, evs, f = [], [], 0
    def ev(t, k, **kw): evs.append({"f": int(t), "kind": k, **kw})
    def put(sc, d):
        nonlocal f
        sc = dict(sc); sc["start"] = f; sc["dur"] = d; out.append(sc); f += d; return sc
    if fmt == "book":
        return book(ep, scenes, B, events0), events0, scenes[-1]["start"] + scenes[-1]["dur"], True
    if fmt == "quiz":
        reg = STYLE["lang_font"].get(A["short"], "SC")
        pool = [p for p in quiz_pool(epdir, ep, A["short"]) if p["text"] != A["word"]["text"]]
        want = ep.get("quiz", {}).get("from")  # 可选：指定干扰项来自哪几期（id）
        if want: pool = [p for p in pool if p["id"] in want]
        if len(pool) < 2:
            errors.append(f"猜选式需要同系列另外至少 2 期做好的 episode.json（有「{A['short']}」的 word）当干扰项，现在只有 {len(pool)} 个"); return out, evs, f, False
        rnd = random.Random(ep["id"] + "/quiz")
        opts = [{"text": A["word"]["text"], "reading": A["reading"], "ok": True, "what": ""}] + \
               [{"text": p["text"], "reading": p["reading"], "ok": False, "what": f'{p["object"]} · {p["id"]}' if p["object"] else p["id"]} for p in rnd.sample(pool, 2)]
        rnd.shuffle(opts)
        for o in opts:
            o["family"] = f"Noto Serif CJK {reg}"
            o["fs"] = int(min(88, 600 / max(1, (tw(o["text"], "Black", reg, 100) + 2 * len(o["text"])) / 100)))
        q1 = f'「{Bg["word"]["text"]}」' if Bg else f'「{ep.get("object", "")}」'
        q2 = TX["quiz_q"].format(lang=A["lang"])
        qfs = int(min(80, *(840 / max(1, (tw(q, "Black", "SC", 100) + 2 * len(q)) / 100) for q in (q1, q2))))  # 问题两行：右边不进按钮区、底部不贴选项
        nb = 10
        put({"type": "quiz", "card": hook["card"], "size": hook["size"], "photo": hook["photo"], "subject": hook["subject"], "q": [q1, q2], "qfs": qfs,
             "options": opts, "beat": B(1), "t_opts": [B(1), B(1.5), B(2)], "t_count": B(3), "t_reveal": B(6), "countText": TX["guess"]}, B(nb))
        ev(0, "start")
        for k in range(3): ev(B(1 + 0.5 * k), "pop")
        for k in range(3): ev(B(3 + k), "tick")
        ev(B(6), "reveal")
        # 讲解：只讲主角语言的名字 + 第一块重点（不再回忆，因为前面已经「猜」过一次）
        st = [dict(x) for x in A["steps"] if x["kind"] != "recall"][:2]
        t = 0
        for x in st: x["start"] = t; t += x["dur"]
        a = put(dict(A, steps=st, index=0), t); ev(a["start"] - TR // 2, "whoosh"); ev(a["start"], "thump")
        for x in st[1:]: ev(a["start"] + x["start"], "pop")
        r = put(recap, recap["dur"]); ev(r["start"] - TR // 2, "whoosh")
        for k in range(len(r["items"])): ev(r["start"] + 4 + 5 * k, "pop")
        if r["insight"]: ev(r["start"] + r["t_insight"], "reveal")
        o = put(dict(outro, lines=TX["quiz_outro"], comment=TX["quiz_comment"]), outro["dur"])
        ev(o["start"] - TR // 2, "whoosh"); ev(o["start"] + B(0.6), "thump"); ev(o["start"] + B(1.4), "thump"); ev(o["start"] + B(3), "type", n=len(TX["quiz_comment"]))
        ev(o["start"] + o["t_reveal"], "reveal")
        return out, evs, f, False
    # ---- 快闪式：每种语言 4 拍，硬切卡点；最后一句跨语言发现 ----
    put({"type": "flash_q", "cut": True, "card": hook["card"], "size": hook["size"], "photo": hook["photo"], "subject": hook["subject"], "lift": hook["lift"], "beat": B(1)}, B(3))
    ev(0, "start")
    for i, s in enumerate(langs):
        w = s["word"]; reg = w["family"].split()[-1]
        ffs = int(min(210, 890 / max(1, (tw(w["text"], "Black", reg, 100) + 2 * len(w["text"])) / 100)))  # 右边不过 964（平台按钮列）
        ms = [p["m"] for p in w["parts"] if p.get("m")] if w["show"] else []
        chips = ms or ([s["meaning"]] if s["meaning"] else [])
        cfs = 56
        while cfs > 36 and sum(tw(m, "Black", "SC", cfs) + cfs * 1.0 + 6 for m in chips) + (len(chips) - 1) * (cfs + 28) > 890: cfs -= 4
        sc = put({"type": "flash", "cut": True, "card": s["card"], "size": s["size"], "photo": s["photo"], "subject": s["subject"], "lang": s["lang"], "short": s["short"],
                  "index": i, "n": len(langs), "word": w, "ffs": ffs, "cfs": cfs, "reading": s["reading"], "parts_m": ms, "meaning": "" if ms else s["meaning"],
                  "anchor": s["anchor"], "beat": B(1)}, B(4))
        ev(sc["start"], "reveal" if s["anchor"] else "thump"); ev(sc["start"] + B(1), "pop")
    its = []
    for it in recap["items"]:
        reg = it["word"]["family"].split()[-1]
        its.append(dict(it, sfs=int(min(80, 720 / max(1, (tw(it["word"]["text"], "Black", reg, 100) + 2 * len(it["word"]["text"])) / 100)))))
    n_ = len(its); step = int(min(128, (600) / max(1, n_)))
    ins = recap["insight"] or ""
    ifs = int(max(44, min(64, 860 / max(1, (tw(ins, "Black", "SC", 100) + 32) / 100))))  # 尽量一行放下；放不下时最小 44px 再换行
    sm = put({"type": "flash_sum", "step": step, "ifs": ifs, "cut": True, "card": outro["card"], "size": outro["size"], "photo": outro["photo"], "subject": outro["subject"],
              "items": its, "insight": recap["insight"], "beat": B(1), "t_insight": B(2.5), "comment": TX["flash_comment"], "tagline": TX["tagline"]}, B(7))
    ev(sm["start"], "thump")
    for k in range(len(sm["items"])): ev(sm["start"] + 3 + 4 * k, "pop")
    if sm["insight"]: ev(sm["start"] + sm["t_insight"], "reveal")
    return out, evs, f, True

def finish(build, plan, inputs):
    rep = {"errors": errors, "warnings": warns}
    json.dump(rep, open(build / "prepare_report.json", "w"), ensure_ascii=False, indent=1)
    for w in warns: print("⚠", w)
    if errors:
        for e in errors: print("✖", e)
        sys.exit(2)
    json.dump(plan, open(build / "plan.json", "w"), ensure_ascii=False, indent=1, default=lambda o: o.item() if hasattr(o, "item") else str(o))
    print(f"✓ plan.json  {plan['frames']} 帧 = {plan['frames']/plan['fps']:.1f}s  场景 {len(plan['scenes'])}")

def qc_lifts(build, plan):
    """把每块面板按成片坐标静态拼出来（用实际要显示的切片），渲染前先看重排对不对。"""
    tiles = []
    for s in plan["scenes"]:
        lifts = []
        if s["type"] in ("hook", "flash_q"): lifts = [("开场", s["lift"])]
        if s["type"] == "lang": lifts = [(f'{s["short"]}·{st["label"]}', st["lift"]) for st in s["steps"] if st.get("lift")]
        for name, lf in lifts:
            cv = Image.new("RGB", (CW, CH), (60, 48, 38)); d = ImageDraw.Draw(cv)
            x, y, w, h = lf["panel"]; d.rectangle([x, y, x + w, y + h], fill=lf["bg"])
            for p in lf["pieces"]:
                pi = Image.open(build / "public" / p["img"]).convert("RGBA"); cv.paste(pi, (int(round(p["dst"][0])), int(round(p["dst"][1]))), pi)
            d.line([(966, 1000), (966, 1600)], fill=(255, 80, 80), width=3); d.line([(0, 1600), (CW, 1600)], fill=(255, 80, 80), width=3)
            if s["type"] == "lang":
                from PIL import ImageFont
                wd = s["word"]; reg = wd["family"].split()[-1]; tw(wd["text"], "Black", reg, wd["fs"])
                sh_ = next(st["shift"] for st in s["steps"] if st["lift"] is lf)
                d.text((s["hero_x"], s["y"]["W"] - sh_), wd["text"], font=_FC[("Black", reg, int(wd["fs"]))], fill=(244, 238, 227))
            d.text((20, 20), f"{name}  zoom {lf['zoom']:.2f}  text {lf['text_px']:.0f}px", fill=(255, 220, 160))
            tiles.append(cv.resize((360, 640)))
    if not tiles: return
    cols = 5; rows = math.ceil(len(tiles) / cols)
    sheet = Image.new("RGB", (360 * cols, 640 * rows), "white")
    for i, t in enumerate(tiles): sheet.paste(t, ((i % cols) * 360, (i // cols) * 640))
    sheet.save(build / "qc" / "lifts.png")

if __name__ == "__main__":
    ap = argparse.ArgumentParser(); ap.add_argument("episode", nargs="?", default=str(ROOT / "episodes/M006"))
    ap.add_argument("--format", choices=FORMATS); ap.add_argument("--name")
    a_ = ap.parse_args()
    main(a_.episode, a_.format, a_.name)
