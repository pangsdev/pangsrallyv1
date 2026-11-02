#!/usr/bin/env node
/**
 * Builds the browser-tab and home-screen icons from the pangolin ball in the logo:
 * the ball cut out as a circle on a dark purple rounded tile, so it stays readable at 16 px.
 *
 *   node scripts/make-favicons.mjs
 */
import sharp from 'sharp';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pub = (f) => join(root, 'public', f);

// Ball position in light-logo.png (2172x724), measured by eye.
const BALL = { cx: 1632, cy: 315, r: 172 };

const S = 512;
const ballD = Math.round(S * 0.8);
const ball = await sharp(pub('light-logo.png'))
  .extract({ left: BALL.cx - BALL.r, top: BALL.cy - BALL.r, width: BALL.r * 2, height: BALL.r * 2 })
  .resize(ballD, ballD)
  .composite([{ input: Buffer.from(`<svg width="${ballD}" height="${ballD}"><circle cx="${ballD / 2}" cy="${ballD / 2}" r="${ballD / 2}"/></svg>`), blend: 'dest-in' }])
  .png()
  .toBuffer();

const tile = (rounded) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#3b1c9e"/><stop offset="1" stop-color="#140a2e"/></linearGradient></defs>
  <rect width="${S}" height="${S}" rx="${rounded ? S * 0.22 : 0}" fill="url(#g)"/>
  <circle cx="${S / 2}" cy="${S / 2}" r="${ballD / 2 + S * 0.025}" fill="#7b5cff"/>
</svg>`);

const make = async (rounded) => sharp(tile(rounded)).composite([{ input: ball, left: (S - ballD) / 2, top: (S - ballD) / 2 }]).png().toBuffer();
const roundedIcon = await make(true);
const squareIcon = await make(false); // iOS rounds the corners itself

for (const [file, size, src] of [
  ['favicon-16.png', 16, roundedIcon],
  ['favicon-32.png', 32, roundedIcon],
  ['favicon-48.png', 48, roundedIcon],
  ['icon-192.png', 192, roundedIcon],
  ['icon-512.png', 512, roundedIcon],
  ['apple-touch-icon.png', 180, squareIcon],
]) {
  await sharp(src).resize(size, size, { kernel: 'lanczos3' }).png({ compressionLevel: 9 }).toFile(pub(file));
  console.log('wrote public/' + file);
}
