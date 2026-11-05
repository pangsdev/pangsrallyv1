import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { SEASON_BADGE_NAME, STREAK_BADGES, type Streak } from '../race/testSeason';
import './badges.css';

type Tier = (typeof STREAK_BADGES)[number];

/** Metal of each tier: rim highlight, rim mid, rim shadow, inner glow. */
const METALS: Record<number, [string, string, string, string]> = {
  3: ['#f6c79a', '#b86f3a', '#5e3216', '#e8924f'],
  7: ['#ffffff', '#aeb8c6', '#4d5666', '#c9d6ea'],
  14: ['#fff3b8', '#e8b12c', '#7a4e06', '#ffd166'],
  30: ['#b9f6ff', '#6a7dff', '#3a1d8f', '#7fe3ff'],
};

const tierOf = (days: number): Tier | undefined => STREAK_BADGES.find(b => b.days === days);
/* Medal geometry, in the 120-unit medal space. The plate is a pointy-top hexagon around (60, 60). */
const LIGHT = -125;                 // light comes from the upper left, as a degree on the medal
const PLATE_R = 54;
const FACE_R = 46.4;
const rad = (deg: number) => deg * Math.PI / 180;
const at = (r: number, deg: number) => `${(60 + r * Math.cos(rad(deg))).toFixed(2)} ${(60 + r * Math.sin(rad(deg))).toFixed(2)}`;
const hexPath = (r: number) => `M${[0, 1, 2, 3, 4, 5].map(i => at(r, -90 + i * 60)).join(' L')} Z`;

function mix(a: string, b: string, t: number): string {
  const n = (c: string, i: number) => parseInt(c.slice(1 + i * 2, 3 + i * 2), 16);
  return `#${[0, 1, 2].map(i => Math.round(n(a, i) + (n(b, i) - n(a, i)) * t).toString(16).padStart(2, '0')).join('')}`;
}
/** Tone of a flat metal face turned towards `deg`. */
function lit(deg: number, hi: string, mid: string, lo: string): string {
  const d = Math.cos(rad(deg - LIGHT));
  return d > 0 ? mix(mid, hi, d) : mix(mid, lo, -d);
}

/** The plate's rim: six bevelled faces, each catching the light on its own. */
function Rim({ hi, mid, lo }: { hi: string; mid: string; lo: string }) {
  return (
    <g>
      {[0, 1, 2, 3, 4, 5].map(i => {
        const a = -90 + i * 60;
        return <path key={i} d={`M${at(PLATE_R, a)} L${at(PLATE_R, a + 60)} L${at(FACE_R, a + 60)} L${at(FACE_R, a)} Z`} fill={lit(a + 30, hi, mid, lo)} stroke={lit(a + 30, hi, mid, lo)} strokeWidth="0.3" />;
      })}
      <path d={hexPath(PLATE_R)} fill="none" stroke={mix(lo, '#000000', 0.45)} strokeWidth="0.9" strokeLinejoin="round" />
    </g>
  );
}

const SCALE_STEPS = 14;
/** One armour scale, tip up: h is half its length, w half its width. */
const scalePath = (h: number, w: number) => `M0 ${-h} C${w * 0.5} ${-h * 0.62} ${w} ${-h * 0.05} ${w * 0.74} ${h * 0.5} Q0 ${h * 1.2} ${-w * 0.74} ${h * 0.5} C${-w} ${-h * 0.05} ${-w * 0.5} ${-h * 0.62} 0 ${-h} Z`;
const scaleShade = (h: number, w: number) => `M0 ${-h} C${w * 0.5} ${-h * 0.62} ${w} ${-h * 0.05} ${w * 0.74} ${h * 0.5} Q${w * 0.38} ${h * 0.82} 0 ${h * 0.85} Z`;

