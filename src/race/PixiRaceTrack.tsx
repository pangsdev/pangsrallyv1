import { useEffect, useRef } from 'react';
import {
  Application, Assets, Container, Graphics, MeshPlane, Rectangle, Sprite, Text, TilingSprite, Texture, FillGradient,
} from 'pixi.js';
import seedrandom from 'seedrandom';
import type { RaceSimulation, RacerSim } from './simulation';
import { BALL_SPRITES, BODY_ACCENT } from './sprites';
import { getTheme, type TrackTheme } from './themes';
import { cutoutImage } from './cutout';
import { RIG_X, RIG_Y, buildRig, cadence, footLanded, poseRig, suspension, type Rig } from './racerRig';
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
  /** filled with a function that copies the current frame into a 2D canvas (for the share card) */
  snapshotRef?: React.MutableRefObject<(() => HTMLCanvasElement | null) | null>;
  style?: React.CSSProperties;
  className?: string;
}

/* ------------------------------------------------------------------ */
/* Layout constants                                                    */
/* ------------------------------------------------------------------ */
const PX_PER_M = 16;
const START_X = 220;          // world x of the start line
/** height of the trackside boards */
const BOARD_H = 42;
/** how far the body tumbles forward while it curls, radians */
const CURL_SPIN = 2.2;
const FINISH_PAD = 520;       // world space after the finish line
const LEAD_SCREEN_FRAC = 0.58; // leader is kept at this fraction of the view width
const SKY_FRAC = 0.24;         // share of the view height used by the sky/horizon
const INTRO_DISTANCE = 170;    // racers jog in from this far left of the start line
const INTRO_DURATION = 1.15;
const BARE_BODY_FRAC = 0.509;  // a pangolin's body height / artwork canvas height (228 of 448 px in the cut-out)

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

