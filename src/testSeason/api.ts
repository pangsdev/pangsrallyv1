/**
 * Browser client for the test-season server (supabase/functions/test-season).
 * Dev talks to the Vite stand-in at /api/test-season; production to the Edge Function.
 */
import { BrowserProvider, Contract } from 'ethers';
import { signInMessage, type Streak, type TestRacer, type TestRaceResult } from '../race/testSeason';

/** The Supabase project's public URL (not a secret). Used when the host sets no VITE_SUPABASE_URL. */
const PROJECT_URL = 'https://rzpcppmzpyocoqnjwrwp.supabase.co';
const BASE: string = import.meta.env.VITE_TEST_SEASON_API
  || (import.meta.env.DEV ? '/api/test-season' : `${import.meta.env.VITE_SUPABASE_URL || PROJECT_URL}/functions/v1/test-season`);
const UNAVAILABLE = 'The race server is not available right now. Please try again in a few minutes.';
const SESSION_KEY = 'pangsrally_test_session';

/** The free prediction game is still in the works: it shows on the dev server only, never in a production build. */
export const PREDICTIONS_ON = import.meta.env.DEV;

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
  kind: 'bot' | 'online';
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

/** True when a browser wallet (MetaMask, Rabby, …) is injected. */
export function hasWallet(): boolean {
  return typeof window !== 'undefined' && !!(window as unknown as { ethereum?: unknown }).ethereum;
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
export async function signInWithWallet(askInvite: (reason: string) => Promise<string | null>): Promise<PlayerStatus> {
  const eth = (window as unknown as { ethereum?: unknown }).ethereum;
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
async function useChain(eth: { request(a: { method: string; params?: unknown[] }): Promise<unknown> }, chainId: number) {
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
  const eth = (window as unknown as { ethereum?: { request(a: { method: string; params?: unknown[] }): Promise<unknown> } }).ethereum;
  if (!eth) throw new ApiError(0, 'no_wallet', 'No wallet found. Install MetaMask to mint your Beta pass.');
  onStep('voucher');
  const { contract, chainId, voucher } = await call<{ contract: string; chainId: number; voucher: string }>('beta-voucher');
  onStep('chain');
  try {
    await useChain(eth, chainId);
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
};
