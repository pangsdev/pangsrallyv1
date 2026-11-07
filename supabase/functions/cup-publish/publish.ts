/**
 * Pangs Cup: write a finished Cup's results on chain without anyone at the keyboard.
 *
 * Platform-neutral (Deno function `index.ts`, Node rehearsal `scripts/cup-publish-rehearsal.mjs`).
 * Same steps as `npm run cup -- publish --send`: setResults (prizes + finalist badges), then
 * setParticipants (Merkle root of every racer), then the Cup row gets `claim_contract`, which turns on
 * the Claim buttons. Every step reads the chain first, so running it again (every minute, from a
 * cron) only does what is still missing and never sends a second copy.
 */
import { Contract, getAddress, parseUnits, type Wallet } from 'ethers';
import { participantRoot } from './cupMerkle.ts';

export const CUP_ABI = [
  'function owner() view returns (address)',
  'function prizeToken() view returns (address)',
  'function totalOwed() view returns (uint256)',
  'function claimDeadline(uint256) view returns (uint256)',
  'function participantRoot(uint256) view returns (bytes32)',
  'function setResults(uint256 cupId, address[] wallets, uint8[] tiers, uint256[] amounts)',
  'function setParticipants(uint256 cupId, bytes32 root, uint256 racers)',
];
const ERC20_ABI = ['function decimals() view returns (uint8)', 'function balanceOf(address) view returns (uint256)'];
const ZERO = '0x' + '0'.repeat(64);

/** The parts of the `cup` action's reply this needs. */
export interface CupStatusReply {
  cup: { id: number; state: string; claimContract: string | null; prizes: { tier: number; usdg: number }[] };
  result: { wallet: string; tier: number }[] | null;
  participants: string[] | null;
}

export interface PublishOptions {
  status: CupStatusReply;
  contract: string;
  signer: Wallet;
  /** Saves `claim_contract` on the Cup row (turns on the Claim buttons). */
  markPublished: (cupId: number, contract: string) => Promise<void>;
}

export type PublishOutcome =
  | { status: 'waiting'; cupState: string }
  | { status: 'published'; cupId: number; txs: string[] }
  | { status: 'busy'; reason: string }
  | { status: 'blocked'; reason: string };

export async function publishCup({ status, contract, signer, markPublished }: PublishOptions): Promise<PublishOutcome> {
  const { cup, result } = status;
  if (cup.state !== 'finished' || !result) return { status: 'waiting', cupState: cup.state };
  const address = getAddress(contract);
  if (cup.claimContract) return { status: 'published', cupId: cup.id, txs: [] };

  const provider = signer.provider!;
  const c = new Contract(address, CUP_ABI, signer);
  const me = await signer.getAddress();
  if (getAddress(await c.owner()) !== me) return { status: 'blocked', reason: `The publishing wallet ${me} does not own the Cup contract.` };
  // A transaction from an earlier run is still waiting to be mined: let that one land first.
  const [latest, pending] = await Promise.all([provider.getTransactionCount(me, 'latest'), provider.getTransactionCount(me, 'pending')]);
  if (pending > latest) return { status: 'busy', reason: 'An earlier transaction is still pending.' };

  const token = new Contract(await c.prizeToken(), ERC20_ABI, provider);
  const decimals = Number(await token.decimals());
  const wallets = result.map(p => getAddress(p.wallet));
  const tiers = result.map(p => p.tier);
  const amounts = result.map(p => parseUnits(String(cup.prizes.find(x => x.tier === p.tier)?.usdg ?? 0), decimals));
  const total = amounts.reduce((a, b) => a + b, 0n);
  const racers = (status.participants ?? []).map(w => getAddress(w));
  const txs: string[] = [];

  if (Number(await c.claimDeadline(cup.id)) === 0) {
    const [balance, owed] = await Promise.all([token.balanceOf(address), c.totalOwed()]);
    if (balance < owed + total) return { status: 'blocked', reason: `The contract holds too little prize money (needs ${total} more units than it has spare).` };
    const tx = await c.setResults(cup.id, wallets, tiers, amounts);
    txs.push(tx.hash);
    await tx.wait();
  }
  if (racers.length && (await c.participantRoot(cup.id)) === ZERO) {
    const tx = await c.setParticipants(cup.id, participantRoot(racers, cup.id), racers.length);
    txs.push(tx.hash);
    await tx.wait();
  }
  await markPublished(cup.id, address);
  return { status: 'published', cupId: cup.id, txs };
}