/** Iron Scales: a wreath of overlapping pangolin scales climbing from the base. Each scale lies over the next one up. */
function ScaleWreath({ id, hi, lo }: { id: string; hi: string; lo: string }) {
  const side = (
    <g>
      {Array.from({ length: SCALE_STEPS }, (_, n) => SCALE_STEPS - 1 - n).map(i => {
        const k = i / (SCALE_STEPS - 1);
        const deg = 110 + i * 10.6;
        const h = 11 - k * 4;
        const w = 8 - k * 3.2;
        const r = 54.5 - k * 0.6;
        const x = 60 + r * Math.cos(rad(deg));
        const y = 60 + r * Math.sin(rad(deg));
        return (
          <g key={i} transform={`translate(${x.toFixed(2)} ${y.toFixed(2)}) rotate(${(deg + 164).toFixed(1)})`}>
            <path d={scalePath(h, w)} fill={`url(#${id}s)`} stroke={mix(lo, '#000000', 0.35)} strokeWidth="0.55" strokeLinejoin="round" />
            <path d={scaleShade(h, w)} fill={lo} opacity="0.38" />
            <path d={`M0 ${-h * 0.8} L0 ${h * 0.55}`} stroke={hi} strokeOpacity="0.55" strokeWidth="0.4" strokeLinecap="round" />
          </g>
        );
      })}
    </g>
  );
  return (
    <g>
      {side}
      <g transform="matrix(-1 0 0 1 120 0)">{side}</g>
    </g>
  );
}

const STAR_POINTS = 12;
/** Unbroken: an order star of cut points, each with a bright and a dark face, held by one closed ring. */
function OrderStar({ id, hi, mid, lo }: { id: string; hi: string; mid: string; lo: string }) {
  const step = 360 / STAR_POINTS;
  const edge = mix(lo, '#000000', 0.45);
  const layer = (turn: number, tip: number, notch: number, bright: string, dark: string) => Array.from({ length: STAR_POINTS }, (_, i) => {
    const deg = -90 + turn + i * step;
    if (deg === 90) return null;   // the day plate sits here
    return (
      <g key={i}>
        <path d={`M${at(tip, deg)} L${at(notch, deg - step / 2)} L${at(36, deg)} Z`} fill={bright} />
        <path d={`M${at(tip, deg)} L${at(notch, deg + step / 2)} L${at(36, deg)} Z`} fill={dark} />
      </g>
    );
  });
  return (
    <g>
      <defs>
        <radialGradient id={`${id}a`} gradientUnits="userSpaceOnUse" cx="60" cy="60" r="64">
          <stop offset="0.68" stopColor={mid} />
          <stop offset="1" stopColor={hi} />
        </radialGradient>
        <radialGradient id={`${id}b`} gradientUnits="userSpaceOnUse" cx="60" cy="60" r="64">
          <stop offset="0.68" stopColor={lo} />
          <stop offset="1" stopColor={mid} />
        </radialGradient>
      </defs>
      <g stroke={edge} strokeWidth="0.5" strokeLinejoin="round">{layer(step / 2, 54.5, 46, mix(mid, lo, 0.45), mix(lo, '#000000', 0.25))}</g>
      <g stroke={edge} strokeWidth="0.5" strokeLinejoin="round">{layer(0, 63.5, 47, `url(#${id}a)`, `url(#${id}b)`)}</g>
      <circle cx="60" cy="60" r="46" fill="#0b0a18" stroke={edge} strokeWidth="4.4" />
      <circle cx="60" cy="60" r="46" fill="none" stroke={`url(#${id}r)`} strokeWidth="3.2" />
      <circle cx="60" cy="60" r="46" fill="none" stroke={hi} strokeOpacity="0.5" strokeWidth="0.4" />
    </g>
  );
}

function DayPlate({ id, y, days, hi, lo }: { id: string; y: number; days: number; hi: string; lo: string }) {
  return (
    <g>
      <rect x="39" y={y} width="42" height="20" rx="10" fill={`url(#${id}r)`} stroke={mix(lo, '#000000', 0.45)} strokeWidth="0.9" />
      <rect x="41.5" y={y + 2.5} width="37" height="15" rx="7.5" fill="#100e22" />
      <text x="60" y={y + 14} textAnchor="middle" fontSize="12" fontWeight="800" fill={hi} fontFamily="Outfit, Inter, sans-serif">{days}</text>
    </g>
  );
}

/**
 * A streak medal: a bevelled hexagonal plate holding the game's own rolled pangolin ball.
 * The top tiers sit in a frame of their own: a wreath of scales at 14 days, an order star at 30.
 * `compact` keeps only the plate for small sizes (leaderboard).
 */
