/**
 * Beta-season game server (the code and tables keep their test-season names): wallet sign-in, the daily race limit, bot races,
 * online rooms, points and the leaderboard. Every result is computed here, so
 * a browser cannot award itself points.
 *
 * Platform-neutral on purpose: index.ts runs it as a Supabase Edge Function
 * (Deno + Postgres), and vite.config.ts runs it in `npm run dev` with an
 * in-memory store so the whole flow works locally.
 */
import {
  DAILY_RACE_LIMIT, FIELD_SIZE, ROOM_FULL_COUNTDOWN_SECONDS, TEST_TERRAINS,
  buildTestField, checkUsername, pointsFor, predictionPointsFor, runTestRace, shortWallet, signInMessage,
  type TestRacer, type TestRaceResult,
  streakFor,
} from './race/testSeason.ts';

export interface RaceRow {
  id: string;
  kind: 'bot' | 'online';
  terrain: string;
  seed: string;
  status: 'open' | 'finished';
  created_at: string;
  closes_at: string | null;
  /** When the race crosses the line on screen (see raceEndsAt). Its points count from then on. */
  finished_at: string | null;
  field: TestRacer[] | null;
  results: TestRaceResult[] | null;
}

export interface EntryRow {
  race_id: string;
  wallet: string;
  /** UTC day (YYYY-MM-DD) the race counts against */
  day: string;
  /** 1-based race number of the day; (wallet, day, slot) is unique, which enforces the daily limit */
  slot: number;
  position: number | null;
  points: number;
  joined_at: string;
}

export interface LeaderRow {
  wallet: string;
  races: number;
  points: number;
  wins: number;
  podiums: number;
  last_race: string | null;
}

export interface PredictionRow {
  race_id: string;
  wallet: string;
  /** saddle number 1-10 */
  pick: number;
  /** where that number finished; null until the race is resolved */
  position: number | null;
  points: number;
  created_at: string;
}

export interface PredictionBoardRow {
  wallet: string;
  picks: number;
  points: number;
  /** picks that named the winner */
  winners: number;
  /** picks that finished 2nd or 3rd */
  podiums: number;
  last_pick: string | null;
}

export interface Store {
  getSessionWallet(tokenHash: string, now: Date): Promise<string | null>;
  createSession(tokenHash: string, wallet: string, expiresAt: Date): Promise<void>;
  upsertPlayer(wallet: string, now: Date): Promise<void>;
  playerExists(wallet: string): Promise<boolean>;
  /** Registers a new wallet and takes one place on the code, atomically. */
  joinWithInvite(wallet: string, code: string): Promise<'exists' | 'joined' | 'invalid'>;
  /** The UTC days each wallet raced on (one entry per race; streakFor counts a day once). */
  raceDays(wallets: string[]): Promise<Record<string, string[]>>;
  /** The wallet's place in sign-up order (1 = first player); null when it joined at or after `before`. */
  racerNumber(wallet: string, before: Date | null): Promise<number | null>;
  /** Every racer's place in sign-up order, by wallet, without those who joined at or after `before`. */
  racerNumbers(before: Date | null): Promise<Record<string, number>>;
  /** True when the code exists and is active but all its places are taken (so "full" can be told apart from "wrong"). */
  inviteIsFull(code: string): Promise<boolean>;
  /** Cached "this wallet minted its Beta pass" flag, so the chain is asked only until it is true. */
  getBetaMinted(wallet: string): Promise<boolean>;
  setBetaMinted(wallet: string, now: Date): Promise<void>;
  /** Races that used up a place of this day. A seat in a waiting room (slot 0) is not one yet. */
  countEntriesOnDay(wallet: string, day: string): Promise<number>;
  /** Seats this wallet holds in open rooms that have not used a race yet (slot 0). */
  heldSeats(wallet: string): Promise<number>;
  /** Turns a held seat into a race of this day; 'conflict' when a parallel request took the slot. */
  chargeSeat(raceId: string, wallet: string, day: string, slot: number): Promise<'ok' | 'conflict'>;
  insertRace(race: RaceRow): Promise<void>;
  deleteRace(id: string): Promise<void>;
  /** 'conflict' when (race, wallet) or (wallet, day, slot) already exists */
  insertEntry(entry: EntryRow): Promise<'ok' | 'conflict'>;
  deleteEntry(raceId: string, wallet: string): Promise<void>;
  getRace(id: string): Promise<RaceRow | null>;
  listEntries(raceId: string): Promise<EntryRow[]>;
  /** Open online rooms on this track, soonest start first. */
  listOpenRooms(terrain: string): Promise<RaceRow[]>;
  /** 'conflict' when this track already has a waiting room (migration 012). */
  insertOpenRoom(room: RaceRow): Promise<'ok' | 'conflict'>;
  /** Sets the start time of a room that just filled; keeps the time of a room that already has one. */
  startCountdown(id: string, closesAt: string): Promise<void>;
  /** Open online rooms this wallet is waiting in. */
  openRoomsFor(wallet: string): Promise<RaceRow[]>;
  /** Marks an open race finished; false when another request already did. */
  finishRace(id: string, patch: { field: TestRacer[]; results: TestRaceResult[]; finished_at: string }): Promise<boolean>;
  setEntryResult(raceId: string, wallet: string, position: number, points: number): Promise<void>;
  /** Only races whose finished_at has passed `now` (Postgres: the view compares with now()). */
  leaderboard(limit: number, now: Date): Promise<LeaderRow[]>;
  /** wallet → chosen name, for the wallets that have one. */
  getUsernames(wallets: string[]): Promise<Record<string, string>>;
  /** 'taken' when another wallet has this name in any letter case (migration 008). */
  setUsername(wallet: string, name: string): Promise<'ok' | 'taken'>;
  history(wallet: string, limit: number): Promise<(EntryRow & { race: RaceRow })[]>;
  /** 'conflict' when this wallet already has a pick in this race: a pick is final. */
  insertPrediction(row: PredictionRow): Promise<'ok' | 'conflict'>;
  deletePrediction(raceId: string, wallet: string): Promise<void>;
  listPredictions(raceId: string): Promise<PredictionRow[]>;
  /** Scores every pick of this number in this race. */
  setPredictionResult(raceId: string, pick: number, position: number, points: number): Promise<void>;
  /** The wallet's picks, newest first. */
  predictionsFor(wallet: string, limit: number): Promise<(PredictionRow & { race: RaceRow })[]>;
  /** Only races whose finished_at has passed `now` (Postgres: the view compares with now()). */
  predictionBoard(limit: number, now: Date): Promise<PredictionBoardRow[]>;
  /** Online races that have crossed the line, newest first. */
  recentRooms(limit: number, now: Date): Promise<RaceRow[]>;
  insertReport(report: ReportRow): Promise<void>;
  /** Reports since `since`: by this wallet, or by signed-out visitors when wallet is null. */
  countReports(since: string, wallet: string | null): Promise<number>;
}

