import { useEffect, useId, useState } from 'react';
import { STREAK_BADGES, type Streak } from '../race/testSeason';
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
