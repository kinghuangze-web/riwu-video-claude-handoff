#!/usr/bin/env python3
"""第 2 步：按 plan.json 的节拍和事件，用代码合成配乐与音效 → public/audio.wav（长度与画面逐帧相等）。
无版权素材、无 API。换成自己的 BGM：python3 scripts/audio.py <build目录> --bgm 你的.mp3"""
import json, sys, subprocess, argparse
from pathlib import Path
import numpy as np

SR = 44100
ap = argparse.ArgumentParser(); ap.add_argument("build"); ap.add_argument("--bgm"); ap.add_argument("--no-sfx", action="store_true")
a = ap.parse_args()
build = Path(a.build); plan = json.load(open(build / "plan.json"))
fps, frames, bpm = plan["fps"], plan["frames"], plan["bpm"]
N = int(round(frames / fps * SR)); beat = 60 / bpm
rng = np.random.default_rng(7)
mix = np.zeros((N, 2))

def add(sig, t, gain=1.0, pan=0.0):
    i = int(t * SR)
    if i >= N or i < 0: return
    s = sig[: N - i] * gain
    mix[i:i + len(s), 0] += s * (1 - pan) ** 0.5 if pan > 0 else s
    mix[i:i + len(s), 1] += s * (1 + pan) ** 0.5 if pan < 0 else s

def env(n, a=0.008, d=1.0):
    t = np.arange(n) / SR
    return np.minimum(1, t / a) * np.exp(-t / d)

def keys(freq, dur=1.6, d=0.9):
    n = int(dur * SR); t = np.arange(n) / SR
    s = sum(w * np.sin(2 * np.pi * freq * h * t + h) for h, w in [(1, 1), (2, 0.35), (3, 0.12), (4.01, 0.05)])
    s += 0.5 * np.sin(2 * np.pi * freq * 1.003 * t)
    return s * env(n, 0.01, d) * 0.12

def bandnoise(n, lo, hi):
    x = rng.normal(0, 1, n); X = np.fft.rfft(x); f = np.fft.rfftfreq(n, 1 / SR)
    X[(f < lo) | (f > hi)] = 0
    y = np.fft.irfft(X, n); return y / (np.abs(y).max() + 1e-9)

def kick():
    n = int(0.3 * SR); t = np.arange(n) / SR
    fr = 50 + 70 * np.exp(-t / 0.04); ph = 2 * np.pi * np.cumsum(fr) / SR
    return np.sin(ph) * np.exp(-t / 0.12) * 0.55

def hat():
    n = int(0.05 * SR); return bandnoise(n, 7000, 14000) * env(n, 0.001, 0.012) * 0.06

def bass(freq, dur):
    n = int(dur * SR); t = np.arange(n) / SR
    return np.tanh(1.6 * np.sin(2 * np.pi * freq * t)) * env(n, 0.01, dur * 0.6) * 0.16

def m2f(m): return 440 * 2 ** ((m - 69) / 12)
prog = [[53, 57, 60, 64], [52, 55, 59, 62], [50, 53, 57, 60], [48, 52, 55, 59]]  # Fmaj7 Em7 Dm7 Cmaj7
roots = [41, 40, 38, 36]
penta = [72, 74, 76, 79, 81, 84]

total_beats = int(N / SR / beat)
hook_end = plan["scenes"][1]["start"] / fps
outro = [s for s in plan["scenes"] if s["type"] == "outro"][0]
outro_t = outro["start"] / fps
if not a.bgm:
    for b in range(total_beats + 1):
        t = b * beat; bar = b // 4; pos = b % 4
        ch = prog[bar % 4]
        last = t > (frames / fps) - beat * 2.2
        if pos == 0:
            for k, m in enumerate(ch): add(keys(m2f(m), 2.6, 1.3), t + k * 0.012, 1.0, (k - 1.5) * 0.25)
            add(bass(m2f(roots[bar % 4]), beat * 1.8), t)
        if pos == 2 and not last:
            for k, m in enumerate(ch[1:]): add(keys(m2f(m + 12), 1.0, 0.45), t + beat * 0.5, 0.55, (k - 1) * 0.3)
            add(bass(m2f(roots[bar % 4] + 7), beat * 1.2), t)
        drums = t >= hook_end * 0.55 and not last
        if drums:
            if pos in (0, 2): add(kick(), t, 0.9)
            for e in (0.5,): add(hat(), t + e * beat, 1.0, 0.3)
            if pos == 3: add(hat(), t + 0.75 * beat, 0.7, -0.3)
        if t > hook_end and not last and rng.random() < 0.25 and b % 2 == 1:
            add(keys(m2f(int(rng.choice(penta))), 0.8, 0.35), t + beat * (0.5 if rng.random() < 0.5 else 0), 0.6, rng.uniform(-0.5, 0.5))
    # 收尾和弦
    end_t = frames / fps - beat * 2
    for k, m in enumerate([48, 55, 60, 64, 67]): add(keys(m2f(m), 3, 1.5), end_t + k * 0.03, 1.1, (k - 2) * 0.2)
    music = mix.copy()