/** Seamless soft light and dark patches, laid over the ground so the course does not look tiled. */
function patchTexture(seed: string): Texture {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const rng = seedrandom(`patches:${seed}`);
  for (let i = 0; i < 46; i++) {
    const x = rng() * size, y = rng() * size, r = 40 + rng() * 110;
    const tone = rng() < 0.55 ? '0,0,0' : '255,255,255';
    const a = 0.05 + rng() * 0.08;
    // drawn at every wrapped position, so the tile edges meet
    for (const ox of [-size, 0, size]) for (const oy of [-size, 0, size]) {
      const grad = ctx.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, r);
      grad.addColorStop(0, `rgba(${tone},${a})`);
      grad.addColorStop(1, `rgba(${tone},0)`);
      ctx.fillStyle = grad;
      ctx.fillRect(x + ox - r, y + oy - r, r * 2, r * 2);
    }
  }
  return Texture.from(canvas);
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
  rig: Rig | null;
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
  /** render time this racer crossed the line */
  finishAt: number;
  ballRadius: number;
  /** position in the stride; see racerRig.ts */
  stride: number;
  strideHz: number;
  /** the walk-to-gallop blend, eased so the gait never snaps */
  gait: number;
  introAt: number;
}

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */
export default function PixiRaceTrack({ sim, running, terrain, onTick, onSceneReady, onReady, snapshotRef, style, className }: PixiRaceTrackProps) {
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
      if (snapshotRef) {
        snapshotRef.current = () => {
          // render and copy in the same task, before the WebGL buffer is cleared
          try {
            a.render();
            const out = document.createElement('canvas');
            out.width = a.canvas.width;
            out.height = a.canvas.height;
            out.getContext('2d')?.drawImage(a.canvas, 0, 0);
            return out;
          } catch { return null; }
        };
      }
      a.canvas.style.display = 'block';
      a.canvas.style.width = '100%';
      a.canvas.style.height = '100%';

      /* ---------- small local textures (fast) ---------- */
      const [groundTex, darkLogoTex, lightLogoTex, ...ballTexList] = await Promise.all([
        loadTexture(theme.groundTexture),
        loadTexture('/dark-logo.webp'),
        loadTexture('/light-logo.webp'),
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
      let groundDetail: TilingSprite | null = null;
      let groundPatches: TilingSprite | null = null;
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
          // The same texture at another scale, over it: the two repeats never line up.
          groundDetail = new TilingSprite({ texture: groundTex, width: viewW + 4, height: h });
          groundDetail.tileScale.set(0.67);
          groundDetail.alpha = 0.42;
          groundDetail.y = top;
          groundLayer.addChild(groundDetail);
        } else {
          ground = null;
          groundDetail = null;
          const g = new Graphics();
          g.rect(0, top, viewW + 4, h).fill(theme.groundColor);
          groundLayer.addChild(g);
        }
        groundPatches = new TilingSprite({ texture: patchTexture(theme.id), width: viewW + 4, height: h });
        groundPatches.tileScale.set(1.5);
        groundPatches.alpha = 0.65;
        groundPatches.y = top;
        groundLayer.addChild(groundPatches);
        const shade_ = new Graphics();
        // A wash of the ground colour quiets a busy texture, so the racers stay the focus.
        if (theme.groundCalm) shade_.rect(0, top, viewW + 4, h).fill({ color: theme.groundColor, alpha: theme.groundCalm });
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
        // Depth: the far side falls into haze, the near side into shade.
        const road = roadBottom - roadTop;
        const far = new FillGradient({
          type: 'linear', start: { x: 0, y: 0 }, end: { x: 0, y: 1 }, textureSpace: 'local',
          colorStops: [{ offset: 0, color: 'rgba(255,255,255,0.09)' }, { offset: 1, color: 'rgba(255,255,255,0)' }],
        });
        shade_.rect(0, roadTop, viewW + 4, road * 0.4).fill(far);
        const near = new FillGradient({
          type: 'linear', start: { x: 0, y: 0 }, end: { x: 0, y: 1 }, textureSpace: 'local',
          colorStops: [{ offset: 0, color: 'rgba(0,0,0,0)' }, { offset: 1, color: 'rgba(0,0,0,0.26)' }],
        });
        shade_.rect(0, roadTop + road * 0.55, viewW + 4, road * 0.45).fill(near);
        groundLayer.addChild(shade_);
      };

      const buildLanes = () => {
        laneLayer.clear();
        if (theme.decor === 'trees') {
          // Mown turf: wide light and dark bands across the course.
          for (let x = 0; x < worldLength; x += 360) laneLayer.rect(x, roadTop, 180, roadBottom - roadTop).fill({ color: 0xffffff, alpha: 0.05 });
        }
        for (let i = 1; i < sim.racers.length; i++) {
          const y = roadTop + laneH * i;
          for (let x = 0; x < worldLength; x += 64) {
            laneLayer.rect(x, y - 1, 40, 2).fill({ color: theme.laneLine, alpha: theme.laneLineAlpha });
          }
        }
        // Kerbs along both edges of the course.
        const kerb = 44;
        for (const [y, h] of [[roadTop - 7, 9], [roadBottom - 2, 10]] as const) {
          laneLayer.rect(0, y, worldLength, h).fill(theme.kerb[1]);
          for (let x = 0; x < worldLength; x += kerb * 2) laneLayer.rect(x, y, kerb, h).fill(theme.kerb[0]);
          laneLayer.rect(0, y + h - 2, worldLength, 2).fill({ color: 0x000000, alpha: 0.22 });
        }
        // Start line: a chequered strip, slimmer than the finish.
        const sc = 8;
        for (let yy = roadTop + 2; yy < roadBottom - 2; yy += sc) {
          for (let c = 0; c < 2; c++) {
            const dark = (Math.round((yy - roadTop) / sc) + c) % 2 === 0;
            laneLayer.rect(START_X - sc + c * sc, yy, sc, Math.min(sc, roadBottom - 2 - yy)).fill({ color: dark ? 0x15151c : 0xffffff, alpha: 0.9 });
          }
        }
        const cell = 12;
        for (let yy = roadTop; yy < roadBottom; yy += cell) {
          for (let c = 0; c < 3; c++) {
            const dark = (Math.floor((yy - roadTop) / cell) + c) % 2 === 0;
            laneLayer.rect(finishX + c * cell, yy, cell, Math.min(cell, roadBottom - yy)).fill(dark ? 0x111111 : 0xffffff);
          }
        }
        for (let m = 50; m < sim.totalDistance; m += 50) {
          const x = START_X + m * PX_PER_M;
          laneLayer.rect(x - 1, roadTop + 2, 2, roadBottom - roadTop - 4).fill({ color: 0xffffff, alpha: 0.1 });
        }
      };

      /** Start / finish gantry: stands behind the boards, so nothing crosses the lanes. */
      const makeBanner = (x: number, label: string, color: number) => {
        const c = new Container();
        const g = new Graphics();
        const top = roadTop - 134, foot = roadTop - 6, half = 118;
        for (const px of [x - half, x + half]) {
          g.rect(px - 5, top, 10, foot - top).fill(0x2a2a36);
          g.rect(px - 5, top, 3, foot - top).fill(0x4a4a5c);
        }
        g.roundRect(x - half - 12, top - 6, (half + 12) * 2, 44, 6).fill(shade(color, 0.55));
        g.roundRect(x - half - 12, top - 10, (half + 12) * 2, 44, 6).fill(color);
        g.roundRect(x - half - 12, top - 10, (half + 12) * 2, 44, 6).stroke({ color: 0xffffff, alpha: 0.5, width: 2 });
        // chequered ends
        for (const sx of [-half - 4, half - 16]) {
          for (let r = 0; r < 4; r++) for (let k = 0; k < 2; k++) {
            g.rect(x + sx + k * 10, top - 6 + r * 9, 10, 9).fill((r + k) % 2 ? 0xffffff : 0x15151c);
          }
        }
        c.addChild(g);
        const t = new Text({ text: label, style: { fontFamily: 'Outfit, Inter, sans-serif', fontSize: 24, fontWeight: '900', fill: 0xffffff, letterSpacing: 4 } });
        t.anchor.set(0.5); t.x = x; t.y = top + 12; t.resolution = 2;
        c.addChild(t);
        return c;
      };

      /**
       * A covered grandstand. The crowd sits in blocks of a few muted colours, like fan sections,
       * and is tinted toward the stand so it reads as one mass rather than confetti.
       */
      const standAt = (g: Graphics, cx: number, half: number, rng: () => number) => {
        const foot = roadTop - 36, rows = 4, rowH = 19;
        const top = foot - rows * rowH - 6;
        const roof = theme.bunting[0];
        const wall = mix(theme.fence, 0x14141c, 0.7);
        const sections = [0x5432d3, 0xe9e4d8, 0x39415c, 0xd9a441, 0x7a8798, 0xb5533c];
        const skins = [0xd9ab84, 0xb98560, 0x8a5f42];
        g.rect(cx - half, top, half * 2, foot - top).fill(wall);
        const blockW = half / 2;
        for (let row = rows - 1; row >= 0; row--) {
          const y = foot - row * rowH;
          const fade = 0.2 + row * 0.09; // the upper rows sit further back, in the roof's shade
          g.rect(cx - half, y - 3, half * 2, 3).fill(mix(wall, 0xffffff, 0.14));
          for (let x = cx - half + 8; x < cx + half - 6; x += 12 + rng() * 2) {
            if (rng() < 0.14) continue; // an empty seat
            const block = Math.floor((x - cx + half) / blockW);
            const main = sections[(block + Math.floor(cx / 97)) % sections.length];
            const body = mix(rng() < 0.8 ? main : sections[2], wall, fade);
            const skin = mix(skins[Math.floor(rng() * skins.length)], wall, fade);
            const py = y - 3;
            // shoulders and head only: at this size that is all the eye reads
            g.roundRect(x - 4.6, py - 9, 9.2, 9, 3.5).fill(body);
            g.circle(x, py - 11.5, 3.3).fill(skin);
          }
        }
        // roof shadow on the top rows
        const shadow = new FillGradient({
          type: 'linear', start: { x: 0, y: 0 }, end: { x: 0, y: 1 }, textureSpace: 'local',
          colorStops: [{ offset: 0, color: 'rgba(0,0,0,0.55)' }, { offset: 1, color: 'rgba(0,0,0,0)' }],
        });
        g.rect(cx - half, top, half * 2, 30).fill(shadow);
        // pillars and roof
        for (let x = cx - half; x <= cx + half + 1; x += blockW) g.rect(x - 2, top - 2, 4, foot - top + 2).fill(0xc8cad2);
        g.poly([cx - half - 14, top - 2, cx + half + 14, top - 2, cx + half - 10, top - 18, cx - half + 10, top - 18]).fill(roof);
        g.poly([cx - half - 14, top - 2, cx + half + 14, top - 2, cx + half + 12, top + 3, cx - half - 12, top + 3]).fill(shade(roof, 0.6));
        for (let x = cx - half + 30; x < cx + half; x += 90) {
          g.rect(x - 1, top - 34, 2, 18).fill(0xc8cad2);
          g.poly([x + 1, top - 34, x + 17, top - 29, x + 1, top - 24]).fill(theme.bunting[Math.floor(rng() * theme.bunting.length)]);
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

        // grandstands: big ones at the start and the finish, smaller ones along the way
        for (const [cx, half] of [
          [START_X + 330, 250], [START_X + 100 * PX_PER_M, 190], [START_X + 200 * PX_PER_M, 230],
          [START_X + 300 * PX_PER_M, 190], [finishX - 340, 300], [finishX + 290, 170],
        ]) {
          const stand = new Graphics();
          standAt(stand, cx, half, rng);
          decorBack.addChild(stand);
        }

        // running rail, behind the boards
        const fence = new Graphics();
        const railY = roadTop - 36;
        for (let x = 10; x < worldLength; x += 80) fence.rect(x - 1.5, railY, 3, 28).fill(shade(theme.rail, 0.75));
        fence.roundRect(0, railY - 2, worldLength, 4, 2).fill(theme.rail);
        fence.rect(0, railY + 2, worldLength, 1).fill({ color: 0x000000, alpha: 0.25 });
        decorBack.addChild(fence);

        decorBack.addChild(makeBanner(START_X, 'START', 0x5432d3));
        decorBack.addChild(makeBanner(finishX + 18, 'FINISH', 0xc0392b));

        // Trackside boards: separate framed panels on legs, standing on the verge in front of the rail.
        // Each logo file has a solid background, so its panel is filled with that same colour.
        // Robinhood Chain: name only, black on Robin Neon, an approved pairing in its brand guidelines
        // (docs.robinhood.com/chain/brand-guidelines). Do not add its logo or feather without their approval.
        const boardH = BOARD_H, boardW = 296, pitch = 320, frame = 3;
        const boardTop = roadTop - 15 - boardH;
        const inner = boardH - frame * 2;
        const logoSprite = (tex: Texture | null) => {
          if (!tex) return null;
          // the art sits inside wide margins: trim them so the logo fills the panel
          const h = tex.height * 0.8;
          const sprite = new Sprite(new Texture({ source: tex.source, frame: new Rectangle(0, tex.height * 0.1, tex.width, h) }));
          sprite.anchor.set(0.5);
          sprite.scale.set(inner / h);
          return sprite;
        };
        // Sheen from above and shade below, shared by every panel, so print and panel catch the same light.
        const sheen = new FillGradient({
          type: 'linear', start: { x: 0, y: 0 }, end: { x: 0, y: 1 }, textureSpace: 'local',
          colorStops: [
            { offset: 0, color: 'rgba(255,255,255,0.2)' },
            { offset: 0.3, color: 'rgba(255,255,255,0)' },
            { offset: 1, color: 'rgba(0,0,0,0.3)' },
          ],
        });
        for (let cx = START_X - pitch, n = 0; cx < worldLength + pitch; cx += pitch, n++) {
          const left = cx - boardW / 2;
          const chain = n % 2 === 1;
          const logoTex = n % 4 === 0 ? darkLogoTex : lightLogoTex;
          const back = new Graphics();
          // shadow on the verge, then legs
          back.ellipse(cx, roadTop - 9, boardW / 2 + 6, 5).fill({ color: 0x000000, alpha: 0.28 });
          for (const lx of [left + 42, left + boardW - 42]) {
            back.rect(lx - 4, boardTop + boardH - 2, 8, 12).fill(0x23252e);
            back.rect(lx - 4, boardTop + boardH - 2, 2.5, 12).fill(0x444754);
            back.rect(lx - 8, roadTop - 8, 16, 2).fill(0x15161c);
          }
          // panel
          back.rect(left + frame, boardTop + frame, boardW - frame * 2, inner).fill(chain ? 0xccff00 : n % 4 === 0 ? 0x0b0519 : 0xfefefe);
          decorBack.addChild(back);

          const art = chain
            ? new Text({ text: 'On Robinhood Chain', style: { fontFamily: 'Outfit, Inter, sans-serif', fontSize: 21, fontWeight: '800', fill: 0x000000 } })
            : logoSprite(logoTex);
          if (art) {
            if (art instanceof Text) { art.anchor.set(0.5); art.resolution = 2; }
            art.x = cx; art.y = boardTop + boardH / 2;
            decorBack.addChild(art);
          }

          // the light and the track's tone go over the print too, then the metal frame on top
          const front = new Graphics();
          front.rect(left + frame, boardTop + frame, boardW - frame * 2, inner).fill({ color: theme.edgeColor, alpha: theme.boardShade });
          front.rect(left + frame, boardTop + frame, boardW - frame * 2, inner).fill(sheen);
          front.rect(left, boardTop, boardW, frame).fill(0x5a5e6c);
          front.rect(left, boardTop + boardH - frame, boardW, frame).fill(0x1d1f27);
          front.rect(left, boardTop, frame, boardH).fill(0x34363f);
          front.rect(left + boardW - frame, boardTop, frame, boardH).fill(0x24262e);
          front.rect(left + frame, boardTop + frame, boardW - frame * 2, 1.5).fill({ color: 0x000000, alpha: 0.3 });
          decorBack.addChild(front);
        }

        for (let m = 50; m < sim.totalDistance; m += 50) {
          const x = START_X + m * PX_PER_M;
          const sign = new Graphics();
          sign.rect(x - 1.5, roadTop - 82, 3, 34).fill(0xd8dae2);
          sign.roundRect(x - 22, roadTop - 102, 44, 22, 4).fill(0x141226);
          sign.roundRect(x - 22, roadTop - 102, 44, 22, 4).stroke({ color: 0xffd166, alpha: 0.7, width: 1.5 });
          decorBack.addChild(sign);
          const t = new Text({ text: `${m}m`, style: { fontFamily: 'Inter, sans-serif', fontSize: 12, fontWeight: '800', fill: 0xffffff } });
          t.anchor.set(0.5); t.x = x; t.y = roadTop - 91; t.resolution = 2;
          decorBack.addChild(t);
        }

        // bunting strings over the start and finish zones
        const bunting = (from: number, to: number) => {
          const y0 = roadTop - 150;
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
        bunting(START_X + 135, START_X + 620);
        bunting(finishX - 620, finishX - 118);
        bunting(finishX + 154, finishX + 460);

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
          let rig: Rig | null = null;
          let openBBox: BBox | null = null;
          let openBaseScale = 1;
          const art = avatarArt?.[i] ?? null;
          if (art) {
            open = new MeshPlane({ texture: art.texture, verticesX: RIG_X, verticesY: RIG_Y });
            rig = buildRig(Float32Array.from(open.geometry.positions), art.texture.width, art.texture.height, art.bbox);
            openBBox = art.bbox;
            // pivot at the feet (bottom centre of the opaque pixels)
            open.pivot.set(art.bbox.x + art.bbox.w / 2, art.bbox.y + art.bbox.h);
            const targetH = laneH * 1.02;            // body height on screen (a hint of overlap into the lane above is fine)
            // Scale by the artwork canvas, not by the opaque bounding box: hats, halos and crowns make the
            // box taller, which used to shrink those pangolins' bodies by up to 20% next to bare ones.
            openBaseScale = targetH / (BARE_BODY_FRAC * art.texture.height);
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
            sim: r, root, shadow, open, rig, openBBox, openBaseScale, ball, speedLines, tag, tagW: w, posBadge, posText, youRing,
            laneIndex: i, lastX: START_X - INTRO_DISTANCE, rollAngle: 0, dustTimer: 0, lastPos: i + 1, settleX: null, finishAt: 0, ballRadius,
            stride: i * 0.37, strideHz: 0, gait: 0, introAt: elapsed,
          });
        });
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
          if (v.settleX === null) { v.settleX = finishX + 70 + (r.position - 1) * 6; v.finishAt = elapsed; }
          const k = clamp((elapsed - v.finishAt) / 1.1, 0, 1);
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
        let stride = 0;            // 0 standing … 1 full stride
        let curl = 0;              // 0 open … 1 curled up; see racerRig.ts
        let spin = 0;              // how far the curling body has tumbled forward
        let rest = 0;              // breathing and small moves while standing

        switch (r.phase) {
          case 'idle': {
            openAlpha = v.open ? 1 : 0; ballAlpha = v.open ? 0 : 1;
            stride = Math.min(1, introMove * 2.2);
            rest = 1 - stride;
            ballSy = 1 + Math.sin(t * 2.2) * 0.03;
            break;
          }
          case 'running': {
            openAlpha = v.open ? 1 : 0; ballAlpha = v.open ? 0 : 1;
            stride = clamp(0.3 + speedFactor * 1.4, 0, 1);
            // the first push off the line: a low crouch that the racer drives out of
            openSy = 1 - 0.05 * (1 - clamp(r.phaseTime / 0.22, 0, 1));
            openRot = 0.1 * clamp(speedFactor * 1.6, 0, 1);   // leans into the run
            ballSy = 1 - Math.abs(Math.sin(t * 16)) * 0.12; // ball-only fallback waddle
            break;
          }
          case 'curling': {
            const k = clamp(r.phaseTime / 0.45, 0, 1);
            const e = easeInOut(k);
            curl = e;
            spin = e * e * CURL_SPIN;
            stride = (1 - e) * (1 - e);
            openRot = 0.1 * clamp(speedFactor * 1.6, 0, 1) * (1 - e);
            // the bent body hands over to the ball, which sits behind it, as the two shapes come to match
            openAlpha = v.open ? 1 - smoothstep(0.66, 0.92, k) : 0;
            ballAlpha = v.open ? smoothstep(0.38, 0.68, k) : 1;   // behind the body, it fills the ring as it closes
            ballScale = v.open ? 0.8 + 0.2 * smoothstep(0.38, 0.95, k) : 0.55 + easeOutBack(k) * 0.45;
            bounce = Math.sin(k * Math.PI) * laneH * 0.2;
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
            // On the render clock: the simulation stops once the last racer is home, so its time would freeze them mid-glide.
            const home = elapsed - v.finishAt;
            const k = clamp((home - 0.5) / 0.5, 0, 1);           // uncurl after a short glide
            const e = easeInOut(k);
            ballAlpha = v.open ? 1 - smoothstep(0.04, 0.32, e) : 1;
            ballScale = v.open ? 1 - 0.06 * smoothstep(0, 0.32, e) : 1;
            openAlpha = v.open ? smoothstep(0, 0.28, e) : 0;
            curl = 1 - e;
            spin = (1 - e) * (1 - e) * CURL_SPIN;
            rest = e;
            if (k >= 1) openSy = 1 + Math.sin(t * 3) * 0.018; // catching breath, feet stay on the ground
            break;
          }
        }

        /* ---- stride (open pose): see racerRig.ts ---- */
        if (v.open && v.rig && openAlpha > 0) {
          const groundPx = dt > 0 ? Math.abs(dx) / dt : 0;       // screen px per second
          const scale = v.openBaseScale;
          // Gait follows real speed: a walk that opens into a gallop, eased so it never snaps.
          const wantGait = smoothstep(50, 150, groundPx);
          v.gait += (wantGait - v.gait) * (1 - Math.exp(-dt * 7));
          if (stride > 0.01) {
            const hz = cadence(v.rig, v.gait, groundPx / scale);
            v.strideHz += (hz - v.strideHz) * (1 - Math.exp(-dt * 10));
            const from = v.stride;
            v.stride += v.strideHz * dt;
            // footfall → puff of dust
            if (r.phase === 'running' && (footLanded(from, v.stride, v.gait, true) || footLanded(from, v.stride, v.gait, false))) {
              spawnDust(x - laneH * 0.45, laneBaseY - 1, speedFactor + 0.3, theme.dust, theme.dustAlpha, 3);
            }
            bounce += suspension(v.stride) * v.gait * stride * laneH * 0.03;
          }
          poseRig(v.rig, v.open.geometry.getBuffer('aPosition').data as Float32Array, {
            cycle: v.stride, gait: v.gait, stride, curl,
            curlRadius: v.ballRadius / scale, spin, time: t, rest,
          });
          v.open.geometry.getBuffer('aPosition').update();
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
        const bodyHalfW = isOpen && v.openBBox ? lerp((v.openBBox.w * v.openBaseScale) / 2, v.ballRadius, curl) : v.ballRadius;
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
        if (groundDetail) groundDetail.tilePosition.x = -camX;
        if (groundPatches) groundPatches.tilePosition.x = -camX;
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
      if (snapshotRef) snapshotRef.current = null;
      if (app) {
        app.destroy(true, { children: true, texture: false });
        app = null;
      }
    };
    // The track is rebuilt whenever the simulation instance or terrain changes.
  }, [sim, terrain]);

  return <div ref={hostRef} className={className} style={{ width: '100%', height: '100%', overflow: 'hidden', ...style }} />;
}
