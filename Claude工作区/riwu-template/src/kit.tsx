// 通用小部件：照片铺满、抬出面板、强调效果。只读 plan 里的坐标，不含任何每期内容。
import React from 'react';
import {Img, interpolate, spring, staticFile, Easing} from 'remotion';
import type {Lift, Rect} from './types';

export const FPS = 30;
export const SERIF = 'Noto Serif CJK SC';
export const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v));
export const ease = Easing.bezier(0.2, 0.9, 0.1, 1);
export const inOut = Easing.bezier(0.65, 0, 0.35, 1);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const sp = (f: number, cfg: any = {}) => spring({frame: f, fps: FPS, config: {damping: 14, stiffness: 170, mass: 0.7, ...cfg}});
export const ramp = (f: number, a: number, b: number, e = ease) => interpolate(f, [a, b], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: e});
export const cardUrl = (file: string) => staticFile('cards/' + file);

// 纸张底
export const Paper: React.FC = () => <Img src={staticFile('paper.png')} style={{position: 'absolute', inset: 0, width: 1080, height: 1920}} />;

// 卡片上的照片铺满一个框：cover + 焦点 + 推近（不露边）
// win：照片在屏幕上真正露出来的那段（box 内的 y1,y2，避开 HUD 和下方面板）。给了 win 就把主体放进这段的中间，
// 主体太小会适当放大（最多 zfit 倍），保证「被讲的那个小东西」不被 HUD 盖住、不被推出画面。
export const Cover: React.FC<{file: string; size: [number, number]; crop: number[]; box: Rect; focus: number[]; z: number; win?: [number, number]; zfit?: number; style?: React.CSSProperties; imgStyle?: React.CSSProperties}> = ({file, size, crop, box, focus, z, win, zfit = 1.8, style, imgStyle}) => {
  const [cx1, cy1, cx2, cy2] = crop;
  const cw = cx2 - cx1, ch = cy2 - cy1;
  const base = Math.max(box[2] / cw, box[3] / ch);
  let s = base * z;
  const fx = (focus[0] + focus[2]) / 2, fy = (focus[1] + focus[3]) / 2;
  let cyT = box[3] / 2;
  if (win) {
    const wh = Math.max(120, win[1] - win[0]);
    const want = Math.min(box[2] * 0.92 / Math.max(1, focus[2] - focus[0]), wh * 0.92 / Math.max(1, focus[3] - focus[1]));
    s = Math.max(base, Math.min(want, base * zfit)) * z;
    cyT = (win[0] + win[1]) / 2;
  }
  let ox = box[2] / 2 - fx * s, oy = cyT - fy * s;
  ox = Math.min(-cx1 * s, Math.max(box[2] - cx2 * s, ox));
  // 主体贴着照片上沿（上面是卡片页眉、不能露）时：允许照片整体下移到 win 顶附近，上方用同图模糊垫底并柔化接缝
  const topLim = -cy1 * s + (win ? Math.max(0, win[0] - 20) : 0);
  oy = Math.min(topLim, Math.max(box[3] - cy2 * s, oy));
  const gap = oy + cy1 * s;  // 照片上沿在 box 里的位置（>0 说明上方露空）
  const img = {position: 'absolute' as const, left: ox, top: oy, width: size[0] * s, height: size[1] * s, maxWidth: 'none'};
  return (
    <div style={{position: 'absolute', left: box[0], top: box[1], width: box[2], height: box[3], overflow: 'hidden', ...style}}>
      {gap > 1 && <Img src={cardUrl(file)} style={{...img, top: -cy1 * s, filter: 'blur(24px) brightness(0.8)', ...imgStyle}} />}
      <Img src={cardUrl(file)} style={{...img, ...imgStyle, ...(gap > 1 ? {WebkitMaskImage: `linear-gradient(to bottom, transparent ${gap - oy}px, black ${gap - oy + 110}px)`, maskImage: `linear-gradient(to bottom, transparent ${gap - oy}px, black ${gap - oy + 110}px)`} : {})}} />
    </div>
  );
};

// 照片区：上方压暗（给 HUD），下方渐隐进纸面（面板落在纸上，不是“框里套框”）
export const PhotoFade: React.FC<{h: number; C: any; top?: number}> = ({h, C, top = 0.38}) => (
  <>
    <div style={{position: 'absolute', left: 0, top: 0, width: 1080, height: 420, background: `linear-gradient(rgba(20,12,6,${top}), rgba(20,12,6,0))`}} />
    <div style={{position: 'absolute', left: 0, top: h - 380, width: 1080, height: 381, background: `linear-gradient(rgba(244,238,227,0), ${C.paper} 92%)`}} />
  </>
);

