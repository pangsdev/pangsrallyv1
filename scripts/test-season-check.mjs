#!/usr/bin/env node
/**
 * End-to-end check of the test-season server logic against the in-memory store.
 *
 *   npm run test:season
 *
 * Needs Node 22.18+ (runs the TypeScript sources directly).
 */
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Wallet, verifyMessage } from 'ethers';
import { handle, signInMessage } from '../supabase/functions/test-season/core.ts';
import { createMemoryStore } from '../supabase/functions/test-season/memoryStore.ts';
import { runTestRace, DAILY_RACE_LIMIT, FIELD_SIZE, ONLINE_WAIT_SECONDS, POINTS_BY_POSITION } from '../supabase/functions/test-season/race/testSeason.ts';

let clock = Date.parse('2026-11-02T12:00:00Z');
const owner = Wallet.createRandom();
const deps = {
  store: createMemoryStore(),
  verifyMessage,
  sha256Hex: async (t) => createHash('sha256').update(t).digest('hex'),
  randomHex: (n) => randomBytes(n).toString('hex'),
  uuid: () => randomUUID(),
  now: () => new Date(clock),
  unlimitedWallets: new Set([owner.address.toLowerCase()]),
};
const call = (action, body = {}, token = null) => handle(deps, action, { action, ...body }, token);

async function signIn(wallet) {
  const message = signInMessage(wallet.address, new Date(clock).toISOString());
  const res = await call('login', { address: wallet.address, message, signature: await wallet.signMessage(message) });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res.body.token;
}

let checks = 0;
const ok = (label) => { checks++; console.log(`  ✓ ${label}`); };

// --- sign-in -------------------------------------------------------------
const alice = Wallet.createRandom();
const aliceToken = await signIn(alice);
ok('login with a real wallet signature');

{
  const other = Wallet.createRandom();
  const message = signInMessage(alice.address, new Date(clock).toISOString());
  const res = await call('login', { address: alice.address, message, signature: await other.signMessage(message) });
  assert.equal(res.status, 401);
  ok('signature from another wallet is rejected');

  const old = signInMessage(alice.address, new Date(clock - 11 * 60_000).toISOString());
  const res2 = await call('login', { address: alice.address, message: old, signature: await alice.signMessage(old) });
  assert.equal(res2.status, 400);
  ok('expired sign-in message is rejected');

  assert.equal((await call('bot-race', { terrain: 'Forest' }, 'not-a-token')).status, 401);
  ok('races need a valid session');
}

// --- bot races + daily limit ----------------------------------------------
{
  const me = (await call('me', {}, aliceToken)).body;
  assert.equal(me.racesLeft, DAILY_RACE_LIMIT);

  const results = await Promise.all(Array.from({ length: 6 }, () => call('bot-race', { terrain: 'Forest' }, aliceToken)));
  const won = results.filter(r => r.status === 200);
  const blocked = results.filter(r => r.status === 429);
  assert.equal(won.length, DAILY_RACE_LIMIT, `parallel bot races allowed: ${won.length}`);
  assert.equal(blocked.length, 6 - DAILY_RACE_LIMIT);
  ok(`6 parallel bot races → exactly ${DAILY_RACE_LIMIT} run, the rest hit the daily limit`);

  for (const r of won) {
    const { race, you } = r.body;
    assert.equal(race.field.length, FIELD_SIZE);
    assert.equal(race.field.filter(f => f.wallet).length, 1);
    assert.equal(race.field[4].wallet, alice.address.toLowerCase(), 'player runs in lane 5');
    // The browser replays the race from seed + field: it must land on the same result.
    const replay = runTestRace(race.seed, race.field, race.terrain);
    assert.deepEqual(replay, race.results);
    assert.equal(you.points, POINTS_BY_POSITION[you.position - 1]);
  }
  ok('browser replay of seed + field matches the server result; points match the table');

  assert.equal((await call('bot-race', { terrain: 'Desert' }, aliceToken)).status, 400);
  ok('locked tracks are refused');

  clock += 24 * 3600_000;
  assert.equal((await call('me', {}, aliceToken)).body.racesLeft, DAILY_RACE_LIMIT);
  ok('limit resets the next UTC day');
}

// --- owner wallet is unlimited --------------------------------------------
{
  const t = await signIn(owner);
  for (let i = 0; i < DAILY_RACE_LIMIT + 2; i++) assert.equal((await call('bot-race', { terrain: 'Forest' }, t)).status, 200);
  ok('TEST_UNLIMITED_WALLETS skips the daily limit');
}