export function BadgeMedal({ days, size = 96, locked = false, compact = false }: { days: number; size?: number; locked?: boolean; compact?: boolean }) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, '');
  const tier = tierOf(days);
  if (!tier) return null;
  const [hi, mid, lo, glow] = METALS[days];
  const wreath = !compact && days === 14;
  const star = !compact && days === 30;
  const framed = wreath || star;
  const plateScale = wreath ? 0.8 : star ? 0.78 : 1;

  return (
    <svg className={`bdg-medal ${locked ? 'locked' : ''}`} width={size} height={size} viewBox={compact ? '8 0 104 120' : '-6 -6 132 132'} role="img" aria-label={`${tier.name} badge${locked ? ' (locked)' : ''}`}>
      <defs>
        <linearGradient id={`${id}r`} x1="0.15" y1="0" x2="0.85" y2="1">
          <stop offset="0" stopColor={hi} />
          <stop offset="0.45" stopColor={mid} />
          <stop offset="0.7" stopColor={lo} />
          <stop offset="1" stopColor={mid} />
        </linearGradient>
        <linearGradient id={`${id}s`} x1="0.5" y1="0" x2="0.5" y2="1">
          <stop offset="0" stopColor={hi} />
          <stop offset="0.6" stopColor={mid} />
          <stop offset="1" stopColor={lo} />
        </linearGradient>
        <radialGradient id={`${id}p`} cx="0.5" cy="0.42" r="0.7">
          <stop offset="0" stopColor={glow} stopOpacity="0.5" />
          <stop offset="0.6" stopColor="#14112b" />
          <stop offset="1" stopColor="#0b0a18" />
        </radialGradient>
        <clipPath id={`${id}c`}><circle cx="60" cy={compact ? 60 : 57} r={compact ? 42 : 37} /></clipPath>
      </defs>

      {wreath && <ScaleWreath id={id} hi={hi} lo={lo} />}
      {star && <OrderStar id={id} hi={hi} mid={mid} lo={lo} />}

      <g transform={framed ? `translate(60 60) scale(${plateScale}) translate(-60 -60)` : undefined}>
        <Rim hi={hi} mid={mid} lo={lo} />
        <path d={hexPath(FACE_R)} fill={`url(#${id}p)`} stroke={mix(lo, '#000000', 0.5)} strokeWidth="0.8" strokeLinejoin="round" />
        <path d={hexPath(FACE_R - 1.4)} fill="none" stroke={hi} strokeOpacity="0.28" strokeWidth="0.6" strokeLinejoin="round" />
        <image href={`/sprites/ball_${tier.ball}.png`} x={compact ? 18 : 23} y={compact ? 18 : 20} width={compact ? 84 : 74} height={compact ? 84 : 74} clipPath={`url(#${id}c)`} preserveAspectRatio="xMidYMid slice" />
      </g>

      {!compact && <DayPlate id={id} y={framed ? 100 : 91} days={days} hi={hi} lo={lo} />}
    </svg>
  );
}

/* Early Pangolin: the Beta racer at dawn on the track, inside a ring of its own scales. */
const GOLD = { hi: '#fff3b8', mid: '#e8b12c', lo: '#7a4e06' };
const SCALE_RING = 30;
const BODY = ['#7a2fd0', '#b42ba8', '#c8323f', '#ef9a2e'];   // head to tail, as on the racer

/** The racer's colour at this point of the ring, purple on the left to orange on the right. */
function bodyTone(deg: number): string {
  const t = (Math.cos(rad(deg)) + 1) / 2 * (BODY.length - 1);
  const i = Math.min(BODY.length - 2, Math.floor(t));
  return mix(BODY[i], BODY[i + 1], t - i);
}

/** One leaf scale of the ring: two faces, a midrib and veins, like the scales in the art. */
function RingScale({ deg }: { deg: number }) {
  const tone = bodyTone(deg);
  const light = mix(tone, '#ffffff', 0.2);
  const dark = mix(tone, '#14061f', 0.34);
  const line = mix(tone, '#14061f', 0.62);
  return (
    <g transform={`translate(${at(58.5, deg)}) rotate(${deg + 90 + 34})`}>
      <path d="M0 -13 C6 -8 8.6 -1 7 5 Q0 13 -7 5 C-8.6 -1 -6 -8 0 -13 Z" fill={light} stroke={line} strokeWidth="0.6" strokeLinejoin="round" />
      <path d="M0 -13 C6 -8 8.6 -1 7 5 Q3.6 9.6 0 9.8 Z" fill={dark} />
      <path d="M0 -11 L0 9 M0 -4 L3.8 -7 M0 -4 L-3.8 -7 M0 1 L4.6 -2.4 M0 1 L-4.6 -2.4" fill="none" stroke={line} strokeOpacity="0.7" strokeWidth="0.4" strokeLinecap="round" />
    </g>
  );
}