// 抬出的面板：底色取自卡片本身，文字切片是预先放大锐化好的原图像素。面板和文字一起出现，不会先闪空壳。
export const Panel: React.FC<{lift: Lift; f: number; dur: number; exit?: boolean; tilt?: number; sweep?: boolean; C: any; from?: 'up' | 'down'}> = ({lift, f, dur, exit = true, tilt = 0, sweep = false, C, from = 'down'}) => {
  if (f < 0) return null;
  const p = sp(f, {damping: 13, stiffness: 210});
  const o = exit ? ramp(f, dur - 5, dur + 3) : 0;
  if (o >= 1) return null;
  const [px, py, pw, ph] = lift.panel;
  const dy = (from === 'down' ? 70 : -70) * (1 - p) - 60 * o;
  // 阅读引导：荧光笔按行扫过（总长按宽度分配到停留时间里）
  const pcs = lift.pieces;
  const total = pcs.reduce((m, q) => m + q.dst[2], 0);
  const prog = sweep ? ramp(f, 8, Math.max(12, dur - 16), (x) => x) * total : 0;
  let acc = 0;
  return (
    <div style={{position: 'absolute', inset: 0, opacity: clamp(p * 3) * (1 - o), transform: `translateY(${dy}px) scale(${lerp(0.94, 1, p) - 0.03 * o}) rotate(${tilt * (1 - p)}deg)`,
      transformOrigin: `${px + pw / 2}px ${py + ph / 2}px`}}>
      <div style={{position: 'absolute', left: px, top: py, width: pw, height: ph, background: lift.bg || C.paper, borderRadius: 20,
        boxShadow: '0 26px 60px rgba(40,24,10,0.30), 0 2px 0 rgba(255,255,255,0.6) inset'}} />
      {pcs.map((pc, i) => {
        const fill = sweep ? clamp((prog - acc) / pc.dst[2]) : 0; acc += pc.dst[2];
        const [x, y, w, h] = pc.dst;
        const ink = pc.ink || [0, 1];
        const hx = x + w * ink[0], hw = w * (ink[1] - ink[0]);
        return (
          <React.Fragment key={i}>
            <Img src={staticFile(pc.img)} style={{position: 'absolute', left: x, top: y, width: w, height: h}} />
            {fill > 0 && hw > h * 1.4 && <div style={{position: 'absolute', left: hx - 4, top: y + h * 0.58, width: (hw + 8) * fill, height: h * 0.32, background: C.accent, borderRadius: 6, mixBlendMode: 'multiply', opacity: 0.7}} />}
          </React.Fragment>
        );
      })}
    </div>
  );
};

// 卡片同款「放射短线」，用于强调落点
export const Sparks: React.FC<{x: number; y: number; f: number; r?: number; color: string; n?: number; spread?: number; a0?: number}> = ({x, y, f, r = 70, color, n = 5, spread = 32, a0 = -90}) => {
  const t = ramp(f, 0, 9), o = 1 - ramp(f, 10, 20);
  if (f < 0 || o <= 0) return null;
  return (
    <svg style={{position: 'absolute', left: 0, top: 0, overflow: 'visible'}} width={1} height={1}>
      {Array.from({length: n}).map((_, i) => {
        const a = (a0 + (i - (n - 1) / 2) * spread) * Math.PI / 180;
        const r1 = r * (0.7 + 0.5 * t), r2 = r1 + 26 * (1 - 0.4 * t);
        return <line key={i} x1={x + Math.cos(a) * r1} y1={y + Math.sin(a) * r1} x2={x + Math.cos(a) * r2} y2={y + Math.sin(a) * r2} stroke={color} strokeWidth={6} strokeLinecap="round" opacity={o} />;
      })}
    </svg>
  );
};

export const Chip: React.FC<{text: string; x?: number; right?: number; y: number; f: number; C: any; size?: number; dark?: boolean; rot?: number; light?: boolean}> = ({text, x, right, y, f, C, size = 40, dark, rot = -2, light}) => {
  if (f < 0) return null;
  const p = sp(f, {damping: 10, stiffness: 260});
  const pos: React.CSSProperties = right !== undefined ? {right} : {left: x};
  return (
    <div style={{position: 'absolute', ...pos, top: y, transform: `scale(${lerp(1.6, 1, p)}) rotate(${lerp(rot - 7, rot, p)}deg)`, transformOrigin: right !== undefined ? '100% 50%' : '0% 50%', opacity: clamp(p * 2),
      background: dark ? C.ink : light ? '#FBF7F0' : C.accent, color: dark ? C.paper : C.ink, fontFamily: SERIF, fontWeight: 900, fontSize: size, lineHeight: 1.25, padding: `${size * 0.16}px ${size * 0.5}px`, borderRadius: size, letterSpacing: 3, whiteSpace: 'nowrap',
      boxShadow: '0 10px 24px rgba(20,12,6,0.25)'}}>{text}</div>
  );
};
