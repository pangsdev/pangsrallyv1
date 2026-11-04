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
const HEX = 'M60 6 L106.8 33 L106.8 87 L60 114 L13.2 87 L13.2 33 Z';

/** Laurel branch on the left of the medal; mirrored for the right. */
function Laurel({ fill }: { fill: string }) {
  return (
    <g fill={fill}>
      {[0, 1, 2, 3, 4, 5, 6, 7].map(i => {
        const deg = 112 + i * 17;
        const a = deg * Math.PI / 180;
        const x = 60 + 56 * Math.cos(a);
        const y = 60 + 56 * Math.sin(a);
        return <path key={i} d="M0 8 C-5 3 -5 -4 0 -9 C5 -4 5 3 0 8 Z" transform={`translate(${x} ${y}) rotate(${deg + 24})`} />;
      })}
    </g>
  );
}

/**
 * A streak medal: a hexagonal metal plate holding the game's own rolled pangolin ball.
 * Higher tiers gain laurels, then rays. `compact` drops the details for small sizes (leaderboard).
 */
export function BadgeMedal({ days, size = 96, locked = false, compact = false }: { days: number; size?: number; locked?: boolean; compact?: boolean }) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, '');
  const tier = tierOf(days);
  if (!tier) return null;
  const [hi, mid, lo, glow] = METALS[days];
  const showLaurel = !compact && days >= 14;
  const showRays = !compact && days >= 30;

  return (
    <svg className={`bdg-medal ${locked ? 'locked' : ''}`} width={size} height={size} viewBox={compact ? '8 0 104 120' : '-6 -6 132 132'} role="img" aria-label={`${tier.name} badge${locked ? ' (locked)' : ''}`}>
      <defs>
        <linearGradient id={`${id}r`} x1="0.15" y1="0" x2="0.85" y2="1">
          <stop offset="0" stopColor={hi} />
          <stop offset="0.45" stopColor={mid} />
          <stop offset="0.7" stopColor={lo} />
          <stop offset="1" stopColor={mid} />
        </linearGradient>
        <radialGradient id={`${id}p`} cx="0.5" cy="0.42" r="0.7">
          <stop offset="0" stopColor={glow} stopOpacity="0.5" />
          <stop offset="0.6" stopColor="#14112b" />
          <stop offset="1" stopColor="#0b0a18" />
        </radialGradient>
        <clipPath id={`${id}c`}><circle cx="60" cy={compact ? 60 : 57} r={compact ? 42 : 37} /></clipPath>
      </defs>

      {showRays && (
        <path d={HEX} fill={`url(#${id}r)`} stroke={lo} strokeWidth="1" strokeLinejoin="round" transform="rotate(30 60 60) scale(1.0)" opacity="0.92" />
      )}
      {showLaurel && (
        <>
          <Laurel fill={mid} />
          <g transform="matrix(-1 0 0 1 120 0)"><Laurel fill={mid} /></g>
        </>
      )}

      <path d={HEX} fill={`url(#${id}r)`} stroke={lo} strokeWidth="1" strokeLinejoin="round" />
      <path d={HEX} fill={`url(#${id}p)`} transform="translate(60 60) scale(0.86) translate(-60 -60)" stroke={hi} strokeOpacity="0.45" strokeWidth="1.4" strokeLinejoin="round" />

      <image href={`/sprites/ball_${tier.ball}.png`} x={compact ? 18 : 23} y={compact ? 18 : 20} width={compact ? 84 : 74} height={compact ? 84 : 74} clipPath={`url(#${id}c)`} preserveAspectRatio="xMidYMid slice" />

      {!compact && (
        <g>
          <rect x="39" y="91" width="42" height="20" rx="10" fill={`url(#${id}r)`} stroke={lo} strokeWidth="1" />
          <rect x="41.5" y="93.5" width="37" height="15" rx="7.5" fill="#100e22" />
          <text x="60" y="105" textAnchor="middle" fontSize="12" fontWeight="800" fill={hi} fontFamily="Outfit, Inter, sans-serif">{days}</text>
        </g>
      )}
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
