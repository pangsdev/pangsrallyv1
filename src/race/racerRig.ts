/**
 * Rig for a racer's open-pose artwork: a single flat image animated by moving the vertices of a mesh.
 *
 * Every pangolin (Beta pass and the ten teasers) is drawn on the same base, so its four paws sit at the
 * same place on the canvas (measured on all eleven images, to within about 1.5% of the canvas). Each leg
 * therefore gets its own region of the mesh and steps on its own, instead of all legs sharing one swing.
 *
 * Gait: a four-beat walk at low speed blending into a gallop at speed. A foot in stance travels backward
 * at the speed of the ground, so `strideRate` follows the racer's real speed; `cadence` keeps a gallop quick.
 *
 * Curl: the body bends along its spine into a ring with the back outermost, so the legs fold inside
 * and head and tail meet, then it hands over to the ball sprite. Uncurling is the same bend in reverse.
 *
 * Art faces left: texture −x is forward (the sprite is flipped on screen). Pure module, no Pixi.
 */

export const RIG_X = 26, RIG_Y = 20;

interface Leg {
  /** shoulder or hip, and paw, as fractions of the artwork canvas */
  hip: [number, number];
  paw: [number, number];
  radius: number;
  /** when this foot lands in the cycle, in the walk and in the gallop */
  walkAt: number;
  runAt: number;
  /** forelegs reach further than the hind legs drive */
  reach: number;
}

const LEGS: Leg[] = [
  { hip: [0.625, 0.5], paw: [0.66, 0.675], radius: 0.082, walkAt: 0, runAt: 0, reach: 1 },        // near hind
  { hip: [0.53, 0.51], paw: [0.545, 0.637], radius: 0.058, walkAt: 0.5, runAt: 0.1, reach: 0.9 }, // far hind
  { hip: [0.345, 0.5], paw: [0.31, 0.725], radius: 0.085, walkAt: 0.25, runAt: 0.52, reach: 1.15 }, // near fore
  { hip: [0.215, 0.53], paw: [0.168, 0.675], radius: 0.055, walkAt: 0.75, runAt: 0.42, reach: 1 },  // far fore
];

const BACK_Y = 0.222;      // top of the back on the canvas
const WALK_DUTY = 0.68, RUN_DUTY = 0.3;
const WALK_REACH = 0.034, RUN_REACH = 0.104;    // half a stride, as a fraction of the canvas width
const WALK_LIFT = 0.024, RUN_LIFT = 0.066;       // foot clearance, as a fraction of the canvas height
/** share of the ring the spine closes when fully curled */
const CURL_CLOSE = 0.92;
const TAU = Math.PI * 2;

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const smooth = (a: number, b: number, v: number) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

export interface Rig {
  base: Float32Array;
  w: number; h: number;
  /** left and width of the body, and the ground line */
  bodyX: number; bodyW: number; ground: number;
  /** per vertex: 0 head … 1 tail */
  along: Float32Array;
  /** per vertex and leg: how much the leg moves it, and how far down the leg it sits */
  weight: Float32Array;
  depth: Float32Array;
  /** per vertex: how firmly it is held by a planted leg rather than the body */
  plant: Float32Array;
}

export interface Pose {
  /** position in the stride, any number; the fraction is what counts */
  cycle: number;
  /** 0 walk … 1 gallop */
  gait: number;
  /** 0 standing … 1 full stride */
  stride: number;
  /** 0 open … 1 curled into a disc of radius curlRadius (texture px), rotated by spin */
  curl: number;
  curlRadius: number;
  spin: number;
  /** seconds, for breathing and the small head and tail moves while standing */
  time: number;
  /** 0 … 1 */
  rest: number;
}

