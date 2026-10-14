// 日物图鉴 · 多语言物件片 渲染器（原生 9:16 全屏）。只读 plan.json；没有任何每期写死的内容。
import React from 'react';
import {AbsoluteFill, Audio, Img, Sequence, continueRender, delayRender, staticFile, useCurrentFrame} from 'remotion';
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
      {plan.hud_dots !== false && langs.map((l, i) => {
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
const Shell: React.FC<{T: number; dur: number; first: boolean; last: boolean; flip?: boolean; children: (t: number) => React.ReactNode}> = ({T, dur, first, last, flip, children}) => {
  if (T === 0) {  // 快闪式：硬切，不推镜
    const t0 = useCurrentFrame();
    return <AbsoluteFill style={{overflow: 'hidden'}}><Paper />{children(t0)}</AbsoluteFill>;
  }
  const t = useCurrentFrame() - (first ? 0 : T);
  const kin = first ? 1 : ramp(t, -T, 0, inOut);
  const kout = last ? 0 : ramp(t, dur - T, dur, inOut);
  if (flip) {  // 图鉴式：翻书页。旧页以左边为轴翻走（盖在新页上面），新页原地不动、阴影慢慢褪去
    return (
      <AbsoluteFill style={{overflow: 'hidden', zIndex: !last && t >= dur - T ? 2 : 1, transform: kout > 0 ? `perspective(2400px) rotateY(${-100 * kout}deg)` : undefined, transformOrigin: '0% 50%', backfaceVisibility: 'hidden'}}>
        <Paper />
        {children(t)}
        {kout > 0 && <div style={{position: 'absolute', inset: 0, background: `linear-gradient(90deg, rgba(20,12,6,0), rgba(20,12,6,${0.35 * kout}))`}} />}
        {kin < 1 && <div style={{position: 'absolute', inset: 0, background: `rgba(20,12,6,${0.3 * (1 - kin)})`}} />}
      </AbsoluteFill>
    );
  }
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
          <span style={{filter: blur > 0.3 ? `blur(${blur}px)` : undefined, color: on && tint ? C.accent_text : C.ink,  // 金色文字一律用 accent_text（比 accent2 深一档），奶白底上看得清
            background: on ? `linear-gradient(transparent 70%, ${C.accent} 70%, ${C.accent} 94%, transparent 94%)` : undefined, backgroundSize: on ? `${100 * g}% 100%` : undefined, backgroundRepeat: 'no-repeat'}}>{sg.t}</span>
          {parts && m && (
            <>
              <span style={{position: 'absolute', left: '8%', width: '84%', top: '98%', height: 5, borderRadius: 3, background: C.accent2, opacity: 0.55 * pmO}} />
              <span style={{position: 'absolute', left: '50%', top: 'calc(98% + 12px)', transform: 'translateX(-50%)', fontFamily: SERIF, fontWeight: 900, fontSize: pmFs, lineHeight: 1, letterSpacing: 2,
                color: on ? C.accent_text : '#6B5442', whiteSpace: 'nowrap', opacity: pmO}}>{m}</span>
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
          <div style={{marginTop: 8, background: C.accent_text, color: '#fff', fontFamily: SERIF, fontWeight: 900, fontSize: 34, padding: '4px 18px', borderRadius: 30, letterSpacing: 3}}>{TX.link}</div>
          <div style={{display: 'flex', flexDirection: 'column', gap: 4}}>
            {s.links.map((l: any, i: number) => (
              <div key={i} style={{height: 58, display: 'flex', alignItems: 'center', gap: 12, fontFamily: famOf(w.family), fontWeight: 900, fontSize: 44, color: C.ink, opacity: clamp((t - 18 - i * 6) / 6)}}>
                <span style={{color: C.accent_text}}>{l.t}</span>
                {l.prev.map((q: any, j: number) => (
                  <React.Fragment key={j}>
                    <span style={{color: C.sub, fontWeight: 700}}>＝</span>
                    <span>{q.t}</span>
                    <span style={{fontFamily: SERIF, fontSize: 30, fontWeight: 900, color: C.paper, background: C.sub, borderRadius: 15, padding: '1px 10px'}}>{q.short}</span>
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


// ================= 猜选式：同一系列里的 3 个真名字，猜哪个是它 =================
const Ring: React.FC<{C: any; t: number; t0: number; t1: number; B: number; cx: number; cy: number; R?: number}> = ({C, t, t0, t1, B, cx, cy, R = 70}) => {
  if (t < t0 || t >= t1 + 2) return null;
  const cnt = Math.min(2, Math.floor((t - t0) / B)), cf = (t - t0) - cnt * B;
  return (
    <>
      <svg style={{position: 'absolute', left: cx - R - 10, top: cy - R - 10}} width={2 * R + 20} height={2 * R + 20}>
        <circle cx={R + 10} cy={R + 10} r={R} fill={C.paper} stroke={C.paper2} strokeWidth={8} />
        <circle cx={R + 10} cy={R + 10} r={R} stroke={C.accent2} strokeWidth={10} fill="none" strokeLinecap="round"
          strokeDasharray={2 * Math.PI * R} strokeDashoffset={2 * Math.PI * R * ramp(t, t0, t1, (x) => x)} transform={`rotate(-90 ${R + 10} ${R + 10})`} />
      </svg>
      <div style={{position: 'absolute', left: cx - R, top: cy - R, width: 2 * R, height: 2 * R, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: SERIF, fontWeight: 900, fontSize: 88, color: C.ink,
        transform: `scale(${lerp(1.6, 1, sp(cf, {damping: 9, stiffness: 320}))})`}}>{3 - cnt}</div>
    </>
  );
};
const Quiz: React.FC<{s: any; plan: Plan; t: number}> = ({s, plan, t}) => {
  const C = plan.style.colors, TX = plan.style.text, B = s.beat;
  const rv = t - s.t_reveal, on = rv >= 0;
  const PH = 800;
  const z = 1.12 - 0.06 * ramp(t, 0, s.dur, (x) => x) + (on ? 0.04 * Math.sin(Math.PI * ramp(rv, 0, 10)) : 0);
  const oy = 1040, oh = 168, og = 18, qy = 800;
  const shake = !on && t > s.t_count + 2 * B ? Math.sin(t * 2.2) * 2 : 0;
  return (
    <>
      <Cover file={s.card} size={s.size} crop={s.photo} box={[0, 0, 1080, PH]} focus={s.subject} z={z} win={[330, 700]} zfit={1.6} />
      <PhotoFade h={PH} C={C} />
      {/* 问题：第 0 帧就在 */}
      <div style={{position: 'absolute', left: 64, top: qy, fontFamily: SERIF, fontWeight: 900, fontSize: s.qfs, lineHeight: 1.22, color: C.ink, letterSpacing: 2, whiteSpace: 'nowrap'}}>
        <div><span style={{background: `linear-gradient(transparent 62%, ${C.accent} 62%, ${C.accent} 92%, transparent 92%)`}}>{s.q[0]}</span></div>
        <div>{s.q[1]}</div>
      </div>
      <Ring C={C} t={t} t0={s.t_count} t1={s.t_reveal} B={B} cx={964 - 70} cy={qy - 100} />
      {s.options.map((o: any, i: number) => {
        const f = t - s.t_opts[i];
        if (f < 0) return null;
        const p = sp(f, {damping: 12, stiffness: 260});
        const y = oy + i * (oh + og);
        const g = on ? sp(rv - (o.ok ? 0 : 4), {damping: 11, stiffness: 240}) : 0;
        const dim = on && !o.ok ? 0.5 * clamp(g) : 0;
        const L_ = 'ABC'[i];
        return (
          <div key={i} style={{position: 'absolute', inset: 0, opacity: clamp(p * 2.5) * (1 - dim), transform: `translateX(${-120 * (1 - p) + (o.ok ? 0 : shake)}px)`}}>
            <div style={{position: 'absolute', left: 64, top: y, width: 900, height: oh, borderRadius: 26, background: '#FBF7F0', boxShadow: '0 16px 36px rgba(30,20,10,0.16)',
              outline: o.ok && on ? `${7 * clamp(g)}px solid ${C.accent2}` : undefined, transform: `scale(${o.ok && on ? lerp(1, 1.04, clamp(g)) : 1})`, transformOrigin: '50% 50%'}} />
            <div style={{position: 'absolute', left: 92, top: y + oh / 2 - 46, width: 92, height: 92, borderRadius: 46, background: o.ok && on ? C.accent2 : C.ink, color: o.ok && on ? C.ink : C.paper,
              display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: SERIF, fontWeight: 900, fontSize: 54}}>{o.ok && on ? '✓' : L_}</div>
            <div style={{position: 'absolute', left: 214, top: y + 16, fontFamily: famOf(o.family), fontWeight: 900, fontSize: o.fs, lineHeight: 1.1, color: C.ink, whiteSpace: 'nowrap', letterSpacing: 2,
              textDecoration: on && !o.ok && g > 0.5 ? `line-through ${C.sub}` : undefined}}>{o.text}</div>
            <div style={{position: 'absolute', left: 218, top: y + oh - 56, fontFamily: famOf(o.family), fontWeight: 700, fontSize: 34, color: C.sub, whiteSpace: 'nowrap', letterSpacing: 2, opacity: on && !o.ok ? 1 - clamp(g * 2) : 1}}>{o.reading}</div>
            {on && !o.ok && <div style={{position: 'absolute', left: 218, top: y + oh - 58, fontFamily: SERIF, fontWeight: 900, fontSize: 36, color: C.ink, whiteSpace: 'nowrap', opacity: clamp(g * 2 - 1)}}>{TX.quiz_no} · {o.what}</div>}
            {on && o.ok && <Chip text={TX.quiz_ok} right={130} y={y + oh - 52} f={rv - 2} C={C} size={42} dark rot={4} />}
            {on && o.ok && <Sparks x={140} y={y + 10} f={rv} r={70} color={C.accent2} n={7} spread={26} />}
          </div>
        );
      })}
      {on && <div style={{position: 'absolute', inset: 0, background: '#fff', opacity: 0.55 * (1 - ramp(rv, 0, 8))}} />}
      {t >= s.t_count && !on && <Chip text={s.countText} x={64} y={qy - 96} f={t - s.t_count} C={C} size={46} dark />}
    </>
  );
};

// ================= 快闪式：每种语言 4 拍，照片全屏 + 白色大字，卡点硬切 =================
const Dark: React.FC<{s: any; z: number; win?: [number, number]; blur?: number; k?: number}> = ({s, z, win, blur = 0, k = 0.7}) => (
  <>
    <Cover file={s.card} size={s.size} crop={s.photo} box={[0, 0, 1080, 1920]} focus={s.subject} z={z} win={win} zfit={1.8} imgStyle={blur ? {filter: `blur(${blur}px)`} : undefined} />
    <div style={{position: 'absolute', inset: 0, background: `linear-gradient(rgba(20,12,6,0.40), rgba(20,12,6,0.05) 30%, rgba(20,12,6,${k * 0.9}) 56%, rgba(20,12,6,${k}) 100%)`}} />
  </>
);
const Punch: React.FC<{t: number}> = ({t}) => t < 6 ? <div style={{position: 'absolute', inset: 0, background: '#fff', opacity: 0.7 * (1 - t / 6)}} /> : null;
const FlashQ: React.FC<{s: any; plan: Plan; t: number}> = ({s, plan, t}) => {
  const C = plan.style.colors;
  const z = 1.5 - 0.35 * ramp(t, 0, s.dur, (x) => x);
  return (
    <>
      <Dark s={s} z={z} win={[330, 1100]} k={0.35} />
      <Panel lift={s.lift} f={t + 30} dur={1e6} exit={false} C={C} />
      {[[150, 520, -12], [820, 700, 10]].map((q, i) => {
        const p = sp(t - 2 - i * 4, {damping: 8, stiffness: 300});
        return <div key={i} style={{position: 'absolute', left: q[0], top: q[1], fontFamily: SERIF, fontWeight: 900, fontSize: 170, color: C.paper, opacity: clamp(p),
          transform: `scale(${p}) rotate(${q[2]}deg)`, textShadow: '0 8px 30px rgba(0,0,0,0.45)'}}>?</div>;
      })}
    </>
  );
};
const Flash: React.FC<{s: any; plan: Plan; t: number}> = ({s, plan, t}) => {
  const C = plan.style.colors, B = s.beat, w = s.word;
  const z = lerp(1.32, 1.08, sp(t, {damping: 20, stiffness: 120})) + 0.04 * ramp(t, 0, s.dur, (x) => x);
  const hp = sp(t, {damping: 11, stiffness: 300});
  const mp = sp(t - B, {damping: 12, stiffness: 260});
  const y0 = 1060;
  const num = `${String(s.index + 1).padStart(2, '0')}/${String(s.n).padStart(2, '0')}`;
  return (
    <>
      <Dark s={s} z={z} win={[340, 980]} />
      <div style={{position: 'absolute', left: 64, top: y0 - 110, display: 'flex', alignItems: 'center', gap: 22}}>
        <div style={{background: s.anchor ? C.accent : C.paper, color: C.ink, fontFamily: SERIF, fontWeight: 900, fontSize: 52, padding: '6px 28px', borderRadius: 50, letterSpacing: 4,
          transform: `scale(${lerp(1.5, 1, hp)})`, transformOrigin: '0% 50%'}}>{s.lang}</div>
        <div style={{fontFamily: SERIF, fontWeight: 900, fontSize: 40, color: 'rgba(251,247,240,0.7)', letterSpacing: 4}}>{num}</div>
      </div>
      <div style={{position: 'absolute', left: 64, top: y0, opacity: clamp(hp * 3), transform: `scale(${lerp(1.35, 1, hp)})`, transformOrigin: '0% 50%',
        fontFamily: famOf(w.family), fontWeight: 900, fontSize: s.ffs, lineHeight: 1.15, letterSpacing: 2, color: '#FFFDF8', whiteSpace: 'nowrap', textShadow: '0 10px 40px rgba(0,0,0,0.5)'}}>{w.text}</div>
      {s.reading && <div style={{position: 'absolute', left: 70, top: y0 + s.ffs * 1.2 + 6, fontFamily: famOf(w.family), fontWeight: 700, fontSize: 44, color: 'rgba(251,247,240,0.86)', letterSpacing: 3, whiteSpace: 'nowrap',
        opacity: clamp(sp(t - 4) * 2)}}>{s.reading}</div>}
      {(s.parts_m.length > 0 || s.meaning) && t >= B - 2 && (
        <div style={{position: 'absolute', left: 64, top: y0 + s.ffs * 1.2 + 88, display: 'flex', alignItems: 'center', gap: 14, opacity: clamp(mp * 2), transform: `translateY(${30 * (1 - mp)}px)`}}>
          {(s.parts_m.length ? s.parts_m : [s.meaning]).map((m: string, i: number) => (
            <React.Fragment key={i}>
              {i > 0 && <span style={{fontFamily: SERIF, fontWeight: 900, fontSize: s.cfs * 0.9, color: C.accent}}>＋</span>}
              <span style={{background: C.accent, color: C.ink, fontFamily: SERIF, fontWeight: 900, fontSize: s.cfs, padding: `4px ${s.cfs * 0.43}px`, borderRadius: 16, letterSpacing: 3,
                transform: `scale(${lerp(1.4, 1, sp(t - B - i * 4, {damping: 10, stiffness: 300}))})`}}>{m}</span>
            </React.Fragment>
          ))}
        </div>
      )}
      <Punch t={t} />
    </>
  );
};
const FlashSum: React.FC<{s: any; plan: Plan; t: number}> = ({s, plan, t}) => {
  const C = plan.style.colors, ti = t - s.t_insight;
  const n = s.items.length, step = s.step, y0 = 560;
  const yI = y0 + n * step + 40;
  return (
    <>
      <Dark s={s} z={1.15 - 0.08 * ramp(t, 0, s.dur, (x) => x)} blur={4} k={0.8} />
      <div style={{position: 'absolute', inset: 0, background: 'rgba(20,12,6,0.5)'}} />  {/* 汇总页字多：整体再压暗，金色高亮字在亮照片上也看得清 */}
      {s.items.map((it: any, i: number) => {
        const p = sp(t - 3 - i * 4, {damping: 12, stiffness: 280});
        const y = y0 + i * step;
        return (
          <div key={i} style={{position: 'absolute', left: 64, top: y, display: 'flex', alignItems: 'center', gap: 26, opacity: clamp(p * 2.5), transform: `translateX(${-100 * (1 - p)}px)`}}>
            <div style={{width: 120, height: 76, borderRadius: 38, background: it.anchor ? C.accent : 'rgba(251,247,240,0.92)', color: C.ink, fontFamily: SERIF, fontWeight: 900, fontSize: 32, letterSpacing: 3,
              display: 'flex', alignItems: 'center', justifyContent: 'center'}}>{it.lang}</div>
            <div>
              <div style={{whiteSpace: 'nowrap', fontFamily: famOf(it.word.family), fontWeight: 900, fontSize: Math.min(it.sfs, step * 0.62), color: '#FFFDF8', letterSpacing: 2, textShadow: '0 4px 18px rgba(0,0,0,0.55)'}}>
                {it.word.segs.map((sg: any, k: number) => {
                  const on = it.hlp.includes(sg.p) && ti >= 0;
                  return <span key={k} style={{color: on ? C.accent : '#FFFDF8', whiteSpace: 'pre'}}>{sg.t}</span>;
                })}
              </div>
            </div>
          </div>
        );
      })}
      {s.insight && ti >= 0 && (() => {
        const p = sp(ti, {damping: 10, stiffness: 260});
        return <div style={{position: 'absolute', left: 64, top: yI, width: 900, fontFamily: SERIF, fontWeight: 900, fontSize: s.ifs || 64, lineHeight: 1.3, color: C.ink, opacity: clamp(p * 2), transform: `scale(${lerp(1.25, 1, p)})`, transformOrigin: '0% 50%'}}>
          <span style={{background: C.accent, padding: '2px 16px', borderRadius: 10, boxDecorationBreak: 'clone', WebkitBoxDecorationBreak: 'clone'}}>{s.insight}</span>
        </div>;
      })()}
      {t >= s.t_insight + 2 * s.beat && (
        <div style={{position: 'absolute', left: 64, top: yI + (s.ifs || 64) * 1.3 * (s.insight ? 1 : 0) + 70, fontFamily: SERIF, fontWeight: 900, fontSize: 50, color: C.paper, opacity: clamp(sp(t - s.t_insight - 2 * s.beat) * 2), letterSpacing: 2}}>
          {s.comment}<span style={{marginLeft: 16, color: C.accent}}>↓</span>
        </div>
      )}
      <Punch t={t} />
    </>
  );
};

// ================= 图鉴式（book）：信息和讲解式完全一样，排成一本博物图鉴：封面 → 每种语言一页词条 → 索引页 → 记忆卡 =================
const NUM = '①②③④⑤⑥⑦⑧⑨';
const pad2 = (n: number) => (n < 10 ? '0' : '') + n;
const Tape: React.FC<{x: number; y: number; w?: number; rot?: number; o?: number}> = ({x, y, w = 120, rot = -6, o = 1}) => (
  <div style={{position: 'absolute', left: x - w / 2, top: y - 18, width: w, height: 36, background: 'rgba(231,198,144,0.72)', transform: `rotate(${rot}deg)`, opacity: o,
    boxShadow: '0 2px 6px rgba(40,24,10,0.12)', borderLeft: '2px dashed rgba(255,255,255,0.5)', borderRight: '2px dashed rgba(255,255,255,0.5)'}} />
);
// 书页底：左侧书脊阴影 + 外框细线
const PageBg: React.FC<{C: any}> = ({C}) => (
  <>
    <div style={{position: 'absolute', left: 0, top: 0, width: 46, height: 1920, background: 'linear-gradient(90deg, rgba(60,40,20,0.20), rgba(60,40,20,0))'}} />
    <div style={{position: 'absolute', left: 30, top: 200, width: 1020, height: 1500, border: `2px solid ${C.accent2}55`, borderRadius: 6}} />
  </>
);
// 一块剪报：把卡上的原图切片按 k 倍缩放贴到 (x, y)
const BookClip: React.FC<{lift: any; x: number; y: number; k: number; C: any; rot?: number}> = ({lift, x, y, k, C, rot = 0}) => {
  const [px, py, pw, ph] = lift.panel;
  return (
    <div style={{position: 'absolute', left: x, top: y, width: pw * k, height: ph * k, transform: `rotate(${rot}deg)`, transformOrigin: '50% 0%'}}>
      <div style={{position: 'absolute', inset: 0, background: lift.bg || C.card, borderRadius: 8, boxShadow: '0 14px 30px rgba(40,24,10,0.22)'}} />
      <div style={{position: 'absolute', left: 0, top: 0, width: pw, height: ph, transform: `scale(${k})`, transformOrigin: '0 0'}}>
        {lift.pieces.map((pc: any, i: number) => <Img key={i} src={staticFile(pc.img)} style={{position: 'absolute', left: pc.dst[0] - px, top: pc.dst[1] - py, width: pc.dst[2], height: pc.dst[3]}} />)}
      </div>
      <Tape x={pw * k / 2} y={0} w={130} rot={rot > 0 ? -4 : 4} />
    </div>
  );
};

const BHook: React.FC<{s: any; plan: Plan; t: number}> = ({s, plan, t}) => {
  const C = plan.style.colors, TX = plan.style.text, B = s.beat;
  const zOut = ramp(t, s.t_zoom, s.t_zoom + 12);
  const f2 = [0, 1, 2, 3].map((k) => lerp(s.subject[k], lerp(s.subject[k], s.photo[k], 0.55), zOut));
  const z = lerp(1.9, 1.02, zOut) + 0.04 * ramp(t, s.t_zoom, s.dur, (x) => x);
  const P = s.lift.panel, k = Math.min(1, 860 / P[2]), qx = 540 - P[2] * k / 2, qy = 1060;
  const fp = sp(t + 4, {damping: 14});
  const lp = sp(t - 4, {damping: 12});
  return (
    <>
      <div style={{position: 'absolute', inset: 0, background: C.ink}} />
      <div style={{position: 'absolute', inset: 0, background: 'radial-gradient(ellipse at 50% 40%, rgba(255,240,210,0.10), rgba(0,0,0,0) 70%)'}} />
      <div style={{position: 'absolute', left: 44, top: 340, width: 992, height: 1340, border: `3px solid ${C.accent2}`, borderRadius: 10}} />
      <div style={{position: 'absolute', left: 58, top: 354, width: 964, height: 1312, border: `1px solid ${C.accent2}88`, borderRadius: 6}} />
      {/* 标本照片（镶在封面框里） */}
      <div style={{position: 'absolute', left: 120, top: 420, width: 840, height: 560, background: C.card, padding: 12, boxSizing: 'border-box', boxShadow: '0 20px 50px rgba(0,0,0,0.5)', opacity: clamp(fp * 2), transform: `scale(${lerp(0.94, 1, fp)})`}}>
        <Cover file={s.card} size={s.size} crop={s.photo} box={[12, 12, 816, 536]} focus={f2} z={z} />
      </div>
      <Tape x={170} y={428} rot={-30} /><Tape x={910} y={428} rot={30} />
      <div style={{position: 'absolute', left: 120, width: 840, top: 1004, textAlign: 'center', fontFamily: SERIF, fontWeight: 900, fontSize: 34, letterSpacing: 14, color: C.accent2, opacity: clamp(lp * 2)}}>— {TX.book_cover} —</div>
      <div style={{position: 'absolute', inset: 0, transform: `translate(${qx - P[0] * k}px, ${qy - P[1] * k}px) scale(${k})`, transformOrigin: '0 0'}}>
        <Panel lift={s.lift} f={t + 30} dur={1e6} exit={false} C={C} />
      </div>
      {t >= s.t_count && <Chip text={s.countText} x={120} y={1400} f={t - s.t_count} C={C} size={50} />}
      <Ring C={C} t={t} t0={s.t_count} t1={s.dur} B={B} cx={860} cy={1440} />
    </>
  );
};

const BLang: React.FC<{s: any; plan: Plan; t: number}> = ({s, plan, t}) => {
  const C = plan.style.colors, TX = plan.style.text, L = s.book, Y = L.y, w = s.word;
  // 当前这一步的版面（在相邻两步之间平滑过渡）
  let lay: any = {...L.lays[0], ex: L.lays[0].ex || 0, plateK: L.lays[0].plate ? 1 : 0, clips: L.lays[0].clips.map((c: any) => ({...c, u: c.fold ? 1 : 0}))};
  s.steps.forEach((st: any, i: number) => {
    if (i === 0 || t < st.start - 3) return;
    const a = L.lays[i - 1], b = L.lays[i], q = ramp(t, st.start - 3, st.start + 9, inOut);
    lay = {up: lerp(a.up, b.up, q), ex: lerp(a.ex || 0, b.ex || 0, q), plateK: lerp(a.plate ? 1 : 0, b.plate ? 1 : 0, q),
      clips: b.clips.map((c: any, j: number) => ({y: lerp(a.clips[j].y, c.y, q), k: lerp(a.clips[j].k, c.k, q), u: lerp(a.clips[j].fold ? 1 : 0, c.fold ? 1 : 0, q)}))};
  });
  const o = -lay.up;
  const A = s.anchor, Bg = s.bridge;
  const hp = sp(t - 4, {damping: 12, stiffness: 200});
  const rp = sp(t - 10, {damping: 14}), ep = sp(t - 14, {damping: 14}), mp = sp(t - 18, {damping: 14});
  const hlP = (s.links || []).map((l: any) => l.p);
  const g = ramp(t, 22, 34);
  const rc = s.steps.find((st: any) => st.kind === 'recall');
  const rk = rc ? t - rc.start : -1, inRc = rc && rk >= 0;
  const covered = inRc && rk >= 8 && rk < rc.t_reveal;  // 便利贴完全盖住时名字不渲染（不会从纸下透出来）
  const pop = inRc && rk >= rc.t_reveal ? sp(rk - rc.t_reveal, {damping: 9, stiffness: 300}) : 1;
  const parts = L.etym.length ? w.parts : [];
  const z = 1.04 + 0.06 * ramp(t, 0, s.dur, (x) => x);
  const noteTop = Y.word + o - 4, noteH = Y.end - Y.word + 8;  // 便利贴盖住整条词条（名字、读音、词源、字面、参见都有答案）
  let ci = -1;
  return (
    <>
      <PageBg C={C} />
      {/* 页眉：编号 + 语言 + 标签，下面双线 */}
      <div style={{position: 'absolute', left: 64, top: Y.head, height: 64, display: 'flex', alignItems: 'center', gap: 22, whiteSpace: 'nowrap', opacity: clamp(sp(t + 2) * 2)}}>
        <span style={{fontFamily: SERIF, fontWeight: 900, fontSize: 46, color: C.accent_text, letterSpacing: 2}}>No.{pad2(s.no)}</span>
        <span style={{background: A ? C.accent : C.ink, color: A ? C.ink : C.paper, fontFamily: SERIF, fontWeight: 900, fontSize: 40, padding: '4px 24px', borderRadius: 32, letterSpacing: 4}}>{s.lang}</span>
        {(A || Bg) && !(inRc && rk < rc.t_reveal + 6) && <span style={{border: `3px solid ${A ? C.ink : C.sub}`, color: A ? C.ink : C.sub, fontFamily: SERIF, fontWeight: 900, fontSize: 32, padding: '2px 18px', borderRadius: 30, letterSpacing: 3, transform: 'rotate(-2deg)'}}>{A ? TX.answer : TX.bridge}</span>}
        <span style={{fontFamily: SERIF, fontWeight: 700, fontSize: 30, color: C.sub, letterSpacing: 2}}>{s.no} / {s.n}</span>
      </div>
      <div style={{position: 'absolute', left: 64, top: Y.head + 72, width: 900 * ramp(t, -4, 10), height: 4, background: C.ink}} />
      <div style={{position: 'absolute', left: 64, top: Y.head + 80, width: 900 * ramp(t, -2, 12), height: 1.5, background: C.ink}} />
      {/* 标本照片 */}
      {lay.plateK > 0.01 && (
        <div style={{position: 'absolute', left: 64, top: Y.plate, width: 900, height: 300 + lay.ex, opacity: lay.plateK, transform: `scale(${lerp(0.9, 1, lay.plateK)})`, transformOrigin: '50% 0%'}}>
          <div style={{position: 'absolute', inset: 0, background: C.card, boxShadow: '0 14px 34px rgba(40,24,10,0.22)'}} />
          <Cover file={s.card} size={s.size} crop={s.photo} box={[10, 10, 880, 280 + lay.ex]} focus={s.subject} z={z} />
          <Tape x={40} y={14} rot={-35} w={110} /><Tape x={860} y={14} rot={35} w={110} />
        </div>
      )}
      {/* 词条：名字 / 读音 / 词源 / 字面 / 参见 */}
      <div style={{position: 'absolute', left: 64, top: Y.word + o, opacity: clamp(hp * 2.5) * (covered ? 0 : 1), transform: `scale(${lerp(1.2, 1, hp) * 1})`, transformOrigin: '0% 50%'}}>
        <Word w={w} C={C} fs={w.fs} hl={hlP} g={g} />
      </div>
      {inRc && <Sparks x={120} y={Y.word + o + w.fs * 0.6} f={rk - rc.t_reveal - 4} r={110} color={C.accent2} n={7} spread={26} a0={-120} />}
      {s.reading && Y.reading != null && (
        <div style={{position: 'absolute', left: 68, top: Y.reading + o, height: 58, display: 'flex', alignItems: 'center', fontFamily: famOf(w.family), fontWeight: 700, fontSize: 42, color: C.sub, letterSpacing: 3, whiteSpace: 'nowrap',
          opacity: clamp(rp * 2) * (covered ? 0 : 1), transform: `translateY(${14 * (1 - rp)}px)`}}>{s.reading}</div>
      )}
      {parts.length > 0 && Y.etym != null && (
        <div style={{position: 'absolute', left: 64, top: Y.etym + o, height: 64, display: 'flex', alignItems: 'center', gap: 18, whiteSpace: 'nowrap', opacity: clamp(ep * 2) * (covered ? 0 : 1), transform: `translateX(${-30 * (1 - ep)}px)`}}>
          <span style={{background: C.ink, color: C.paper, fontFamily: SERIF, fontWeight: 900, fontSize: 30, padding: '4px 16px', borderRadius: 8, letterSpacing: 4}}>{TX.book_etym}</span>
          <span style={{fontFamily: famOf(w.family), fontWeight: 900, fontSize: L.efs || 46, color: C.ink, letterSpacing: 1}}>
            {parts.map((p: any, i: number) => (
              <React.Fragment key={i}>
                {i > 0 && <span style={{color: C.sub, margin: '0 10px'}}>＋</span>}
                <span>{p.t}</span>{p.m && <span style={{fontFamily: SERIF, fontSize: Math.round((L.efs || 46) * 0.78), color: C.accent_text}}>〈{p.m}〉</span>}
              </React.Fragment>
            ))}
          </span>
        </div>
      )}
      {s.meaning && Y.mean != null && (
        <div style={{position: 'absolute', left: 64, top: Y.mean + o, height: 64, display: 'flex', alignItems: 'center', gap: 18, whiteSpace: 'nowrap', opacity: clamp(mp * 2) * (covered ? 0 : 1), transform: `translateX(${-30 * (1 - mp)}px)`}}>
          <span style={{border: `3px solid ${C.ink}`, color: C.ink, fontFamily: SERIF, fontWeight: 900, fontSize: 30, padding: '1px 14px', borderRadius: 8, letterSpacing: 4}}>{TX.meaning}</span>
          <span style={{fontFamily: SERIF, fontWeight: 900, fontSize: 48, color: C.ink, letterSpacing: 3, background: `linear-gradient(transparent 60%, ${C.accent} 60%, ${C.accent} 92%, transparent 92%)`,
            backgroundSize: `${100 * ramp(t, 22, 36)}% 100%`, backgroundRepeat: 'no-repeat'}}>{s.meaning}</span>
        </div>
      )}
      {s.links && s.links.length > 0 && Y.links != null && t >= 16 && (
        <div style={{position: 'absolute', left: 64, top: Y.links + o, display: 'flex', alignItems: 'flex-start', gap: 18, whiteSpace: 'nowrap', opacity: covered ? 0 : 1}}>
          <span style={{marginTop: 9, background: C.accent_text, color: '#fff', fontFamily: SERIF, fontWeight: 900, fontSize: 30, padding: '4px 16px', borderRadius: 8, letterSpacing: 4, opacity: clamp((t - 16) / 6)}}>{TX.book_see}</span>
          <div style={{display: 'flex', flexDirection: 'column', gap: 0}}>
            {s.links.map((l: any, i: number) => (
              <div key={i} style={{height: 58, display: 'flex', alignItems: 'center', gap: 12, fontFamily: famOf(w.family), fontWeight: 900, fontSize: L.lfs || 42, color: C.ink, opacity: clamp((t - 20 - i * 6) / 6), transform: `translateX(${-30 * (1 - clamp((t - 20 - i * 6) / 8))}px)`}}>
                <span style={{color: C.accent_text}}>{l.t}</span>
                {l.prev.map((q: any, j: number) => (
                  <React.Fragment key={j}>
                    <span style={{color: C.sub, fontWeight: 700}}>＝</span>
                    <span>{q.t}</span>
                    <span style={{fontFamily: SERIF, fontSize: 30, fontWeight: 900, color: C.paper, background: C.sub, borderRadius: 14, padding: '1px 10px'}}>{q.short}</span>
                  </React.Fragment>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
      {/* 重点：一块块剪报贴上来（编号 + 原图切片 + 注） */}
      {s.steps.map((st: any, i: number) => {
        if (!st.lift) return null;
        ci += 1;
        const c = lay.clips[ci], f = t - st.start;
        if (f < -3) return null;
        const p = sp(f + 3, {damping: 13, stiffness: 200});
        const rot = ci % 2 ? 0.8 : -0.8;
        const P = st.lift.panel, bh = P[3] * c.k;
        return (
          <div key={i} style={{position: 'absolute', inset: 0, opacity: clamp(p * 2.5), transform: `translateY(${50 * (1 - p)}px)`}}>
            <div style={{position: 'absolute', left: 64, top: c.y, height: 56, display: 'flex', alignItems: 'center', gap: 14, whiteSpace: 'nowrap',
              background: c.u > 0.5 ? C.card : undefined, borderRadius: 10, padding: c.u > 0.5 ? '0 20px 0 0' : 0, boxShadow: c.u > 0.5 ? '0 6px 14px rgba(40,24,10,0.14)' : undefined}}>
              <span style={{fontFamily: SERIF, fontWeight: 900, fontSize: 44, color: C.accent_text}}>{NUM[ci] || ci + 1}</span>
              <span style={{fontFamily: SERIF, fontWeight: 900, fontSize: 38, color: C.ink, letterSpacing: 3}}>{st.label}</span>
            </div>
            {c.u < 0.99 && (
              <div style={{position: 'absolute', inset: 0, opacity: 1 - c.u, transform: `scaleY(${1 - 0.7 * c.u})`, transformOrigin: `0 ${c.y + 60}px`}}>
                <BookClip lift={st.lift} x={104} y={c.y + 64} k={c.k} C={C} rot={rot * (1 - c.u)} />
                {st.note && <div style={{position: 'absolute', left: 104, top: c.y + 64 + bh + 10, width: 860, display: 'flex', gap: 14, fontFamily: SERIF, fontWeight: 900, fontSize: 36, lineHeight: 1.35, color: C.ink, opacity: clamp((f - 10) / 8)}}>
                  <span style={{color: C.accent_text, flex: 'none'}}>注</span><span>{st.note}</span></div>}
              </div>
            )}
          </div>
        );
      })}
      {/* 回忆：便利贴盖住名字 → 揭开 */}
      {inRc && rk < rc.t_reveal + 14 && (() => {
        const dp = sp(rk, {damping: 12, stiffness: 240});
        const pk = ramp(rk, rc.t_reveal, rc.t_reveal + 12, (x) => x * x);
        return (
          <div style={{position: 'absolute', left: 50, top: noteTop, width: 930, height: noteH, opacity: clamp(dp * 2) * (1 - ramp(pk, 0.55, 0.9, (x) => x)),  // 揭走时不变透明（不会隔着纸看到名字）
            transform: `translate(${1150 * pk}px, ${-220 * pk + 60 * (1 - dp)}px) rotate(${lerp(-4, -0.8, dp) + 22 * pk}deg)`, transformOrigin: '100% 0%'}}>
            <div style={{position: 'absolute', inset: 0, background: '#F3DDA6', boxShadow: '0 18px 40px rgba(40,24,10,0.30)', borderRadius: 4}} />
            <div style={{position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: SERIF, fontWeight: 900, fontSize: 66, color: C.ink, letterSpacing: 4, flexDirection: 'column', gap: 10}}><span style={{fontSize: 150, color: C.accent_text, lineHeight: 1}}>？</span><span>{TX.recall}</span></div>
            <Tape x={465} y={4} w={180} rot={-2} />
          </div>
        );
      })()}
    </>
  );
};

const BRecap: React.FC<{s: any; plan: Plan; t: number}> = ({s, plan, t}) => {
  const C = plan.style.colors, TX = plan.style.text;
  const hp = sp(t, {damping: 12});
  const ti = t - s.t_insight;
  const y0 = 560, st = s.step, n = s.items.length;
  const by = y0 + n * st + 20;
  return (
    <>
      <PageBg C={C} />
      <div style={{position: 'absolute', left: 64, top: 330, display: 'flex', alignItems: 'baseline', gap: 26, opacity: clamp(hp * 2), transform: `translateY(${24 * (1 - hp)}px)`}}>
        <span style={{fontFamily: SERIF, fontWeight: 900, fontSize: 84, color: C.ink, letterSpacing: 12}}>{TX.book_index}</span>
        <span style={{fontFamily: SERIF, fontWeight: 900, fontSize: 30, color: C.accent_text, letterSpacing: 10}}>INDEX</span>
      </div>
      <div style={{position: 'absolute', left: 64, top: 450, fontFamily: SERIF, fontWeight: 700, fontSize: 42, color: C.sub, letterSpacing: 3, opacity: clamp((t - 4) / 8)}}>{s.head}</div>
      <div style={{position: 'absolute', left: 64, top: 520, width: 900 * ramp(t, 2, 14), height: 4, background: C.ink}} />
      {s.items.map((it: any, i: number) => {
        const f = t - 6 - i * 5;
        if (f < 0) return null;
        const p = sp(f, {damping: 13, stiffness: 240});
        const y = y0 + i * st;
        const gl = it.hl && ti >= 0 ? sp(ti - 2 - i * 2, {damping: 12}) : 0;
        const gw = ti >= 0 ? ramp(ti, 2 + i * 2, 14 + i * 2) : 0;
        const wh = Math.round(it.bfs * 1.25);
        return (
          <div key={i} style={{position: 'absolute', inset: 0, opacity: clamp(p * 2.5), transform: `translateX(${-60 * (1 - p)}px)`}}>
            {gl > 0 && <div style={{position: 'absolute', left: 30, top: y + 6, width: 14 * gl, height: st - 30, background: C.accent2, borderRadius: '0 6px 6px 0'}} />}
            <div style={{position: 'absolute', left: 64, top: y + wh / 2 - 30, width: 116, height: 60, borderRadius: 30, background: it.anchor ? C.accent : C.ink, color: it.anchor ? C.ink : C.paper,
              fontFamily: SERIF, fontWeight: 900, fontSize: 30, letterSpacing: 3, display: 'flex', alignItems: 'center', justifyContent: 'center'}}>{it.lang}</div>
            <div style={{position: 'absolute', left: 204, top: y, width: 760, height: wh, display: 'flex', alignItems: 'center', gap: 14}}>
              <Word w={it.word} C={C} fs={it.bfs} hl={it.hlp} g={gw} />
              <div style={{flex: 1, alignSelf: 'center', marginTop: wh * 0.25, borderBottom: `5px dotted ${C.sub}88`}} />
              <span style={{fontFamily: SERIF, fontWeight: 900, fontSize: 36, color: C.sub, whiteSpace: 'nowrap'}}>p.{pad2(i + 1)}</span>
            </div>
            {it.meaning && <div style={{position: 'absolute', left: 208, top: y + wh + 4, fontFamily: SERIF, fontWeight: gl > 0 ? 900 : 700, fontSize: 34, color: gl > 0 ? C.ink : C.sub, letterSpacing: 2, whiteSpace: 'nowrap'}}>{TX.meaning} · {it.meaning}</div>}
          </div>
        );
      })}
      {s.insight && ti >= 0 && (() => {
        const p = sp(ti, {damping: 11, stiffness: 240});
        return (
          <div style={{position: 'absolute', left: 64, top: by, width: 900, opacity: clamp(p * 2), transform: `scale(${lerp(1.1, 1, p)}) rotate(${lerp(-2, -0.6, p)}deg)`, transformOrigin: '0% 0%'}}>
            <div style={{position: 'relative', marginTop: 26, background: '#FBF3E2', border: `3px solid ${C.accent2}`, borderRadius: 10, padding: '44px 36px 30px', boxShadow: '0 14px 34px rgba(40,24,10,0.18)',
              fontFamily: SERIF, fontWeight: 900, fontSize: s.ifs, lineHeight: 1.35, color: C.ink}}>
              <span style={{background: `linear-gradient(transparent 58%, ${C.accent} 58%, ${C.accent} 92%, transparent 92%)`, backgroundSize: `${100 * ramp(ti, 4, 18)}% 100%`, backgroundRepeat: 'no-repeat'}}>{s.insight}</span>
            </div>
            <span style={{position: 'absolute', left: 30, top: 0, background: C.accent_text, color: '#fff', fontFamily: SERIF, fontWeight: 900, fontSize: 32, padding: '6px 20px', borderRadius: 8, letterSpacing: 6}}>{TX.book_note}</span>
          </div>
        );
      })()}
    </>
  );
};

const BOutro: React.FC<{s: any; plan: Plan; t: number}> = ({s, plan, t}) => {
  const C = plan.style.colors, TX = plan.style.text, B = s.beat;
  const l1 = sp(t - B * 0.6, {damping: 10, stiffness: 280}), l2 = sp(t - B * 1.4, {damping: 10, stiffness: 280});
  const tf = t - Math.round(B * 3);
  const chars = Array.from(s.comment as string);
  const typed = tf < 0 ? 0 : Math.min(chars.length, Math.floor(tf / 3));
  const caret = Math.floor(t / 9) % 2 === 0;
  const n = s.items.length, step = 116, cy = 620, rows0 = cy + 130, cH = 130 + n * step + 150;
  const cp = sp(t + 8, {damping: 14});  // 翻到这一页时卡片已经在了（不出现空白页）
  const ep = String(plan.episode || '').replace(/^([A-Za-z]+)(\d+)$/, '$1.$2');
  const big: React.CSSProperties = {position: 'absolute', left: 64, fontFamily: SERIF, fontWeight: 900, fontSize: 96, color: C.ink, letterSpacing: 6, transformOrigin: '0% 50%', whiteSpace: 'nowrap'};
  return (
    <>
      <PageBg C={C} />
      <div style={{...big, top: 340, opacity: clamp(l1 * 2), transform: `scale(${lerp(1.4, 1, l1)})`}}>{s.lines[0]}</div>
      <div style={{...big, top: 466, opacity: clamp(l2 * 2), transform: `scale(${lerp(1.4, 1, l2)})`}}>
        <span style={{background: `linear-gradient(transparent 62%, ${C.accent} 62%, ${C.accent} 92%, transparent 92%)`, backgroundSize: `${100 * ramp(t - B * 1.4, 6, 18)}% 100%`, backgroundRepeat: 'no-repeat'}}>{s.lines[1]}</span>
      </div>
      <div style={{position: 'absolute', left: 64, top: cy, width: 900, height: cH, opacity: clamp(cp * 2), transform: `translateY(${80 * (1 - cp)}px) rotate(${lerp(3, 0.6, cp)}deg)`, transformOrigin: '50% 0%'}}>
        <div style={{position: 'absolute', inset: 0, background: '#FBF7F0', borderRadius: 14, boxShadow: '0 20px 50px rgba(40,24,10,0.25)',
          backgroundImage: `repeating-linear-gradient(transparent 0px, transparent ${step - 2}px, ${C.accent2}44 ${step - 2}px, ${C.accent2}44 ${step}px)`, backgroundPosition: `0 ${130 - 14}px`}} />
        <div style={{position: 'absolute', left: 96, top: 0, width: 3, height: cH, background: '#D9897A88'}} />
        <div style={{position: 'absolute', left: 120, top: 34, fontFamily: SERIF, fontWeight: 900, fontSize: 46, color: C.ink, letterSpacing: 6, display: 'flex', alignItems: 'baseline', gap: 18}}><span>{TX.book_card}</span><span style={{color: C.accent_text, fontSize: 34, letterSpacing: 2}}>{ep}</span></div>
        <Tape x={450} y={0} w={200} rot={-2} />
      </div>
      {s.items.map((it: any, i: number) => {
        const p = sp(t + 6 - i * 3, {damping: 14});  // 记忆卡翻到时各行（模糊的名字）就跟着出现
        const rv = ramp(t, s.t_reveal + i * 4, s.t_reveal + i * 4 + 8);
        const sp2 = t >= s.t_reveal + i * 4 + 4 ? sp(t - s.t_reveal - i * 4 - 4, {damping: 9, stiffness: 320}) : 0;
        const y = rows0 + i * step;
        return (
          <div key={i} style={{position: 'absolute', inset: 0, opacity: clamp(p * 2), transform: `translateY(${24 * (1 - p)}px)`}}>
            <div style={{position: 'absolute', left: 184, top: y + 10, width: 116, height: 64, borderRadius: 32, background: it.anchor ? C.accent : C.ink, color: it.anchor ? C.ink : C.paper,
              fontFamily: SERIF, fontWeight: 900, fontSize: 30, letterSpacing: 3, display: 'flex', alignItems: 'center', justifyContent: 'center'}}>{it.lang}</div>
            <div style={{position: 'absolute', left: 324, top: y, height: 84, display: 'flex', alignItems: 'center', fontFamily: famOf(it.word.family), fontWeight: 900, fontSize: it.bofs || it.ofs, color: C.ink, whiteSpace: 'nowrap', letterSpacing: 2}}>
              <span style={{filter: `blur(${14 * (1 - rv)}px)`, opacity: lerp(0.55, 1, rv)}}>{it.word.text}</span>
            </div>
            {sp2 > 0 && <div style={{position: 'absolute', left: 860, top: y + 4, width: 76, height: 76, borderRadius: 38, border: `5px solid ${C.accent_text}`, color: C.accent_text, boxSizing: 'border-box',
              display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: SERIF, fontWeight: 900, fontSize: 44, opacity: clamp(sp2 * 2), transform: `scale(${lerp(1.8, 1, sp2)}) rotate(-12deg)`}}>✓</div>}
          </div>
        );
      })}
      {tf > -4 && (
        <div style={{position: 'absolute', left: 184, top: rows0 + n * step + 26, width: 740, height: 84, display: 'flex', alignItems: 'center', fontFamily: SERIF, fontSize: 46, color: C.ink, fontWeight: 900, opacity: clamp((tf + 4) / 6)}}>
          <span style={{marginRight: 18, fontSize: 42}}>✍︎</span>
          <span>{chars.slice(0, typed).join('')}</span>
          <span style={{width: 4, height: 50, background: C.accent2, marginLeft: 6, opacity: caret ? 1 : 0}} />
        </div>
      )}
      {s.tagline && <div style={{position: 'absolute', left: 64, top: cy + cH + 50, width: 900, fontFamily: SERIF, fontSize: 38, lineHeight: 1.5, color: C.sub, fontWeight: 700, opacity: ramp(tf, 14, 26), letterSpacing: 2}}>{s.tagline}</div>}
    </>
  );
};

// 调试用：plan.debug 为真时把每段文字的位置、颜色打到浏览器日志，供 scripts/geom.mjs 自动检查遮挡/越界
const DebugBoxes: React.FC<{f: number}> = ({f}) => {
  const [h] = React.useState(() => delayRender('geom'));
  React.useEffect(() => {
    (document as any).fonts.ready.then(() => requestAnimationFrame(() => {
      const out: any[] = [];
      const R = (document.getElementById('film-root') as any).getBoundingClientRect();
      document.querySelectorAll('div,span').forEach((el: any) => {
        const txt = Array.from(el.childNodes).filter((n: any) => n.nodeType === 3).map((n: any) => n.textContent).join('').trim();
        if (!txt) return;
        const r = el.getBoundingClientRect();
        let op = 1, e: any = el;
        while (e) { op *= parseFloat(getComputedStyle(e).opacity || '1'); e = e.parentElement; }
        if (op < 0.05 || r.width < 1) return;
        const cs = getComputedStyle(el);
        out.push({t: txt.slice(0, 40), x: Math.round(r.left - R.left), y: Math.round(r.top - R.top), w: Math.round(r.width), h: Math.round(r.height), c: cs.color, fs: cs.fontSize, op: +op.toFixed(2)});
      });
      console.log('GEOM' + JSON.stringify({f, boxes: out}));
      continueRender(h);
    }));
  }, [f]);
  return null;
};

export const Film: React.FC<Plan> = (plan) => {
  const f = useCurrentFrame();
  const C = plan.style.colors;
  const T = plan.transition || 8;
  const n = plan.scenes.length;
  return (
    <AbsoluteFill id="film-root" style={{background: C.paper}}>
      {plan.scenes.map((s: any, i: number) => {
        const Comp = ({hook: Hook, lang: Lang, recap: Recap, outro: Outro, quiz: Quiz, flash_q: FlashQ, flash: Flash, flash_sum: FlashSum, b_hook: BHook, b_lang: BLang, b_recap: BRecap, b_outro: BOutro} as any)[s.type];
        const first = i === 0, last = i === n - 1;
        const Ti = s.cut ? 0 : (s.flipT || T);  // 图鉴式翻页比推镜长一点，看得出是在翻书
        return (
          <Sequence key={i} from={first ? 0 : s.start - Ti} durationInFrames={s.dur + (first ? 0 : Ti)} layout="none">
            <Shell T={Ti} dur={s.dur} first={first} last={last} flip={!!s.flip}>{(t) => <Comp s={s} plan={plan} t={t} />}</Shell>
          </Sequence>
        );
      })}
      <AbsoluteFill style={{zIndex: 5, pointerEvents: 'none'}}><HUD plan={plan} f={f} /></AbsoluteFill>
      {plan.audio && <Audio src={staticFile(plan.audio)} />}
      {(plan as any).debug && <DebugBoxes f={f} />}
    </AbsoluteFill>
  );
};
