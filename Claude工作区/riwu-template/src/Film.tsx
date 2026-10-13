// 日物图鉴 · 多语言物件片 渲染器（原生 9:16 全屏）。只读 plan.json；没有任何每期写死的内容。
import React from 'react';
import {AbsoluteFill, Audio, Img, Sequence, staticFile, useCurrentFrame} from 'remotion';
import {Chip, Cover, Panel, Paper, PhotoFade, SERIF, Sparks, clamp, inOut, lerp, ramp, sp} from './kit';
import type {Plan, Rect} from './types';

const Mountain: React.FC<{C: any; x: number; y: number; s?: number; o?: number}> = ({C, x, y, s = 1, o = 1}) => (
  <svg style={{position: 'absolute', left: x, top: y, opacity: o}} width={260 * s} height={110 * s} viewBox="0 0 260 110">
    <circle cx="170" cy="38" r="26" fill={C.sun} />
    <path d="M0 100 C60 70 110 40 150 62 S220 96 260 92" stroke={C.sub} strokeWidth="2.2" fill="none" />
    <path d="M150 88 C185 74 210 80 255 100" stroke={C.sub} strokeWidth="2" fill="none" />
  </svg>
);

// 顶部小 HUD：避开平台顶栏（y<220）和右侧按钮列（x>964）。只占一行，不再是一整条奶油色横带。
const HUD: React.FC<{plan: Plan; f: number}> = ({plan, f}) => {
  const C = plan.style.colors;
  const langs = plan.langs as any[];
  let act = -1;
  langs.forEach((l, i) => { if (f >= l.start - 4 && f < l.start + l.dur - 4) act = i; });
  const y = 236, d = 66, gap = 12, x2 = 964, x0 = x2 - langs.length * d - (langs.length - 1) * gap;
  return (
    <>
      <div style={{position: 'absolute', left: 64, top: y, height: d, borderRadius: d / 2, background: 'rgba(251,247,240,0.92)', display: 'flex', alignItems: 'center', padding: '0 26px',
        fontFamily: SERIF, fontWeight: 900, fontSize: 36, color: C.ink, letterSpacing: 4, boxShadow: '0 6px 18px rgba(20,12,6,0.18)'}}>
        {plan.series.name}<span style={{fontWeight: 700, fontSize: 28, color: C.sub, marginLeft: 16, letterSpacing: 2}}>{plan.episode}</span>
      </div>
      {langs.map((l, i) => {
        const on = i === act, done = f >= l.start + l.dur - 4;
        const p = on ? sp(f - (l.start - 4), {damping: 10, stiffness: 300}) : 1;
        return <div key={i} style={{position: 'absolute', left: x0 + i * (d + gap), top: y, width: d, height: d, borderRadius: d / 2, boxSizing: 'border-box',
          background: on ? C.ink : done ? C.accent : 'rgba(251,247,240,0.92)', color: on ? C.paper : C.ink, border: on || done ? 'none' : `2px solid ${C.sub}55`,
          display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: SERIF, fontWeight: 900, fontSize: 32, transform: `scale(${on ? lerp(1.35, 1.12, p) : 1})`,
          boxShadow: '0 6px 18px rgba(20,12,6,0.18)'}}>{l.short}</div>;
      })}
      <div style={{position: 'absolute', left: 64, top: y + d + 16, width: x2 - 64, height: 5, borderRadius: 3, background: 'rgba(251,247,240,0.55)'}} />
      <div style={{position: 'absolute', left: 64, top: y + d + 16, width: (x2 - 64) * f / plan.frames, height: 5, borderRadius: 3, background: C.accent2}} />
    </>
  );
};

