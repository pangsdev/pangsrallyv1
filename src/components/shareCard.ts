import { BALL_SPRITES, type BodyColor } from '../race/sprites';

/** X shows 16:9 images uncropped in the feed. */
export const CARD_W = 1200;
export const CARD_H = 675;
const TRACK_H = 430;
const GOLD = '#ffd700';

export interface ShareCardInput {
  /** the track at the finish, copied from the Pixi canvas */
  track: HTMLCanvasElement | null;
  terrain: string;
  /** "Beta Season" or "Pangs Cup" */
  event: string;
  playerName: string;
  position: number;
  fieldSize: number;
  points: number;
  pointsLabel: string;
  top: { position: number; number: number; name: string; body: BodyColor; time: number | null; isPlayer: boolean }[];
}

export function ordinalOf(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

/** shrink the font until the text fits */
function fitText(ctx: CanvasRenderingContext2D, text: string, maxW: number, weight: number, size: number, family = 'Outfit, Inter, sans-serif') {
  let s = size;
  ctx.font = `${weight} ${s}px ${family}`;
  while (s > 12 && ctx.measureText(text).width > maxW) { s -= 2; ctx.font = `${weight} ${s}px ${family}`; }
  return s;
}

/** Draws the result card: the track at the finish on top, the result below. */
export async function drawShareCard(d: ShareCardInput): Promise<HTMLCanvasElement> {
  try {
    await Promise.all([
      document.fonts.load('900 40px Outfit'),
      document.fonts.load('700 40px Outfit'),
      document.fonts.load('600 20px Inter'),
    ]);
  } catch { /* system fonts are fine */ }

  const c = document.createElement('canvas');
  c.width = CARD_W;
  c.height = CARD_H;
  const ctx = c.getContext('2d')!;

  // background
  const bg = ctx.createLinearGradient(0, 0, CARD_W, CARD_H);
  bg.addColorStop(0, '#16152f');
  bg.addColorStop(1, '#0b0c1c');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, CARD_W, CARD_H);

  // track in the top band: crop a little at most, so every lane stays in; blurred fill on the sides
  if (d.track && d.track.width > 0 && d.track.height > 0) {
    const t = d.track;
    const cover = Math.max(CARD_W / t.width, TRACK_H / t.height);
    const contain = Math.min(CARD_W / t.width, TRACK_H / t.height);
    const scale = Math.min(cover, contain * 1.15);
    const dw = t.width * scale, dh = t.height * scale;
    if (dw < CARD_W - 1) {
      ctx.save();
      ctx.filter = 'blur(24px) brightness(0.55)';
      ctx.drawImage(t, -40, -40, CARD_W + 80, TRACK_H + 80);
      ctx.restore();
    }
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, CARD_W, TRACK_H);
    ctx.clip();
    // when it is too tall, lose sky rather than lanes
    ctx.drawImage(t, (CARD_W - dw) / 2, Math.min(0, (TRACK_H - dh) * 0.35), dw, dh);
    ctx.restore();
    if (dw < CARD_W - 1) {
      // soften the seams
      for (const [x0, x1] of [[(CARD_W - dw) / 2, (CARD_W - dw) / 2 + 40], [(CARD_W + dw) / 2, (CARD_W + dw) / 2 - 40]]) {
        const g = ctx.createLinearGradient(x0, 0, x1, 0);
        g.addColorStop(0, 'rgba(11,12,28,0.55)');
        g.addColorStop(1, 'rgba(11,12,28,0)');
        ctx.fillStyle = g;
        ctx.fillRect(Math.min(x0, x1), 0, 40, TRACK_H);
      }
    }
  }
  const fade = ctx.createLinearGradient(0, TRACK_H - 120, 0, TRACK_H + 2);
  fade.addColorStop(0, 'rgba(11,12,28,0)');
  fade.addColorStop(1, 'rgba(15,15,35,1)');
  ctx.fillStyle = fade;
  ctx.fillRect(0, TRACK_H - 120, CARD_W, 122);
  const top = ctx.createLinearGradient(0, 0, 0, 110);
  top.addColorStop(0, 'rgba(5,6,16,0.6)');
  top.addColorStop(1, 'rgba(5,6,16,0)');
  ctx.fillStyle = top;
  ctx.fillRect(0, 0, CARD_W, 110);

  const [logo, ...balls] = await Promise.all([
    loadImage('/dark-logo.webp'),
    ...d.top.map(r => loadImage(BALL_SPRITES[r.body])),
  ]);

  // logo + site, over the track
  if (logo) {
    // the logo art has its own dark backdrop: frame it as a badge
    const h = 70, w = (logo.width / logo.height) * h;
    ctx.save();
    roundRect(ctx, 26, 18, w, h, 16);
    ctx.clip();
    ctx.drawImage(logo, 26, 18, w, h);
    ctx.restore();
    roundRect(ctx, 26, 18, w, h, 16);
    ctx.strokeStyle = 'rgba(255,215,0,0.45)';
    ctx.lineWidth = 2;
    ctx.stroke();
  }
  ctx.font = '700 22px Outfit, Inter, sans-serif';
  const site = 'pangsrally.com';
  const sw = ctx.measureText(site).width + 36;
  roundRect(ctx, CARD_W - sw - 28, 30, sw, 44, 22);
  ctx.fillStyle = 'rgba(8,9,22,0.72)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,215,0,0.55)';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = GOLD;
  ctx.textBaseline = 'middle';
  ctx.fillText(site, CARD_W - sw - 28 + 18, 53);

  /* ---------- result band ---------- */
  const y0 = TRACK_H;

  // position badge
  const bx = 120, by = y0 + 118, br = 86;
  const ring = ctx.createLinearGradient(bx - br, by - br, bx + br, by + br);
  const podium = d.position <= 3;
  ring.addColorStop(0, podium ? ['#fff3a6', '#f1f4ff', '#ffcf9e'][d.position - 1] : '#c7cbe0');
  ring.addColorStop(1, podium ? ['#d49b00', '#9aa3b8', '#b8662c'][d.position - 1] : '#5c6178');
  ctx.beginPath();
  ctx.arc(bx, by, br, 0, Math.PI * 2);
  ctx.fillStyle = ring;
  ctx.fill();
  ctx.beginPath();
  ctx.arc(bx, by, br - 9, 0, Math.PI * 2);
  ctx.fillStyle = '#14142c';
  ctx.fill();
  ctx.textAlign = 'center';
  ctx.fillStyle = podium ? ['#ffd700', '#e6ebf5', '#f0a467'][d.position - 1] : '#ffffff';
  ctx.font = '900 76px Outfit, Inter, sans-serif';
  ctx.fillText(String(d.position), bx, by - 8);
  ctx.font = '700 22px Outfit, Inter, sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.fillText(`OF ${d.fieldSize}`, bx, by + 44);

  // headline
  ctx.textAlign = 'left';
  const hx = 238, maxW = 500;
  const headline = d.position === 1 ? 'CHAMPION!' : podium ? 'PODIUM FINISH!' : 'RACE COMPLETE';
  ctx.fillStyle = GOLD;
  fitText(ctx, headline, maxW, 900, 54);
  ctx.fillText(headline, hx, y0 + 62);

  ctx.fillStyle = '#ffffff';
  const line = d.position === 1 ? `${d.playerName} won the race` : `${d.playerName} finished ${ordinalOf(d.position)}`;
  fitText(ctx, line, maxW, 700, 34);
  ctx.fillText(line, hx, y0 + 116);

  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.font = '500 22px Inter, sans-serif';
  ctx.fillText(`${d.terrain} Track · ${d.event} · 400m`, hx, y0 + 158);

  // points chip
  const pts = `+${d.points} ${d.pointsLabel}`;
  ctx.font = '800 24px Outfit, Inter, sans-serif';
  const pw = ctx.measureText(pts).width + 40;
  roundRect(ctx, hx, y0 + 184, pw, 46, 23);
  ctx.fillStyle = 'rgba(255,215,0,0.12)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,215,0,0.5)';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = GOLD;
  ctx.fillText(pts, hx + 20, y0 + 208);

  // top finishers
  const lx = 790, lw = 380;
  roundRect(ctx, lx, y0 + 18, lw, 222, 18);
  ctx.fillStyle = 'rgba(255,255,255,0.05)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.12)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.font = '700 15px Inter, sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  ctx.fillText('FINISH ORDER', lx + 20, y0 + 42);
  const rowH = 44;
  d.top.forEach((r, i) => {
    const ry = y0 + 64 + i * rowH + rowH / 2 - 8;
    if (r.isPlayer) {
      roundRect(ctx, lx + 8, ry - rowH / 2 + 2, lw - 16, rowH - 4, 10);
      ctx.fillStyle = 'rgba(255,215,0,0.14)';
      ctx.fill();
    }
    ctx.textAlign = 'center';
    ctx.font = '900 22px Outfit, Inter, sans-serif';
    ctx.fillStyle = r.position <= 3 ? ['#ffd700', '#dfe5f2', '#f0a467'][r.position - 1] : 'rgba(255,255,255,0.75)';
    ctx.fillText(String(r.position), lx + 32, ry);
    const ball = balls[i];
    if (ball) ctx.drawImage(ball, lx + 52, ry - 15, 30, 30);
    ctx.textAlign = 'left';
    ctx.fillStyle = r.isPlayer ? GOLD : '#ffffff';
    const name = `#${r.number}  ${r.name}${r.isPlayer ? ' (me)' : ''}`;
    fitText(ctx, name, 200, 700, 21, 'Inter, sans-serif');
    ctx.fillText(name, lx + 94, ry);
    ctx.textAlign = 'right';
    ctx.font = '600 18px Inter, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.fillText(r.time === null ? '' : `${r.time.toFixed(2)}s`, lx + lw - 20, ry);
    ctx.textAlign = 'left';
  });

  return c;
}

export function canvasToBlob(c: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise(resolve => c.toBlob(b => resolve(b), 'image/png'));
}
