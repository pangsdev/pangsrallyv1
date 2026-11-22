/** Shared by the Cup page and the broadcast screen. */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApiError, getSession, testSeason, withCupMe, type CupStatus } from '../testSeason/api';
import { pollWhileVisible } from '../testSeason/poll';

export const TIER_LABEL: Record<number, string> = { 1: 'Champion', 2: 'Second place', 3: 'Third place', 4: 'Finalist' };
export const FINAL_SIZE = 10;

export const time = (iso: string) => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
export const zoned = (iso: string) => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
export const day = (iso: string) => new Date(iso).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

/** "1:04:09", "6:41", "0:05" */
export function clockText(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
}

/**
 * The Cup as everyone sees it, read through the site cache and refreshed often while it runs; the
 * signed-in player's part is worked out in the browser (withCupMe). `skew` lines the browser clock up
 * with the server. An answer from register/leave goes in with setData, and older cached answers are
 * skipped until the cache has caught up with it.
 */
export function useCup(opts: { background?: boolean } = {}) {
  const [raw, setRaw] = useState<CupStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const skew = useRef(0);
  const fresh = useRef(0);
  const load = useCallback(() => testSeason.cupPublic()
    .then(({ data: d, age }) => {
      skew.current = Date.parse(d.serverTime) + age * 1000 - Date.now();
      if (Date.parse(d.serverTime) < fresh.current) return;
      setRaw(d);
      setError(null);
    })
    .catch(e => setError(e instanceof ApiError && e.code === 'no_cup' ? 'no_cup' : e instanceof Error ? e.message : 'Could not load the Cup.')), []);
  const setData = useCallback((d: CupStatus) => { fresh.current = Date.parse(d.serverTime); setRaw(d); }, []);
  const state = raw?.cup.state;
  const busy = raw?.rounds.some(r => r.state === 'live');
  useEffect(() => {
    load();
    const every = state === 'finished' ? 300_000 : state === 'live' || busy ? 5_000 : 30_000;
    const stop = pollWhileVisible(load, every, { background: opts.background });
    const tick = setInterval(() => setNow(Date.now()), 500);
    return () => { stop(); clearInterval(tick); };
  }, [load, state, busy, opts.background]);
  const wallet = opts.background ? null : getSession()?.wallet ?? null;
  const data = useMemo(() => (raw ? withCupMe(raw, wallet, Date.now() + skew.current) : null), [raw, wallet]);
  return { data, setData, error, reload: load, now: now + skew.current };
}

/** Next thing on the schedule: registration, a round or the final. */
export function nextUp(d: CupStatus, now: number) {
  if (d.cup.state === 'postponed') return null;
  const next = d.rounds.find(r => r.state === 'upcoming' && Date.parse(r.at) > now - 2000);
  if (!next) return null;
  return { label: next.final ? 'Grand Final starts in' : `Round ${next.round} starts in`, at: Date.parse(next.at), round: next };
}

export function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
