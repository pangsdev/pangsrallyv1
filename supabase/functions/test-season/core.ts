/**
 * Test-season game server: wallet sign-in, the daily race limit, bot races,
 * online rooms, points and the leaderboard. Every result is computed here, so
 * a browser cannot award itself points.
 *
 * Platform-neutral on purpose: index.ts runs it as a Supabase Edge Function
 * (Deno + Postgres), and vite.config.ts runs it in `npm run dev` with an
 * in-memory store so the whole flow works locally.
 */
import {
  DAILY_RACE_LIMIT, FIELD_SIZE, ONLINE_WAIT_SECONDS, TEST_TERRAINS,
  buildTestField, pointsFor, runTestRace, shortWallet, signInMessage,
  type TestRacer, type TestRaceResult,
} from './race/testSeason.ts';

export interface RaceRow {
  id: string;
  kind: 'bot' | 'online';
  terrain: string;
  seed: string;
  status: 'open' | 'finished';
  created_at: string;
  closes_at: string | null;
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

export interface Store {
  getSessionWallet(tokenHash: string, now: Date): Promise<string | null>;
  createSession(tokenHash: string, wallet: string, expiresAt: Date): Promise<void>;
  upsertPlayer(wallet: string, now: Date): Promise<void>;
  playerExists(wallet: string): Promise<boolean>;
  /** Registers a new wallet and takes one place on the code, atomically. */
  joinWithInvite(wallet: string, code: string): Promise<'exists' | 'joined' | 'invalid'>;
  countEntriesOnDay(wallet: string, day: string): Promise<number>;
  insertRace(race: RaceRow): Promise<void>;
  deleteRace(id: string): Promise<void>;
  /** 'conflict' when (race, wallet) or (wallet, day, slot) already exists */
  insertEntry(entry: EntryRow): Promise<'ok' | 'conflict'>;
  deleteEntry(raceId: string, wallet: string): Promise<void>;
  getRace(id: string): Promise<RaceRow | null>;
  listEntries(raceId: string): Promise<EntryRow[]>;
  /** Oldest open online room on this track that has not started yet. */
  findOpenRoom(terrain: string, now: Date): Promise<RaceRow | null>;
  /** Open online rooms this wallet is waiting in. */
  openRoomsFor(wallet: string): Promise<RaceRow[]>;
  /** Marks an open race finished; false when another request already did. */
  finishRace(id: string, patch: { field: TestRacer[]; results: TestRaceResult[]; finished_at: string }): Promise<boolean>;
  setEntryResult(raceId: string, wallet: string, position: number, points: number): Promise<void>;
  leaderboard(limit: number): Promise<LeaderRow[]>;
  history(wallet: string, limit: number): Promise<(EntryRow & { race: RaceRow })[]>;
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
      case 'online-join': return ok(await onlineJoin(deps, await requireWallet(deps, token), str(body.terrain)));
      case 'online-status': return ok(await onlineStatus(deps, str(body.raceId)));
      case 'race': return ok(await replay(deps, str(body.raceId)));
      case 'history': return ok(await history(deps, await requireWallet(deps, token)));
      case 'leaderboard': return ok(await leaderboard(deps));
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
  if (message !== signInMessage(address, issued) || !Number.isFinite(issuedAt) || Math.abs(now.getTime() - issuedAt) > SIGN_IN_MAX_AGE_MS) {
    throw new HttpError(400, 'bad_message', 'The sign-in message expired. Please sign again.');
  }

  let signer = '';
  try { signer = deps.verifyMessage(message, signature); } catch { /* handled below */ }
  if (signer.toLowerCase() !== address.toLowerCase()) throw new HttpError(401, 'bad_signature', 'Signature does not match this wallet.');