export interface ReportRow {
  id: string;
  wallet: string | null;
  kind: string;
  area: string;
  message: string;
  contact: string | null;
  page: string | null;
  agent: string | null;
  created_at: string;
}

export interface Deps {
  store: Store;
  /** Address that signed `message` (any case). Throws on a malformed signature. */
  verifyMessage(message: string, signature: string): string;
  sha256Hex(text: string): Promise<string>;
  randomHex(bytes: number): string;
  uuid(): string;
  now(): Date;
  /** Wallets (lower-case) exempt from the daily limit, e.g. the owner while testing. */
  unlimitedWallets: Set<string>;
  /** New wallets need an invite code to join (existing players never do). */
  inviteRequired: boolean;
  /** Beta pass gate: when set, racing needs the free Beta NFT (contracts/PangsRallyBeta.sol). */
  beta: BetaGate | null;
  /** When the Beta season ends: wallets joining from then on get no Early Pangolin badge. Unset while it runs. */
  betaSeasonEnd?: Date | null;
  /** The free prediction game. Off in production until migration 011 is applied and the owner opens it. */
  predictions?: boolean;
}

export interface BetaGate {
  contract: string;
  chainId: number;
  /** Server signature that lets `wallet` mint (see PangsRallyBeta.voucherHash). */
  signVoucher(wallet: string): Promise<string>;
  /** Reads hasMinted(wallet) on chain. */
  hasMinted(wallet: string): Promise<boolean>;
}

export interface Reply {
  status: number;
  body: unknown;
}

const SIGN_IN_MAX_AGE_MS = 10 * 60 * 1000;
const SESSION_DAYS = 30;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

export { signInMessage };

class HttpError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export async function handle(deps: Deps, action: string, body: Record<string, unknown>, token: string | null): Promise<Reply> {
  try {
    switch (action) {
      case 'login': return ok(await login(deps, body));
      case 'me': return ok(await me(deps, await requireWallet(deps, token)));
      case 'bot-race': return ok(await botRace(deps, await requireWallet(deps, token), str(body.terrain)));
      case 'rooms': return ok(await rooms(deps, str(body.terrain), token));
      case 'online-join': return ok(await onlineJoin(deps, await requireWallet(deps, token), str(body.terrain), str(body.roomId)));
      case 'online-leave': return ok(await onlineLeave(deps, await requireWallet(deps, token), str(body.raceId)));
      case 'online-status': return ok(await onlineStatus(deps, str(body.raceId)));
      case 'race': return ok(await replay(deps, str(body.raceId)));
      case 'history': return ok(await history(deps, await requireWallet(deps, token)));
      case 'profile': return ok(await profile(deps, await requireWallet(deps, token)));
      case 'leaderboard': return ok(await leaderboard(deps));
      case 'predict': requirePredictions(deps); return ok(await predict(deps, await requireWallet(deps, token), str(body.raceId), body.pick));
      case 'prediction': requirePredictions(deps); return ok(await prediction(deps, str(body.raceId), token));
      case 'prediction-board': requirePredictions(deps); return ok(await predictionBoard(deps, token));
      case 'report': return ok(await report(deps, body, token));
      case 'set-username': return ok(await setUsername(deps, await requireWallet(deps, token), str(body.username)));
      case 'beta-voucher': return ok(await betaVoucher(deps, await requireWallet(deps, token)));
      default: throw new HttpError(404, 'unknown_action', 'Unknown action.');
    }
  } catch (err) {
    if (err instanceof HttpError) return { status: err.status, body: { error: err.code, message: err.message } };
    console.error('test-season', action, err);
    return { status: 500, body: { error: 'server_error', message: 'Something went wrong. Please try again.' } };
  }
}

