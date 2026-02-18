import { useCallback, useRef } from "react";

/**
 * 3D tilt effect for session cards.
 *
 * Drives CSS custom properties directly on each .session-card:
 *   --tilt-x, --tilt-y   (rotations in deg)
 *   --glow-x, --glow-y   (specular highlight position in %)
 *   --lift               (translateZ depth in px)
 *
 * The CSS applies these via:
 *   transform: rotateX(var(--tilt-x)) rotateY(var(--tilt-y)) translateZ(var(--lift))
 * on .session-card ITSELF — so border, background, shadow all tilt as one body.
 *
 * Uses requestAnimationFrame + lerp for smooth 60fps follow with physical lag.
 */

const MAX_TILT = 14;           // max degrees
const LIFT_PX = 8;             // translateZ on hover
const LERP_IN = 0.45;          // follow speed — high = snappy, responsive
const LERP_OUT = 0.10;         // return-to-flat speed — slower for soft landing
const IDLE_THRESHOLD = 0.01;

type TiltState = {
  targetX: number;
  targetY: number;
  currentX: number;
  currentY: number;
  glowX: number;
  glowY: number;
  targetGlowX: number;
  targetGlowY: number;
  hovering: boolean;
  raf: number | null;
  el: HTMLElement | null;
};

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function tick(s: TiltState) {
  const factor = s.hovering ? LERP_IN : LERP_OUT;

  s.currentX = lerp(s.currentX, s.targetX, factor);
  s.currentY = lerp(s.currentY, s.targetY, factor);
  s.glowX = lerp(s.glowX, s.targetGlowX, factor);
  s.glowY = lerp(s.glowY, s.targetGlowY, factor);

  const lift = s.hovering ? LIFT_PX : 0;

  if (s.el) {
    const st = s.el.style;
    st.setProperty("--tilt-x", `${s.currentX.toFixed(2)}deg`);
    st.setProperty("--tilt-y", `${s.currentY.toFixed(2)}deg`);
    st.setProperty("--glow-x", `${s.glowX.toFixed(1)}%`);
    st.setProperty("--glow-y", `${s.glowY.toFixed(1)}%`);
    st.setProperty("--lift", `${lift}px`);
  }

  const dx = Math.abs(s.currentX - s.targetX);
  const dy = Math.abs(s.currentY - s.targetY);

  if (dx > IDLE_THRESHOLD || dy > IDLE_THRESHOLD) {
    s.raf = requestAnimationFrame(() => tick(s));
  } else {
    if (s.el) {
      const st = s.el.style;
      st.setProperty("--tilt-x", `${s.targetX}deg`);
      st.setProperty("--tilt-y", `${s.targetY}deg`);
      st.setProperty("--glow-x", `${s.targetGlowX}%`);
      st.setProperty("--glow-y", `${s.targetGlowY}%`);
      st.setProperty("--lift", `${lift}px`);
    }
    s.raf = null;
  }
}

function startLoop(s: TiltState) {
  if (s.raf === null) {
    s.raf = requestAnimationFrame(() => tick(s));
  }
}

export function useCardTilt() {
  const statesRef = useRef<Map<string, TiltState>>(new Map());

  const getState = useCallback((key: string, el: HTMLElement): TiltState => {
    let s = statesRef.current.get(key);
    if (!s) {
      s = {
        targetX: 0, targetY: 0,
        currentX: 0, currentY: 0,
        glowX: 50, glowY: 50,
        targetGlowX: 50, targetGlowY: 50,
        hovering: false,
        raf: null,
        el,
      };
      statesRef.current.set(key, s);
    }
    s.el = el;
    return s;
  }, []);

  const onMouseMove = useCallback((key: string, e: React.MouseEvent<HTMLElement>) => {
    const el = e.currentTarget;
    const rect = el.getBoundingClientRect();
    const nx = ((e.clientX - rect.left) / rect.width - 0.5) * 2;
    const ny = ((e.clientY - rect.top) / rect.height - 0.5) * 2;

    const s = getState(key, el);
    s.hovering = true;
    s.targetX = -ny * MAX_TILT;
    s.targetY = nx * MAX_TILT;
    s.targetGlowX = ((e.clientX - rect.left) / rect.width) * 100;
    s.targetGlowY = ((e.clientY - rect.top) / rect.height) * 100;

    startLoop(s);
  }, [getState]);

  const onMouseLeave = useCallback((key: string, e: React.MouseEvent<HTMLElement>) => {
    const el = e.currentTarget;
    const s = getState(key, el);
    s.hovering = false;
    s.targetX = 0;
    s.targetY = 0;
    s.targetGlowX = 50;
    s.targetGlowY = 50;
    startLoop(s);
  }, [getState]);

  return { onMouseMove, onMouseLeave };
}
