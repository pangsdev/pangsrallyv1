/**
 * Pangs Cup: a one-evening tournament. Registered racers run QUALIFYING_ROUNDS rounds in fresh
 * random rooms of 10, the top 10 on Cup points meet in one Grand Final (points reset), and the
 * final result sets the prizes. Cup races use none of the daily races and give no season points.
 *
 * Fairness: every room's seed and the room draw come from the Cup's secret, which stays on the
 * server until the final has run. Its SHA-256 (`seedCommit`) is public from the start, so after
 * the Cup anyone can check every seed: seed = "cup-" + sha256(secret:round:room) (first 32 hex).
 *
 * Rounds resolve lazily, like online rooms: the first request after a round's start time runs it.
 * Each room is one finished race row (field + results), so a round can never half-save.
 */
import {
  FIELD_SIZE, buildTestField, pointsFor, runTestRace, shortWallet,
  type TestRacer, type TestRaceResult,
} from './race/testSeason.ts';
import { HttpError, raceEndsAt, raceOver, requireBeta, requireWallet, type Deps, type RaceRow } from './core.ts';

export interface CupRow {
  id: number;
  title: string;
  terrain: string;
  /** Round 1 */
  starts_at: string;
  round_minutes: number;
  qualifying_rounds: number;
  /** from the last qualifying round to the Grand Final */
  final_gap_minutes: number;
  seats: number;
  /** registration closes this long before Round 1 */
  register_close_minutes: number;
  /** only wallets that joined the game before this time may enter (null = any) */
  eligible_before: string | null;
  /** never sent to a browser before the final has run */
  seed_secret: string;
  seed_commit: string;
  prizes: CupPrize[];
  /** the PangsCup contract that pays this Cup, once results are on chain */
  claim_contract: string | null;
  created_at: string;
}

export interface CupPrize {
  /** 1 Champion, 2 Second, 3 Third, 4 Finalist (matches PangsCup.sol) */
  tier: number;
  /** USDG, whole units */
  usdg: number;
  label: string;
}

export interface CupEntryRow {
  cup_id: number;
  wallet: string;
  registered_at: string;
}

export const FINAL_ROUND_SIZE = FIELD_SIZE;
/** Fewer registered racers than this at Round 1 and the Cup does not run: it shows as postponed until it is rescheduled. */
export const MIN_CUP_RACERS = 10;

/** Cup #1 prizes: 30 USDG split 15 / 10 / 5, a Genesis whitelist place for the podium, a badge for every finalist. */
export const DEFAULT_PRIZES: CupPrize[] = [
  { tier: 1, usdg: 15, label: '15 USDG + Genesis whitelist' },
  { tier: 2, usdg: 10, label: '10 USDG + Genesis whitelist' },
  { tier: 3, usdg: 5, label: '5 USDG + Genesis whitelist' },
  { tier: 4, usdg: 0, label: 'Finalist badge' },
];

/** A new Cup row with a fresh secret and its public commitment (scripts, tests and the dev server). */
export async function newCup(
  deps: Pick<Deps, 'sha256Hex' | 'randomHex'>,
  opts: Partial<Omit<CupRow, 'seed_secret' | 'seed_commit'>> & { id: number; starts_at: string },
): Promise<CupRow> {
  const secret = deps.randomHex(32);
  return {
    title: `Pangs Cup #${opts.id}`, terrain: 'Forest', round_minutes: 15, qualifying_rounds: 4, final_gap_minutes: 30,
    seats: 50, register_close_minutes: 30, eligible_before: null, prizes: DEFAULT_PRIZES, claim_contract: null,
    created_at: new Date().toISOString(),
    ...opts,
    seed_secret: secret,
    seed_commit: await deps.sha256Hex(secret),
  };
}
export const TIER_NAMES: Record<number, string> = { 1: 'Champion', 2: 'Second place', 3: 'Third place', 4: 'Finalist' };

/* ------------------------------------------------------------------ */
/* Schedule                                                            */
/* ------------------------------------------------------------------ */

export function roundTimes(cup: CupRow): number[] {
  const start = Date.parse(cup.starts_at);
  const times = Array.from({ length: cup.qualifying_rounds }, (_, i) => start + i * cup.round_minutes * 60_000);
  times.push(times[times.length - 1] + cup.final_gap_minutes * 60_000);
  return times;
}

