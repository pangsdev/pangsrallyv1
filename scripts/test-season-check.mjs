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
import { runTestRace, DAILY_RACE_LIMIT, FIELD_SIZE, OPEN_ROOMS, ROOM_SLOT_MINUTES, POINTS_BY_POSITION } from '../supabase/functions/test-season/race/testSeason.ts';

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

  clock = Date.parse(joins[0].body.race.closesAt) + 1000;
  const status = await call('online-status', { raceId: roomId });
  const race = status.body.race;
  assert.equal(race.status, 'finished');
  assert.equal(race.field.filter(f => f.wallet).length, 3);
  assert.deepEqual(runTestRace(race.seed, race.field, race.terrain), race.results);
  for (const p of race.players) assert.equal(p.points, POINTS_BY_POSITION[p.position - 1]);
  ok('room starts at its scheduled time, fills with bots, scores every player');

  assert.equal((await call('history', {}, tokens[2])).body.races[0].status, 'live', 'still running on screen');
  clock = Date.parse(race.finishedAt) + 1;
  const hist = (await call('history', {}, tokens[2])).body.races;
  assert.equal(hist[0].raceId, roomId);
  assert.ok(hist[0].position >= 1);
  ok('the race shows up in My Races with its result once it has run');
}

// --- scheduled rooms ---------------------------------------------------------
{
  const slotMs = ROOM_SLOT_MINUTES * 60_000;
  const [r1, r2] = await Promise.all([call('rooms', { terrain: 'Forest' }), call('rooms', { terrain: 'Forest' })]);
  const list = r1.body.rooms;
  assert.equal(list.length, OPEN_ROOMS);
  assert.deepEqual(r2.body.rooms.map(r => r.id).sort(), list.map(r => r.id).sort(), 'parallel calls make no duplicate rooms');
  const starts = list.map(r => Date.parse(r.startsAt));
  for (const t of starts) assert.equal(t % slotMs, 0, 'rooms start on the clock');
  assert.ok(starts[0] - clock >= 120_000, 'never a room that is about to go');
  for (let i = 1; i < starts.length; i++) assert.equal(starts[i] - starts[i - 1], slotMs);
  ok(`${OPEN_ROOMS} rooms are always open, ${ROOM_SLOT_MINUTES} min apart, made by the game`);

  // Ten players fill the last room: it starts at once and a new room takes its start time.
  const last = list[list.length - 1];
  const crowd = Array.from({ length: FIELD_SIZE }, () => Wallet.createRandom());
  const tokens = [];
  for (const w of crowd) tokens.push(await signIn(w));
  let fin;
  for (const t of tokens) fin = await call('online-join', { terrain: 'Forest', roomId: last.id }, t);
  assert.equal(fin.body.race.status, 'finished', 'full room starts immediately');
  assert.equal(fin.body.race.field.filter(f => f.wallet).length, FIELD_SIZE);
  const after = (await call('rooms', { terrain: 'Forest' }, tokens[0])).body.rooms;
  assert.equal(after.length, OPEN_ROOMS);
  const same = after.find(r => r.startsAt === last.startsAt || Date.parse(r.startsAt) === Date.parse(last.startsAt));
  assert.ok(same && same.id !== last.id && same.players === 0, 'a new room took the full one\'s start time');
  ok('a full room starts at once and a fresh room replaces it');

  const late = Wallet.createRandom();
  const lt = await signIn(late);
  assert.equal((await call('online-join', { terrain: 'Forest', roomId: last.id }, lt)).body.error, 'room_started');
  const pick = await call('online-join', { terrain: 'Forest', roomId: after[1].id }, lt);
  assert.equal(pick.body.race.id, after[1].id);
  assert.equal((await call('rooms', { terrain: 'Forest' }, lt)).body.rooms.find(r => r.id === after[1].id).joined, true);
  ok('players pick a room; a started room is refused; the list marks rooms you are in');
}

// --- a player who leaves still gets scored --------------------------------
{
  const dave = Wallet.createRandom();
  const t = await signIn(dave);
  const join = await call('online-join', { terrain: 'Forest' }, t);
  clock = Date.parse(join.body.race.closesAt) + 5000;
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

console.log(`\n${checks} checks passed.`);
