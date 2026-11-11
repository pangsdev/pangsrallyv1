/**
 * Daily Rally: one race a day at RALLY_HOUR_UTC. Racers sign up during the day (it uses none of the
 * five daily races); at the start everyone signed up is drawn into rooms of 10, bots fill the empty
 * seats (bots score nothing), and every room runs once. Rally points (25/18/15/…) are their own
 * leaderboard, never mixed with season points.
 *
 * Like the Cup, each day has a secret that seeds the room draw and the race seeds, so parallel
 * requests that resolve the same day build the same rooms; the unique index (rally_day, rally_room)
 * keeps one race per room. Days resolve lazily: the first request after the start runs them.
 */
import { buildTestField, pointsFor, runTestRace, shortWallet, type TestRaceResult } from './race/testSeason.ts';
import { HttpError, raceEndsAt, raceOver, requireBeta, requireWallet, type Deps, type RaceRow } from './core.ts';
import { drawRooms } from './cup.ts';

export const RALLY_HOUR_UTC = 18;
export const RALLY_TERRAIN = 'Forest';

export interface RallyDayRow {
  day: string;
  seed_secret: string;
  created_at: string;
}

export interface RallyEntryRow {
  day: string;
  wallet: string;
  registered_at: string;
}

const DAY_MS = 86_400_000;
const dayOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);
/** Start time in minutes after midnight UTC (the dev server can move it to test a start). */
const startMinute = (deps: Pick<Deps, 'rallyMinuteUtc'>) => deps.rallyMinuteUtc ?? RALLY_HOUR_UTC * 60;
export const rallyStart = (deps: Pick<Deps, 'rallyMinuteUtc'>, day: string) => Date.parse(`${day}T00:00:00.000Z`) + startMinute(deps) * 60_000;

/** The day whose rally racers can still sign up for: today before the start, otherwise tomorrow. */
export function upcomingDay(deps: Pick<Deps, 'rallyMinuteUtc'>, now: Date): string {
  const today = dayOf(now.getTime());
  return now.getTime() < rallyStart(deps, today) ? today : dayOf(now.getTime() + DAY_MS);
}

/** The latest day whose rally has started (today after the start, otherwise yesterday). */
export function lastDay(deps: Pick<Deps, 'rallyMinuteUtc'>, now: Date): string {
  const today = dayOf(now.getTime());
  return now.getTime() >= rallyStart(deps, today) ? today : dayOf(now.getTime() - DAY_MS);
}

async function daySecret(deps: Deps, day: string): Promise<string> {
  const existing = await deps.store.getRallyDay(day);
  if (existing) return existing.seed_secret;
  // Two requests may create it at once; the first insert wins and both read that one back.
  await deps.store.insertRallyDay({ day, seed_secret: deps.randomHex(32), created_at: deps.now().toISOString() });
  return (await deps.store.getRallyDay(day))!.seed_secret;
}

/** Runs the rooms of `day` once its start has passed. Safe to call from parallel requests. */
export async function settleRally(deps: Deps, day: string): Promise<RaceRow[]> {
  const now = deps.now();
  let races = await deps.store.rallyRaces(day);
  if (now.getTime() < rallyStart(deps, day)) return races;
  const wallets = (await deps.store.rallyEntries(day)).map(e => e.wallet);
  if (!wallets.length) return races;
  const secret = await daySecret(deps, day);
  const rooms = await drawRooms(deps, secret, 1, wallets);
  const done = new Set(races.map(r => r.rally_room));
  if (done.size >= rooms.length) return races;
  const names = await deps.store.getUsernames(wallets);
  for (let i = 0; i < rooms.length; i++) {
    if (done.has(i + 1)) continue;
    const seed = `rally-${(await deps.sha256Hex(`${secret}:${day}:${i + 1}`)).slice(0, 32)}`;
    const field = buildTestField(seed, rooms[i], names);
    const results = runTestRace(seed, field, RALLY_TERRAIN);
    await deps.store.insertRallyRace({
      id: deps.uuid(), kind: 'rally', terrain: RALLY_TERRAIN, seed, status: 'finished',
      created_at: now.toISOString(), closes_at: new Date(rallyStart(deps, day)).toISOString(),
      finished_at: raceEndsAt(now, results), field, results,
      rally_day: day, rally_room: i + 1,
    });
  }
  races = await deps.store.rallyRaces(day);
  return races;
}

/** Players of a rally race with their place and points (bots that filled the room are left out). */
export function rallyPlacings(race: RaceRow) {
  const out: { wallet: string; position: number; points: number }[] = [];
  for (const racer of race.field ?? []) {
    if (!racer.wallet) continue;
    const res = (race.results ?? []).find((r: TestRaceResult) => r.id === racer.id);
    if (res) out.push({ wallet: racer.wallet, position: res.position, points: pointsFor(res.position) });
  }
  return out;
}