/* ------------------------------------------------------------------ */
/* Sign-in                                                             */
/* ------------------------------------------------------------------ */

async function login(deps: Deps, body: Record<string, unknown>) {
  const address = str(body.address);
  const message = str(body.message);
  const signature = str(body.signature);
  if (!ADDRESS.test(address) || !message || !signature) throw new HttpError(400, 'bad_request', 'Missing wallet signature.');

  const issued = /^Issued: (.+)$/m.exec(message)?.[1] ?? '';
  const issuedAt = Date.parse(issued);
  const now = deps.now();
  // Browsers still on the build before the Beta season rename sign the old title for a while.
  const known = message === signInMessage(address, issued) || message === signInMessage(address, issued, 'Pangs Rally Test Season sign-in');
  if (!known || !Number.isFinite(issuedAt) || Math.abs(now.getTime() - issuedAt) > SIGN_IN_MAX_AGE_MS) {
    throw new HttpError(400, 'bad_message', 'The sign-in message expired. Please sign again.');
  }

  let signer = '';
  try { signer = deps.verifyMessage(message, signature); } catch { /* handled below */ }
  if (signer.toLowerCase() !== address.toLowerCase()) throw new HttpError(401, 'bad_signature', 'Signature does not match this wallet.');

  const wallet = address.toLowerCase();
  if (deps.inviteRequired && !deps.unlimitedWallets.has(wallet) && !(await deps.store.playerExists(wallet))) {
    const code = normalizeInvite(body.inviteCode);
    if (!code) throw new HttpError(403, 'invite_required', 'The Beta season is invite-only. Enter your invite code to join.');
    if (await deps.store.joinWithInvite(wallet, code) === 'invalid') {
      if (await deps.store.inviteIsFull(code)) {
        throw new HttpError(403, 'invite_full', 'This invite code has no places left. All its spots are taken, so nothing is wrong on your side. Ask the Pangs Rally team for a new code.');
      }
      throw new HttpError(403, 'invite_invalid', 'This invite code is not valid or has no places left.');
    }
  }
  await deps.store.upsertPlayer(wallet, now);
  const token = deps.randomHex(32);
  await deps.store.createSession(await deps.sha256Hex(token), wallet, new Date(now.getTime() + SESSION_DAYS * 86_400_000));
  return { token, ...(await me(deps, wallet)) };
}

/** Codes are shared by hand: ignore case, spaces and stray punctuation around the dashes. */
export function normalizeInvite(v: unknown): string {
  const code = String(v ?? '').toUpperCase().replace(/[^A-Z0-9-]/g, '').replace(/^-+|-+$/g, '');
  return /^[A-Z0-9-]{4,32}$/.test(code) ? code : '';
}

async function requireWallet(deps: Deps, token: string | null): Promise<string> {
  if (!token) throw new HttpError(401, 'signed_out', 'Connect your wallet to race.');
  const wallet = await deps.store.getSessionWallet(await deps.sha256Hex(token), deps.now());
  if (!wallet) throw new HttpError(401, 'signed_out', 'Your session expired. Connect your wallet again.');
  return wallet;
}

/* ------------------------------------------------------------------ */
/* Player                                                              */
/* ------------------------------------------------------------------ */

async function me(deps: Deps, wallet: string) {
  const now = deps.now();
  await deps.store.upsertPlayer(wallet, now);
  // Rooms the player stopped watching still resolve and score.
  const bookedSeats: (string | null)[] = [];
  for (const room of await deps.store.openRoomsFor(wallet)) {
    const settled = await settleIfDue(deps, room);
    if (settled.status === 'open') bookedSeats.push(settled.closes_at);
  }
  const unlimited = deps.unlimitedWallets.has(wallet);
  const racesToday = await deps.store.countEntriesOnDay(wallet, utcDay(now));
  const held = await deps.store.heldSeats(wallet);
  const board = await deps.store.leaderboard(10_000, now);
  const index = board.findIndex(r => r.wallet === wallet);
  const row = board[index];
  const username = (await deps.store.getUsernames([wallet]))[wallet] ?? null;
  const days = (await deps.store.raceDays([wallet]))[wallet] ?? [];
  return {
    wallet,
    username,
    streak: streakFor(days, utcDay(now)),
    racerNumber: await deps.store.racerNumber(wallet, deps.betaSeasonEnd ?? null),
    racesToday,
    dailyLimit: DAILY_RACE_LIMIT,
    racesLeft: unlimited ? DAILY_RACE_LIMIT : Math.max(0, DAILY_RACE_LIMIT - racesToday - held),
    /** start times of the rooms this player holds a seat in, null while the room waits; each seat keeps one race back */
    bookedSeats,
    unlimited,
    points: row?.points ?? 0,
    races: row?.races ?? 0,
    wins: row?.wins ?? 0,
    podiums: row?.podiums ?? 0,
    rank: index >= 0 ? index + 1 : null,
    resetsAt: nextUtcMidnight(now),
    beta: deps.beta
      ? { required: true, minted: await betaMinted(deps, wallet), contract: deps.beta.contract, chainId: deps.beta.chainId }
      : { required: false, minted: false, contract: null, chainId: null },
  };
}