/** The Early Pangolin badge; `number` is the racer's place in sign-up order. `compact` is the scene alone, for the leaderboard. */
export function SeasonBadge({ number, size = 120, compact = false }: { number: number; size?: number; compact?: boolean }) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, '');
  const edge = mix(GOLD.lo, '#000000', 0.5);
  const scales = Array.from({ length: SCALE_RING }, (_, i) => 90 + i * (360 / SCALE_RING));   // the seam sits under the number
  const kerbs = Array.from({ length: 12 }, (_, i) => i);
  return (
    <svg className="bdg-medal" width={size} height={size} viewBox={compact ? '21 21 78 78' : '-12 -12 144 148'} role="img" aria-label={`${SEASON_BADGE_NAME} badge, racer ${number}`}>
      <defs>
        <linearGradient id={`${id}r`} x1="0.1" y1="0" x2="0.9" y2="1">
          <stop offset="0" stopColor={GOLD.hi} />
          <stop offset="0.4" stopColor={GOLD.mid} />
          <stop offset="0.72" stopColor={GOLD.lo} />
          <stop offset="1" stopColor={GOLD.mid} />
        </linearGradient>
        <linearGradient id={`${id}s`} x1="0.5" y1="0" x2="0.5" y2="1">
          <stop offset="0" stopColor="#1c0f52" />
          <stop offset="0.24" stopColor="#6a1f96" />
          <stop offset="0.42" stopColor="#d9463c" />
          <stop offset="0.6" stopColor="#ffb54a" />
        </linearGradient>
        <radialGradient id={`${id}u`} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#fff6c9" />
          <stop offset="0.3" stopColor="#ffd166" />
          <stop offset="0.62" stopColor="#ff9a2e" stopOpacity="0.55" />
          <stop offset="1" stopColor="#ff9a2e" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`${id}g`} x1="0.5" y1="0" x2="0.5" y2="1">
          <stop offset="0" stopColor="#3a2150" />
          <stop offset="1" stopColor="#170c2a" />
        </linearGradient>
        <clipPath id={`${id}k`}><circle cx="60" cy="60" r="35" /></clipPath>
        <path id={`${id}t`} d={`M${at(38.4, 180)} A38.4 38.4 0 0 1 ${at(38.4, 0)}`} />
        <path id={`${id}b`} d={`M${at(44.6, 180)} A44.6 44.6 0 0 0 ${at(44.6, 0)}`} />
        <filter id={`${id}d`} x="-20%" y="-20%" width="140%" height="150%">
          <feDropShadow dx="0" dy="1.2" stdDeviation="1.3" floodColor="#0a0416" floodOpacity="0.75" />
        </filter>
      </defs>

      {!compact && (
        <>
          {scales.map(deg => <RingScale key={deg} deg={deg} />)}
          <circle cx="60" cy="60" r="49.4" fill={edge} />
          <circle cx="60" cy="60" r="48.8" fill={`url(#${id}r)`} />
          <circle cx="60" cy="60" r="46.2" fill="#100c2e" stroke={edge} strokeWidth="0.7" />
        </>
      )}
      <circle cx="60" cy="60" r={compact ? 38.6 : 36.9} fill={`url(#${id}r)`} stroke={edge} strokeWidth="0.6" />

      <g clipPath={`url(#${id}k)`}>
        <rect x="24" y="24" width="72" height="72" fill={`url(#${id}s)`} />
        <g fill="#ffd166" opacity="0.2">
          {Array.from({ length: 12 }, (_, i) => {
            const deg = 180 + 7.5 + i * 15;
            return <path key={i} d={`M60 70 L${at(50, deg - 3.4)} L${at(50, deg + 3.4)} Z`} transform="translate(2 -10)" />;
          })}
        </g>
        <circle cx="62" cy="50" r="27" fill={`url(#${id}u)`} />
        <path d="M24 70 Q33 60 43 67 T62 64 T82 66 T96 60 L96 96 L24 96 Z" fill="#4a1a5e" />
        <rect x="24" y="82" width="72" height="16" fill={`url(#${id}g)`} />
        <g>
          {kerbs.map(i => <rect key={i} x={24 + i * 6} y="82" width="6" height="2.2" fill={i % 2 ? '#f4f0ff' : '#e0373f'} />)}
        </g>
      </g>

      {!compact && <g fill={GOLD.hi} fontFamily="Outfit, Inter, sans-serif" fontWeight="800" textAnchor="middle">
        <text fontSize="7.4" letterSpacing="0.9"><textPath href={`#${id}t`} startOffset="50%">EARLY PANGOLIN</textPath></text>
        <text fontSize="6.2" letterSpacing="1.1" fill={GOLD.mid}><textPath href={`#${id}b`} startOffset="50%">BETA SEASON</textPath></text>
      </g>}

      <image href="/badges/early-pangolin.webp" x={compact ? 25 : 18} y={compact ? 42 : 44} width={compact ? 70 : 84} height={compact ? 40.4 : 48.5} filter={compact ? undefined : `url(#${id}d)`} preserveAspectRatio="xMidYMid meet" />

      {!compact && <g>
        <rect x="37" y="110" width="46" height="21" rx="10.5" fill={`url(#${id}r)`} stroke={edge} strokeWidth="0.9" />
        <rect x="39.6" y="112.6" width="40.8" height="15.8" rx="7.9" fill="#100e22" />
        <text x="60" y="125" textAnchor="middle" fontSize="12.5" fontWeight="800" fill={GOLD.hi} fontFamily="Outfit, Inter, sans-serif">#{number}</text>
      </g>}
    </svg>
  );
}