const finalRound = (cup: CupRow) => cup.qualifying_rounds + 1;
const registerClosesAt = (cup: CupRow) => Date.parse(cup.starts_at) - cup.register_close_minutes * 60_000;

/* ------------------------------------------------------------------ */
/* Seeds and the room draw                                             */
/* ------------------------------------------------------------------ */

export async function roomSeed(deps: Pick<Deps, 'sha256Hex'>, secret: string, round: number, room: number): Promise<string> {
  return `cup-${(await deps.sha256Hex(`${secret}:${round}:${room}`)).slice(0, 32)}`;
}

/** Wallets split into rooms of at most 10, as evenly as possible (23 → 8, 8, 7), in a secret-seeded order. */
async function drawRooms(deps: Pick<Deps, 'sha256Hex'>, secret: string, round: number, wallets: string[]): Promise<string[][]> {
  const keyed = await Promise.all([...wallets].sort().map(async w => ({ w, k: await deps.sha256Hex(`${secret}:draw:${round}:${w}`) })));
  const order = keyed.sort((a, b) => (a.k < b.k ? -1 : 1)).map(x => x.w);
  const rooms = Math.max(1, Math.ceil(order.length / FIELD_SIZE));
  const out: string[][] = Array.from({ length: rooms }, () => []);
  order.forEach((w, i) => out[i % rooms].push(w));
  return out;
}

/* ------------------------------------------------------------------ */
/* Standings                                                           */
/* ------------------------------------------------------------------ */

export interface Standing {
  wallet: string;
  total: number;
  /** points per qualifying round; null = not run (or not crossed the line) yet */
  rounds: (number | null)[];
  wins: number;
  seconds: number;
  /** secret-seeded last tie-break; only meaningful on the server */
  tie: string;
}

/** Qualifying points from the races that have crossed the line, best first: points, wins, second places, seeded draw. */
export async function standingsOf(deps: Pick<Deps, 'sha256Hex'>, cup: CupRow, wallets: string[], races: RaceRow[], now: Date): Promise<Standing[]> {
  const by = new Map<string, Standing>();
  for (const w of wallets) {
    by.set(w, { wallet: w, total: 0, rounds: Array(cup.qualifying_rounds).fill(null), wins: 0, seconds: 0, tie: await deps.sha256Hex(`${cup.seed_secret}:tie:${w}`) });
  }
  for (const race of races) {
    if (!race.cup_round || race.cup_round > cup.qualifying_rounds || !raceOver(race, now)) continue;
    for (const { wallet, position } of placings(race)) {
      const s = by.get(wallet);
      if (!s) continue;
      const pts = pointsFor(position);
      s.rounds[race.cup_round - 1] = pts;
      s.total += pts;
      if (position === 1) s.wins++;
      if (position === 2) s.seconds++;
    }
  }
  return [...by.values()].sort((a, b) => b.total - a.total || b.wins - a.wins || b.seconds - a.seconds || (a.tie < b.tie ? -1 : 1));
}

/** Players of a race with their finishing position (bots that fill a short room are left out). */
function placings(race: RaceRow): { wallet: string; position: number; racer: TestRacer }[] {
  const out = [];
  for (const racer of race.field ?? []) {
    if (!racer.wallet) continue;
    const res = (race.results ?? []).find((r: TestRaceResult) => r.id === racer.id);
    if (res) out.push({ wallet: racer.wallet, position: res.position, racer });
  }
  return out;
}

/** Final placings among the players only: 1st, 2nd, 3rd → tiers 1-3, everyone else in the final → tier 4. */
export function finalResult(race: RaceRow | undefined) {
  if (!race) return null;
  return placings(race).sort((a, b) => a.position - b.position).map((p, i) => ({ place: i + 1, wallet: p.wallet, tier: i < 3 ? i + 1 : 4 }));
}

/* ------------------------------------------------------------------ */
/* Running rounds                                                      */
/* ------------------------------------------------------------------ */