  const wallet = address.toLowerCase();
  if (deps.inviteRequired && !deps.unlimitedWallets.has(wallet) && !(await deps.store.playerExists(wallet))) {
    const code = normalizeInvite(body.inviteCode);
    if (!code) throw new HttpError(403, 'invite_required', 'The test season is invite-only. Enter your invite code to join.');
    if (await deps.store.joinWithInvite(wallet, code) === 'invalid') {
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
  // Rooms the player left before they started still resolve and score.
  for (const room of await deps.store.openRoomsFor(wallet)) await settleIfDue(deps, room);
  const unlimited = deps.unlimitedWallets.has(wallet);
  const racesToday = await deps.store.countEntriesOnDay(wallet, utcDay(now));
  const board = await deps.store.leaderboard(10_000);
  const index = board.findIndex(r => r.wallet === wallet);
  const row = board[index];
  return {
    wallet,
    racesToday,
    dailyLimit: DAILY_RACE_LIMIT,
    racesLeft: unlimited ? DAILY_RACE_LIMIT : Math.max(0, DAILY_RACE_LIMIT - racesToday),
    unlimited,
    points: row?.points ?? 0,
    races: row?.races ?? 0,
    wins: row?.wins ?? 0,
    podiums: row?.podiums ?? 0,
    rank: index >= 0 ? index + 1 : null,
    resetsAt: nextUtcMidnight(now),
  };
}

/* ------------------------------------------------------------------ */
/* Bot race                                                            */
/* ------------------------------------------------------------------ */

async function botRace(deps: Deps, wallet: string, terrain: string) {
  checkTerrain(terrain);
  const now = deps.now();
  const id = deps.uuid();
  const seed = `bot-${id}`;
  const field = buildTestField(seed, [wallet]);
  const results = runTestRace(seed, field, terrain);
  const mine = results.find(r => r.id === field.find(f => f.wallet === wallet)?.id);
  if (!mine) throw new Error('player missing from field');

  await deps.store.insertRace({
    id, kind: 'bot', terrain, seed, status: 'finished',
    created_at: now.toISOString(), closes_at: null, finished_at: now.toISOString(), field, results,
  });
  const points = pointsFor(mine.position);
  const claimed = await claimSlot(deps, wallet, id, now, { position: mine.position, points });
  if (!claimed) {
    await deps.store.deleteRace(id);
    throw limitError(now);
  }
  return {
    race: publicRace(await mustGetRace(deps, id), await deps.store.listEntries(id)),
    you: { position: mine.position, points },
    ...(await me(deps, wallet)),
  };
}

/* ------------------------------------------------------------------ */
/* Online rooms                                                        */
/* ------------------------------------------------------------------ */

async function onlineJoin(deps: Deps, wallet: string, terrain: string) {
  checkTerrain(terrain);
  // Already waiting in a room → go back to it instead of spending another race.
  for (const room of await deps.store.openRoomsFor(wallet)) {
    const settled = await settleIfDue(deps, room);
    if (settled.status === 'open' && settled.terrain === terrain) return onlineStatus(deps, settled.id);
  }

  for (let attempt = 0; attempt < 5; attempt++) {
    const now = deps.now();
    let room = await deps.store.findOpenRoom(terrain, now);
    if (!room) {
      const id = deps.uuid();
      room = {
        id, kind: 'online', terrain, seed: `online-${id}`, status: 'open',
        created_at: now.toISOString(), closes_at: new Date(now.getTime() + ONLINE_WAIT_SECONDS * 1000).toISOString(),
        finished_at: null, field: null, results: null,
      };
      await deps.store.insertRace(room);
    }
    if (!(await claimSlot(deps, wallet, room.id, now, null))) throw limitError(now);
    // Two players can take the last seat at once; the later one moves on to another room.
    const entries = await deps.store.listEntries(room.id);
    if (entries.length > FIELD_SIZE) {
      await deps.store.deleteEntry(room.id, wallet);
      continue;
    }
    return onlineStatus(deps, room.id);
  }
  throw new HttpError(503, 'busy', 'Rooms are busy right now. Please try again.');
}

async function onlineStatus(deps: Deps, raceId: string) {
  const race = await mustGetRace(deps, raceId);
  const settled = await settleIfDue(deps, race);
  return { race: publicRace(settled, await deps.store.listEntries(raceId)), serverTime: deps.now().toISOString() };
}

/** Starts (resolves) an online room once it is full or its wait is over. */
async function settleIfDue(deps: Deps, race: RaceRow): Promise<RaceRow> {
  if (race.kind !== 'online' || race.status !== 'open') return race;
  const entries = (await deps.store.listEntries(race.id)).sort((a, b) => a.joined_at.localeCompare(b.joined_at));
  const now = deps.now();
  const due = entries.length >= FIELD_SIZE || (race.closes_at !== null && now.getTime() >= Date.parse(race.closes_at));
  if (!due) return race;
  if (entries.length === 0) {
    await deps.store.deleteRace(race.id);
    return { ...race, status: 'finished' };
  }

  const field = buildTestField(race.seed, entries.map(e => e.wallet));
  const results = runTestRace(race.seed, field, race.terrain);
  const won = await deps.store.finishRace(race.id, { field, results, finished_at: now.toISOString() });
  if (won) {
    for (const racer of field) {
      if (!racer.wallet) continue;
      const position = results.find(r => r.id === racer.id)!.position;
      await deps.store.setEntryResult(race.id, racer.wallet, position, pointsFor(position));
    }
  }
  return mustGetRace(deps, race.id);
}

/* ------------------------------------------------------------------ */
/* Read-only views                                                     */
/* ------------------------------------------------------------------ */

async function replay(deps: Deps, raceId: string) {
  const race = await settleIfDue(deps, await mustGetRace(deps, raceId));
  return { race: publicRace(race, await deps.store.listEntries(raceId)) };
}

async function history(deps: Deps, wallet: string) {
  for (const room of await deps.store.openRoomsFor(wallet)) await settleIfDue(deps, room);
  const rows = await deps.store.history(wallet, 50);
  return {
    races: rows.map(r => ({
      raceId: r.race_id,
      kind: r.race.kind,
      terrain: r.race.terrain,
      status: r.race.status,
      joinedAt: r.joined_at,
      position: r.position,
      points: r.points,
    })),
  };
}

async function leaderboard(deps: Deps) {
  const rows = await deps.store.leaderboard(100);
  return {
    players: rows.map((r, i) => ({ rank: i + 1, wallet: r.wallet, name: shortWallet(r.wallet), points: r.points, races: r.races, wins: r.wins, podiums: r.podiums })),
  };
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/** Takes the next free race slot of the day; false when the daily limit is used up. */
async function claimSlot(deps: Deps, wallet: string, raceId: string, now: Date, result: { position: number; points: number } | null): Promise<boolean> {
  const day = utcDay(now);
  const unlimited = deps.unlimitedWallets.has(wallet);
  for (let attempt = 0; attempt < 5; attempt++) {
    const used = await deps.store.countEntriesOnDay(wallet, day);
    if (!unlimited && used >= DAILY_RACE_LIMIT) return false;
    const status = await deps.store.insertEntry({
      race_id: raceId, wallet, day, slot: used + 1,
      position: result?.position ?? null, points: result?.points ?? 0, joined_at: now.toISOString(),
    });
    if (status === 'ok') return true;
    // A parallel request took this slot (or this race already has the wallet): recount and retry.
  }
  return false;
}

function publicRace(race: RaceRow, entries: EntryRow[]) {
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
      .map(e => ({ wallet: e.wallet, name: shortWallet(e.wallet), position: e.position, points: e.points })),
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
  if (!TEST_TERRAINS.includes(terrain)) throw new HttpError(400, 'track_locked', 'This track is not open during the test season.');
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

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

function ok(body: unknown): Reply {
  return { status: 200, body };
}
