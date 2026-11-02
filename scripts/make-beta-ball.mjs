#!/usr/bin/env node
/**
 * Builds public/sprites/ball_beta.png: the rolled-up ball of the Beta pass racer.
 * Same method as make-aurora-ball.mjs (keep ball_blue.png's shading, swap the hue
 * along the diagonal), with the Beta body's violet → magenta → gold stops from
 * scripts/make-beta-nft.mjs.
 *
 *   node scripts/make-beta-ball.mjs
 */
import sharp from 'sharp';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const STOPS = [258, 300, 345, 400];   // unwrapped hue degrees, head → tail
const SAT = 0.78;

const toHsl = ([r, g, b]) => {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
  if (mx === mn) return [0, 0, l];
  const d = mx - mn, s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  const h = mx === r ? ((g - b) / d + (g < b ? 6 : 0)) : mx === g ? ((b - r) / d + 2) : ((r - g) / d + 4);
  return [h * 60, s, l];
};
const toRgb = (h, s, l) => {
  h = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [r + m, g + m, b + m].map(v => Math.round(Math.min(1, Math.max(0, v)) * 255));
};
const lerp = (arr, t) => {
  const x = Math.min(1, Math.max(0, t)) * (arr.length - 1);
  const k = Math.min(arr.length - 2, Math.floor(x));
  return arr[k] + (arr[k + 1] - arr[k]) * (x - k);
};

const { data, info } = await sharp(join(root, 'public/sprites/ball_blue.png')).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const out = Buffer.from(data);
for (let y = 0; y < info.height; y++) {
  for (let x = 0; x < info.width; x++) {
    const i = (y * info.width + x) * 4;
    if (data[i + 3] === 0) continue;
    const [, s, l] = toHsl([data[i], data[i + 1], data[i + 2]]);
    const t = (x + y) / (info.width + info.height - 2);
    // Gold reads darker than violet at the same lightness: lift the tail end a little.
    const [r, g, b] = toRgb(lerp(STOPS, t), Math.max(s, SAT), Math.min(0.92, l * (1 + 0.18 * t)));
    out[i] = r; out[i + 1] = g; out[i + 2] = b;
  }
}
await sharp(out, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toFile(join(root, 'public/sprites/ball_beta.png'));
console.log('wrote public/sprites/ball_beta.png');