/* ------------------------------------------------------------------ */
/* Beta pass (free NFT, gas only)                                      */
/* ------------------------------------------------------------------ */

async function betaMinted(deps: Deps, wallet: string): Promise<boolean> {
  if (!deps.beta) return true;
  if (await deps.store.getBetaMinted(wallet)) return true;
  let minted = false;
  try { minted = await deps.beta.hasMinted(wallet); } catch (err) { console.error('beta hasMinted', err); }
  if (minted) await deps.store.setBetaMinted(wallet, deps.now());
  return minted;
}

async function requireBeta(deps: Deps, wallet: string) {
  if (!(await betaMinted(deps, wallet))) {
    throw new HttpError(403, 'beta_required', 'Mint your free Beta pass to start racing. It costs only gas.');
  }
}

async function betaVoucher(deps: Deps, wallet: string) {
  if (!deps.beta) throw new HttpError(404, 'beta_off', 'The Beta pass is not needed right now.');
  return { contract: deps.beta.contract, chainId: deps.beta.chainId, voucher: await deps.beta.signVoucher(wallet) };
}

/* ------------------------------------------------------------------ */
/* Bot race                                                            */
/* ------------------------------------------------------------------ */

async function botRace(deps: Deps, wallet: string, terrain: string) {
  checkTerrain(terrain);
  await requireBeta(deps, wallet);
  const now = deps.now();
  const id = deps.uuid();
  const seed = `bot-${id}`;
  const field = buildTestField(seed, [wallet], await deps.store.getUsernames([wallet]));
  const results = runTestRace(seed, field, terrain);
  const mine = results.find(r => r.id === field.find(f => f.wallet === wallet)?.id);
  if (!mine) throw new Error('player missing from field');

  await deps.store.insertRace({
    id, kind: 'bot', terrain, seed, status: 'finished',
    created_at: now.toISOString(), closes_at: null, finished_at: raceEndsAt(now, results), field, results,
  });
  const points = pointsFor(mine.position);
  const claimed = await claimSlot(deps, wallet, id, now, { position: mine.position, points });
  if (!claimed) {
    await deps.store.deleteRace(id);
    throw limitError(now);
  }
  return {
    race: await publicRace(deps, await mustGetRace(deps, id), await deps.store.listEntries(id)),
    you: { position: mine.position, points },
    ...(await me(deps, wallet)),
  };
}

/* ------------------------------------------------------------------ */
/* Online rooms: real players only, a room runs once it is full        */
/* ------------------------------------------------------------------ */

/** Rooms with a start time first, then the room still waiting for players. */
const byStart = (rooms: RaceRow[]) => rooms.sort((a, b) => Date.parse(a.closes_at ?? '9999') - Date.parse(b.closes_at ?? '9999'));

/** Resolves rooms that are due, then makes sure the track has a room waiting for players. */
async function ensureRooms(deps: Deps, terrain: string): Promise<RaceRow[]> {
  const now = deps.now();
  const open: RaceRow[] = [];
  for (const room of await deps.store.listOpenRooms(terrain)) {
    const settled = await settleIfDue(deps, room);
    if (settled.status === 'open') open.push(settled);
  }
  if (!open.some(r => r.closes_at === null)) {
    const room: RaceRow = {
      // Secret, not derived from the id: the id is public and the race code ships to every browser,
      // so a seed built from it would let anyone work out the result before the start.
      id: deps.uuid(), kind: 'online', terrain, seed: `online-${deps.randomHex(16)}`, status: 'open',
      created_at: now.toISOString(), closes_at: null,
      finished_at: null, field: null, results: null,
    };
    // A parallel request may have made it a moment ago; the index keeps one waiting room per track.
    if (await deps.store.insertOpenRoom(room) === 'ok') open.push(room);
    else return byStart(await deps.store.listOpenRooms(terrain));
  }
  return byStart(open);
}

/** Public room list for the lobby: start time (null while it waits), who took a seat, and whether the caller is in. */
async function rooms(deps: Deps, terrain: string, token: string | null) {
  checkTerrain(terrain);
  const wallet = token ? await deps.store.getSessionWallet(await deps.sha256Hex(token), deps.now()) : null;
  const list = await ensureRooms(deps, terrain);
  const out = [];
  for (const room of list) {
    const entries = (await deps.store.listEntries(room.id)).sort((a, b) => a.joined_at.localeCompare(b.joined_at));
    const picks = deps.predictions ? await deps.store.listPredictions(room.id) : [];
    const names = await deps.store.getUsernames(entries.map(e => e.wallet));
    out.push({
      id: room.id, startsAt: room.closes_at, players: entries.length, maxPlayers: FIELD_SIZE,
      names: entries.map(e => names[e.wallet] ?? shortWallet(e.wallet)),
      joined: !!wallet && entries.some(e => e.wallet === wallet),
      myPick: picks.find(p => p.wallet === wallet)?.pick ?? null,
      crowd: crowdOf(picks),
    });
  }
  return { rooms: out, serverTime: deps.now().toISOString() };
}

