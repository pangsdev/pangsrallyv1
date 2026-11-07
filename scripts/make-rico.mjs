#!/usr/bin/env node
/**
 * Rico Scales, the Pangs Cup race caller, from the owner's two booth stills (nothing redrawn):
 *   design/cup/rico/rico-booth-closed.webp   mouth shut (the base frame)
 *   design/cup/rico/rico-booth-open.webp     mouth open (framed a little differently)
 *
 * The open still is moved onto the closed one with the transform that best matches the face
 * (found by a least-squares search over scale/rotation/shift on the eye, snout and headset:
 * scale 1.0207, no rotation, shift +13.1/+17.7 px around (680, 182.5); the hat and the scene
 * agree within a pixel or two). Only a soft oval over the snout, mouth and eye is kept, so the
 * hands and the rest of the frame never jump. Both frames are cropped to the booth camera shot,
 * which leaves out the left window (it shows horses). The eye is cut out of the open layer, so
 * Rico keeps the same smiling eye whether his mouth is open or shut; only the mouth moves.
 *
 *   node scripts/make-rico.mjs   → public/cup/rico.webp (closed) + public/cup/rico-talk.webp (open mouth layer)
 *                                  + public/cup/rico-face.webp (head, for the race caption bar)
 *                                  + rico-watch.webp, rico-cheer.webp, rico-cheer-open.webp (poses)
 *
 * Poses (owner's stills, same booth and exactly the same framing as the shut still, measured
 * shift 0 px on the windows, Live sign and glass, so whole frames swap without the scene moving):
 *   rico-booth-watch.webp     turned to the track, mouth shut: while he watches between calls
 *   rico-booth-cheer-b.webp   arm up, mouth half open  ┐ lip flap pair for the big calls
 *   rico-booth-cheer-a.webp   arm up, mouth wide open  ┘ (the winner, "And they're off!")
 */
import sharp from 'sharp';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CLOSED = join(root, 'design/cup/rico/rico-booth-closed.webp');
const OPEN = join(root, 'design/cup/rico/rico-booth-open.webp');
const FIT = { s: 1.0207, tx: 13.1, ty: 17.7, cx: 680, cy: 182.5 }; // closed → open coordinates
const MOUTH = { x: 600, y: 236, rx: 96, ry: 50, feather: 18 };     // oval kept from the open still
const EYE = { x: 641, y: 192, r: 27, feather: 10 };                // the shut still's smiling eye and brow always stay
const CROP = { left: 418, top: 22, width: 580, height: 371 };      // the booth camera shot

const raw = async (file) => {
  const { data, info } = await sharp(file).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return { d: data, w: info.width, h: info.height };
};
const A = await raw(CLOSED);
const B = await raw(OPEN);
const layer = Buffer.alloc(A.w * A.h * 4);
const edge = MOUTH.feather / Math.min(MOUTH.rx, MOUTH.ry);
for (let y = 0; y < A.h; y++) for (let x = 0; x < A.w; x++) {
  const o = (y * A.w + x) * 4;
  const r = Math.hypot((x - MOUTH.x) / MOUTH.rx, (y - MOUTH.y) / MOUTH.ry);
  const a = r < 1 - edge ? 1 : r > 1 ? 0 : (1 - r) / edge;
  const e = Math.min(1, Math.max(0, (Math.hypot(x - EYE.x, y - EYE.y) - EYE.r) / EYE.feather));
  const k = a * a * (3 - 2 * a) * e * e * (3 - 2 * e);
  layer[o + 3] = Math.round(k * 255);
  if (!layer[o + 3]) continue;
  const X = FIT.s * (x - FIT.cx) + FIT.cx + FIT.tx, Y = FIT.s * (y - FIT.cy) + FIT.cy + FIT.ty;
  const xi = Math.floor(X), yi = Math.floor(Y), fx = X - xi, fy = Y - yi;
  const px = (xx, yy, c) => B.d[(Math.min(B.h - 1, yy) * B.w + Math.min(B.w - 1, xx)) * 3 + c];
  for (let c = 0; c < 3; c++) {
    layer[o + c] = px(xi, yi, c) * (1 - fx) * (1 - fy) + px(xi + 1, yi, c) * fx * (1 - fy)
      + px(xi, yi + 1, c) * (1 - fx) * fy + px(xi + 1, yi + 1, c) * fx * fy;
  }
}
await sharp(CLOSED).extract(CROP).webp({ quality: 90 }).toFile(join(root, 'public/cup/rico.webp'));
await sharp(layer, { raw: { width: A.w, height: A.h, channels: 4 } }).extract(CROP)
  .webp({ quality: 92, alphaQuality: 100 }).toFile(join(root, 'public/cup/rico-talk.webp'));
for (const [src, out] of [['watch', 'rico-watch'], ['cheer-b', 'rico-cheer'], ['cheer-a', 'rico-cheer-open']]) {
  await sharp(join(root, `design/cup/rico/rico-booth-${src}.webp`)).extract(CROP).webp({ quality: 90 }).toFile(join(root, `public/cup/${out}.webp`));
}
await sharp(CLOSED).extract({ left: 520, top: 110, width: 190, height: 190 }).resize(128).webp({ quality: 90 }).toFile(join(root, 'public/cup/rico-face.webp'));
console.log(`public/cup/rico.webp + rico-talk.webp (${CROP.width}×${CROP.height})`);