export function buildRig(base: Float32Array, w: number, h: number, bbox: { x: number; y: number; w: number; h: number }): Rig {
  const n = base.length / 2;
  const along = new Float32Array(n);
  const weight = new Float32Array(n * LEGS.length);
  const depth = new Float32Array(n * LEGS.length);
  const plant = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const nx = base[i * 2] / w, ny = base[i * 2 + 1] / h;
    along[i] = clamp((base[i * 2] - bbox.x) / bbox.w, 0, 1);
    let total = 0;
    LEGS.forEach((leg, k) => {
      const ax = leg.paw[0] - leg.hip[0], ay = leg.paw[1] - leg.hip[1];
      const t = clamp(((nx - leg.hip[0]) * ax + (ny - leg.hip[1]) * ay) / (ax * ax + ay * ay), 0, 1.15);
      const dist = Math.hypot(nx - (leg.hip[0] + ax * t), ny - (leg.hip[1] + ay * t));
      const influence = (1 - smooth(leg.radius * 0.55, leg.radius, dist)) * smooth(0.02, 0.4, t);
      weight[i * LEGS.length + k] = influence;
      depth[i * LEGS.length + k] = Math.min(t, 1);
      total += influence;
    });
    if (total > 1) for (let k = 0; k < LEGS.length; k++) weight[i * LEGS.length + k] /= total;
    for (let k = 0; k < LEGS.length; k++) plant[i] += weight[i * LEGS.length + k] * depth[i * LEGS.length + k];
    plant[i] = Math.min(1, plant[i]);
  }
  return { base, w, h, bodyX: bbox.x, bodyW: bbox.w, ground: bbox.y + bbox.h, along, weight, depth, plant };
}

/** Half a stride in texture px: with the duty, this fixes the stride rate for a given ground speed. */
export function strideReach(rig: Rig, gait: number): number {
  return lerp(WALK_REACH, RUN_REACH, gait) * rig.w;
}

/** Strides per second that keep a planted foot still on the ground. `groundSpeed` is in texture px per second. */
export function strideRate(rig: Rig, gait: number, groundSpeed: number): number {
  return (groundSpeed * lerp(WALK_DUTY, RUN_DUTY, gait)) / (2 * strideReach(rig, gait));
}

/**
 * Strides per second to animate at. A small animal runs on quick steps: a gallop never drops below
 * a brisk cadence, even if that lets a foot slip a little, which reads as effort at this speed.
 */
export function cadence(rig: Rig, gait: number, groundSpeed: number): number {
  return clamp(Math.max(strideRate(rig, gait, groundSpeed), lerp(1.1, 3.9, gait)), 1.1, 4.8);
}

/** How long the racer is in the air at this point of the gallop: 0 … 1, peaking just before the hind feet land. */
export function suspension(cycle: number): number {
  const p = cycle - Math.floor(cycle);
  return p < 0.78 ? 0 : Math.sin(((p - 0.78) / 0.22) * Math.PI);
}

/** True when a foot landed between two cycle values; `hind` picks the near hind foot, else the near fore. */
export function footLanded(from: number, to: number, gait: number, hind: boolean): boolean {
  const leg = LEGS[hind ? 0 : 2];
  const at = lerp(leg.walkAt, leg.runAt, gait);
  return Math.floor(to - at) > Math.floor(from - at);
}

