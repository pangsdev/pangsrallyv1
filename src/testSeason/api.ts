/**
 * Browser client for the test-season server (supabase/functions/test-season).
 * Dev talks to the Vite stand-in at /api/test-season; production to the Edge Function.
 */
import { BrowserProvider, Contract } from 'ethers';
import { signInMessage, type Streak, type TestRacer, type TestRaceResult } from '../race/testSeason';
import { getEthereum, hasAnyWallet, type Eip1193 } from './wallets';

/** The Supabase project's public URL (not a secret). Used when the host sets no VITE_SUPABASE_URL. */
const PROJECT_URL = 'https://rzpcppmzpyocoqnjwrwp.supabase.co';
const BASE: string = import.meta.env.VITE_TEST_SEASON_API
  || (import.meta.env.DEV ? '/api/test-season' : `${import.meta.env.VITE_SUPABASE_URL || PROJECT_URL}/functions/v1/test-season`);
const UNAVAILABLE = 'The race server is not available right now. Please try again in a few minutes.';
const SESSION_KEY = 'pangsrally_test_session';

/** The prediction game is shelved (owner, Nov 2026): off everywhere, the dev server included. */
export const PREDICTIONS_ON = false;

export interface PlayerStatus {
  wallet: string;
  /** Name picked on the Profile page; null → the short wallet is shown. */
  username: string | null;
  streak: Streak;
  /** Place in sign-up order, shown on the Early Pangolin badge; null for wallets that joined after the season. */
  racerNumber: number | null;
  racesToday: number;
  dailyLimit: number;
  racesLeft: number;
  /** start times of rooms the player holds a seat in; each seat already used one of today's races */
  /** start times of the rooms the player has a seat in; null while a room waits for players */
  bookedSeats: (string | null)[];
  unlimited: boolean;
  points: number;
  races: number;
  wins: number;
  podiums: number;
  rank: number | null;
  resetsAt: string;
  /** Test season Beta pass (free NFT, gas only). When required and not minted, racing is locked. */
  beta: { required: boolean; minted: boolean; contract: string | null; chainId: number | null };
}

/** Robinhood Chain, where the Beta pass lives. */
const BETA_CHAIN = {
  chainName: 'Robinhood Chain',
  rpcUrls: ['https://rpc.mainnet.chain.robinhood.com'],
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
};

export interface RacePlayer {
  wallet: string;
  name: string;
  position: number | null;
  points: number;
}

export interface PublicRace {
  id: string;
  kind: 'bot' | 'online' | 'cup' | 'rally';
  /** Pangs Cup races only: which round, and whether it is the Grand Final */
  cup?: { round: number; final: boolean } | null;
  terrain: string;
  status: 'open' | 'finished';
  createdAt: string;
  closesAt: string | null;
  finishedAt: string | null;
  seed: string | null;
  field: TestRacer[] | null;
  results: TestRaceResult[] | null;
  players: RacePlayer[];
  maxPlayers: number;
}

/** An online room. It has no start time until all its seats are taken. */
export interface RoomSummary {
  id: string;
  startsAt: string | null;
  players: number;
  /** who took a seat, first come first */
  names: string[];
  maxPlayers: number;
  /** the signed-in player already has a seat */
  joined: boolean;
  /** the signed-in player's locked number, if any */
  myPick: number | null;
  /** picks per saddle number, 1 to 10 */
  crowd: number[];
}

export interface PredictionPlayer {
  rank: number;
  wallet: string;
  name: string;
  points: number;
  picks: number;
  /** picks that named the winner */
  winners: number;
  /** picks that finished 2nd or 3rd */
  podiums: number;
}

export interface MyPick {
  raceId: string;
  terrain: string;
  pick: number;
  startsAt: string | null;
  /** 'live': resolved but still running on screen, so the result stays hidden */
  status: 'open' | 'live' | 'finished';
  position: number | null;
  points: number;
}

