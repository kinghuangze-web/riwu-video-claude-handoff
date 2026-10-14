"""读 geom.json + 静帧，自动报：越界/安全区、文字互相压住、文字与背景对比度不足、字号过小。
用法：python3 scripts/geomcheck.py build/<名>/geo"""
import json, sys, re
from PIL import Image
d = sys.argv[1]; G = json.load(open(f'{d}/geom.json'))
def rgb(c):
    return tuple(float(x) for x in re.findall(r'[\d.]+', c)[:3])
def lum(c):
    def ch(v):
        v /= 255; return v / 12.92 if v <= .03928 else ((v + .055) / 1.055) ** 2.4
    r, g, b = c; return .2126 * ch(r) + .7152 * ch(g) + .0722 * ch(b)
def cr(a, b):
    a, b = sorted([lum(a), lum(b)]); return (b + .05) / (a + .05)
def core(b):  # 只算字形区：行高留白不算（框高里只有中间约 0.9×字号是字）
    fs = float(b['fs'][:-2]); ins = max(0, (b['h'] - fs) / 2) + fs * 0.05
    return dict(b, y=b['y'] + ins, h=max(1, b['h'] - 2 * ins))
for f, boxes in sorted(G.items(), key=lambda x: int(x[0])):
    if boxes is None: print(f, 'NO GEOM'); continue
    im = Image.open(f'{d}/f{int(f):05d}.png').convert('RGB'); W, H = im.size
    msgs = []
    bx = [b for b in boxes if b['op'] > .5]
    for b in bx:
        x2, y2 = b['x'] + b['w'], b['y'] + b['h']
        fs = float(b['fs'][:-2])
        if b['x'] < 40 or x2 > W - 40 or b['y'] < 0 or y2 > H: msgs.append(f"越界 {b['t']!r} {b['x']},{b['y']},{x2},{y2}")
        elif 1000 < y2 and b['y'] < 1600 and x2 > 964 and fs > 30: msgs.append(f"右侧按钮区 {b['t']!r} x2={x2} y={b['y']}-{y2}")
        elif y2 > 1600 and fs > 30: msgs.append(f"底部区 {b['t']!r} y2={y2}")
        if fs < 30 and not re.match(r'^M\.\d+$', b['t']): msgs.append(f"字小 {b['t']!r} {fs:.0f}px")
        # 对比度：框内像素里和文字颜色差得远的算「底」，取最不利的 1/4 分位
        tc = rgb(b['c']); x0, y0 = max(0, b['x']), max(0, b['y']); x1, y1 = min(W, x2), min(H, y2)
        if x1 - x0 > 2 and y1 - y0 > 2:
            px = list(im.crop((x0, y0, x1, y1)).resize((min(80, x1 - x0), min(40, y1 - y0))).getdata())
            bg = [p for p in px if sum(abs(p[i] - tc[i]) for i in range(3)) > 120]
            if len(bg) > 10:
                bg.sort(key=lum); worst = bg[int(len(bg) * .25)] if lum(tc) < .5 else bg[int(len(bg) * .75)]
                c = cr(tc, worst)
                if c < 3: msgs.append(f"对比度低 {b['t']!r} {c:.1f}")
    cb = [core(b) for b in bx]
    for i, a in enumerate(cb):
        for b in cb[i + 1:]:
            if a['t'] == b['t'] or '?' in (a['t'], b['t']): continue  # 「?」是遮字块，本来就盖在字上
            ox = round(min(a['x'] + a['w'], b['x'] + b['w']) - max(a['x'], b['x']))
            oy = round(min(a['y'] + a['h'], b['y'] + b['h']) - max(a['y'], b['y']))
            if ox > 6 and oy > 6:
                ina = a['x'] <= b['x'] and a['y'] <= b['y'] and a['x'] + a['w'] >= b['x'] + b['w'] and a['y'] + a['h'] >= b['y'] + b['h']
                inb = b['x'] <= a['x'] and b['y'] <= a['y'] and b['x'] + b['w'] >= a['x'] + a['w'] and b['y'] + b['h'] >= a['y'] + a['h']
                if not (ina or inb): msgs.append(f"重叠 {a['t']!r} × {b['t']!r} {ox}x{oy}")  # 一个框包含另一个 = 同一组件的父子，跳过
    print(f, ' | '.join(b['t'][:10] for b in bx))
    for m in msgs: print('   ', m)
