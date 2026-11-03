#!/usr/bin/env node
/**
 * Cuts a racer out of its flat background for HeroRunner (transparent webp).
 * Flood-fills the background from the image border so white highlights inside the pangolin are kept.
 *
 *   node scripts/make-hero-runner.mjs                       # teaser #1 → public/landing/runner.webp (landing hero)
 *   node scripts/make-hero-runner.mjs public/beta/beta-racer.webp public/landing/runner-beta.webp   # lobby Online card
 */
import sharp from 'sharp';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SIZE = 1024;
const TOL = 38; // colour distance from the background still counted as background

const [input = 'public/nft-images/1.webp', output = 'public/landing/runner.webp'] = process.argv.slice(2);
const { data, info } = await sharp(join(root, input)).resize(SIZE, SIZE).removeAlpha().raw().toBuffer({ resolveWithObject: true });
const { width: w, height: h } = info;
const bg = [data[0], data[1], data[2]];
const near = (p) => Math.hypot(data[p * 3] - bg[0], data[p * 3 + 1] - bg[1], data[p * 3 + 2] - bg[2]) < TOL;

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

const rgba = Buffer.alloc(w * h * 4);
for (let p = 0; p < w * h; p++) {
  rgba[p * 4] = data[p * 3]; rgba[p * 4 + 1] = data[p * 3 + 1]; rgba[p * 4 + 2] = data[p * 3 + 2];
  rgba[p * 4 + 3] = isBg[p] ? 0 : 255;
}
// Soften the 1px fringe, then crop to the pangolin.
const alpha = await sharp(rgba, { raw: { width: w, height: h, channels: 4 } }).extractChannel(3).blur(0.8).raw().toBuffer();
for (let p = 0; p < w * h; p++) rgba[p * 4 + 3] = alpha[p];
await sharp(rgba, { raw: { width: w, height: h, channels: 4 } })
  .trim({ threshold: 1 })
  .resize({ width: 420 })
  .webp({ quality: 88, alphaQuality: 90 })
  .toFile(join(root, output));
console.log(`wrote ${output}`);