export interface PredictionBoard {
  players: PredictionPlayer[];
  recent: { raceId: string; number: number; name: string; terrain: string; finishedAt: string | null }[];
  /** wins per saddle number over the rooms counted */
  numberWins: number[];
  roomsCounted: number;
  mine: { summary: PredictionPlayer | null; picks: MyPick[] } | null;
}

export interface LeaderboardPlayer {
  rank: number;
  wallet: string;
  name: string;
  /** days of the highest streak badge, 0 for none */
  badge: number;
  /** place in sign-up order for the Early Pangolin badge, null without one */
  racerNumber: number | null;
  points: number;
  races: number;
  wins: number;
  podiums: number;
}

export interface ProfileStatus extends PlayerStatus {
  stats: {
    races: number;
    winRate: number;
    avgPosition: number | null;
    best: number | null;
    /** how often the player finished 1st … 10th */
    finishes: number[];
    bot: { races: number; points: number; wins: number };
    online: { races: number; points: number; wins: number };
    firstRace: string | null;
    lastRace: string | null;
  };
}

export interface HistoryRow {
  raceId: string;
  kind: 'bot' | 'online';
  terrain: string;
  /** 'live': resolved but still running on screen; its points count once it ends. */
  status: 'open' | 'live' | 'finished';
  joinedAt: string;
  position: number | null;
  points: number;
}

export class ApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

interface Session { token: string; wallet: string }

export function getSession(): Session | null {
  try {
    const s = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
    return s && typeof s.token === 'string' && typeof s.wallet === 'string' ? s : null;
  } catch {
    return null;
  }
}

export function clearSession() {
  try { localStorage.removeItem(SESSION_KEY); } catch { /* ignore */ }
}

async function call<T>(action: string, params: Record<string, unknown> = {}): Promise<T> {
  const session = getSession();
  let res: Response;
  try {
    res = await fetch(BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(session ? { 'x-session': session.token } : {}) },
      body: JSON.stringify({ action, ...params }),
    });
  } catch {
    throw new ApiError(0, 'network', 'Cannot reach the race server. Check your connection and try again.');
  }
  const body = await res.json().catch(() => null);
  // Our server always answers with JSON { error, message }; anything else (HTML, empty 404/5xx) is the
  // hosting layer saying the function is not there or is down.
  if (!res.ok) {
    if (res.status === 401 && body?.error) clearSession();
    throw new ApiError(res.status, body?.error || 'unavailable', body?.message || UNAVAILABLE);
  }
  if (!body) throw new ApiError(res.status, 'unavailable', UNAVAILABLE);
  return body as T;
}

/** True when a browser wallet (MetaMask, Rabby, OKX, …) is installed. */
export function hasWallet(): boolean {
  return hasAnyWallet();
}

/** Opens this page inside the MetaMask mobile app's browser. */
export function metamaskDeepLink(): string {
  return `https://metamask.app.link/dapp/${window.location.host}${window.location.pathname}`;
}

/** Invite code from a shared link (?invite=CODE), read when the page loads so moving between pages keeps it. */
const INVITE_AT_LOAD = (() => {
  try { return new URLSearchParams(window.location.search).get('invite'); } catch { return null; }
})();
export function inviteFromUrl(): string | null {
  return INVITE_AT_LOAD;
}

/** A plain message for a wallet that refused the connection; the raw error is full of RPC details. */
function walletConnectError(e: unknown): ApiError {
  const err = e as { code?: unknown; error?: { code?: unknown }; info?: { error?: { code?: unknown } } };
  const codes = [err?.code, err?.error?.code, err?.info?.error?.code];
  if (codes.includes(-32002)) return new ApiError(0, 'wallet_busy', 'Your wallet already has a request waiting. Open your wallet, finish it, then try again.');
  return new ApiError(0, 'wallet_cancelled', 'Wallet connection was cancelled. Unlock your wallet, make sure it has an account, and try again.');
}

