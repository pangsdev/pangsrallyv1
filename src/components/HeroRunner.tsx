import { useEffect, useRef } from 'react';

/**
 * Landing hero runner: one racer gallops in on its feet, curls up and rolls off, on a loop.
 * Same motion as the race (src/race/PixiRaceTrack.tsx: deformOpen + the gallop / curling /
 * rolling phases), drawn on a plain 2D canvas so the landing page does not load Pixi.
 * The open pose is a 7×11 mesh whose triangles are drawn with affine-mapped clips.
 */

// Defaults: teaser #1 cut out (scripts/make-hero-runner.mjs), head at low x (flipped on screen); its body is Aurora.
const ART = '/landing/runner.webp';
const BALL = '/sprites/ball_aurora.png';
const MESH_X = 7, MESH_Y = 11;
const TAU = Math.PI * 2;

// One loop, in seconds.
const RUN_END = 1.7, CURL = 0.45, ROLL_END = 5.0, LOOP = 5.8;

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const smoothstep = (a: number, b: number, v: number) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
const easeOutBack = (t: number) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); };

type Pt = [number, number];
type Dust = { x: number; y: number; vx: number; vy: number; life: number; r: number };

/** Draws the source triangle s of img onto destination triangle d (slightly grown to hide seams). */
function drawTri(ctx: CanvasRenderingContext2D, img: CanvasImageSource, s: Pt[], d: Pt[]) {
  const [[x0, y0], [x1, y1], [x2, y2]] = s;
  const [[u0, v0], [u1, v1], [u2, v2]] = d;
  const den = x0 * (y1 - y2) + x1 * (y2 - y0) + x2 * (y0 - y1);
  if (Math.abs(den) < 1e-6) return;
  const a = (u0 * (y1 - y2) + u1 * (y2 - y0) + u2 * (y0 - y1)) / den;
  const b = (v0 * (y1 - y2) + v1 * (y2 - y0) + v2 * (y0 - y1)) / den;
  const c = (u0 * (x2 - x1) + u1 * (x0 - x2) + u2 * (x1 - x0)) / den;
  const dd = (v0 * (x2 - x1) + v1 * (x0 - x2) + v2 * (x1 - x0)) / den;
  const e = (u0 * (x1 * y2 - x2 * y1) + u1 * (x2 * y0 - x0 * y2) + u2 * (x0 * y1 - x1 * y0)) / den;
  const f = (v0 * (x1 * y2 - x2 * y1) + v1 * (x2 * y0 - x0 * y2) + v2 * (x0 * y1 - x1 * y0)) / den;
  const cx = (u0 + u1 + u2) / 3, cy = (v0 + v1 + v2) / 3;
  const grow = (x: number, y: number): Pt => { const l = Math.hypot(x - cx, y - cy) || 1; return [x + ((x - cx) / l) * 0.7, y + ((y - cy) / l) * 0.7]; };
  ctx.save();
  ctx.beginPath();
  const p0 = grow(u0, v0), p1 = grow(u1, v1), p2 = grow(u2, v2);
  ctx.moveTo(p0[0], p0[1]); ctx.lineTo(p1[0], p1[1]); ctx.lineTo(p2[0], p2[1]); ctx.closePath();
  ctx.clip();
  ctx.transform(a, b, c, dd, e, f);
  ctx.drawImage(img, 0, 0);
  ctx.restore();
}

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
}

