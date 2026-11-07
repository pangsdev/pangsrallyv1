#!/usr/bin/env node
/**
 * Pangs Cup admin. Every command that spends gas or changes the live database only estimates
 * or previews unless you add --send. Keys come from .env and are never printed.
 *
 *   npm run cup -- create  --id 1 --starts 2026-11-21T20:00:00Z [--seats 50] [--eligible-before ISO] [--send]
 *   npm run cup -- update  --id 1 [--starts ISO] [--seats N] [--send]   new date (e.g. after a postponement) or more seats
 *   npm run cup -- status  --id 1
 *   npm run cup -- deploy  [--send]                       PangsCup contract (owner = dev wallet, prize token = USDG)
 *   npm run cup -- uris    --contract 0x… --cid <IPFS CID of the metadata folder> --id 1 [--send]
 *   npm run cup -- fund    --contract 0x… --usdg 30 [--send]       sends USDG from the dev wallet
 *   npm run cup -- publish --id 1 --contract 0x… [--send]           writes the final results and the racers' Participant root on chain
 *
 * .env: VITE_SUPABASE_URL, SUPABASE_SECRET_KEY (create/publish), DEV_WALLET_PRIVATE_KEY (chain).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { participantRoot } from '../src/testSeason/cupMerkle.ts';
import { Contract, ContractFactory, JsonRpcProvider, Wallet, formatEther, formatUnits, getAddress, isAddress, parseUnits } from 'ethers';

const RPC = 'https://rpc.mainnet.chain.robinhood.com';
const CHAIN_ID = 4663;
/** Global Dollar (USDG) on Robinhood Chain, from Paxos's own address list (docs.paxos.com/guides/stablecoin/usdg/mainnet). */
const USDG = '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168';
const PROJECT_URL = 'https://rzpcppmzpyocoqnjwrwp.supabase.co';