/**
 * Connect the wallet and sign the (free) sign-in message. A wallet that has not joined yet
 * needs an invite code: `askInvite` is called with the reason and returns the code typed in
 * (or null to give up). The same signature is reused for the retry, so nobody signs twice.
 */
export async function signInWithWallet(askInvite: (reason: string) => Promise<string | null>, wallet?: Eip1193): Promise<PlayerStatus> {
  const eth = wallet ?? getEthereum();
  if (!eth) throw new ApiError(0, 'no_wallet', 'No wallet found. Install MetaMask to join the Beta season.');
  // Check the server first so nobody is asked to sign a message that cannot be used.
  await call('leaderboard');
  const provider = new BrowserProvider(eth as never);
  try {
    await provider.send('eth_requestAccounts', []);
  } catch (e) {
    throw walletConnectError(e);
  }
  const signer = await provider.getSigner();
  const address = await signer.getAddress();
  const message = signInMessage(address, new Date().toISOString());
  let signature: string;
  try {
    signature = await signer.signMessage(message);
  } catch {
    throw new ApiError(0, 'sign_rejected', 'Signature cancelled. Sign the message to join the Beta season.');
  }
  let inviteCode: string | null = inviteFromUrl();
  for (;;) {
    try {
      const res = await call<PlayerStatus & { token: string }>('login', { address, message, signature, ...(inviteCode ? { inviteCode } : {}) });
      try { localStorage.setItem(SESSION_KEY, JSON.stringify({ token: res.token, wallet: res.wallet })); } catch { /* private mode */ }
      const { token: _token, ...status } = res;
      return status;
    } catch (e) {
      if (!(e instanceof ApiError) || (e.code !== 'invite_required' && e.code !== 'invite_invalid' && e.code !== 'invite_full')) throw e;
      inviteCode = await askInvite(e.code !== 'invite_required' && inviteCode ? e.message : '');
      if (!inviteCode) throw new ApiError(0, 'invite_cancelled', 'The Beta season is invite-only. Ask the Pangs Rally team for a code.');
    }
  }
}

/** Switch MetaMask to the Beta pass chain, adding it first if the wallet does not know it. */
async function switchChain(eth: { request(a: { method: string; params?: unknown[] }): Promise<unknown> }, chainId: number) {
  const hex = `0x${chainId.toString(16)}`;
  try {
    await eth.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: hex }] });
  } catch (e) {
    if ((e as { code?: number })?.code !== 4902) throw e;
    await eth.request({ method: 'wallet_addEthereumChain', params: [{ chainId: hex, ...BETA_CHAIN }] });
  }
}

/** Mints the free Beta pass (the player pays only gas) and returns the refreshed status. */
export async function mintBetaPass(onStep: (step: 'voucher' | 'chain' | 'confirm' | 'pending') => void): Promise<PlayerStatus> {
  const eth = getEthereum();
  if (!eth) throw new ApiError(0, 'no_wallet', 'No wallet found. Install MetaMask to mint your Beta pass.');
  onStep('voucher');
  const { contract, chainId, voucher } = await call<{ contract: string; chainId: number; voucher: string }>('beta-voucher');
  onStep('chain');
  try {
    await switchChain(eth, chainId);
  } catch {
    throw new ApiError(0, 'wrong_chain', 'Switch your wallet to Robinhood Chain to mint the Beta pass.');
  }
  const signer = await new BrowserProvider(eth as never).getSigner();
  const beta = new Contract(contract, ['function mint(bytes voucher)', 'function hasMinted(address) view returns (bool)'], signer);
  if (!(await beta.hasMinted(await signer.getAddress()))) {
    onStep('confirm');
    let tx: { wait(): Promise<unknown> };
    try {
      tx = await beta.mint(voucher);
    } catch (e) {
      const err = e as { code?: string; shortMessage?: string };
      if (err.code === 'ACTION_REJECTED') throw new ApiError(0, 'mint_rejected', 'Mint cancelled. Your Beta pass is free; you only pay gas.');
      if (err.code === 'INSUFFICIENT_FUNDS') throw new ApiError(0, 'no_gas', 'You need a little ETH on Robinhood Chain to pay the gas.');
      throw new ApiError(0, 'mint_failed', err.shortMessage || 'The mint did not go through. Please try again.');
    }
    onStep('pending');
    await tx.wait();
  }
  return call<PlayerStatus>('me');
}