// 场景外壳：相邻场景重叠 T 帧，新场景从右推入、旧场景同步推出 → 没有空帧
const Shell: React.FC<{T: number; dur: number; first: boolean; last: boolean; children: (t: number) => React.ReactNode}> = ({T, dur, first, last, children}) => {
  const t = useCurrentFrame() - (first ? 0 : T);
  const kin = first ? 1 : ramp(t, -T, 0, inOut);
  const kout = last ? 0 : ramp(t, dur - T, dur, inOut);
  const x = 1080 * (1 - kin) - 1080 * kout;
  return (
    <AbsoluteFill style={{transform: `translateX(${x}px)`, overflow: 'hidden', boxShadow: kin < 1 ? '-30px 0 60px rgba(20,12,6,0.25)' : undefined}}>
      <Paper />
      {children(t)}
    </AbsoluteFill>
  );
};

// ---------- 开场：第 0 帧就有问题 → 纹理特写拉开 → 先猜 3 2 1 ----------
const P0top = (s: any) => s.lift.panel[1];
const Hook: React.FC<{s: any; plan: Plan; t: number}> = ({s, plan, t}) => {
  const C = plan.style.colors, B = s.beat;
  const H = s.photo_h;
  const zOut = ramp(t, s.t_zoom, s.t_zoom + 12);
  // 开场特写倍数随主体大小自适应：小物件推近到 2.2 倍，本身就很大的主体只轻推（避免糊成一团）
  const cw0 = s.photo[2] - s.photo[0], ch0 = s.photo[3] - s.photo[1], base0 = Math.max(1080 / cw0, H / ch0);
  const fitS = Math.min(1080 * 0.9 / (s.subject[2] - s.subject[0]), Math.max(200, P0top(s) - 390) * 0.9 / (s.subject[3] - s.subject[1]));
  const z0 = Math.max(1.15, Math.min(2.2, fitS / base0));
  const z = lerp(z0, 1.04, zOut) + 0.05 * ramp(t, s.t_zoom, s.dur, (x) => x);
  const f2 = [0, 1, 2, 3].map((k) => lerp(s.subject[k], lerp(s.subject[k], s.photo[k], 0.55), zOut));  // 拉开后主体仍在视野中部
  const cnt = t >= s.t_count ? Math.min(2, Math.floor((t - s.t_count) / B)) : -1;
  const cf = (t - s.t_count) - cnt * B;
  const P = s.lift.panel;
  const qs = [[150, 470, -12], [800, 600, 10], [640, 380, 4]];
  const R = 80, cx = 964 - R, cy = P[1] - 36 - R;
  return (
    <>
      <Cover file={s.card} size={s.size} crop={s.photo} box={[0, 0, 1080, H]} focus={f2} z={z} win={[330, P[1] - 60]} zfit={1} />
      <PhotoFade h={H} C={C} />
      {t < s.t_zoom + 8 && qs.map((q, i) => {
        const p = sp(t - 2 - i * 5, {damping: 8, stiffness: 300});
        return <div key={i} style={{position: 'absolute', left: q[0], top: q[1], fontFamily: SERIF, fontWeight: 900, fontSize: 150, color: C.paper, opacity: clamp(p) * (1 - ramp(t, s.t_zoom, s.t_zoom + 8)),
          transform: `scale(${p}) rotate(${q[2]}deg)`, textShadow: '0 8px 30px rgba(0,0,0,0.45)'}}>?</div>;
      })}
      <Panel lift={s.lift} f={t + 30} dur={1e6} exit={false} C={C} />
      {t >= s.t_count && (
        <>
          <Chip text={s.countText} x={P[0] + 6} y={P[1] - 100} f={t - s.t_count} C={C} size={50} dark />
          <svg style={{position: 'absolute', left: cx - R - 10, top: cy - R - 10}} width={2 * R + 20} height={2 * R + 20}>
            <circle cx={R + 10} cy={R + 10} r={R} fill={C.paper} stroke={C.paper2} strokeWidth={8} />
            <circle cx={R + 10} cy={R + 10} r={R} stroke={C.accent2} strokeWidth={10} fill="none" strokeLinecap="round"
              strokeDasharray={2 * Math.PI * R} strokeDashoffset={2 * Math.PI * R * ramp(t, s.t_count, s.dur, (x) => x)} transform={`rotate(-90 ${R + 10} ${R + 10})`} />
          </svg>
          <div style={{position: 'absolute', left: cx - R, top: cy - R, width: 2 * R, height: 2 * R, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: SERIF, fontWeight: 900, fontSize: 100, color: C.ink,
            transform: `scale(${lerp(1.6, 1, sp(cf, {damping: 9, stiffness: 320}))})`}}>{3 - cnt}</div>
        </>
      )}
    </>
  );
};

