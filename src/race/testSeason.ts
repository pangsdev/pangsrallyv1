/**
 * Test-season race rules, shared by the browser and the `test-season` server
 * function (scripts/sync-race-shared.mjs copies this file there).
 *
 * Pure module: no browser, Node or Deno globals.
 *
 * During the test season no NFTs are minted yet, so every racer — players
 * and bots — runs on identical stats. Only the seeded luck in the simulation
 * (form, bursts, stumbles) decides a race: each of the 10 racers has a ~10%
 * chance to win.
 */
import { RaceSimulation, generateBots, DEFAULT_RACE_DISTANCE, type RacerInput, type RacerStats } from './simulation';
import { callNameForToken } from './callNames';
import type { BodyColor } from './sprites';

export const FIELD_SIZE = 10;
export const DAILY_RACE_LIMIT = 3;
/** Season points by finishing position (1st … 10th). */
export const POINTS_BY_POSITION = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1];
/** An online room starts this long after it opens, or as soon as it is full. */
export const ONLINE_WAIT_SECONDS = 60;
/** Tracks open during the test season. */
export const TEST_TERRAINS = ['Forest'];
/** The lone player of a bot race always runs in lane 5 (the caller's player lines are baked for number 5). */
export const BOT_RACE_PLAYER_LANE = 5;
const TEST_STATS: RacerStats = { speed: 50, burst: 50, endurance: 50 };
const COLLECTION_SIZE = 1000;

export type TokenBodyLookup = (tokenId: number) => BodyColor | null;

/** A racer as stored and sent by the server: a simulation input plus who owns it. */
export interface TestRacer extends RacerInput {
  /** lower-case wallet for players, absent for bots */
  wallet?: string;
  tokenId: number;
}

export interface TestRaceResult {
  id: string;
  position: number;
  finishTime: number | null;
}

/** The exact message a wallet signs to sign in; the server rebuilds it to verify. */
export function signInMessage(address: string, issuedAt: string): string {
  return [
    'Pangs Rally Test Season sign-in',
    '',
    `Wallet: ${address}`,
    `Issued: ${issuedAt}`,
    '',
    'Signing proves you own this wallet. It is free: no gas, no transaction.',
  ].join('\n');
}

export function pointsFor(position: number): number {
  return POINTS_BY_POSITION[position - 1] ?? 0;
}

export function shortWallet(wallet: string): string {
  return wallet.length > 12 ? `${wallet.slice(0, 6)}…${wallet.slice(-4)}` : wallet;
}

/** The collection artwork a wallet races with during the test season (stable per wallet). */
export function testTokenFor(wallet: string): number {
  let h = 2166136261;
  const w = wallet.toLowerCase();
  for (let i = 0; i < w.length; i++) {
    h ^= w.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return 1 + ((h >>> 0) % COLLECTION_SIZE);
}

/**
 * The 10-racer field for a race. `wallets` are the players in join order;
 * bots fill the remaining lanes. A single-player (bot) race puts the player
 * in lane 5; with several players the seed shuffles who runs where.
 */
export function buildTestField(seed: string, wallets: string[], bodyOf: TokenBodyLookup): TestRacer[] {
  const players = wallets.slice(0, FIELD_SIZE).map(w => w.toLowerCase());
  const lanes = assignLanes(seed, players.length);

  const usedTokens = new Set<number>();
  const playerTokens = players.map(w => {
    let t = testTokenFor(w);
    while (usedTokens.has(t)) t = (t % COLLECTION_SIZE) + 1;
    usedTokens.add(t);
    return t;
  });
  const bots = generateBots(seed, FIELD_SIZE - players.length, new Set([...usedTokens].map(String)));

  const usedNames = new Set<string>();
  const field: (TestRacer | null)[] = Array(FIELD_SIZE).fill(null);
  players.forEach((wallet, i) => {
    const tokenId = playerTokens[i];
    field[lanes[i] - 1] = racer(`p-${wallet}`, shortWallet(wallet), tokenId, bodyOf, wallet);
  });
  let b = 0;
  for (let lane = 0; lane < FIELD_SIZE; lane++) {
    if (field[lane]) continue;
    const tokenId = bots[b].tokenId;
    const name = callNameForToken(tokenId, usedNames);
    usedNames.add(name);
    field[lane] = racer(`bot-${b}`, name, tokenId, bodyOf);
    b++;
  }
  return field as TestRacer[];
}

/** Runs the race to the finish. Same seed + field → same result, in the browser and on the server. */
export function runTestRace(seed: string, field: RacerInput[], terrain: string): TestRaceResult[] {
  const sim = new RaceSimulation(seed, field, { distance: DEFAULT_RACE_DISTANCE, terrain });
  sim.start();
  for (let guard = 0; !sim.finished && guard < 200_000; guard++) sim.step(1 / 60);
  return sim.racers.map(r => ({ id: r.id, position: r.position, finishTime: r.finishTime }));
}

function racer(id: string, name: string, tokenId: number, bodyOf: TokenBodyLookup, wallet?: string): TestRacer {
  return {
    id,
    name,
    tokenId,
    body: bodyOf(tokenId) ?? 'Brown',
    avatarUrl: `/nft-images/${tokenId}.webp`,
    isPlayer: false,
    stats: { ...TEST_STATS },
    terrainAffinity: null,
    ...(wallet ? { wallet } : {}),
  };
}

/** 1-based lanes for the players, in join order. */
function assignLanes(seed: string, count: number): number[] {
  if (count === 1) return [BOT_RACE_PLAYER_LANE];
  const lanes = Array.from({ length: FIELD_SIZE }, (_, i) => i + 1);
  // Seeded Fisher–Yates; FNV-1a + xorshift keeps this free of extra dependencies.
  let s = 2166136261;
  for (let i = 0; i < seed.length; i++) s = Math.imul(s ^ seed.charCodeAt(i), 16777619);
  const next = () => {
    s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
  for (let i = lanes.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [lanes[i], lanes[j]] = [lanes[j], lanes[i]];
  }
  return lanes.slice(0, count);
}
