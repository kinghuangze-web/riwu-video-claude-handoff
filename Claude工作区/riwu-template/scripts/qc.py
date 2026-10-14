#!/usr/bin/env python3
"""第 4 步：只检查最终编码出来的 MP4（不是预览），结果写 build/<期>/qc/report.md。任何 ✖ 都算不合格。"""
import json, sys, subprocess, hashlib
from pathlib import Path
import numpy as np
from PIL import Image

ep, mp4 = Path(sys.argv[1]), Path(sys.argv[2])
build = Path("build") / (sys.argv[3] if len(sys.argv) > 3 else ep.name); qc = build / "qc"; qc.mkdir(parents=True, exist_ok=True)
plan = json.load(open(build / "plan.json"))
R = []  # (ok, 项, 说明)
def chk(ok, item, msg): R.append(("✓" if ok is True else ("⚠" if ok is None else "✖"), item, msg))
def run(cmd): return subprocess.run(cmd, capture_output=True, text=True)

# 1 原图未改动
for i in plan["inputs"]:
    h = hashlib.sha256(open(i["file"], "rb").read()).hexdigest()
    chk(h == i["sha256"], "原图未改动", f'{Path(i["file"]).name} sha256 {h[:12]}…')
# 2 流信息
pr = json.loads(run(["ffprobe", "-v", "error", "-count_frames", "-show_streams", "-show_format", "-of", "json", str(mp4)]).stdout)
vs = [s for s in pr["streams"] if s["codec_type"] == "video"]; as_ = [s for s in pr["streams"] if s["codec_type"] == "audio"]
v = vs[0]
chk(v["codec_name"] == "h264" and v["pix_fmt"] == "yuv420p", "视频编码", f'{v["codec_name"]} {v["pix_fmt"]} {v["width"]}×{v["height"]} {v["r_frame_rate"]}')
chk(int(v["width"]) == plan["width"] and int(v["height"]) == plan["height"], "画幅", f'{v["width"]}×{v["height"]}')
nf = int(v.get("nb_read_frames", 0))
chk(nf == plan["frames"], "帧数", f'实际 {nf} / 计划 {plan["frames"]}')
chk(len(as_) == 1, "音轨", f'{len(as_)} 条 ' + (f'{as_[0]["codec_name"]} {as_[0]["sample_rate"]}Hz' if as_ else ''))
vd = float(v["duration"]); ad = float(as_[0]["duration"]) if as_ else 0
chk(abs(vd - ad) < 0.1, "音画等长", f'视频 {vd:.3f}s / 音频 {ad:.3f}s（差 {abs(vd-ad)*1000:.0f}ms）')
# 3 全文件解码
d = run(["ffmpeg", "-v", "error", "-i", str(mp4), "-f", "null", "-"])
chk(d.returncode == 0 and not d.stderr.strip(), "整片解码", "无错误" if not d.stderr.strip() else d.stderr[:300])
# 4 抽帧：2fps 拼图 + 空画面检查 + 末帧
fr = qc / "frames"; fr.mkdir(exist_ok=True)
for p in fr.glob("*.jpg"): p.unlink()
run(["ffmpeg", "-v", "error", "-i", str(mp4), "-vf", "fps=2,scale=270:480", str(fr / "%04d.jpg")])
imgs = sorted(fr.glob("*.jpg"))
blank = [i for i, p in enumerate(imgs) if np.asarray(Image.open(p).convert("L")).std() < 8]
chk(not blank, "空画面", "无" if not blank else f"疑似空画面 @ {[b/2 for b in blank]}s")
cols = 12; rows = (len(imgs) + cols - 1) // cols
sheet = Image.new("RGB", (cols * 270, rows * 480), (30, 30, 30))
for i, p in enumerate(imgs): sheet.paste(Image.open(p), ((i % cols) * 270, (i // cols) * 480))
sheet.save(qc / "contact_2fps.jpg", quality=80)
last = qc / "last_frame.png"
run(["ffmpeg", "-v", "error", "-y", "-sseof", "-0.5", "-i", str(mp4), "-update", "1", str(last)])
la = np.asarray(Image.open(last).convert("L"))
chk(bool(la.std() > 20), "片尾", f"末帧有内容（亮度标准差 {la.std():.0f}）")
# 5 音频：无意外静音
raw = subprocess.run(["ffmpeg", "-v", "error", "-i", str(mp4), "-ac", "1", "-ar", "8000", "-f", "s16le", "-"], capture_output=True).stdout
a = np.frombuffer(raw, dtype=np.int16).astype(float) / 32768
win = 4000; rms = [np.sqrt(np.mean(a[i:i + win] ** 2)) for i in range(0, len(a) - win, win)]
quiet = [i / 2 for i, r in enumerate(rms[:-2]) if r < 0.003]
chk(not quiet, "音频连续", "全片有声" if not quiet else f"静音段 @ {quiet}s")
lu = run(["ffmpeg", "-v", "info", "-i", str(mp4), "-af", "ebur128=peak=true", "-f", "null", "-"]).stderr
I = [l for l in lu.splitlines() if l.strip().startswith("I:")]
chk(True, "响度", I[-1].strip() if I else "未测到")
# 6 可读性：抬出面板的正文字高
for s in plan["scenes"]:
    steps = s.get("steps", []) + ([{"label": "开场问题", "lift": s["lift"]}] if s["type"] == "hook" else [])
    for st in steps:
        if not st.get("lift"): continue
        px = st["lift"]["text_px"]
        chk(True if px >= 30 else (None if px >= 24 else False), "字高", f'{s.get("lang", "开场")}·{st["label"]}：正文约 {px:.0f}px（1080 宽画面）')
rep = build / "prepare_report.json"
for w in json.load(open(rep))["warnings"]: chk(None, "预处理警告", w)
# 7 关键帧（每个讲解步骤的停留中点）
kf = []
for s in plan["scenes"]:
    if s["type"] == "lang": kf += [s["start"] + st["start"] + st["dur"] * 0.6 for st in s["steps"]]
    else: kf.append(s["start"] + s["dur"] * 0.75)
kd = qc / "key"; kd.mkdir(exist_ok=True)
tiles = []
for i, f0 in enumerate(kf):
    p = kd / f"k{i:02d}.jpg"
    run(["ffmpeg", "-v", "error", "-y", "-ss", f"{f0 / plan['fps']:.3f}", "-i", str(mp4), "-frames:v", "1", "-vf", "scale=432:768", str(p)])
    tiles.append(Image.open(p))
cols = 6; rows = (len(tiles) + cols - 1) // cols
ks = Image.new("RGB", (cols * 432, rows * 768), (30, 30, 30))
for i, t in enumerate(tiles): ks.paste(t, ((i % cols) * 432, (i // cols) * 768))
ks.save(qc / "keyframes.jpg", quality=85)

bad = [r for r in R if r[0] == "✖"]
md = [f"# 自检报告 · {plan['episode']}", "", f"成片：`{mp4}`  sha256 `{hashlib.sha256(open(mp4,'rb').read()).hexdigest()}`",
      f"时长 {vd:.2f}s · {plan['frames']} 帧 · {plan['fps']}fps · {plan['width']}×{plan['height']}", "",
      "| 结果 | 项 | 说明 |", "|---|---|---|"] + [f"| {a} | {b} | {c} |" for a, b, c in R] + ["",
      "未自动验证：语言/事实正确性（以原图为准，未校对）、观感与节奏（需人看 qc/keyframes.jpg 与成片）。",
      f"结论：{'✖ 不合格' if bad else '✓ 自动检查通过'}"]
open(qc / "report.md", "w").write("\n".join(md))
print("\n".join(md))
sys.exit(1 if bad else 0)