// 大字名字：原生排字（不再切原图）。拆字时每段下面一条细线 + 这段的意思；hl 里的段（跨语言同一词根）变金色
export const famOf = (f: string) => `"${f}", "Noto Serif CJK SC", "DejaVu Serif", serif`;
const Word: React.FC<{w: any; C: any; fs: number; blur?: number; hl?: number[]; g?: number; parts?: boolean; pmFs?: number; pmO?: number; tint?: boolean}> = ({w, C, fs, blur = 0, hl = [], g = 0, parts = false, pmFs = 40, pmO = 1, tint = false}) => (
  <div style={{whiteSpace: 'nowrap', fontFamily: famOf(w.family), fontWeight: 900, fontSize: fs, lineHeight: 1.2, letterSpacing: 2, color: C.ink}}>
    {w.segs.map((sg: any, i: number) => {
      const on = sg.p >= 0 && hl.includes(sg.p) && g > 0;
      const m = sg.p >= 0 ? (w.parts[sg.p] || {}).m : '';
      return (
        <span key={i} style={{position: 'relative', display: 'inline-block', whiteSpace: 'pre'}}>
          <span style={{filter: blur > 0.3 ? `blur(${blur}px)` : undefined, color: on && tint ? C.accent2 : C.ink,
            background: on ? `linear-gradient(transparent 70%, ${C.accent} 70%, ${C.accent} 94%, transparent 94%)` : undefined, backgroundSize: on ? `${100 * g}% 100%` : undefined, backgroundRepeat: 'no-repeat'}}>{sg.t}</span>
          {parts && m && (
            <>
              <span style={{position: 'absolute', left: '8%', width: '84%', top: '98%', height: 5, borderRadius: 3, background: C.accent2, opacity: 0.55 * pmO}} />
              <span style={{position: 'absolute', left: '50%', top: 'calc(98% + 12px)', transform: 'translateX(-50%)', fontFamily: SERIF, fontWeight: 900, fontSize: pmFs, lineHeight: 1, letterSpacing: 2,
                color: on ? C.accent2 : '#6B5442', whiteSpace: 'nowrap', opacity: pmO}}>{m}</span>
            </>
          )}
        </span>
      );
    })}
  </div>
);

