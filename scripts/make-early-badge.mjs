#!/usr/bin/env node
/**
 * Cuts the Beta racer out of its flat background for the Early Pangolin badge
 * (not mirrored, so the β pin reads the right way round).
 *
 *   node scripts/make-early-badge.mjs     → public/badges/early-pangolin.webp
 */
import sharp from 'sharp';
import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { data, info } = await sharp(join(root, 'public/beta/beta-racer.webp')).removeAlpha().raw().toBuffer({ resolveWithObject: true });
const { width: w, height: h } = info;

// Flood-fill the flat background from the border, so light parts of the body are left alone.
const bg = [data[0], data[1], data[2]];
const near = (p) => Math.hypot(data[p * 3] - bg[0], data[p * 3 + 1] - bg[1], data[p * 3 + 2] - bg[2]) < 40;
const isBg = new Uint8Array(w * h);
const stack = [];
for (let x = 0; x < w; x++) stack.push(x, (h - 1) * w + x);
for (let y = 0; y < h; y++) stack.push(y * w, y * w + w - 1);
while (stack.length) {
  const p = stack.pop();
  if (isBg[p] || !near(p)) continue;
  isBg[p] = 1;
  const x = p % w, y = (p / w) | 0;
  if (x > 0) stack.push(p - 1);
  if (x < w - 1) stack.push(p + 1);
  if (y > 0) stack.push(p - w);
  if (y < h - 1) stack.push(p + w);
}

// Pull the edge in by two pixels to lose the pale fringe, then soften it.
let mask = isBg;
for (let n = 0; n < 2; n++) {
  const next = mask.slice();
  for (let p = 0; p < w * h; p++) {
    if (mask[p]) continue;
    if (mask[p - 1] || mask[p + 1] || mask[p - w] || mask[p + w]) next[p] = 1;
  }
  mask = next;
}
const alpha = await sharp(Buffer.from(mask.map(v => (v ? 0 : 255))), { raw: { width: w, height: h, channels: 1 } }).blur(0.7).extractChannel(0).raw().toBuffer();
const rgba = Buffer.alloc(w * h * 4);
for (let p = 0; p < w * h; p++) {
  rgba[p * 4] = data[p * 3]; rgba[p * 4 + 1] = data[p * 3 + 1]; rgba[p * 4 + 2] = data[p * 3 + 2]; rgba[p * 4 + 3] = alpha[p];
}

const outDir = join(root, 'public/badges');
mkdirSync(outDir, { recursive: true });
const trimmed = await sharp(rgba, { raw: { width: w, height: h, channels: 4 } }).trim().png().toBuffer();
const done = await sharp(trimmed).webp({ quality: 92, alphaQuality: 100 }).toFile(join(outDir, 'early-pangolin.webp'));
console.log(`wrote public/badges/early-pangolin.webp ${done.width}x${done.height} ${done.size} bytes`);