export function poseRig(rig: Rig, out: Float32Array, pose: Pose) {
  const { base, w, h, along, weight, depth, plant } = rig;
  const { gait, stride, curl, time, rest } = pose;
  const cycle = pose.cycle - Math.floor(pose.cycle);
  const phi = cycle * TAU;
  const duty = lerp(WALK_DUTY, RUN_DUTY, gait);
  const reach = strideReach(rig, gait) * stride;
  const lift = lerp(WALK_LIFT, RUN_LIFT, gait) * h * stride;

  // where each foot is, relative to its rest position
  const footX: number[] = [], footY: number[] = [];
  for (const leg of LEGS) {
    const at = lerp(leg.walkAt, leg.runAt, gait);
    const p = (cycle - at + 1) % 1;
    if (p < duty) {
      footX.push(reach * leg.reach * (1 - (2 * p) / duty));   // planted: slides back with the ground
      footY.push(0);
    } else {
      const u = (p - duty) / (1 - duty);
      const e = u * u * (3 - 2 * u);
      footX.push(reach * leg.reach * (2 * e - 1));            // swings forward
      footY.push(lift * Math.pow(Math.sin(Math.PI * Math.min(1, u * 1.05)), 1.3));
    }
  }

  // the body: walk bobs twice a stride; gallop rocks, arching as the legs gather and stretching as they reach
  // The gallop drives forward, not up: the body stays low and thrusts ahead over its planted feet.
  const bob = lerp(0.007 * Math.cos(phi * 2), -0.011 * Math.cos(phi - TAU * 0.9), gait) * h * stride;
  const rock = lerp(0.006 * Math.sin(phi * 2 + 0.6), 0.018 * Math.sin(phi + 0.9), gait) * h * stride;
  const arch = gait * 0.024 * Math.cos(phi - 0.4) * h * stride;
  const stretch = gait * 0.07 * Math.sin(phi + 0.2) * stride;
  const lunge = gait * 0.034 * w * Math.sin(phi - 0.3) * stride;
  // the armour shivers down the back with every stride
  const ripple = gait * 0.006 * h * stride;
  // head and tail follow the body late, so they read as carried rather than glued on
  const nod = lerp(0.012 * Math.sin(phi * 2 - 0.8), 0.02 * Math.sin(phi - 0.4), gait) * h * stride;
  const wag = lerp(0.03 * Math.sin(phi - 1.2), 0.055 * Math.sin(phi - 1.5), gait) * h * stride;
  // at speed the head reaches low and forward and the tail streams up behind
  const reachHead = gait * stride;
  const streamTail = gait * 0.075 * h * stride;
  const breath = 0.0045 * Math.sin(time * 2.1) * h * rest;
  const sniff = 0.007 * Math.sin(time * 1.3) * h * rest;
  const sway = 0.013 * Math.sin(time * 1.1 + 1) * h * rest;

  // curl geometry
  const backY = BACK_Y * h;
  const midX = rig.bodyX + rig.bodyW / 2;
  const bendRate = curl > 0.001 ? (curl * TAU * CURL_CLOSE) / rig.bodyW : 0;
  const bendRadius = bendRate > 0 ? 1 / bendRate : 0;
  const closedRadius = rig.bodyW / (TAU * CURL_CLOSE);
  const fit = lerp(1, pose.curlRadius / closedRadius, curl);
  const sink = curl * (rig.ground - backY - pose.curlRadius * 2);
  const thick = rig.ground - backY;
  const hubY = rig.ground - pose.curlRadius;
  const cosS = Math.cos(-pose.spin), sinS = Math.sin(-pose.spin);

  const legs = LEGS.length;
  for (let i = 0, n = along.length; i < n; i++) {
    const bx = base[i * 2], by = base[i * 2 + 1];
    const u = along[i];
    const free = 1 - plant[i];

    let dy = (bob + rock * (u - 0.5) * 2 + arch * Math.sin(Math.PI * u) * -1) * free;
    let dx = (-(u - 0.5) * rig.bodyW * stretch - lunge) * free;
    dy += breath * Math.sin(Math.PI * u) * free;
    dy += ripple * Math.sin(u * 13 - phi * 2) * free;
    if (u < 0.3) {
      const k = (0.3 - u) / 0.3;
      dy += (nod + sniff + reachHead * 0.03 * h) * k * k;
      dx -= reachHead * 0.024 * w * k * k;
    }
    if (u > 0.68) { const k = (u - 0.68) / 0.32; dy += (wag + sway - streamTail) * k * k; }

    for (let k = 0; k < legs; k++) {
      const wgt = weight[i * legs + k];
      if (wgt <= 0) continue;
      const t = depth[i * legs + k];
      dx -= footX[k] * wgt * t;
      dy -= footY[k] * wgt * Math.pow(t, 1.5);
    }

    let x = bx + dx, y = by + dy;

    if (bendRate > 0) {
      // bend along the spine: the back keeps its length, everything below it folds inward
      const across = Math.max(0, y - backY) * Math.min(1, (0.96 * bendRadius) / thick);
      const over = Math.min(0, y - backY);
      const theta = (x - midX) * bendRate;
      const r = bendRadius - across - over;
      x = midX + r * Math.sin(theta);
      y = backY + bendRadius - r * Math.cos(theta);
      x = midX + (x - midX) * fit;
      y = backY + (y - backY) * fit + sink;
      if (pose.spin !== 0) {
        const rx = x - midX, ry = y - hubY;
        x = midX + rx * cosS - ry * sinS;
        y = hubY + rx * sinS + ry * cosS;
      }
    }

    out[i * 2] = x;
    out[i * 2 + 1] = y;
  }
}
