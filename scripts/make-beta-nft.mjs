#!/usr/bin/env node
/**
 * Builds the Test Season "Beta" NFT artwork in the Genesis style: the bare
 * teaser #3 pangolin (side view, no accessory), its brown scales recoloured
 * along the body into the site's purple → gold gradient, a gold β pin on the
 * shoulder, on a flat background like the Genesis pieces.
 *
 *   node scripts/make-beta-nft.mjs        → design/beta-nft/beta-*.png
 */
import sharp from 'sharp';
import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'design/beta-nft');
mkdirSync(out, { recursive: true });
const S = 2048;

const { data, info } = await sharp(join(root, 'public/nft-images/3.webp')).resize(S, S).removeAlpha().raw().toBuffer({ resolveWithObject: true });
const { width: w, height: h } = info;

// 1. Cut out: flood-fill the flat background from the border.
const bg = [data[0], data[1], data[2]];
const near = (p) => Math.hypot(data[p * 3] - bg[0], data[p * 3 + 1] - bg[1], data[p * 3 + 2] - bg[2]) < 34;
const isBg = new Uint8Array(w * h);
const stack = [];
for (let x = 0; x < w; x++) stack.push(x, (h - 1) * w + x);
for (let y = 0; y < h; y++) stack.push(y * w, y * w + w - 1);
while (stack.length) {
  const p = stack.pop();
  if (isBg[p] || !near(p)) continue;
  isBg[p] = 1;
  const x = p % w, y = (p / w) | 0;
  if (x > 0) stack.push(p - 1); if (x < w - 1) stack.push(p + 1);
  if (y > 0) stack.push(p - w); if (y < h - 1) stack.push(p + w);
}

// 2. Recolour the brown scales (keep lightness and shading, swap hue + boost saturation).
const toHsl = (r, g, b) => {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
  if (mx === mn) return [0, 0, l];
  const d = mx - mn, s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  const hh = mx === r ? ((g - b) / d + (g < b ? 6 : 0)) : mx === g ? ((b - r) / d + 2) : ((r - g) / d + 4);
  return [hh * 60, s, l];
};
const toRgb = (hh, s, l) => {
  hh = ((hh % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((hh / 60) % 2) - 1)), m = l - c / 2;
  const [r, g, b] = hh < 60 ? [c, x, 0] : hh < 120 ? [x, c, 0] : hh < 180 ? [0, c, x] : hh < 240 ? [0, x, c] : hh < 300 ? [x, 0, c] : [c, 0, x];
  return [r + m, g + m, b + m].map(v => Math.round(Math.min(1, Math.max(0, v)) * 255));
};
// Body extent, for the head → tail gradient.
let minX = w, maxX = 0;
for (let p = 0; p < w * h; p++) if (!isBg[p]) { const x = p % w; if (x < minX) minX = x; if (x > maxX) maxX = x; }
// Hue stops head → tail: violet (#5432d3-ish) → magenta → gold (#ffd166-ish). Unwrapped degrees.
const STOPS = [258, 300, 345, 400];
const hueAt = (t) => { const x = Math.min(0.999, Math.max(0, t)) * (STOPS.length - 1), k = Math.floor(x); return STOPS[k] + (STOPS[k + 1] - STOPS[k]) * (x - k); };

const rgba = Buffer.alloc(w * h * 4);
for (let p = 0; p < w * h; p++) {
  let r = data[p * 3], g = data[p * 3 + 1], b = data[p * 3 + 2];
  if (!isBg[p]) {
    const [hh, s, l] = toHsl(r, g, b);
    // Scales and skin are warm browns/oranges; eyes, claws and outlines are near-black and stay.
    // Skin (face, snout, feet) is the same hue but much less saturated than the scales: keep it,
    // blending over a narrow saturation band so there is no hard edge.
    const k = hh >= 5 && hh <= 50 && l > 0.12 ? Math.min(1, Math.max(0, (s - 0.36) / 0.1)) : 0;
    if (k > 0) {
      const t = ((p % w) - minX) / (maxX - minX);
      const [nr, ng, nb] = toRgb(hueAt(t), Math.min(1, s * 1.08), l * (0.96 + 0.08 * t));
      r = Math.round(r + (nr - r) * k); g = Math.round(g + (ng - g) * k); b = Math.round(b + (nb - b) * k);
    }
  }
  rgba[p * 4] = r; rgba[p * 4 + 1] = g; rgba[p * 4 + 2] = b; rgba[p * 4 + 3] = isBg[p] ? 0 : 255;
}
const alpha = await sharp(rgba, { raw: { width: w, height: h, channels: 4 } }).extractChannel(3).blur(1).raw().toBuffer();
// Pull the soft edge inwards so no light fringe from the old background shows on dark colours.
for (let p = 0; p < w * h; p++) rgba[p * 4 + 3] = Math.max(0, Math.min(255, (alpha[p] - 150) * 2.4));
const body = await sharp(rgba, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer();

// 3. Gold β pin on the shoulder (position measured on teaser #3 at 2048 px).
const PIN = { x: 860, y: 900, r: 104 };
const pin = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}">
  <defs>
    <radialGradient id="g" cx="38%" cy="32%" r="75%"><stop offset="0" stop-color="#fff3c4"/><stop offset="0.45" stop-color="#ffd166"/><stop offset="1" stop-color="#b8860b"/></radialGradient>
    <filter id="sh" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="0" dy="10" stdDeviation="10" flood-color="#1a0b33" flood-opacity="0.45"/></filter>
  </defs>
  <g filter="url(#sh)">
    <circle cx="${PIN.x}" cy="${PIN.y}" r="${PIN.r}" fill="#3b1c9e"/>
    <circle cx="${PIN.x}" cy="${PIN.y}" r="${PIN.r - 14}" fill="url(#g)"/>
    <circle cx="${PIN.x}" cy="${PIN.y}" r="${PIN.r - 30}" fill="none" stroke="#8a5a00" stroke-width="5" stroke-opacity="0.55"/>
    <text x="${PIN.x}" y="${PIN.y + 44}" text-anchor="middle" font-family="Georgia, 'Times New Roman', serif" font-size="132" font-weight="700" fill="#3b1c9e">β</text>
  </g>
</svg>`);

for (const [name, bgColor] of [['lavender', '#e4dcff'], ['night', '#1b1236'], ['cream', '#fbf3df']]) {
  await sharp({ create: { width: S, height: S, channels: 4, background: bgColor } })
    .composite([{ input: body }, { input: pin }])
    .png({ compressionLevel: 9 })
    .toFile(join(out, `beta-${name}.png`));
  console.log(`wrote design/beta-nft/beta-${name}.png`);
}