export default function HeroRunner({ art: artSrc = ART, ball: ballSrc = BALL, className = 'ld-runner-canvas' }: { art?: string; ball?: string; className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext('2d')!;
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let raf = 0, alive = true, inView = true, visible = true, last = 0, t = 0;
    let art: HTMLCanvasElement | null = null, ball: HTMLImageElement | null = null;
    let W = 0, H = 0, artH = 0, artW = 0, ballR = 0, ground = 0;
    let x = 0, rollAngle = 0, stridePhase = 0, lastSin = 0;
    const dust: Dust[] = [];

    // Mesh in art space (pixels of the scaled art canvas).
    let base: Pt[] = [];
    const tris: [number, number, number][] = [];
    for (let j = 0; j < MESH_Y - 1; j++) for (let i = 0; i < MESH_X - 1; i++) {
      const k = j * MESH_X + i;
      tris.push([k, k + 1, k + MESH_X], [k + 1, k + MESH_X + 1, k + MESH_X]);
    }

    const resize = async () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const r = canvas.getBoundingClientRect();
      W = r.width; H = r.height;
      canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      artH = H * 0.62; ground = H - 10;
      const src = await loadImage(artSrc).catch(() => null);
      ball = ball ?? await loadImage(ballSrc).catch(() => null);
      if (!src) return;
      artW = artH * (src.width / src.height);
      ballR = artH * 0.5;
      // Pre-scale the art to its on-screen size so each triangle draws a small bitmap.
      art = document.createElement('canvas');
      art.width = Math.round(artW * dpr); art.height = Math.round(artH * dpr);
      const a = art.getContext('2d')!;
      a.imageSmoothingQuality = 'high';
      a.drawImage(src, 0, 0, art.width, art.height);
      base = [];
      for (let j = 0; j < MESH_Y; j++) for (let i = 0; i < MESH_X; i++) base.push([(i / (MESH_X - 1)) * art.width, (j / (MESH_Y - 1)) * art.height]);
    };

    /** Race gallop deform (deformOpen in PixiRaceTrack), in art-canvas pixels. */
    const deformed = (amount: number): Pt[] => {
      const bw = art!.width, bh = art!.height;
      const ph = stridePhase, s = Math.sin(ph);
      const swingA = bw * 0.085, liftA = bh * 0.05;
      return base.map(([bx, by]) => {
        const ub = bx / bw, vb = by / bh;
        const legW = smoothstep(0.58, 1, vb), bodyW = 1 - legW;
        const swing = (ub < 0.5 ? 1 : -1) * s;
        let dx = -swing * legW * swingA;
        let dy = -legW * legW * liftA * Math.max(0, swing) * 1.4;
        dy += -bodyW * bh * 0.022 * s * Math.sin(Math.PI * ub);
        if (ub < 0.3) dy += -bh * 0.02 * Math.sin(ph + 0.9) * ((0.3 - ub) / 0.3) * bodyW;
        if (ub > 0.7) { dy += bh * 0.035 * Math.sin(ph - 0.7) * ((ub - 0.7) / 0.3) * bodyW; dx += bw * 0.015 * Math.sin(ph - 0.7) * ((ub - 0.7) / 0.3) * bodyW; }
        return [bx + dx * amount, by + dy * amount];
      });
    };

    const drawOpen = (alpha: number, sx: number, sy: number, rot: number, bounce: number, gallop: number) => {
      if (!art || alpha <= 0.01) return;
      const dpr = art.width / artW;
      const pts = gallop > 0.001 ? deformed(gallop) : base;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(x, ground - bounce);
      ctx.rotate(rot);
      ctx.scale(-sx / dpr, sy / dpr);          // flip: the art faces left, the race runs right
      ctx.translate(-art.width / 2, -art.height);
      for (const [i0, i1, i2] of tris) drawTri(ctx, art, [base[i0], base[i1], base[i2]], [pts[i0], pts[i1], pts[i2]]);
      ctx.restore();
    };

    const drawBall = (alpha: number, scale: number, sy: number, bounce: number) => {
      if (!ball || alpha <= 0.01) return;
      const d = ballR * 2 * scale;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(x, ground - ballR * scale * sy - bounce);
      ctx.rotate(rollAngle);
      ctx.drawImage(ball, -d / 2, -(d * sy) / 2, d, d * sy);
      ctx.restore();
    };

    const drawShadow = (halfW: number, bounce: number, open: boolean, alpha: number) => {
      const w = halfW * (1.05 - bounce / 80);
      ctx.save();
      ctx.globalAlpha = Math.max(0, (0.28 - bounce / 140)) * alpha;
      ctx.fillStyle = '#000';
      ctx.beginPath();
      ctx.ellipse(x, ground + 2, w, w * (open ? 0.18 : 0.26), 0, 0, TAU);
      ctx.fill();
      ctx.restore();
    };

    const frame = (now: number) => {
      if (!alive) return;
      raf = requestAnimationFrame(frame);
      if (!visible || !art) { last = now; return; }
      const dt = Math.min(0.05, (now - (last || now)) / 1000);
      last = now;
      t = (t + dt) % LOOP;
      if (t < dt) { x = -artW * 0.6; rollAngle = 0; dust.length = 0; }

      // Speeds in px/s, scaled to the lane so phones and desktops look the same.
      const runV = W * 0.22, rollV = W * 0.26;
      let openAlpha = 0, ballAlpha = 0, sx = 1, sy = 1, rot = 0, bounce = 0, gallop = 0;
      let ballScale = 1, fade = 1, v = runV;
      const ballSy = 1;

      if (t < RUN_END) {                                     // running
        openAlpha = 1;
        gallop = Math.min(1, t / 0.3);
      } else if (t < RUN_END + CURL) {                       // curling
        const k = clamp((t - RUN_END) / CURL, 0, 1), e = easeInOut(k);
        openAlpha = 1 - e; sx = 1 - e * 0.45; sy = 1 - e * 0.35; rot = e * 0.9;
        gallop = 1 - e;
        ballAlpha = e; ballScale = 0.55 + easeOutBack(k) * 0.45;
        bounce = Math.sin(k * Math.PI) * artH * 0.12;
        v = runV + (rollV - runV) * e;
      } else {                                               // rolling, then fade out
        ballAlpha = 1;
        bounce = Math.abs(Math.sin(t * 9)) * 1.8;
        v = rollV;
        fade = 1 - smoothstep(ROLL_END - 0.5, ROLL_END, t);
      }
      if (t < 0.25) fade = t / 0.25;
      if (t >= ROLL_END) fade = 0;

      x += v * dt;
      if (ballAlpha > 0) rollAngle += (v * dt) / ballR;

      if (gallop > 0) {
        const freq = 2.1 + 0.75 * 1.5;                       // strides per second at a brisk run
        stridePhase += TAU * freq * dt;
        const s = Math.sin(stridePhase), air = Math.max(0, s);
        bounce += Math.pow(air, 0.8) * artH * 0.13 * gallop;
        sx *= 1 + 0.05 * s * gallop;
        sy *= 1 - 0.045 * s * gallop;
        rot += (0.07 * 0.75 - 0.055 * Math.sin(stridePhase - 0.7)) * gallop;
        if (lastSin > 0 && s <= 0) for (let i = 0; i < 3; i++) dust.push({ x: x - artW * 0.3, y: ground, vx: -20 - Math.random() * 30, vy: -10 - Math.random() * 18, life: 1, r: 2 + Math.random() * 3 });
        lastSin = s;
      }
      if (t > RUN_END + CURL && t < ROLL_END - 0.4 && Math.random() < 0.35) dust.push({ x: x - ballR * 0.8, y: ground, vx: -30 - Math.random() * 30, vy: -8 - Math.random() * 12, life: 1, r: 1.5 + Math.random() * 2.5 });

      ctx.clearRect(0, 0, W, H);
      for (let i = dust.length - 1; i >= 0; i--) {
        const p = dust[i];
        p.life -= dt * 1.6; p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 30 * dt;
        if (p.life <= 0) { dust.splice(i, 1); continue; }
        ctx.globalAlpha = p.life * 0.35 * fade;
        ctx.fillStyle = '#b9a6e8';
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r * (1.4 - p.life * 0.4), 0, TAU); ctx.fill();
      }
      ctx.globalAlpha = 1;
      const isOpen = openAlpha > 0.5;
      drawShadow(isOpen ? (artW * sx) / 2 : ballR * ballScale, bounce, isOpen, fade);
      drawOpen(openAlpha * fade, sx, sy, rot, bounce, gallop);
      drawBall(ballAlpha * fade, ballScale, ballSy, bounce);
    };

    const drawStill = () => {
      if (!art) return;
      ctx.clearRect(0, 0, W, H);
      x = W * 0.4;
      drawShadow(artW / 2, 0, true, 1);
      drawOpen(1, 1, 1, 0, 0, 0);
    };

    resize().then(() => { if (!alive) return; if (still) drawStill(); else raf = requestAnimationFrame(frame); });
    const ro = new ResizeObserver(() => { resize().then(() => still && drawStill()); });
    ro.observe(canvas);
    const io = new IntersectionObserver(([e]) => { inView = e.isIntersecting; visible = inView && !document.hidden; });
    io.observe(canvas);
    const onVis = () => { visible = inView && !document.hidden; };
    document.addEventListener('visibilitychange', onVis);
    return () => { alive = false; cancelAnimationFrame(raf); ro.disconnect(); io.disconnect(); document.removeEventListener('visibilitychange', onVis); };
  }, [artSrc, ballSrc]);

  return <canvas ref={canvasRef} className={className} aria-hidden="true" />;
}