/** ' · 1 seat booked for 7:30 PM', so a waiting room explains why the count dropped. */
export function seatNote(player: Pick<PlayerStatus, 'bookedSeats'>): string {
  const seats = player.bookedSeats ?? [];
  if (!seats.length) return '';
  if (seats.length > 1) return ` · ${seats.length} seats booked`;
  const start = seats[0];
  return start ? ` · 1 seat booked for ${new Date(start).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}` : ' · 1 held for your room';
}

/* ------------------------------------------------------------------ */
/* Daily Rally                                                         */
/* ------------------------------------------------------------------ */

export interface RallyRoom {
  room: number;
  raceId: string;
  finishedAt: string | null;
  /** crossed the line on screen */
  over: boolean;
  names: string[];
  mine: boolean;
  podium: { name: string; position: number }[] | null;
}

export interface RallyStatus {
  hourUtc: number;
  terrain: string;
  next: { day: string; startsAt: string; registered: number; entrants: string[] };
  /** the latest rally that has started (today after 18:00 UTC, otherwise yesterday's) */
  last: { day: string; startsAt: string; rooms: RallyRoom[] } | null;
  board: { rank: number; name: string; points: number; rallies: number; wins: number; podiums: number; me: boolean }[];
  me: { registered: boolean; raceId: string | null; result: { position: number; points: number } | null; rank: number | null; points: number } | null;
  serverTime: string;
}

/* ------------------------------------------------------------------ */
/* Pangs Cup                                                           */
/* ------------------------------------------------------------------ */

export interface CupPrize { tier: number; usdg: number; label: string }

export interface CupRoom {
  room: number;
  raceId: string;
  finishedAt: string | null;
  /** racer names in this room (players only) */
  names: string[];
  /** the signed-in player races in this room */
  mine: boolean;
}

export interface CupRound {
  round: number;
  final: boolean;
  at: string;
  /** 'live': the races are running on screen now */
  state: 'upcoming' | 'live' | 'done';
  rooms: CupRoom[];
}

export interface CupStanding {
  rank: number;
  wallet: string;
  name: string;
  total: number;
  /** points per qualifying round, null until that round has crossed the line */
  rounds: (number | null)[];
  wins: number;
}

export interface CupPlacing { place: number; wallet: string; name: string; tier: number; prize: string }

export interface CupStatus {
  cup: {
    id: number;
    title: string;
    terrain: string;
    startsAt: string;
    finalAt: string;
    registerClosesAt: string;
    qualifyingRounds: number;
    seats: number;
    registered: number;
    prizes: CupPrize[];
    /** postponed: Round 1 came with fewer than `minRacers` registered; nothing runs until it is rescheduled */
    state: 'upcoming' | 'live' | 'finished' | 'postponed';
    minRacers: number;
    /** SHA-256 of the Cup secret, public from the start */
    seedCommit: string;
    /** the secret itself, once the Grand Final has run */
    seedSecret: string | null;
    /** PangsCup contract that pays this Cup, once set */
    claimContract: string | null;
  };
  rounds: CupRound[];
  standings: CupStanding[];
  entrants: string[];
  /** after the final: the wallets that raced (they can claim the Participant badge) */
  participants: string[] | null;
  result: CupPlacing[] | null;
  me: { registered: boolean; canRegister: boolean; problem: string | null; inFinal: boolean; raced: boolean; award: CupPlacing | null } | null;
  serverTime: string;
}