/** All-time rally points over the races that have crossed the line, best first. */
async function board(deps: Deps, now: Date) {
  const by = new Map<string, { wallet: string; points: number; rallies: number; wins: number; podiums: number }>();
  for (const race of await deps.store.rallyRaces(null)) {
    if (!raceOver(race, now)) continue;
    for (const p of rallyPlacings(race)) {
      const row = by.get(p.wallet) ?? { wallet: p.wallet, points: 0, rallies: 0, wins: 0, podiums: 0 };
      row.points += p.points;
      row.rallies++;
      if (p.position === 1) row.wins++;
      if (p.position <= 3) row.podiums++;
      by.set(p.wallet, row);
    }
  }
  return [...by.values()].sort((a, b) => b.points - a.points || b.wins - a.wins || b.podiums - a.podiums || a.wallet.localeCompare(b.wallet));
}

/** Everything the Daily Rally page shows. Works signed out. */
export async function rallyStatus(deps: Deps, token: string | null) {
  const now = deps.now();
  const wallet = token ? await deps.store.getSessionWallet(await deps.sha256Hex(token), now) : null;
  const last = lastDay(deps, now);
  // Yesterday too, in case nobody looked in since its start.
  await settleRally(deps, dayOf(Date.parse(last) - DAY_MS));
  const lastRaces = (await settleRally(deps, last)).sort((a, b) => (a.rally_room ?? 0) - (b.rally_room ?? 0));
  const next = upcomingDay(deps, now);
  const nextEntries = await deps.store.rallyEntries(next);
  const table = await board(deps, now);
  const wallets = [...new Set([...nextEntries.map(e => e.wallet), ...table.slice(0, 50).map(r => r.wallet), ...lastRaces.flatMap(r => (r.field ?? []).filter(f => f.wallet).map(f => f.wallet!))])];
  const names = await deps.store.getUsernames(wallets);
  const name = (w: string) => names[w] ?? shortWallet(w);

  const mineRace = wallet ? lastRaces.find(r => (r.field ?? []).some(f => f.wallet === wallet)) : undefined;
  const minePlace = mineRace && raceOver(mineRace, now) ? rallyPlacings(mineRace).find(p => p.wallet === wallet) : undefined;
  const myRow = wallet ? table.findIndex(r => r.wallet === wallet) : -1;

  return {
    hourUtc: Math.floor(startMinute(deps) / 60),
    terrain: RALLY_TERRAIN,
    next: {
      day: next,
      startsAt: new Date(rallyStart(deps, next)).toISOString(),
      registered: nextEntries.length,
      entrants: nextEntries.map(e => name(e.wallet)),
    },
    last: lastRaces.length ? {
      day: last,
      startsAt: new Date(rallyStart(deps, last)).toISOString(),
      rooms: lastRaces.map(r => ({
        room: r.rally_room, raceId: r.id, finishedAt: r.finished_at, over: raceOver(r, now),
        names: (r.field ?? []).filter(f => f.wallet).map(f => f.name),
        mine: !!wallet && (r.field ?? []).some(f => f.wallet === wallet),
        // the room's top three players, once it has crossed the line on screen
        podium: raceOver(r, now) ? rallyPlacings(r).sort((a, b) => a.position - b.position).slice(0, 3).map(p => ({ name: name(p.wallet), position: p.position })) : null,
      })),
    } : null,
    board: table.slice(0, 50).map((r, i) => ({ rank: i + 1, name: name(r.wallet), points: r.points, rallies: r.rallies, wins: r.wins, podiums: r.podiums, me: r.wallet === wallet })),
    me: wallet ? {
      registered: nextEntries.some(e => e.wallet === wallet),
      raceId: mineRace?.id ?? null,
      result: minePlace ? { position: minePlace.position, points: minePlace.points } : null,
      rank: myRow >= 0 ? myRow + 1 : null,
      points: myRow >= 0 ? table[myRow].points : 0,
    } : null,
    serverTime: now.toISOString(),
  };
}

export async function rallyRegister(deps: Deps, token: string | null) {
  const wallet = await requireWallet(deps, token);
  await requireBeta(deps, wallet);
  const day = upcomingDay(deps, deps.now());
  await deps.store.insertRallyEntry({ day, wallet, registered_at: deps.now().toISOString() });
  return rallyStatus(deps, token);
}

export async function rallyLeave(deps: Deps, token: string | null) {
  const wallet = await requireWallet(deps, token);
  // The upcoming day only: once a rally has started its rooms are fixed.
  const day = upcomingDay(deps, deps.now());
  if (deps.now().getTime() >= rallyStart(deps, day)) throw new HttpError(409, 'rally_locked', 'This Daily Rally has started.');
  await deps.store.deleteRallyEntry(day, wallet);
  return rallyStatus(deps, token);
}