/** Profile card for the Early Pangolin badge. */
export function SeasonCard({ number }: { number: number }) {
  return (
    <article className="bdg-season">
      <SeasonBadge number={number} size={176} />
      <div>
        <span className="bdg-eyebrow">Beta Season</span>
        <h3>{SEASON_BADGE_NAME}</h3>
        <p>You joined the Beta Season early. You are racer <b>#{number}</b>.</p>
      </div>
    </article>
  );
}

function Flame({ state }: { state: 'lit' | 'risk' | 'out' }) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, '');
  return (
    <svg className={`bdg-flame ${state}`} viewBox="0 0 48 60" width="48" height="60" aria-hidden="true">
      <defs>
        <linearGradient id={`${id}f`} x1="0.5" y1="1" x2="0.5" y2="0">
          <stop offset="0" stopColor={state === 'out' ? '#59566e' : '#ff4d2e'} />
          <stop offset="0.55" stopColor={state === 'out' ? '#6f6c86' : '#ff9a2e'} />
          <stop offset="1" stopColor={state === 'out' ? '#8a879f' : '#ffd166'} />
        </linearGradient>
      </defs>
      <path fill={`url(#${id}f)`} d="M25 2c2 9-3 13-7 18-2-3-3-5-3-8C8 19 3 27 3 36c0 13 9 22 21 22s21-9 21-21c0-8-4-14-9-19 0 4-1 7-4 9 1-9-1-18-7-25Z" />
      <path fill={state === 'out' ? '#a5a2b8' : '#fff1b8'} opacity="0.9" d="M24 30c1 5-2 7-4 10-1 2-2 4-2 6 0 5 3 8 7 8s7-3 7-8c0-6-5-10-8-16Z" />
    </svg>
  );
}

/** How far along the rail the current streak is; the four medals sit at the centre of four equal columns. */
function railFill(current: number): number {
  const stops = [0, ...STREAK_BADGES.map(b => b.days)];
  const at = [0, 12.5, 37.5, 62.5, 87.5];
  if (current >= stops[stops.length - 1]) return 100;
  const i = stops.findIndex((d, n) => current >= d && current < stops[n + 1]);
  return at[i] + (at[i + 1] - at[i]) * (current - stops[i]) / (stops[i + 1] - stops[i]);
}

