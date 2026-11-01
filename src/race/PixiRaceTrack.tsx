import { useEffect, useRef } from 'react';
import {
  Application, Assets, Container, Graphics, MeshPlane, Sprite, Text, TilingSprite, Texture, FillGradient,
} from 'pixi.js';
import seedrandom from 'seedrandom';
import type { RaceSimulation, RacerSim } from './simulation';
import { BALL_SPRITES, BODY_ACCENT } from './sprites';
import { getTheme, type TrackTheme } from './themes';
import { cutoutImage } from './cutout';
import type { BBox } from './cutout-core';

export interface PixiRaceTrackProps {
  sim: RaceSimulation;
  /** when true the simulation advances every frame */
  running: boolean;
  terrain: string;
  /** called ~8× per second with the live simulation (for DOM HUD updates) */
  onTick?: (sim: RaceSimulation) => void;
  /** called as soon as the track scenery is drawn (racers may still be loading) */
  onSceneReady?: () => void;
  /** called once every racer is on the start line and the countdown can begin */
  onReady?: () => void;
  style?: React.CSSProperties;
  className?: string;
}

/* ------------------------------------------------------------------ */
/* Layout constants                                                    */
/* ------------------------------------------------------------------ */
const PX_PER_M = 16;
const START_X = 220;          // world x of the start line
const FINISH_PAD = 520;       // world space after the finish line
const LEAD_SCREEN_FRAC = 0.58; // leader is kept at this fraction of the view width
const SKY_FRAC = 0.24;         // share of the view height used by the sky/horizon
const INTRO_DISTANCE = 170;    // racers jog in from this far left of the start line
const INTRO_DURATION = 1.15;
const MESH_X = 7, MESH_Y = 11; // deformation grid for the open-pose artwork

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const easeOutBack = (t: number) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); };
const easeInOut = (t: number) => t * t * (3 - 2 * t);
const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const smoothstep = (a: number, b: number, x: number) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const TAU = Math.PI * 2;

/** multiply an 0xRRGGBB colour by a factor */
function shade(c: number, f: number): number {
  const r = clamp(Math.round(((c >> 16) & 255) * f), 0, 255);
  const g = clamp(Math.round(((c >> 8) & 255) * f), 0, 255);
  const b = clamp(Math.round((c & 255) * f), 0, 255);
  return (r << 16) | (g << 8) | b;
}
/** mix two colours */
function mix(a: number, b: number, t: number): number {
  const r = lerp((a >> 16) & 255, (b >> 16) & 255, t);
  const g = lerp((a >> 8) & 255, (b >> 8) & 255, t);
  const bl = lerp(a & 255, b & 255, t);
  return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(bl);
}

async function loadTexture(url: string | null): Promise<Texture | null> {
  if (!url) return null;
  try {
    return await Assets.load<Texture>({ src: url, parser: 'loadTextures' });
  } catch {
    return null;
  }
}

interface AvatarArt { texture: Texture; bbox: BBox }

/** NFT artwork with its flat background removed + the opaque bounding box. */
async function loadAvatarArt(url: string | null): Promise<AvatarArt | null> {
  if (!url) return null;
  const cut = await cutoutImage(url, 448);
  if (cut) return { texture: Texture.from(cut.canvas), bbox: cut.bbox };
  const tex = await loadTexture(url);
  return tex ? { texture: tex, bbox: { x: 0, y: 0, w: tex.width, h: tex.height } } : null;
}

function softCircleTexture(app: Application, radius = 16): Texture {
  const g = new Graphics();
  for (let i = 4; i >= 1; i--) {
    g.circle(radius, radius, (radius * i) / 4).fill({ color: 0xffffff, alpha: 0.22 });
  }
  return app.renderer.generateTexture(g);
}

interface Particle {
  sprite: Sprite;
  vx: number; vy: number;
  life: number; maxLife: number;
  grow: number;
}

interface Ambient {
  node: Container;
  x: number; y: number;
  vx: number; vy: number;
  phase: number; speed: number; amp: number;
}

