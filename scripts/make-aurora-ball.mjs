#!/usr/bin/env node
/**
 * Builds public/sprites/ball_aurora.png: the rolled-up ball for the teal → blue → purple
 * "Aurora" body seen on teaser artworks 1, 4, 9 and 10 (none of the eight collection
 * balls matches it). Keeps the shading of ball_blue.png and recolours it with the
 * average teal / blue / purple sampled from those teasers' scales.
 *
 *   node scripts/make-aurora-ball.mjs
 */
import sharp from 'sharp';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TEASERS = [1, 4, 9, 10];

const hue = (r, g, b) => {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  if (mx === mn) return { h: 0, s: 0 };
  const d = mx - mn;
  const h = mx === r ? ((g - b) / d + (g < b ? 6 : 0)) : mx === g ? ((b - r) / d + 2) : ((r - g) / d + 4);
  return { h: h * 60, s: d / mx };
};

// 1. Sample the three scale colours from the teasers (saturated, mid-light pixels only).
const bands = { teal: [170, 205], blue: [205, 250], purple: [260, 330] };
const sums = Object.fromEntries(Object.keys(bands).map(k => [k, [0, 0, 0, 0]]));
for (const id of TEASERS) {
  const { data } = await sharp(join(root, `public/nft-images/${id}.webp`)).resize(256, 256).raw().toBuffer({ resolveWithObject: true });
  for (let i = 0; i < data.length; i += 3) {
    const [r, g, b] = [data[i], data[i + 1], data[i + 2]];
    const { h, s } = hue(r, g, b);
    const l = (r + g + b) / 765;
    if (s < 0.35 || l < 0.15 || l > 0.85) continue;
    for (const [k, [lo, hi]] of Object.entries(bands)) {
      if (h >= lo && h < hi) { sums[k][0] += r; sums[k][1] += g; sums[k][2] += b; sums[k][3]++; }
    }
  }
}
const palette = Object.fromEntries(Object.entries(sums).map(([k, [r, g, b, n]]) => [k, [r / n, g / n, b / n]]));
console.log('sampled', Object.fromEntries(Object.entries(palette).map(([k, c]) => [k, c.map(Math.round)])));

// 2. Recolour ball_blue.png in HSL: keep each pixel's saturation and lightness (the shading and
//    gloss), swap only the hue for a diagonal teal → blue → purple gradient, and darken toward the
//    purple end the way the teasers' scales do.
const toHsl = ([r, g, b]) => {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
  if (mx === mn) return [0, 0, l];
  const d = mx - mn, s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  const h = mx === r ? ((g - b) / d + (g < b ? 6 : 0)) : mx === g ? ((b - r) / d + 2) : ((r - g) / d + 4);
  return [h * 60, s, l];
};
const toRgb = (h, s, l) => {
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [r + m, g + m, b + m].map(v => Math.round(Math.min(1, Math.max(0, v)) * 255));
};
const stops = [palette.teal, palette.blue, palette.purple].map(toHsl).map(([h]) => h);
const dim = [1, 0.82, 0.68];
const lerp = (arr, t) => {
  const x = Math.min(1, Math.max(0, t)) * (arr.length - 1);
  const k = Math.min(arr.length - 2, Math.floor(x));
  return arr[k] + (arr[k + 1] - arr[k]) * (x - k);
};
console.log('hue stops', stops.map(Math.round));

const { data, info } = await sharp(join(root, 'public/sprites/ball_blue.png')).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const out = Buffer.from(data);
for (let y = 0; y < info.height; y++) {
  for (let x = 0; x < info.width; x++) {
    const i = (y * info.width + x) * 4;
    if (data[i + 3] === 0) continue;
    const [, s, l] = toHsl([data[i], data[i + 1], data[i + 2]]);
    // pow > 1 widens the teal band, like the teasers' teal head-and-shoulders.
    const t = Math.pow((x + y) / (info.width + info.height - 2), 1.35);
    const [r, g, b] = toRgb(lerp(stops, t), s, l * lerp(dim, t));
    out[i] = r; out[i + 1] = g; out[i + 2] = b;
  }
}
await sharp(out, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toFile(join(root, 'public/sprites/ball_aurora.png'));
console.log('wrote public/sprites/ball_aurora.png');