/**
 * Takes a seat. It holds one of the day's races and uses it when the race starts. With no roomId it
 * takes the first free seat, or returns the room the player already waits in. One seat at a time.
 */
async function onlineJoin(deps: Deps, wallet: string, terrain: string, roomId: string) {
  checkTerrain(terrain);
  await requireBeta(deps, wallet);
  const seated: RaceRow[] = [];
  for (const room of await deps.store.openRoomsFor(wallet)) {
    const settled = await settleIfDue(deps, room);
    if (settled.status === 'open') seated.push(settled);
  }
  const here = seated.find(r => (roomId ? r.id === roomId : r.terrain === terrain));
  if (here) return onlineStatus(deps, here.id);
  if (seated.length) throw new HttpError(409, 'seat_held', 'You already have a seat in another room.');

  const candidates = roomId ? [await mustGetRace(deps, roomId)] : await ensureRooms(deps, terrain);
  for (const candidate of candidates) {
    if (candidate.kind !== 'online' || candidate.terrain !== terrain) throw new HttpError(400, 'bad_request', 'Unknown room.');
    const room = await settleIfDue(deps, candidate);
    if (room.status !== 'open') {
      if (roomId) throw new HttpError(409, 'room_started', 'This room has already started. Pick another one.');
      continue;
    }
    // A room with a start time has closed its seats.
    if (room.closes_at || (await deps.store.listEntries(room.id)).length >= FIELD_SIZE) {
      if (roomId) throw new HttpError(409, 'room_full', 'This room is full. Pick another one.');
      continue;
    }
    const now = deps.now();
    if (!(await claimSeat(deps, wallet, room.id, now))) throw limitError(now);
    // Two players can take the last seat at once; the later one gets their seat back.
    if ((await deps.store.listEntries(room.id)).length > FIELD_SIZE) {
      await deps.store.deleteEntry(room.id, wallet);
      if (roomId) throw new HttpError(409, 'room_full', 'This room is full. Pick another one.');
      continue;
    }
    // The last seat starts the countdown; the next room opens now.
    const status = await onlineStatus(deps, room.id);
    if (status.race.closesAt) await ensureRooms(deps, terrain);
    return status;
  }
  throw new HttpError(503, 'busy', 'Every room is full right now. Please try again in a moment.');
}

/** Gives a seat back, free of charge, while the room is still waiting. A full room keeps its ten players. */
async function onlineLeave(deps: Deps, wallet: string, raceId: string) {
  const race = await settleIfDue(deps, await mustGetRace(deps, raceId));
  if (!(await deps.store.listEntries(raceId)).some(e => e.wallet === wallet)) throw new HttpError(404, 'not_in_room', 'You do not have a seat in this room.');
  if (race.status !== 'open' || race.closes_at) throw new HttpError(409, 'room_locked', 'This room is full, so your seat is locked. The race starts soon.');
  await deps.store.deleteEntry(raceId, wallet);
  return me(deps, wallet);
}

async function onlineStatus(deps: Deps, raceId: string) {
  const race = await mustGetRace(deps, raceId);
  const settled = await settleIfDue(deps, race);
  return { race: await publicRace(deps, settled, await deps.store.listEntries(raceId)), serverTime: deps.now().toISOString() };
}

/** Starts the countdown of a room that filled up, and resolves a room whose start time has come. */
async function settleIfDue(deps: Deps, race: RaceRow): Promise<RaceRow> {
  if (race.kind !== 'online' || race.status !== 'open') return race;
  const entries = (await deps.store.listEntries(race.id)).sort((a, b) => a.joined_at.localeCompare(b.joined_at));
  const now = deps.now();
  if (race.closes_at === null) {
    if (entries.length < FIELD_SIZE) return race;
    await deps.store.startCountdown(race.id, new Date(now.getTime() + ROOM_FULL_COUNTDOWN_SECONDS * 1000).toISOString());
    return mustGetRace(deps, race.id);
  }
  // Left over from the old schedule: a timed room nobody joined never runs.
  if (entries.length === 0) {
    await deps.store.deleteRace(race.id);
    return { ...race, status: 'finished' };
  }
  if (now.getTime() < Date.parse(race.closes_at)) return race;

  const wallets = entries.map(e => e.wallet);
  const field = buildTestField(race.seed, wallets, await deps.store.getUsernames(wallets));
  const results = runTestRace(race.seed, field, race.terrain);
  const won = await deps.store.finishRace(race.id, { field, results, finished_at: raceEndsAt(now, results) });
  if (won) {
    for (const racer of field) {
      if (!racer.wallet) continue;
      if (entries.find(e => e.wallet === racer.wallet)?.slot === 0) await chargeSeat(deps, racer.wallet, race.id, now);
      const position = results.find(r => r.id === racer.id)!.position;
      await deps.store.setEntryResult(race.id, racer.wallet, position, pointsFor(position));
    }
    const picks = deps.predictions ? await deps.store.listPredictions(race.id) : [];
    if (picks.length) {
      for (const number of new Set(picks.map(p => p.pick))) {
        const position = positionOfNumber(field, results, number);
        if (position) await deps.store.setPredictionResult(race.id, number, position, predictionPointsFor(position));
      }
    }
  }
  return mustGetRace(deps, race.id);
}

