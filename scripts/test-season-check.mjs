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
import { createBetaGate } from '../supabase/functions/test-season/beta.ts';
import { runTestRace, DAILY_RACE_LIMIT, FIELD_SIZE, ROOM_FULL_COUNTDOWN_SECONDS, POINTS_BY_POSITION } from '../supabase/functions/test-season/race/testSeason.ts';

let clock = Date.parse('2026-11-02T12:00:00Z');
const owner = Wallet.createRandom();
const deps = {
  store: createMemoryStore({ 'TEST-RALLY': 1000, 'TWO-SEATS': 2 }),
  verifyMessage,
  sha256Hex: async (t) => createHash('sha256').update(t).digest('hex'),
  randomHex: (n) => randomBytes(n).toString('hex'),
  uuid: () => randomUUID(),
  now: () => new Date(clock),
  unlimitedWallets: new Set([owner.address.toLowerCase()]),
  inviteRequired: true,
  beta: null,
  predictions: true,
};
const call = (action, body = {}, token = null) => handle(deps, action, { action, ...body }, token);

async function signIn(wallet, inviteCode = 'TEST-RALLY') {
  const message = signInMessage(wallet.address, new Date(clock).toISOString());
  const res = await call('login', { address: wallet.address, message, signature: await wallet.signMessage(message), inviteCode });
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

// --- invites ---------------------------------------------------------------
{
  const login = async (wallet, inviteCode) => {
    const message = signInMessage(wallet.address, new Date(clock).toISOString());
    return call('login', { address: wallet.address, message, signature: await wallet.signMessage(message), inviteCode });
  };
  const newcomer = Wallet.createRandom();
  assert.equal((await login(newcomer)).body.error, 'invite_required');
  assert.equal((await login(newcomer, 'NOPE-1234')).body.error, 'invite_invalid');
  ok('a new wallet needs a valid invite code');

  assert.equal((await login(alice)).status, 200);
  ok('a registered player signs in again without a code');

  assert.equal((await login(newcomer, '  two-seats ')).status, 200);
  ok('codes ignore case and spaces');

  const rush = await Promise.all([Wallet.createRandom(), Wallet.createRandom(), Wallet.createRandom()].map(w => login(w, 'TWO-SEATS')));
  assert.equal(rush.filter(r => r.status === 200).length, 1, 'one place was left');
  assert.equal(rush.filter(r => r.body.error === 'invite_full').length, 2, 'a full code says it is full');
  ok('a 2-place code admits exactly 2 wallets, even in parallel');

  assert.equal((await login(Wallet.createRandom())).status === 200, false);
  assert.equal((await login(owner)).status, 200);
  ok('the owner wallet needs no code');
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
    assert.equal(race.field.filter(f => f.wallet === alice.address.toLowerCase()).length, 1, 'the player is in the field once');
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
/** Signs in enough new players to take every free seat of the waiting room. */
const fillRoom = async (roomId, taken = 0) => {
  const tokens = await Promise.all(Array.from({ length: FIELD_SIZE - taken }, () => signIn(Wallet.createRandom())));
  let last;
  for (const t of tokens) last = await call('online-join', { terrain: 'Forest', roomId }, t);
  assert.equal(last.status, 200, JSON.stringify(last.body));
  return { tokens, race: last.body.race };
};
{
  const players = [alice, Wallet.createRandom(), Wallet.createRandom()];
  const tokens = [aliceToken, await signIn(players[1]), await signIn(players[2])];
  const before = (await call('me', {}, tokens[1])).body;
  const joins = [];
  for (const t of tokens) joins.push(await call('online-join', { terrain: 'Forest' }, t));
  const roomId = joins[0].body.race.id;
  assert.ok(joins.every(j => j.status === 200 && j.body.race.id === roomId), 'all three share one room');
  assert.equal(joins[2].body.race.players.length, 3);
  assert.equal(joins[2].body.race.seed, null, 'seed hidden while the room is open');
  assert.equal(joins[2].body.race.closesAt, null, 'a waiting room has no start time');
  ok('three players land in the same waiting room; the seed stays hidden');

  const again = await call('online-join', { terrain: 'Forest' }, tokens[1]);
  assert.equal(again.body.race.id, roomId);
  const held = (await call('me', {}, tokens[1])).body;
  assert.equal(held.racesToday, before.racesToday, 'a seat is not a race yet');
  assert.equal(held.racesLeft, before.racesLeft - 1, 'but it keeps one back');
  assert.equal(held.bookedSeats[0], null);
  ok('a seat keeps one race back and uses none; re-joining changes nothing');

  clock += 3 * 24 * 3_600_000;
  const still = await call('online-status', { raceId: roomId });
  assert.equal(still.body.race.status, 'open', 'days pass and the room keeps waiting');
  const list = (await call('rooms', { terrain: 'Forest' }, tokens[0])).body.rooms;
  assert.equal(list.length, 1);
  assert.equal(list[0].startsAt, null);
  assert.equal(list[0].names.length, 3);
  ok('an unfilled room never runs and never gets bots');

  const quitter = await call('online-leave', { raceId: roomId }, tokens[2]);
  assert.equal(quitter.status, 200, JSON.stringify(quitter.body));
  assert.equal(quitter.body.racesLeft, DAILY_RACE_LIMIT);
  assert.equal(quitter.body.bookedSeats.length, 0);
  assert.equal((await call('online-leave', { raceId: roomId }, tokens[2])).body.error, 'not_in_room');
  ok('leaving a waiting room gives the seat back for free');

  const { tokens: crowd, race: full } = await fillRoom(roomId, 2);
  assert.equal(full.status, 'open');
  assert.equal(Date.parse(full.closesAt), clock + ROOM_FULL_COUNTDOWN_SECONDS * 1000, 'starts after the countdown');
  assert.equal(full.seed, null);
  const after = (await call('rooms', { terrain: 'Forest' }, crowd[0])).body.rooms;
  assert.equal(after.length, 2);
  assert.equal(after[0].id, roomId);
  assert.equal(after[1].players, 0, 'the next room opens at once');
  assert.equal(after[1].startsAt, null);
  ok('the last seat starts the countdown and the next room opens at once');

  const late = await signIn(Wallet.createRandom());
  assert.equal((await call('online-join', { terrain: 'Forest', roomId }, late)).body.error, 'room_full');
  assert.equal((await call('online-leave', { raceId: roomId }, crowd[0])).body.error, 'room_locked');
  assert.equal((await call('online-join', { terrain: 'Forest', roomId: after[1].id }, crowd[0])).body.error, 'seat_held');
  ok('a full room takes nobody new, keeps its players, and a player holds one seat at a time');

  clock = Date.parse(full.closesAt) - 1000;
  assert.equal((await call('online-status', { raceId: roomId })).body.race.status, 'open');
  clock += 2000;
  const race = (await call('online-status', { raceId: roomId })).body.race;
  assert.equal(race.status, 'finished');
  assert.equal(race.field.filter(f => f.wallet).length, FIELD_SIZE, 'ten real players, no bots');
  assert.deepEqual(runTestRace(race.seed, race.field, race.terrain), race.results);
  for (const p of race.players) assert.equal(p.points, POINTS_BY_POSITION[p.position - 1]);
  const charged = (await call('me', {}, tokens[1])).body;
  assert.equal(charged.racesToday, 1, 'the race counts on the day it ran');
  assert.equal(charged.racesLeft, DAILY_RACE_LIMIT - 1);
  ok('the room runs after the countdown with ten real players and scores them all');

  assert.equal((await call('history', {}, tokens[1])).body.races[0].status, 'live', 'still running on screen');
  clock = Date.parse(race.finishedAt) + 1;
  const hist = (await call('history', {}, tokens[1])).body.races;
  assert.equal(hist[0].raceId, roomId);
  assert.ok(hist[0].position >= 1);
  ok('the race shows up in My Races with its result once it has run');
}

// --- a held seat counts against the daily limit -----------------------------
{
  const t = await signIn(Wallet.createRandom());
  const room = (await call('online-join', { terrain: 'Forest' }, t)).body.race;
  for (let i = 0; i < DAILY_RACE_LIMIT - 1; i++) assert.equal((await call('bot-race', { terrain: 'Forest' }, t)).status, 200);
  assert.equal((await call('bot-race', { terrain: 'Forest' }, t)).body.error, 'daily_limit');
  await fillRoom(room.id, (await call('online-status', { raceId: room.id })).body.race.players.length);
  clock += (ROOM_FULL_COUNTDOWN_SECONDS + 1) * 1000;
  const after = (await call('online-status', { raceId: room.id })).body.race;
  assert.equal(after.status, 'finished');
  const me = (await call('me', {}, t)).body;
  assert.equal(me.racesLeft, 0);
  assert.equal(me.bookedSeats.length, 0);
  clock = Date.parse(after.finishedAt) + 1;
  ok('a held seat is always there when the room starts, even after a full day of bot races');
}

// --- a player who leaves the page still gets scored -------------------------
{
  const t = await signIn(Wallet.createRandom());
  const join = await call('online-join', { terrain: 'Forest' }, t);
  const { race } = await fillRoom(join.body.race.id, join.body.race.players.length);
  clock = Date.parse(race.closesAt) + 5000;
  assert.equal((await call('history', {}, t)).body.races[0].status, 'live');
  clock += 120_000;
  const hist = (await call('history', {}, t)).body.races;
  assert.equal(hist[0].raceId, join.body.race.id);
  assert.equal(hist[0].status, 'finished');
  ok('a room nobody watches resolves when the player comes back');
}

// --- points count once the race has crossed the line on screen ---------------
{
  const erin = Wallet.createRandom();
  const t = await signIn(erin);
  const res = (await call('bot-race', { terrain: 'Forest' }, t)).body;
  const wallet = erin.address.toLowerCase();
  assert.ok(Date.parse(res.race.finishedAt) - clock > 10_000, 'ends after lead-in + race');
  assert.equal(res.points, 0, 'no points while the race runs');
  assert.equal((await call('history', {}, t)).body.races[0].points, 0);
  assert.ok(!(await call('leaderboard')).body.players.some(p => p.wallet === wallet));
  clock = Date.parse(res.race.finishedAt) + 1;
  assert.equal((await call('me', {}, t)).body.points, res.you.points);
  assert.ok((await call('leaderboard')).body.players.some(p => p.wallet === wallet));
  ok('points and the leaderboard wait until the race has run on screen');
}

// --- usernames ----------------------------------------------------------------
{
  const fay = Wallet.createRandom(), gus = Wallet.createRandom();
  const tf = await signIn(fay), tg = await signIn(gus);
  for (const bad of ['ab', '1abc', 'has space', '0xabc', 'Ember', 'admin', 'x'.repeat(17)]) {
    assert.equal((await call('set-username', { username: bad }, tf)).status, 400, bad);
  }
  assert.equal((await call('set-username', { username: 'Fay' }, null)).status, 401);
  const set = await call('set-username', { username: 'Speedy_Fay' }, tf);
  assert.equal(set.status, 200);
  assert.equal(set.body.username, 'Speedy_Fay');
  assert.equal((await call('set-username', { username: 'speedy_fay' }, tg)).status, 409, 'taken in any case');
  const race = (await call('bot-race', { terrain: 'Forest' }, tf)).body.race;
  assert.equal(race.field.find(f => f.wallet === fay.address.toLowerCase()).name, 'Speedy_Fay');
  clock = Date.parse(race.finishedAt) + 1;
  assert.equal((await call('leaderboard')).body.players.find(p => p.wallet === fay.address.toLowerCase()).name, 'Speedy_Fay');
  ok('players pick a unique name; it shows in races and on the leaderboard; bad names are refused');
}

// --- profile ----------------------------------------------------------------
{
  const pr = (await call('profile', {}, aliceToken)).body;
  const hist = (await call('history', {}, aliceToken)).body.races.filter(r => r.status === 'finished');
  assert.equal(pr.stats.races, hist.length);
  assert.equal(pr.stats.bot.points + pr.stats.online.points, pr.points);
  assert.equal(pr.stats.finishes.reduce((a, b) => a + b, 0), hist.length);
  assert.equal(pr.stats.best, Math.min(...hist.map(r => r.position)));
  assert.equal((await call('profile', {}, null)).status, 401);
  ok('profile stats add up to the race history and the season points');
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

// --- artwork: players in the Beta pass, bots in distinct public teasers -------
{
  const { buildTestField, TEASER_BODIES, BETA_RACER_ART } = await import('../supabase/functions/test-season/race/testSeason.ts');
  const { existsSync } = await import('node:fs');
  const file = (url) => existsSync(new URL(`../public${url}`, import.meta.url));
  for (const wallets of [[], ['0x' + 'a'.repeat(40)], Array.from({ length: 4 }, (_, i) => '0x' + String(i + 1).repeat(40)), Array.from({ length: 10 }, (_, i) => '0x' + i.toString(16).repeat(40))]) {
    const field = buildTestField(`art-${wallets.length}`, wallets);
    assert.equal(field.length, FIELD_SIZE);
    const players = field.filter(f => f.wallet), bots = field.filter(f => !f.wallet);
    assert.equal(players.length, wallets.length);
    for (const p of players) assert.deepEqual([p.tokenId, p.body, p.avatarUrl], [0, 'Beta', BETA_RACER_ART]);
    const botTokens = bots.map(b => b.tokenId);
    assert.equal(new Set(botTokens).size, bots.length, 'bots never share a teaser');
    assert.ok(botTokens.every(t => t >= 1 && t <= 10));
  }
  ok('players race in the Beta pass; bots wear distinct public teasers (1-10)');

  // The ball a racer rolls into must match the pangolin it runs as, and every file must exist.
  for (const r of buildTestField('colours', ['0x' + 'b'.repeat(40), '0x' + 'c'.repeat(40)])) {
    if (r.wallet) assert.ok(file(BETA_RACER_ART), 'Beta racer art');
    else {
      assert.equal(r.body, TEASER_BODIES[r.tokenId], `token ${r.tokenId} body`);
      assert.ok(file(`/nft-images/${r.tokenId}.webp`), `artwork ${r.tokenId}`);
    }
    assert.ok(file(`/sprites/ball_${r.body.toLowerCase()}.png`), `ball for ${r.body}`);
  }
  ok('each racer\'s ball matches its artwork (Beta ball for players), and every file exists');
}

// --- streaks and badges ------------------------------------------------------
{
  const { streakFor } = await import('../supabase/functions/test-season/race/testSeason.ts');
  const run = (from, n) => Array.from({ length: n }, (_, i) => new Date(Date.UTC(2026, 10, from + i)).toISOString().slice(0, 10));
  assert.deepEqual(streakFor([], '2026-11-10'), { current: 0, best: 0, ranToday: false, week: Array(7).fill(false), badge: 0 });
  // Three races on one day are still one day.
  assert.equal(streakFor(['2026-11-10', '2026-11-10', '2026-11-10'], '2026-11-10').current, 1);
  // Today still open: yesterday's streak is alive, and today's race extends it.
  assert.equal(streakFor(run(7, 3), '2026-11-10').current, 3);
  assert.equal(streakFor(run(7, 3), '2026-11-10').ranToday, false);
  assert.equal(streakFor(run(7, 4), '2026-11-10').current, 4);
  ok('a streak counts days in a row, and today stays open until midnight UTC');

  // A missed day breaks the streak, but the badge stays.
  const broken = streakFor(run(1, 7), '2026-11-10');
  assert.equal(broken.current, 0);
  assert.equal(broken.best, 7);
  assert.equal(broken.badge, 7);
  assert.equal(streakFor(run(1, 2), '2026-11-02').badge, 0);
  assert.equal(streakFor(run(1, 3), '2026-11-03').badge, 3);
  assert.equal(streakFor([...run(1, 14), ...run(20, 3)], '2026-11-22').badge, 14);
  ok('a broken streak resets, and earned badges are kept');

  // Across a month end.
  assert.equal(streakFor(['2026-10-30', '2026-10-31', '2026-11-01'], '2026-11-01').current, 3);
  assert.deepEqual(streakFor(['2026-11-10', '2026-11-08'], '2026-11-10').week, [false, false, false, false, true, false, true]);
  ok('streaks cross month ends, and the week strip ends on today');

  const me = (await call('me', {}, aliceToken)).body;
  assert.equal(me.streak.ranToday, true);
  assert.ok(me.streak.current >= 1, 'she raced today');
  const board = (await call('leaderboard', {})).body.players;
  assert.equal(board.every(p => typeof p.badge === 'number'), true);
  ok('the server reports the streak on the player and the badge on the leaderboard');

  // Early Pangolin: everyone who joins during the season gets a number; nobody who joins after it does.
  assert.ok(Number.isInteger(me.racerNumber) && me.racerNumber >= 1, 'she has a racer number');
  deps.betaSeasonEnd = new Date(Date.now() + 86_400_000);
  assert.equal((await call('me', {}, aliceToken)).body.racerNumber, me.racerNumber);
  deps.betaSeasonEnd = new Date(0);
  assert.equal((await call('me', {}, aliceToken)).body.racerNumber, null);
  const rowOf = async () => (await call('leaderboard', {})).body.players.find(p => p.wallet === me.wallet);
  assert.equal((await rowOf()).racerNumber, null);
  delete deps.betaSeasonEnd;
  assert.equal((await rowOf()).racerNumber, me.racerNumber);
  ok('the Early Pangolin number stays the same, and wallets joining after the season get none');
}

// --- fairness: identical stats → ~10% win rate per racer -------------------
{
  const N = 2000;
  let playerWins = 0;
  const lanes = Array(FIELD_SIZE).fill(0);
  const { buildTestField } = await import('../supabase/functions/test-season/race/testSeason.ts');
  for (let i = 0; i < N; i++) {
    const seed = `fair-${i}`;
    const field = buildTestField(seed, ['0x' + 'a'.repeat(40)]);
    const res = runTestRace(seed, field, 'Forest');
    const winner = res.find(r => r.position === 1);
    if (field[field.findIndex(f => f.id === winner.id)].wallet) playerWins++;
    lanes[field.findIndex(f => f.wallet)]++;
  }
  const playerWin = playerWins / N;
  assert.ok(lanes.every(n => n > N / FIELD_SIZE * 0.6), `the player's lane is random: ${lanes}`);
  assert.ok(playerWin > 0.07 && playerWin < 0.13, `player win rate ${playerWin}`);
  ok(`fair field: player wins ${(playerWin * 100).toFixed(1)}% of ${N} races (expected ~10%)`);
}


// --- Beta pass gate ----------------------------------------------------------
{
  const signerKey = Wallet.createRandom();
  const real = createBetaGate((n) => ({ BETA_CONTRACT: '0x00000000000000000000000000000000000000b7', BETA_SIGNER_KEY: signerKey.privateKey, BETA_CHAIN_ID: '4663' })[n]);
  const onChain = new Set();
  deps.beta = { ...real, hasMinted: async (w) => onChain.has(w.toLowerCase()) };   // chain stubbed, signing real

  const eve = Wallet.createRandom();
  const t = await signIn(eve);
  const me = (await call('me', {}, t)).body;
  assert.deepEqual([me.beta.required, me.beta.minted, me.beta.chainId], [true, false, 4663]);
  assert.equal((await call('bot-race', { terrain: 'Forest' }, t)).body.error, 'beta_required');
  assert.equal((await call('online-join', { terrain: 'Forest' }, t)).body.error, 'beta_required');
  ok('with the gate on, racing needs the Beta pass');

  const v = (await call('beta-voucher', {}, t)).body;
  const { solidityPackedKeccak256, getBytes } = await import('ethers');
  const hash = solidityPackedKeccak256(['string', 'uint256', 'address', 'address'], ['PangsRallyBeta', 4663, v.contract, eve.address.toLowerCase()]);
  assert.equal(verifyMessage(getBytes(hash), v.voucher), signerKey.address);
  assert.equal((await call('beta-voucher', {}, null)).status, 401);
  ok('voucher is signed by the server key for this wallet only (same hash as the contract)');

  onChain.add(eve.address.toLowerCase());
  assert.equal((await call('me', {}, t)).body.beta.minted, true);
  assert.equal((await call('bot-race', { terrain: 'Forest' }, t)).status, 200);
  onChain.clear();
  assert.equal((await call('me', {}, t)).body.beta.minted, true, 'remembered after the first sighting');
  ok('after the mint the player races, and the server remembers it');
  deps.beta = null;
}

{
  // Booked seats and reports
  const ann = Wallet.createRandom();
  const t = await signIn(ann);
  const joined = await call('online-join', { terrain: 'Forest' }, t);
  assert.equal(joined.status, 200, JSON.stringify(joined.body));
  const me = (await call('me', {}, t)).body;
  assert.equal(me.bookedSeats.length, 1);
  assert.equal(me.racesLeft, DAILY_RACE_LIMIT - 1);
  ok('a waiting room shows as a booked seat and keeps one race back');

  const good = { kind: 'bug', area: 'wallet', message: 'The nickname signs me out.', contact: '@ann', page: '/rally', agent: 'test' };
  assert.equal((await call('report', { ...good, message: 'short' }, t)).body.error, 'report_short');
  assert.equal((await call('report', { ...good, message: 'x'.repeat(2001) }, t)).body.error, 'report_long');
  assert.equal((await call('report', { ...good, kind: 'spam' }, t)).body.error, 'bad_request');
  assert.equal((await call('report', good, null)).status, 200, 'signed-out visitors can report');
  for (let i = 0; i < 5; i++) assert.equal((await call('report', good, t)).status, 200);
  assert.equal((await call('report', good, t)).body.error, 'report_limit');
  ok('reports are checked, work signed out, and stop at the daily limit');
}

{
  // Predictions: free, final, scored by saddle number, hidden until the race ends
  const pia = Wallet.createRandom(), sam = Wallet.createRandom(), racer = Wallet.createRandom();
  const pt = await signIn(pia), st = await signIn(sam), rt = await signIn(racer);
  clock += 3 * 3_600_000;
  const list = (await call('rooms', { terrain: 'Forest' }, pt)).body.rooms;
  const room = list[0];
  assert.equal(room.myPick, null);

  assert.equal((await call('predict', { raceId: room.id, pick: 4 })).status, 401);
  assert.equal((await call('predict', { raceId: room.id, pick: 0 }, pt)).body.error, 'bad_pick');
  assert.equal((await call('predict', { raceId: room.id, pick: 11 }, pt)).body.error, 'bad_pick');
  assert.equal((await call('predict', { raceId: room.id, pick: '2.5' }, pt)).body.error, 'bad_pick');
  ok('a pick needs a session and a number from 1 to 10');

  const before = (await call('me', {}, pt)).body.racesLeft;
  const made = await call('predict', { raceId: room.id, pick: 4 }, pt);
  assert.equal(made.status, 200, JSON.stringify(made.body));
  assert.equal(made.body.pick, 4);
  assert.equal((await call('me', {}, pt)).body.racesLeft, before);
  assert.equal((await call('predict', { raceId: room.id, pick: 5 }, pt)).body.error, 'already_picked');
  const rush = await Promise.all([1, 2, 3].map(pick => call('predict', { raceId: room.id, pick }, st)));
  assert.equal(rush.filter(r => r.status === 200).length, 1, 'parallel picks');
  ok('a pick is free and final, even when sent in parallel');

  const seen = (await call('rooms', { terrain: 'Forest' }, pt)).body.rooms.find(r => r.id === room.id);
  assert.equal(seen.myPick, 4);
  assert.equal(seen.crowd.reduce((a, b) => a + b, 0), 2);
  assert.equal(JSON.stringify(seen).includes(sam.address.toLowerCase()), false);
  ok('the room shows my pick and crowd counts, never who picked');

  const hidden = (await call('online-status', { raceId: room.id })).body.race;
  assert.equal(hidden.seed, null);
  const stored = await deps.store.getRace(room.id);
  assert.notEqual(stored.seed, `online-${room.id}`);
  ok('a room seed cannot be worked out from its public id');

  // Picks stay open through the countdown and close at the start.
  const seats = (await call('online-status', { raceId: room.id })).body.race.players.length;
  const { race: counting } = await fillRoom(room.id, seats);
  assert.equal((await call('predict', { raceId: room.id, pick: 2 }, await signIn(Wallet.createRandom()))).status, 200);
  clock = Date.parse(counting.closesAt);
  assert.equal((await call('predict', { raceId: room.id, pick: 6 }, rt)).body.error, 'predictions_closed');
  const race = (await call('online-status', { raceId: room.id })).body.race;
  assert.equal(race.status, 'finished');
  ok('picks stay open through the countdown and close at the start');

  const live = (await call('prediction-board', {}, pt)).body;
  assert.equal(live.mine.picks[0].status, 'live');
  assert.equal(live.mine.picks[0].position, null);
  assert.equal(live.players.some(p => p.wallet === pia.address.toLowerCase()), false);
  ok('a running race keeps its pick result and points hidden');

  clock = Date.parse(race.finishedAt) + 1000;
  const expected = (n) => {
    const pos = race.results.find(r => r.id === race.field[n - 1].id).position;
    return { pos, pts: pos === 1 ? 10 : pos <= 3 ? 3 : 0 };
  };
  const board = (await call('prediction-board', {}, pt)).body;
  const row = board.mine.picks[0];
  assert.equal(row.position, expected(4).pos);
  assert.equal(row.points, expected(4).pts);
  assert.equal(board.roomsCounted >= 1, true);
  const winner = race.results.find(r => r.position === 1);
  assert.equal(board.recent[0].number, race.field.findIndex(f => f.id === winner.id) + 1);
  const season = (await call('leaderboard')).body.players.find(p => p.wallet === pia.address.toLowerCase());
  assert.equal(season, undefined);
  ok('picks score 10 / 3 / 0 by saddle number and leave season points alone');

  // Every number scores the same way when a player's room runs.
  const next = (await call('rooms', { terrain: 'Forest' }, rt)).body.rooms[0];
  const callers = await Promise.all(Array.from({ length: 10 }, () => signIn(Wallet.createRandom())));
  for (let i = 0; i < 10; i++) assert.equal((await call('predict', { raceId: next.id, pick: i + 1 }, callers[i])).status, 200);
  const { race: nextFull } = await fillRoom(next.id, next.players);
  clock = Date.parse(nextFull.closesAt);
  const full = (await call('online-status', { raceId: next.id })).body.race;
  clock = Date.parse(full.finishedAt) + 1000;
  const scored = await deps.store.listPredictions(next.id);
  assert.equal(scored.filter(p => p.points === 10).length, 1);
  assert.equal(scored.filter(p => p.points === 3).length, 2);
  assert.equal(scored.filter(p => p.points === 0).length, 7);
  ok('of all ten numbers exactly one scores 10 and two score 3');
}

// --- production: predictions are off ----------------------------------------
{
  deps.predictions = false;
  const t = await signIn(Wallet.createRandom());
  assert.equal((await call('prediction-board', {}, t)).status, 404);
  assert.equal((await call('predict', { raceId: 'x', pick: 1 }, t)).status, 404);
  const room = (await call('rooms', { terrain: 'Forest' }, t)).body.rooms.at(-1);
  assert.equal(room.myPick, null);
  const { race } = await fillRoom(room.id, room.players);
  clock = Date.parse(race.closesAt) + 1;
  assert.equal((await call('online-status', { raceId: room.id })).body.race.status, 'finished');
  deps.predictions = true;
  ok('with predictions off, rooms never touch the picks table and the actions do not exist');
}

// --- Pangs Cup ----------------------------------------------------------------
{
  const { newCup, roomSeed } = await import('../supabase/functions/test-season/cup.ts');
  const start = clock + 2 * 3_600_000;
  const team = Wallet.createRandom();
  deps.cupTeamWallets = new Set([team.address.toLowerCase()]);
  await deps.store.insertCup(await newCup(deps, { id: 7, starts_at: new Date(start).toISOString(), seats: 23 }));

  const signedOut = await call('cup');
  assert.equal(signedOut.status, 200);
  assert.equal(signedOut.body.cup.id, 7, 'the latest Cup is the default');
  assert.equal(signedOut.body.cup.seedSecret, null, 'the secret stays hidden');
  assert.equal(signedOut.body.cup.seedCommit.length, 64);
  ok('the Cup page works signed out and shows only the seed commitment');

  const racers = [];
  for (let i = 0; i < 23; i++) {
    const w = Wallet.createRandom();
    const t = await signIn(w);
    const res = await call('cup-register', { cupId: 7 }, t);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    racers.push({ w, t, wallet: w.address.toLowerCase() });
  }
  const late = await signIn(Wallet.createRandom());
  assert.equal((await call('cup-register', { cupId: 7 }, late)).body.error, 'cup_closed', 'the 24th racer finds it full');
  assert.equal((await call('cup-register', { cupId: 7 }, await signIn(team))).body.error, 'cup_closed', 'team wallets cannot enter');
  const before = await call('me', {}, racers[0].t);
  assert.equal(before.body.racesToday, 0);
  ok('23 racers take the 23 seats; the next one and team wallets are refused');

  // Leave and come back before registration closes, then the seats lock.
  assert.equal((await call('cup-leave', { cupId: 7 }, racers[0].t)).body.me.registered, false);
  assert.equal((await call('cup-register', { cupId: 7 }, racers[0].t)).body.me.registered, true);
  clock = start - 29 * 60_000;
  assert.equal((await call('cup-leave', { cupId: 7 }, racers[0].t)).body.error, 'cup_locked');
  ok('a racer can give the seat back until registration closes, then it is locked');

  // Round 1 runs at its start time: 23 racers → three rooms of 8, 8 and 7 (bots fill the rest, scoring nothing).
  clock = start + 1000;
  let cup = (await call('cup', { cupId: 7 }, racers[0].t)).body;
  assert.equal(cup.cup.state, 'live');
  const r1 = cup.rounds[0];
  assert.equal(r1.rooms.length, 3);
  assert.deepEqual(r1.rooms.map(r => r.names.length).sort(), [7, 8, 8]);
  assert.equal(new Set(r1.rooms.flatMap(r => r.names)).size, 23, 'everyone races once');
  assert.equal(r1.state, 'live');
  assert.ok(cup.standings.every(s => s.total === 0), 'no points until the races cross the line');
  ok('round 1 draws 23 racers into rooms of 8, 8 and 7 and runs them');

  // A request that stopped half way through a round: the missing room runs on the next call.
  const lost = (await deps.store.cupRaces(7)).find(r => r.cup_room === 2);
  await deps.store.deleteRace(lost.id);
  await call('cup', { cupId: 7 });
  const again = (await deps.store.cupRaces(7)).find(r => r.cup_room === 2);
  assert.equal(again.seed, lost.seed);
  assert.deepEqual(again.results, lost.results, 'the same seed and field give the same result');
  ok('a round that stopped half way finishes its missing rooms, with the same result');

  const parallel = await Promise.all([call('cup', { cupId: 7 }), call('cup', { cupId: 7 })]);
  assert.ok(parallel.every(r => r.status === 200));
  assert.equal((await deps.store.cupRaces(7)).length, 3, 'parallel requests do not run a round twice');
  ok('parallel requests never run a round twice');

  // Run all four qualifying rounds and check the table.
  for (let round = 2; round <= 4; round++) {
    clock = start + (round - 1) * 15 * 60_000 + 1000;
    await call('cup', { cupId: 7 });
  }
  clock = start + 3 * 15 * 60_000 + 5 * 60_000;
  cup = (await call('cup', { cupId: 7 })).body;
  assert.equal(cup.rounds.slice(0, 4).every(r => r.state === 'done'), true);
  const all = await deps.store.cupRaces(7);
  const expected = new Map(racers.map(r => [r.wallet, 0]));
  for (const race of all) {
    for (const racer of race.field.filter(f => f.wallet)) {
      const pos = race.results.find(x => x.id === racer.id).position;
      expected.set(racer.wallet, expected.get(racer.wallet) + POINTS_BY_POSITION[pos - 1]);
    }
    assert.equal(race.kind, 'cup');
    assert.deepEqual(runTestRace(race.seed, race.field, race.terrain).map(r => r.position), race.results.map(r => r.position), 'replays match');
  }
  for (const row of cup.standings) assert.equal(row.total, expected.get(row.wallet));
  for (let i = 1; i < cup.standings.length; i++) assert.ok(cup.standings[i - 1].total >= cup.standings[i].total);
  ok('four rounds score 25/18/15… per room and the table adds them up, best first');

  assert.equal((await call('me', {}, racers[0].t)).body.racesToday, 0, 'Cup races use no daily race');
  assert.ok(!(await call('leaderboard')).body.players.some(p => expected.has(p.wallet)), 'and give no season points');
  ok('Cup races use no daily race and give no season points');

  // Grand Final: the top 10 only, in one room.
  const top10 = cup.standings.slice(0, 10).map(s => s.wallet);
  clock = start + 3 * 15 * 60_000 + 30 * 60_000 + 1000;
  cup = (await call('cup', { cupId: 7 })).body;
  const fin = cup.rounds[4];
  assert.equal(fin.final, true);
  assert.equal(fin.rooms.length, 1);
  const finalRace = (await deps.store.cupRaces(7)).find(r => r.cup_round === 5);
  assert.deepEqual(finalRace.field.filter(f => f.wallet).map(f => f.wallet).sort(), [...top10].sort());
  assert.equal(cup.result, null, 'the result stays hidden while the final runs on screen');
  assert.equal(cup.cup.seedSecret, null);
  ok('the Grand Final holds exactly the top 10');

  clock = Date.parse(finalRace.finished_at) + 1;
  const champ = finalRace.results.find(r => r.position === 1);
  const winner = finalRace.field.find(f => f.id === champ.id).wallet;
  const winnerToken = racers.find(r => r.wallet === winner).t;
  cup = (await call('cup', { cupId: 7 }, winnerToken)).body;
  assert.equal(cup.cup.state, 'finished');
  assert.equal(cup.result[0].wallet, winner);
  assert.deepEqual(cup.result.map(r => r.tier), [1, 2, 3, 4, 4, 4, 4, 4, 4, 4]);
  assert.equal(cup.result[0].prize, '15 USDG + Genesis whitelist');
  assert.equal(cup.me.award.tier, 1);
  assert.equal(cup.participants.length, 23, 'after the final every racer is listed for the Participant badge');
  assert.equal(cup.me.raced, true);
  const { participantProof, participantRoot } = await import('../src/testSeason/cupMerkle.ts');
  const root = participantRoot(cup.participants, 7);
  assert.equal(participantRoot([...cup.participants].reverse(), 7), root, 'the root does not depend on order');
  assert.ok(participantProof(cup.participants, 7, racers[5].wallet).length > 0);
  assert.equal(participantProof(cup.participants, 7, team.address), null);
  ok('the final result sets the tiers: champion, second, third, seven finalists');

  // Anyone can now check every seed against the commitment.
  const secret = cup.cup.seedSecret;
  assert.equal(await deps.sha256Hex(secret), cup.cup.seedCommit);
  for (const race of await deps.store.cupRaces(7)) assert.equal(race.seed, await roomSeed(deps, secret, race.cup_round, race.cup_room));
  ok('after the final the secret is public and every seed checks out against the commitment');
}

// --- Pangs Cup: too few racers ---------------------------------------------
{
  const { newCup } = await import('../supabase/functions/test-season/cup.ts');
  const start = clock + 3_600_000;
  await deps.store.insertCup(await newCup(deps, { id: 8, starts_at: new Date(start).toISOString() }));
  assert.equal((await call('cup', { cupId: 8 })).body.cup.seats, 50, 'a new Cup has 50 seats');
  for (let i = 0; i < 9; i++) assert.equal((await call('cup-register', { cupId: 8 }, await signIn(Wallet.createRandom()))).status, 200);
  clock = start + 60_000;
  let cup = (await call('cup', { cupId: 8 })).body;
  assert.equal(cup.cup.state, 'postponed');
  assert.equal(cup.rounds.every(r => r.state === 'upcoming' && r.rooms.length === 0), true, 'no round runs');
  assert.equal((await deps.store.cupRaces(8)).length, 0);
  // A new date (npm run cup -- update) reopens registration, and the nine keep their seats.
  const row = await deps.store.getCup(8);
  await deps.store.insertCup({ ...row, starts_at: new Date(clock + 2 * 3_600_000).toISOString() });
  cup = (await call('cup', { cupId: 8 })).body;
  assert.equal(cup.cup.state, 'upcoming');
  assert.equal(cup.cup.registered, 9);
  assert.equal((await call('cup-register', { cupId: 8 }, await signIn(Wallet.createRandom()))).status, 200, 'the tenth racer can join');
  clock = Date.parse(cup.cup.startsAt) + 60_000;
  cup = (await call('cup', { cupId: 8 })).body;
  assert.equal(cup.cup.state, 'live');
  assert.equal(cup.rounds[0].rooms.length, 1, 'with ten racers Round 1 runs');
  ok('with fewer than 10 racers the Cup is postponed and runs nothing; a new date brings it back');
}

console.log(`\n${checks} checks passed.`);