function useTimeLeft(resetsAt: string): string {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  const mins = Math.max(0, Math.floor((new Date(resetsAt).getTime() - now) / 60_000));
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

/** Profile card: today's streak, the last seven days and the road to the four badges. */
export function StreakCard({ streak, resetsAt, onGoRace }: { streak: Streak; resetsAt: string; onGoRace: () => void }) {
  const left = useTimeLeft(resetsAt);
  const { current, best, ranToday, week } = streak;
  const atRisk = current > 0 && !ranToday;
  const state = ranToday ? 'lit' : atRisk ? 'risk' : 'out';
  const next = STREAK_BADGES.find(b => b.days > best);
  const todayStart = new Date(resetsAt).getTime() - 86_400_000;
  const letters = week.map((_, i) => new Date(todayStart - (6 - i) * 86_400_000).toLocaleDateString('en-US', { weekday: 'narrow', timeZone: 'UTC' }));

  return (
    <article className={`bdg-card ${state}`}>
      <div className="bdg-top">
        <div className="bdg-count">
          <Flame state={state} />
          <div>
            <strong>{current}</strong>
            <span>day streak</span>
          </div>
        </div>

        <div className="bdg-status">
          <h3>
            {ranToday ? 'You raced today' : atRisk ? 'Keep your streak alive' : 'Start a streak today'}
          </h3>
          <p>
            {ranToday
              ? 'Your day is locked in. Come back tomorrow to keep rolling.'
              : atRisk
                ? <>Run one race in the next <b>{left}</b> or your streak resets.</>
                : 'Run one race a day, every day, to earn badges for your profile.'}
          </p>
          {!ranToday && <button className="btn btn-primary bdg-go" onClick={onGoRace}>Race now</button>}
        </div>

        <div className="bdg-week" aria-label="Your last seven days">
          <ol>
            {week.map((on, i) => (
              <li key={i} className={`${on ? 'on' : ''} ${i === 6 ? 'today' : ''}`}>
                <span>{on && <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M3 8.5 6.5 12 13 4.5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /></svg>}</span>
                <small>{letters[i]}</small>
              </li>
            ))}
          </ol>
          <em>Best streak: <b>{best}</b> {best === 1 ? 'day' : 'days'}</em>
        </div>
      </div>

      <div className="bdg-road">
        <div className="bdg-rail" aria-hidden="true"><span style={{ width: `${railFill(current)}%` }} /></div>
        <ul>
          {STREAK_BADGES.map(b => {
            const earned = best >= b.days;
            const isNext = next?.days === b.days;
            const togo = b.days - current;
            return (
              <li key={b.days} className={`${earned ? 'earned' : ''} ${isNext ? 'next' : ''}`}>
                <BadgeMedal days={b.days} size={92} locked={!earned} />
                <strong>{b.name}</strong>
                <small>{earned ? 'Earned' : isNext ? `${togo} ${togo === 1 ? 'day' : 'days'} to go` : `${b.days} days`}</small>
              </li>
            );
          })}
        </ul>
      </div>
    </article>
  );
}

/** The moment a badge is earned. */
export function BadgeUnlocked({ days, onClose }: { days: number; onClose: () => void }) {
  const tier = tierOf(days);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  if (!tier) return null;
  return (
    <div className="bdg-unlock" role="dialog" aria-modal="true" aria-label={`${tier.name} badge unlocked`} onClick={onClose}>
      <div className="bdg-unlock-box" onClick={e => e.stopPropagation()}>
        <div className="bdg-rays" aria-hidden="true" />
        <div className="bdg-unlock-medal"><BadgeMedal days={days} size={190} /></div>
        <span className="bdg-eyebrow">Badge unlocked</span>
        <h2>{tier.name}</h2>
        <p>{days} days in a row. This badge is yours for good and shows on your profile and the leaderboard.</p>
        <button className="btn btn-primary" onClick={onClose} autoFocus>Keep rolling</button>
      </div>
    </div>
  );
}

/** The moment a racer first sees the Early Pangolin badge. */
export function SeasonBadgeUnlocked({ number, onClose }: { number: number; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="bdg-unlock" role="dialog" aria-modal="true" aria-label={`${SEASON_BADGE_NAME} badge unlocked`} onClick={onClose}>
      <div className="bdg-unlock-box" onClick={e => e.stopPropagation()}>
        <div className="bdg-rays" aria-hidden="true" />
        <div className="bdg-unlock-medal"><SeasonBadge number={number} size={230} /></div>
        <span className="bdg-eyebrow">Badge unlocked</span>
        <h2>{SEASON_BADGE_NAME}</h2>
        <p>You joined the Beta Season early, so this badge is yours. You are racer #{number}.</p>
        <button className="btn btn-primary" onClick={onClose} autoFocus>Keep rolling</button>
      </div>
    </div>
  );
}

const seasonSeenKey = (wallet: string) => `pangsrally_early_pangolin_seen_${wallet}`;

/** True when this browser has not shown the wallet its Early Pangolin badge yet. */
export function seasonBadgeUnseen(wallet: string): boolean {
  try {
    return !localStorage.getItem(seasonSeenKey(wallet));
  } catch {
    return false;
  }
}

export function markSeasonBadgeSeen(wallet: string) {
  try { localStorage.setItem(seasonSeenKey(wallet), '1'); } catch { /* private mode */ }
}

const seenKey = (wallet: string) => `pangsrally_badge_seen_${wallet}`;

/** The badge to celebrate: the player's highest one, if this browser has not shown it yet. */
export function unseenBadge(wallet: string, badge: number): number {
  if (!badge) return 0;
  try {
    return Number(localStorage.getItem(seenKey(wallet)) || 0) < badge ? badge : 0;
  } catch {
    return 0;
  }
}

export function markBadgeSeen(wallet: string, badge: number) {
  try { localStorage.setItem(seenKey(wallet), String(badge)); } catch { /* private mode */ }
}

/**
 * A badge with a small card that names it: opens on hover, keyboard focus or tap. The card lives on
 * <body> so the leaderboard's row and name clipping cannot cut it off.
 */
function BadgeTip({ label, detail, art, children }: { label: string; detail: string; art: ReactNode; children: ReactNode }) {
  const anchor = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const touch = useRef(false);
  const [open, setOpen] = useState(false);
  const [place, setPlace] = useState<{ left: number; top: number; arrow: number; below: boolean } | null>(null);

  useLayoutEffect(() => {
    if (!open || !anchor.current || !pop.current) { setPlace(null); return; }
    const a = anchor.current.getBoundingClientRect();
    const p = pop.current.getBoundingClientRect();
    const gap = 10;
    const centre = a.left + a.width / 2;
    const left = Math.max(8, Math.min(centre - p.width / 2, window.innerWidth - p.width - 8));
    const below = a.top - p.height - gap < 8;
    setPlace({ left, top: below ? a.bottom + gap : a.top - p.height - gap, arrow: centre - left, below });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const outside = (e: PointerEvent) => { if (!anchor.current?.contains(e.target as Node)) close(); };
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    document.addEventListener('pointerdown', outside);
    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
      document.removeEventListener('pointerdown', outside);
    };
  }, [open]);

  return (
    <>
      <button
        ref={anchor}
        type="button"
        className="bdg-tip"
        aria-label={`${label}: ${detail}`}
        aria-expanded={open}
        onPointerDown={e => { touch.current = e.pointerType !== 'mouse'; }}
        onPointerEnter={e => { if (e.pointerType === 'mouse') setOpen(true); }}
        onPointerLeave={e => { if (e.pointerType === 'mouse') setOpen(false); }}
        onFocus={e => { if (e.currentTarget.matches(':focus-visible')) setOpen(true); }}
        onBlur={() => setOpen(false)}
        onClick={() => { if (touch.current) setOpen(o => !o); }}
      >
        {children}
      </button>
      {open && createPortal(
        <div
          ref={pop}
          role="tooltip"
          className={`bdg-pop ${place?.below ? 'below' : ''}`}
          style={{ left: place?.left ?? 0, top: place?.top ?? 0, visibility: place ? 'visible' : 'hidden', '--arrow-x': `${place?.arrow ?? 0}px` } as CSSProperties}
        >
          <div className="bdg-pop-art">{art}</div>
          <div className="bdg-pop-text"><strong>{label}</strong><span>{detail}</span></div>
        </div>,
        document.body,
      )}
    </>
  );
}

/** The badges shown after a racer's name on the leaderboard. */
export function LeaderboardBadges({ racerNumber, streakDays }: { racerNumber: number | null; streakDays: number }) {
  const tier = tierOf(streakDays);
  if (racerNumber == null && !tier) return null;
  return (
    <span className="bdg-row">
      {racerNumber != null && (
        <BadgeTip label={SEASON_BADGE_NAME} detail={`Beta Season racer #${racerNumber}`} art={<SeasonBadge number={racerNumber} size={56} />}>
          <SeasonBadge number={racerNumber} size={26} compact />
        </BadgeTip>
      )}
      {tier && (
        <BadgeTip label={tier.name} detail={`Raced ${tier.days} days in a row`} art={<BadgeMedal days={tier.days} size={56} />}>
          <BadgeMedal days={tier.days} size={26} compact />
        </BadgeTip>
      )}
    </span>
  );
}