/* ------------------------------------------------------------------ */
/* Predictions: free, one final pick per room, no race used            */
/* ------------------------------------------------------------------ */

function requirePredictions(deps: Deps) {
  if (!deps.predictions) throw new HttpError(404, 'unknown_action', 'Unknown action.');
}

/** A racer's saddle number is its lane: its place in the field, from 1. */
function positionOfNumber(field: TestRacer[], results: TestRaceResult[], number: number): number | null {
  const racer = field[number - 1];
  return racer ? results.find(r => r.id === racer.id)?.position ?? null : null;
}

/** How many picks each number has, 1 to 10. Counts only, never who picked. */
function crowdOf(picks: PredictionRow[]): number[] {
  return Array.from({ length: FIELD_SIZE }, (_, i) => picks.filter(p => p.pick === i + 1).length);
}

async function predict(deps: Deps, wallet: string, raceId: string, rawPick: unknown) {
  const pick = Number(rawPick);
  if (!Number.isInteger(pick) || pick < 1 || pick > FIELD_SIZE) throw new HttpError(400, 'bad_pick', `Pick a number from 1 to ${FIELD_SIZE}.`);
  await requireBeta(deps, wallet);
  const closed = () => new HttpError(409, 'predictions_closed', 'This race has started. Pick the next one.');
  const race = await settleIfDue(deps, await mustGetRace(deps, raceId).catch(err => {
    if (err instanceof HttpError && err.code === 'not_found') throw closed();
    throw err;
  }));
  const now = deps.now();
  if (race.kind !== 'online' || race.status !== 'open' || (race.closes_at && now.getTime() >= Date.parse(race.closes_at))) throw closed();
  const status = await deps.store.insertPrediction({ race_id: raceId, wallet, pick, position: null, points: 0, created_at: now.toISOString() });
  if (status === 'conflict') throw new HttpError(409, 'already_picked', 'You already locked your pick for this race.');
  // The room may have filled and started while this was being saved; a pick must never land after the result.
  const after = await deps.store.getRace(raceId);
  if (!after || after.status !== 'open') {
    await deps.store.deletePrediction(raceId, wallet);
    throw closed();
  }
  return prediction(deps, raceId, null, wallet);
}

/** The caller's pick and the crowd for one race. Works signed out (no pick then). */
async function prediction(deps: Deps, raceId: string, token: string | null, known?: string) {
  const race = await mustGetRace(deps, raceId);
  const wallet = known ?? (token ? await deps.store.getSessionWallet(await deps.sha256Hex(token), deps.now()) : null);
  const picks = await deps.store.listPredictions(race.id);
  return { pick: picks.find(p => p.wallet === wallet)?.pick ?? null, crowd: crowdOf(picks) };
}

const RECENT_ROOMS = 40;

/** Everything on the Predictions page. Picks of races still running stay hidden until they cross the line. */
async function predictionBoard(deps: Deps, token: string | null) {
  const now = deps.now();
  for (const terrain of TEST_TERRAINS) await ensureRooms(deps, terrain); // rooms that are due resolve here
  const wallet = token ? await deps.store.getSessionWallet(await deps.sha256Hex(token), now) : null;
  const rows = await deps.store.predictionBoard(100, now);
  const names = await deps.store.getUsernames(rows.map(r => r.wallet));
  const players = rows.map((r, i) => ({
    rank: i + 1, wallet: r.wallet, name: names[r.wallet] ?? shortWallet(r.wallet),
    points: r.points, picks: r.picks, winners: r.winners, podiums: r.podiums,
  }));

  const rooms = await deps.store.recentRooms(RECENT_ROOMS, now);
  const wins = Array(FIELD_SIZE).fill(0) as number[];
  const recent = [];
  for (const room of rooms) {
    const best = room.results?.find(r => r.position === 1);
    const index = room.field?.findIndex(f => f.id === best?.id) ?? -1;
    if (index < 0) continue;
    wins[index]++;
    if (recent.length < 8) recent.push({ raceId: room.id, number: index + 1, name: room.field![index].name, terrain: room.terrain, finishedAt: room.finished_at });
  }

  let mine = null;
  if (wallet) {
    for (const row of (await deps.store.predictionsFor(wallet, 200)).filter(p => p.race.status === 'open')) await settleIfDue(deps, row.race);
    const list = await deps.store.predictionsFor(wallet, 30);
    mine = {
      summary: players.find(p => p.wallet === wallet) ?? null,
      picks: list.map(p => {
        const over = raceOver(p.race, now);
        return {
          raceId: p.race_id, terrain: p.race.terrain, pick: p.pick, startsAt: p.race.closes_at,
          status: over ? 'finished' : p.race.status === 'finished' ? 'live' : 'open',
          position: over ? p.position : null,
          points: over ? p.points : 0,
        };
      }),
    };
  }
  return { players, recent, numberWins: wins, roomsCounted: wins.reduce((a, b) => a + b, 0), mine };
}