const CUP_ABI = [
  'function awardOf(uint256 cupId, address wallet) view returns (uint8 tier, uint256 amount, bool claimed)',
  'function claimDeadline(uint256 cupId) view returns (uint256)',
  'function claim(uint256 cupId)',
  'function participantRoot(uint256 cupId) view returns (bytes32)',
  'function participantClaimed(uint256 cupId, address wallet) view returns (bool)',
  'function claimParticipant(uint256 cupId, bytes32[] proof)',
];
/** USDG has 6 decimals. */
const USDG_DECIMALS = 6;

export interface OnChainAward {
  /** results are written on chain for this Cup */
  published: boolean;
  tier: number;
  usdg: number;
  claimed: boolean;
  deadline: number | null;
}

/** Reads a wallet's Cup award from the PangsCup contract over the public RPC (no wallet needed). */
export async function readCupAward(contract: string, cupId: number, wallet: string): Promise<OnChainAward> {
  const { JsonRpcProvider } = await import('ethers');
  const provider = new JsonRpcProvider(BETA_CHAIN.rpcUrls[0], CUP_CHAIN_ID, { staticNetwork: true });
  const c = new Contract(contract, CUP_ABI, provider);
  const [award, deadline] = await Promise.all([c.awardOf(cupId, wallet), c.claimDeadline(cupId)]);
  return {
    published: Number(deadline) > 0,
    tier: Number(award[0]),
    usdg: Number(award[1]) / 10 ** USDG_DECIMALS,
    claimed: Boolean(award[2]),
    deadline: Number(deadline) > 0 ? Number(deadline) * 1000 : null,
  };
}

/** Whether the Participant badges of a Cup are open on chain, and whether this wallet took one. */
export async function readCupParticipant(contract: string, cupId: number, wallet: string): Promise<{ published: boolean; claimed: boolean }> {
  const { JsonRpcProvider, ZeroHash } = await import('ethers');
  const provider = new JsonRpcProvider(BETA_CHAIN.rpcUrls[0], CUP_CHAIN_ID, { staticNetwork: true });
  const c = new Contract(contract, CUP_ABI, provider);
  const [root, claimed] = await Promise.all([c.participantRoot(cupId), c.participantClaimed(cupId, wallet)]);
  return { published: root !== ZeroHash, claimed: Boolean(claimed) };
}

/** Robinhood Chain id, where the Beta pass and the Cup contract live. */
export const CUP_CHAIN_ID = 4663;

/** Sends the claim from the player's own wallet: the badge is minted and any USDG prize is paid. */
export function claimCupPrize(contract: string, cupId: number, onStep: (step: 'chain' | 'confirm' | 'pending') => void): Promise<string> {
  return sendCupClaim(contract, onStep, c => c.claim(cupId));
}

/** Claims the Participant badge with this wallet's Merkle proof (cupMerkle.ts). */
export async function claimCupParticipant(contract: string, cupId: number, racers: string[], wallet: string, onStep: (step: 'chain' | 'confirm' | 'pending') => void): Promise<string> {
  const { participantProof } = await import('./cupMerkle');
  const proof = participantProof(racers, cupId, wallet);
  if (!proof) throw new ApiError(0, 'not_participant', 'This wallet did not race in this Cup. Switch to the wallet you raced with.');
  return sendCupClaim(contract, onStep, c => c.claimParticipant(cupId, proof));
}

