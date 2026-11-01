/**
 * Runtime background removal for NFT artwork.
 *
 * Work is done in a Web Worker (fetch → OffscreenCanvas → flood fill) so the
 * main thread stays responsive while ten racers are prepared. Falls back to
 * the main thread when workers/OffscreenCanvas are unavailable or the image
 * cannot be fetched cross-origin.
 */
import { processCutout, type BBox } from './cutout-core';

export interface Cutout {
  canvas: HTMLCanvasElement;
  /** opaque bounding box in canvas pixels */
  bbox: BBox;
}

const cache = new Map<string, Promise<Cutout | null>>();

/* ---------- worker pool (single worker is plenty for 10 images) ---------- */
type Pending = { resolve: (v: Cutout | null) => void };
let worker: Worker | null | undefined;
let nextId = 1;
const pending = new Map<number, Pending>();

function getWorker(): Worker | null {
  if (worker !== undefined) return worker;
  try {
    if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined') { worker = null; return null; }
    worker = new Worker(new URL('./cutout.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<{ id: number; result: { w: number; h: number; bbox: BBox; buffer: ArrayBuffer } | null }>) => {
      const p = pending.get(e.data.id);
      if (!p) return;
      pending.delete(e.data.id);
      const r = e.data.result;
      if (!r) { p.resolve(null); return; }
      const canvas = document.createElement('canvas');
      canvas.width = r.w; canvas.height = r.h;
      const ctx = canvas.getContext('2d');
      if (!ctx) { p.resolve(null); return; }
      ctx.putImageData(new ImageData(new Uint8ClampedArray(r.buffer), r.w, r.h), 0, 0);
      p.resolve({ canvas, bbox: r.bbox });
    };
    worker.onerror = () => {
      // fail every in-flight request; callers fall back to the main thread
      for (const p of pending.values()) p.resolve(null);
      pending.clear();
      worker = null;
    };
  } catch {
    worker = null;
  }
  return worker;
}

function viaWorker(url: string, size: number): Promise<Cutout | null> {
  const w = getWorker();
  if (!w) return Promise.resolve(null);
  return new Promise((resolve) => {
    const id = nextId++;
    pending.set(id, { resolve });
    w.postMessage({ id, url: new URL(url, location.href).href, size });
  });
}

/* ---------- main-thread fallback ---------- */
function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`image failed: ${url}`));
    img.src = url;
  });
}

async function viaMainThread(url: string, size: number): Promise<Cutout | null> {
  let img: HTMLImageElement;
  try { img = await loadImage(url); } catch { return null; }
  const scale = Math.min(1, size / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0, w, h);
  let data: ImageData;
  try { data = ctx.getImageData(0, 0, w, h); } catch { return { canvas, bbox: { x: 0, y: 0, w, h } }; } // tainted → keep as is
  const out = processCutout(data.data, w, h);
  ctx.putImageData(data, 0, 0);
  return { canvas, bbox: out.bbox };
}

/**
 * Returns the image on a canvas with its flat background removed, plus the
 * opaque bounding box. `size` caps the working resolution.
 */
export function cutoutImage(url: string, size = 448): Promise<Cutout | null> {
  const key = `${url}@${size}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const p = (async () => (await viaWorker(url, size)) ?? (await viaMainThread(url, size)))();
  cache.set(key, p);
  return p;
}