else:
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", a.bgm, "-f", "f32le", "-ac", "2", "-ar", str(SR), "-"], capture_output=True, check=True).stdout
    m = np.frombuffer(raw, dtype=np.float32).reshape(-1, 2).astype(np.float64)
    if len(m) < N: m = np.tile(m, (int(np.ceil(N / len(m))), 1))
    mix += m[:N] * 0.5

# ---- 音效：只在 plan.events 的帧上发声 ----
def whoosh():
    n = int(0.42 * SR); t = np.arange(n) / SR
    x = bandnoise(n, 300, 6000); sweep = np.sin(np.pi * np.minimum(1, t / 0.42)) ** 2
    return x * sweep * 0.16
def thump():
    n = int(0.35 * SR); t = np.arange(n) / SR
    fr = 45 + 80 * np.exp(-t / 0.03); s = np.sin(2 * np.pi * np.cumsum(fr) / SR) * np.exp(-t / 0.14)
    s[:200] += bandnoise(200, 1500, 6000) * 0.4
    return s * 0.5
def pop():
    n = int(0.12 * SR); t = np.arange(n) / SR
    return np.sin(2 * np.pi * (700 + 900 * t / 0.12) * t) * env(n, 0.002, 0.04) * 0.22
def tick():
    n = int(0.06 * SR); return (np.sin(2 * np.pi * 1800 * np.arange(n) / SR) * env(n, 0.001, 0.012)) * 0.25
def reveal():
    # 揭晓：上行三音小铃 + 一点亮噪
    out = np.zeros(int(1.4 * SR))
    for k, m in enumerate([76, 79, 84]):
        n = int(1.1 * SR); t = np.arange(n) / SR; fr = m2f(m)
        s = (np.sin(2 * np.pi * fr * t) + 0.3 * np.sin(2 * np.pi * fr * 2.01 * t)) * env(n, 0.002, 0.35) * 0.16
        i = int(k * 0.06 * SR); out[i:i + n] += s[: len(out) - i]
    out[:int(0.25 * SR)] += bandnoise(int(0.25 * SR), 5000, 12000) * env(int(0.25 * SR), 0.003, 0.06) * 0.05
    return out
def tclick():
    n = int(0.03 * SR); return bandnoise(n, 2000, 8000) * env(n, 0.0005, 0.006) * 0.12
if not a.no_sfx:
    for e in plan["events"]:
        t = e["f"] / fps
        k = e["kind"]
        if k == "whoosh": add(whoosh(), max(0, t - 0.2))
        elif k == "thump": add(thump(), t)
        elif k == "pop": add(pop(), t, 1.0, 0.1)
        elif k == "tick": add(tick(), t)
        elif k == "reveal": add(reveal(), t); add(thump(), t, 0.7)
        elif k == "type":
            n = len(outro["comment"])
            for i in range(n): add(tclick(), t + i * 3 / fps, 1.0, rng.uniform(-0.3, 0.3))

fade = int(0.5 * SR); mix[-fade:] *= np.linspace(1, 0, fade)[:, None]
mix /= max(1e-9, np.abs(mix).max() / 0.9)
pub = build / "public"; raw = pub / "audio_raw.wav"
import wave
with wave.open(str(raw), "wb") as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
    w.writeframes((np.clip(mix, -1, 1) * 32767).astype(np.int16).tobytes())
subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(raw), "-af", "loudnorm=I=-16:TP=-1.5:LRA=11", "-ar", str(SR), "-t", f"{N / SR:.6f}", str(pub / "audio.wav")], check=True)
raw.unlink()
plan["audio"] = "audio.wav"; plan["audio_samples"] = N
json.dump(plan, open(build / "plan.json", "w"), ensure_ascii=False, indent=1)
print(f"✓ audio.wav {N / SR:.3f}s（画面 {frames / fps:.3f}s）")