interface RacerView {
  sim: RacerSim;
  root: Container;
  shadow: Graphics;
  open: MeshPlane | null;
  openBase: Float32Array | null;
  openBBox: BBox | null;
  openBaseScale: number;
  ball: Sprite;
  speedLines: Graphics;
  tag: Container;
  tagW: number;
  posBadge: Graphics;
  posText: Text;
  youRing: Graphics | null;
  laneIndex: number;
  lastX: number;
  rollAngle: number;
  dustTimer: number;
  lastPos: number;
  settleX: number | null;
  ballRadius: number;
  stridePhase: number;
  lastStrideSin: number;
  deformed: boolean;
  introAt: number;
}

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */
export default function PixiRaceTrack({ sim, running, terrain, onTick, onSceneReady, onReady, style, className }: PixiRaceTrackProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const runningRef = useRef(running);
  const onTickRef = useRef(onTick);
  const onSceneReadyRef = useRef(onSceneReady);
  const onReadyRef = useRef(onReady);
  runningRef.current = running;
  onTickRef.current = onTick;
  onSceneReadyRef.current = onSceneReady;
  onReadyRef.current = onReady;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let cancelled = false;
    let app: Application | null = null;
    const theme: TrackTheme = getTheme(terrain);

    // kick off the (slow) avatar preparation immediately, in parallel with everything else
    const avatarPromise = Promise.all(sim.racers.map(r => loadAvatarArt(r.avatarUrl)));

    (async () => {
      const a = new Application();
      await a.init({
        resizeTo: host,
        backgroundAlpha: 0,
        antialias: true,
        resolution: Math.min(2, window.devicePixelRatio || 1),
        autoDensity: true,
        preference: 'webgl',
      });
      if (cancelled) { a.destroy(true); return; }
      app = a;
      if (import.meta.env.DEV) (window as unknown as { __pangsApp?: Application }).__pangsApp = a; // dev-only: pause/slow the ticker from the console
      host.appendChild(a.canvas);
      a.canvas.style.display = 'block';
      a.canvas.style.width = '100%';
      a.canvas.style.height = '100%';

      /* ---------- small local textures (fast) ---------- */
      const [groundTex, ...ballTexList] = await Promise.all([
        loadTexture(theme.groundTexture),
        ...Object.values(BALL_SPRITES).map(loadTexture),
      ]);
      if (cancelled) return;
      const ballTex: Record<string, Texture | null> = {};
      Object.keys(BALL_SPRITES).forEach((k, i) => { ballTex[k] = ballTexList[i]; });
      const dustTex = softCircleTexture(a, 14);

      /* ---------- scene graph ---------- */
      const sky = new Graphics();
      const celestial = new Container();     // sun/moon + rays (screen space)
      const farLayer = new Container();      // mountains, parallax 0.12
      const cloudLayer = new Container();    // drifting clouds, parallax 0.18
      const treelineLayer = new Container(); // silhouette band, parallax 0.32
      const midLayer = new Container();      // trees, parallax 0.55
      const ambientLayer = new Container();  // leaves / embers / fireflies (screen space)
      const world = new Container();         // parallax 1
      const groundLayer = new Container();   // screen space, texture scrolls
      const laneLayer = new Graphics();
      const decorBack = new Container();
      const buntingLayer = new Container();
      const racerLayer = new Container();
      racerLayer.sortableChildren = true;
      const particleLayer = new Container();
      const decorFront = new Container();
      const vignette = new Graphics();

      a.stage.addChild(sky, celestial, farLayer, cloudLayer, treelineLayer, midLayer, ambientLayer, world, vignette);
      world.addChild(groundLayer, laneLayer, decorBack, buntingLayer, racerLayer, particleLayer, decorFront);

      let ground: TilingSprite | null = null;
      let roadTop = 0, roadBottom = 0, laneH = 0, viewW = 0, viewH = 0, horizon = 0;
      const worldLength = START_X + sim.totalDistance * PX_PER_M + FINISH_PAD;
      const finishX = START_X + sim.totalDistance * PX_PER_M;
      let camX = 0;
      let elapsed = 0;
      let tickAcc = 0;
      const particles: Particle[] = [];
      const ambients: Ambient[] = [];
      const clouds: { node: Container; speed: number; span: number }[] = [];
      const flags: { node: Graphics; seed: number }[] = [];
      let rays: Graphics | null = null;
      const views: RacerView[] = [];
      let avatarArt: (AvatarArt | null)[] | null = null;

      /* ============================== SKY ============================== */
      const drawSky = () => {
        sky.clear();
        const grad = new FillGradient({
          type: 'linear', start: { x: 0, y: 0 }, end: { x: 0, y: 1 }, textureSpace: 'local',
          colorStops: [
            { offset: 0, color: theme.skyTop },
            { offset: 0.65, color: mix(theme.skyTop, theme.skyBottom, 0.55) },
            { offset: 1, color: theme.skyBottom },
          ],
        });
        sky.rect(0, 0, viewW, horizon + 8).fill(grad);
        // ground colour below the horizon so parallax gaps never show through
        sky.rect(0, horizon, viewW, viewH - horizon).fill(shade(theme.groundColor, 0.75));
        if (theme.stars) {
          const rng = seedrandom('stars');
          for (let i = 0; i < 160; i++) {
            const x = rng() * viewW, y = rng() * horizon * 0.9, r = 0.5 + rng() * 1.3;
            sky.circle(x, y, r).fill({ color: 0xffffff, alpha: 0.3 + rng() * 0.6 });
          }
          // milky way band
          for (let i = 0; i < 90; i++) {
            const x = rng() * viewW, y = horizon * (0.15 + rng() * 0.35) + Math.sin(x / viewW * 3) * 18;
            sky.circle(x, y, 0.6 + rng() * 1.6).fill({ color: 0xcfd8ff, alpha: 0.12 + rng() * 0.25 });
          }
        }
        // atmospheric haze right above the horizon
        const haze = new FillGradient({
          type: 'linear', start: { x: 0, y: 0 }, end: { x: 0, y: 1 }, textureSpace: 'local',
          colorStops: [{ offset: 0, color: 'rgba(255,255,255,0)' }, { offset: 1, color: theme.skyBottom }],
        });
        sky.rect(0, horizon - 70, viewW, 70).fill(haze);
      };

      const drawCelestial = () => {
        celestial.removeChildren();
        rays = null;
        const sx = viewW * theme.sun.x, sy = horizon * theme.sun.y;
        const rad = Math.max(22, viewH * 0.045);
        const glow = new Graphics();
        const gr = rad * 4.2;
        // layered translucent discs give a soft bloom without a radial-gradient texture
        for (let i = 6; i >= 1; i--) {
          glow.circle(sx, sy, (gr * i) / 6).fill({ color: theme.sun.glow, alpha: 0.04 });
        }
        celestial.addChild(glow);
        if (theme.sun.rays) {
          rays = new Graphics();
          for (let i = 0; i < 7; i++) {
            const ang = Math.PI * 0.55 + (i - 3) * 0.17;
            const len = viewH * 1.1;
            const w = 0.045 + (i % 2) * 0.03;
            rays.poly([
              sx, sy,
              sx + Math.cos(ang - w) * len, sy + Math.sin(ang - w) * len,
              sx + Math.cos(ang + w) * len, sy + Math.sin(ang + w) * len,
            ]).fill({ color: theme.sun.glow, alpha: 0.07 });
          }
          celestial.addChild(rays);
        }
        const disc = new Graphics();
        disc.circle(sx, sy, rad * 1.12).fill({ color: theme.sun.glow, alpha: 0.5 });
        disc.circle(sx, sy, rad).fill(theme.sun.color);
        if (theme.stars) {
          // moon craters
          disc.circle(sx - rad * 0.3, sy - rad * 0.2, rad * 0.18).fill({ color: 0x000000, alpha: 0.08 });
          disc.circle(sx + rad * 0.25, sy + rad * 0.3, rad * 0.12).fill({ color: 0x000000, alpha: 0.08 });
          disc.circle(sx + rad * 0.2, sy - rad * 0.4, rad * 0.09).fill({ color: 0x000000, alpha: 0.08 });
        }
        celestial.addChild(disc);
      };

      const drawVignette = () => {
        vignette.clear();
        const g = new FillGradient({
          type: 'linear', start: { x: 0, y: 0 }, end: { x: 0, y: 1 }, textureSpace: 'local',
          colorStops: [{ offset: 0, color: 'rgba(0,0,0,0)' }, { offset: 1, color: 'rgba(0,0,0,0.55)' }],
        });
        vignette.rect(0, viewH - 46, viewW, 46).fill(g);
        // subtle side darkening for a cinematic frame
        const l = new FillGradient({
          type: 'linear', start: { x: 0, y: 0 }, end: { x: 1, y: 0 }, textureSpace: 'local',
          colorStops: [{ offset: 0, color: 'rgba(0,0,0,0.28)' }, { offset: 1, color: 'rgba(0,0,0,0)' }],
        });
        vignette.rect(0, 0, 70, viewH).fill(l);
        const r = new FillGradient({
          type: 'linear', start: { x: 0, y: 0 }, end: { x: 1, y: 0 }, textureSpace: 'local',
          colorStops: [{ offset: 0, color: 'rgba(0,0,0,0)' }, { offset: 1, color: 'rgba(0,0,0,0.28)' }],
        });
        vignette.rect(viewW - 70, 0, 70, viewH).fill(r);
      };

      /* ============================ DISTANCE ============================ */
      const ridge = (g: Graphics, span: number, base: number, amp: number, freq: number, seed: number, color: number, alpha: number, jag = 0) => {
        g.moveTo(0, base + 200);
        for (let x = 0; x <= span; x += 18) {
          let y = base
            - (Math.sin(x * freq + seed) * 0.6 + Math.sin(x * freq * 2.3 + seed * 1.7) * 0.3 + Math.sin(x * freq * 5.1 + seed * 0.4) * 0.1) * amp;
          if (jag) y -= Math.abs(Math.sin(x * freq * 9 + seed)) * amp * jag;
          g.lineTo(x, y);
        }
        g.lineTo(span, base + 200).closePath().fill({ color, alpha });
      };

      const buildFarLayer = () => {
        farLayer.removeChildren();
        const span = worldLength * 0.12 + viewW * 2;
        theme.farHills.forEach((color, idx) => {
          const g = new Graphics();
          const amp = (46 - idx * 8) * (viewH / 600);
          const base = horizon - 6 + idx * 6;
          const hazeColor = mix(color, theme.skyBottom, 0.35 - idx * 0.15);
          ridge(g, span, base, amp, 0.0032 + idx * 0.0012, idx * 3.1, hazeColor, 1, theme.id === 'volcanic' ? 0.5 : 0.25);
          // snow / glow caps on the far range
          if (idx === 0 && theme.id !== 'desert') {
            const caps = new Graphics();
            ridge(caps, span, base - 2, amp, 0.0032, 0, theme.id === 'volcanic' ? theme.sun.glow : 0xffffff, 0.18, 0.25);
            caps.mask = null;
            farLayer.addChild(caps);
          }
          farLayer.addChild(g);
        });
      };

      const makeCloud = (w: number, tint: number) => {
        const g = new Graphics();
        const h = w * 0.32;
        const under = mix(tint, theme.skyBottom, 0.45);
        // shaded underside
        g.ellipse(0, h * 0.25, w * 0.5, h * 0.42).fill({ color: under, alpha: 0.9 });
        g.ellipse(w * 0.22, h * 0.2, w * 0.3, h * 0.36).fill({ color: under, alpha: 0.9 });
        // lit top
        g.ellipse(-w * 0.1, 0, w * 0.42, h * 0.5).fill({ color: tint, alpha: 0.95 });
        g.ellipse(w * 0.2, -h * 0.15, w * 0.3, h * 0.45).fill({ color: tint, alpha: 0.95 });
        g.ellipse(-w * 0.35, h * 0.1, w * 0.22, h * 0.35).fill({ color: tint, alpha: 0.95 });
        g.rect(-w * 0.5, h * 0.35, w, h * 0.3).fill({ color: under, alpha: 0.9 });
        return g;
      };

      const buildClouds = () => {
        cloudLayer.removeChildren();
        clouds.length = 0;
        if (theme.cloud === null) return;
        const span = worldLength * 0.18 + viewW * 2;
        const rng = seedrandom(`clouds:${theme.id}`);
        for (let i = 0; i < 14; i++) {
          const w = 70 + rng() * 120;
          const c = makeCloud(w, theme.cloud);
          c.x = rng() * span;
          c.y = 14 + rng() * horizon * 0.5;
          c.alpha = theme.stars ? 0.35 : 0.85;
          c.scale.set(0.8 + rng() * 0.5);
          cloudLayer.addChild(c);
          clouds.push({ node: c, speed: 4 + rng() * 6, span });
        }
      };

      const buildTreeline = () => {
        treelineLayer.removeChildren();
        const g = new Graphics();
        const span = worldLength * 0.32 + viewW * 2;
        const color = mix(theme.treeline, theme.skyBottom, 0.18);
        const rng = seedrandom(`treeline:${theme.id}`);
        const base = horizon + 4;
        g.rect(0, base - 4, span, 40).fill(color);
        for (let x = 0; x < span; x += 14) {
          const h = (theme.decor === 'pines' ? 26 : theme.decor === 'cacti' ? 10 : theme.decor === 'rocks' ? 16 : 20) * (0.7 + rng() * 0.8);
          if (theme.decor === 'pines') g.poly([x, base - h, x - 9, base + 2, x + 9, base + 2]).fill(color);
          else if (theme.decor === 'rocks') g.poly([x - 9, base + 2, x - 3, base - h, x + 5, base - h * 0.7, x + 10, base + 2]).fill(color);
          else g.circle(x, base - h * 0.5, h * 0.55).fill(color);
        }
        treelineLayer.addChild(g);
      };

      /* ============================= DECOR ============================= */
      const treeAt = (g: Graphics, x: number, y: number, s: number, color: number) => {
        const dark = shade(color, 0.72), light = shade(color, 1.22);
        // tapered trunk with a shaded side
        g.poly([x - 4 * s, y, x - 2.4 * s, y - 22 * s, x + 2.4 * s, y - 22 * s, x + 4 * s, y]).fill(theme.trunk);
        g.poly([x, y, x, y - 22 * s, x + 2.4 * s, y - 22 * s, x + 4 * s, y]).fill(shade(theme.trunk, 0.7));
        // canopy: shadow pass, body pass, highlight pass
        const blobs: [number, number, number][] = [[0, -34, 15], [-11, -25, 11], [11, -26, 12], [-5, -42, 9], [6, -41, 8]];
        for (const [bx, by, br] of blobs) g.circle(x + bx * s + 2 * s, y + by * s + 3 * s, br * s).fill(dark);
        for (const [bx, by, br] of blobs) g.circle(x + bx * s, y + by * s, br * s).fill(color);
        g.circle(x - 6 * s, y - 40 * s, 6 * s).fill({ color: light, alpha: 0.7 });
        g.circle(x + 3 * s, y - 45 * s, 4 * s).fill({ color: light, alpha: 0.6 });
        g.circle(x - 13 * s, y - 29 * s, 4 * s).fill({ color: light, alpha: 0.45 });
      };
      const pineAt = (g: Graphics, x: number, y: number, s: number, color: number) => {
        const dark = shade(color, 0.7), light = shade(color, 1.3);
        g.rect(x - 2 * s, y - 12 * s, 4 * s, 12 * s).fill(theme.trunk);
        const tiers: [number, number, number][] = [[-10, 18, 48], [-28, 14, 42], [-42, 10, 56]];
        for (const [ty, w, _h] of tiers) {
          const top = y + (ty - 18) * s, bottom = y + ty * s;
          g.poly([x, top, x - w * s, bottom, x + w * s, bottom]).fill(color);
          g.poly([x, top, x, bottom, x + w * s, bottom]).fill(dark);
          g.poly([x, top, x - w * s * 0.35, bottom - (bottom - top) * 0.25, x - w * s * 0.2, bottom - (bottom - top) * 0.1]).fill({ color: light, alpha: 0.35 });
          void _h;
        }
      };
      const cactusAt = (g: Graphics, x: number, y: number, s: number, color: number) => {
        const dark = shade(color, 0.75);
        g.roundRect(x - 5 * s, y - 36 * s, 10 * s, 36 * s, 5 * s).fill(color);
        g.roundRect(x, y - 36 * s, 5 * s, 36 * s, 5 * s).fill({ color: dark, alpha: 0.6 });
        g.roundRect(x - 17 * s, y - 26 * s, 8 * s, 14 * s, 4 * s).fill(color);
        g.roundRect(x - 17 * s, y - 26 * s, 15 * s, 6 * s, 3 * s).fill(color);
        g.roundRect(x + 9 * s, y - 30 * s, 8 * s, 12 * s, 4 * s).fill(color);
        g.roundRect(x + 2 * s, y - 30 * s, 15 * s, 6 * s, 3 * s).fill(color);
        for (let i = 0; i < 3; i++) g.rect(x - 3 * s + i * 2.5 * s, y - 34 * s, 0.8 * s, 32 * s).fill({ color: dark, alpha: 0.5 });
        g.circle(x, y - 37 * s, 2 * s).fill(0xff7aa8);
      };
      const rockAt = (g: Graphics, x: number, y: number, s: number, color: number) => {
        g.poly([x - 18 * s, y, x - 12 * s, y - 14 * s, x + 2 * s, y - 22 * s, x + 15 * s, y - 9 * s, x + 19 * s, y]).fill(color);
        g.poly([x + 2 * s, y - 22 * s, x + 15 * s, y - 9 * s, x + 19 * s, y, x + 2 * s, y]).fill(shade(color, 0.72));
        g.poly([x - 12 * s, y - 14 * s, x + 2 * s, y - 22 * s, x + 3 * s, y - 13 * s]).fill({ color: 0xffffff, alpha: 0.1 });
        if (theme.ember) {
          g.moveTo(x - 8 * s, y - 3 * s).lineTo(x - 2 * s, y - 9 * s).lineTo(x + 6 * s, y - 4 * s).stroke({ color: theme.ember, alpha: 0.8, width: 1.5 * s });
        }
      };
      const drawDecor = (g: Graphics, x: number, y: number, s: number, color: number) => {
        switch (theme.decor) {
          case 'trees': return treeAt(g, x, y, s, color);
          case 'pines': return pineAt(g, x, y, s, color);
          case 'cacti': return cactusAt(g, x, y, s, color);
          case 'rocks': return rockAt(g, x, y, s, color);
        }
      };
      const tuftAt = (g: Graphics, x: number, y: number, s: number, color: number) => {
        for (let i = -2; i <= 2; i++) {
          const h = (8 - Math.abs(i) * 2) * s;
          g.poly([x + i * 3 * s - 1.5 * s, y, x + i * 3 * s + i * 1.5 * s, y - h, x + i * 3 * s + 1.5 * s, y]).fill(color);
        }
      };

      const buildMidLayer = () => {
        midLayer.removeChildren();
        const g = new Graphics();
        const span = worldLength * 0.55 + viewW * 2;
        const rng = seedrandom(`mid:${theme.id}`);
        const y = horizon + 10;
        for (let x = -60; x < span; x += 38 + rng() * 54) {
          const s = 0.55 + rng() * 0.45;
          const c = mix(theme.decorColors[Math.floor(rng() * theme.decorColors.length)], theme.skyBottom, 0.22);
          drawDecor(g, x, y + rng() * 6, s, c);
        }
        if (theme.id === 'volcanic') {
          // smoke columns from behind the rocks
          for (let i = 0; i < 6; i++) {
            const x = rng() * span;
            for (let k = 0; k < 5; k++) g.circle(x + k * 6 - 12, y - 20 - k * 16, 10 + k * 5).fill({ color: 0x3a2a2a, alpha: 0.25 - k * 0.04 });
          }
        }
        midLayer.addChild(g);
      };

      const buildAmbient = () => {
        ambientLayer.removeChildren();
        ambients.length = 0;
        const rng = seedrandom(`ambient:${theme.id}`);
        const count = theme.ambient === 'fireflies' ? 26 : theme.ambient === 'embers' ? 30 : 20;
        for (let i = 0; i < count; i++) {
          let node: Container;
          const color = theme.ambientColors[Math.floor(rng() * theme.ambientColors.length)];
          if (theme.ambient === 'leaves') {
            const g = new Graphics();
            g.ellipse(0, 0, 4.5, 2.2).fill(color);
            g.rotation = rng() * TAU;
            node = g;
          } else {
            const s = new Sprite(dustTex);
            s.anchor.set(0.5);
            s.tint = color;
            s.scale.set(theme.ambient === 'sand' ? 0.9 + rng() * 0.8 : 0.22 + rng() * 0.22);
            node = s;
          }
          node.alpha = theme.ambient === 'sand' ? 0.25 : 0.8;
          const am: Ambient = {
            node,
            x: rng() * viewW, y: rng() * viewH,
            vx: theme.ambient === 'sand' ? -(60 + rng() * 60) : theme.ambient === 'leaves' ? -(18 + rng() * 16) : (rng() - 0.5) * 10,
            vy: theme.ambient === 'embers' ? -(22 + rng() * 26) : theme.ambient === 'leaves' ? 16 + rng() * 14 : theme.ambient === 'sand' ? 0 : 0,
            phase: rng() * TAU, speed: 0.8 + rng() * 1.6, amp: theme.ambient === 'fireflies' ? 18 : 8,
          };
          ambientLayer.addChild(node);
          ambients.push(am);
        }
      };

      /* ============================== TRACK ============================== */
      const buildGround = () => {
        groundLayer.removeChildren();
        const top = roadTop - 30, h = roadBottom - roadTop + 60;
        if (groundTex) {
          ground = new TilingSprite({ texture: groundTex, width: viewW + 4, height: h });
          ground.tileScale.set(0.4);
          ground.y = top;
          groundLayer.addChild(ground);
        } else {
          ground = null;
          const g = new Graphics();
          g.rect(0, top, viewW + 4, h).fill(theme.groundColor);
          groundLayer.addChild(g);
        }
        const shade_ = new Graphics();
        shade_.rect(0, roadTop, viewW + 4, roadBottom - roadTop).fill({ color: 0x000000, alpha: theme.roadShade });
        for (let i = 0; i < sim.racers.length; i++) {
          if (i % 2 === 0) continue;
          shade_.rect(0, roadTop + laneH * i, viewW + 4, laneH).fill({ color: 0xffffff, alpha: 0.05 });
        }
        // inner shadow cast by the fence along the top edge
        const sh = new FillGradient({
          type: 'linear', start: { x: 0, y: 0 }, end: { x: 0, y: 1 }, textureSpace: 'local',
          colorStops: [{ offset: 0, color: 'rgba(0,0,0,0.32)' }, { offset: 1, color: 'rgba(0,0,0,0)' }],
        });
        shade_.rect(0, roadTop, viewW + 4, 22).fill(sh);
        shade_.rect(0, roadTop - 4, viewW + 4, 6).fill({ color: theme.edgeColor, alpha: 0.9 });
        shade_.rect(0, roadBottom - 2, viewW + 4, 8).fill({ color: theme.edgeColor, alpha: 0.9 });
        groundLayer.addChild(shade_);
      };

      const buildLanes = () => {
        laneLayer.clear();
        for (let i = 1; i < sim.racers.length; i++) {
          const y = roadTop + laneH * i;
          for (let x = 0; x < worldLength; x += 56) {
            laneLayer.rect(x, y - 1.5, 32, 3).fill({ color: theme.laneLine, alpha: theme.laneLineAlpha });
          }
        }
        laneLayer.rect(START_X - 4, roadTop, 8, roadBottom - roadTop).fill({ color: 0xffffff, alpha: 0.85 });
        const cell = 12;
        for (let yy = roadTop; yy < roadBottom; yy += cell) {
          for (let c = 0; c < 3; c++) {
            const dark = (Math.floor((yy - roadTop) / cell) + c) % 2 === 0;
            laneLayer.rect(finishX + c * cell, yy, cell, Math.min(cell, roadBottom - yy)).fill(dark ? 0x111111 : 0xffffff);
          }
        }
        for (let m = 50; m < sim.totalDistance; m += 50) {
          const x = START_X + m * PX_PER_M;
          laneLayer.rect(x - 1, roadTop - 14, 2, 14).fill({ color: 0xffffff, alpha: 0.5 });
        }
      };

      const makeBanner = (x: number, label: string, color: number) => {
        const c = new Container();
        const g = new Graphics();
        const h = roadBottom - roadTop;
        // posts with candy stripes
        for (const px of [x - 8, x + 8]) {
          g.rect(px - 4, roadTop - 78, 8, h + 78).fill(0xe8e8ee);
          for (let yy = roadTop - 78; yy < roadTop + h; yy += 24) g.rect(px - 4, yy, 8, 12).fill(shade(color, 0.9));
        }
        g.roundRect(x - 96, roadTop - 100, 192, 36, 8).fill(shade(color, 0.8));
        g.roundRect(x - 96, roadTop - 104, 192, 36, 8).fill(color);
        g.roundRect(x - 96, roadTop - 104, 192, 36, 8).stroke({ color: 0xffffff, alpha: 0.4, width: 2 });
        c.addChild(g);
        const t = new Text({ text: label, style: { fontFamily: 'Outfit, Inter, sans-serif', fontSize: 20, fontWeight: '900', fill: 0xffffff, letterSpacing: 3 } });
        t.anchor.set(0.5); t.x = x; t.y = roadTop - 86; t.resolution = 2;
        c.addChild(t);
        return c;
      };

      const crowdAt = (g: Graphics, cx: number, half: number, rng: () => number) => {
        const y = roadTop - 10;
        const palette = [0xff6b6b, 0xffd166, 0x06d6a0, 0x4cc9f0, 0xf72585, 0xffffff, 0x9b5de5, 0xf7b267];
        // stand
        g.rect(cx - half - 10, y - 18, half * 2 + 20, 22).fill(shade(theme.fence, 0.8));
        g.rect(cx - half - 10, y - 20, half * 2 + 20, 3).fill(shade(theme.fence, 1.2));
        for (let row = 1; row >= 0; row--) {
          for (let x = cx - half; x < cx + half; x += 11 + rng() * 5) {
            const body = palette[Math.floor(rng() * palette.length)];
            const skin = [0xf1c27d, 0xe0ac69, 0xc68642, 0x8d5524, 0xffdbac][Math.floor(rng() * 5)];
            const by = y - 18 - row * 12 + rng() * 3;
            g.roundRect(x - 5, by - 12, 10, 12, 3).fill(body);
            g.circle(x, by - 16, 4.5).fill(skin);
            if (rng() < 0.35) { // raised arm with a flag
              g.rect(x + 4, by - 24, 1.5, 12).fill(skin);
              g.poly([x + 5, by - 24, x + 13, by - 21, x + 5, by - 18]).fill(theme.bunting[Math.floor(rng() * theme.bunting.length)]);
            }
          }
        }
      };

      const buildTracksideDecor = () => {
        decorBack.removeChildren();
        decorFront.removeChildren();
        buntingLayer.removeChildren();
        flags.length = 0;
        const rng = seedrandom(`side:${theme.id}`);

        // big trees right behind the fence
        const back = new Graphics();
        for (let x = -60; x < worldLength; x += 70 + rng() * 90) {
          const s = 1.15 + rng() * 0.75;
          drawDecor(back, x, roadTop - 14, s, theme.decorColors[Math.floor(rng() * theme.decorColors.length)]);
        }
        // grass tufts along the top verge
        for (let x = 0; x < worldLength; x += 26 + rng() * 40) tuftAt(back, x, roadTop - 3, 0.9 + rng() * 0.6, shade(theme.decorColors[1], 1.1));
        decorBack.addChild(back);

        // crowd stands near the start and the finish
        const crowd = new Graphics();
        crowdAt(crowd, START_X + 230, 170, rng);
        crowdAt(crowd, finishX - 250, 190, rng);
        crowdAt(crowd, finishX + 170, 110, rng);
        decorBack.addChild(crowd);

        // rail fence along the top edge
        const fence = new Graphics();
        const railY = roadTop - 10;
        fence.rect(0, railY - 14, worldLength, 3).fill(theme.fence);
        fence.rect(0, railY - 5, worldLength, 3).fill(theme.fence);
        for (let x = 10; x < worldLength; x += 96) {
          fence.rect(x - 2.5, railY - 24, 5, 26).fill(shade(theme.fence, 0.85));
          fence.rect(x - 2.5, railY - 24, 2, 26).fill(shade(theme.fence, 1.15));
        }
        decorBack.addChild(fence);

        decorBack.addChild(makeBanner(START_X, 'START', 0x5432d3));
        decorBack.addChild(makeBanner(finishX + 18, 'FINISH', 0xc0392b));

        for (let m = 50; m < sim.totalDistance; m += 50) {
          const x = START_X + m * PX_PER_M;
          const sign = new Graphics();
          sign.roundRect(x - 18, roadTop - 44, 36, 18, 4).fill(0x1b1b24);
          sign.roundRect(x - 18, roadTop - 44, 36, 18, 4).stroke({ color: 0xffffff, alpha: 0.35, width: 1 });
          sign.rect(x - 1.5, roadTop - 26, 3, 14).fill(0x9a9aa8);
          decorBack.addChild(sign);
          const t = new Text({ text: `${m}m`, style: { fontFamily: 'Inter, sans-serif', fontSize: 11, fontWeight: '800', fill: 0xffffff } });
          t.anchor.set(0.5); t.x = x; t.y = roadTop - 35; t.resolution = 2;
          decorBack.addChild(t);
        }

        // bunting strings over the start and finish zones
        const bunting = (from: number, to: number) => {
          const y0 = roadTop - 112;
          const line = new Graphics();
          const sag = 14;
          line.moveTo(from, y0);
          for (let x = from; x <= to; x += 12) {
            const k = (x - from) / (to - from);
            line.lineTo(x, y0 + Math.sin(k * Math.PI) * sag);
          }
          line.stroke({ color: 0xffffff, alpha: 0.6, width: 1.5 });
          buntingLayer.addChild(line);
          for (let x = from + 10; x < to; x += 18) {
            const k = (x - from) / (to - from);
            const f = new Graphics();
            f.poly([0, 0, 12, 0, 6, 16]).fill(theme.bunting[Math.floor(rng() * theme.bunting.length)]);
            f.x = x - 6; f.y = y0 + Math.sin(k * Math.PI) * sag;
            buntingLayer.addChild(f);
            flags.push({ node: f, seed: rng() * TAU });
          }
        };
        bunting(START_X - 150, START_X + 420);
        bunting(finishX - 460, finishX + 300);

        // front edge: bushes / rocks / tufts peeking over the bottom edge
        const front = new Graphics();
        for (let x = 0; x < worldLength; x += 90 + rng() * 140) {
          const color = theme.decorColors[Math.floor(rng() * theme.decorColors.length)];
          const s = 0.35 + rng() * 0.3;
          if (theme.decor === 'rocks') rockAt(front, x, roadBottom + 18 * s, s, color);
          else {
            front.circle(x, roadBottom + 6, 16 * s * 1.6).fill(shade(color, 0.85));
            front.circle(x + 14 * s, roadBottom + 8, 12 * s * 1.6).fill(color);
            front.circle(x - 8 * s, roadBottom + 2, 8 * s * 1.6).fill({ color: shade(color, 1.2), alpha: 0.8 });
          }
        }
        for (let x = 0; x < worldLength; x += 30 + rng() * 50) tuftAt(front, x, roadBottom + 6, 1 + rng() * 0.6, shade(theme.decorColors[0], 1.15));
        decorFront.addChild(front);
      };

      /* ============================= RACERS ============================= */
      const buildRacers = () => {
        racerLayer.removeChildren();
        views.length = 0;
        sim.racers.forEach((r, i) => {
          const root = new Container();
          root.zIndex = i;
          const accent = BODY_ACCENT[r.body] ?? 0xffffff;

          const shadow = new Graphics();
          root.addChild(shadow);

          const speedLines = new Graphics();
          root.addChild(speedLines);

          let youRing: Graphics | null = null;
          if (r.isPlayer) {
            youRing = new Graphics();
            root.addChild(youRing);
          }

          const ballRadius = laneH * 0.46;
          const bt = ballTex[r.body] ?? ballTex.Brown;
          const ball = new Sprite(bt ?? Texture.WHITE);
          ball.anchor.set(0.5);
          ball.width = ballRadius * 2; ball.height = ballRadius * 2;
          ball.y = -ballRadius;
          ball.alpha = 0;
          root.addChild(ball);

          let open: MeshPlane | null = null;
          let openBase: Float32Array | null = null;
          let openBBox: BBox | null = null;
          let openBaseScale = 1;
          const art = avatarArt?.[i] ?? null;
          if (art) {
            open = new MeshPlane({ texture: art.texture, verticesX: MESH_X, verticesY: MESH_Y });
            openBase = Float32Array.from(open.geometry.positions);
            openBBox = art.bbox;
            // pivot at the feet (bottom centre of the opaque pixels)
            open.pivot.set(art.bbox.x + art.bbox.w / 2, art.bbox.y + art.bbox.h);
            const targetH = laneH * 1.02;            // body height on screen (a hint of overlap into the lane above is fine)
            openBaseScale = targetH / art.bbox.h;
            open.scale.set(-openBaseScale, openBaseScale); // artwork faces left → flip to run right
            root.addChild(open);
          }

          // trailing name plate
          const tag = new Container();
          const isPlayer = r.isPlayer;
          const tagBg = new Graphics();
          const label = r.name.length > 16 ? r.name.slice(0, 15) + '…' : r.name;
          const tagText = new Text({ text: label, style: { fontFamily: 'Inter, sans-serif', fontSize: 11, fontWeight: isPlayer ? '800' : '600', fill: isPlayer ? 0x1a1200 : 0xffffff } });
          tagText.resolution = 2;
          tagText.anchor.set(0, 0.5);
          const posBadge = new Graphics();
          const posText = new Text({ text: String(r.number), style: { fontFamily: 'Outfit, Inter, sans-serif', fontSize: 11, fontWeight: '900', fill: 0xffffff } });
          posText.resolution = 2;
          posText.anchor.set(0.5);
          const w = tagText.width + 34;
          tagBg.roundRect(0, -10, w, 20, 10).fill(isPlayer ? { color: 0xffd54a, alpha: 0.95 } : { color: 0x0b0b14, alpha: 0.6 });
          tagBg.roundRect(0, -10, w, 20, 10).stroke({ color: accent, alpha: isPlayer ? 0 : 0.6, width: 1.2 });
          posBadge.circle(11, 0, 9).fill(accent);
          posText.x = 11;
          tagText.x = 24;
          tag.addChild(tagBg, posBadge, posText, tagText);
          tag.x = -w;
          root.addChild(tag);

          racerLayer.addChild(root);
          views.push({
            sim: r, root, shadow, open, openBase, openBBox, openBaseScale, ball, speedLines, tag, tagW: w, posBadge, posText, youRing,
            laneIndex: i, lastX: START_X - INTRO_DISTANCE, rollAngle: 0, dustTimer: 0, lastPos: i + 1, settleX: null, ballRadius,
            stridePhase: i * 1.3, lastStrideSin: 0, deformed: false, introAt: elapsed,
          });
        });
      };

      /**
       * Gallop deformation of the open-pose artwork. `amount` 0..1 blends the
       * effect in/out; texture space has the head at low x (we flip on screen).
       */
      const deformOpen = (v: RacerView, amount: number) => {
        const m = v.open!, base = v.openBase!, bb = v.openBBox!;
        const buf = m.geometry.getBuffer('aPosition');
        const pos = buf.data as Float32Array;
        if (amount <= 0.001) {
          if (!v.deformed) return;
          pos.set(base);
          buf.update();
          v.deformed = false;
          return;
        }
        v.deformed = true;
        const ph = v.stridePhase;
        const s = Math.sin(ph);
        const swingA = bb.w * 0.085, liftA = bb.h * 0.05;
        for (let i = 0; i < base.length; i += 2) {
          const bx = base[i], by = base[i + 1];
          const ub = clamp((bx - bb.x) / bb.w, 0, 1);   // 0 = head … 1 = tail
          const vb = clamp((by - bb.y) / bb.h, 0, 1);   // 0 = back … 1 = feet
          const legW = smoothstep(0.58, 1, vb);
          const bodyW = 1 - legW;
          const front = ub < 0.5 ? 1 : -1;              // front legs vs hind legs move in opposition
          const swing = front * s;                       // > 0 → this leg is reaching forward (screen +x)
          let dx = -swing * legW * swingA;               // texture −x is screen forward (flipped)
          let dy = -legW * legW * liftA * Math.max(0, swing) * 1.4;   // tuck the leg as it swings forward
          dy += -bodyW * bb.h * 0.022 * s * Math.sin(Math.PI * ub);   // spine arches mid-flight
          if (ub < 0.3) dy += -bb.h * 0.02 * Math.sin(ph + 0.9) * ((0.3 - ub) / 0.3) * bodyW;   // head bob
          if (ub > 0.7) dy += bb.h * 0.035 * Math.sin(ph - 0.7) * ((ub - 0.7) / 0.3) * bodyW;    // tail follows through
          if (ub > 0.7) dx += bb.w * 0.015 * Math.sin(ph - 0.7) * ((ub - 0.7) / 0.3) * bodyW;
          pos[i] = bx + dx * amount;
          pos[i + 1] = by + dy * amount;
        }
        buf.update();
      };

      const layout = () => {
        // renderer.width is already in CSS pixels; dividing it by the resolution laid the scene out at half size on DPR 2 screens.
        viewW = a.screen.width;
        viewH = a.screen.height;
        horizon = Math.round(viewH * SKY_FRAC);
        roadTop = horizon + 46;
        roadBottom = viewH - 34;
        laneH = (roadBottom - roadTop) / sim.racers.length;
        drawSky(); drawCelestial(); drawVignette();
        buildFarLayer(); buildClouds(); buildTreeline(); buildMidLayer(); buildAmbient();
        buildGround(); buildLanes(); buildTracksideDecor();
        // Racers appear only once their artwork is ready; building them earlier showed ball placeholders that were then swapped out.
        if (avatarArt) buildRacers();
      };
      layout();
      a.renderer.on('resize', layout);
      onSceneReadyRef.current?.();

      /* ---------- particles ---------- */
      const spawnDust = (x: number, y: number, speedFactor: number, tint: number, alpha: number, count = 1, ember = false) => {
        for (let k = 0; k < count; k++) {
          const s = new Sprite(dustTex);
          s.anchor.set(0.5);
          s.tint = tint;
          s.alpha = alpha * (0.6 + Math.random() * 0.4);
          const sc = (0.35 + Math.random() * 0.4) * (0.7 + speedFactor * 0.6);
          s.scale.set(sc);
          s.x = x - 6 + Math.random() * 6;
          s.y = y - 2 + Math.random() * 4;
          particleLayer.addChild(s);
          particles.push({
            sprite: s,
            vx: -(40 + Math.random() * 60) * (0.5 + speedFactor),
            vy: ember ? -(30 + Math.random() * 40) : -(10 + Math.random() * 25),
            life: 0,
            maxLife: ember ? 0.5 + Math.random() * 0.4 : 0.45 + Math.random() * 0.35,
            grow: ember ? 0.2 : 1.6,
          });
        }
      };

      const updateParticles = (dt: number) => {
        for (let i = particles.length - 1; i >= 0; i--) {
          const p = particles[i];
          p.life += dt;
          const k = p.life / p.maxLife;
          if (k >= 1) { p.sprite.destroy(); particles.splice(i, 1); continue; }
          p.sprite.x += p.vx * dt;
          p.sprite.y += p.vy * dt;
          p.vy += 30 * dt;
          p.sprite.alpha *= 1 - dt * 2.2;
          const sc = p.sprite.scale.x + p.grow * dt;
          p.sprite.scale.set(sc);
        }
      };

      const updateScenery = (dt: number) => {
        for (const c of clouds) {
          c.node.x += c.speed * dt;
          if (c.node.x > c.span) c.node.x -= c.span;
        }
        for (const f of flags) {
          f.node.skew.x = Math.sin(elapsed * 2.6 + f.seed) * 0.22;
          f.node.scale.y = 0.9 + Math.sin(elapsed * 5 + f.seed) * 0.08;
        }
        if (rays) rays.alpha = 0.75 + Math.sin(elapsed * 0.6) * 0.25;
        for (const am of ambients) {
          am.x += am.vx * dt;
          am.y += am.vy * dt;
          am.phase += am.speed * dt;
          const wob = Math.sin(am.phase) * am.amp;
          if (theme.ambient === 'fireflies') {
            am.node.x = am.x + wob; am.node.y = am.y + Math.cos(am.phase * 0.7) * am.amp;
            am.node.alpha = 0.25 + Math.max(0, Math.sin(am.phase * 1.7)) * 0.75;
          } else if (theme.ambient === 'leaves') {
            am.node.x = am.x + wob; am.node.y = am.y;
            am.node.rotation += dt * 1.5;
          } else {
            am.node.x = am.x; am.node.y = am.y + wob * 0.4;
            if (theme.ambient === 'embers') am.node.alpha = 0.4 + Math.max(0, Math.sin(am.phase * 2)) * 0.6;
          }
          // wrap around the view
          if (am.x < -30) am.x = viewW + 20; if (am.x > viewW + 30) am.x = -20;
          if (am.y < -30) am.y = viewH + 20; if (am.y > viewH + 30) am.y = -20;
        }
      };

      /* ---------- racer update ---------- */
      const updateRacer = (v: RacerView, dt: number, alpha: number) => {
        const r = v.sim;
        const dist = sim.renderDistance(r, alpha);
        let x = START_X + dist * PX_PER_M;
        const laneBaseY = roadTop + laneH * (v.laneIndex + 0.84);

        // walk-in before the start
        let introMove = 0;
        if (r.phase === 'idle') {
          const k = clamp((elapsed - v.introAt - v.laneIndex * 0.06) / INTRO_DURATION, 0, 1);
          const e = easeOutCubic(k);
          x = START_X - INTRO_DISTANCE * (1 - e);
          introMove = 1 - k;
        }
        // after the finish: glide a bit past the line and settle
        if (r.phase === 'finished') {
          if (v.settleX === null) v.settleX = finishX + 70 + (r.position - 1) * 6;
          const k = clamp(r.phaseTime / 1.1, 0, 1);
          x = lerp(finishX, v.settleX, 1 - Math.pow(1 - k, 3));
        }

        const dx = x - v.lastX;
        v.lastX = x;
        v.root.x = x;
        v.root.y = laneBaseY;

        const speedFactor = clamp(r.speed / Math.max(1, r.maxSpeed), 0, 1.3);
        const t = elapsed + v.laneIndex * 0.37;

        let bounce = 0;
        let openAlpha = 0, ballAlpha = 0;
        let openSx = 1, openSy = 1, openRot = 0;
        let ballScale = 1, ballSy = 1;
        let gallop = 0;            // strength of the gallop deformation
        let gallopSpeed = 0;       // 0..1, drives stride frequency

        switch (r.phase) {
          case 'idle': {
            openAlpha = v.open ? 1 : 0; ballAlpha = v.open ? 0 : 1;
            if (introMove > 0.02) {
              gallop = Math.min(1, introMove * 1.6); gallopSpeed = 0.35;
            } else {
              openSy = 1 + Math.sin(t * 2.2) * 0.02; openSx = 1 - Math.sin(t * 2.2) * 0.012;
            }
            ballSy = 1 + Math.sin(t * 2.2) * 0.03;
            break;
          }
          case 'running': {
            openAlpha = v.open ? 1 : 0; ballAlpha = v.open ? 0 : 1;
            gallop = 1; gallopSpeed = speedFactor;
            ballSy = 1 - Math.abs(Math.sin(t * 16)) * 0.12; // ball-only fallback waddle
            break;
          }
          case 'curling': {
            const k = clamp(r.phaseTime / 0.45, 0, 1);
            const e = easeInOut(k);
            openAlpha = v.open ? 1 - e : 0;
            openSx = 1 - e * 0.45; openSy = 1 - e * 0.35; openRot = e * 0.9;
            gallop = 1 - e; gallopSpeed = speedFactor;
            ballAlpha = v.open ? e : 1;
            ballScale = 0.55 + easeOutBack(k) * 0.45;
            bounce = Math.sin(k * Math.PI) * 14;
            break;
          }
          case 'rolling': {
            ballAlpha = 1;
            bounce = Math.abs(Math.sin(t * 9)) * 1.8 * speedFactor;
            if (r.stumbleLeft > 0) {
              ballSy = 0.86; ballScale = 1.08;
              bounce += Math.abs(Math.sin(t * 24)) * 3;
            }
            if (r.burstLeft > 0) ballScale *= 1 + Math.sin(t * 20) * 0.03;
            break;
          }
          case 'finished': {
            const k = clamp((r.phaseTime - 0.5) / 0.5, 0, 1);   // uncurl after a short glide
            const e = easeInOut(k);
            ballAlpha = v.open ? 1 - e : 1;
            ballScale = 1 - e * 0.4;
            openAlpha = v.open ? e : 0;
            openSx = 0.6 + e * 0.4; openSy = 0.7 + e * 0.3; openRot = (1 - e) * 0.9;
            if (k >= 1 && r.position <= 3) {
              const hop = Math.abs(Math.sin((r.phaseTime - 1) * 6));
              bounce = hop * (10 - (r.position - 1) * 3);
              openSy = 1 + hop * 0.06; openSx = 1 - hop * 0.04;
            } else if (k >= 1) {
              openSy = 1 + Math.sin(t * 3) * 0.025; // catching breath
            }
            if (k >= 1 && !v.open) bounce = r.position <= 3 ? Math.abs(Math.sin((r.phaseTime - 1) * 6)) * 8 : 0;
            break;
          }
        }

        /* ---- gallop cycle (open pose) ---- */
        if (v.open && gallop > 0) {
          const freq = 2.1 + gallopSpeed * 1.5;                 // strides per second
          v.stridePhase += TAU * freq * dt;
          const s = Math.sin(v.stridePhase);
          const air = Math.max(0, s);                            // airborne half of the stride
          const hopH = laneH * (0.05 + 0.11 * gallopSpeed);
          bounce += Math.pow(air, 0.8) * hopH * gallop;
          // stretch in the air, compact on push-off; lean into the run
          openSx *= 1 + 0.05 * s * gallop;
          openSy *= 1 - 0.045 * s * gallop;
          openRot += (0.07 * gallopSpeed - 0.055 * Math.sin(v.stridePhase - 0.7)) * gallop;
          // footfall → puff of dust
          if (v.lastStrideSin > 0 && s <= 0 && r.phase !== 'idle') {
            spawnDust(x - laneH * 0.35, laneBaseY - 1, speedFactor, theme.dust, theme.dustAlpha, 2);
          }
          v.lastStrideSin = s;
          deformOpen(v, gallop);
        } else if (v.open && v.deformed) {
          deformOpen(v, 0);
        }

        // roll the ball according to horizontal travel
        if (ballAlpha > 0 && dx !== 0) v.rollAngle += dx / v.ballRadius;

        if (v.open) {
          v.open.alpha = openAlpha;
          v.open.visible = openAlpha > 0.01;
          v.open.scale.set(-v.openBaseScale * openSx, v.openBaseScale * openSy);
          v.open.rotation = openRot;
          v.open.y = -bounce;
        }
        v.ball.alpha = ballAlpha;
        v.ball.visible = ballAlpha > 0.01;
        const d = v.ballRadius * 2 * ballScale;
        v.ball.width = d; v.ball.height = d * ballSy;
        v.ball.rotation = v.rollAngle;
        v.ball.y = -v.ballRadius * ballScale * ballSy - bounce;

        // shadow
        v.shadow.clear();
        const isOpen = !!v.open && openAlpha > 0.5;
        const bodyHalfW = isOpen && v.openBBox ? (v.openBBox.w * v.openBaseScale) / 2 : v.ballRadius;
        const shW = bodyHalfW * (1.05 - bounce / 80);
        v.shadow.ellipse(0, 2, shW, shW * (isOpen ? 0.22 : 0.3)).fill({ color: 0x000000, alpha: 0.28 - bounce / 140 });

        // speed lines on bursts
        v.speedLines.clear();
        if (r.phase === 'rolling' && (r.burstLeft > 0 || speedFactor > 1.05)) {
          for (let i = 0; i < 4; i++) {
            const yy = -v.ballRadius * 0.4 - i * v.ballRadius * 0.45;
            const len = 22 + ((i * 7 + Math.floor(elapsed * 30)) % 18);
            v.speedLines.rect(-v.ballRadius - len - 6, yy, len, 2).fill({ color: 0xffffff, alpha: 0.35 - i * 0.06 });
          }
        }

        // trailing name plate behind the racer, at body height
        const trailingX = -(v.tagW + bodyHalfW + 6);
        v.tag.x = (x - camX + trailingX) < 4 ? bodyHalfW + 6 : trailingX;
        v.tag.y = -v.ballRadius - bounce * 0.3;
        if (r.position !== v.lastPos) {
          // The badge keeps the racer's fixed number (what the caller says); only its ring shows the live podium.
          v.lastPos = r.position;
          v.posBadge.clear();
          const col = r.position === 1 ? 0xffd700 : r.position === 2 ? 0xc0c0c0 : r.position === 3 ? 0xcd7f32 : (BODY_ACCENT[r.body] ?? 0xffffff);
          v.posBadge.circle(11, 0, 9).fill(col);
          if (r.position <= 3) v.posBadge.circle(11, 0, 9).stroke({ color: 0xffffff, alpha: 0.7, width: 1.2 });
        }
        if (v.youRing) {
          const pulse = 0.5 + 0.5 * Math.sin(elapsed * 3.2);
          const rx = bodyHalfW * 1.15 + pulse * 3;
          v.youRing.clear();
          v.youRing.ellipse(0, 2, rx, rx * 0.3).fill({ color: 0xffd54a, alpha: 0.16 + pulse * 0.08 });
          v.youRing.ellipse(0, 2, rx, rx * 0.3).stroke({ color: 0xffd54a, alpha: 0.75, width: 2 });
        }

        // rolling dust (running dust is emitted on footfalls above)
        if (r.phase === 'rolling' && dx > 0) {
          v.dustTimer -= dt;
          const rate = 0.045 / (0.4 + speedFactor);
          if (v.dustTimer <= 0) {
            v.dustTimer = rate;
            spawnDust(x - v.ballRadius * 0.6, laneBaseY - 2, speedFactor, theme.dust, theme.dustAlpha, 2);
            if (theme.ember && Math.random() < 0.35) {
              spawnDust(x - v.ballRadius * 0.4, laneBaseY - 6, speedFactor, theme.ember, 0.9, 1, true);
            }
          }
        }
      };

      /* ---------- camera ---------- */
      const updateCamera = (dt: number, alpha: number) => {
        let lead = 0;
        for (const r of sim.racers) lead = Math.max(lead, sim.renderDistance(r, alpha));
        const leadX = START_X + lead * PX_PER_M;
        let target = sim.started ? leadX - viewW * LEAD_SCREEN_FRAC : 0;
        if (sim.finished) target = finishX + 90 - viewW * 0.55;
        target = clamp(target, 0, Math.max(0, worldLength - viewW));
        const k = 1 - Math.exp(-(sim.finished ? 2.2 : 5) * dt);
        camX = lerp(camX, target, k);
        world.x = -camX;
        groundLayer.x = camX;            // ground is drawn in screen space; scroll its texture instead
        if (ground) ground.tilePosition.x = -camX;
        farLayer.x = -camX * 0.12;
        cloudLayer.x = -camX * 0.18;
        treelineLayer.x = -camX * 0.32;
        midLayer.x = -camX * 0.55;
      };

      /* ---------- main loop ---------- */
      a.ticker.add((ticker) => {
        const dt = Math.min(0.1, ticker.deltaMS / 1000);
        elapsed += dt;
        const alpha = runningRef.current ? sim.step(dt) : 1;
        updateCamera(dt, alpha);
        updateScenery(dt);
        for (const v of views) updateRacer(v, dt, alpha);
        updateParticles(dt);
        tickAcc += dt;
        if (tickAcc >= 0.125) { tickAcc = 0; onTickRef.current?.(sim); }
      });

      /* ---------- racers arrive once their artwork is ready ---------- */
      avatarArt = await avatarPromise;
      if (cancelled) return;
      buildRacers();
      onReadyRef.current?.();
    })();

    return () => {
      cancelled = true;
      if (app) {
        app.destroy(true, { children: true, texture: false });
        app = null;
      }
    };
    // The track is rebuilt whenever the simulation instance or terrain changes.
  }, [sim, terrain]);

  return <div ref={hostRef} className={className} style={{ width: '100%', height: '100%', overflow: 'hidden', ...style }} />;
}