// ---------- 语言页：照片 → 语言章 → 大字名字（拆字/读音/字面一直留在画面上）→ 讲解面板 ----------
// 讲解时上面整块往上推、但名字和读音始终可见；主讲语言最后有「遮住名字考一次」再揭开。
const Lang: React.FC<{s: any; plan: Plan; t: number}> = ({s, plan, t}) => {
  const C = plan.style.colors, TX = plan.style.text;
  const PB = s.photo_band, Y = s.y, hx = s.hero_x;
  let shift = s.steps[0].shift;
  const minShift = Math.min(...s.steps.map((st: any) => st.shift));
  s.steps.forEach((st: any, i: number) => { if (i > 0 && t >= st.start - 3) shift = lerp(s.steps[i - 1].shift, st.shift, ramp(t, st.start - 3, st.start + 9, inOut)); });
  const bump = s.steps.reduce((m: number, st: any) => { const k = t - st.start; return m + (k >= 0 && k < 14 ? Math.sin(Math.PI * k / 14) * 0.02 : 0); }, 0);
  const z = 1.03 + 0.06 * ramp(t, -8, s.dur, (x) => x) + bump;
  const sw = s.subject[2] - s.subject[0], dir = s.index % 2 ? 1 : -1;
  const dx = dir * lerp(-0.1, 0.1, ramp(t, -8, s.dur, (x) => x)) * sw;
  const foc = [s.subject[0] + dx, s.subject[1], s.subject[2] + dx, s.subject[3]];
  const A = s.anchor, Bg = s.bridge, w = s.word;
  const hp = sp(t + 5, {damping: 12, stiffness: 200});
  const mp = sp(t - 6, {damping: 12, stiffness: 220});
  const rp = sp(t - 9, {damping: 14, stiffness: 200});
  const kp = sp(t - 18, {damping: 12, stiffness: 220});
  const at = (k: number | null) => (k == null ? 0 : k - shift);
  // 回忆：遮住 → 停顿 → 揭开
  const rc = s.steps.find((st: any) => st.kind === 'recall');
  const rk = rc ? t - rc.start : -1;
  const inRc = rc && rk >= 0;
  const blur = inRc ? 20 * (ramp(rk, 0, 6) - ramp(rk, rc.t_reveal, rc.t_reveal + 7)) : 0;
  const hidden = inRc && rk < rc.t_reveal + 3;
  const pop = inRc && rk >= rc.t_reveal ? sp(rk - rc.t_reveal, {damping: 9, stiffness: 300}) : 1;
  const hlP = (s.links || []).map((l: any) => l.p);
  const g = ramp(t, 18, 30);
  const tagX = hx + (A ? 54 : 48) * 2 * 1.0 + (A ? 54 : 48) * 1.2 + 30;
  return (
    <>
      <div style={{position: 'absolute', left: 0, top: Math.min(0, -shift), width: 1080, height: PB + 60 + Math.max(0, -shift)}}>
        <Cover file={s.card} size={s.size} crop={s.photo} box={[0, 0, 1080, PB + 60 + Math.max(0, -minShift)]} focus={foc} z={z}
          win={[Math.max(0, shift) + 330, Y.W - 110 - Math.min(0, shift)]} />
        <div style={{position: 'absolute', left: 0, top: PB + Math.max(0, -shift) - 300, width: 1080, height: 1400, background: `linear-gradient(rgba(244,238,227,0) 0px, ${C.paper} 250px, ${C.paper} 100%)`}} />
      </div>
      <div style={{position: 'absolute', left: 0, top: 0, width: 1080, height: 420, background: 'linear-gradient(rgba(20,12,6,0.36), rgba(20,12,6,0))'}} />
      {A && t >= 0 && <div style={{position: 'absolute', inset: 0, background: '#fff', opacity: 0.8 * (1 - ramp(t, 0, 10))}} />}
      {/* 语言章 + 标签（主讲：重点记；过渡：你熟悉的叫法；回忆时换成提问） */}
      <Chip text={s.lang} x={hx} y={at(Y.W) - 96} f={t + 6} C={C} size={A ? 54 : 48} />
      {!hidden && A && <Chip text={TX.answer} x={tagX} y={at(Y.W) - 84} f={inRc ? rk - rc.t_reveal - 3 : t - 5} C={C} size={38} dark rot={3} />}
      {!inRc && Bg && <Chip text={TX.bridge} x={tagX} y={at(Y.W) - 84} f={t - 5} C={C} size={36} light rot={2} />}
      {hidden && <Chip text={TX.recall} x={tagX} y={at(Y.W) - 86} f={rk - 2} C={C} size={40} dark rot={2} />}
      {A && <Sparks x={hx + 50} y={at(Y.W) - 80} f={t - 5} r={90} color={C.accent2} n={7} spread={26} />}
      {inRc && <Sparks x={hx + 60} y={at(Y.W) + w.fs * 0.6} f={rk - rc.t_reveal} r={110} color={C.accent2} n={7} spread={26} a0={-120} />}
      <div style={{position: 'absolute', left: hx, top: at(Y.W), opacity: clamp(hp * 2.5), transform: `scale(${lerp(1.25, 1, hp) * (inRc ? lerp(1.12, 1, pop) : 1)})`, transformOrigin: '0% 50%'}}>
        <Word w={w} C={C} fs={w.fs} blur={blur} hl={hlP} g={g} parts={w.show} pmFs={w.pm_fs} pmO={clamp(mp * 2)} />
      </div>
      {hidden && rk > 4 && <div style={{position: 'absolute', left: hx, top: at(Y.W) + w.fs * 0.1, fontFamily: SERIF, fontWeight: 900, fontSize: w.fs * 0.9, color: C.accent2,
        opacity: clamp((rk - 4) / 5), transform: `scale(${lerp(1.5, 1, sp(rk - 4, {damping: 8, stiffness: 300}))})`, transformOrigin: '0% 50%', textShadow: '0 4px 0 #fff'}}>？</div>}
      {s.reading && Y.R != null && (
        <div style={{position: 'absolute', left: hx + 4, top: at(Y.R), height: 58, display: 'flex', alignItems: 'center', fontFamily: famOf(w.family), fontWeight: 700, fontSize: 42, color: C.sub, letterSpacing: 3, whiteSpace: 'nowrap',
          opacity: clamp(rp * 2) * (hidden ? 0 : 1), transform: `translateY(${16 * (1 - rp)}px)`}}>{s.reading}</div>
      )}
      {s.meaning && Y.M != null && t >= -6 && (
        <div style={{position: 'absolute', left: hx, top: at(Y.M), height: 72, display: 'flex', alignItems: 'center', gap: 18, opacity: clamp(mp * 2.5), transform: `translateX(${-40 * (1 - mp)}px)`}}>
          <div style={{background: C.ink, color: C.paper, fontFamily: SERIF, fontWeight: 900, fontSize: 32, padding: '6px 18px', borderRadius: 30, letterSpacing: 4}}>{TX.meaning}</div>
          <div style={{fontFamily: SERIF, fontWeight: 900, fontSize: 54, color: C.ink, letterSpacing: 3, whiteSpace: 'nowrap',
            background: `linear-gradient(transparent 60%, ${C.accent} 60%, ${C.accent} 92%, transparent 92%)`, backgroundSize: `${100 * ramp(t, 10, 24)}% 100%`, backgroundRepeat: 'no-repeat'}}>{s.meaning}</div>
        </div>
      )}
      {/* 又见面了：这一段和前面哪种语言的哪一段是同一个意思 */}
      {s.links && s.links.length > 0 && Y.K != null && t >= 14 && (
        <div style={{position: 'absolute', left: hx, top: at(Y.K), display: 'flex', alignItems: 'flex-start', gap: 18, opacity: clamp(kp * 2), transform: `translateX(${-50 * (1 - kp)}px) scale(${s.k_scale})`, transformOrigin: '0% 0%', whiteSpace: 'nowrap'}}>
          <div style={{marginTop: 8, background: C.accent2, color: '#fff', fontFamily: SERIF, fontWeight: 900, fontSize: 34, padding: '4px 18px', borderRadius: 30, letterSpacing: 3}}>{TX.link}</div>
          <div style={{display: 'flex', flexDirection: 'column', gap: 4}}>
            {s.links.map((l: any, i: number) => (
              <div key={i} style={{height: 58, display: 'flex', alignItems: 'center', gap: 12, fontFamily: famOf(w.family), fontWeight: 900, fontSize: 44, color: C.ink, opacity: clamp((t - 18 - i * 6) / 6)}}>
                <span style={{color: C.accent2}}>{l.t}</span>
                {l.prev.map((q: any, j: number) => (
                  <React.Fragment key={j}>
                    <span style={{color: C.sub, fontWeight: 700}}>＝</span>
                    <span>{q.t}</span>
                    <span style={{fontFamily: SERIF, fontSize: 26, fontWeight: 900, color: C.paper, background: C.sub, borderRadius: 14, padding: '1px 9px'}}>{q.short}</span>
                  </React.Fragment>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
      {s.steps.map((st: any, i: number) => {
        const f = t - st.start;
        const nextLift = s.steps.slice(i + 1).some((q: any) => q.lift);
        if (!st.lift || f < -8 || f > st.dur + 4) return null;
        const P = st.lift.panel;
        const isName = st.kind === 'name';
        const np = sp(f - 12, {damping: 13, stiffness: 220});
        const no = nextLift || s.steps.slice(i + 1).length ? ramp(f, st.dur - 5, st.dur + 3) : 0;
        return (
          <React.Fragment key={i}>
            <Panel lift={st.lift} f={f - 2} dur={st.dur - 2} exit={i < s.steps.length - 1} tilt={isName ? 0 : 1.2} C={C} />
            {st.chip && (i === s.steps.length - 1 || f < st.dur - 5) && <Chip text={st.label} x={P[0] + 4} y={P[1] - 78} f={f - 4} C={C} size={40} dark />}
            {st.note && f >= 10 && (
              <div style={{position: 'absolute', left: P[0] + 4, top: P[1] + P[3] + 22, width: 880, display: 'flex', gap: 16, alignItems: 'flex-start', opacity: clamp(np * 2) * (1 - no), transform: `translateY(${24 * (1 - np)}px)`}}>
                <div style={{flex: 'none', width: 10, alignSelf: 'stretch', borderRadius: 5, background: C.accent2}} />
                <div style={{fontFamily: SERIF, fontWeight: 900, fontSize: 38, lineHeight: 1.35, color: C.ink, letterSpacing: 0}}>{st.note}</div>
              </div>
            )}
          </React.Fragment>
        );
      })}
    </>
  );
};

// ---------- 复盘：整页一次排满（原生排字）→ 跨语言发现：同一个词根在各行里一起亮起，相关行用金线串起来 ----------
const Recap: React.FC<{s: any; plan: Plan; t: number}> = ({s, plan, t}) => {
  const C = plan.style.colors, TX = plan.style.text;
  const hp = sp(t, {damping: 12});
  const ti = t - s.t_insight;
  const top = s.items[0].row[0];
  const hls = s.items.filter((it: any) => it.hl);
  const lp = ramp(ti, 0, 14);
  return (
    <>
      <Mountain C={C} x={760} y={1660} o={0.7} />
      <div style={{position: 'absolute', left: 64, top: top - 104, fontFamily: SERIF, fontWeight: 900, fontSize: 60, color: C.ink, letterSpacing: 4, opacity: clamp(hp * 2), transform: `translateY(${30 * (1 - hp)}px)`}}>{s.head}</div>
      <div style={{position: 'absolute', left: 64, top: top - 24, height: 10, width: 520 * ramp(t, 4, 16), background: C.accent, borderRadius: 5}} />
      {hls.length > 1 && ti >= 0 && (() => {
        const y1 = hls[0].row[0] + hls[0].row[1] / 2, y2 = hls[hls.length - 1].row[0] + hls[hls.length - 1].row[1] / 2;
        return <div style={{position: 'absolute', left: 18, top: y1, width: 10, height: (y2 - y1) * lp, background: C.accent2, borderRadius: 4}} />;
      })()}
      {s.items.map((it: any, i: number) => {
        const f = t - 4 - i * 5;
        if (f < 0) return null;
        const p = sp(f, {damping: 12, stiffness: 240});
        const [ry, rh] = it.row;
        const g = it.hl && ti >= 0 ? sp(ti - 4 - i * 2, {damping: 12}) : 0;
        const gw = ti >= 0 ? ramp(ti, 2 + i * 2, 14 + i * 2) : 0;
        const wy = ry + rh * (it.meaning ? 0.40 : 0.5) - it.fs * 0.6;
        return (
          <div key={i} style={{position: 'absolute', inset: 0, opacity: clamp(p * 2.5), transform: `translateX(${-90 * (1 - p)}px)`}}>
            <div style={{position: 'absolute', left: 40, top: ry, width: 924, height: rh, borderRadius: 22, background: '#FBF7F0', boxShadow: '0 12px 30px rgba(30,20,10,0.12)',
              outline: g > 0 ? `${5 * g}px solid ${C.accent2}` : undefined}} />
            <div style={{position: 'absolute', left: 64, top: ry + rh / 2 - 38, width: 134, height: 76, borderRadius: 38, background: it.anchor ? C.accent : C.ink, color: it.anchor ? C.ink : C.paper, fontFamily: SERIF, fontWeight: 900, fontSize: 34, letterSpacing: 4,
              display: 'flex', alignItems: 'center', justifyContent: 'center', transform: `scale(${1 + 0.08 * g})`}}>{it.lang}</div>
            <div style={{position: 'absolute', left: 236, top: wy, transform: `scale(${lerp(1.25, 1, p)})`, transformOrigin: '0% 50%'}}>
              <Word w={it.word} C={C} fs={it.fs} hl={it.hlp} g={gw} tint />
            </div>
            {it.meaning && <div style={{position: 'absolute', left: 238, top: ry + rh * 0.68, fontFamily: SERIF, fontSize: 38, fontWeight: g > 0 ? 900 : 400, color: g > 0 ? C.ink : C.sub, letterSpacing: 2, whiteSpace: 'nowrap'}}>{TX.meaning} · {it.meaning}</div>}
          </div>
        );
      })}
      {s.insight && ti >= 0 && (() => {
        const p = sp(ti, {damping: 10, stiffness: 260});
        return (
          <>
            <div style={{position: 'absolute', left: 64, top: s.y_insight, width: 900, fontFamily: SERIF, fontWeight: 900, fontSize: 58, lineHeight: 1.35, color: C.ink, opacity: clamp(p * 2), transform: `scale(${lerp(1.2, 1, p)})`, transformOrigin: '0% 50%'}}>
              <span style={{background: `linear-gradient(transparent 58%, ${C.accent} 58%, ${C.accent} 92%, transparent 92%)`, backgroundSize: `${100 * ramp(ti, 4, 18)}% 100%`, backgroundRepeat: 'no-repeat'}}>{s.insight}</span>
            </div>
            <Sparks x={70} y={s.y_insight + 10} f={ti - 2} r={46} color={C.accent2} n={3} a0={-120} />
          </>
        );
      })()}
    </>
  );
};

// ---------- 结尾：不回看，记住了吗 → 打字 → 最后揭开答案 ----------
const Outro: React.FC<{s: any; plan: Plan; t: number}> = ({s, plan, t}) => {
  const C = plan.style.colors, B = s.beat;
  const z = 1.18 - 0.1 * ramp(t, 0, s.dur, (x) => x);
  const l1 = sp(t - B * 0.6, {damping: 10, stiffness: 280}), l2 = sp(t - B * 1.4, {damping: 10, stiffness: 280});
  const tf = t - Math.round(B * 3);
  const chars = Array.from(s.comment as string);
  const typed = tf < 0 ? 0 : Math.min(chars.length, Math.floor(tf / 3));
  const caret = Math.floor(t / 9) % 2 === 0;
  const boxP = sp(tf + 4, {damping: 14});
  const big: React.CSSProperties = {position: 'absolute', left: 64, fontFamily: SERIF, fontWeight: 900, fontSize: 116, color: C.paper, letterSpacing: 6, transformOrigin: '0% 50%', textShadow: '0 10px 40px rgba(0,0,0,0.45)', whiteSpace: 'nowrap'};
  const n = s.items.length, step = 112, y0 = 760, yC = y0 + n * step + 36;
  return (
    <>
      <Cover file={s.card} size={s.size} crop={s.photo} box={[0, 0, 1080, 1920]} focus={s.subject} z={z} imgStyle={{filter: 'blur(3px)'}} />
      <div style={{position: 'absolute', inset: 0, background: 'linear-gradient(rgba(20,12,6,0.62), rgba(20,12,6,0.5) 45%, rgba(20,12,6,0.72))'}} />
      <div style={{...big, top: 400, opacity: clamp(l1 * 2), transform: `scale(${lerp(1.5, 1, l1)})`}}>{s.lines[0]}</div>
      <div style={{...big, top: 546, opacity: clamp(l2 * 2), transform: `scale(${lerp(1.5, 1, l2)})`}}>
        <span style={{background: `linear-gradient(transparent 62%, ${C.accent2}dd 62%, ${C.accent2}dd 92%, transparent 92%)`, backgroundSize: `${100 * ramp(t - B * 1.4, 6, 18)}% 100%`, backgroundRepeat: 'no-repeat'}}>{s.lines[1]}</span>
      </div>
      {s.items.map((it: any, i: number) => {
        const p = sp(t - B * 2.2 - i * 3, {damping: 14});
        const rv = ramp(t, s.t_reveal + i * 4, s.t_reveal + i * 4 + 8);
        const y = y0 + i * step, bw = Math.min(it.ow, 640) + 48;
        return (
          <div key={i} style={{position: 'absolute', inset: 0, opacity: clamp(p * 2), transform: `translateY(${30 * (1 - p)}px)`}}>
            <div style={{position: 'absolute', left: 64, top: y, width: 134, height: 88, borderRadius: 44, background: it.anchor ? C.accent : 'rgba(251,247,240,0.95)', color: C.ink, fontFamily: SERIF, fontWeight: 900, fontSize: 34, letterSpacing: 3,
              display: 'flex', alignItems: 'center', justifyContent: 'center'}}>{it.lang}</div>
            <div style={{position: 'absolute', left: 222, top: y, width: bw, height: 88, borderRadius: 18, background: 'rgba(251,247,240,0.94)', overflow: 'hidden', outline: rv > 0 ? `${4 * rv}px solid ${C.accent}` : undefined,
              display: 'flex', alignItems: 'center', padding: '0 24px', boxSizing: 'border-box', fontFamily: famOf(it.word.family), fontWeight: 900, fontSize: it.ofs, color: C.ink, whiteSpace: 'nowrap', letterSpacing: 2}}>
              <span style={{filter: `blur(${13 * (1 - rv)}px)`, transform: `scale(${1 + 0.08 * Math.sin(Math.PI * rv)})`}}>{it.word.text}</span>
            </div>
            <div style={{position: 'absolute', left: 222, width: bw, top: y + 4, textAlign: 'center', fontFamily: SERIF, fontWeight: 900, fontSize: 60, lineHeight: '80px', color: C.ink, opacity: 0.85 * (1 - rv)}}>?</div>
          </div>
        );
      })}
      {tf > -4 && (
        <div style={{position: 'absolute', left: 64, top: yC, width: 900, height: 112, borderRadius: 56, background: C.paper, boxShadow: '0 16px 40px rgba(0,0,0,0.35)', opacity: clamp(boxP * 2), transform: `translateY(${60 * (1 - boxP)}px)`,
          display: 'flex', alignItems: 'center', padding: '0 46px', boxSizing: 'border-box', fontFamily: SERIF, fontSize: 48, color: C.ink, fontWeight: 700}}>
          <span>{chars.slice(0, typed).join('')}</span>
          <span style={{width: 4, height: 54, background: C.accent2, marginLeft: 6, opacity: caret ? 1 : 0}} />
          <span style={{marginLeft: 'auto', fontSize: 44}}>✍︎</span>
        </div>
      )}
      {s.tagline && <div style={{position: 'absolute', left: 64, top: yC + 150, width: 900, fontFamily: SERIF, fontSize: 38, lineHeight: 1.5, color: C.paper, opacity: 0.9 * ramp(tf, 14, 26), letterSpacing: 2}}>{s.tagline}</div>}
    </>
  );
};

export const Film: React.FC<Plan> = (plan) => {
  const f = useCurrentFrame();
  const C = plan.style.colors;
  const T = plan.transition || 8;
  const n = plan.scenes.length;
  return (
    <AbsoluteFill style={{background: C.paper}}>
      {plan.scenes.map((s: any, i: number) => {
        const Comp = ({hook: Hook, lang: Lang, recap: Recap, outro: Outro} as any)[s.type];
        const first = i === 0, last = i === n - 1;
        return (
          <Sequence key={i} from={first ? 0 : s.start - T} durationInFrames={s.dur + (first ? 0 : T)} layout="none">
            <Shell T={T} dur={s.dur} first={first} last={last}>{(t) => <Comp s={s} plan={plan} t={t} />}</Shell>
          </Sequence>
        );
      })}
      <HUD plan={plan} f={f} />
      {plan.audio && <Audio src={staticFile(plan.audio)} />}
    </AbsoluteFill>
  );
};