/* ------------------------------------------------------------------ */
/* Read-only views                                                     */
/* ------------------------------------------------------------------ */

async function replay(deps: Deps, raceId: string) {
  const race = await settleIfDue(deps, await mustGetRace(deps, raceId));
  return { race: await publicRace(deps, race, await deps.store.listEntries(raceId)) };
}

async function history(deps: Deps, wallet: string) {
  for (const room of await deps.store.openRoomsFor(wallet)) await settleIfDue(deps, room);
  const rows = await deps.store.history(wallet, 50);
  const now = deps.now();
  return {
    races: rows.map(r => {
      // Still running on screen: keep the result (and its points) back until it crosses the line.
      const live = r.race.status === 'finished' && !raceOver(r.race, now);
      return {
        raceId: r.race_id,
        kind: r.race.kind,
        terrain: r.race.terrain,
        status: live ? 'live' : r.race.status,
        joinedAt: r.joined_at,
        position: live ? null : r.position,
        points: live ? 0 : r.points,
      };
    }),
  };
}

/** Everything the Profile page shows: the player status plus season stats over all finished races. */
async function profile(deps: Deps, wallet: string) {
  const status = await me(deps, wallet);
  const now = deps.now();
  const rows = (await deps.store.history(wallet, 2000)).filter(r => raceOver(r.race, now) && r.position !== null);
  const by = (kind: 'bot' | 'online') => {
    const list = rows.filter(r => r.race.kind === kind);
    return { races: list.length, points: list.reduce((n, r) => n + r.points, 0), wins: list.filter(r => r.position === 1).length };
  };
  const positions = rows.map(r => r.position as number);
  const finishes = Array.from({ length: FIELD_SIZE }, (_, i) => positions.filter(p => p === i + 1).length);
  return {
    ...status,
    stats: {
      races: rows.length,
      winRate: rows.length ? status.wins / rows.length : 0,
      avgPosition: rows.length ? positions.reduce((a, b) => a + b, 0) / rows.length : null,
      best: positions.length ? Math.min(...positions) : null,
      finishes,
      bot: by('bot'),
      online: by('online'),
      firstRace: rows.length ? rows[rows.length - 1].joined_at : null,
      lastRace: rows.length ? rows[0].joined_at : null,
    },
  };
}

async function leaderboard(deps: Deps) {
  const rows = await deps.store.leaderboard(100, deps.now());
  const names = await deps.store.getUsernames(rows.map(r => r.wallet));
  const days = await deps.store.raceDays(rows.map(r => r.wallet));
  const numbers = await deps.store.racerNumbers(deps.betaSeasonEnd ?? null);
  const today = utcDay(deps.now());
  return {
    players: rows.map((r, i) => ({ rank: i + 1, wallet: r.wallet, name: names[r.wallet] ?? shortWallet(r.wallet), badge: streakFor(days[r.wallet] ?? [], today).badge, racerNumber: numbers[r.wallet] ?? null, points: r.points, races: r.races, wins: r.wins, podiums: r.podiums })),
  };
}

async function setUsername(deps: Deps, wallet: string, raw: string) {
  const checked = checkUsername(raw);
  if ('error' in checked) throw new HttpError(400, 'bad_username', checked.error);
  if (await deps.store.setUsername(wallet, checked.name) === 'taken') {
    throw new HttpError(409, 'username_taken', 'Another racer already uses this name.');
  }
  return me(deps, wallet);
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/**
 * Seconds from the server fixing a result to the racers leaving the line on screen:
 * a little under the 900 ms jog-in + 3-2-1 countdown in RaceRoom (loading only adds to it),
 * so the points are in by the time the finishing browser asks for them.
 */
const RACE_LEAD_IN_SECONDS = 3.5;

/** When a race just resolved at `now` crosses the line on screen; points count from then on. */
function raceEndsAt(now: Date, results: TestRaceResult[]): string {
  const raceSeconds = Math.max(0, ...results.map(r => r.finishTime ?? 0));
  return new Date(now.getTime() + (RACE_LEAD_IN_SECONDS + raceSeconds) * 1000).toISOString();
}

export function raceOver(race: RaceRow, now: Date): boolean {
  return race.status === 'finished' && race.finished_at !== null && Date.parse(race.finished_at) <= now.getTime();
}

/** Takes the next free race slot of the day; false when the daily limit is used up. */
async function claimSlot(deps: Deps, wallet: string, raceId: string, now: Date, result: { position: number; points: number } | null): Promise<boolean> {
  const day = utcDay(now);
  const unlimited = deps.unlimitedWallets.has(wallet);
  const held = await deps.store.heldSeats(wallet);
  for (let attempt = 0; attempt < DAILY_RACE_LIMIT + 2; attempt++) {
    const used = await deps.store.countEntriesOnDay(wallet, day);
    if (!unlimited && used + held >= DAILY_RACE_LIMIT) return false;
    const status = await deps.store.insertEntry({
      race_id: raceId, wallet, day, slot: used + 1,
      position: result?.position ?? null, points: result?.points ?? 0, joined_at: now.toISOString(),
    });
    if (status === 'ok') return true;
    // A parallel request took this slot (or this race already has the wallet): recount and retry.
  }
  return false;
}

async function publicRace(deps: Deps, race: RaceRow, entries: EntryRow[]) {
  const names = await deps.store.getUsernames(entries.map(e => e.wallet));
  return {
    id: race.id,
    kind: race.kind,
    terrain: race.terrain,
    status: race.status,
    createdAt: race.created_at,
    closesAt: race.closes_at,
    finishedAt: race.finished_at,
    // The seed is only revealed once the result is fixed.
    seed: race.status === 'finished' ? race.seed : null,
    field: race.status === 'finished' ? race.field : null,
    results: race.status === 'finished' ? race.results : null,
    players: entries
      .sort((a, b) => a.joined_at.localeCompare(b.joined_at))
      .map(e => ({ wallet: e.wallet, name: names[e.wallet] ?? shortWallet(e.wallet), position: e.position, points: e.points })),
    maxPlayers: FIELD_SIZE,
  };
}

async function mustGetRace(deps: Deps, id: string): Promise<RaceRow> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new HttpError(400, 'bad_request', 'Unknown race.');
  const race = await deps.store.getRace(id);
  if (!race) throw new HttpError(404, 'not_found', 'Race not found.');
  return race;
}