// --- online rooms ---------------------------------------------------------
{
  const players = [alice, Wallet.createRandom(), Wallet.createRandom()];
  const tokens = [aliceToken, await signIn(players[1]), await signIn(players[2])];
  const joins = [];
  for (const t of tokens) joins.push(await call('online-join', { terrain: 'Forest' }, t));
  const roomId = joins[0].body.race.id;
  assert.ok(joins.every(j => j.status === 200 && j.body.race.id === roomId), 'all three share one room');
  assert.equal(joins[2].body.race.players.length, 3);
  assert.equal(joins[2].body.race.seed, null, 'seed hidden while the room is open');
  ok('three players land in the same open room; the seed stays hidden');

  const again = await call('online-join', { terrain: 'Forest' }, tokens[1]);
  assert.equal(again.body.race.id, roomId);
  assert.equal((await call('me', {}, tokens[1])).body.racesToday, 1, 'rejoining does not spend a race');
  ok('re-joining returns to the same room without spending a race');

  clock += (ONLINE_WAIT_SECONDS + 1) * 1000;
  const status = await call('online-status', { raceId: roomId });
  const race = status.body.race;
  assert.equal(race.status, 'finished');
  assert.equal(race.field.filter(f => f.wallet).length, 3);
  assert.deepEqual(runTestRace(race.seed, race.field, race.terrain), race.results);
  for (const p of race.players) assert.equal(p.points, POINTS_BY_POSITION[p.position - 1]);
  ok('room starts after the wait, fills with bots, scores every player');

  const hist = (await call('history', {}, tokens[2])).body.races;
  assert.equal(hist[0].raceId, roomId);
  assert.ok(hist[0].position >= 1);
  ok('the race shows up in My Races with its result');
}

// --- a player who leaves still gets scored --------------------------------
{
  const dave = Wallet.createRandom();
  const t = await signIn(dave);
  const join = await call('online-join', { terrain: 'Forest' }, t);
  clock += (ONLINE_WAIT_SECONDS + 5) * 1000;
  const hist = (await call('history', {}, t)).body.races;
  assert.equal(hist[0].raceId, join.body.race.id);
  assert.equal(hist[0].status, 'finished');
  ok('a room nobody watches resolves when the player comes back');
}

// --- leaderboard ----------------------------------------------------------
{
  const board = (await call('leaderboard')).body.players;
  assert.ok(board.length >= 4);
  for (let i = 1; i < board.length; i++) assert.ok(board[i - 1].points >= board[i].points);
  const a = board.find(p => p.wallet === alice.address.toLowerCase());
  const hist = (await call('history', {}, aliceToken)).body.races;
  assert.equal(a.points, hist.reduce((n, r) => n + r.points, 0));
  ok('leaderboard is sorted and totals match each player\'s races');
}

// --- artwork: only the 10 public teasers, one per racer ---------------------
{
  const { buildTestField } = await import('../supabase/functions/test-season/race/testSeason.ts');
  for (const wallets of [[], ['0x' + 'a'.repeat(40)], Array.from({ length: 4 }, (_, i) => '0x' + String(i + 1).repeat(40)), Array.from({ length: 10 }, (_, i) => '0x' + i.toString(16).repeat(40))]) {
    const field = buildTestField(`art-${wallets.length}`, wallets);
    assert.equal(field.length, FIELD_SIZE);
    assert.deepEqual(field.map(f => f.tokenId).sort((a, b) => a - b), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], `${wallets.length} players`);
  }
  ok('every racer wears a distinct public teaser (tokens 1-10), for 0-10 players');

  // The ball a racer rolls into must match the pangolin it runs as: body comes from the
  // checked teaser table, and both the artwork and the ball sprite must exist.
  const { TEASER_BODIES } = await import('../supabase/functions/test-season/race/testSeason.ts');
  const { existsSync } = await import('node:fs');
  const field = buildTestField('colours', ['0x' + 'b'.repeat(40)]);
  for (const r of field) {
    assert.equal(r.body, TEASER_BODIES[r.tokenId], `token ${r.tokenId} body`);
    assert.ok(existsSync(new URL(`../public/nft-images/${r.tokenId}.webp`, import.meta.url)), `artwork ${r.tokenId}`);
    assert.ok(existsSync(new URL(`../public/sprites/ball_${r.body.toLowerCase()}.png`, import.meta.url)), `ball for ${r.body}`);
  }
  ok('each racer\'s ball colour matches its teaser artwork, and every file exists');
}

// --- fairness: identical stats → ~10% win rate per racer -------------------
{
  const N = 2000;
  const wins = Array(FIELD_SIZE).fill(0);
  const { buildTestField } = await import('../supabase/functions/test-season/race/testSeason.ts');
  for (let i = 0; i < N; i++) {
    const seed = `fair-${i}`;
    const field = buildTestField(seed, ['0x' + 'a'.repeat(40)]);
    const res = runTestRace(seed, field, 'Forest');
    wins[res.find(r => r.position === 1) ? field.findIndex(f => f.id === res.find(r => r.position === 1).id) : 0]++;
  }
  const playerWin = wins[4] / N;
  assert.ok(playerWin > 0.07 && playerWin < 0.13, `player win rate ${playerWin}`);
  ok(`fair field: player wins ${(playerWin * 100).toFixed(1)}% of ${N} races (expected ~10%)`);
}

console.log(`\n${checks} checks passed.`);