/** Runs every round whose start time has passed and has no races yet, in order. Safe to call from parallel requests. */
export async function settleCup(deps: Deps, cup: CupRow): Promise<RaceRow[]> {
  const now = deps.now();
  const times = roundTimes(cup);
  let races = await deps.store.cupRaces(cup.id);
  const wallets = (await deps.store.cupEntries(cup.id)).map(e => e.wallet);
  if (!wallets.length) return races;
  // Too few racers: nothing runs (a Cup that already started keeps going).
  if (!races.length && wallets.length < MIN_CUP_RACERS) return races;

  for (let round = 1; round <= times.length; round++) {
    if (now.getTime() < times[round - 1]) break;
    const done = new Set(races.filter(r => r.cup_round === round).map(r => r.cup_room));
    // Rounds before the final always have at least one room; a full final has exactly one.
    if (done.size && round === finalRound(cup)) continue;

    let rooms: string[][];
    if (round === finalRound(cup)) {
      // Everyone's qualifying races count, even if one has not crossed the line on screen yet.
      const table = await standingsOf(deps, cup, wallets, races, new Date(8.64e15));
      rooms = [table.slice(0, FINAL_ROUND_SIZE).map(s => s.wallet)];
    } else {
      rooms = await drawRooms(deps, cup.seed_secret, round, wallets);
    }
    const names = await deps.store.getUsernames(wallets);
    if (done.size >= rooms.length) continue;
    for (let i = 0; i < rooms.length; i++) {
      // A request that stopped half way may have saved some rooms already; run only the missing ones.
      if (done.has(i + 1)) continue;
      const seed = await roomSeed(deps, cup.seed_secret, round, i + 1);
      const field = buildTestField(seed, rooms[i], names);
      const results = runTestRace(seed, field, cup.terrain);
      // A parallel request may have run this room a moment ago; the unique index keeps one.
      await deps.store.insertCupRace({
        id: deps.uuid(), kind: 'cup', terrain: cup.terrain, seed, status: 'finished',
        created_at: now.toISOString(), closes_at: new Date(times[round - 1]).toISOString(),
        finished_at: raceEndsAt(now, results), field, results,
        cup_id: cup.id, cup_round: round, cup_room: i + 1,
      });
    }
    races = await deps.store.cupRaces(cup.id);
  }
  return races;
}

/* ------------------------------------------------------------------ */
/* Actions                                                             */
/* ------------------------------------------------------------------ */

async function loadCup(deps: Deps, rawId: unknown): Promise<CupRow> {
  const id = Number(rawId);
  const cup = Number.isInteger(id) && id > 0 ? await deps.store.getCup(id) : await deps.store.latestCup();
  if (!cup) throw new HttpError(404, 'no_cup', 'There is no Pangs Cup right now.');
  return cup;
}