const root = new URL('..', import.meta.url);
const env = Object.fromEntries(readFileSync(new URL('.env', root), 'utf8').split('\n')
  .map(l => l.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/)).filter(Boolean)
  .map(([, k, v]) => [k, v.replace(/^["']|["']$/g, '')]));
const [command] = process.argv.slice(2);
const arg = (n, fallback) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : fallback; };
const send = process.argv.includes('--send');
const fail = (msg) => { console.error(msg); process.exit(1); };
const url = env.VITE_SUPABASE_URL || PROJECT_URL;

const provider = new JsonRpcProvider(RPC, CHAIN_ID, { staticNetwork: true });
const wallet = () => {
  if (!env.DEV_WALLET_PRIVATE_KEY) fail('DEV_WALLET_PRIVATE_KEY missing in .env');
  return new Wallet(env.DEV_WALLET_PRIVATE_KEY, provider);
};
const rest = async (path, init = {}) => {
  if (!env.SUPABASE_SECRET_KEY) fail('SUPABASE_SECRET_KEY missing in .env');
  const res = await fetch(`${url}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: env.SUPABASE_SECRET_KEY, Authorization: `Bearer ${env.SUPABASE_SECRET_KEY}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
  if (!res.ok) fail(`Database request failed (${res.status}): ${await res.text()}`);
  // return=minimal answers 201/204 with no body.
  const text = await res.text();
  return text ? JSON.parse(text) : null;
};
const game = async (action, body = {}) => {
  const res = await fetch(`${url}/functions/v1/test-season`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, ...body }) });
  const json = await res.json();
  if (!res.ok) fail(`${action}: ${json.message ?? res.status}`);
  return json;
};
const cupContract = (address, runner) => new Contract(address, JSON.parse(readFileSync(new URL('smart-contracts/deployments/PangsCup.artifact.json', root), 'utf8')).abi, runner);
const usdg = (runner) => new Contract(USDG, ['function decimals() view returns (uint8)', 'function balanceOf(address) view returns (uint256)', 'function transfer(address,uint256) returns (bool)', 'function symbol() view returns (string)'], runner);
const gasNote = async (gas) => {
  const fee = await provider.getFeeData();
  const price = fee.maxFeePerGas ?? fee.gasPrice ?? 0n;
  return `${gas} gas ≈ ${formatEther(gas * price)} ETH (upper bound)`;
};
const id = Number(arg('id', '0'));

switch (command) {
  case 'create': {
    const starts = arg('starts');
    if (!(id > 0) || !starts || !Number.isFinite(Date.parse(starts))) fail('Usage: create --id 1 --starts 2026-11-21T20:00:00Z');
    const secret = randomBytes(32).toString('hex');
    const row = {
      id, title: arg('title', `Pangs Cup #${id}`), terrain: 'Forest', starts_at: new Date(starts).toISOString(),
      round_minutes: Number(arg('round-minutes', '15')), qualifying_rounds: 4, final_gap_minutes: Number(arg('final-gap', '30')),
      seats: Number(arg('seats', '50')), register_close_minutes: 30,
      eligible_before: arg('eligible-before') ? new Date(arg('eligible-before')).toISOString() : null,
      seed_secret: secret, seed_commit: createHash('sha256').update(secret).digest('hex'),
      prizes: [
        { tier: 1, usdg: 15, label: '15 USDG + Genesis whitelist' },
        { tier: 2, usdg: 10, label: '10 USDG + Genesis whitelist' },
        { tier: 3, usdg: 5, label: '5 USDG + Genesis whitelist' },
        { tier: 4, usdg: 0, label: 'Finalist badge' },
      ],
    };
    console.log(`${row.title}: Round 1 at ${row.starts_at}, ${row.seats} seats, registration closes 30 min before.`);
    console.log(`Seed fingerprint (post this before Round 1): ${row.seed_commit}`);
    if (!send) { console.log('\nPreview only. Add --send to create it in the live database.'); break; }
    await rest('test_cups', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(row) });
    console.log('Created. Page: https://pangsrally.com/cup');
    break;
  }
  case 'update': {
    // A Cup that did not reach 10 racers shows as postponed; a new start date reopens registration.
    if (!(id > 0)) fail('Usage: update --id 1 [--starts ISO] [--seats N]');
    const patch = {};
    if (arg('starts')) {
      if (!Number.isFinite(Date.parse(arg('starts')))) fail('--starts must be a date, e.g. 2026-11-28T20:00:00Z');
      patch.starts_at = new Date(arg('starts')).toISOString();
    }
    if (arg('seats')) {
      if (!(Number(arg('seats')) >= 10)) fail('--seats must be 10 or more');
      patch.seats = Number(arg('seats'));
    }
    if (!Object.keys(patch).length) fail('Nothing to change: pass --starts and/or --seats.');
    const d = await game('cup', { cupId: id });
    if (patch.starts_at && d.rounds.some(r => r.state !== 'upcoming')) fail('This Cup has already raced; its date cannot move.');
    console.log(`${d.cup.title}: ${d.cup.registered} registered, state ${d.cup.state}.`);
    console.log(`Change: ${JSON.stringify(patch)}`);
    if (!send) { console.log('\nPreview only. Add --send to change the live Cup.'); break; }
    await rest(`test_cups?id=eq.${id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(patch) });
    console.log('Updated.');
    break;
  }
  case 'status': {
    const d = await game('cup', id ? { cupId: id } : {});
    console.log(`${d.cup.title} · ${d.cup.state} · ${d.cup.registered}/${d.cup.seats} seats · fingerprint ${d.cup.seedCommit}`);
    for (const r of d.rounds) console.log(`  ${r.final ? 'Final  ' : `Round ${r.round}`} ${r.at} ${r.state} ${r.rooms.length ? `(${r.rooms.length} rooms)` : ''}`);
    if (d.result) for (const p of d.result) console.log(`  ${p.place}. ${p.name} ${p.wallet} → ${p.prize}`);
    else for (const s of d.standings.slice(0, 12)) console.log(`  ${s.rank}. ${s.name} ${s.total}`);
    break;
  }
  case 'deploy': {
    const w = wallet();
    const art = JSON.parse(readFileSync(new URL('smart-contracts/deployments/PangsCup.artifact.json', root), 'utf8'));
    const factory = new ContractFactory(art.abi, art.bytecode, w);
    const tx = await factory.getDeployTransaction(w.address, USDG);
    const token = usdg(provider);
    console.log(`Owner: ${w.address}`);
    console.log(`Prize token: ${await token.symbol()} ${USDG} (${await token.decimals()} decimals)`);
    console.log(`Balance: ${formatEther(await provider.getBalance(w.address))} ETH`);
    console.log(`Deploy: ${await gasNote(await provider.estimateGas({ ...tx, from: w.address }))}`);
    if (!send) { console.log('\nEstimate only. Add --send to deploy.'); break; }
    const c = await factory.deploy(w.address, USDG);
    console.log(`Sent: ${c.deploymentTransaction().hash}`);
    await c.waitForDeployment();
    const address = await c.getAddress();
    writeFileSync(new URL('smart-contracts/deployments/PangsCup.robinhood.json', root),
      JSON.stringify({ address, chainId: CHAIN_ID, owner: w.address, prizeToken: USDG, tx: c.deploymentTransaction().hash, deployedAt: new Date().toISOString() }, null, 2) + '\n');
    console.log(`PangsCup deployed to ${address}`);
    break;
  }
  case 'uris': {
    const address = arg('contract'), cid = arg('cid');
    if (!isAddress(address ?? '') || !cid || !(id > 0)) fail('Usage: uris --contract 0x… --cid <CID> --id 1');
    const c = cupContract(address, wallet());
    for (const tier of [1, 2, 3, 4, 5]) {
      const tokenId = id * 10 + tier;
      const uri = `ipfs://${cid}/${tokenId}.json`;
      console.log(`token ${tokenId} → ${uri}`);
      if (send) await (await c.setBadgeURI(tokenId, uri)).wait();
    }
    if (!send) console.log('\nPreview only. Add --send to write them.');
    break;
  }
  case 'fund': {
    const address = arg('contract');
    const amount = arg('usdg');
    if (!isAddress(address ?? '') || !(Number(amount) > 0)) fail('Usage: fund --contract 0x… --usdg 30');
    const w = wallet();
    const token = usdg(w);
    const decimals = await token.decimals();
    const units = parseUnits(amount, decimals);
    const have = await token.balanceOf(w.address);
    console.log(`Dev wallet holds ${formatUnits(have, decimals)} USDG; sending ${amount} USDG to ${getAddress(address)}.`);
    if (have < units) fail('Not enough USDG in the dev wallet.');
    if (!send) { console.log('\nPreview only. Add --send to transfer.'); break; }
    const tx = await token.transfer(address, units);
    console.log(`Sent: ${tx.hash}`);
    await tx.wait();
    console.log('Done.');
    break;
  }
  case 'publish': {
    const address = arg('contract');
    if (!isAddress(address ?? '') || !(id > 0)) fail('Usage: publish --id 1 --contract 0x…');
    const d = await game('cup', { cupId: id });
    if (!d.result) fail('The Grand Final has not finished yet.');
    const decimals = await usdg(provider).decimals();
    const wallets = d.result.map(p => getAddress(p.wallet));
    const tiers = d.result.map(p => p.tier);
    const amounts = d.result.map(p => parseUnits(String(d.cup.prizes.find(x => x.tier === p.tier)?.usdg ?? 0), decimals));
    const total = amounts.reduce((a, b) => a + b, 0n);
    d.result.forEach((p, i) => console.log(`  ${p.place}. ${p.name.padEnd(16)} ${wallets[i]} tier ${tiers[i]} ${formatUnits(amounts[i], decimals)} USDG`));
    const w = wallet();
    const c = cupContract(address, w);
    const [balance, owed] = await Promise.all([usdg(provider).balanceOf(address), c.totalOwed()]);
    console.log(`Contract holds ${formatUnits(balance, decimals)} USDG, ${formatUnits(owed, decimals)} already promised; this Cup needs ${formatUnits(total, decimals)}.`);
    if (balance < owed + total) fail('Fund the contract first (npm run cup -- fund …).');
    const racers = d.participants ?? [];
    const root = participantRoot(racers, id);
    const rootSet = (await c.participantRoot(id)) !== '0x' + '0'.repeat(64);
    const done = Number(await c.claimDeadline(id)) > 0;
    console.log(`Participant badge: ${racers.length} racers, root ${root}${rootSet ? ' (already on chain)' : ''}`);
    if (!done) console.log(`setResults: ${await gasNote(await c.setResults.estimateGas(id, wallets, tiers, amounts))}`);
    if (!rootSet) console.log(`setParticipants: ${await gasNote(await c.setParticipants.estimateGas(id, root, racers.length))}`);
    if (!send) { console.log('\nPreview only. Add --send to write the results and the Participant root on chain (final, cannot be changed).'); break; }
    if (!done) {
      const tx = await c.setResults(id, wallets, tiers, amounts);
      console.log(`Sent: ${tx.hash}`);
      await tx.wait();
    }
    if (!rootSet) {
      const tx = await c.setParticipants(id, root, racers.length);
      console.log(`Participants sent: ${tx.hash}`);
      await tx.wait();
    }
    await rest(`test_cups?id=eq.${id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ claim_contract: getAddress(address) }) });
    console.log('Results and the Participant root are on chain; the Claim buttons are live on the Cup page.');
    break;
  }
  default:
    fail('Commands: create, update, status, deploy, uris, fund, publish (see the top of scripts/cup-admin.mjs).');
}