function checkTerrain(terrain: string) {
  if (!TEST_TERRAINS.includes(terrain)) throw new HttpError(400, 'track_locked', 'This track is not open during the Beta season.');
}

/** Takes a seat that keeps one race back. Slot 0 until the race starts; false when no race is left. */
async function claimSeat(deps: Deps, wallet: string, raceId: string, now: Date): Promise<boolean> {
  const day = utcDay(now);
  const used = await deps.store.countEntriesOnDay(wallet, day);
  if (!deps.unlimitedWallets.has(wallet) && used + await deps.store.heldSeats(wallet) >= DAILY_RACE_LIMIT) return false;
  const status = await deps.store.insertEntry({ race_id: raceId, wallet, day, slot: 0, position: null, points: 0, joined_at: now.toISOString() });
  // A conflict here is a double click: the seat is already ours.
  return status === 'ok' || (await deps.store.listEntries(raceId)).some(e => e.wallet === wallet);
}

/** The race starts: the held seat becomes a race of today. It was kept back, so the limit is not checked again. */
async function chargeSeat(deps: Deps, wallet: string, raceId: string, now: Date) {
  const day = utcDay(now);
  for (let attempt = 0; attempt < DAILY_RACE_LIMIT + 2; attempt++) {
    const used = await deps.store.countEntriesOnDay(wallet, day);
    if (await deps.store.chargeSeat(raceId, wallet, day, used + 1) === 'ok') return;
  }
}

function limitError(now: Date): HttpError {
  const hours = Math.max(1, Math.ceil((Date.parse(nextUtcMidnight(now)) - now.getTime()) / 3_600_000));
  return new HttpError(429, 'daily_limit', `You have used your ${DAILY_RACE_LIMIT} races for today. New races unlock at midnight UTC (in about ${hours} hour${hours === 1 ? '' : 's'}).`);
}

function utcDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function nextUtcMidnight(d: Date): string {
  const next = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1));
  return next.toISOString();
}

/* ------------------------------------------------------------------ */
/* Bug reports                                                         */
/* ------------------------------------------------------------------ */

const REPORT_KINDS = ['bug', 'idea', 'other'];
const REPORT_AREAS = ['racing', 'rooms', 'wallet', 'leaderboard', 'profile', 'other'];
/** Per UTC day. Sign-in problems are worth hearing about, so signed-out visitors can report too, under one shared limit. */
const REPORTS_PER_WALLET = 5;
const REPORTS_SIGNED_OUT = 30;

async function report(deps: Deps, body: Record<string, unknown>, token: string | null) {
  const kind = str(body.kind), area = str(body.area), message = str(body.message);
  if (!REPORT_KINDS.includes(kind) || !REPORT_AREAS.includes(area)) throw new HttpError(400, 'bad_request', 'Pick a type and an area.');
  if (message.length < 10) throw new HttpError(400, 'report_short', 'Tell us a little more, at least 10 characters.');
  if (message.length > 2000) throw new HttpError(400, 'report_long', 'Please keep it under 2000 characters.');
  const now = deps.now();
  const wallet = token ? await deps.store.getSessionWallet(await deps.sha256Hex(token), now) : null;
  const used = await deps.store.countReports(`${utcDay(now)}T00:00:00.000Z`, wallet);
  if (used >= (wallet ? REPORTS_PER_WALLET : REPORTS_SIGNED_OUT)) {
    throw new HttpError(429, 'report_limit', 'You have sent a lot of reports today. Please try again tomorrow.');
  }
  await deps.store.insertReport({
    id: deps.uuid(), wallet, kind, area, message,
    contact: str(body.contact).slice(0, 80) || null,
    page: str(body.page).slice(0, 120) || null,
    agent: str(body.agent).slice(0, 300) || null,
    created_at: now.toISOString(),
  });
  return { sent: true };
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

function ok(body: unknown): Reply {
  return { status: 200, body };
}