/** Everything the Cup page and the broadcast screen show. Works signed out. */
export async function cupStatus(deps: Deps, rawId: unknown, token: string | null) {
  const cup = await loadCup(deps, rawId);
  const now = deps.now();
  const wallet = token ? await deps.store.getSessionWallet(await deps.sha256Hex(token), now) : null;
  const races = await settleCup(deps, cup);
  const entries = await deps.store.cupEntries(cup.id);
  const wallets = entries.map(e => e.wallet);
  const names = await deps.store.getUsernames(wallets);
  const name = (w: string) => names[w] ?? shortWallet(w);
  const times = roundTimes(cup);
  const final = races.find(r => r.cup_round === finalRound(cup));
  const finalOver = !!final && raceOver(final, now);

  const rounds = times.map((at, i) => {
    const round = i + 1;
    const list = races.filter(r => r.cup_round === round).sort((a, b) => (a.cup_room ?? 0) - (b.cup_room ?? 0));
    const state = !list.length ? 'upcoming' : list.every(r => raceOver(r, now)) ? 'done' : 'live';
    return {
      round, final: round === finalRound(cup), at: new Date(at).toISOString(), state,
      rooms: list.map(r => ({
        room: r.cup_room, raceId: r.id, finishedAt: r.finished_at,
        names: (r.field ?? []).filter(f => f.wallet).map(f => f.name),
        mine: !!wallet && (r.field ?? []).some(f => f.wallet === wallet),
      })),
    };
  });

  const table = await standingsOf(deps, cup, wallets, races, now);
  const standings = table.map((s, i) => ({ rank: i + 1, wallet: s.wallet, name: name(s.wallet), total: s.total, rounds: s.rounds, wins: s.wins }));
  const result = finalOver ? finalResult(final)!.map(p => ({
    ...p, name: name(p.wallet), prize: cup.prizes.find(x => x.tier === p.tier)?.label ?? TIER_NAMES[p.tier],
  })) : null;

  let me = null;
  if (wallet) {
    const registered = wallets.includes(wallet);
    const problem = registered ? null : await registerProblem(deps, cup, wallet, entries.length);
    me = {
      registered,
      canRegister: !registered && problem === null,
      problem,
      inFinal: !!final && (final.field ?? []).some(f => f.wallet === wallet),
      // Every registered racer races every qualifying round once the Cup has run.
      raced: registered && races.length > 0,
      award: result?.find(r => r.wallet === wallet) ?? null,
    };
  }

  return {
    cup: {
      id: cup.id, title: cup.title, terrain: cup.terrain, startsAt: cup.starts_at, finalAt: new Date(times[times.length - 1]).toISOString(),
      registerClosesAt: new Date(registerClosesAt(cup)).toISOString(), qualifyingRounds: cup.qualifying_rounds,
      seats: cup.seats, registered: entries.length, prizes: cup.prizes,
      state: finalOver ? 'finished'
        : now.getTime() < Date.parse(cup.starts_at) ? 'upcoming'
        : !races.length && entries.length < MIN_CUP_RACERS ? 'postponed' : 'live',
      minRacers: MIN_CUP_RACERS,
      seedCommit: cup.seed_commit, seedSecret: finalOver ? cup.seed_secret : null,
      claimContract: cup.claim_contract,
    },
    rounds,
    standings,
    entrants: entries.map(e => name(e.wallet)),
    // After the final: everyone who raced, for the Participant badge's Merkle proof (src/testSeason/cupMerkle.ts).
    participants: finalOver ? wallets : null,
    result,
    me,
    serverTime: now.toISOString(),
  };
}

/** Why this wallet cannot take a seat right now, or null when it can. */
async function registerProblem(deps: Deps, cup: CupRow, wallet: string, taken: number): Promise<string | null> {
  const now = deps.now().getTime();
  if (now >= registerClosesAt(cup)) return 'Registration for this Cup is closed.';
  if (deps.cupTeamWallets?.has(wallet)) return 'Team wallets cannot enter the Cup.';
  if (taken >= cup.seats) return 'All seats are taken.';
  if (cup.eligible_before) {
    const joined = await deps.store.playerJoinedAt(wallet);
    if (!joined || Date.parse(joined) >= Date.parse(cup.eligible_before)) return 'This Cup is open to racers who joined before it was announced.';
  }
  return null;
}

export async function cupRegister(deps: Deps, token: string | null, rawId: unknown) {
  const wallet = await requireWallet(deps, token);
  const cup = await loadCup(deps, rawId);
  const entries = await deps.store.cupEntries(cup.id);
  if (entries.some(e => e.wallet === wallet)) return cupStatus(deps, cup.id, token);
  const problem = await registerProblem(deps, cup, wallet, entries.length);
  if (problem) throw new HttpError(409, 'cup_closed', problem);
  await requireBeta(deps, wallet);
  await deps.store.insertCupEntry({ cup_id: cup.id, wallet, registered_at: deps.now().toISOString() });
  // Two racers can take the last seat at once; the later one gets theirs back.
  const after = (await deps.store.cupEntries(cup.id)).sort((a, b) => a.registered_at.localeCompare(b.registered_at) || a.wallet.localeCompare(b.wallet));
  if (after.findIndex(e => e.wallet === wallet) >= cup.seats) {
    await deps.store.deleteCupEntry(cup.id, wallet);
    throw new HttpError(409, 'cup_full', 'All seats are taken.');
  }
  return cupStatus(deps, cup.id, token);
}

export async function cupLeave(deps: Deps, token: string | null, rawId: unknown) {
  const wallet = await requireWallet(deps, token);
  const cup = await loadCup(deps, rawId);
  if (deps.now().getTime() >= registerClosesAt(cup)) throw new HttpError(409, 'cup_locked', 'Registration has closed, so your seat is locked.');
  await deps.store.deleteCupEntry(cup.id, wallet);
  return cupStatus(deps, cup.id, token);
}
