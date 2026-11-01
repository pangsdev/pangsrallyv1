/**
 * Web Worker: removes the flat background of an NFT image and measures the
 * opaque bounding box. Runs off the main thread so the race UI never stalls.
 */
import { processCutout, type CutoutResult } from './cutout-core';

interface Req { id: number; url: string; size: number }
interface Res { id: number; result: (Omit<CutoutResult, 'data'> & { buffer: ArrayBuffer }) | null; error?: string }

const ctx = self as unknown as { onmessage: ((e: MessageEvent<Req>) => void) | null; postMessage: (msg: Res, transfer?: Transferable[]) => void };

ctx.onmessage = async (e) => {
  const { id, url, size } = e.data;
  try {
    const res = await fetch(url, { mode: 'cors' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const bitmap = await createImageBitmap(await res.blob());
    const scale = Math.min(1, size / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = new OffscreenCanvas(w, h);
    const c2d = canvas.getContext('2d', { willReadFrequently: true });
    if (!c2d) throw new Error('no 2d context');
    c2d.drawImage(bitmap, 0, 0, w, h);
    bitmap.close();
    const img = c2d.getImageData(0, 0, w, h);
    const out = processCutout(img.data, w, h);
    const buffer = out.data.buffer as ArrayBuffer;
    ctx.postMessage({ id, result: { w: out.w, h: out.h, bbox: out.bbox, cut: out.cut, buffer } }, [buffer]);
  } catch (err) {
    ctx.postMessage({ id, result: null, error: String(err) });
  }
};
