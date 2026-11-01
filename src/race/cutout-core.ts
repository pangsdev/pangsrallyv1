/**
 * Pure pixel routines shared by the main thread and the cutout worker.
 *
 * The collection images have a flat background colour (Background trait:
 * white / green / yellow). We flood-fill from the border over pixels close to
 * the corner colour and make them transparent, with a soft edge. Enclosed
 * regions of the same colour (e.g. a white scarf) are preserved.
 */

export interface BBox { x: number; y: number; w: number; h: number }

export interface CutoutResult {
  data: Uint8ClampedArray;
  w: number;
  h: number;
  /** bounding box of the opaque (alpha > 40) pixels */
  bbox: BBox;
  /** false when the background was not flat and the image was left untouched */
  cut: boolean;
}

function colorDist(a: Uint8ClampedArray, i: number, r: number, g: number, b: number): number {
  const dr = a[i] - r, dg = a[i + 1] - g, db = a[i + 2] - b;
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

export function measureBBox(px: Uint8ClampedArray, w: number, h: number, threshold = 40): BBox {
  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (px[(y * w + x) * 4 + 3] > threshold) {
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return { x: 0, y: 0, w, h };
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

/** Mutates `px` in place; returns the result descriptor. */
export function processCutout(px: Uint8ClampedArray, w: number, h: number): CutoutResult {
  const done = (cut: boolean): CutoutResult => ({ data: px, w, h, bbox: measureBBox(px, w, h), cut });

  // Background colour = average of the four corners; bail out if corners disagree
  const corners = [0, (w - 1) * 4, (h - 1) * w * 4, ((h - 1) * w + w - 1) * 4];
  let r = 0, g = 0, b = 0;
  for (const c of corners) { r += px[c]; g += px[c + 1]; b += px[c + 2]; }
  r /= 4; g /= 4; b /= 4;
  for (const c of corners) if (colorDist(px, c, r, g, b) > 28) return done(false);
  if (px[3] < 10) return done(false); // already transparent

  const TOL_LOW = 26, TOL_HIGH = 70;
  const visited = new Uint8Array(w * h);
  const stack: number[] = [];
  const push = (x: number, y: number) => {
    const idx = y * w + x;
    if (visited[idx]) return;
    if (colorDist(px, idx * 4, r, g, b) > TOL_HIGH) return;
    visited[idx] = 1;
    stack.push(idx);
  };
  for (let x = 0; x < w; x++) { push(x, 0); push(x, h - 1); }
  for (let y = 0; y < h; y++) { push(0, y); push(w - 1, y); }

  while (stack.length) {
    const idx = stack.pop()!;
    const x = idx % w, y = (idx - x) / w;
    const d = colorDist(px, idx * 4, r, g, b);
    const a = d <= TOL_LOW ? 0 : Math.min(1, (d - TOL_LOW) / (TOL_HIGH - TOL_LOW));
    px[idx * 4 + 3] = Math.round(px[idx * 4 + 3] * a);
    if (x > 0) push(x - 1, y);
    if (x < w - 1) push(x + 1, y);
    if (y > 0) push(x, y - 1);
    if (y < h - 1) push(x, y + 1);
  }
  return done(true);
}