async function sendCupClaim(
  contract: string,
  onStep: (step: 'chain' | 'confirm' | 'pending') => void,
  send: (c: Contract) => Promise<{ hash: string; wait(): Promise<unknown> }>,
): Promise<string> {
  const eth = getEthereum();
  if (!eth) throw new ApiError(0, 'no_wallet', 'No wallet found. Open this page in MetaMask to claim.');
  onStep('chain');
  try {
    await switchChain(eth, CUP_CHAIN_ID);
  } catch {
    throw new ApiError(0, 'wrong_chain', 'Switch your wallet to Robinhood Chain to claim.');
  }
  const signer = await new BrowserProvider(eth as never).getSigner();
  const c = new Contract(contract, CUP_ABI, signer);
  onStep('confirm');
  let tx: { hash: string; wait(): Promise<unknown> };
  try {
    tx = await send(c);
  } catch (e) {
    const err = e as { code?: string; shortMessage?: string; reason?: string; revert?: { name?: string } };
    if (err.code === 'ACTION_REJECTED') throw new ApiError(0, 'claim_rejected', 'Claim cancelled. You can claim any time.');
    if (err.code === 'INSUFFICIENT_FUNDS') throw new ApiError(0, 'no_gas', 'You need a little ETH on Robinhood Chain to pay the gas.');
    const name = err.revert?.name;
    if (name === 'NotAFinalist') throw new ApiError(0, 'not_finalist', 'This wallet has no prize in this Cup. Switch to the wallet you raced with.');
    if (name === 'NotAParticipant') throw new ApiError(0, 'not_participant', 'This wallet did not race in this Cup. Switch to the wallet you raced with.');
    if (name === 'AlreadyClaimed') throw new ApiError(0, 'already_claimed', 'This wallet has already claimed this badge.');
    throw new ApiError(0, 'claim_failed', err.shortMessage || 'The claim did not go through. Please try again.');
  }
  onStep('pending');
  await tx.wait();
  return tx.hash;
}

export type ReportKind = 'bug' | 'idea' | 'other';
export type ReportArea = 'racing' | 'rooms' | 'wallet' | 'leaderboard' | 'profile' | 'other';

export const testSeason = {
  me: () => call<PlayerStatus>('me'),
  botRace: (terrain: string) => call<PlayerStatus & { race: PublicRace; you: { position: number; points: number } }>('bot-race', { terrain }),
  rooms: (terrain: string) => call<{ rooms: RoomSummary[]; serverTime: string }>('rooms', { terrain }),
  /** Takes a seat (one of the day's races). No roomId → the soonest room with a free seat. */
  onlineJoin: (terrain: string, roomId?: string) => call<{ race: PublicRace; serverTime: string }>('online-join', { terrain, ...(roomId ? { roomId } : {}) }),
  onlineLeave: (raceId: string) => call<PlayerStatus>('online-leave', { raceId }),
  onlineStatus: (raceId: string) => call<{ race: PublicRace; serverTime: string }>('online-status', { raceId }),
  race: (raceId: string) => call<{ race: PublicRace }>('race', { raceId }),
  history: () => call<{ races: HistoryRow[] }>('history'),
  profile: () => call<ProfileStatus>('profile'),
  leaderboard: () => call<{ players: LeaderboardPlayer[] }>('leaderboard'),
  /** Locks the player's number for a room. Free; a pick cannot be changed. */
  predict: (raceId: string, pick: number) => call<{ pick: number | null; crowd: number[] }>('predict', { raceId, pick }),
  prediction: (raceId: string) => call<{ pick: number | null; crowd: number[] }>('prediction', { raceId }),
  predictionBoard: () => call<PredictionBoard>('prediction-board'),
  report: (r: { kind: ReportKind; area: ReportArea; message: string; contact: string; page: string; agent: string }) => call<{ sent: boolean }>('report', r),
  setUsername: (username: string) => call<PlayerStatus>('set-username', { username }),
  cup: (cupId?: number) => call<CupStatus>('cup', cupId ? { cupId } : {}),
  cupRegister: (cupId: number) => call<CupStatus>('cup-register', { cupId }),
  cupLeave: (cupId: number) => call<CupStatus>('cup-leave', { cupId }),
  rally: () => call<RallyStatus>('rally'),
  rallyRegister: () => call<RallyStatus>('rally-register'),
  rallyLeave: () => call<RallyStatus>('rally-leave'),
};
